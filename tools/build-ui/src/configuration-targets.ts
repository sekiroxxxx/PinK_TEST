import { platformCatalog } from "./platform-catalog.js";
import { supportedFieldTypes } from "./supported-field-types.js";

export interface ConfigurationTarget {
  id: string;
  label: string;
  configurationTitle: string;
  category: "X-Device" | "X-Application";
  fields: Record<
    string,
    { kind: "string" | "number" | "boolean"; control: "text" | "number" | "boolean" | "enum" }
  >;
}

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
        (k) => !["id", "label", "configurationTitle", "category", "fields"].includes(k),
      )
    )
      throw new Error("平台描述含不支持的属性");
    const target = raw as ConfigurationTarget;
    if (
      typeof target.id !== "string" ||
      !/^[a-z][a-z0-9-]*$/.test(target.id) ||
      ["constructor", "prototype"].includes(target.id) ||
      ids.has(target.id) ||
      platformCatalog.some((p) => p.id === target.id)
    )
      throw new Error("平台描述 id 无效、重复或试图覆盖已有平台");
    ids.add(target.id);
    if (
      !["X-Device", "X-Application"].includes(target.category) ||
      [target.label, target.configurationTitle].some((s) => typeof s !== "string" || !s.trim())
    )
      throw new Error("平台描述缺少分类、精确卡片名称或配置页标题");
    if (
      !target.fields ||
      typeof target.fields !== "object" ||
      Array.isArray(target.fields) ||
      !Object.keys(target.fields).length
    )
      throw new Error("新平台必须声明至少一个用于核对身份的标准字段");
    for (const [key, type] of Object.entries(target.fields)) {
      if (
        !key.startsWith(`packages.${target.id}.`) ||
        !/^[\w.-]+$/.test(key) ||
        /password|secret|token|appid|appkey|private/i.test(key) ||
        Object.hasOwn(supportedFieldTypes, key)
      )
        throw new Error("新字段须属于当前平台，不能覆盖已有能力或声明敏感输入");
      if (
        !type ||
        typeof type !== "object" ||
        Array.isArray(type) ||
        Object.keys(type).some((k) => !["kind", "control"].includes(k)) ||
        !["string", "number", "boolean"].includes(type.kind) ||
        !["text", "number", "boolean", "enum"].includes(type.control) ||
        (type.control === "boolean"
          ? type.kind !== "boolean"
          : type.control === "number"
            ? type.kind !== "number"
            : type.kind !== "string")
      )
        throw new Error("新字段仅支持标准文本、数值、布尔或字符串枚举控件");
    }
  }
  return structuredClone(value) as ConfigurationTarget[];
}
