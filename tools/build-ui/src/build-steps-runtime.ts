import type { Builder } from "./builder.js";
import { ExecutionContext, ConfigurationOperationError } from "./configuration-context.js";
import { configurationEqual } from "./configuration-operations.js";
import { discoverScenes } from "./case-inputs.js";
import { TaskObserver } from "./task-observer.js";
import { waitFor } from "./common.js";
import { fieldFingerprint } from "./existing-platforms.js";
import { sensitiveConfigurationField } from "./configuration-steps-contract.js";
import type { BuildStepsPort } from "./build-steps.js";
import { stepObservationFields, platformBuildFields } from "./configuration-step-values.js";
import { assertBuildOnly } from "./configuration-stages.js";
import { readStageUi } from "./stage-ui.js";

export interface StepBuilderBinding {
  builder: Builder;
  platforms: string[];
  entryKey?: string;
  activate?(): Promise<void>;
}

export async function createStepBuildPort(
  builder: Builder | StepBuilderBinding[],
  session: ExecutionContext,
  project: string,
  fields: string[],
  signal: AbortSignal,
  platform?: string,
) {
  if (Array.isArray(builder) && !builder.length) throw new Error("缺少构建分类适配");
  const bindings = Array.isArray(builder)
    ? builder.filter((binding) => binding.platforms.length > 0)
    : [{ builder, platforms: platform ? [platform] : [] }];
  const platformBuilders = new Map<string, Builder>();
  for (const binding of bindings)
    for (const id of binding.platforms) {
      if (platformBuilders.has(id)) throw new Error(`平台重复绑定构建分类：${id}`);
      platformBuilders.set(id, binding.builder);
    }
  const forPlatform = (id: string) => {
    const selected =
      platformBuilders.get(id) ??
      (bindings.length === 1 && bindings[0].platforms.length === 0
        ? bindings[0].builder
        : undefined);
    if (!selected)
      throw new ConfigurationOperationError("context", "目标平台缺少构建分类适配", "stop");
    return selected;
  };
  const required = ["name", "buildPath", "outputName", "startScene", "scenes", "debug"];
  const keys = [
    ...new Set([
      ...required,
      ...fields,
      ...(platformBuilders.size
        ? [...platformBuilders.keys()].flatMap(platformBuildFields)
        : [...platformBuildFields("openpaas"), ...platformBuildFields("huawei-agc")]),
    ]),
  ];
  const scenes = await discoverScenes(project);
  await session.verify();
  const baselineIds = new Set<string>();
  let initialIds: string | undefined;
  const initialization: Array<{ phase: string; entryKey?: string; platforms: string[] }> = [];
  const prepare = async <T>(
    binding: StepBuilderBinding | undefined,
    phase: string,
    action: () => Promise<T>,
  ) => {
    const step = { phase, entryKey: binding?.entryKey, platforms: binding?.platforms ?? [] };
    try {
      const result = await action();
      initialization.push(step);
      return result;
    } catch (cause) {
      const probe = binding
        ? await binding.builder.probeEvidence().catch((error: unknown) => ({
            unavailable: error instanceof Error ? error.message : "无法读取观察器现场",
          }))
        : undefined;
      throw new ConfigurationOperationError(
        "task",
        `任务观察初始化失败（${binding?.entryKey ?? "任务来源"}/${phase}）：${cause instanceof Error ? cause.message : "未知错误"}`,
        "stop",
        {
          cause,
          diagnostic: {
            phase: "task-observer-initialization",
            observations: { ...step, completed: initialization, probe },
          },
        },
      );
    }
  };
  // Only participating categories are observed. Each still reads the complete project queue.
  for (const binding of bindings) {
    await session.verify();
    await prepare(binding, "activate", async () => binding.activate?.());
    await prepare(binding, "install", () =>
      binding.builder.installProbe([], binding.platforms.includes("openpaas"), keys),
    );
    const baseline = await prepare(binding, "baseline", () => binding.builder.baseline(true));
    const ids = JSON.stringify(baseline.map((t) => t.id).sort());
    if (initialIds !== undefined && ids !== initialIds)
      throw new Error("两类面板的完整任务基线不一致");
    initialIds = ids;
    for (const task of baseline) baselineIds.add(task.id);
  }
  const observer = new TaskObserver(
    bindings.map((binding) => binding.builder),
    bindings.map((binding) => binding.platforms),
  );
  await prepare(undefined, "initial-poll", () => observer.poll());
  observer.start(() => {});
  const port: BuildStepsPort = {
    source: observer,
    baselineIds,
    signal,
    queueTimeoutMs: 1_800_000,
    buildTimeoutMs: 600_000,
    capture: async (operations, selectedFields, supplement) => {
      await operations.context.verify();
      const builder = forPlatform(operations.platform);
      const stages = await builder.caseDom(readStageUi);
      assertBuildOnly(stages);
      const configuration = await builder.readConfiguration(["debug"]);
      const snapshot = await operations.snapshot([
        ...new Set([...required, ...platformBuildFields(operations.platform), ...selectedFields]),
      ]);
      const values = Object.fromEntries(
        Object.entries(snapshot.fields)
          .filter(([key]) => !Object.hasOwn(stepObservationFields, key) || key === "bundleConfigs")
          .map(([key, control]) => {
            if (!control)
              throw new ConfigurationOperationError(
                "precondition",
                `提交快照缺少字段：${key}`,
                "blocked",
              );
            return [
              key,
              sensitiveConfigurationField(key) && typeof control.value === "string"
                ? fieldFingerprint(control.value)
                : structuredClone(control.value),
            ];
          }),
      );
      for (const [key, value] of Object.entries(supplement?.values ?? {}))
        if (!Object.hasOwn(values, key))
          values[key] =
            sensitiveConfigurationField(key) && typeof value === "string"
              ? fieldFingerprint(value)
              : structuredClone(value);
      const selected = values.scenes;
      if (!Array.isArray(selected) || !selected.length)
        throw new ConfigurationOperationError("precondition", "没有可提交的场景", "blocked");
      values.scenes = selected.map((value) => {
        const candidate = scenes.candidates.find((s) => s.path === value || s.uuid === value);
        if (!candidate)
          throw new ConfigurationOperationError(
            "precondition",
            "UI 场景不能对应到当前工程资源",
            "blocked",
          );
        return candidate.uuid;
      });
      const initial = scenes.candidates.find(
        (scene) =>
          scene.uuid === configuration.startSceneId || scene.path === configuration.startSceneId,
      );
      if (!initial || !(values.scenes as string[]).includes(initial.uuid))
        throw new ConfigurationOperationError(
          "precondition",
          "初始场景无法对应到当前工程的已选资源",
          "blocked",
        );
      values.startScene = initial.uuid;
      await operations.assertSnapshotCurrent(snapshot);
      if (!configurationEqual(configuration, await builder.readConfiguration(["debug"])))
        throw new ConfigurationOperationError("snapshot", "配置身份在回读期间发生变化", "stop");
      builder.bindHistoryPlatformTitle(operations.platform, operations.context.title);
      return {
        configuration,
        values,
        sceneCandidates: structuredClone(scenes.candidates),
        stages: stages.groups,
        ...(supplement ? { preserved: supplement.preserved } : {}),
      };
    },
    click: (operations, verify) => {
      const builder = forPlatform(operations.platform);
      return builder.click("button", "构建", undefined, undefined, async () => {
        await verify();
        await observer.poll();
        assertBuildOnly(await builder.caseDom(readStageUi));
      });
    },
    assertCard: async (task) => {
      await session.verify();
      const builder = forPlatform(task.platform);
      await bindings.find((binding) => binding.builder === builder)?.activate?.();
      await builder.revealTask(task);
      try {
        await waitFor(
          "本次卡片成功",
          () => builder.successText(task.outputName!, task.platform),
          15_000,
          signal,
        );
      } catch (cause) {
        if (signal.aborted || cause instanceof ConfigurationOperationError) throw cause;
        throw new ConfigurationOperationError("assertion", "本次成功卡片核验失败", "failed", {
          cause,
          diagnostic: {
            phase: "history-card",
            observations: { taskId: task.id, ...builder.historyCardEvidence() },
          },
        });
      }
    },
  };
  return { port, initialization, stop: () => observer.stop() };
}
