import type { OutlineNode } from "../../components/ContentOutline";
import type { EditorData } from "./contract";
import {
  completeParameterConstants,
  type ParameterSchema,
} from "./SchemaInput";

export type Option = {
  value: string | number | boolean;
  label: string;
  disabled?: boolean;
  relatedNode?: string;
};
export type EditField = {
  key: string;
  label: string;
  value: unknown;
  display?: string;
  control:
    | "text"
    | "textarea"
    | "number"
    | "toggle"
    | "select"
    | "lines"
    | "reference"
    | "schema"
    | "readonly";
  schema?: ParameterSchema;
  labels?: Record<string, string>;
  references?: Record<string, string[]>;
  options?: Option[];
  section?: string;
  collapsed?: boolean;
  origin?: string;
  help?: string;
  disabled?: string;
  reset?: boolean;
  condition?: { field: string; equals: unknown; message: string };
};
export type EditAction = {
  secondary?: boolean;
  id: string;
  label: string;
  options?: Option[];
  help?: string;
  destructive?: boolean;
  creates?: boolean;
  schema?: ParameterSchema;
  initial?: unknown;
  labels?: Record<string, string>;
  references?: Record<string, string[]>;
};
export type EditNode = OutlineNode & {
  nameable?: boolean;
  orderGroup?: string;
  canHaveFolders?: boolean;
  children?: EditNode[];
  fields?: EditField[];
  actions?: EditAction[];
  note?: string;
  selectable?: boolean;
  definitionId?: string;
  associations?: {
    id: string;
    title: string;
    fields: { nodeId: string; field: EditField; source: string }[];
  }[];
};
export type AuthoringIssue = {
  node: string;
  message: string;
  field?: string;
  related?: { node: string; label: string }[];
};
export class AuthoringValidationError extends Error {
  constructor(
    public issue: AuthoringIssue,
    public detail: string,
  ) {
    super(issue.message);
    this.name = "AuthoringValidationError";
  }
}
export type EditCommand = {
  node: string;
  action: string;
  key?: string;
  value?: unknown;
};
export interface AuthoringAdapter {
  hash: string;
  accepts: string[];
  checkCompatibility?(original: EditorData): void | Promise<void>;
  exportName: string;
  tree(doc: Record<string, unknown>): EditNode[];
  displayLabels?(
    doc: Record<string, unknown>,
    labels: Record<string, string>,
  ): Record<string, string>;
  apply(
    doc: Record<string, unknown>,
    command: EditCommand,
  ):
    | {
        document: Record<string, unknown>;
        selection?: string;
        remap?: Record<string, string | null>;
        labels?: Record<string, string>;
      }
    | Promise<{
        document: Record<string, unknown>;
        selection?: string;
        remap?: Record<string, string | null>;
        labels?: Record<string, string>;
      }>;
  validate(doc: Record<string, unknown>): void | Promise<void>;
  recover(original: EditorData, mountId: string): Record<string, unknown>;
}
export async function ensureEditorCompatibility(
  adapter: AuthoringAdapter,
  editor: EditorData,
) {
  if (adapter.accepts.includes(editor.descriptionHash)) return;
  if (!adapter.checkCompatibility)
    throw new Error("当前编辑模块不支持此用例的描述版本，原用例与草稿仍保留。");
  await adapter.checkCompatibility(editor);
}
export function flatten(nodes: EditNode[]): EditNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children || [])]);
}
export async function completeAuthoringConstants(
  adapter: AuthoringAdapter,
  document: Record<string, unknown>,
) {
  let result = document;
  for (const node of flatten(adapter.tree(document))) {
    for (const field of node.fields || []) {
      if (field.control !== "schema" || !field.schema || field.disabled)
        continue;
      const value = completeParameterConstants(field.schema, field.value);
      if (value === field.value) continue;
      result = (
        await adapter.apply(result, {
          node: node.id,
          action: "set",
          key: field.key,
          value,
        })
      ).document;
    }
  }
  return result;
}
export function labelNodes(
  nodes: EditNode[],
  labels: Record<string, string> = {},
): EditNode[] {
  return nodes.map((node) => ({
    ...node,
    title: labels[node.id] || node.title,
    fields: node.fields?.map((field) => ({
      ...field,
      options: field.options?.map((option) => ({
        ...option,
        label:
          option.relatedNode && labels[option.relatedNode]
            ? option.label + " · " + labels[option.relatedNode]
            : option.label,
      })),
    })),
    children: node.children ? labelNodes(node.children, labels) : undefined,
  }));
}
export function authoringTree(
  adapter: AuthoringAdapter,
  document: Record<string, unknown>,
  labels: Record<string, string> = {},
) {
  return labelNodes(
    adapter.tree(document),
    adapter.displayLabels?.(document, labels) || labels,
  );
}
