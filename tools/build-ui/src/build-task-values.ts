import { isDeepStrictEqual } from "node:util";
import type { Task } from "./common.js";
import type { CaseValues } from "./finalized-cases.js";
import { existingFields, fieldFingerprint } from "./existing-platforms.js";
import type { SceneCandidate } from "./case-inputs.js";
function same(a: unknown, b: unknown): boolean {
  return Array.isArray(a) && Array.isArray(b)
    ? isDeepStrictEqual([...a].sort(), [...b].sort())
    : isDeepStrictEqual(a, b);
}
export function assertBuildTaskValues(
  task: Task,
  evidence: { values: CaseValues; preserved: string[]; sceneCandidates?: SceneCandidate[] },
) {
  if (!task.caseOptions) throw new Error("任务没有四组参数观察快照");
  const omittedDefaults = new Map(
    ["harmonyos-next", "alipay-mini-game"].includes(task.platform)
      ? existingFields(task.platform)
          .filter((field) => field.missingDefault !== undefined)
          .map((field) => [field.key, field.missingDefault])
      : [],
  );
  for (const [key, ui] of Object.entries(evidence.values)) {
    let expected: unknown = ui,
      actual = task.caseOptions[key];
    if (key === "startScene" && evidence.sceneCandidates) {
      // The SDK can resolve UUID -> db:// during execution. Both sides must identify
      // the same independently discovered project scene; task.scenes is not an oracle.
      const identify = (value: unknown) =>
        evidence.sceneCandidates!.filter((scene) => value === scene.uuid || value === scene.path);
      const fromUi = identify(ui),
        fromTask = identify(actual);
      if (fromUi.length !== 1 || fromTask.length !== 1 || fromUi[0].uuid !== fromTask[0].uuid)
        throw new Error("四组任务参数不一致：startScene（场景身份未能独立对应）");
      expected = fromUi[0].uuid;
      actual = fromTask[0].uuid;
    }
    if (key === "packages.localization-editor.targetLanguageMap") {
      // The view adds every available Catalog as an unchecked checkbox, even when
      // the form/task map contains only the selected locales. Missing and false
      // entries both mean unselected; a missing/extra selected locale still fails.
      const selected = (value: unknown) => {
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new Error("L10N 任务目标语言映射格式不正确");
        return Object.fromEntries(
          Object.entries(value).filter(([, entry]) => {
            if (
              !entry ||
              typeof entry !== "object" ||
              typeof entry.locale !== "string" ||
              typeof entry.value !== "boolean"
            )
              throw new Error("L10N 任务目标语言条目格式不正确");
            return entry.value;
          }),
        );
      };
      expected = selected(ui);
      actual = selected(actual);
    }
    if (key === "sourceMaps" && ui !== "inline") expected = ui === "true";
    if (key === "wasmCompressionMode") {
      // The UI omits an unchecked value; the SDK schema may fill its explicit false default.
      expected = ui === true ? "brotli" : actual === false ? false : undefined;
    }
    if (key === "scenes" && Array.isArray(actual))
      actual = actual.map((s: { uuid?: string }) => s.uuid);
    const omittedEmpty =
      actual === undefined &&
      evidence.preserved.includes(key) &&
      (ui === "" || ui === fieldFingerprint("")) &&
      /(?:appid|appkey|privatePemPath|certificatePemPath|keystorePath|keystorePassword|keystoreAlias|keystoreAliasPassword)$/i.test(
        key,
      );
    const omittedDefault =
      actual === undefined && omittedDefaults.has(key) && same(ui, omittedDefaults.get(key));
    if (!same(actual, expected) && !omittedEmpty && !omittedDefault)
      throw new Error(`四组任务参数不一致：${key}（值已省略）`);
  }
  if (
    task.platform !== "openpaas" &&
    Array.isArray(task.options?.nextStages) &&
    task.options!.nextStages.length
  )
    throw new Error("普通平台提交包含后续阶段，超出仅构建范围");
}
