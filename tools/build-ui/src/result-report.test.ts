import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { writeResultReport } from "./result-report.js";

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "pink-report-test-"));
  t.after(async () => {
    assert.equal(dirname(root), tmpdir());
    await rm(root, { recursive: true });
  });
  const run = join(root, "run");
  await mkdir(run);
  return { root, run, file: join(run, "result.json") };
}

test("runtime capability blocks remain distinct from missing materials in the same complete report", async (t) => {
  const { file } = await fixture(t);
  await writeFile(
    file,
    JSON.stringify({
      kind: "pink-configuration-steps-result",
      schemaVersion: 2,
      outcome: "failed",
      lifecycle: "finished",
      runtimeCapabilities: [
        { platform: "web-desktop", status: "ready", entry: { label: "本次实际分类" } },
        { platform: "qa-extra", status: "blocked", reason: "执行能力不足：未识别配置控件" },
      ],
      cases: [
        {
          caseId: "material",
          outcome: "blocked",
          failure: { reason: "缺少材料引用 signing.path" },
          steps: [],
        },
        {
          caseId: "adapter",
          outcome: "blocked",
          failure: { reason: "执行能力不足：未识别配置控件" },
          steps: [],
        },
      ],
    }),
  );
  const html = await readFile(await writeResultReport(file), "utf8");
  for (const text of [
    "共 2 项",
    "受阻 2",
    "执行能力检查（与材料前提分别记录）",
    "本次实际分类",
    "执行器能力受阻",
    "缺少材料引用 signing.path",
  ])
    assert.ok(html.includes(text), text);
  assert.match(html, /通过 0/);
});

test("checkpoint and interrupted reports never imply finished acceptance", async (t) => {
  const { file } = await fixture(t);
  const data = {
    kind: "pink-configuration-steps-result",
    schemaVersion: 2,
    outcome: "incomplete",
    lifecycle: "running",
    cases: [{ caseId: "stopped-case", outcome: "not-run", steps: [] }],
  };
  await writeFile(file, JSON.stringify(data));
  assert.match(await readFile(await writeResultReport(file), "utf8"), /检查点，不能计为通过/);
  await writeFile(
    file,
    JSON.stringify({
      ...data,
      lifecycle: "finished",
      outcome: "failed",
      interruption: { source: "parent-disconnect", requestedAt: "2026-10-26T00:00:00.000Z" },
      checkpointErrors: [{ chain: [{ message: "EPERM: checkpoint rename denied" }] }],
      cleanup: [{ resource: "builder-probe", outcome: "failed", reason: "probe owner changed" }],
      cases: [
        {
          caseId: "stopped-case",
          outcome: "stopped",
          restoration: "passed",
          failure: { reason: "停止后已安全恢复" },
          tasks: [{ taskId: "owned-task" }],
          steps: [],
        },
      ],
    }),
  );
  const html = await readFile(await writeResultReport(file), "utf8");
  assert.match(html, /parent-disconnect/);
  assert.match(html, /恢复：passed/);
  assert.match(html, /owned-task/);
  assert.match(html, /通过 0/);
  assert.match(html, /EPERM: checkpoint rename denied/);
  assert.match(html, /builder-probe释放失败：probe owner changed/);
  assert.doesNotMatch(html, /本次没有失败、受阻或未完成用例/);
});

test("configuration step reports keep assertion, recovery and policy stop diagnostics", async (t) => {
  const { file } = await fixture(t);
  await writeFile(
    file,
    JSON.stringify({
      kind: "pink-configuration-steps-result",
      outcome: "failed",
      cases: [
        {
          caseId: "steps.stop",
          platform: "web-desktop",
          outcome: "stopped",
          restoration: "passed",
          stopFollowingCases: true,
          failure: { reason: "配置断言不符合预期" },
          stopReason: { reason: "用例指定失败后停止" },
          steps: [
            { stepId: "check-name", operation: "assert", error: { reason: "配置断言不符合预期" } },
          ],
        },
        {
          caseId: "sentinel",
          outcome: "skipped",
          steps: [],
          restoration: "not-required",
          stopFollowingCases: true,
        },
      ],
    }),
  );
  const html = await readFile(await writeResultReport(file), "utf8");
  for (const text of [
    "未提交构建",
    "check-name (assert)",
    "配置断言不符合预期",
    "恢复：passed",
    "用例指定失败后停止",
    "前项已停止，本例未执行",
    "已跳过",
  ])
    assert.ok(html.includes(text), text);
});

test("configuration failure reports expose the cause phase and captured screenshot", async (t) => {
  const { run, file } = await fixture(t);
  await writeFile(join(run, "restore-failure.png"), "fixture");
  await writeFile(
    file,
    JSON.stringify({
      kind: "pink-configuration-steps-result",
      outcome: "failed",
      cases: [
        {
          caseId: "restore",
          outcome: "stopped",
          restoration: "failed",
          stopFollowingCases: true,
          steps: [
            {
              stepId: "restore-original",
              operation: "restore",
              error: { reason: "恢复失败" },
              diagnostic: {
                chain: [
                  { message: "配置恢复失败", recovery: { phase: "restore-input", field: "name" } },
                  { message: "等待超时：键盘焦点" },
                ],
              },
              evidence: { screenshot: "restore-failure.png", scene: "restore-failure.json" },
            },
          ],
        },
      ],
    }),
  );
  const html = await readFile(await writeResultReport(file), "utf8");
  for (const text of ["restore-input / name", "等待超时：键盘焦点", 'href="restore-failure.png"'])
    assert.ok(html.includes(text), text);
});

test("failed/blocked cases show diagnostics, escaped text and real screenshot links, without secrets", async (t) => {
  const { run, file } = await fixture(t);
  await writeFile(join(run, "failed case.png"), "fixture");
  await writeFile(
    file,
    JSON.stringify({
      runId: "sample",
      outcome: "failed",
      cases: [
        {
          caseId: "publish.android",
          platform: "android",
          outcome: "failed",
          stage: "collect",
          failure: '<script>alert(1)</script> password="test-password" exact test-password',
          task: { id: "task-1", options: { keystorePassword: "test-password" } },
          screenshot: "failed case.png",
        },
        {
          caseId: "debug.ohos",
          platform: "ohos",
          outcome: "blocked",
          stage: "preflight",
          failure: "SDK 缺失",
          screenshotOmittedReason: "签名页面不截图",
        },
        { caseId: "passed.case", outcome: "passed" },
      ],
    }),
  );
  const output = await writeResultReport(file);
  const html = await readFile(output, "utf8");
  assert.equal(output, join(run, "report.html"));
  for (const expected of [
    "失败 1",
    "受阻 1",
    "通过 1",
    "passed.case",
    "task-1",
    "SDK 缺失",
    "签名页面不截图",
    'href="failed%20case.png"',
    "&lt;script&gt;",
  ])
    assert.ok(html.includes(expected), expected);
  for (const unwanted of ["<script>", "test-password"])
    assert.ok(!html.includes(unwanted), unwanted);
});

test("all-passed reports list each case in result order with its own task and recovery state", async (t) => {
  const { file } = await fixture(t);
  await writeFile(
    file,
    JSON.stringify({
      kind: "pink-configuration-steps-result",
      schemaVersion: 2,
      outcome: "passed",
      lifecycle: "finished",
      buildAttempted: true,
      cases: [
        {
          caseId: "web.copy<&>",
          platform: "web-desktop",
          outcome: "passed",
          restoration: "not-required",
          tasks: [
            {
              taskId: "task-web",
              state: "success",
              options: { keystorePassword: "private-signing-value" },
            },
          ],
        },
        {
          caseId: "public.home",
          target: { kind: "builder", category: "X-Device" },
          outcome: "passed",
          restoration: "passed",
          tasks: [],
        },
        {
          caseId: "public.representative",
          target: { kind: "builder", representativePlatform: "wechatgame" },
          outcome: "passed",
          restoration: "not-required",
          tasks: [],
        },
      ],
    }),
  );
  const html = await readFile(await writeResultReport(file), "utf8");
  const table = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
  assert.equal((table.match(/<tr>/g) ?? []).length, 3);
  assert.match(table, /<td>1<\/td><td>web.copy&lt;&amp;&gt;<\/td>/);
  assert.match(table, /<td>2<\/td><td>public.home<\/td>/);
  assert.ok(table.indexOf("web.copy") < table.indexOf("public.home"));
  for (const expected of [
    "web-desktop",
    "task-web",
    "成功 (success)",
    "公共主页 · X-Device",
    "公共主页 · wechatgame",
    "未关联构建任务",
    "无需恢复",
    "已恢复",
  ])
    assert.ok(table.includes(expected), expected);
  assert.doesNotMatch(html, /private-signing-value|keystorePassword|<td>web.copy<&>/);
  assert.match(html, /通过 3/);
  assert.match(html, /本次没有失败、受阻或未完成用例/);
});

test("incomplete and fatal runs remain visible, without broken or external screenshot links", async (t) => {
  const { file } = await fixture(t);
  await writeFile(
    file,
    JSON.stringify({
      outcome: "stopped",
      failure: "连接中断",
      cleanup: { warnings: ["任务可能仍在运行"] },
      cases: [
        { caseId: "not.started", outcome: "not-run", screenshot: "https://example.com/shot.png" },
        { caseId: "cancelled.case", outcome: "stopped", screenshot: "../../outside.png" },
        { caseId: "missing.shot", outcome: "failed", screenshot: "missing.png" },
      ],
    }),
  );
  const html = await readFile(await writeResultReport(file), "utf8");
  for (const value of [
    "未完成 2",
    "连接中断",
    "任务可能仍在运行",
    "not.started",
    "截图文件不存在或路径不可用",
  ])
    assert.ok(html.includes(value), value);
  assert.ok(!html.includes('href="https:'));
  assert.ok(!html.includes('href="../../'));
  assert.ok(!html.includes('href="missing.png"'));
});

test("existing merged summaries reuse the selected original task and screenshot without a rebuild", async (t) => {
  const { root, run } = await fixture(t);
  const other = join(root, "retry");
  await mkdir(other);
  await writeFile(join(other, "failure.png"), "fixture");
  await writeFile(
    join(other, "result.json"),
    JSON.stringify({
      cases: [
        {
          caseId: "case-1",
          stage: "collect",
          outcome: "failed",
          task: { id: "task-retry" },
          screenshot: "failure.png",
        },
      ],
    }),
  );
  const file = join(run, "acceptance-summary.json");
  await writeFile(
    file,
    JSON.stringify({
      kind: "four-groups-base-acceptance-summary",
      outcome: "failed",
      cases: [
        {
          caseId: "case-1",
          outcome: "failed",
          taskId: "task-retry",
          reason: "build failed",
          evidence: "../retry/result.json",
          disposition: "未重新构建",
        },
      ],
    }),
  );
  const output = await writeResultReport(file);
  const html = await readFile(output, "utf8");
  assert.equal(output, join(run, "acceptance-summary-report.html"));
  for (const value of [
    'href="../retry/failure.png"',
    "task-retry",
    "构建结果收集",
    "build failed",
    "未重新构建",
  ])
    assert.ok(html.includes(value), value);
});

test("no failures is distinct from a run-level failure or zero collected cases", async (t) => {
  const { file } = await fixture(t);
  await writeFile(
    file,
    JSON.stringify({ outcome: "passed", cases: [{ caseId: "ok", outcome: "passed" }] }),
  );
  assert.match(
    await readFile(await writeResultReport(file), "utf8"),
    /本次没有失败、受阻或未完成用例/,
  );
  await writeFile(file, JSON.stringify({ outcome: "failed", fatal: "启动失败", cases: [] }));
  const html = await readFile(await writeResultReport(file), "utf8");
  assert.match(html, /启动失败/);
  assert.doesNotMatch(html, /本次没有失败、受阻或未完成用例/);
});

test("uncertain submission reports keep unassociated tasks and unexecuted cases explicit", async (t) => {
  const { file } = await fixture(t);
  await writeFile(
    file,
    JSON.stringify({
      outcome: "failed",
      failure: "提交是否生效不明，停止后续提交",
      cleanup: { taskMayStillBeRunning: true },
      cases: [
        {
          caseId: "uncertain",
          outcome: "failed",
          stage: "submit",
          submittedAt: 1,
          failure: "等待超时：本次唯一新任务",
        },
        { caseId: "sentinel", outcome: "not-run", stage: "not-run" },
      ],
    }),
  );
  const html = await readFile(await writeResultReport(file), "utf8");
  for (const text of [
    "失败 1",
    "通过 0",
    "未完成 1",
    "未关联构建任务",
    "提交是否生效不明",
    "可能仍在运行",
    "工具未自动取消",
    "sentinel",
  ])
    assert.ok(html.includes(text), text);
});

test("v2 step report identifies attempted builds, owned task and cleanup failure", async (t) => {
  const { file } = await fixture(t);
  await writeFile(
    file,
    JSON.stringify({
      kind: "pink-configuration-steps-result",
      schemaVersion: 2,
      outcome: "failed",
      buildAttempted: true,
      buildSubmitted: true,
      taskMayStillBeRunning: true,
      cases: [
        {
          caseId: "v2",
          platform: "web-mobile",
          outcome: "stopped",
          restoration: "unsafe",
          stopFollowingCases: true,
          tasks: [{ reference: "submitted", taskId: "owned-task", state: "processing" }],
          steps: [
            { stepId: "finished", operation: "build.wait", error: { reason: "任务观察超时" } },
          ],
        },
      ],
    }),
  );
  const html = await readFile(await writeResultReport(file), "utf8");
  for (const text of [
    "PinK 步骤构建报告",
    "owned-task",
    "finished (build.wait)",
    "可能仍在运行",
    "恢复：unsafe",
  ])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /配置步骤报告（未提交构建）/);
});
