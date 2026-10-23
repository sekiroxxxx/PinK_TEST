import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { chromium } from "playwright-core";
import type { CatalogDocument } from "./case-contract.js";
import { Builder } from "./builder.js";
import { findWindow } from "./session.js";
import { assertWindowIdentity } from "./workspace-identity.js";
import { waitFor } from "./common.js";
import { contentHash } from "./plan-integrity.js";
import { pinkExecutable } from "./offline-plan.js";

export const submissionModes = ["none", "multiple", "response"] as const;
export const submissionRevision = "developer-submission-ambiguity-v1";
export const submissionIds = (mode: string) => [
  `developer.submission.${mode}.web-desktop`,
  `developer.submission.${mode}.web-desktop.variant-1`,
];

interface Context {
  root: string;
  fixture: string;
  pink: string;
  project?: string;
  port: number;
  mode: string;
  invoke(args: string[], directory: string, label: string, preload?: string): Promise<number>;
  fingerprint(path: string): Promise<string | null>;
}

export async function runSubmissionSelfcheck(c: Context) {
  if (c.mode !== "all" && !submissionModes.some((mode) => mode === c.mode))
    throw new Error("提交自检仅支持 all/none/multiple/response");
  const results = join(c.root, "results");
  await mkdir(results, { recursive: true });
  const directory = await mkdtemp(join(results, "developer-submissions-"));
  const project = c.project ? await realpath(resolve(c.project)) : join(directory, "project");
  if (!c.project)
    await cp(join(c.fixture, "project"), project, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  const inside = relative(await realpath(results), await realpath(project));
  assert.ok(
    inside &&
      inside !== ".." &&
      !inside.startsWith("..\\") &&
      !inside.startsWith("../") &&
      !isAbsolute(inside),
    "只允许结果目录内独立自检工程",
  );
  const pkg = JSON.parse(await readFile(join(project, "package.json"), "utf8"));
  assert.equal(pkg.name, "pink-build-developer-selfcheck");
  assert.equal(pkg.pink.uuid, "ce183a71-c08d-40cf-bdc6-e41f59893d20");
  const scene = join(project, "assets/selfcheck.scene");
  assert.deepEqual(
    JSON.parse(await readFile(scene, "utf8")),
    JSON.parse(await readFile(join(c.fixture, "project/assets/selfcheck.scene"), "utf8")),
    "拒绝已被编辑的工程场景",
  );
  const protectedFiles = [
    join(homedir(), ".pink/settings.json"),
    join(project, ".pink/settings.json"),
    scene,
  ];
  const before = await Promise.all(protectedFiles.map((p) => c.fingerprint(p)));
  console.log(
    `提交关联自检目录：${directory}；每种场景各点击一次，后项应未执行；观察差异/丢失响应均为开发夹具，不是产品缺陷。`,
  );
  try {
    for (const mode of c.mode === "all" ? submissionModes : [c.mode]) {
      const attempt = join(directory, mode);
      await mkdir(attempt);
      const catalog: CatalogDocument = JSON.parse(
        await readFile(join(c.fixture, "cases.json"), "utf8"),
      );
      catalog.revision = submissionRevision;
      const combo = catalog.platforms[0].combinations[0];
      const ids = submissionIds(mode);
      const names = [
        `qa_submission_${mode}_${Date.now()}`,
        `qa_submission_${mode}_must_not_run_${Date.now()}`,
      ];
      combo.id = ids[0];
      combo.title = `开发自检：${mode} 关联不明，停止后续提交`;
      Object.assign(combo.values, {
        name: names[0],
        outputName: names[0],
        buildPath: "project://build",
        debug: true,
      });
      combo.variants = [
        { title: "哨兵：应保持未执行，不构建", values: { name: names[1], outputName: names[1] } },
      ];
      const casesFile = join(attempt, "cases.json");
      const execution = join(attempt, "execution");
      const runFile = join(attempt, "run.json");
      await writeFile(casesFile, JSON.stringify(catalog, null, 2) + "\n");
      await writeFile(
        join(attempt, "submission-fixture.json"),
        JSON.stringify(
          {
            revision: submissionRevision,
            mode,
            project,
            casesFile,
            names,
            caseIds: ids,
            evidence: "real-click; controlled-runner-observation-or-return; no-product-task-write",
          },
          null,
          2,
        ) + "\n",
      );
      await writeFile(
        runFile,
        JSON.stringify(
          {
            schemaVersion: 1,
            pink: resolve(c.pink),
            project,
            casesFile,
            groups: "publish",
            caseIds: ids,
            port: c.port,
            results: execution,
            expectedPlan: join(attempt, "plan.json"),
          },
          null,
          2,
        ) + "\n",
      );
      const args = ["--run-config", runFile];
      assert.equal(
        await c.invoke(
          [...args, "--preview", "--preview-file", join(attempt, "plan.json")],
          attempt,
          "preview",
        ),
        0,
      );
      assert.equal(await c.invoke([...args, "--check-plan"], attempt, "check-plan"), 0);
      assert.equal(
        await c.invoke(
          args,
          attempt,
          "execution",
          new URL("./developer-submission-fixture.js", import.meta.url).href,
        ),
        1,
      );
      const runs = (await readdir(execution, { withFileTypes: true })).filter((e) =>
        e.isDirectory(),
      );
      assert.equal(runs.length, 1, "不得重试覆盖原始失败");
      const resultFile = join(execution, runs[0].name, "result.json");
      // Do not start/restart PinK or resubmit anything during reconciliation.
      await reconcile(resultFile, await pinkExecutable(c.pink), project, c.port);
      await verifySubmissionResult(resultFile);
    }
  } finally {
    for (const [index, path] of protectedFiles.entries())
      assert.equal(
        await c.fingerprint(path),
        before[index],
        `受保护文件变化：${path}；不覆盖用户数据恢复`,
      );
  }
}

async function reconcile(resultFile: string, executable: string, project: string, port: number) {
  const attempt = dirname(dirname(dirname(resultFile)));
  const manifest = JSON.parse(await readFile(join(attempt, "submission-fixture.json"), "utf8"));
  const bytes = await readFile(resultFile);
  const original = JSON.parse(bytes.toString("utf8"));
  const endpoint = `http://127.0.0.1:${port}`;
  assert.equal(original.launch.endpoint, endpoint);
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 15_000 });
  let builder: Builder | undefined;
  const signal = new AbortController().signal;
  try {
    const page = await findWindow(browser, project, signal, executable);
    const identity = await assertWindowIdentity(page, project, executable);
    builder = await Builder.open(page, endpoint, signal, "X-Device", 120_000, true);
    await builder.installProbe();
    await builder.historySnapshot(true);
    const task = await waitFor(
      "只读核对实际任务收尾，不重试提交",
      async () => {
        const snapshot = await builder!.latestSnapshot();
        if (!snapshot) return;
        assert.equal(
          snapshot.tasks.filter((t) => t.outputName === manifest.names[1]).length,
          0,
          "哨兵被实际提交",
        );
        const matches = snapshot.tasks.filter(
          (t) => t.outputName === manifest.names[0] && t.platform === "web-desktop",
        );
        assert.ok(matches.length <= 1, "产品真的产生多个任务，不能算夹具预期通过");
        return matches[0]?.state === "success" ? matches[0] : undefined;
      },
      120_000,
      signal,
    );
    assert.equal(task.options?.debug, true);
    await writeFile(
      join(attempt, "reconciliation.json"),
      JSON.stringify(
        {
          basis: "read-only-existing-PinK; unmodified observer; not a new execution verdict",
          at: Date.now(),
          resultSha256: contentHash(bytes),
          identity,
          task: {
            id: task.id,
            state: task.state,
            outputName: task.outputName,
            createdAt: task.createdAt,
            completedAt: task.completedAt,
          },
          actualMatches: 1,
          sentinelMatches: 0,
          buildSubmitted: false,
          buildCancelled: false,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await builder?.close();
    await browser.close();
  }
  assert.equal(
    contentHash(await readFile(resultFile)),
    contentHash(bytes),
    "只读补核不得改写原始结果",
  );
}

export async function verifySubmissionResult(file: string) {
  const attempt = dirname(dirname(dirname(file)));
  const manifest = JSON.parse(await readFile(join(attempt, "submission-fixture.json"), "utf8"));
  assert.equal(manifest.revision, submissionRevision);
  assert.ok(submissionModes.includes(manifest.mode));
  const bytes = await readFile(file);
  const data = JSON.parse(bytes.toString("utf8"));
  assert.equal(data.outcome, "failed");
  assert.match(data.failure, /提交是否生效不明，停止后续提交/);
  assert.equal(data.cases.length, 2);
  const [fault, sentinel] = data.cases;
  assert.equal(fault.caseId, submissionIds(manifest.mode)[0]);
  assert.equal(fault.outcome, "failed");
  assert.equal(fault.stage, "submit");
  assert.equal(typeof fault.submittedAt, "number");
  assert.equal(fault.task, undefined, "不能任意选一个任务冒充唯一关联");
  const expected =
    manifest.mode === "none"
      ? /等待超时：本次唯一新任务/
      : manifest.mode === "multiple"
        ? /多个新任务匹配本次点击/
        : /构建点击已执行但调用响应不明/;
  assert.match(fault.failure, expected);
  assert.equal(sentinel.caseId, submissionIds(manifest.mode)[1]);
  assert.equal(sentinel.outcome, "not-run");
  assert.equal(sentinel.stage, "not-run");
  assert.equal(sentinel.submittedAt, undefined);
  assert.equal(sentinel.task, undefined);
  assert.equal(data.cleanup.taskMayStillBeRunning, true);
  assert.equal(data.cleanup.buildAutomaticallyCancelled, false);
  assert.equal(data.cleanup.pinkCloseRequested, false);
  assert.equal(data.planVerification.state, "matched");
  assert.equal(data.runtimeIdentity.project, manifest.project);
  assert.equal(data.caseSource.revision, submissionRevision);
  const ledger = (await readFile(join(attempt, "actions.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((v) => JSON.parse(v));
  assert.equal(ledger.filter((v) => v.kind === "build-attempt").length, 1, "不得重试或点击哨兵");
  assert.equal(ledger.filter((v) => v.kind === "click-delivered").length, 1);
  assert.equal(ledger.filter((v) => v.kind === "fixture").length, 1);
  const injected = ledger.find((v) => v.kind === "fixture");
  assert.equal(injected.mode, manifest.mode);
  assert.equal(
    injected.source,
    manifest.mode === "response" ? "runner-return-after-real-click" : "runner-observation-copy",
  );
  if (manifest.mode !== "response")
    assert.equal(injected.visibleMatches, manifest.mode === "none" ? 0 : 2);
  const real = JSON.parse(await readFile(join(attempt, "reconciliation.json"), "utf8"));
  assert.equal(real.resultSha256, contentHash(bytes));
  assert.equal(real.identity.project, manifest.project);
  assert.equal(real.task.state, "success");
  assert.equal(real.actualMatches, 1);
  assert.equal(real.sentinelMatches, 0);
  assert.equal(real.buildSubmitted, false);
  if (manifest.mode === "none") assert.deepEqual(injected.hiddenIds, [real.task.id]);
  if (manifest.mode === "multiple") {
    assert.deepEqual(injected.candidateIds, [real.task.id, `developer-synthetic:${real.task.id}`]);
    for (const id of injected.candidateIds) assert.ok(fault.failure.includes(id));
  }
  const html = await readFile(join(dirname(file), "report.html"), "utf8");
  for (const text of [
    "失败 1",
    "通过 0",
    "未完成 1",
    "未关联构建任务",
    "可能仍在运行",
    "工具未自动取消",
    fault.caseId,
    sentinel.caseId,
  ])
    assert.ok(html.includes(text), `报告缺少 ${text}`);
  if (fault.screenshot) assert.ok(html.includes(encodeURIComponent(fault.screenshot)));
  else {
    assert.ok(fault.screenshotOmittedReason);
    assert.ok(html.includes(fault.screenshotOmittedReason));
  }
  console.log(
    `${manifest.mode} 自检通过：一次点击，未任意关联，未重试，后项未执行；原报告仍保留提交不明，真实任务另行只读确认收尾。\n报告：${join(dirname(file), "report.html")}`,
  );
}
