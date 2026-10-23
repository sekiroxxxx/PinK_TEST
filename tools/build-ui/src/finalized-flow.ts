import { readFile, readdir, access } from "node:fs/promises";
import { join, basename } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Builder } from "./builder.js";
import { BuilderConfiguration } from "./configuration-runtime.js";
import { ExecutionContext, ConfigurationOperationError } from "./configuration-context.js";
import type { ConfigurationSnapshot } from "./configuration-operations.js";
import { runFormSample, type FormSampleEvidence } from "./form-validation.js";
import { type Configuration } from "./common.js";
import { fieldFingerprint } from "./existing-platforms.js";
import { prepareOpenpaasBuild } from "./openpaas.js";
import { readAgcMaterial, type AgcMaterial } from "./agc.js";
import { engineSelection } from "./session.js";
import type { BuildCase } from "./build-cases.js";
import type { CaseValue, CaseValues, FinalCase } from "./finalized-cases.js";
import { caseContract } from "./case-contract.js";
import { confirmScenes, sceneValues, type SceneContext } from "./case-inputs.js";

export class CasePrerequisiteError extends Error {
  constructor(
    readonly kind: "material" | "applicability" | "not-applicable" | "initial-state" | "ui-adapter",
    message: string,
  ) {
    super(message);
  }
}
export interface FinalEvidence {
  revision: string;
  group: string;
  endpoint: "build" | "ui";
  values: CaseValues;
  changed: string[];
  preserved: string[];
  checkpoints: Array<{ key: string; state: string; expected?: CaseValue }>;
  restoration: "not-required" | "pending" | "passed" | "failed";
  sceneResolution?: SceneContext;
  formValidation?: FormSampleEvidence;
}
export interface FinalPrepared {
  evidence: FinalEvidence;
  configuration: Configuration;
  restoreValues: CaseValues;
  agcMaterial?: AgcMaterial;
  session: ExecutionContext;
  operations: BuilderConfiguration;
  snapshot: ConfigurationSnapshot;
}
const secret = /(?:password|appkey|xxteaKey|appid)$/i;
function safe(key: string, value: CaseValue): CaseValue {
  return secret.test(key) && typeof value === "string" ? fieldFingerprint(value) : value;
}
function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return isDeepStrictEqual([...a].sort(), [...b].sort());
  return isDeepStrictEqual(a, b);
}
async function scenePaths(project: string): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  async function visit(dir: string, relative = "assets") {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.isDirectory()) await visit(join(dir, e.name), `${relative}/${e.name}`);
      else if (e.isFile() && e.name.endsWith(".scene.meta")) {
        const data = JSON.parse(await readFile(join(dir, e.name), "utf8")) as { uuid?: string };
        if (data.uuid) found.set(data.uuid, `db://${relative}/${e.name.slice(0, -5)}`);
      }
    }
  }
  await visit(join(project, "assets"));
  return found;
}

async function assign(
  form: BuilderConfiguration,
  values: CaseValues,
  paths: Map<string, string>,
  evidence: FinalEvidence,
  originals: CaseValues,
  order: string[] = [],
) {
  const save = async (key: string) => {
    const before = await form.inspect(key);
    if (before && !(key in originals)) {
      if (key === "scenes" && Array.isArray(before.value)) {
        const reverse = new Map([...paths].map(([id, path]) => [path, id]));
        originals[key] = before.value.map((path) => reverse.get(String(path)) ?? String(path));
      } else originals[key] = before.value;
    }
    return before;
  };
  const write = async (key: string, value: CaseValue) => {
    const before = await save(key);
    if (!before)
      throw new CasePrerequisiteError("initial-state", `条件字段未出现：${key}；不写入隐藏配置`);
    if (await form.set(key, value)) evidence.changed.push(key);
  };
  // Editing encryption while Debug is true is disabled by the native custom views.
  const encryption = `packages.${form.platform}.encrypted`;
  if (encryption in values) {
    const before = await form.inspect(encryption);
    if (before?.disabled && !same(before.value, values[encryption])) await write("debug", false);
  }
  for (const key of ["name", "buildPath", "outputName"])
    if (key in values) await write(key, values[key]);
  const sequence = [
    "engineModulesConfigKey",
    "overwriteProjectSettings.includeModules.physics",
    "overwriteProjectSettings.includeModules.physics-2d",
    "overwriteProjectSettings.includeModules.gfx-webgl2",
    "overwriteProjectSettings.macroConfig.cleanupImageCache",
  ];
  for (const key of sequence)
    if (key in values) {
      await write(key, values[key]);
      await form.ready();
    }
  if ("nativeCodeBundleMode" in values) {
    const packaging = await form.inspect("nativeCodeBundleMode");
    if (!packaging)
      throw new CasePrerequisiteError(
        "initial-state",
        "所选预设没有原生模块，包装控件不适用；不补写隐藏字段",
      );
    if (values.nativeCodeBundleMode === "asmjs" && packaging.value !== "asmjs")
      await write("wasmCompressionMode", false);
    await write("nativeCodeBundleMode", values.nativeCodeBundleMode);
  }
  const compression = await form.inspect("mainBundleCompressionType");
  if (
    compression?.value === "subpackage" &&
    values.mainBundleCompressionType !== undefined &&
    values.mainBundleCompressionType !== "subpackage"
  )
    await write("mainBundleCompressionType", "none");
  for (const key of ["server", "mainBundleIsRemote", "mainBundleCompressionType", "md5Cache"])
    if (key in values) await write(key, values[key]);
  // When the adapter hides the text, verify the declared initial text before hiding it.
  const globalText = `packages.${form.platform}.globalVariable`;
  const adapter = `packages.${form.platform}.globalAdapter`;
  const hiddenText = values[adapter] === true && globalText in values;
  if (hiddenText) {
    const before = await save(globalText);
    if (!before || before.value !== values[globalText])
      throw new CasePrerequisiteError(
        "initial-state",
        "全局适配隐藏保留场景缺少已确认文本初态；不自动重置制造通过",
      );
  }
  const zip = `packages.${form.platform}.compressZip`;
  const hiddenZip = values[encryption] === false && zip in values;
  if (hiddenZip) {
    // Clear/read the child while it is editable, then close its parent below.
    if ((await form.read(encryption)).disabled) await write("debug", false);
    if (!(await form.inspect(zip))) await write(encryption, true);
    await write(zip, values[zip]);
    evidence.checkpoints.push({
      key: zip,
      state: "read-back-before-hiding",
      expected: (await form.read(zip)).value,
    });
  }
  // Set parents first; enabling debug is the final step so dependent controls remain editable.
  const handled = new Set([
    ...sequence,
    "nativeCodeBundleMode",
    "server",
    "mainBundleIsRemote",
    "mainBundleCompressionType",
    "md5Cache",
    "debug",
    "scenes",
    "startScene",
    ...(hiddenZip ? [zip] : []),
  ]);
  const rest = caseContract.orderedKeys(values, order).filter((k) => !handled.has(k));
  for (const key of rest) {
    if (hiddenText && key === globalText) continue;
    if (
      key === "packages.google-play.customIcon" &&
      values[key] !== "default" &&
      values[key] !== "custom"
    ) {
      await access(String(values[key])).catch(() => {
        throw new CasePrerequisiteError("material", "Google 自定义图标 PNG 不存在");
      });
      await save(key);
      await form.googleIcon(String(values[key]));
      evidence.changed.push(key);
      evidence.checkpoints.push({
        key,
        state: "PNG-input; task-compares-mode-custom",
        expected: String(values[key]),
      });
      values[key] = "custom";
      continue;
    }
    if (key === "wasmCompressionMode" && values.nativeCodeBundleMode === "asmjs") continue;
    if (key.includes("networkTimeout.")) await form.expandSection("网络超时");
    await write(key, values[key]);
  }
  if (values.startScene !== undefined) {
    const id = String(values.startScene),
      path = paths.get(id);
    if (!path) throw new CasePrerequisiteError("material", `场景 UUID 无真实工程文件：${id}`);
    await save("startScene");
    if (await form.set("startScene", id, undefined, basename(path, ".scene")))
      evidence.changed.push("startScene");
  }
  if (Array.isArray(values.scenes)) {
    const target = values.scenes.map((id) => paths.get(String(id)));
    if (target.some((p) => !p))
      throw new CasePrerequisiteError("material", "场景集合含未绑定的真实资源身份");
    await write("scenes", target as string[]);
  }
  if ("debug" in values) await write("debug", values.debug);
  await form.ready();
  // The snapshot used at submission and at completion is exactly this final readback.
  for (const [key, target] of Object.entries(values)) {
    if (key === "scenes") {
      evidence.values[key] = target;
      continue;
    }
    if (hiddenText && key === globalText) {
      if (await form.inspect(key)) throw new Error("全局适配开启后文本未隐藏");
      evidence.values[key] = safe(key, target);
      continue;
    }
    if (hiddenZip && key === zip) {
      if (await form.inspect(zip)) throw new Error("加密关闭后 Zip 压缩子项未隐藏");
      evidence.values[key] = target;
      continue;
    }
    if (key === "wasmCompressionMode" && values.nativeCodeBundleMode === "asmjs") {
      if (await form.inspect(key)) throw new Error("Asmjs 下压缩控件未隐藏");
      evidence.values[key] = false;
      continue;
    }
    const control = await form.read(key);
    const actual = typeof target === "number" ? Number(control.value) : control.value;
    if (control.derivedFrom)
      evidence.checkpoints.push({
        key,
        state: `cleared-by-ui-parent:${control.derivedFrom}`,
        expected: actual,
      });
    const map = key.endsWith(".targetLanguageMap");
    if (
      !same(actual, target) &&
      !(
        map &&
        actual &&
        typeof actual === "object" &&
        !Array.isArray(actual) &&
        typeof target === "object" &&
        !Array.isArray(target) &&
        Object.entries(actual).every(([locale, v]) =>
          same(v, (target as Record<string, CaseValue>)[locale] ?? { locale, value: false }),
        )
      )
    )
      form.check("final-readback", key, false);
    evidence.values[key] = safe(key, actual);
  }
}

export async function prepareFinalizedCase(
  builder: Builder,
  item: BuildCase,
  project: string,
  signal: AbortSignal,
  agcServices: string | undefined,
  session: ExecutionContext,
): Promise<FinalPrepared> {
  const definition = item.finalized!;
  if (definition.blockers.length)
    throw new CasePrerequisiteError(
      definition.blockers[0].kind,
      definition.blockers.map((b) => b.reason).join("；"),
    );
  if (
    definition.scenario?.endsWith(".plugin") &&
    (await engineSelection(project)).type === "custom"
  )
    throw new CasePrerequisiteError(
      "material",
      "发布插件正向场景需要兼容 builtin 引擎环境；不修改当前 custom 选择",
    );
  const form = await BuilderConfiguration.open(builder, session, item.platform, signal);
  const evidence: FinalEvidence = {
    revision: definition.revision,
    group: definition.group,
    endpoint: definition.endpoint,
    values: {},
    changed: [],
    preserved: [],
    checkpoints: [],
    restoration: definition.scenario ? "pending" : "not-required",
  };
  const originals: CaseValues = {};
  if (definition.formValidation) {
    if (definition.endpoint !== "ui") throw new Error("表单反向样本只允许 UI 检查与恢复终点");
    if (definition.formValidation.execution.field.startsWith("packages.openpaas.networkTimeout."))
      await form.expandSection("网络超时");
    evidence.formValidation = await runFormSample(form, definition.formValidation);
    evidence.changed = [...new Set(evidence.formValidation.changedFields)];
    evidence.restoration = evidence.formValidation.restoration;
    return {
      evidence,
      // Restoration may correctly bring back an original required-field alert.
      configuration: await builder.readConfiguration(["debug"], Date.now(), undefined, "ui"),
      restoreValues: {},
      session,
      operations: form,
      snapshot: await form.snapshot(["debug"]),
    };
  }
  const paths = await scenePaths(project);
  const values = structuredClone(definition.values);
  if (definition.sceneContext && definition.sceneInputs && !definition.blockers.length) {
    const initialScene = await form.read("startScene");
    confirmScenes(definition.sceneContext, String(initialScene.value));
    Object.assign(values, sceneValues(definition.sceneInputs, definition.sceneContext));
    evidence.sceneResolution = structuredClone(definition.sceneContext);
  }

  let agcMaterial: AgcMaterial | undefined;
  if (item.platform === "huawei-agc" && definition.endpoint === "build") {
    const material = await readAgcMaterial(
      agcServices ?? String(values["packages.huawei-agc.serviceConfigPath"] ?? ""),
    ).catch(() => {
      throw new CasePrerequisiteError(
        "material",
        "AGC 服务 JSON 不可读取或缺有效 client.package_name",
      );
    });
    agcMaterial = material;
    if (values["packages.huawei-agc.packageName"] !== material.packageName)
      throw new CasePrerequisiteError("material", "AGC JSON 包名与定稿身份不同；不自动改定稿包名");
    values["packages.huawei-agc.serviceConfigPath"] = material.path;
  }
  for (const [key, value] of Object.entries(values)) {
    if (
      /(?:Path|\.icon)$/.test(key) &&
      typeof value === "string" &&
      value &&
      !value.includes("://")
    )
      await access(value).catch(() => {
        throw new CasePrerequisiteError("material", `测试文件不可用：${key}`);
      });
  }
  for (const key of definition.retained) {
    const control = await form.inspect(key);
    if (control) {
      evidence.values[key] = safe(key, control.value);
      evidence.preserved.push(key);
    } else evidence.checkpoints.push({ key, state: "not-observed-hidden-at-start" });
  }
  try {
    if (definition.endpoint === "build" && item.platform === "openpaas") {
      for (const key of ["name", "buildPath", "packages.openpaas.versionName"])
        if (key in values) {
          originals[key] = (await form.read(key)).value;
          if (await form.set(key, values[key])) evidence.changed.push(key);
        }
      await prepareOpenpaasBuild(builder, await builder.configurationPage());
    }
    await runScenarioBefore(form, definition, evidence, originals);
    if (
      definition.endpoint === "build" ||
      definition.executionOperation === "configure-and-restore"
    )
      await assign(form, values, paths, evidence, originals, definition.configurationOrder);
    else await runValidation(form, definition, evidence, originals);
    if (definition.scenario === "conditional.l10n.default-switch") {
      if (!evidence.changed.length)
        throw new CasePrerequisiteError("initial-state", "保存专项没有真实变化");
      await form.reopen();
      for (const key of Object.keys(values).filter((k) =>
        k.startsWith("packages.localization-editor."),
      ))
        if (!same(safe(key, (await form.read(key)).value), evidence.values[key]))
          throw new Error("L10N 保存重开不一致");
      evidence.checkpoints.push({ key: "persistence", state: "passed" });
    }
    if (definition.endpoint === "ui") {
      await restoreValues(form, originals, paths);
      evidence.restoration = "passed";
    }
    const configuration = await builder.readConfiguration(["debug"]);
    if (definition.endpoint === "build") {
      // Output collision avoidance is product-managed; associate and verify the final UI name.
      evidence.values.outputName = configuration.outputName;
      for (const key of evidence.preserved) {
        const final = await form.inspect(key);
        if (final && !same(safe(key, final.value), evidence.values[key]))
          throw new Error(`保留字段发生变化：${key}`);
      }
    }
    return {
      evidence,
      configuration,
      restoreValues: definition.scenario ? originals : {},
      agcMaterial,
      session,
      operations: form,
      snapshot: await form.snapshot([
        ...new Set([
          "name",
          "buildPath",
          "outputName",
          "startScene",
          "scenes",
          ...Object.keys(values),
        ]),
      ]),
    };
  } catch (error) {
    if (error instanceof ConfigurationOperationError && error.disposition === "stop") throw error;
    if (definition.scenario) await restoreValues(form, originals, paths);
    throw error;
  }
}

async function runScenarioBefore(
  form: BuilderConfiguration,
  c: FinalCase,
  e: FinalEvidence,
  originals: CaseValues,
) {
  if (!c.scenario) return;
  const prefix = "packages.localization-editor.";
  if (c.scenario.startsWith("conditional.l10n.")) {
    if (c.scenario === "conditional.l10n.gate")
      throw new CasePrerequisiteError(
        "ui-adapter",
        "项目启用/停用属于构建页之外的 L10N 入口；该转换操作尚未适配，不能以现有启用状态冒充变化通过",
      );
    for (const name of ["targetLanguageMap", "defaultLanguage", "fallbackLanguage"]) {
      const control = await form.inspect(prefix + name);
      if (!control)
        throw new CasePrerequisiteError(
          "material",
          "项目 L10N 未启用/未初始化或有效 Catalog 未就绪；不自动修改工程制造条件",
        );
      originals[prefix + name] = control.value;
    }
    const current = originals[prefix + "targetLanguageMap"] as Record<string, { value?: boolean }>;
    if (!("zh-Hans" in current) || !("en" in current))
      throw new CasePrerequisiteError("material", "L10N 缺少真实 zh-Hans/en Catalog 候选");
    if (["conditional.l10n.subset", "conditional.l10n.default-switch"].includes(c.scenario)) {
      if (
        !current["zh-Hans"].value ||
        !current.en.value ||
        originals[prefix + "defaultLanguage"] !== "en" ||
        originals[prefix + "fallbackLanguage"] !== "zh-Hans"
      )
        throw new CasePrerequisiteError(
          "initial-state",
          "L10N 专项初态须为双语言、默认 en/回退 zh-Hans；不自动重置",
        );
      if (c.scenario === "conditional.l10n.subset") {
        await form.set(prefix + "targetLanguageMap", {
          ...(originals[prefix + "targetLanguageMap"] as Record<string, CaseValue>),
          "zh-Hans": { locale: "zh-Hans", value: false },
        });
        if ((await form.read(prefix + "fallbackLanguage")).value !== "zh-Hans")
          throw new Error("取消目标错误地修改了回退语言");
        e.checkpoints.push({ key: "l10n-no-auto-correction", state: "passed" });
      }
    }
  }
  if (c.scenario === "conditional.openpaas.game-switch") {
    const games = await form.openpaasPage();
    const selected = String(c.values["packages.openpaas.appid"]);
    if (games.id === selected || !games.ids.includes(selected))
      throw new CasePrerequisiteError("material", "G1 必须是当前账号已有、不同于 G0 的游戏");
    originals["packages.openpaas.appid"] = games.id;
    await form.selectOpenpaasGame(selected);
    e.checkpoints.push({ key: "packages.openpaas.appid", state: "selected-existing-G1" });
  }
  if (c.scenario === "conditional.native.candidates") {
    const initial = c.binding?.initialValues;
    if (!initial || !Object.keys(initial).length)
      throw new CasePrerequisiteError(
        "material",
        "API/ABI 切换需绑定明确的 A0/初始集合 initialValues",
      );
    for (const [key, value] of Object.entries(initial)) {
      if (!key.endsWith(".apiLevel") && !key.endsWith(".appABIs"))
        throw new Error("API/ABI 初态键无效");
      if (!same((await form.read(key)).value, value))
        throw new CasePrerequisiteError("initial-state", "API/ABI 初态不符，不自动重置");
    }
  }
  if (c.scenario === "conditional.engine.presets") {
    const presets = c.binding?.presetIds;
    if (!presets || presets[0] === presets[1])
      throw new CasePrerequisiteError("material", "缺少两个真实预设 ID");
    originals.engineModulesConfigKey = (await form.read("engineModulesConfigKey")).value;
    if (presets[0] !== "defaultConfig")
      throw new CasePrerequisiteError("material", "P0 须为定稿基准 defaultConfig");
    await form.set("engineModulesConfigKey", presets[0]);
    await form.ready();
    const before: CaseValues = {};
    for (const key of [
      "overwriteProjectSettings.includeModules.physics",
      "overwriteProjectSettings.includeModules.physics-2d",
      "overwriteProjectSettings.macroConfig.cleanupImageCache",
    ]) {
      const control = await form.inspect(key);
      if (control) before[key] = control.value;
    }
    await form.set("engineModulesConfigKey", presets[1]);
    await form.ready();
    for (const [key, value] of Object.entries(before)) {
      const control = await form.inspect(key);
      if (control && !same(control.value, value)) throw new Error("切换预设意外清除了已有覆盖");
    }
    for (const [key, value] of Object.entries(c.binding?.values ?? {}))
      if (key !== "engineModulesConfigKey") {
        const control = await form.read(key);
        originals[key] ??= control.value;
        await form.set(key, value);
      }
    await form.set("engineModulesConfigKey", presets[0]);
    await form.ready();
    e.checkpoints.push({
      key: "engineModulesConfigKey",
      state: "P0-P1-override-P0",
      expected: presets,
    });
    for (const [key, value] of Object.entries(c.binding?.values ?? {}))
      if (key !== "engineModulesConfigKey") {
        const control = await form.inspect(key);
        if (control && !same(control.value, value)) throw new Error("返回 P0 后覆盖值不一致");
      }
  }
  if (c.scenario === "conditional.engine.packaging") {
    const physics = "overwriteProjectSettings.includeModules.physics-2d";
    originals[physics] = (await form.read(physics)).value;
    await form.set(physics, "physics-2d-box2d");
    await form.ready();
    originals.nativeCodeBundleMode = (await form.read("nativeCodeBundleMode")).value;
    if (await form.inspect("wasmCompressionMode"))
      originals.wasmCompressionMode = (await form.read("wasmCompressionMode")).value;
    for (const mode of ["wasm", "both", "asmjs", "both"]) {
      if (mode === "asmjs") await form.set("wasmCompressionMode", false);
      await form.set("nativeCodeBundleMode", mode);
      e.checkpoints.push({
        key: "nativeCodeBundleMode",
        state: "readback-matched",
        expected: mode,
      });
      if (mode === "asmjs") {
        if (await form.inspect("wasmCompressionMode")) throw new Error("Asmjs 压缩未隐藏");
      } else for (const checked of [false, true]) await form.set("wasmCompressionMode", checked);
    }
  }
  if (c.scenario === "conditional.resources.bundles") {
    const bundles = c.binding?.bundles;
    if (!bundles || bundles.length !== 2)
      throw new CasePrerequisiteError("material", "缺两个真实 Bundle 身份");
    originals.bundleConfigs = (await form.read("bundleConfigs")).value;
    for (const selected of [
      [bundles[0].root],
      [bundles[0].root, bundles[1].root],
      [bundles[1].root],
    ])
      await form.set("bundleConfigs", ["main", "internal", ...selected].sort());
    e.values.bundleConfigs = [
      { name: "main", root: "", output: true },
      { name: "internal", root: "", output: true },
      { ...bundles[1], output: true },
    ];
  }
}

async function runValidation(
  form: BuilderConfiguration,
  c: FinalCase,
  e: FinalEvidence,
  originals: CaseValues,
) {
  const prefix = `packages.${form.platform}.`;
  const sample = async (key: string, targets: Array<[CaseValue, string?]>) => {
    originals[key] ??= (await form.read(key)).value;
    for (const [target, input] of targets) {
      await form.set(key, target, input);
      e.checkpoints.push({ key, state: "input-readback-matched", expected: safe(key, target) });
    }
  };
  switch (c.scenario) {
    case "conditional.l10n.empty":
    case "conditional.l10n.empty-build": {
      const p = "packages.localization-editor.";
      const map = originals[p + "targetLanguageMap"] as Record<string, CaseValue>;
      const empty = Object.fromEntries(
        Object.keys(map).map((locale) => [locale, { locale, value: false }]),
      );
      await form.set(p + "targetLanguageMap", empty);
      for (const name of ["defaultLanguage", "fallbackLanguage"]) {
        const control = await form.read(p + name);
        if (control.disabled || control.value !== originals[p + name])
          throw new Error("L10N 全取消错误地禁用/改写默认或回退");
      }
      e.checkpoints.push({ key: p + "targetLanguageMap", state: "all-false-no-disable" });
      break;
    }
    case "conditional.validation.web-numbers":
      originals["binGroupConfig.enable"] = (await form.read("binGroupConfig.enable")).value;
      await form.set("binGroupConfig.enable", true);
      for (const key of [
        "packages.web-desktop.resolution.designWidth",
        "packages.web-desktop.resolution.designHeight",
        "binGroupConfig.threshold",
      ])
        await sample(key, [[1], [0], [-1], [1.5], [0, ""]]);
      break;
    case "conditional.validation.open-timeout":
      await form.expandSection("网络超时");
      for (const name of ["XMLHttpRequest", "Websocket", "uploadFile", "downloadFile"])
        await sample(prefix + "networkTimeout." + name, [["8000"], ["0"], ["-1"], ["abc"], [""]]);
      break;
    case "conditional.validation.quick-version":
      await sample(prefix + "versionCode", [["1"], ["0"], ["-1"], ["1.5"], ["abc"], [""]]);
      await sample(prefix + "versionName", [["1.0.1"], ["qa-version"], [""]]);
      break;
    case "conditional.validation.android-identity":
      await sample(prefix + "packageName", [["bad-name"]]);
      break;
    case "conditional.validation.windows-identity":
      await sample(prefix + "executableName", [["bad/name"], [""]]);
      break;
    case "conditional.validation.aspect": {
      if (form.platform !== "android") {
        originals[prefix + "resizeableActivity"] = (
          await form.read(prefix + "resizeableActivity")
        ).value;
        await form.set(prefix + "resizeableActivity", false);
      }
      for (const text of ["2.2", "0", "-1", "abc", ""]) {
        await sample(prefix + "maxAspectRatio", [[text]]);
        const relevant = await form.alerts(prefix + "maxAspectRatio");
        if (form.platform !== "huawei-agc" && text !== "2.2" && !relevant.length)
          throw new Error("未观察到已实现的比例错误提示");
        if (form.platform === "huawei-agc" && relevant.length)
          throw new Error("AGC 出现与当前合同不同的比例错误");
      }
      break;
    }
    case "conditional.validation.agc-json": {
      const files = c.binding?.invalidJson;
      if (!files || files.length !== 2)
        throw new CasePrerequisiteError("material", "缺少损坏 JSON 与空对象 JSON 两个独立样本");
      const content = await Promise.all(files.map((file) => readFile(file, "utf8")));
      if (content[0].trim() !== "{" || content[1].trim() !== "{}")
        throw new CasePrerequisiteError("material", "AGC 错误样本内容须分别为 { 与 {}");
      const key = prefix + "serviceConfigPath";
      originals[key] = (await form.read(key)).value;
      const packageKey = prefix + "packageName";
      originals[packageKey] = (await form.read(packageKey)).value;
      await form.cancelFileChoice(key);
      for (const file of files) {
        await sample(key, [[file]]);
        if ((await form.read(packageKey)).value !== originals[packageKey])
          throw new Error("选择路径意外改变 AGC UI 包名");
      }
      e.checkpoints.push({ key, state: "cancel-and-path-readback; SDK-parse-not-executed" });
      break;
    }
    case "conditional.validation.signing": {
      const native = ["android", "google-play", "huawei-agc"].includes(form.platform);
      const parent = prefix + (native ? "useDebugKeystore" : "useDebugKey");
      const children = (
        native
          ? ["keystorePath", "keystorePassword", "keystoreAlias", "keystoreAliasPassword"]
          : ["privatePemPath", "certificatePemPath"]
      ).map((k) => prefix + k);
      originals[parent] = (await form.read(parent)).value;
      for (const key of children) originals[key] = (await form.read(key)).value;
      if (native && originals[parent] === true && children.some((key) => originals[key] !== ""))
        throw new CasePrerequisiteError(
          "initial-state",
          "签名专项要求调试签名且四项为空；不清除已有值制造初态",
        );
      await form.set(parent, false);
      for (const key of children) {
        await sample(key, [[""]]);
        const errors = await form.alerts(key);
        if (native && form.platform !== "huawei-agc" && errors.length === 0)
          throw new Error("签名缺项没有已实现的空值提示");
        if (form.platform === "huawei-agc" && errors.length)
          throw new Error("AGC 出现与当前表单合同不同的签名提示");
        await form.set(key, originals[key]);
      }
      if (native) await sample(prefix + "keystorePassword", [["qa_wrong_password"]]);
      await form.set(parent, true);
      if (native)
        for (const key of children) {
          const control = await form.read(key);
          if (control.value !== "" || !control.disabled)
            throw new Error("调试签名返回后四项未清空/禁用");
        }
      e.checkpoints.push({ key: parent, state: "UI-only; password-authenticity-not-verified" });
      break;
    }
    default:
      throw new Error(`没有定义 UI 场景执行：${c.scenario}`);
  }
}

async function restoreValues(
  form: BuilderConfiguration,
  values: CaseValues,
  paths: Map<string, string>,
) {
  // Restore only fields this conditional case touched; never replace a preference file.
  const copy = { ...values };
  const scenes = copy.scenes;
  delete copy.scenes;
  const scratch: FinalEvidence = {
    revision: "restore",
    group: "conditional",
    endpoint: "ui",
    values: {},
    changed: [],
    preserved: [],
    checkpoints: [],
    restoration: "pending",
  };
  try {
    const prefix = `packages.${form.platform}.`;
    // Restore editable children before a parent hides/disables them.
    const disabledParents: Array<[string, boolean, string[]]> = [
      ["binGroupConfig.enable", false, ["binGroupConfig.threshold"]],
      ["md5Cache", false, ["md5CacheOptions.handleTemplateMd5Link"]],
      [prefix + "resizeableActivity", true, [prefix + "maxAspectRatio"]],
      [prefix + "globalAdapter", true, [prefix + "globalVariable"]],
      [prefix + "encrypted", false, [prefix + "xxteaKey", prefix + "compressZip"]],
    ];
    for (const [parent, disabledValue, children] of disabledParents) {
      if (copy[parent] !== disabledValue || !children.some((key) => key in copy)) continue;
      if (parent.endsWith(".encrypted") && (await form.inspect("debug"))?.value === true)
        await form.set("debug", false);
      await form.set(parent, !disabledValue);
      for (const key of children)
        if (key in copy) {
          await form.set(key, copy[key]);
          delete copy[key];
        }
    }
    await assign(form, copy, paths, scratch, {});
    if (scenes && Array.isArray(scenes))
      await form.set(
        "scenes",
        scenes.map((id) => paths.get(String(id)) ?? String(id)),
      );
  } catch {
    throw new Error("条件用例配置恢复失败；停止后续提交，保留当前现场");
  }
}

export async function restoreFinalizedCase(
  builder: Builder,
  item: BuildCase,
  prepared: FinalPrepared,
  project: string,
  signal: AbortSignal,
) {
  if (!item.finalized?.scenario || prepared.evidence.restoration === "passed") return;
  const form = await BuilderConfiguration.open(builder, prepared.session, item.platform, signal);
  try {
    await restoreValues(form, prepared.restoreValues, await scenePaths(project));
    prepared.evidence.restoration = "passed";
  } catch (error) {
    prepared.evidence.restoration = "failed";
    throw error;
  }
  await form.close();
}

export { assertBuildTaskValues as assertFinalizedTask } from "./build-task-values.js";
