import {
  nativeCaseReferencesSchema,
  type NativeCaseReferences,
} from "../../../shared/nativeAuthoring";
import { serialize } from "../../features/structured/contract";
import type {
  AuthoringAdapter,
  EditNode,
} from "../../features/structured/authoring";

type Obj = Record<string, unknown>;
type Reference = NativeCaseReferences["items"][number];
const id = (...parts: (string | number)[]) => JSON.stringify(parts);
const lists = new Map<string, NativeCaseReferences>();

function editorNode(reference: Reference) {
  const origin = reference.origin;
  switch (origin.kind) {
    case "combination":
      return id("combo", reference.platform!, origin.combinationId!);
    case "variant":
      return id(
        "variant",
        reference.platform!,
        origin.combinationId!,
        Number(origin.sourcePath.at(-1)),
      );
    case "scenario":
      return id("scenario-platform", origin.scenarioId!, reference.platform!);
    case "form-sample":
      return id("sample", origin.familyId!, origin.sampleId!);
    case "steps-case":
      return id("native", "case", Number(origin.sourcePath[1]));
  }
}

export function caseReferences() {
  async function load(document: Obj) {
    const key = serialize(document);
    if (!lists.has(key))
      lists.set(
        key,
        nativeCaseReferencesSchema.parse(
          await window.qa.authorAutomation({
            moduleId: "pink-build",
            action: "listCaseReferences",
            document,
          }),
        ),
      );
    return lists.get(key)!;
  }
  function tree(adapter: AuthoringAdapter, document: Obj) {
    const nodes = adapter.tree(document);
    const list = lists.get(serialize(document));
    // Only a list obtained for this exact document may bind editor nodes to
    // execution identities. Unsaved drafts can still edit their original nodes.
    const bindings = new Map<string, Reference[]>();
    for (const reference of list?.items || []) {
      const node = editorNode(reference);
      bindings.set(node, [...(bindings.get(node) || []), reference]);
    }
    const visit = (nodes: EditNode[]): EditNode[] =>
      nodes.map((node) => {
        const matches = bindings.get(node.id) || [];
        const children = node.children ? visit(node.children) : undefined;
        if (matches.length <= 1)
          return {
            ...node,
            children,
            definitionId: matches[0]?.caseId,
            selectable: !!matches.length,
          };
        return {
          ...node,
          definitionId: undefined,
          selectable: false,
          children: [
            ...(children || []),
            ...matches.map((reference): EditNode => ({
              id: id("case-reference", node.id, reference.caseId),
              title:
                reference.title +
                " · " +
                ((
                  (document.platforms as { id: string; label: string }[]) || []
                ).find((platform) => platform.id === reference.platform)
                  ?.label ||
                  reference.platform ||
                  "公共检查"),
              definitionId: reference.caseId,
              selectable: true,
              actions: [{ id: "edit-reference-source", label: "编辑上层用例" }],
              note: "此项沿用上层用例的操作与预期。",
            })),
          ],
        };
      });
    return visit(nodes);
  }
  function adapter(base: AuthoringAdapter): AuthoringAdapter {
    return {
      ...base,
      tree: (document) => tree(base, document),
      async validate(document) {
        await base.validate(document);
        await load(document);
      },
      apply(document, command) {
        const parts = JSON.parse(command.node) as unknown[];
        if (parts[0] === "case-reference")
          return { document, selection: String(parts[1]) };
        return base.apply(document, command);
      },
    };
  }
  return { load, adapter };
}
