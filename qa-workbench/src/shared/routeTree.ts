import { z } from "zod";

const text = z.string().max(50000);
const id = z.string().min(1).max(300);
export const actionDescriptionSchema = z.object({
  id,
  label: text,
  summary: text,
  fields: z
    .array(
      z.object({
        key: id,
        label: text,
        type: z.enum(["text", "textarea", "select", "boolean", "number"]),
        required: z.boolean().optional(),
        options: z.array(text).optional(),
        placeholder: text.optional(),
        visibleWhen: z.record(z.string(), text).optional(),
        enabledWhen: z.record(z.string(), text).optional(),
      }),
    )
    .max(100),
});
export type ActionDescription = z.infer<typeof actionDescriptionSchema>;
export type RouteNode = {
  id: string;
  title: string;
  target?: string;
} & (
  | { kind: "group"; children: RouteNode[] }
  | {
      kind: "step";
      action: string;
      expected: string;
      titleMode?: "auto" | "custom";
      operation?: { actionId: string; values: Record<string, string> };
    }
);
export const routeNodeSchema: z.ZodType<RouteNode> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("group"),
      id,
      title: text,
      target: text.optional(),
      children: z.array(routeNodeSchema).max(500),
    }),
    z.object({
      kind: z.literal("step"),
      id,
      title: text,
      target: text.optional(),
      action: text,
      expected: text,
      titleMode: z.enum(["auto", "custom"]).optional(),
      operation: z
        .object({ actionId: id, values: z.record(z.string(), text) })
        .optional(),
    }),
  ]),
);
export function flattenRoute(
  nodes: RouteNode[],
  target = "",
  path: string[] = [],
  order: number[] = [],
): Array<
  Extract<RouteNode, { kind: "step" }> & {
    target: string;
    path: string[];
    order: string;
  }
> {
  return nodes.flatMap((node, index) => {
    const next = [...order, index + 1],
      context = node.target || target;
    return node.kind === "group"
      ? flattenRoute(node.children, context, [...path, node.title], next)
      : [{ ...node, target: context, path, order: next.join(".") }];
  });
}
export function findNode(
  nodes: RouteNode[],
  id: string,
  parent = "",
):
  | { node: RouteNode; siblings: RouteNode[]; index: number; parent: string }
  | undefined {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (node.id === id) return { node, siblings: nodes, index, parent };
    if (node.kind === "group") {
      const found = findNode(node.children, id, node.id);
      if (found) return found;
    }
  }
}
export function routeGroups(
  nodes: RouteNode[],
  path: string[] = [],
): { id: string; title: string }[] {
  return nodes.flatMap((n) =>
    n.kind === "group"
      ? [
          { id: n.id, title: [...path, n.title].join(" / ") },
          ...routeGroups(n.children, [...path, n.title]),
        ]
      : [],
  );
}
export function inheritedTarget(
  nodes: RouteNode[],
  id: string,
  parent = "",
): string | undefined {
  if (!id) return parent;
  for (const node of nodes) {
    const target = node.target || parent;
    if (node.id === id) return target;
    if (node.kind === "group") {
      const found = inheritedTarget(node.children, id, target);
      if (found !== undefined) return found;
    }
  }
}
export function copyNode(node: RouteNode): RouteNode {
  const next = structuredClone(node);
  next.id = crypto.randomUUID();
  if (next.kind === "group") next.children = next.children.map(copyNode);
  return next;
}
export function actionSummary(
  description: ActionDescription | undefined,
  values: Record<string, string>,
): string {
  return (
    description?.summary.replace(
      /\{(\w+)\}/g,
      (_, key) => values[key]?.trim() || "待填写",
    ) || ""
  );
}
export function matchesRule(
  rule: Record<string, string> | undefined,
  values: Record<string, string>,
) {
  return (
    !rule || Object.entries(rule).every(([key, value]) => values[key] === value)
  );
}
export function validateRoute(nodes: RouteNode[]): string | null {
  const ids = new Set<string>();
  let count = 0;
  function visit(list: RouteNode[], depth: number): string | null {
    if (depth > 12) return "分组层级不能超过 12 层。";
    for (const node of list) {
      if (++count > 500) return "一条链路最多包含 500 个分组和步骤。";
      if (ids.has(node.id)) return "链路中存在重复 ID。";
      ids.add(node.id);
      if (!node.title.trim()) return "请补全分组和步骤名称。";
      if (node.kind === "group") {
        const error = visit(node.children, depth + 1);
        if (error) return error;
      }
    }
    return null;
  }
  return visit(nodes, 0);
}
