import { supportedFieldTypes } from "./supported-field-types.js";
import { configurationFamilies } from "./configuration-operations.js";
import type { ParameterSchema } from "./step-parameter-contract.js";

export type ConfigurationScalar = string | number | boolean;
export type ConfigurationScalarKind = "string" | "number" | "boolean";
export type FieldLocator =
  | { kind: "option-key"; key: string }
  | { kind: "label"; name: string }
  | { kind: "role"; role: "textbox" | "spinbutton" | "checkbox" | "combobox"; name: string };
export interface FieldScope {
  section?: string;
  /** Rendered schema sentinels, not the field whose absence is being tested. */
  readyKeys: string[];
}
export interface StandardFieldTarget {
  kind: ConfigurationScalarKind | "scalar";
  valueKinds?: ConfigurationScalarKind[];
  control: "text" | "number" | "boolean" | "enum";
  locator?: FieldLocator;
  scope?: FieldScope;
}

export interface ConfigurationTarget {
  id: string;
  label: string;
  configurationTitle: string;
  category: "X-Device" | "X-Application";
  homeScope?: { readyLabels: string[] };
  fields: Record<string, StandardFieldTarget>;
  families?: Array<{ parent: string; enabled: ConfigurationScalar; children: string[] }>;
}

const textSchema: ParameterSchema = { type: "string", minLength: 1 };
const standardFieldSchema: ParameterSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "control"],
  properties: {
    kind: { enum: ["string", "number", "boolean", "scalar"] },
    valueKinds: {
      type: "array",
      minItems: 2,
      uniqueItems: true,
      items: { enum: ["string", "number", "boolean"] },
    },
    control: { enum: ["text", "number", "boolean", "enum"] },
    locator: {
      oneOf: [
        {
          type: "object",
          required: ["kind", "key"],
          additionalProperties: false,
          properties: { kind: { const: "option-key" }, key: textSchema },
        },
        {
          type: "object",
          required: ["kind", "name"],
          additionalProperties: false,
          properties: { kind: { const: "label" }, name: textSchema },
        },
        {
          type: "object",
          required: ["kind", "role", "name"],
          additionalProperties: false,
          properties: {
            kind: { const: "role" },
            role: { enum: ["textbox", "spinbutton", "checkbox", "combobox"] },
            name: textSchema,
          },
        },
      ],
    },
    scope: {
      type: "object",
      required: ["readyKeys"],
      additionalProperties: false,
      properties: {
        section: textSchema,
        readyKeys: { type: "array", minItems: 1, uniqueItems: true, items: textSchema },
      },
    },
  },
};
const { valueKinds: mixedValueKinds, ...singleFieldProperties } = standardFieldSchema.properties!;
export const configurationTargetSchema: ParameterSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "label", "configurationTitle", "category", "fields"],
  properties: {
    id: { ...textSchema, pattern: "^[a-z][a-z0-9-]*$" },
    label: textSchema,
    configurationTitle: textSchema,
    category: { enum: ["X-Device", "X-Application"] },
    homeScope: {
      type: "object",
      additionalProperties: false,
      required: ["readyLabels"],
      properties: {
        readyLabels: { type: "array", minItems: 1, uniqueItems: true, items: textSchema },
      },
    },
    fields: {
      type: "object",
      additionalProperties: {
        oneOf: [
          {
            ...standardFieldSchema,
            properties: {
              ...singleFieldProperties,
              kind: { enum: ["string", "number", "boolean"] },
            },
          },
          {
            ...standardFieldSchema,
            required: ["kind", "control", "valueKinds"],
            properties: {
              ...singleFieldProperties,
              kind: { const: "scalar" },
              control: { const: "enum" },
              valueKinds: mixedValueKinds,
            },
          },
        ],
      },
    },
    families: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["parent", "enabled", "children"],
        properties: {
          parent: textSchema,
          enabled: { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] },
          children: { type: "array", minItems: 1, uniqueItems: true, items: textSchema },
        },
      },
    },
  },
};

/** Data may name a standard form target, but cannot introduce selectors, scripts or operations. */
export function validateConfigurationTargets(value: unknown): ConfigurationTarget[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("targets 必须是平台描述数组");
  const ids = new Set<string>();
  for (const raw of value) {
    if (
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw) ||
      Object.keys(raw).some(
        (k) =>
          ![
            "id",
            "label",
            "configurationTitle",
            "category",
            "homeScope",
            "fields",
            "families",
          ].includes(k),
      )
    )
      throw new Error("平台描述含不支持的属性");
    const target = raw as ConfigurationTarget;
    if (
      typeof target.id !== "string" ||
      !/^[a-z][a-z0-9-]*$/.test(target.id) ||
      ["constructor", "prototype"].includes(target.id) ||
      ids.has(target.id)
    )
      throw new Error("平台描述 id 无效或重复");
    ids.add(target.id);
    if (
      !["X-Device", "X-Application"].includes(target.category) ||
      [target.label, target.configurationTitle].some((s) => typeof s !== "string" || !s.trim())
    )
      throw new Error("平台描述缺少分类、精确卡片名称或配置页标题");
    if (
      target.homeScope !== undefined &&
      (!target.homeScope ||
        typeof target.homeScope !== "object" ||
        Object.keys(target.homeScope).some((key) => key !== "readyLabels") ||
        !Array.isArray(target.homeScope.readyLabels) ||
        !target.homeScope.readyLabels.length ||
        target.homeScope.readyLabels.some((label) => typeof label !== "string" || !label.trim()) ||
        new Set(target.homeScope.readyLabels).size !== target.homeScope.readyLabels.length)
    )
      throw new Error("主页完整范围需要明确且不重复的就绪卡片名称");
    if (!target.fields || typeof target.fields !== "object" || Array.isArray(target.fields))
      throw new Error("平台 fields 必须是标准字段描述对象，可为空以单独探查平台");
    for (const [key, type] of Object.entries(target.fields)) {
      if (
        !/^[\w.-]+$/.test(key) ||
        key.split(".").some((part) => ["__proto__", "constructor", "prototype"].includes(part)) ||
        (key.startsWith("packages.") && !key.startsWith(`packages.${target.id}.`)) ||
        /password|secret|token|appid|appkey|private/i.test(key)
      )
        throw new Error("标准字段不能覆盖其他平台或声明敏感输入");
      if (
        !type ||
        typeof type !== "object" ||
        Array.isArray(type) ||
        Object.keys(type).some(
          (k) => !["kind", "valueKinds", "control", "locator", "scope"].includes(k),
        ) ||
        !["string", "number", "boolean", "scalar"].includes(type.kind) ||
        !["text", "number", "boolean", "enum"].includes(type.control) ||
        (type.kind === "scalar"
          ? type.control !== "enum" ||
            !Array.isArray(type.valueKinds) ||
            type.valueKinds.length < 2 ||
            new Set(type.valueKinds).size !== type.valueKinds.length ||
            type.valueKinds.some((kind) => !["string", "number", "boolean"].includes(kind))
          : type.valueKinds !== undefined) ||
        (type.control === "enum"
          ? false
          : type.control === "boolean"
            ? type.kind !== "boolean"
            : type.control === "number"
              ? type.kind !== "number"
              : type.kind !== "string")
      )
        throw new Error("新字段仅支持标准文本、数值、布尔或带类型的枚举控件");
      const registered = supportedFieldTypes[key];
      if (
        registered &&
        (registered.sensitive ||
          (registered.kind !== type.kind &&
            !(
              type.kind === "scalar" &&
              type.valueKinds!.includes(registered.kind as ConfigurationScalarKind)
            )))
      )
        throw new Error("标准描述不能覆盖已有字段的类型或敏感性");
      if (type.locator !== undefined) {
        const locator = type.locator;
        if (!locator || typeof locator !== "object" || Array.isArray(locator))
          throw new Error("字段定位需要对象");
        const allowed =
          locator.kind === "option-key"
            ? ["kind", "key"]
            : locator.kind === "label"
              ? ["kind", "name"]
              : ["kind", "role", "name"];
        if (
          Object.keys(locator).some((k) => !allowed.includes(k)) ||
          !["option-key", "label", "role"].includes(locator.kind) ||
          (locator.kind === "option-key"
            ? typeof locator.key !== "string" || !locator.key.trim()
            : typeof locator.name !== "string" || !locator.name.trim()) ||
          (locator.kind === "role" &&
            !["textbox", "spinbutton", "checkbox", "combobox"].includes(locator.role))
        )
          throw new Error("字段定位仅支持精确 key、标签或受限角色与名称");
        if (
          locator.kind === "option-key" &&
          locator.key.startsWith("packages.") &&
          !locator.key.startsWith(`packages.${target.id}.`)
        )
          throw new Error("字段定位不能覆盖其他平台的 key");
      }
      if (
        type.scope !== undefined &&
        (!type.scope ||
          typeof type.scope !== "object" ||
          Array.isArray(type.scope) ||
          !Array.isArray(type.scope.readyKeys) ||
          !type.scope.readyKeys.length ||
          type.scope.readyKeys.some((k) => typeof k !== "string" || !k.trim()) ||
          new Set(type.scope.readyKeys).size !== type.scope.readyKeys.length ||
          (type.scope.section !== undefined &&
            (typeof type.scope.section !== "string" || !type.scope.section.trim())) ||
          Object.keys(type.scope).some((k) => !["section", "readyKeys"].includes(k)))
      )
        throw new Error("字段范围需要明确的就绪 key，可选精确分区名称");
    }
    if (target.families !== undefined) {
      if (!Array.isArray(target.families)) throw new Error("families 必须是联动数组");
      const parents = new Set<string>();
      const children = new Set<string>();
      const known = (key: string) =>
        typeof key === "string" &&
        (Object.hasOwn(target.fields, key) || Object.hasOwn(supportedFieldTypes, key)) &&
        (!key.startsWith("packages.") || key.startsWith(`packages.${target.id}.`));
      for (const family of target.families) {
        if (
          !family ||
          Object.keys(family).some((k) => !["parent", "enabled", "children"].includes(k)) ||
          !known(family.parent) ||
          parents.has(family.parent) ||
          !["string", "number", "boolean"].includes(typeof family.enabled) ||
          !(target.fields[family.parent]?.kind === "scalar"
            ? target.fields[family.parent].valueKinds!.includes(
                typeof family.enabled as ConfigurationScalarKind,
              )
            : typeof family.enabled ===
              (target.fields[family.parent]?.kind ?? supportedFieldTypes[family.parent]?.kind)) ||
          !Array.isArray(family.children) ||
          !family.children.length ||
          family.children.some(
            (key) => !known(key) || key === family.parent || children.has(key),
          ) ||
          new Set(family.children).size !== family.children.length
        )
          throw new Error("联动须声明唯一父项、同平台子项及有类型的启用值");
        if (configurationFamilies([family.parent, ...family.children]).length)
          throw new Error("用例联动不能覆盖已有联动合同");
        parents.add(family.parent);
        family.children.forEach((key) => children.add(key));
      }
      if ([...parents].some((key) => children.has(key)))
        throw new Error("本批联动仅支持平级父子关系，不支持嵌套或循环");
    }
  }
  return structuredClone(value) as ConfigurationTarget[];
}
