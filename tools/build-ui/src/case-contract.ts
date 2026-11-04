import type { ConfigurationTarget } from "./configuration-targets.js";
export type InputValue = string | number | boolean | InputValue[] | { [key: string]: InputValue };
export type InputValues = Record<string, InputValue>;
export type GroupId = "publish" | "debug" | "mixed" | "conditional";
export interface FormValidationExecution {
  kind: "field-input" | "parent-visibility" | "required-choice" | "cancel-file" | "scene-clear-all";
  field: string;
  value?: InputValue;
  input?: string;
  setup?: Array<{ field: string; value: InputValue }>;
  prepare?: Array<{ field: string; value: InputValue }>;
  alert?: { kind: "none" | "contains"; text?: string };
  child?: string;
  trigger?: "input" | "reopen";
  requiresNonEmpty?: string[];
  unchanged?: string[];
  after?: Array<{ field: string; value: InputValue; disabled?: boolean }>;
}
export interface FormValidationSample {
  id: string;
  title: string;
  platforms: string[];
  kind?: "applicability-only";
  execution?: FormValidationExecution;
  executionByPlatform?: Record<string, FormValidationExecution>;
  executionBlocker?: string;
  executionBlockerKind?: "material" | "ui-adapter";
  [key: string]: unknown;
}
export interface FormValidationDocument {
  schemaVersion: 1;
  revision: string;
  cases: Array<{
    id: string;
    title: string;
    platforms: string[];
    samples: FormValidationSample[];
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}
export interface FieldType {
  kind: "boolean" | "string" | "number" | "array" | "object" | "scalar";
  valueKinds?: Array<"string" | "number" | "boolean">;
  choices?: Array<string | number | boolean>;
  sensitive?: boolean;
}
export interface CatalogCombo {
  id: string;
  template: GroupId;
  title: string;
  values: InputValues;
  variants: Array<{ title: string; values: InputValues; retained?: string[] }>;
  fieldCoverage?: Record<string, { state: "specified" | "retain" | "pending" }>;
  configurationOrder?: string[];
  excludedFields?: string[];
  [key: string]: unknown;
}
export interface CatalogScenario {
  id: string;
  title: string;
  platforms: string[];
  representativePlatforms: string[];
  executionEndpoint: "build" | "ui";
  valuesByPlatform: Record<string, InputValues>;
  materials: string[];
  pendingQuestion?: string;
  fieldKeys?: string[];
  fieldKeysByPlatform?: Record<string, string[]>;
  retainedByPlatform?: Record<string, string[]>;
  requiresBinding?: boolean;
  executionOperation?: "configure-and-restore";
  [key: string]: unknown;
}
export interface CatalogDocument {
  schemaVersion: 1;
  revision: string;
  targets?: ConfigurationTarget[];
  executionOrder?: string[];
  formValidation?: FormValidationDocument;
  fieldTypes: Record<string, FieldType>;
  templates: Array<{ id: GroupId; title: string; values: InputValues; [key: string]: unknown }>;
  platforms: Array<{
    id: string;
    label: string;
    combinations: CatalogCombo[];
    [key: string]: unknown;
  }>;
  conditionalScenarios: CatalogScenario[];
  [key: string]: unknown;
}

/** Pure, self-contained contract: the generator embeds this same function in the HTML. */
export function createCaseContract() {
  const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  const fail = (path: string, message: string): never => {
    throw new Error(`${path}：${message}`);
  };
  const groups = ["publish", "debug", "mixed", "conditional"];
  function reference(value: unknown): { kind: "material" | "scene"; name: string } | undefined {
    if (!object(value)) return;
    const keys = Object.keys(value);
    if (keys.length !== 1) return;
    if (typeof value.$material === "string") return { kind: "material", name: value.$material };
    if (typeof value.$scene === "string") return { kind: "scene", name: value.$scene };
  }
  function validateValue(key: string, value: unknown, type: FieldType, path = key): void {
    const ref = reference(value);
    if (ref) {
      if (ref.kind === "material" && !/^[A-Za-z_][\w.-]*$/.test(ref.name))
        fail(path, "材料引用无效");
      if (ref.kind === "scene" && !["primary", "secondary"].includes(ref.name))
        fail(path, "场景角色只支持 primary/secondary");
      if (ref.kind === "scene" && key !== "startScene" && key !== "scenes")
        fail(path, "场景引用只能用于场景字段");
      return;
    }
    if (object(value) && Object.keys(value).some((k) => k.startsWith("$")))
      fail(path, "未知引用格式");
    if (type.kind === "array") {
      if (!Array.isArray(value)) fail(path, "必须是数组");
      for (const [i, v] of (value as unknown[]).entries()) {
        if (reference(v)) validateValue(key, v, { kind: "string" }, `${path}[${i}]`);
        else if (typeof v !== "string") fail(`${path}[${i}]`, "数组元素必须是字符串或引用");
      }
    } else if (type.kind === "object") {
      if (!object(value)) fail(path, "必须是对象");
    } else if (
      !(type.kind === "scalar"
        ? type.valueKinds?.some((kind) => typeof value === kind)
        : typeof value === type.kind) ||
      (typeof value === "number" && !Number.isFinite(value))
    )
      fail(path, `必须是 ${type.kind === "scalar" ? type.valueKinds?.join("/") : type.kind}`);
    if (type.choices && !type.choices.includes(value as string | number | boolean))
      fail(path, "不是已声明的合法候选");
  }
  function validate(value: unknown): CatalogDocument {
    if (!object(value) || value.schemaVersion !== 1) fail("schemaVersion", "仅支持用例格式版本 1");
    const doc = value as unknown as CatalogDocument;
    if (Object.hasOwn(doc, "bindings")) fail("bindings", "私有材料不能写入公共用例文档");
    if (typeof doc.revision !== "string" || !doc.revision.trim()) fail("revision", "需要修订标记");
    if (!object(doc.fieldTypes)) fail("fieldTypes", "需要字段合同");
    for (const [key, type] of Object.entries(doc.fieldTypes)) {
      if (
        !object(type) ||
        !["boolean", "string", "number", "array", "object", "scalar"].includes(type.kind)
      )
        fail(`fieldTypes.${key}`, "字段类型无效");
      if (
        type.kind === "scalar"
          ? !Array.isArray(type.valueKinds) ||
            type.valueKinds.length < 2 ||
            new Set(type.valueKinds).size !== type.valueKinds.length ||
            type.valueKinds.some((kind) => !["string", "number", "boolean"].includes(kind))
          : type.valueKinds !== undefined
      )
        fail(`fieldTypes.${key}`, "混合标量需要显式且不重复的基本类型集合");
      if (
        type.choices !== undefined &&
        (!Array.isArray(type.choices) ||
          type.choices.some((v) => !["string", "number", "boolean"].includes(typeof v)))
      )
        fail(`fieldTypes.${key}`, "候选必须是基本值数组");
    }
    const values = (v: unknown, path: string, platform?: string) => {
      if (!object(v)) fail(path, "需要目标值对象");
      for (const [key, target] of Object.entries(v as object)) {
        const type = doc.fieldTypes[key];
        if (!type) fail(`${path}.${key}`, "未知字段，需要补字段适配合同");
        if (
          platform &&
          key.startsWith("packages.") &&
          !key.startsWith(`packages.${platform}.`) &&
          !key.startsWith("packages.localization-editor.")
        )
          fail(`${path}.${key}`, "字段属于其他平台");
        if (/(?:password|appkey|token|secret)$/i.test(key) && target !== "" && !reference(target))
          fail(`${path}.${key}`, "私密输入必须引用本机材料，不能写入公共用例");
        validateValue(key, target, type, `${path}.${key}`);
      }
    };
    if (!Array.isArray(doc.templates) || doc.templates.length !== 4)
      fail("templates", "需要四个公共组合");
    const templateIds = new Set<string>();
    for (const t of doc.templates) {
      if (!object(t) || !groups.includes(t.id) || templateIds.has(t.id))
        fail("templates", "组合类型无效或重复");
      if (typeof t.title !== "string" || !t.title.trim())
        fail(`templates.${t.id}.title`, "需要组合名称");
      templateIds.add(t.id);
      values(t.values, `templates.${t.id}.values`);
    }
    if (!Array.isArray(doc.platforms) || !doc.platforms.length)
      fail("platforms", "至少需要一个平台");
    const platforms = new Set<string>(),
      ids = new Set<string>();
    for (const p of doc.platforms) {
      if (!object(p) || typeof p.id !== "string" || !p.id || platforms.has(p.id))
        fail("platforms", "平台身份无效或重复");
      platforms.add(p.id);
      if (typeof p.label !== "string" || !p.label.trim())
        fail(`platforms.${p.id}.label`, "需要平台显示名");
      if (!Array.isArray(p.combinations) || p.combinations.length !== 4)
        fail(`platforms.${p.id}`, "需要四个组合入口");
      const seen = new Set<string>();
      for (const c of p.combinations) {
        if (
          !object(c) ||
          typeof c.id !== "string" ||
          !c.id ||
          ids.has(c.id) ||
          !groups.includes(c.template) ||
          seen.has(c.template)
        )
          fail(`platforms.${p.id}.combinations`, "用例ID/组合类型无效或重复");
        ids.add(c.id);
        seen.add(c.template);
        if (typeof c.title !== "string" || !c.title.trim()) fail(c.id, "需要用例名称");
        if (c.fieldCoverage !== undefined) {
          if (!object(c.fieldCoverage)) fail(c.id, "fieldCoverage 必须是对象");
          for (const [key, coverage] of Object.entries(c.fieldCoverage))
            if (!object(coverage) || !["specified", "retain", "pending"].includes(coverage.state))
              fail(`${c.id}.${key}`, "覆盖状态无效");
        }
        values(c.values, c.id, p.id);
        if (!Array.isArray(c.variants)) fail(c.id, "variants 必须是数组");
        for (const [i, variant] of c.variants.entries()) {
          values(variant.values, `${c.id}.variant-${i + 1}`, p.id);
          if (c.excludedFields?.some((key) => Object.hasOwn(variant.values, key)))
            fail(c.id, "变体不能配置不适用字段");
          if (
            variant.retained !== undefined &&
            (!Array.isArray(variant.retained) ||
              variant.retained.some(
                (key) => !doc.fieldTypes[key] || Object.hasOwn(variant.values, key),
              ))
          )
            fail(c.id, "变体保留字段无效或同时声明了赋值");
        }
        for (const key of c.configurationOrder ?? [])
          if (!doc.fieldTypes[key]) fail(`${c.id}.configurationOrder`, `未知字段 ${key}`);
        if (
          c.excludedFields !== undefined &&
          (!Array.isArray(c.excludedFields) || c.excludedFields.some((key) => !doc.fieldTypes[key]))
        )
          fail(`${c.id}.excludedFields`, "需要已知字段数组");
        if (c.excludedFields?.some((key) => Object.hasOwn(c.values, key)))
          fail(c.id, "不适用字段不能同时配置目标值");
      }
    }
    if (!Array.isArray(doc.conditionalScenarios)) fail("conditionalScenarios", "需要条件场景数组");
    for (const s of doc.conditionalScenarios) {
      if (!object(s) || typeof s.id !== "string" || !s.id || ids.has(s.id))
        fail("conditionalScenarios", "条件场景身份无效或重复");
      ids.add(s.id);
      if (typeof s.title !== "string" || !s.title.trim()) fail(s.id, "需要条件场景名称");
      if (!["build", "ui"].includes(s.executionEndpoint))
        fail(s.id, "需要明确 executionEndpoint: build/ui");
      if (s.executionOperation !== undefined && s.executionOperation !== "configure-and-restore")
        fail(s.id, "未知操作能力，需要适配");
      if (
        !Array.isArray(s.platforms) ||
        !Array.isArray(s.representativePlatforms) ||
        s.platforms.some((p) => !platforms.has(p)) ||
        s.representativePlatforms.some((p) => !s.platforms.includes(p))
      )
        fail(s.id, "条件场景平台无效");
      if (s.retainedByPlatform) {
        for (const [pid, keys] of Object.entries(s.retainedByPlatform))
          if (
            !s.platforms.includes(pid) ||
            !Array.isArray(keys) ||
            keys.some(
              (key) => !doc.fieldTypes[key] || Object.hasOwn(s.valuesByPlatform?.[pid] ?? {}, key),
            )
          )
            fail(s.id, "条件场景保留字段无效或同时声明了赋值");
      }
      if (!object(s.valuesByPlatform)) fail(s.id, "需要各平台目标值");
      for (const [pid, v] of Object.entries(s.valuesByPlatform)) {
        if (!s.platforms.includes(pid)) fail(s.id, `目标值的平台不适用 ${pid}`);
        values(v, `${s.id}.${pid}`, pid);
      }
    }
    if (doc.formValidation !== undefined) {
      const f = doc.formValidation;
      if (
        !object(f) ||
        f.schemaVersion !== 1 ||
        typeof f.revision !== "string" ||
        !f.revision.trim() ||
        !Array.isArray(f.cases)
      )
        fail("formValidation", "需要版本1的反向样本文档");
      const formIds = new Set<string>();
      for (const c of f.cases) {
        if (
          !object(c) ||
          typeof c.id !== "string" ||
          !c.id.startsWith("FORM-") ||
          formIds.has(c.id) ||
          !Array.isArray(c.platforms) ||
          c.platforms.some((p) => !platforms.has(p)) ||
          !Array.isArray(c.samples)
        )
          fail("formValidation.cases", "检查点身份或平台无效");
        formIds.add(c.id);
        for (const s of c.samples) {
          if (
            !object(s) ||
            typeof s.id !== "string" ||
            !s.id.startsWith(c.id + ".") ||
            formIds.has(s.id) ||
            !Array.isArray(s.platforms) ||
            !s.platforms.length ||
            s.platforms.some((p) => !c.platforms.includes(p))
          )
            fail(c.id, "反向样本身份或平台无效");
          formIds.add(s.id);
          if (
            s.executionBlockerKind !== undefined &&
            !["material", "ui-adapter"].includes(s.executionBlockerKind)
          )
            fail(s.id, "受阻分类无效");
          if (s.execution !== undefined && s.executionByPlatform !== undefined)
            fail(s.id, "公共与平台操作不能同时定义");
          if (
            s.executionByPlatform !== undefined &&
            (!object(s.executionByPlatform) ||
              Object.keys(s.executionByPlatform).length !== s.platforms.length ||
              Object.keys(s.executionByPlatform).some((p) => !s.platforms.includes(p)))
          )
            fail(s.id, "平台操作必须明确对应样本适用平台");
          const variants = s.executionByPlatform
            ? Object.entries(s.executionByPlatform).map(([p, execution]) => ({
                platforms: [p],
                execution,
              }))
            : s.execution !== undefined
              ? [{ platforms: s.platforms, execution: s.execution }]
              : [];
          for (const variant of variants) {
            const e = variant.execution;
            if (
              !object(e) ||
              ![
                "field-input",
                "parent-visibility",
                "required-choice",
                "cancel-file",
                "scene-clear-all",
              ].includes(e.kind)
            )
              fail(s.id, "未知反向操作；不接受脚本或构建动作");
            for (const key of Object.keys(e))
              if (
                ![
                  "kind",
                  "field",
                  "value",
                  "input",
                  "setup",
                  "prepare",
                  "alert",
                  "child",
                  "trigger",
                  "requiresNonEmpty",
                  "unchanged",
                  "after",
                ].includes(key)
              )
                fail(s.id, `未知反向操作属性 ${key}`);
            if (s.kind === "applicability-only") fail(s.id, "范围说明不能同时声明执行");
            if (
              e.requiresNonEmpty !== undefined &&
              (!Array.isArray(e.requiresNonEmpty) ||
                e.requiresNonEmpty.some((k) => typeof k !== "string"))
            )
              fail(s.id, "非空初态字段无效");
            if (
              e.unchanged !== undefined &&
              (!Array.isArray(e.unchanged) || e.unchanged.some((k) => typeof k !== "string"))
            )
              fail(s.id, "保持不变字段需要已注册字段数组");
            if (
              e.after !== undefined &&
              (!Array.isArray(e.after) ||
                e.after.some(
                  (a) =>
                    !object(a) ||
                    typeof a.field !== "string" ||
                    !Object.hasOwn(a, "value") ||
                    reference(a.value) ||
                    (a.disabled !== undefined && typeof a.disabled !== "boolean"),
                ))
            )
              fail(s.id, "联动断言需要字段、具体预期值及可选禁用状态");
            const fields = [
              e.field,
              ...(e.child ? [e.child] : []),
              ...(e.requiresNonEmpty ?? []),
              ...(e.unchanged ?? []),
              ...(e.after ?? []).map((a) => a.field),
            ];
            for (const p of variant.platforms) {
              for (const key of fields) {
                if (typeof key !== "string" || !doc.fieldTypes[key]) fail(s.id, "反向字段未注册");
                if (
                  key.startsWith("packages.") &&
                  !key.startsWith(`packages.${p}.`) &&
                  !key.startsWith("packages.localization-editor.")
                )
                  fail(s.id, "反向字段属于其他平台");
              }
              if (e.value !== undefined) values({ [e.field]: e.value }, s.id, p);
              for (const a of e.after ?? []) values({ [a.field]: a.value }, s.id, p);
              if (e.setup !== undefined && !Array.isArray(e.setup))
                fail(s.id, "setup 需要有序字段赋值数组");
              for (const a of e.setup ?? []) {
                if (!object(a) || typeof a.field !== "string" || !Object.hasOwn(a, "value"))
                  fail(s.id, "前提赋值无效");
                values({ [a.field]: a.value }, s.id, p);
              }
              if (e.prepare !== undefined && !Array.isArray(e.prepare))
                fail(s.id, "prepare 需要显式临时初态数组");
              for (const a of e.prepare ?? []) {
                if (!object(a) || typeof a.field !== "string" || !Object.hasOwn(a, "value"))
                  fail(s.id, "临时初态赋值无效");
                values({ [a.field]: a.value }, s.id, p);
              }
            }
            if (new Set((e.prepare ?? []).map((a) => a.field)).size !== (e.prepare ?? []).length)
              fail(s.id, "临时初态字段不能重复");
            if (
              new Set((e.setup ?? []).map((a) => a.field)).size !== (e.setup ?? []).length ||
              e.setup?.some((a) => a.field === e.field)
            )
              fail(s.id, "前提赋值不能重复或与测试字段混用");
            if (["field-input", "parent-visibility"].includes(e.kind) && !Object.hasOwn(e, "value"))
              fail(s.id, "缺少目标值");
            if (e.kind === "parent-visibility" && (!e.child || typeof e.value !== "boolean"))
              fail(s.id, "显隐检查需要父开关和子字段");
            if (e.input !== undefined && typeof e.input !== "string")
              fail(s.id, "输入文本必须为字符串");
            if (
              e.input !== undefined &&
              !(
                e.kind === "field-input" &&
                e.input === "" &&
                doc.fieldTypes[e.field].kind === "number" &&
                e.value === 0
              )
            )
              fail(s.id, "独立输入文本仅用于数值清空转零，不允许绕过目标值和私密材料校验");
            if (e.trigger !== undefined && !["input", "reopen"].includes(e.trigger))
              fail(s.id, "未知提示触发方式");
            if (e.trigger === "reopen" && e.kind !== "field-input")
              fail(s.id, "只有字段输入可声明重开触发");
            if (e.child !== undefined && e.kind !== "parent-visibility")
              fail(s.id, "子项检查只适用于父项显隐");
            if (
              ["required-choice", "cancel-file", "scene-clear-all"].includes(e.kind) &&
              (e.value !== undefined || e.alert !== undefined)
            )
              fail(s.id, "只读选择/文件取消操作不接受未执行的赋值或提示断言");
            if (e.kind === "scene-clear-all" && e.field !== "scenes")
              fail(s.id, "全不选操作仅适用于场景列表");
            if (e.kind === "field-input" && !e.alert) fail(s.id, "输入样本需要明确提示断言");
            if (
              e.alert &&
              (!object(e.alert) ||
                !["none", "contains"].includes(e.alert.kind) ||
                (e.alert.kind === "contains" &&
                  (typeof e.alert.text !== "string" || !e.alert.text.trim())))
            )
              fail(s.id, "提示断言无效");
          }
        }
      }
    }
    return doc;
  }
  function normalize(value: unknown): CatalogDocument {
    const doc = structuredClone(validate(value));
    for (const platform of doc.platforms)
      for (const combo of platform.combinations) {
        combo.values = {
          ...doc.templates.find((t) => t.id === combo.template)!.values,
          ...combo.values,
        };
        for (const key of combo.excludedFields ?? []) delete combo.values[key];
      }
    return doc;
  }
  function orderedKeys(values: InputValues, requested: string[] = []): string[] {
    const first = [
      "name",
      "buildPath",
      "outputName",
      "engineModulesConfigKey",
      "overwriteProjectSettings.includeModules.physics",
      "overwriteProjectSettings.includeModules.physics-2d",
      "overwriteProjectSettings.includeModules.gfx-webgl2",
      "overwriteProjectSettings.macroConfig.cleanupImageCache",
      "nativeCodeBundleMode",
      "server",
      "mainBundleIsRemote",
      "mainBundleCompressionType",
      "md5Cache",
    ];
    const last = ["startScene", "scenes", "debug"];
    const parents = [
      "resizeableActivity",
      "useDebugKeystore",
      "useDebugKey",
      "encrypted",
      "globalAdapter",
      "customIcon",
    ];
    const remainder = Object.keys(values).filter(
      (key) => !first.includes(key) && !last.includes(key),
    );
    const rank = (key: string) =>
      requested.includes(key) ? requested.indexOf(key) : requested.length;
    remainder.sort(
      (a, b) =>
        Number(parents.includes(b.split(".").at(-1)!)) -
          Number(parents.includes(a.split(".").at(-1)!)) || rank(a) - rank(b),
    );
    return [...first, ...remainder, ...last].filter((key) => Object.hasOwn(values, key));
  }
  return { validate, normalize, validateValue, reference, orderedKeys };
}

export const caseContract = createCaseContract();
