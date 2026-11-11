import { useId, useState } from "react";

export type ParameterSchema = {
  type?: string;
  const?: unknown;
  enum?: unknown[];
  oneOf?: ParameterSchema[];
  properties?: Record<string, ParameterSchema>;
  additionalProperties?: boolean | ParameterSchema;
  items?: ParameterSchema;
  required?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  pattern?: string;
  "x-reference"?: string;
};
export function initialParameter(schema: ParameterSchema): unknown {
  if ("const" in schema) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.oneOf) return initialParameter(schema.oneOf[0]);
  if (schema.type === "object")
    return Object.fromEntries(
      (schema.required || []).map((key) => [
        key,
        initialParameter(schema.properties?.[key] || {}),
      ]),
    );
  if (schema.type === "array") return [];
  if (schema.type === "boolean") return false;
  if (schema.type === "number" || schema.type === "integer")
    return schema.minimum ?? 0;
  return "";
}
function matches(schema: ParameterSchema, value: unknown): boolean {
  if ("const" in schema) return value === schema.const;
  if (schema.enum) return schema.enum.includes(value);
  if (schema.oneOf) return schema.oneOf.some((item) => matches(item, value));
  if (schema.type === "array") return Array.isArray(value);
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const object = value as Record<string, unknown>;
    return (
      (schema.required || []).every((key) => Object.hasOwn(object, key)) &&
      Object.entries(schema.properties || {}).every(
        ([key, child]) =>
          !Object.hasOwn(object, key) || matches(child, object[key]),
      )
    );
  }
  if (!schema.type) return true;
  if (schema.type === "integer") return Number.isInteger(value);
  return typeof value === schema.type;
}
function matchesWithConstants(
  schema: ParameterSchema,
  value: unknown,
): boolean {
  if ("const" in schema) return value === undefined || value === schema.const;
  if (schema.oneOf)
    return schema.oneOf.some((item) => matchesWithConstants(item, value));
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const object = value as Record<string, unknown>;
    const properties = schema.properties || {};
    return (
      (schema.required || []).every(
        (key) =>
          Object.hasOwn(object, key) || "const" in (properties[key] || {}),
      ) &&
      Object.entries(properties).every(
        ([key, child]) =>
          !Object.hasOwn(object, key) ||
          matchesWithConstants(child, object[key]),
      )
    );
  }
  return matches(schema, value);
}

// Complete protocol constants, never user inputs or independently chosen expectations.
// Ambiguous unions and conflicting values stay unchanged for module validation.
export function completeParameterConstants(
  schema: ParameterSchema,
  value: unknown,
): unknown {
  if ("const" in schema) return value === undefined ? schema.const : value;
  if (schema.oneOf) {
    const candidates = schema.oneOf.filter((item) =>
      matchesWithConstants(item, value),
    );
    return candidates.length === 1
      ? completeParameterConstants(candidates[0], value)
      : value;
  }
  if (schema.type === "array" && Array.isArray(value) && schema.items) {
    let result = value;
    value.forEach((item, index) => {
      const next = completeParameterConstants(schema.items!, item);
      if (next === item) return;
      if (result === value) result = value.slice();
      result[index] = next;
    });
    return result;
  }
  if (
    schema.type !== "object" ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  )
    return value;
  const object = value as Record<string, unknown>;
  const properties = schema.properties || {};
  const additional =
    typeof schema.additionalProperties === "object"
      ? schema.additionalProperties
      : undefined;
  let result = object;
  for (const key of new Set([
    ...Object.keys(object),
    ...(schema.required || []),
  ])) {
    const child = properties[key] || additional;
    if (!child) continue;
    const next = completeParameterConstants(child, object[key]);
    if (next === object[key]) continue;
    result = { ...result, [key]: next };
  }
  return result;
}
function variantLabel(schema: ParameterSchema, labels: Record<string, string>) {
  const constant = Object.values(schema.properties || {}).find(
    (item) => "const" in item,
  );
  const value = constant?.const;
  return String(
    (value === undefined
      ? undefined
      : labels["choice:" + String(value)] || value) ??
      ({
        string: "文本",
        number: "数值",
        boolean: "布尔值",
        array: "列表",
        object: "对象",
      }[schema.type || ""] ||
        "对象"),
  );
}
export function SchemaInput({
  schema,
  value,
  change,
  label,
  labels = {},
  references = {},
  disabled = false,
}: {
  schema: ParameterSchema;
  value: unknown;
  change: (value: unknown) => void;
  label: string;
  labels?: Record<string, string>;
  references?: Record<string, string[]>;
  disabled?: boolean;
}) {
  const uid = useId();
  const [newKey, setNewKey] = useState("");
  if (!schema.type && !schema.oneOf && !schema.enum && !("const" in schema))
    schema = {
      oneOf: [
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
        { type: "array", items: {} },
        { type: "object", additionalProperties: {} },
      ],
    };
  if (schema.oneOf) {
    const index = Math.max(
      0,
      schema.oneOf.findIndex((item) => matchesWithConstants(item, value)),
    );
    return (
      <div className="parameter-variant">
        <label>
          {label} · 值类型
          <select
            aria-label={label + " · 值类型"}
            disabled={disabled}
            value={index}
            onChange={(event) =>
              change(
                initialParameter(schema.oneOf![Number(event.target.value)]),
              )
            }
          >
            {schema.oneOf.map((item, i) => (
              <option key={i} value={i}>
                {variantLabel(item, labels)}
              </option>
            ))}
          </select>
        </label>
        <SchemaInput
          schema={schema.oneOf[index]}
          value={value}
          change={change}
          label={label}
          labels={labels}
          references={references}
          disabled={disabled}
        />
      </div>
    );
  }
  if ("const" in schema)
    return (
      <p className="hint">
        {label}：
        {labels["choice:" + String(schema.const)] || String(schema.const)}
      </p>
    );
  if (schema.enum)
    return (
      <label className="field">
        {label}
        <select
          aria-label={label}
          disabled={disabled}
          value={JSON.stringify(value) ?? ""}
          onChange={(event) => change(JSON.parse(event.target.value))}
        >
          {!schema.enum.includes(value) && (
            <option value="" disabled>
              请选择
            </option>
          )}
          {schema.enum.map((item) => (
            <option key={JSON.stringify(item)} value={JSON.stringify(item)}>
              {labels["choice:" + String(item)] || String(item)}
            </option>
          ))}
        </select>
      </label>
    );
  if (schema.type === "object") {
    const object =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const properties = schema.properties || {};
    const required = new Set(schema.required || []);
    const additional =
      typeof schema.additionalProperties === "object"
        ? schema.additionalProperties
        : schema.additionalProperties !== false
          ? {}
          : undefined;
    const keys = [
      ...new Set([
        ...Object.keys(properties).filter(
          (key) => required.has(key) || key in object,
        ),
        ...Object.keys(object),
      ]),
    ];
    return (
      <fieldset className="parameter-object" disabled={disabled}>
        <legend>{label}</legend>
        {keys.map((key) => {
          const child = properties[key] || additional;
          return (
            <div className="parameter-entry" key={key}>
              {child ? (
                <SchemaInput
                  schema={child}
                  value={object[key]}
                  change={(next) =>
                    change(
                      completeParameterConstants(schema, {
                        ...object,
                        [key]: next,
                      }),
                    )
                  }
                  label={labels[key] || key}
                  labels={labels}
                  references={references}
                  disabled={disabled}
                />
              ) : (
                <p>
                  {key}：{JSON.stringify(object[key])}（原文保留）
                </p>
              )}
              {!required.has(key) && (
                <button
                  type="button"
                  className="text-button"
                  aria-label={"移除 " + (labels[key] || key)}
                  onClick={() => {
                    const next = { ...object };
                    delete next[key];
                    change(next);
                  }}
                >
                  移除
                </button>
              )}
            </div>
          );
        })}
        {Object.keys(properties).some(
          (key) => !(key in object) && !required.has(key),
        ) && (
          <label className="field">
            补充参数
            <select
              aria-label={label + " · 补充参数"}
              value=""
              onChange={(event) => {
                if (event.target.value)
                  change(
                    completeParameterConstants(schema, {
                      ...object,
                      [event.target.value]: initialParameter(
                        properties[event.target.value],
                      ),
                    }),
                  );
              }}
            >
              <option value="">选择要补充的参数</option>
              {Object.keys(properties)
                .filter((key) => !(key in object) && !required.has(key))
                .map((key) => (
                  <option key={key} value={key}>
                    {labels[key] || key}
                  </option>
                ))}
            </select>
          </label>
        )}
        {additional !== undefined && (
          <div className="toolbar">
            <input
              aria-label={label + " · 新增名称"}
              placeholder="新增名称"
              value={newKey}
              onChange={(event) => setNewKey(event.target.value)}
            />
            <button
              type="button"
              disabled={
                !newKey.trim() ||
                newKey.trim() in object ||
                ["__proto__", "constructor", "prototype"].includes(
                  newKey.trim(),
                )
              }
              onClick={() => {
                change({
                  ...object,
                  [newKey.trim()]: initialParameter(additional),
                });
                setNewKey("");
              }}
            >
              添加条目
            </button>
          </div>
        )}
      </fieldset>
    );
  }
  if (schema.type === "array") {
    const items = Array.isArray(value) ? value : [];
    return (
      <fieldset className="parameter-array" disabled={disabled}>
        <legend>{label}</legend>
        {items.map((item, index) => (
          <div className="parameter-entry" key={index}>
            <SchemaInput
              schema={schema.items || { type: "string" }}
              value={item}
              change={(next) =>
                change(items.map((old, i) => (i === index ? next : old)))
              }
              label={label + " " + (index + 1)}
              labels={labels}
              references={references}
              disabled={disabled}
            />
            <div className="toolbar">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => {
                  const next = [...items];
                  [next[index - 1], next[index]] = [
                    next[index],
                    next[index - 1],
                  ];
                  change(next);
                }}
              >
                上移
              </button>
              <button
                type="button"
                aria-label={"移除 " + label + " " + (index + 1)}
                onClick={() => change(items.filter((_, i) => i !== index))}
              >
                移除
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            change([
              ...items,
              initialParameter(schema.items || { type: "string" }),
            ])
          }
        >
          添加{label}
        </button>
      </fieldset>
    );
  }
  if (schema.type === "boolean")
    return (
      <label className="field">
        {label}
        <select
          aria-label={label}
          disabled={disabled}
          value={value === undefined ? "" : value === true ? "true" : "false"}
          onChange={(event) => change(event.target.value === "true")}
        >
          {value === undefined && (
            <option value="" disabled>
              请选择
            </option>
          )}
          <option value="true">true · 是</option>
          <option value="false">false · 否</option>
        </select>
      </label>
    );
  const numeric = schema.type === "number" || schema.type === "integer";
  const suggestions = schema["x-reference"]
    ? references[schema["x-reference"]]
    : undefined;
  return (
    <label className="field">
      {label}
      <input
        aria-label={label}
        disabled={disabled}
        type={numeric ? "number" : "text"}
        value={
          typeof value === "string" || typeof value === "number" ? value : ""
        }
        min={schema.minimum}
        max={schema.maximum}
        minLength={schema.minLength}
        pattern={schema.pattern}
        list={suggestions?.length ? uid : undefined}
        onChange={(event) =>
          change(
            numeric
              ? event.target.value === ""
                ? ""
                : Number(event.target.value)
              : event.target.value,
          )
        }
      />
      {suggestions?.length ? (
        <datalist id={uid}>
          {suggestions.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      ) : null}
    </label>
  );
}

export function ReadParameters({
  value,
  labels = {},
}: {
  value: unknown;
  labels?: Record<string, string>;
}) {
  if (Array.isArray(value))
    return (
      <ol className="parameter-read-list">
        {value.map((item, index) => (
          <li key={index}>
            <ReadParameters value={item} labels={labels} />
          </li>
        ))}
      </ol>
    );
  if (value && typeof value === "object")
    return (
      <dl className="parameter-read-object">
        {Object.entries(value).map(([key, item]) => (
          <div key={key}>
            <dt>{labels[key] || key}</dt>
            <dd>
              <ReadParameters value={item} labels={labels} />
            </dd>
          </div>
        ))}
      </dl>
    );
  return (
    <span>
      {value === undefined ? "未指定" : value === null ? "null" : String(value)}
    </span>
  );
}
