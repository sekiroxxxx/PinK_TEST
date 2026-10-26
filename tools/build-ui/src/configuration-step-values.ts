import type { CaseValues, CaseValue } from "./finalized-cases.js";
import { ConfigurationOperationError } from "./configuration-context.js";
import {
  configurationEqual,
  type ConfigurationOperations,
  type ConfigurationSnapshot,
} from "./configuration-operations.js";
import { readAgcMaterial } from "./agc.js";

/** Existing untyped controls are observable/restorable, but cannot acquire a generic set capability. */
export const stepObservationFields = {
  bundleConfigs: { kind: "array" as const },
  "custom-common:includeInAll": { kind: "boolean" as const },
  "packages.google-play.customIconFile": { kind: "string" as const },
};

export function platformBuildFields(platform: string) {
  if (platform === "huawei-agc")
    return ["packages.huawei-agc.serviceConfigPath", "packages.huawei-agc.packageName"];
  if (platform === "openpaas") return ["packages.openpaas.appid", "packages.openpaas.versionName"];
  return [];
}

export function hiddenCondition(field: string): { field: string; value: CaseValue } | undefined {
  if (field === "md5CacheOptions.handleTemplateMd5Link") return { field: "md5Cache", value: false };
  if (field === "wasmCompressionMode") return { field: "nativeCodeBundleMode", value: "asmjs" };
  if (field === "packages.taobao-mini-game.globalVariable")
    return { field: "packages.taobao-mini-game.globalAdapter", value: true };
  if (/^packages\.[\w-]+\.compressZip$/.test(field))
    return { field: field.replace(/compressZip$/, "encrypted"), value: false };
}

export function preparationFields(field: string, target?: CaseValue): string[] | undefined {
  if (field === "nativeCodeBundleMode")
    return target === undefined || typeof target === "object" || target === "asmjs"
      ? [field, "wasmCompressionMode"]
      : [field];
  if (field === "mainBundleCompressionType") return [field];
  if (/^packages\.[\w-]+\.encrypted$/.test(field)) return [field, "debug"];
}

/** The same bounded preparations previously embedded in finalized-flow.assign. */
export async function prepareConfigurationWrite(
  operations: ConfigurationOperations,
  field: string,
  value: CaseValue,
  write: (field: string, value: CaseValue) => Promise<unknown> = (key, target) =>
    operations.set(key, target),
) {
  const changed: string[] = [];
  const set = async (key: string, target: CaseValue) => {
    const before = (await operations.read(key)).value;
    await write(key, target);
    if (!configurationEqual(before, (await operations.read(key)).value)) changed.push(key);
  };
  const current = await operations.inspect(field);
  if (!current)
    throw new ConfigurationOperationError("precondition", `准备字段未显示：${field}`, "blocked");
  if (field.endsWith(".encrypted")) {
    if (current.disabled && !configurationEqual(current.value, value)) await set("debug", false);
  } else if (field === "nativeCodeBundleMode") {
    if (value === "asmjs" && current.value !== "asmjs") await set("wasmCompressionMode", false);
  } else if (field === "mainBundleCompressionType") {
    if (current.value === "subpackage" && value !== "subpackage") await set(field, "none");
  } else
    throw new ConfigurationOperationError("precondition", "此字段没有已注册的联动准备", "blocked");
  return { changed };
}

export async function retainedValues(
  operations: ConfigurationOperations,
  baseline: ConfigurationSnapshot,
  allowHiddenForTask = false,
) {
  if (
    baseline.context.session !== operations.context.session ||
    baseline.context.platform !== operations.platform
  )
    throw new ConfigurationOperationError("context", "保留值记录不属于本会话/平台", "stop");
  const values: CaseValues = {},
    preserved: string[] = [];
  const observations: Array<{ field: string; state: string; taskCheck: string }> = [];
  for (const [field, initial] of Object.entries(baseline.fields)) {
    if (!initial) {
      observations.push({ field, state: "not-observed-at-start", taskCheck: "not-observed" });
      continue;
    }
    const current = await operations.inspect(field);
    const task = !Object.hasOwn(stepObservationFields, field) || field === "bundleConfigs";
    operations.check("retained-visible-or-task", field, !!current || (allowHiddenForTask && task));
    if (current)
      operations.check("retained", field, configurationEqual(current.value, initial.value));
    if (task) {
      values[field] = structuredClone(initial.value);
      preserved.push(field);
    }
    observations.push({
      field,
      state: current ? "unchanged" : "hidden-at-end",
      taskCheck: task ? "pending-task" : "ui-only",
    });
  }
  return { values, preserved, observations };
}

export async function assertHiddenValue(
  operations: ConfigurationOperations,
  field: string,
  observed?: ConfigurationSnapshot,
) {
  const condition = hiddenCondition(field),
    control = observed?.fields[field];
  if (
    !condition ||
    (observed
      ? observed.context !== operations.context || !control
      : field !== "wasmCompressionMode")
  )
    throw new ConfigurationOperationError(
      "precondition",
      "隐藏断言缺少当前页面上已观察到的子项",
      "blocked",
    );
  await operations.ready();
  operations.check(
    "hidden-parent",
    condition.field,
    configurationEqual((await operations.read(condition.field)).value, condition.value),
  );
  operations.check("hidden-child", field, (await operations.inspect(field)) === null);
  return control ? structuredClone(control.value) : false;
}

/** Reuse the existing AGC JSON parser, while withholding file contents in errors. */
export async function assertAgcConfiguration(operations: ConfigurationOperations) {
  if (operations.platform !== "huawei-agc")
    throw new ConfigurationOperationError("precondition", "AGC 文件检查只能用于 AGC", "blocked");
  const path = (await operations.read("packages.huawei-agc.serviceConfigPath")).value;
  const packageName = (await operations.read("packages.huawei-agc.packageName")).value;
  let material;
  try {
    material = await readAgcMaterial(String(path));
  } catch {
    throw new ConfigurationOperationError(
      "precondition",
      "AGC 服务 JSON 不可读取或缺少有效 client.package_name",
      "blocked",
    );
  }
  operations.check(
    "agc-package",
    "packages.huawei-agc.packageName",
    packageName === material.packageName,
  );
  return material;
}

export function configurationValueMatches(
  field: string,
  actual: CaseValue,
  expected: CaseValue,
): boolean {
  if (typeof expected === "number") actual = Number(actual);
  if (field === "sourceMaps" && typeof actual === "boolean") actual = String(actual);
  if (configurationEqual(actual, expected)) return true;
  return (
    field.endsWith(".targetLanguageMap") &&
    !!actual &&
    typeof actual === "object" &&
    !Array.isArray(actual) &&
    !!expected &&
    typeof expected === "object" &&
    !Array.isArray(expected) &&
    Object.keys(expected).every((key) => Object.hasOwn(actual, key)) &&
    Object.entries(actual).every(([locale, value]) =>
      configurationEqual(value, expected[locale] ?? { locale, value: false }),
    )
  );
}
