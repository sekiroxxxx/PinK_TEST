import type {
  EditCommand,
  EditField,
  EditNode,
} from "../../features/structured/authoring";
import {
  initialParameter,
  type ParameterSchema,
} from "../../features/structured/SchemaInput";

type Obj = Record<string, unknown>;
const object = (value: unknown): Obj =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Obj)
    : {};

// This is an editor projection of the module's target schema. The module still
// validates matching, supported controls, dependencies and executable inputs.
export function standardTargets(
  root: string,
  schema: ParameterSchema,
  labels: Record<string, string>,
) {
  const targetSchema = schema.items;
  const properties = targetSchema?.properties || {};
  const fieldSchema = properties.fields?.additionalProperties;
  const categoryDisplayOnly =
    !!properties.category && !targetSchema?.required?.includes("category");
  const retainedKeys = [
    "id",
    "fields",
    ...(categoryDisplayOnly ? ["category"] : []),
  ];
  const headerSchema = (editing: boolean): ParameterSchema => ({
    ...targetSchema,
    properties: Object.fromEntries(
      Object.entries(properties).filter(
        ([key]) =>
          key !== "fields" &&
          (!editing || key !== "id") &&
          (!categoryDisplayOnly || key !== "category"),
      ),
    ),
    required: targetSchema?.required?.filter(
      (key) =>
        key !== "fields" &&
        (!editing || key !== "id") &&
        (!categoryDisplayOnly || key !== "category"),
    ),
  });
  const targets = (doc: Obj) => (doc.targets || []) as Obj[];
  const nodeId = (id: string, field?: string) =>
    JSON.stringify([...JSON.parse(root), id, ...(field ? [field] : [])]);
  const header = (target: Obj) =>
    Object.fromEntries(
      Object.entries(target).filter(([key]) => !retainedKeys.includes(key)),
    );
  const descriptionField = (
    value: unknown,
    spec: ParameterSchema,
  ): EditField => ({
    key: "description",
    label: "匹配描述",
    value,
    control: "schema",
    schema: spec,
    labels,
  });
  return {
    tree(doc: Obj): EditNode {
      return {
        id: root,
        title: "测试对象与配置项",
        selectable: false,
        note: "这里描述要检查的现有页面；执行顺序在操作链路中设置。",
        actions: targetSchema
          ? [
              {
                id: "add-target",
                label: "新增测试对象",
                creates: true,
                schema: headerSchema(false),
                labels,
                initial: initialParameter(headerSchema(false)),
                help: "填写实际页面的卡片名称和配置页标题。新增描述不会在产品中创建平台。",
              },
            ]
          : [],
        children: targets(doc).map((target): EditNode => ({
          id: nodeId(String(target.id)),
          title: String(target.label || target.id),
          badge: "对象描述",
          selectable: false,
          fields: [
            {
              key: "identity",
              label: "对象标识",
              value: target.id,
              control: "readonly",
            },
            descriptionField(header(target), headerSchema(true)),
            ...(categoryDisplayOnly && target.category !== undefined
              ? [
                  {
                    key: "category",
                    label: labels.category || "分类（仅展示）",
                    value: target.category,
                    control: "readonly" as const,
                  },
                ]
              : []),
          ],
          actions: [
            ...(fieldSchema && typeof fieldSchema === "object"
              ? [
                  {
                    id: "add-target-field",
                    label: "新增配置项",
                    creates: true,
                    schema: {
                      type: "object",
                      additionalProperties: false,
                      required: ["fieldKey", "description"],
                      properties: {
                        fieldKey: { type: "string", minLength: 1 },
                        description: fieldSchema,
                      },
                    },
                    labels: {
                      ...labels,
                      fieldKey: "配置项标识",
                      description: "控件与定位",
                    },
                    initial: {
                      fieldKey: "",
                      description: initialParameter(fieldSchema),
                    },
                    help: "按页面中的标准控件填写类型及精确标签或选项键。候选值在检查步骤中填写，不限定为历史选项。",
                  },
                ]
              : []),
            { id: "remove-target", label: "移除对象描述", secondary: true },
          ],
          children: Object.entries(object(target.fields)).map(
            ([key, value]): EditNode => ({
              id: nodeId(String(target.id), key),
              title: String(
                labels[key] || object(object(value).locator).name || key,
              ),
              badge: "配置项描述",
              selectable: false,
              fields: [
                {
                  key: "identity",
                  label: "配置项标识",
                  value: key,
                  control: "readonly",
                },
                ...(fieldSchema && typeof fieldSchema === "object"
                  ? [descriptionField(value, fieldSchema)]
                  : []),
              ],
              actions: [
                {
                  id: "remove-target-field",
                  label: "移除配置项描述",
                  secondary: true,
                },
              ],
            }),
          ),
        })),
      };
    },
    apply(doc: Obj, command: EditCommand) {
      const entries = targets(doc);
      if (command.node === root && command.action === "add-target") {
        const value = object(command.value);
        if (typeof value.id !== "string" || !value.id.trim())
          throw new Error("请填写测试对象标识。");
        if (entries.some((target) => target.id === value.id))
          throw new Error("该对象描述已存在，请在对应对象下新增配置项。");
        doc.targets = [...entries, { ...value, fields: {} }];
        return { document: doc, selection: nodeId(value.id) };
      }
      for (const target of entries) {
        const id = String(target.id);
        if (command.node === nodeId(id)) {
          if (command.action === "set" && command.key === "description") {
            const value = object(command.value);
            for (const key of Object.keys(target))
              if (!retainedKeys.includes(key)) delete target[key];
            Object.assign(
              target,
              Object.fromEntries(
                Object.entries(value).filter(
                  ([key]) => !retainedKeys.includes(key),
                ),
              ),
            );
          } else if (command.action === "add-target-field") {
            const input = object(command.value);
            const key =
              typeof input.fieldKey === "string" ? input.fieldKey : "";
            if (!key.trim()) throw new Error("请填写配置项标识。");
            if (Object.hasOwn(object(target.fields), key))
              throw new Error("该配置项描述已存在，请直接编辑。");
            target.fields = {
              ...object(target.fields),
              [key]: input.description,
            };
            return { document: doc, selection: nodeId(id, key) };
          } else if (command.action === "remove-target") {
            doc.targets = entries.filter((item) => item !== target);
            return { document: doc, selection: root };
          } else return;
          return { document: doc };
        }
        for (const key of Object.keys(object(target.fields))) {
          if (command.node !== nodeId(id, key)) continue;
          if (command.action === "set" && command.key === "description")
            object(target.fields)[key] = command.value;
          else if (command.action === "remove-target-field") {
            delete object(target.fields)[key];
            return { document: doc, selection: nodeId(id) };
          } else return;
          return { document: doc };
        }
      }
    },
  };
}
