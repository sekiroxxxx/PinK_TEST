import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { contentHash } from "./plan-integrity.js";
import { readRunConfiguration } from "./offline-plan.js";
import { runMismatchSelfcheck, verifyMismatchResult } from "./developer-mismatch-selfcheck.js";
import {
  runSubmissionSelfcheck,
  verifySubmissionResult,
} from "./developer-submission-selfcheck.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
const fixture = join(root, "tools/build-ui/fixtures/failure-continuation");
const failureId = "developer.failure.web-desktop";
const recoveryId = `${failureId}.variant-1`;
const marker = "selfcheck-output-blocker";

async function fingerprint(path: string) {
  return readFile(path)
    .then(contentHash)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
}

async function invoke(args: string[], directory: string, label: string, preload?: string) {
  const log = createWriteStream(join(directory, `${label}.log`), { flags: "wx" });
  const child = spawn(process.execPath, [...(preload ? ["--import", preload] : []), cli, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const pipe of [child.stdout, child.stderr])
    pipe.on("data", (chunk: Buffer) => {
      log.write(chunk);
      process.stdout.write(chunk);
    });
  try {
    return await new Promise<number>((resolveCode, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => {
        if (signal || code === null) reject(new Error(`执行器被信号中断：${signal}`));
        else resolveCode(code);
      });
    });
  } finally {
    await new Promise<void>((done) => log.end(done));
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      pink: { type: "string" },
      port: { type: "string", default: "9222" },
      "verify-result": { type: "string" },
      mismatches: { type: "boolean" },
      "mismatch-terminal-only": { type: "boolean" },
      project: { type: "string" },
      "verify-mismatches": { type: "string" },
      "submission-ambiguity": { type: "string" },
      "verify-submission": { type: "string" },
    },
  });
  const executionModes = [
    values.mismatches,
    values["mismatch-terminal-only"],
    values["submission-ambiguity"],
  ].filter(Boolean);
  const verificationModes = [
    values["verify-result"],
    values["verify-mismatches"],
    values["verify-submission"],
  ].filter(Boolean);
  if (
    executionModes.length > 1 ||
    verificationModes.length > 1 ||
    (verificationModes.length && (executionModes.length || values.pink || values.project))
  )
    throw new Error("开发自检执行/只读复核模式不能混用");
  if (values["verify-submission"]) {
    await verifySubmissionResult(resolve(values["verify-submission"]));
    return;
  }
  if (values.mismatches && values["mismatch-terminal-only"])
    throw new Error("三类完整自检与终态定向补验不能同时选择");
  if (values["verify-mismatches"]) {
    if (
      values.pink ||
      values.project ||
      values.mismatches ||
      values["mismatch-terminal-only"] ||
      values["verify-result"]
    )
      throw new Error("只读差异复核不能混用执行参数");
    await verifyMismatchResult(resolve(values["verify-mismatches"]));
    return;
  }
  if (values["verify-result"]) {
    if (values.pink || values.project || values.mismatches || values["mismatch-terminal-only"])
      throw new Error("只读复核不能混用启动或差异自检参数");
    const file = resolve(values["verify-result"]);
    const config = await readRunConfiguration(join(dirname(dirname(dirname(file))), "run.json"));
    assert.ok(config.project);
    console.log("只读复核现有开发自检结果；不连接 PinK、不提交构建、不改写原始报告。");
    await verifyResult(file, config.project);
    return;
  }
  if (!values.pink)
    throw new Error(
      "需要 --pink <PinK.exe 或安装目录>；默认目录失败自检，--mismatches 选择三类差异，--mismatch-terminal-only 仅补验终态",
    );
  if (process.platform !== "win32") throw new Error("当前开发自检入口仅用于 Windows");
  if (values["submission-ambiguity"]) {
    await runSubmissionSelfcheck({
      root,
      fixture,
      pink: values.pink,
      project: values.project,
      port: Number(values.port),
      mode: values["submission-ambiguity"],
      invoke,
      fingerprint,
    });
    return;
  }
  if (values.mismatches || values["mismatch-terminal-only"]) {
    await runMismatchSelfcheck({
      root,
      fixture,
      pink: values.pink,
      project: values.project,
      port: Number(values.port),
      terminalOnly: values["mismatch-terminal-only"],
      invoke,
      fingerprint,
    });
    return;
  }
  if (values.project) throw new Error("project 仅用于复用已确认的独立差异自检工程");
  const results = join(root, "results");
  await mkdir(results, { recursive: true });
  const directory = await mkdtemp(join(results, "developer-selfcheck-"));
  const project = join(directory, "project");
  await cp(join(fixture, "project"), project, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  await writeFile(
    join(project, marker),
    "Intentional regular file: the first build must fail creating a child directory.\n",
    { flag: "wx" },
  );
  const casesFile = join(directory, "cases.json");
  await cp(join(fixture, "cases.json"), casesFile, { errorOnExist: true, force: false });
  const runFile = join(directory, "run.json");
  const planFile = join(directory, "plan.json");
  const execution = join(directory, "execution");
  await writeFile(
    runFile,
    JSON.stringify(
      {
        schemaVersion: 1,
        pink: resolve(values.pink),
        project,
        casesFile,
        groups: "publish",
        caseIds: [failureId, recoveryId],
        port: Number(values.port),
        results: execution,
        expectedPlan: planFile,
      },
      null,
      2,
    ) + "\n",
  );
  const config = await readRunConfiguration(runFile);
  assert.equal(config.project, project);
  const sceneFile = join(project, "assets/selfcheck.scene");
  const sceneHash = await fingerprint(sceneFile);
  const globalSettings = join(homedir(), ".pink/settings.json");
  const settingsBefore = await fingerprint(globalSettings);
  const args = ["--run-config", runFile];
  console.log(`开发自检目录：${directory}\n预期原始构建结果：失败 1、通过 1；不是全部构建通过。`);
  assert.equal(
    await invoke([...args, "--preview", "--preview-file", planFile], directory, "preview"),
    0,
    "离线预览不应受阻",
  );
  assert.equal(await invoke([...args, "--check-plan"], directory, "check-plan"), 0);
  let exitCode: number;
  try {
    exitCode = await invoke(args, directory, "execution");
  } finally {
    assert.equal(
      await fingerprint(globalSettings),
      settingsBefore,
      "全局设置文件发生变化，请核查；自检不恢复或覆盖用户设置",
    );
    assert.equal(await fingerprint(sceneFile), sceneHash, "测试期间场景源文件发生变化");
  }
  assert.equal(exitCode, 1, "原执行器必须保留真实构建失败和非零退出码");
  const runs = await readdir(execution, { withFileTypes: true });
  const runDirs = runs.filter((entry) => entry.isDirectory());
  assert.equal(runDirs.length, 1, "只允许一次真实链路运行，不重试掩盖失败");
  const runDirectory = join(execution, runDirs[0].name);
  const resultFile = join(runDirectory, "result.json");
  await verifyResult(resultFile, project);
}

async function verifyResult(resultFile: string, project: string) {
  const runDirectory = dirname(resultFile);
  const result = JSON.parse(await readFile(resultFile, "utf8"));
  assert.equal(result.outcome, "failed");
  assert.equal(result.failure, undefined, "不应有运行级致命错误");
  assert.equal(result.cases.length, 2);
  const [failed, passed] = result.cases;
  assert.equal(failed.caseId, failureId);
  assert.equal(passed.caseId, recoveryId);
  assert.equal(failed.platform, "web-desktop");
  assert.equal(passed.platform, "web-desktop");
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.task?.state, "failure");
  assert.equal(failed.checks.uiConfiguration, true);
  assert.equal(failed.checks.queuedTaskOptions, true);
  assert.match(failed.task.message, new RegExp(marker));
  assert.match(failed.task.message, /EEXIST|ENOTDIR|ENOENT|not a directory|mkdir/i);
  assert.ok(failed.failure.includes(failed.task.message), "诊断必须保留本次真实任务错误");
  assert.ok(failed.task.id && passed.task?.id && failed.task.id !== passed.task.id);
  assert.equal(passed.outcome, "passed");
  assert.equal(passed.task.state, "success");
  for (const key of ["uiConfiguration", "queuedTaskOptions", "taskOptions", "uiSuccess"])
    assert.equal(passed.checks[key], true, `后续成功用例缺少核对：${key}`);
  assert.ok(
    failed.task.observation?.terminalAt <= passed.submittedAt,
    "必须先观察到第一项终态，再提交正常用例",
  );
  assert.equal(result.runtimeIdentity.project, project);
  assert.equal(result.planVerification.state, "matched");
  // Configuration keeps the text input; finalized values and tasks keep its project protocol.
  assert.equal(failed.finalConfiguration.buildPath, `${marker}/build`);
  assert.equal(passed.finalConfiguration.buildPath, "build");
  assert.equal(failed.finalized.values.buildPath, `project://${marker}/build`);
  assert.equal(passed.finalized.values.buildPath, "project://build");
  assert.ok((await stat(join(project, marker))).isFile(), "故障材料不可被构建替换或删除");
  const reportFile = join(runDirectory, "report.html");
  const report = await readFile(reportFile, "utf8");
  for (const text of ["失败 1", "通过 1", failed.caseId, failed.task.id, marker])
    assert.ok(report.includes(text), `报告缺少：${text}`);
  if (failed.screenshot) {
    assert.equal(dirname(failed.screenshot), ".");
    assert.ok((await stat(join(runDirectory, failed.screenshot))).isFile());
    assert.ok(report.includes(encodeURIComponent(failed.screenshot)), "报告未关联失败截图");
  } else {
    assert.ok(failed.screenshotOmittedReason, "无截图时必须提供明确原因");
    assert.ok(report.includes(failed.screenshotOmittedReason), "报告缺少截图省略原因");
  }
  console.log(
    `开发自检通过：真实构建失败已捕获，观察失败后继续构建成功，报告汇总正确。\n原结果：${resultFile}\n原报告：${reportFile}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
