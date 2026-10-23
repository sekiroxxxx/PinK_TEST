import type { Builder } from "./builder.js";
import { ExecutionContext, ConfigurationOperationError } from "./configuration-context.js";
import { configurationEqual } from "./configuration-operations.js";
import { discoverScenes } from "./case-inputs.js";
import { TaskObserver } from "./task-observer.js";
import { waitFor } from "./common.js";
import type { BuildStepsPort } from "./build-steps.js";

export async function createStepBuildPort(
  builder: Builder,
  session: ExecutionContext,
  project: string,
  fields: string[],
  signal: AbortSignal,
) {
  const required = ["name", "buildPath", "outputName", "startScene", "scenes", "debug"];
  const keys = [...new Set([...required, ...fields])];
  const scenes = await discoverScenes(project);
  await session.verify();
  await builder.installProbe([], false, keys);
  const baseline = await builder.baseline(true);
  const observer = new TaskObserver([builder]);
  await observer.poll();
  observer.start(() => {});
  const port: BuildStepsPort = {
    source: observer,
    baselineIds: new Set(baseline.map((t) => t.id)),
    signal,
    queueTimeoutMs: 1_800_000,
    buildTimeoutMs: 600_000,
    capture: async (operations, selectedFields) => {
      await operations.context.verify();
      const configuration = await builder.readConfiguration(["debug"]);
      const snapshot = await operations.snapshot([...new Set([...required, ...selectedFields])]);
      const values = Object.fromEntries(
        Object.entries(snapshot.fields).map(([key, control]) => {
          if (!control)
            throw new ConfigurationOperationError(
              "precondition",
              `提交快照缺少字段：${key}`,
              "blocked",
            );
          return [key, structuredClone(control.value)];
        }),
      );
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
      values.startScene = configuration.startSceneId;
      await operations.assertSnapshotCurrent(snapshot);
      if (!configurationEqual(configuration, await builder.readConfiguration(["debug"])))
        throw new ConfigurationOperationError("snapshot", "配置身份在回读期间发生变化", "stop");
      return { configuration, values };
    },
    click: (_operations, verify) => builder.click("button", "构建", undefined, undefined, verify),
    assertCard: async (task) => {
      await session.verify();
      await builder.revealTask(task);
      await waitFor(
        "本次卡片成功",
        () => builder.successText(task.outputName!, task.platform),
        15_000,
        signal,
      );
    },
  };
  return { port, stop: () => observer.stop() };
}
