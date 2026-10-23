import { createHash } from "node:crypto";
import { platformEntry } from "./platform-catalog.js";
import type { SpecialFieldContract } from "./profiles.js";
import type { FieldValue, Task } from "./common.js";

/** Additional local build candidates. These identities do not define writable profiles. */
export const existingPlatformIds = [
  "wechatgame",
  "bytedance-mini-game",
  "alipay-mini-game",
  "android",
  "google-play",
  "windows",
  "harmonyos-next",
] as const;

export const existingPlatforms = existingPlatformIds.map(platformEntry);

export function selectExistingPlatforms(caseIds?: string) {
  if (!caseIds) return existingPlatforms;
  const ids = caseIds.split(",").map((id) => id.trim());
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => !existingPlatforms.some((p) => id === `existing.${p.id}`))
  )
    throw new Error("existing-local-seven的cases须为不重复的existing.<平台ID>");
  return existingPlatforms.filter((p) => ids.includes(`existing.${p.id}`));
}

export function checkExistingTask(
  task: Task,
  fields: SpecialFieldContract[],
  expected: Record<string, FieldValue>,
) {
  const checks: Record<string, "matched" | "omitted-default" | "omitted-empty"> = {};
  for (const field of fields) {
    const actual = task.specialOptions?.[field.key];
    if (!actual) throw new Error(`任务未观察到字段：${field.key}`);
    if (
      !actual.present &&
      field.missingDefault !== undefined &&
      expected[field.key] === field.missingDefault
    ) {
      checks[field.key] = "omitted-default";
    } else if (!actual.present && field.optionalEmpty && expected[field.key] === "") {
      checks[field.key] = "omitted-empty";
    } else if (actual.present && actual.value === expected[field.key]) {
      checks[field.key] = "matched";
    } else
      throw new Error(
        `任务与UI字段不一致：${field.key}，期望${JSON.stringify(expected[field.key])}，实际${actual.present ? JSON.stringify(actual.value) : "未设置"}`,
      );
  }
  return checks;
}

export const existingPublicKeys = [
  "debug",
  "md5Cache",
  "mainBundleIsRemote",
  "server",
  "mainBundleCompressionType",
];

/** A digest permits exact identity checks without persisting an AppID. */
export function fieldFingerprint(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function existingFields(id: string): SpecialFieldContract[] {
  const field = (
    key: string,
    type: SpecialFieldContract["type"],
    extra: Partial<SpecialFieldContract> = {},
  ): SpecialFieldContract => ({ key: `packages.${id}.${key}`, type, ...extra });
  const booleans = (...keys: string[]) => keys.map((key) => field(key, "boolean"));
  const direction = () =>
    booleans("orientation.portrait", "orientation.landscapeRight", "orientation.landscapeLeft");
  const render = () =>
    booleans("renderBackEnd.vulkan", "renderBackEnd.gles3", "renderBackEnd.gles2");
  switch (id) {
    case "openpaas":
      return [
        field("appid", "string", {
          uiLabel: "OpenPaaS 游戏",
          nativeSelect: true,
          fingerprint: true,
        }),
        field("versionName", "string"),
        field("deviceOrientation", "string"),
      ];
    case "ohos":
      return [
        field("packageName", "string"),
        field("apiLevel", "number"),
        ...direction(),
        field("encrypted", "boolean", { uiLabel: "加密 JS" }),
        field("JobSystem", "string", { uiLabel: "任务调度系统", nativeSelect: true }),
      ];
    case "wechatgame":
    case "bytedance-mini-game":
      return [
        field("appid", "string", { fingerprint: true }),
        field("orientation", "string"),
        ...booleans("buildOpenDataContextTemplate", "wasmSubpackage", "separateEngine"),
        ...(id === "wechatgame"
          ? booleans("highPerformanceMode")
          : [field("devToolsLaunchMethod", "string"), ...booleans("generatePreloadJsFileList")]),
      ];
    case "alipay-mini-game":
      // Schema has no explicit default; both the UI checkbox and build hook treat omission as off.
      return [
        field("deviceOrientation", "string"),
        field("wasmSubpackage", "boolean", { missingDefault: false }),
      ];
    case "android":
      return [
        field("packageName", "string"),
        ...render(),
        ...direction(),
        ...booleans("swappy", "inputSDK"),
        ...booleans("resizeableActivity"),
      ];
    case "huawei-agc":
      return [
        field("serviceConfigPath", "string"),
        field("packageName", "string"),
        ...render(),
        ...direction(),
        ...booleans("swappy", "inputSDK", "isSoFileCompressed"),
        field("useDebugKeystore", "boolean", { uiLabel: "使用调试密钥库" }),
      ];
    case "google-play":
      return [
        field("packageName", "string"),
        ...[
          ["renderBackEnd.vulkan", "Vulkan"],
          ["renderBackEnd.gles3", "GLES 2/3"],
          ["renderBackEnd.gles2", "GLES2"],
        ].map(([key, choiceLabel]) => field(key, "boolean", { uiLabel: "渲染后端", choiceLabel })),
        ...[
          ["orientation.portrait", "竖屏"],
          ["orientation.landscapeRight", "右横屏"],
          ["orientation.landscapeLeft", "左横屏"],
        ].map(([key, choiceLabel]) => field(key, "boolean", { uiLabel: "屏幕方向", choiceLabel })),
        ...booleans("swappy", "adpf"),
        field("inputSDK", "boolean", { uiLabel: "Input SDK" }),
      ];
    case "windows":
      return [
        field("executableName", "string", { optionalEmpty: true }),
        field("targetPlatform", "string"),
        ...render(),
      ];
    case "harmonyos-next":
      return [
        field("packageName", "string"),
        field("jsEngine", "string"),
        ...booleans("useGamepad", "renderBackEnd.gles3"),
        ...direction(),
        ...booleans(
          "deviceTypes.phone",
          "deviceTypes.tablet",
          "deviceTypes.pc_2in1",
          "deviceTypes.tv",
          "deviceTypes.wearable",
          "deviceTypes.car",
          "deviceTypes.default",
        ).map((field) =>
          field.key.endsWith(".default") ? field : { ...field, missingDefault: false as const },
        ),
      ];
    default:
      throw new Error(`未开放沿用配置的平台：${id}`);
  }
}
