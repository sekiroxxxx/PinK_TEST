import type { TestContent, Mount } from "../../../shared/content";
import {
  flatten,
  type AuthoringAdapter,
  type EditField,
} from "../structured/authoring";
import type { EditorData } from "../structured/contract";
import type {
  ExecutionRequest,
  ExecutionPresentation,
} from "../../../shared/execution";

export type ExecutionAdjustment = {
  fields?: Record<string, unknown>;
  steps?: string[];
};
export type ExecutionOptions = {
  fields: EditField[];
  steps?: { id: string; title: string }[];
  note: string;
};

// The workbench consumes module-owned data and editors. Loading a module here
// does not launch its independent executor or grant a document new capabilities.
export interface AutomationModule {
  id: string;
  name: string;
  description: string;
  load(context?: {
    sources?: Mount[];
    document?: Record<string, unknown>;
  }): Promise<{
    adapter: AuthoringAdapter;
    preview(
      doc: Record<string, unknown>,
      id: string,
      name: string,
    ): TestContent;
    catalog(): Promise<EditorData>;
    empty(): Promise<EditorData>;
    importDocument(value: unknown): Promise<EditorData>;
    caseIds(doc: Record<string, unknown>, unitIds: string[]): string[];
    canCompose?: boolean;
    newComposition?(source?: Mount): Promise<EditorData>;
    executionOptions?(
      doc: Record<string, unknown>,
      unitId: string,
    ): ExecutionOptions | undefined;
    originNode?(
      doc: Record<string, unknown>,
      path: string[],
    ): string | undefined;
    presentation?(
      doc: Record<string, unknown>,
      labels: Record<string, string>,
      adjustments?: Record<string, ExecutionAdjustment>,
    ): ExecutionPresentation;
    prepareExecution?(
      doc: Record<string, unknown>,
      unitIds: string[],
      mode: "configuration" | "build",
      adjustments?: Record<string, ExecutionAdjustment>,
    ): Promise<
      Pick<ExecutionRequest, "inputKind" | "document" | "caseIds" | "selection">
    >;
  }>;
}

export const automationModules: AutomationModule[] = [
  {
    id: "pink-build",
    name: "PinK 构建测试",
    description: "平台配置组合与公共界面检查",
    load: async (context) =>
      (
        await import("../../integrations/pink-build/automationModule")
      ).loadModule(context),
  },
];

export function automationModule(id: string) {
  return automationModules.find((module) => module.id === id);
}

export function automationContent(
  loaded: Awaited<ReturnType<AutomationModule["load"]>>,
  editor: Pick<EditorData, "document" | "labels">,
  id: string,
  name: string,
  adjustments?: Record<string, ExecutionAdjustment>,
) {
  const content = loaded.preview(editor.document, id, name);
  const labels = editor.labels || {};
  const caseLabels =
    loaded.presentation?.(editor.document, labels, adjustments).caseLabels ||
    {};
  const definitions = new Map(
    flatten(loaded.adapter.tree(editor.document)).map((node) => [
      node.id,
      node.definitionId,
    ]),
  );
  for (const group of content.groups)
    for (const unit of group.units)
      unit.title =
        caseLabels[definitions.get(unit.id) || ""] ||
        labels[unit.id] ||
        unit.title;
  return content;
}
