import descriptionText from "@editor-description/01-editor-description.example.json?raw";
import catalogText from "@pink-data/public-combinations.json?raw";
import formText from "@pink-data/form-validation-design.json?raw";
import presentationText from "./editor-presentation.json?raw";
import {
  caseContract,
  type CatalogDocument,
  type InputValue,
} from "@pink-build/case-contract";
import { z } from "zod";
import {
  descriptionSchema,
  changeSchema,
  sha256,
  serialize,
  fieldReason,
  type EditorAdapter,
  type Field,
  type Change,
  type EditorData,
} from "../../features/structured/contract";

const bindingSchema = z.object({
  id: z.string(),
  entity: z.object({
    platformId: z.string().optional(),
    combinationId: z.string().optional(),
    caseId: z.string().optional(),
    sampleId: z.string().optional(),
  }),
  literalKey: z.string().optional(),
  allowedExecutionProperties: z.array(z.string()).optional(),
});
const raw = JSON.parse(descriptionText);
const description = descriptionSchema.parse(raw);
// Presentation-only labels do not grant editing or execution capabilities.
const presentation = z
  .record(
    z.string(),
    z.object({
      help: z.string().optional(),
      properties: z.record(
        z.string(),
        z.object({
          label: z.string(),
          choiceLabels: z.record(z.string(), z.string()).optional(),
        }),
      ),
    }),
  )
  .parse(JSON.parse(presentationText));
for (const field of description.fields) {
  const view = presentation[field.id];
  if (view) {
    field.help = view.help || field.help;
    field.properties = field.properties?.map((p) => ({
      ...p,
      ...view.properties[p.key],
    }));
  }
}
const bindings = z.array(bindingSchema).parse(raw.bindings);
const unique = <T>(values: T[], label: string) => {
  if (values.length !== 1) throw new Error(`${label}身份不唯一或不存在`);
  return values[0];
};
function resolve(doc: CatalogDocument, field: Field) {
  const b = unique(
    bindings.filter((b) => b.id === field.bindingRef),
    "字段绑定",
  );
  if (b.entity.combinationId) {
    const p = unique(
      doc.platforms.filter((p) => p.id === b.entity.platformId),
      "平台",
    );
    const c = unique(
      p.combinations.filter((c) => c.id === b.entity.combinationId),
      "组合",
    );
    const t = unique(
      doc.templates.filter((t) => t.id === c.template),
      "模板",
    );
    if (!b.literalKey) throw new Error("缺少机器字段键");
    return { b, c, t, key: b.literalKey };
  }
  const group = unique(
    (doc.formValidation?.cases || []).filter((c) => c.id === b.entity.caseId),
    "检查主题",
  );
  const sample = unique(
    group.samples.filter((s) => s.id === b.entity.sampleId),
    "样本",
  );
  return { b, sample };
}
const readDoc = (doc: Record<string, unknown>) => caseContract.validate(doc);
const adapter: EditorAdapter = {
  id: description.moduleId,
  description,
  descriptionHash: "",
  exportName: "build-cases.edited.json",
  validate(doc) {
    caseContract.validate(doc);
  },
  read(doc, field) {
    const r = resolve(readDoc(doc), field);
    if (r.c && r.key) {
      const coverage = r.c.fieldCoverage?.[r.key]?.state;
      if (coverage === "retain" || coverage === "pending")
        return {
          known: false,
          origin: coverage === "retain" ? "保留回读" : "待确认",
        };
      if (Object.hasOwn(r.c.values, r.key))
        return { known: true, value: r.c.values[r.key], origin: "平台覆盖" };
      if (r.c.excludedFields?.includes(r.key))
        return { known: false, origin: "不适用" };
      if (r.t && Object.hasOwn(r.t.values, r.key))
        return {
          known: true,
          value: r.t.values[r.key],
          origin: "继承公共模板",
        };
      return { known: false, origin: "未指定目标" };
    }
    const property = field.allowedActions.includes("set-sample-alert")
      ? "alert"
      : "value";
    const e = r.sample?.execution;
    return e && Object.hasOwn(e, property)
      ? { known: true, value: e[property], origin: "反向样本定义" }
      : { known: false, origin: "无执行定义" };
  },
  apply(doc, changes) {
    const next = structuredClone(doc);
    const native = readDoc(next);
    for (const rawChange of changes) {
      const change = changeSchema.parse(rawChange);
      const field = unique(
        description.fields.filter((f) => f.id === change.fieldId),
        "编辑字段",
      );
      if (!field.allowedActions.includes(change.action))
        throw new Error("字段不允许此操作");
      const reason = fieldReason(adapter, next, field);
      if (reason) throw new Error(reason);
      const r = resolve(native, field);
      if (r.c && r.key) {
        if (change.action === "set-override") {
          const type = native.fieldTypes[r.key];
          if (!type) throw new Error("字段未声明");
          caseContract.validateValue(
            r.key,
            change.value as InputValue,
            type,
            r.key,
          );
          r.c.values[r.key] = change.value as InputValue;
        } else if (change.action === "restore-inheritance") {
          if (!r.t || !Object.hasOwn(r.t.values, r.key))
            throw new Error("没有可恢复的模板值");
          delete r.c.values[r.key];
        } else throw new Error("组合不支持此编辑动作");
      } else {
        if (!r.sample?.execution) throw new Error("样本缺少执行适配");
        const property =
          change.action === "set-sample-value"
            ? "value"
            : change.action === "set-sample-alert"
              ? "alert"
              : undefined;
        if (!property || !r.b.allowedExecutionProperties?.includes(property))
          throw new Error("样本属性不在白名单");
        if (property === "value") {
          if (typeof change.value !== field.valueType)
            throw new Error("测试输入类型不符");
          r.sample.execution.value = change.value as InputValue;
        } else {
          const alert = z
            .union([
              z.object({ kind: z.literal("none") }).strict(),
              z
                .object({
                  kind: z.literal("contains"),
                  text: z
                    .string()
                    .refine((v) => !!v.trim(), "提示文字不能为空"),
                })
                .strict(),
            ])
            .parse(change.value);
          r.sample.execution.alert = alert;
        }
      }
    }
    caseContract.validate(native);
    return native as unknown as Record<string, unknown>;
  },
  caseInfo(doc, id) {
    const sample = unique(
      (readDoc(doc).formValidation?.cases || [])
        .flatMap((c) => c.samples)
        .filter((s) => s.id === id),
      "样本",
    );
    const rows: { label: string; value: string; advanced?: boolean }[] = [
      { label: "样本 ID", value: sample.id },
    ];
    for (const [key, label] of Object.entries({
      input: "输入说明",
      condition: "前提",
      trigger: "操作",
      prompt: "预期提示",
      recovery: "恢复要求",
    })) {
      if (typeof sample[key] === "string")
        rows.push({ label, value: sample[key] as string });
    }
    if (sample.execution)
      rows.push({
        label: "机器执行定义（不改写）",
        advanced: true,
        value: JSON.stringify(sample.execution, null, 2),
      });
    return { title: sample.title, rows, blocked: sample.executionBlocker };
  },
};
export async function loadBuildExample(): Promise<EditorData> {
  const document = {
    ...JSON.parse(catalogText),
    formValidation: JSON.parse(formText),
  };
  adapter.validate(document);
  return {
    moduleId: adapter.id,
    descriptionHash: await sha256(descriptionText),
    document,
    documentHash: await sha256(serialize(document)),
  };
}
export async function buildEditorAdapter() {
  adapter.descriptionHash = await sha256(descriptionText);
  return adapter;
}
