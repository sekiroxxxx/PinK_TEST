import { createStepBuildPort } from "./build-steps-runtime.js";
import { ConfigurationOperationError } from "./configuration-context.js";
import { readFile, realpath, stat, mkdir, writeFile, readdir } from "node:fs/promises";
import { ExecutionStop, checkExecutionStop } from "./execution-stop.js";
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
import { type Options } from "./common.js";
import { readForm, type FormView } from "./configuration-page.js";
import { createResultCheckpoint, type CheckpointWriteError } from "./result-checkpoint.js";
import { platformCatalog, platformEntry } from "./platform-catalog.js";
import { catalogStepResults } from "./catalog-steps-loader.js";
import { configurationErrorDetail } from "./configuration-diagnostics.js";
import { buildRunProgress, createProgressOutput } from "./run-progress.js";
import { readBuilderHome } from "./builder-checks.js";
import {
  discoverBuilderRoutes,
  resolvePlatformRoute,
  type DiscoveredBuilder,
} from "./builder-routing.js";

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
  if (
    loaded.document.schemaVersion === 1 &&
    new Set(loaded.document.cases.map((c) => c.platform)).size !== 1
  )
    throw new Error("v1 步骤启动一次仅操作一个平台；跨平台调度请使用 v2");
  if (
    loaded.document.cases.some(
      (c) =>
        !("target" in c && c.target?.kind === "builder") &&
        !["web-desktop", "web-mobile"].includes(c.platform!) &&
        !(
          loaded.document.schemaVersion === 2 && platformCatalog.some((p) => p.id === c.platform)
        ) &&
        !loaded.document.targets?.some((target) => target.id === c.platform),
    )
  )
    throw new Error("步骤启动需要已适配平台或文件中声明的新标准平台");
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
  if (loaded.inputs?.preview.project && loaded.inputs.preview.project !== project)
    throw new Error("步骤场景与启动工程不一致，请重新加载步骤文件");
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
  stopControl?: ExecutionStop,
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
  const stop = stopControl ?? new ExecutionStop().listen();
  const startupSignal = AbortSignal.any([abort.signal, stop.signal]);
  let browser: Browser | undefined,
    builder: Builder | undefined,
    session: ExecutionContext | undefined;
  const builders = new Map<string, Builder>();
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
    buildAttempted: false,
    ...(loaded.catalog ? { catalog: loaded.catalog } : {}),
    startedAt: new Date().toISOString(),
    outcome: "incomplete",
    lifecycle: "running",
    phase: "preflight",
    processes: { workerPid: process.pid, supervisorPid: process.ppid },
    warnings,
    cases: loaded.catalog
      ? catalogStepResults(loaded, [])
      : loaded.document.cases.map((c) => ({
          caseId: c.caseId,
          platform: c.platform,
          ...("target" in c && c.target ? { target: c.target } : {}),
          outcome: "not-run",
          steps: [],
        })),
  };
  const checkpointWarning = (error: CheckpointWriteError) => {
    if (!warnings.includes("运行检查点写出失败")) warnings.push("运行检查点写出失败");
    const errors = (data.checkpointErrors ??= []) as unknown[];
    errors.push({
      ...configurationErrorDetail(error),
      phase: error.phase,
      systemCode: error.systemCode,
    });
  };
  const checkpoint = createResultCheckpoint(join(directory, "result.json"), checkpointWarning);
  const outputProgress = createProgressOutput();
  let sequence = 0;
  const publish = async (render = false) => {
    const progress = buildRunProgress(loaded, data, ++sequence);
    data.progress = progress;
    await checkpoint.publish(data, render);
    outputProgress(progress);
  };
  const unsubscribe = stop.subscribe(() => {
    data.interruption = stop.requestInfo;
    data.lifecycle = "stopping";
    void publish(true).catch(() => {}); // The publisher records the error before draining.
  });
  try {
    await publish(true);
    console.log(`运行结果：${join(directory, "result.json")}`);
    checkExecutionStop(stop.signal);
    await loaded.verifySource?.();
    await loaded.inputs?.verify();
    if (!loaded.document.cases.length) {
      data.evidenceKind = "offline-preflight";
      throw new ConfigurationOperationError(
        "precondition",
        "所选用例均受阻或不适用，未启动或连接 PinK",
        "blocked",
      );
    }
    data.phase = "connecting";
    await publish();
    const connection = await startSession(options, startupSignal, (info) => {
      data.launch = info;
    });
    browser = connection.browser;
    const page = await findWindow(browser, options.project, startupSignal, options.pink);
    const identity = await assertWindowIdentity(page, options.project, options.pink);
    data.runtimeIdentity = identity;
    session = new ExecutionContext(identity, () =>
      assertWindowIdentity(page, options.project, options.pink),
    );
    const descriptor = (platform: string) =>
      loaded.document.targets?.find((p) => p.id === platform) ?? platformEntry(platform);
    data.phase = "connecting";
    await publish();
    const observations = new Map<string, unknown>();
    const discovery = await discoverBuilderRoutes(
      page,
      connection.endpoint,
      session,
      startupSignal,
      options.configurationTimeoutMs,
      async (binding) => {
        builder = binding.builder;
        builders.set(binding.entry.key, binding.builder);
        observations.set(binding.entry.key, { entry: binding.entry, home: binding.home });
        data.entryDiscovery = { entries: [...observations.values()] };
        await publish();
      },
      abort.signal,
    );
    const routes = new Map<string, ReturnType<typeof resolvePlatformRoute>>();
    const probeScopes = new Map<string, DiscoveredBuilder>();
    const unsupported = new Map<string, ConfigurationOperationError>();
    for (const platform of new Set(
      loaded.document.cases.flatMap((c) => (c.platform ? [c.platform] : [])),
    )) {
      try {
        routes.set(platform, resolvePlatformRoute(discovery.bindings, descriptor(platform)));
      } catch (error) {
        if (!(error instanceof ConfigurationOperationError) || error.disposition !== "blocked")
          throw error;
        const target = loaded.document.targets?.find((target) => target.id === platform);
        const onlyProbe = loaded.document.cases
          .filter((c) => c.platform === platform)
          .every((c) => c.steps.every((s) => s.op === "platform.probe" || s.op === "assert"));
        const readyLabels = target?.homeScope?.readyLabels;
        const scopes =
          onlyProbe && readyLabels?.length
            ? discovery.bindings.filter(
                (binding) =>
                  binding.home.complete &&
                  readyLabels.every(
                    (label) =>
                      binding.home.cards.filter((card) => card.label === label).length === 1,
                  ),
              )
            : [];
        if (scopes.length === 1) {
          probeScopes.set(platform, scopes[0]);
          continue;
        }
        unsupported.set(platform, error);
      }
    }
    data.runtimeCapabilities = [
      ...new Set(loaded.document.cases.flatMap((c) => (c.platform ? [c.platform] : []))),
    ].map((platform) => ({
      platform,
      kind: "execution-support",
      status: unsupported.has(platform) ? "blocked" : "ready",
      ...(unsupported.has(platform)
        ? { reason: unsupported.get(platform)!.message }
        : { entry: (routes.get(platform)?.binding ?? probeScopes.get(platform))!.entry }),
    }));
    await publish();
    const routeFor = (platform: string) => {
      const route = routes.get(platform);
      if (!route)
        throw (
          unsupported.get(platform) ??
          new ConfigurationOperationError("context", "平台缺少已核对的运行时入口", "stop")
        );
      return route;
    };
    const activateBinding = async (binding: DiscoveredBuilder) => {
      await discovery.activate(binding);
      builder = binding.builder;
    };
    // Legacy public scopes remain logical scopes. Infer their unique entry from actual members;
    // platform cases never use a persisted category title to navigate.
    const publicBinding = (category: string) => {
      const direct = discovery.bindings.filter(
        (binding) => binding.entry.label === category || binding.home.categoryId === category,
      );
      const members = platformCatalog
        .filter((platform) => platform.category === category)
        .flatMap((platform) => {
          try {
            return [resolvePlatformRoute(discovery.bindings, platform).binding];
          } catch (error) {
            if (error instanceof ConfigurationOperationError && error.disposition === "blocked")
              return [];
            throw error;
          }
        });
      const candidates = [...new Set(direct.length ? direct : members)];
      if (candidates.length !== 1)
        throw new ConfigurationOperationError(
          "context",
          "公共构建目标无法对应唯一的运行时入口",
          "stop",
          {
            diagnostic: {
              phase: "entry-discovery",
              observations: { category, entries: candidates.map((binding) => binding.entry) },
            },
          },
        );
      return candidates[0];
    };
    if (
      v2 &&
      loaded.document.cases.some((c) =>
        c.steps.some((s) => s.op === "build.submit" || s.op.startsWith("stage.")),
      )
    ) {
      const keys = loaded.document.cases.flatMap((c) =>
        c.steps.flatMap((s) => ("fields" in s ? s.fields : "field" in s ? [s.field] : [])),
      );
      buildRuntime = await createStepBuildPort(
        discovery.bindings.map((binding) => ({
          builder: binding.builder,
          platforms: [...routes]
            .filter(([, route]) => route.binding === binding)
            .map(([platform]) => platform),
          activate: () => activateBinding(binding),
        })),
        session,
        options.project,
        keys,
        abort.signal,
      );
    } else if (v2 && loaded.document.cases.some((c) => c.platform === "openpaas"))
      if (routes.has("openpaas")) await routeFor("openpaas").binding.builder.installProbe([], true);
    data.phase = "executing";
    await publish();
    const result = await runConfigurationSteps(loaded, {
      stopSignal: stop.signal,
      onProgress: async (progress) => {
        Object.assign(data, progress, { cases: catalogStepResults(loaded, progress.cases) });
        await publish().catch(() => {}); // Keep recovery running; the publisher retains diagnostics.
      },
      session,
      verifySource: loaded.verifySource,
      evidenceKind: "runtime",
      build: buildRuntime?.port,
      checkCapabilities: async (operations, steps) => {
        if (!(operations instanceof BuilderConfiguration))
          throw new Error("缺少运行时配置能力检查适配");
        return operations.checkCapabilities(steps);
      },
      builderUi: {
        open: async (target) => {
          await session!.verify();
          await activateBinding(publicBinding(target.category));
          if ((await builder!.caseDom(readForm)).state !== "awaiting-dialog")
            throw new ConfigurationOperationError(
              "context",
              "公共检查不能接管已有配置弹窗",
              "stop",
            );
          await builder!.home(() => session!.verify());
        },
        read: async (target) => {
          await session!.verify();
          if (builder !== publicBinding(target.category).builder)
            throw new ConfigurationOperationError("context", "公共检查所在分类已经改变", "stop");
          return { category: target.category, ...(await builder!.caseDom(readBuilderHome)) };
        },
        home: async (target) => {
          await session!.verify();
          await activateBinding(publicBinding(target.category));
          if ((await builder!.caseDom(readForm)).state !== "awaiting-dialog")
            throw new ConfigurationOperationError(
              "context",
              "公共检查收尾时出现外来配置弹窗",
              "stop",
            );
          await builder!.home(() => session!.verify());
        },
      },
      probePlatform: async (platform) => {
        await session!.verify();
        if ((await builder!.caseDom(readForm)).state !== "awaiting-dialog")
          throw new ConfigurationOperationError("context", "平台探查不能接管已有配置页", "stop");
        const route = routes.get(platform);
        await activateBinding(
          route?.binding ?? probeScopes.get(platform) ?? routeFor(platform).binding,
        );
        await builder!.home(() => session!.verify());
        const target = loaded.document.targets?.find((t) => t.id === platform);
        const observed = await builder!.probePlatform(
          route?.card.label ?? descriptor(platform).label,
          target?.homeScope?.readyLabels,
        );
        await session!.verify();
        return observed;
      },
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
        const route = routeFor(platform);
        await activateBinding(route.binding);
        const target = loaded.document.targets?.find((p) => p.id === platform);
        const form = await BuilderConfiguration.open(
          builder!,
          session!,
          platform,
          abort.signal,
          target,
          route.card.label,
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
    if (loaded.catalog) {
      data.catalog = loaded.catalog;
      data.cases = catalogStepResults(loaded, result.cases);
      data.outcome = (data.cases as ConfigurationStepCaseResult[]).every(
        (c) => c.outcome === "passed" || c.outcome === "not-applicable",
      )
        ? "passed"
        : "failed";
    }
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
      const after = formValues(await builder!.configurationPage());
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
        await builder!.closeConfiguration(() => session!.verify());
    }
  } catch (error) {
    data.fatal = error instanceof Error ? error.message : "步骤启动或收尾失败";
    data.fatalDiagnostic = configurationErrorDetail(error);
    data.outcome = "failed";
  } finally {
    data.phase = "cleanup";
    await publish().catch(() => {});
    const cleanup: Array<{
      resource: string;
      outcome: "passed" | "failed";
      reason?: string;
      diagnostic?: ReturnType<typeof configurationErrorDetail>;
    }> = [];
    data.cleanup = cleanup;
    const release = async (resource: string, action: () => Promise<void>) => {
      try {
        await action();
        cleanup.push({ resource, outcome: "passed" });
      } catch (error) {
        const diagnostic = configurationErrorDetail(error);
        cleanup.push({
          resource,
          outcome: "failed",
          reason: diagnostic.chain[0]?.message ?? "资源释放失败，不能计收尾通过",
          diagnostic,
        });
        warnings.push(`${resource}释放失败`);
        data.outcome = "failed";
      }
    };
    if (buildRuntime) await release("task-observer", () => buildRuntime!.stop());
    session?.invalidate();
    for (const [category, observer] of builders)
      await release(`builder-probe:${category}`, () => observer.close());
    if (browser) await release("browser-connection", () => browser!.close());
    unsubscribe();
    await checkpoint.drain();
    if (!stopControl) stop.dispose();
    const after = await hashes().catch(() => undefined);
    data.protectedFiles = {
      before,
      after,
      unchanged: !!after && valueHash(before) === valueHash(after),
    };
    const engineUnchanged =
      !!after &&
      before.globalSettings === after.globalSettings &&
      before.projectSettings === after.projectSettings;
    data.engineSettingsUnchanged = engineUnchanged;
    const tasksExpectedToChange = v2 && data.buildAttempted === true;
    if (!engineUnchanged || (!tasksExpectedToChange && before.tasks !== after?.tasks)) {
      data.outcome = "failed";
      warnings.push("任务文件存在非预期变化或引擎设置改变，需要核查");
    }
    if (stop.requestInfo) {
      data.interruption = stop.requestInfo;
      data.outcome = "failed";
      data.stopped = true;
    }
    data.lifecycle = "finished";
    data.phase = "finished";
    data.finishedAt = new Date().toISOString();
    await publish(true);
    console.log(`结果：${join(directory, "result.json")}`);
    console.log(`报告：${join(directory, "report.html")}`);
  }
  return { directory, outcome: data.outcome };
}
