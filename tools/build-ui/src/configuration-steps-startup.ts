import { createStepBuildPort } from "./build-steps-runtime.js";
import { ConfigurationOperationError } from "./configuration-context.js";
import { readFile, realpath, stat, mkdir, writeFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { Browser } from "playwright-core";
import { Builder } from "./builder.js";
import { BuilderConfiguration } from "./configuration-runtime.js";
import { ExecutionContext } from "./configuration-context.js";
import {
  configurationStepsPlan,
  type LoadedConfigurationSteps,
} from "./configuration-steps-contract.js";
import { runConfigurationSteps, type ConfigurationStepCaseResult } from "./configuration-steps.js";
import { pinkExecutable } from "./offline-plan.js";
import { sealPlan, valueHash, contentHash } from "./plan-integrity.js";
import { startSession, findWindow, engineSelection } from "./session.js";
import { assertWindowIdentity } from "./workspace-identity.js";
import { waitFor, type Options } from "./common.js";
import { readForm, type FormView } from "./configuration-page.js";
import { writeResultReport } from "./result-report.js";

export async function configurationStepsLaunchPlan(
  loaded: LoadedConfigurationSteps,
  input: {
    pink: string;
    project: string;
    port: number;
    configurationTimeoutMs: number;
    resultsRoot: string;
  },
) {
  const steps = configurationStepsPlan(loaded);
  if (new Set(loaded.document.cases.map((c) => c.platform)).size !== 1)
    throw new Error("本批步骤启动一次仅操作一个平台，切换平台请使用另一份步骤文件");
  if (
    loaded.document.cases.some(
      (c) =>
        !["web-desktop", "web-mobile"].includes(c.platform) &&
        !loaded.document.targets?.some((target) => target.id === c.platform),
    )
  )
    throw new Error(
      "步骤启动需要 web-desktop、web-mobile 或文件中声明的新标准平台；其他平台保留原入口",
    );
  if (
    !Number.isInteger(input.port) ||
    input.port < 1024 ||
    input.port > 65535 ||
    !Number.isFinite(input.configurationTimeoutMs) ||
    input.configurationTimeoutMs < 1000
  )
    throw new Error("端口或配置超时无效");
  const pink = await pinkExecutable(input.pink),
    project = await realpath(resolve(input.project));
  const projectPackage = JSON.parse(await readFile(join(project, "package.json"), "utf8"));
  if (!projectPackage || typeof projectPackage !== "object" || Array.isArray(projectPackage))
    throw new Error("工程缺少有效 package.json");
  const productBytes = await readFile(join(dirname(pink), "resources/app/product.json"));
  const product = JSON.parse(productBytes.toString("utf8"));
  if (!(await stat(project)).isDirectory()) throw new Error("工程路径不是目录");
  return sealPlan({
    kind: "pink-configuration-steps-launch-plan",
    schemaVersion: 1,
    phase: "offline",
    runtimeVerified: false,
    buildSubmitted: false,
    startup: {
      pink,
      project,
      port: input.port,
      configurationTimeoutMs: input.configurationTimeoutMs,
      resultsRoot: resolve(input.resultsRoot),
      productSha256: contentHash(productBytes),
      version: product.pinkVersion as string | undefined,
      commit: product.commit as string | undefined,
    },
    steps,
  });
}
type LaunchPlan = Awaited<ReturnType<typeof configurationStepsLaunchPlan>>;

export async function verifyConfigurationStepsPlan(file: string, current: LaunchPlan) {
  const value = JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("步骤预期计划格式无效");
  const { integrity, ...body } = value;
  if (
    body.kind !== current.kind ||
    body.schemaVersion !== 1 ||
    integrity?.algorithm !== "sha256" ||
    valueHash(body) !== integrity.sha256 ||
    current.integrity.sha256 !== integrity.sha256
  )
    throw new Error("步骤文件、程序、工程或启动条件与预览计划不符，请重新预览");
}

async function fileHash(file: string) {
  try {
    return contentHash(await readFile(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
function formValues(view: FormView) {
  return {
    fields: view.fields
      .map((f) => ({
        key: f.key,
        controls: f.controls.map((c) => ({ type: c.type, value: c.value })),
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    custom: view.unkeyedFields
      .map((f) => ({
        label: f.label,
        controls: f.controls.map((c) => ({ type: c.type, value: c.value })),
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}

/** Config-only startup using the existing verified session, Builder and operation adapters. */
export async function runConfigurationStepsFromStartup(
  loaded: LoadedConfigurationSteps,
  plan: LaunchPlan,
) {
  const v2 = loaded.document.schemaVersion === 2;
  let buildRuntime: Awaited<ReturnType<typeof createStepBuildPort>> | undefined;
  const options: Options = {
    pink: plan.startup.pink,
    project: plan.startup.project,
    port: plan.startup.port,
    configurationTimeoutMs: plan.startup.configurationTimeoutMs,
    timeoutMs: 600_000,
    queueTimeoutMs: 1_800_000,
    resultsRoot: plan.startup.resultsRoot,
  };
  const directory = join(
    options.resultsRoot,
    new Date().toISOString().replaceAll(":", "-") + "-steps",
  );
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "plan.json"), JSON.stringify(plan, null, 2));
  const abort = new AbortController();
  const stop = () => abort.abort(new Error("用户中止配置步骤"));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let browser: Browser | undefined,
    builder: Builder | undefined,
    session: ExecutionContext | undefined;
  let baseline: ReturnType<typeof formValues> | undefined;
  const warnings: string[] = [];
  const protectedFiles = {
    tasks: join(options.project, "temp/pink-builder/tasks.json"),
    globalSettings: join(homedir(), ".pink/settings.json"),
    projectSettings: join(options.project, ".pink/settings.json"),
  };
  const hashes = async () =>
    Object.fromEntries(
      await Promise.all(
        Object.entries(protectedFiles).map(async ([key, file]) => [key, await fileHash(file)]),
      ),
    );
  const before = await hashes();
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const executorFiles = await Promise.all(
    (await readdir(moduleDirectory))
      .filter((name) => name.endsWith(".js") && !name.endsWith(".test.js"))
      .sort()
      .map(async (name) => [name, await fileHash(join(moduleDirectory, name))]),
  );
  const data: Record<string, unknown> = {
    kind: "pink-configuration-steps-result",
    schemaVersion: loaded.document.schemaVersion,
    runId: directory,
    sourceSha256: loaded.sourceSha256,
    documentSha256: loaded.documentSha256,
    executorSha256: valueHash(executorFiles),
    executorFiles,
    planSha256: plan.integrity.sha256,
    project: options.project,
    pink: { path: options.pink, version: plan.startup.version, commit: plan.startup.commit },
    configuredEngine: await engineSelection(options.project),
    evidenceKind: "runtime",
    buildSubmitted: false,
    startedAt: new Date().toISOString(),
    outcome: "failed",
    warnings,
    cases: loaded.document.cases.map((c) => ({
      caseId: c.caseId,
      platform: c.platform,
      outcome: "not-run",
    })),
  };
  try {
    const connection = await startSession(options, abort.signal, (info) => {
      data.launch = info;
    });
    browser = connection.browser;
    const page = await findWindow(browser, options.project, abort.signal, options.pink);
    const identity = await assertWindowIdentity(page, options.project, options.pink);
    data.runtimeIdentity = identity;
    session = new ExecutionContext(identity, () =>
      assertWindowIdentity(page, options.project, options.pink),
    );
    const target = loaded.document.targets?.find((p) => p.id === loaded.document.cases[0].platform);
    const category = target?.category ?? "X-Device";
    await waitFor(
      "工程构建分类就绪",
      async () =>
        (await page.getByRole("tab", { name: category, exact: true }).count()) === 1
          ? true
          : undefined,
      180_000,
      abort.signal,
    );
    builder = await Builder.open(
      page,
      connection.endpoint,
      abort.signal,
      category,
      options.configurationTimeoutMs,
    );
    if (v2 && loaded.document.cases.some((c) => c.steps.some((s) => s.op === "build.submit"))) {
      const keys = loaded.document.cases.flatMap((c) =>
        c.steps.flatMap((s) => (s.op === "read" ? s.fields : [])),
      );
      buildRuntime = await createStepBuildPort(
        builder,
        session,
        options.project,
        keys,
        abort.signal,
      );
    }
    const result = await runConfigurationSteps(loaded, {
      session,
      evidenceKind: "runtime",
      build: buildRuntime?.port,
      closeConfiguration: async (operations) => {
        if (!(operations instanceof BuilderConfiguration))
          throw new Error("关闭操作缺少真实页面适配");
        await operations.close();
      },
      captureFailure: async (caseId, step) => {
        await session!.verify();
        const identity = await assertWindowIdentity(page, options.project, options.pink);
        const view = await builder!.caseDom(readForm);
        const stem = `${caseId}-${step.stepId}-failure`;
        const scene = `${stem}.json`;
        await writeFile(
          join(directory, scene),
          JSON.stringify(
            { capturedAt: new Date().toISOString(), identity, view, diagnostic: step.diagnostic },
            null,
            2,
          ),
        );
        if (
          [...view.fields, ...view.unkeyedFields].some((f) =>
            f.controls.some((control) => control.redacted),
          )
        )
          return { scene, unavailable: "页面含敏感控件，仅保存脱敏 DOM 现场，不截图" };
        const screenshot = `${stem}.png`;
        try {
          await page.screenshot({ path: join(directory, screenshot), timeout: 5000 });
          return { screenshot, scene };
        } catch {
          return { scene, unavailable: "失败瞬间截图不可用，脱敏 DOM 现场已保留" };
        }
      },
      openConfiguration: async (platform) => {
        console.log(`[steps] 打开配置：${platform}`);
        if (v2 && (await builder!.caseDom(readForm)).state === "form")
          throw new ConfigurationOperationError(
            "context",
            "已有未归属配置页，拒绝隐式关闭或接管",
            "stop",
          );
        const form = await BuilderConfiguration.open(
          builder!,
          session!,
          platform,
          abort.signal,
          target,
        );
        if (v2) return form;
        const current = formValues(await builder!.configurationPage());
        if (!baseline) {
          baseline = current;
          data.configurationBefore = baseline;
        } else if (valueHash(current) !== valueHash(baseline))
          throw new Error("上一项结束后配置与运行初态不符，停止后续输入");
        return form;
      },
    });
    Object.assign(data, result);
    const cases = result.cases;
    const safe = cases.every((c) =>
      ["passed", "not-required", "not-recorded"].includes(c.restoration),
    );
    if (v2) {
      const recorded = cases.filter(
        (c) => !["not-required", "not-recorded"].includes(c.restoration),
      );
      if (recorded.length)
        data.configurationRestored = recorded.every((c) => c.restoration === "passed");
    }
    if (!v2 && safe && baseline) {
      await session.verify();
      const after = formValues(await builder.configurationPage());
      data.configurationAfter = after;
      data.configurationRestored = valueHash(baseline) === valueHash(after);
      if (!data.configurationRestored) throw new Error("最终配置与原配置不一致，保留现场");
      await page
        .screenshot({ path: join(directory, "restored.png"), timeout: 5000 })
        .catch(() => warnings.push("最终恢复现场截图不可用"));
      for (const c of cases as Array<
        ConfigurationStepCaseResult & { screenshotOmittedReason?: string }
      >)
        c.screenshotOmittedReason = "配置步骤未截图断言瞬间；最终恢复现场为同目录 restored.png";
      // A policy stop after successful recovery is safe to close; hard failures retain the page.
      if (!result.stopped || cases.some((c) => c.stopReason?.code === "case-policy"))
        await builder.closeConfiguration(() => session!.verify());
    }
  } catch (error) {
    data.fatal = error instanceof Error ? error.message : "步骤启动或收尾失败";
    data.outcome = "failed";
  } finally {
    await buildRuntime?.stop().catch(() => warnings.push("任务观察器停止失败"));
    session?.invalidate();
    await builder?.close().catch(() => warnings.push("Builder 连接释放失败"));
    await browser?.close().catch(() => warnings.push("浏览器调试连接释放失败"));
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    const after = await hashes();
    data.protectedFiles = { before, after, unchanged: valueHash(before) === valueHash(after) };
    const engineUnchanged =
      before.globalSettings === after.globalSettings &&
      before.projectSettings === after.projectSettings;
    data.engineSettingsUnchanged = engineUnchanged;
    const tasksExpectedToChange = v2 && data.buildAttempted === true;
    if (!engineUnchanged || (!tasksExpectedToChange && before.tasks !== after.tasks)) {
      data.outcome = "failed";
      warnings.push("任务文件存在非预期变化或引擎设置改变，需要核查");
    }
    data.finishedAt = new Date().toISOString();
    await writeFile(join(directory, "result.json"), JSON.stringify(data, null, 2));
    console.log(`结果：${join(directory, "result.json")}`);
    console.log(`报告：${await writeResultReport(join(directory, "result.json"))}`);
  }
  return { directory, outcome: data.outcome };
}
