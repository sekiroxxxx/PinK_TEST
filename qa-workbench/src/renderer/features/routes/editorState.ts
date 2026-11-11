import { z } from "zod";
import {
  contentSchema,
  type ContentUnit,
  type TestContent,
} from "../../../shared/content";
import {
  type RouteNode,
  actionDescriptionSchema,
  findNode,
} from "../../../shared/routeTree";
import { draftKeys, readDraft } from "../../components/useDraft";
import actionData from "./actions.json";

export const defaultActions = z
  .array(actionDescriptionSchema)
  .parse(actionData);
export const editorDraftSchema = z.object({
  text: z.string().max(4 * 1024 * 1024),
  selection: z
    .object({
      group: z.string(),
      unit: z.string().optional(),
      step: z.string().optional(),
    })
    .optional(),
  advanced: z.boolean().optional(),
});
export type CatalogEdit = {
  kind: "collection" | "group" | "route";
  id?: string;
  group?: string;
  creating?: boolean;
  explicitLocation?: boolean;
  action?: "copy" | "up" | "down" | "remove";
};
export const nodeFocusSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(["step", "group"]),
  parent: z.string(),
});
export type NodeFocus = z.infer<typeof nodeFocusSchema>;
export const nodeFormSchema = z.object({
  title: z.string(),
  target: z.string(),
  parent: z.string(),
  actionId: z.string(),
  values: z.record(z.string(), z.string()),
  actionText: z.string().optional(),
  expected: z.string(),
});
export const metaFormSchema = z.object({
  title: z.string(),
  parent: z.string(),
  creating: z.boolean().optional(),
});

export function nodeDrafts(
  scope: string,
  nodes: RouteNode[] = [],
): NodeFocus[] {
  const prefix = "route-node:" + scope + ":";
  return draftKeys(prefix).flatMap((key): NodeFocus[] => {
    try {
      const value = readDraft(key);
      if (value == null) return [];
      const parsed = nodeFormSchema.safeParse(value);
      const suffix = key.slice(prefix.length);
      const fresh =
        suffix.startsWith("new-step-") || suffix.startsWith("new-group-");
      const found = fresh ? undefined : findNode(nodes, suffix);
      return [
        {
          id: fresh ? undefined : suffix,
          kind: suffix.startsWith("new-group-")
            ? "group"
            : found?.node.kind || "step",
          parent: fresh
            ? suffix.slice(suffix.startsWith("new-group-") ? 10 : 9)
            : parsed.success
              ? parsed.data.parent
              : found?.parent || "",
        },
      ];
    } catch {
      return [];
    }
  });
}
export function hasNodeDraft(scope: string) {
  return draftKeys("route-node:" + scope + ":").some((key) => {
    try {
      return readDraft(key) != null;
    } catch {
      return true;
    }
  });
}
export function metaDrafts(content: TestContent): CatalogEdit[] {
  const prefix = "route-meta:" + content.id + ":";
  return draftKeys(prefix).flatMap((key): CatalogEdit[] => {
    try {
      const suffix = key.slice(prefix.length),
        split = suffix.indexOf(":");
      const kind = suffix.slice(0, split),
        id = suffix.slice(split + 1);
      if (kind !== "collection" && kind !== "group" && kind !== "route")
        return [];
      const form = metaFormSchema.safeParse(readDraft(key));
      if (!form.success) return [];
      const current =
        kind === "group"
          ? content.groups.find((g) => g.id === id)
          : kind === "route"
            ? content.groups.flatMap((g) => g.units).find((u) => u.id === id)
            : undefined;
      const parent =
        kind === "group"
          ? content.groups.find((g) => g.id === id)?.parentId || ""
          : kind === "route"
            ? content.groups.find((g) => g.units.some((u) => u.id === id))
                ?.id || ""
            : "";
      const title = kind === "collection" ? content.name : current?.title || "";
      if (form.data.title === title && form.data.parent === parent) return [];
      if (id === "new" && !form.data.title.trim()) return [];
      return [
        {
          kind,
          id: id === "new" ? undefined : id,
          group: form.data.parent,
          creating: form.data.creating,
        },
      ];
    } catch {
      return [];
    }
  });
}
export function contentChanges(
  saved: TestContent | undefined,
  current: TestContent,
) {
  const units = (content: TestContent | undefined) =>
    new Map(
      (content?.groups || []).flatMap((g) =>
        g.units.map(
          (u, index) => [u.id, { unit: u, group: g.id, index }] as const,
        ),
      ),
    );
  const before = units(saved),
    after = units(current);
  const routes = [...new Set([...before.keys(), ...after.keys()])].filter(
    (id) => JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id)),
  );
  const structure = (content: TestContent | undefined) =>
    content && {
      ...content,
      groups: content.groups.map(({ units: _units, ...group }) => group),
    };
  return {
    routes,
    structure:
      JSON.stringify(structure(saved)) !== JSON.stringify(structure(current)),
  };
}
export function pendingDraft(id: string, content: unknown) {
  try {
    const value = readDraft("content:" + id);
    if (value == null) return false;
    const d = editorDraftSchema.parse(value);
    return (
      JSON.stringify(contentSchema.parse(JSON.parse(d.text))) !==
      JSON.stringify(contentSchema.parse(content))
    );
  } catch {
    return true;
  }
}
export function nodesOf(unit: ContentUnit): RouteNode[] {
  if (unit.outline) return unit.outline;
  const nodes: RouteNode[] = [];
  // Older personal routes only have flat steps and a display group. Preserve
  // consecutive groups without regrouping or changing the recorded step order.
  for (const s of unit.steps) {
    const step: RouteNode = {
      kind: "step",
      id: s.id,
      title: s.title,
      action: s.action,
      expected: s.expected,
      titleMode: "custom",
      target: s.target,
    };
    if (!s.group) nodes.push(step);
    else {
      const previous = nodes.at(-1);
      if (previous?.kind === "group" && previous.title === s.group)
        previous.children.push(step);
      else
        nodes.push({
          kind: "group",
          id: "legacy-group:" + s.id,
          title: s.group,
          children: [step],
        });
    }
  }
  return nodes;
}
