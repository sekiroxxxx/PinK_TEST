import { contentSchema } from "../../../shared/content";
import { type RouteNode } from "../../../shared/routeTree";
import { displayValue } from "./contract";
import { type EditNode } from "./authoring";

// Display projection only. Native documents and adapter validation stay authoritative.
// This snapshot deliberately does not claim to be an executable automation plan.
export function structuredPreview(tree: EditNode[], id: string, name: string) {
  function nodes(items: EditNode[]): RouteNode[] {
    return items.flatMap((n) => {
      const children = nodes(n.children || []);
      const own: RouteNode[] = n.selectable
        ? [
            {
              kind: "step",
              id: n.id + ":case",
              title: n.title,
              action: (n.fields || [])
                .map((f) => `${f.label}：${displayValue(f.value) ?? "未指定"}`)
                .join("\n"),
              expected: "",
            },
          ]
        : [];
      return children.length
        ? [
            {
              kind: "group",
              id: n.id,
              title: n.title,
              children: [...own, ...children],
            },
          ]
        : own;
    });
  }
  return contentSchema.parse({
    kind: "qa-test-content",
    schemaVersion: 1,
    id,
    name,
    groups: [
      {
        id: "described-content",
        title: name,
        units: tree.map((root) => ({
          id: root.id,
          title: root.title,
          steps: [],
          outline: nodes([root]),
        })),
      },
    ],
  });
}
