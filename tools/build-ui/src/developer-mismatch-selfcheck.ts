import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { CatalogDocument } from "./case-contract.js";

export const mismatchIds = Array.from(
  { length: 5 },
  (_, i) => `developer.mismatch.web-desktop${i ? `.variant-${i}` : ""}`,
);
export const mismatchRevision = "developer-observation-mismatches-v1";
export const terminalMismatchIds = [
  "developer.terminal-mismatch.web-desktop",
  "developer.terminal-mismatch.web-desktop.variant-1",
];

interface Context {
  root: string;
  fixture: string;
  pink: string;
  project?: string;
  port: number;
  terminalOnly?: boolean;
  invoke(args: string[], directory: string, label: string, preload?: string): Promise<number>;
  fingerprint(path: string): Promise<string | null>;
}

export async function runMismatchSelfcheck(c: Context) {
  const results = join(c.root, "results");
  await mkdir(results, { recursive: true });
  const directory = await mkdtemp(join(results, "developer-mismatches-"));
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
    "仅允许结果目录中的独立自检工程",
  );
  const pkg = JSON.parse(await readFile(join(project, "package.json"), "utf8"));
  assert.equal(pkg.name, "pink-build-developer-selfcheck");
  assert.equal(pkg.pink.uuid, "ce183a71-c08d-40cf-bdc6-e41f59893d20");
  const scene = join(project, "assets/selfcheck.scene");
  assert.deepEqual(
    JSON.parse(await readFile(scene, "utf8")),
    JSON.parse(await readFile(join(c.fixture, "project/assets/selfcheck.scene"), "utf8")),
    "工程场景已被修改，不操作当前工程",
  );
  const before = new Map<string, string | null>();
  for (const path of [
    join(homedir(), ".pink/settings.json"),
    join(project, ".pink/settings.json"),
    scene,
  ])
    before.set(path, await c.fingerprint(path));
  const catalog: CatalogDocument = JSON.parse(
    await readFile(join(c.fixture, "cases.json"), "utf8"),
  );
  catalog.revision = mismatchRevision;
  const combo = catalog.platforms[0].combinations[0];
  const suffix = Date.now();
  const names = ["ui", "ui_recovery", "queued", "terminal", "terminal_recovery"].map(
    (v) => `qa_mismatch_${v}_${suffix}`,
  );
  combo.id = mismatchIds[0];
  combo.title = "开发自检：真实 UI 回读差异，不提交";
  Object.assign(combo.values, {
    name: names[0],
    outputName: names[0],
    buildPath: "project://build",
    debug: true,
  });
  combo.variants = names.slice(1).map((name, i) => ({
    title: ["UI 差异后正常对照", "入队观察副本受控差异", "终态观察副本受控差异", "跨组正常对照"][i],
    values: { name, outputName: name },
  }));
  if (c.terminalOnly) {
    combo.id = terminalMismatchIds[0];
    combo.title = "终态观察副本受控差异：定向补验";
    Object.assign(combo.values, { name: names[3], outputName: names[3] });
    combo.variants = [
      { title: "终态差异后继续收集正常对照", values: { name: names[4], outputName: names[4] } },
    ];
  }
  const casesFile = join(directory, "cases.json");
  const runFile = join(directory, "run.json");
  const execution = join(directory, "execution");
  await writeFile(casesFile, JSON.stringify(catalog, null, 2) + "\n");
  await writeFile(
    join(directory, "mismatch-fixture.json"),
    JSON.stringify(
      {
        revision: mismatchRevision,
        mode: c.terminalOnly ? "terminal-only" : "all",
        project,
        casesFile,
        names,
        evidence:
          "real-PinK-tasks; UI-changed-by-input; queued-and-terminal-observation-copies-controlled",
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
        caseIds: c.terminalOnly ? terminalMismatchIds : mismatchIds,
        port: c.port,
        results: execution,
        expectedPlan: join(directory, "plan.json"),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `差异自检目录：${directory}\n仅 UI 差异是真实界面变化；入队/终态为观察副本受控差异，不是产品参数缺陷。${c.terminalOnly ? "仅补验终态：预期一失败、一通过，两次真实提交。" : "预期三失败、两通过，四次真实提交。"}`,
  );
  const args = ["--run-config", runFile];
  assert.equal(
    await c.invoke(
      [...args, "--preview", "--preview-file", join(directory, "plan.json")],
      directory,
      "preview",
    ),
    0,
  );
  assert.equal(await c.invoke([...args, "--check-plan"], directory, "check-plan"), 0);
  let code: number;
  try {
    code = await c.invoke(
      args,
      directory,
      "execution",
      new URL("./developer-observation-fixture.js", import.meta.url).href,
    );
  } finally {
    for (const [path, hash] of before)
      assert.equal(await c.fingerprint(path), hash, `受保护文件变化：${path}；不覆盖用户数据恢复`);
  }
  assert.equal(code, 1, "正式执行器必须保留断言失败与非零退出码");
  const runs = (await readdir(execution, { withFileTypes: true })).filter((entry) =>
    entry.isDirectory(),
  );
  assert.equal(runs.length, 1, "只运行一次，不重试已通过项");
  await verifyMismatchResult(join(execution, runs[0].name, "result.json"));
}

async function verifyTerminalResult(
  file: string,
  result: ReturnType<typeof JSON.parse>,
  manifest: ReturnType<typeof JSON.parse>,
) {
  assert.equal(manifest.revision, mismatchRevision);
  assert.equal(result.outcome, "failed");
  assert.equal(result.failure, undefined);
  assert.deepEqual(
    result.cases.map((v: { caseId: string }) => v.caseId),
    terminalMismatchIds,
  );
  const [terminal, recovery] = result.cases;
  assert.equal(terminal.outcome, "failed");
  assert.equal(terminal.stage, "collect");
  assert.match(terminal.failure, /四组任务参数不一致：debug/);
  assert.equal(terminal.checks.queuedTaskOptions, true);
  assert.equal(terminal.checks.taskOptions, false);
  assert.equal(terminal.queuedTask.caseOptions.debug, true);
  assert.equal(terminal.task.caseOptions.debug, false);
  assert.equal(terminal.task.options.debug, true);
  assert.equal(terminal.task.state, "success");
  assert.equal(recovery.outcome, "passed");
  assert.equal(recovery.task.state, "success");
  assert.notEqual(terminal.task.id, recovery.task.id);
  for (const key of ["uiConfiguration", "queuedTaskOptions", "taskOptions", "uiSuccess"])
    assert.equal(recovery.checks[key], true);
  assert.ok(
    result.timeline.find(
      (v: { caseId: string; stage: string }) =>
        v.caseId === terminal.caseId && v.stage === "collect",
    ),
  );
  assert.equal(result.groups.length, 1);
  assert.equal(result.runtimeIdentity.project, manifest.project);
  assert.equal(result.planVerification.state, "matched");
  assert.equal(result.caseSource.revision, mismatchRevision);
  assert.equal(result.cleanup.taskMayStillBeRunning, false);
  const directory = dirname(dirname(dirname(file)));
  const ledger = (await readFile(join(directory, "injections.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((v) => JSON.parse(v));
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].phase, "terminal");
  assert.equal(ledger[0].source, "runner-observation-copy");
  assert.equal(ledger[0].original, true);
  assert.equal(ledger[0].injected, false);
  const reportFile = join(dirname(file), "report.html");
  const html = await readFile(reportFile, "utf8");
  for (const text of [
    "失败 1",
    "通过 1",
    terminal.caseId,
    terminal.task.id,
    "构建结果收集",
    "debug",
  ])
    assert.ok(html.includes(text));
  assert.ok(terminal.screenshotOmittedReason);
  assert.ok(html.includes(terminal.screenshotOmittedReason));
  console.log(
    `终态差异定向自检通过：入队先通过，终态差异正确报错，继续收集后续正常项。原结果保留一失败、一通过。\n结果：${file}\n报告：${reportFile}`,
  );
}

export async function verifyMismatchResult(file: string) {
  const runDirectory = dirname(file);
  const directory = dirname(dirname(runDirectory));
  const manifest = JSON.parse(await readFile(join(directory, "mismatch-fixture.json"), "utf8"));
  const result = JSON.parse(await readFile(file, "utf8"));
  if (manifest.mode === "terminal-only") {
    await verifyTerminalResult(file, result, manifest);
    return;
  }
  assert.equal(manifest.revision, mismatchRevision);
  assert.equal(result.outcome, "failed");
  assert.equal(result.failure, undefined, "不能有全局停止或未知状态");
  assert.equal(result.cases.length, 5);
  assert.deepEqual(
    result.cases.map((v: { caseId: string }) => v.caseId),
    mismatchIds,
  );
  assert.deepEqual(
    result.cases.map((v: { outcome: string }) => v.outcome),
    ["failed", "passed", "failed", "failed", "passed"],
  );
  const [ui, uiRecovery, queued, terminal, recovery] = result.cases;
  assert.match(ui.failure, /最终 UI 配置不一致：debug/);
  assert.equal(ui.stage, "configuration");
  assert.equal(ui.submittedAt, undefined);
  assert.equal(ui.task, undefined);
  for (const v of [queued, terminal]) {
    assert.match(v.failure, /四组任务参数不一致：debug/);
    assert.equal(v.task.state, "success", "真实构建成功也不能掩盖参数断言失败");
    assert.equal(v.finalized.values.debug, true);
    assert.equal(v.task.options.debug, true, "故障不得改写真实任务参数");
    assert.equal(v.task.caseOptions.debug, false);
  }
  assert.equal(queued.stage, "queued");
  assert.equal(queued.checks.queuedTaskOptions, false);
  assert.equal(terminal.stage, "collect");
  assert.equal(terminal.checks.queuedTaskOptions, true);
  assert.equal(terminal.queuedTask.caseOptions.debug, true);
  assert.equal(terminal.checks.taskOptions, false);
  for (const v of [uiRecovery, recovery]) {
    assert.equal(v.task.state, "success");
    for (const key of ["uiConfiguration", "queuedTaskOptions", "taskOptions", "uiSuccess"])
      assert.equal(v.checks[key], true);
  }
  assert.equal(result.groups.length, 3);
  assert.ok(result.groups[1].settledAt <= result.groups[2].startedAt, "失败组收尾后再进入下一组");
  assert.ok(queued.acceptedAt < terminal.submittedAt, "入队差异后仍继续下一项");
  const submitted = result.cases.filter((v: { task?: unknown }) => v.task);
  assert.equal(submitted.length, 4);
  assert.equal(new Set(submitted.map((v: { task: { id: string } }) => v.task.id)).size, 4);
  assert.equal(result.runtimeIdentity.project, manifest.project);
  assert.equal(result.planVerification.state, "matched");
  assert.equal(result.caseSource.revision, mismatchRevision);
  const ledger = (await readFile(join(directory, "injections.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  for (const phase of ["ui", "queued", "terminal"]) {
    const events = ledger.filter((v) => v.phase === phase);
    assert.equal(events.length, 1, `只注入一次并保留前后值：${phase}`);
    assert.equal(events[0].original, true);
    assert.equal(events[0].injected, false);
    if (phase !== "ui") assert.equal(events[0].source, "runner-observation-copy");
  }
  const reportFile = join(runDirectory, "report.html");
  const html = await readFile(reportFile, "utf8");
  for (const text of [
    "失败 3",
    "通过 2",
    "受阻 0",
    ui.caseId,
    queued.caseId,
    terminal.caseId,
    queued.task.id,
    terminal.task.id,
    "debug",
    "排队与参数核对",
    "构建结果收集",
  ])
    assert.ok(html.includes(text), `报告缺少 ${text}`);
  for (const v of [ui, queued, terminal]) {
    if (v.screenshot) {
      assert.equal(dirname(v.screenshot), ".");
      assert.ok((await stat(join(runDirectory, v.screenshot))).isFile());
      assert.ok(html.includes(encodeURIComponent(v.screenshot)));
    } else {
      assert.ok(v.screenshotOmittedReason);
      assert.ok(html.includes(v.screenshotOmittedReason));
    }
  }
  console.log(
    `三类差异自检通过：真实 UI 阻止提交，受控观察差异被正式比较器捕获，失败后及跨组继续正常，原结果保留三失败、两通过。\n结果：${file}\n报告：${reportFile}\n差异证据：${join(directory, "injections.jsonl")}`,
  );
}
