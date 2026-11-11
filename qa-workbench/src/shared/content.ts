import { z } from "zod";
import {
  actionDescriptionSchema,
  routeNodeSchema,
  flattenRoute,
  validateRoute,
} from "./routeTree.js";

const text = z.string().max(50000);
const id = z.string().min(1).max(300);
export const detailSchema = z
  .array(
    z.object({
      title: text,
      fields: z.array(z.object({ label: text, value: text })).max(300),
    }),
  )
  .max(50);
export const contentStepSchema = z.object({
  id,
  title: z.string().trim().min(1).max(2000),
  action: text,
  expected: text,
  group: text.optional(),
  target: text.optional(),
});
export const contentUnitSchema = z
  .object({
    id,
    title: z.string().trim().min(1).max(2000),
    summary: text.default(""),
    details: detailSchema.default([]),
    stages: z
      .array(z.string().min(1).max(300))
      .min(1)
      .max(50)
      .default(["准备", "执行检查", "整理结果"]),
    steps: z.array(contentStepSchema).max(500),
    outline: z.array(routeNodeSchema).max(500).optional(),
  })
  .superRefine((unit, ctx) => {
    if (unit.outline) {
      const message = validateRoute(unit.outline);
      if (message) ctx.addIssue({ code: "custom", message });
    }
  })
  .transform((unit) => ({
    ...unit,
    // The tree is authoritative; steps are a projection for existing runs and exports.
    steps: unit.outline
      ? flattenRoute(unit.outline).map((s) => ({
          id: s.id,
          title: s.title,
          action: s.action,
          expected: s.expected,
          group: s.path.join(" / "),
          target: s.target,
        }))
      : unit.steps,
  }));
export const contentSchema = z
  .object({
    kind: z.literal("qa-test-content"),
    schemaVersion: z.literal(1),
    id,
    name: z.string().trim().min(1).max(300),
    actionDescriptions: z.array(actionDescriptionSchema).max(100).optional(),
    groups: z
      .array(
        z.object({
          id,
          title: z.string().trim().min(1).max(300),
          units: z.array(contentUnitSchema).max(500),
          parentId: id.optional(),
        }),
      )
      .max(100),
  })
  .superRefine((value, ctx) => {
    for (const group of value.groups) {
      const visited = new Set([group.id]);
      let parent = group.parentId;
      while (parent) {
        const owner = value.groups.find((g) => g.id === parent);
        if (!owner || visited.has(parent)) {
          ctx.addIssue({ code: "custom", message: "目录父级不存在或存在循环" });
          break;
        }
        visited.add(parent);
        parent = owner.parentId;
      }
    }
    const ids = value.groups.map((g) => g.id),
      units = value.groups.flatMap((g) => g.units);
    if (
      new Set(ids).size !== ids.length ||
      new Set(units.map((u) => u.id)).size !== units.length ||
      units.some(
        (u) => new Set(u.steps.map((s) => s.id)).size !== u.steps.length,
      )
    )
      ctx.addIssue({ code: "custom", message: "分组、测试单元或步骤 ID 重复" });
  });
export const mountSchema = z.object({
  id,
  name: text,
  sourceName: text,
  content: contentSchema,
  editor: z
    .object({
      moduleId: z.string(),
      descriptionHash: z.string(),
      document: z.record(z.string(), z.unknown()),
      documentHash: z.string(),
      lastSelection: z.string().optional(),
      labels: z.record(z.string(), z.string().max(300)).optional(),
      organization: z
        .object({
          folders: z.array(
            z.object({
              id: z.string(),
              title: z.string(),
              parent: z.string().optional(),
            }),
          ),
          parents: z.record(z.string(), z.string()),
        })
        .optional(),
      review: z
        .object({
          documentHash: z.string(),
          definitionIds: z.array(z.string()),
          reviewedAt: z.string(),
        })
        .optional(),
    })
    .optional(),
});
export type TestContent = z.infer<typeof contentSchema>;
export type ContentUnit = z.infer<typeof contentUnitSchema>;
export type Mount = z.infer<typeof mountSchema>;
export type Detail = z.infer<typeof detailSchema>;

// Match the visible library order when a new run selects multiple routes.
export function orderedContentGroups(
  content: TestContent,
): TestContent["groups"] {
  const visit = (parentId?: string): TestContent["groups"] =>
    content.groups
      .filter((group) => group.parentId === parentId)
      .flatMap((group) => [group, ...visit(group.id)]);
  return visit();
}
