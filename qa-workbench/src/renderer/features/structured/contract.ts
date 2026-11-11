import { z } from "zod";
import type { Mount } from "../../../shared/content";

export type Node = {
  id: string;
  label: string;
  kind: string;
  children?: Node[];
  sections?: { id: string; label: string; fields: string[] }[];
  fields?: string[];
  summaryFields?: string[];
  readOnlyDocumentRef?: string | null;
};
const node: z.ZodType<Node> = z.lazy(() =>
  z.object({
    id: z.string(),
    label: z.string(),
    kind: z.string(),
    children: z.array(node).optional(),
    sections: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          fields: z.array(z.string()),
        }),
      )
      .optional(),
    fields: z.array(z.string()).optional(),
    summaryFields: z.array(z.string()).optional(),
    readOnlyDocumentRef: z.string().nullable().optional(),
  }),
);
export const fieldSchema = z.object({
  id: z.string(),
  bindingRef: z.string(),
  label: z.string(),
  valueType: z.string(),
  control: z.string(),
  allowedActions: z.array(z.string()),
  readOnlyReason: z.string().optional(),
  help: z.string().optional(),
  candidates: z
    .object({
      source: z.string(),
      items: z.array(z.object({ value: z.unknown(), label: z.string() })),
    })
    .optional(),
  properties: z
    .array(
      z.object({
        key: z.string(),
        label: z.string().optional(),
        choiceLabels: z.record(z.string(), z.string()).optional(),
        valueType: z.string(),
        control: z.string(),
        choices: z.array(z.string()).optional(),
        requiredWhen: z
          .object({
            property: z.string(),
            equals: z.unknown(),
            scope: z.string(),
          })
          .optional(),
      }),
    )
    .optional(),
  relatedChecks: z
    .array(z.object({ sampleId: z.string(), relation: z.string() }))
    .optional(),
});
export const descriptionSchema = z.object({
  moduleId: z.string(),
  descriptionVersion: z.string(),
  hierarchy: z.array(node),
  fields: z.array(fieldSchema),
  conditions: z.array(
    z.object({
      id: z.string(),
      scope: z.string(),
      when: z.object({ fieldRef: z.string(), equals: z.unknown() }),
      effect: z.object({
        targetField: z.string(),
        editorEnabled: z.boolean(),
        message: z.string(),
      }),
      onUnknown: z.string(),
      mutatesDocument: z.boolean(),
    }),
  ),
  bindings: z.array(z.unknown()),
});
export type Description = z.infer<typeof descriptionSchema>;
export type Field = z.infer<typeof fieldSchema>;
export const changeSchema = z
  .object({
    fieldId: z.string(),
    action: z.string(),
    value: z.unknown().optional(),
  })
  .strict();
export type Change = z.infer<typeof changeSchema>;
export type EditorData = NonNullable<Mount["editor"]>;
export type FieldValue = {
  known: boolean;
  value?: unknown;
  origin: string;
  reason?: string;
};
export type CaseInfo = {
  title: string;
  rows: { label: string; value: string; advanced?: boolean }[];
  blocked?: string;
};
export interface EditorAdapter {
  id: string;
  description: Description;
  descriptionHash: string;
  validate(doc: Record<string, unknown>): void;
  read(doc: Record<string, unknown>, field: Field): FieldValue;
  apply(
    doc: Record<string, unknown>,
    changes: Change[],
  ): Record<string, unknown>;
  caseInfo(doc: Record<string, unknown>, id: string): CaseInfo;
  exportName: string;
}
export async function sha256(text: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export const serialize = (doc: Record<string, unknown>) =>
  JSON.stringify(doc, null, 2);
export function displayValue(value: unknown) {
  return value === ""
    ? "空字符串（测试输入）"
    : typeof value === "boolean"
      ? value
        ? "开启"
        : "关闭"
      : typeof value === "string"
        ? value.trim()
          ? value
          : `空白字符（${value.length} 个）`
        : JSON.stringify(value);
}
export function fieldReason(
  adapter: EditorAdapter,
  doc: Record<string, unknown>,
  field: Field,
) {
  if (!field.allowedActions.length) return field.readOnlyReason || "本字段只读";
  if (!["text", "select", "toggle", "object-form"].includes(field.control))
    return "当前工作台不支持此控件，保留原文";
  for (const r of adapter.description.conditions.filter(
    (r) => r.effect.targetField === field.id,
  )) {
    const parent = adapter.description.fields.find(
      (f) => f.id === r.when.fieldRef,
    );
    if (r.scope !== "configuration-form-only" || r.mutatesDocument || !parent)
      return "依赖规则不可识别，暂只读";
    const v = adapter.read(doc, parent);
    if (!v.known) return "依赖项尚未取得，暂只读";
    if (v.value === r.when.equals && !r.effect.editorEnabled)
      return r.effect.message;
  }
  return undefined;
}
