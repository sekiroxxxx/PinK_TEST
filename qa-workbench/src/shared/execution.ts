import { z } from "zod";
import type {
  AutomationProgress,
  AutomationTarget,
  RecordedAutomation,
  AutomationOrigin,
} from "./automation.js";

export const executionPresentationSchema = z.object({
  nodeLabels: z.record(z.string(), z.string().max(300)),
  caseLabels: z.record(z.string(), z.string().max(2000)),
});
export type ExecutionPresentation = z.infer<typeof executionPresentationSchema>;

export const executionRequestSchema = z
  .object({
    moduleId: z.string().min(1).max(100),
    sourceId: z.string().min(1).max(300),
    title: z.string().min(1).max(2000),
    document: z.record(z.string(), z.unknown()),
    inputKind: z.enum(["native", "composition"]).default("native"),
    selection: z.unknown().optional(),
    presentation: executionPresentationSchema.optional(),
    caseIds: z
      .array(z.string().regex(/^[\w.-]+$/))
      .max(5000)
      .default([]),
    executable: z.string().min(1).max(32000),
    projectPath: z.string().min(1).max(32000),
    version: z.string().max(2000),
    materialsPath: z.string().max(32000),
    executionMode: z.enum(["configuration", "build"]).default("configuration"),
  })
  .superRefine((request, context) => {
    if (request.inputKind === "composition") {
      if (request.caseIds.length)
        context.addIssue({
          code: "custom",
          path: ["caseIds"],
          message: "组合计划按引用实例选择，不再附加原生用例筛选。",
        });
    } else {
      if (!request.caseIds.length)
        context.addIssue({
          code: "custom",
          path: ["caseIds"],
          message: "请选择至少一个执行用例。",
        });
      if (request.selection !== undefined)
        context.addIssue({
          code: "custom",
          path: ["selection"],
          message: "原生文件不接受引用实例选择，请先创建组合计划。",
        });
    }
  });
export type ExecutionRequest = z.infer<typeof executionRequestSchema>;
export type ExecutionPreview = {
  id: string;
  title: string;
  sourceId: string;
  version: string;
  executable: string;
  projectPath: string;
  planPath: string;
  planHash: string;
  canStart: boolean;
  reportOnly?: boolean;
  reason: string;
  executionMode?: ExecutionRequest["executionMode"];
  composition?: {
    assemblyPath: string;
    assemblyHash: string;
    documentSha256: string;
    origins: AutomationOrigin[];
    presentation?: ExecutionPresentation;
  };
  cases: {
    caseId: string;
    title?: string;
    group?: string;
    platform?: string;
    target?: AutomationTarget;
    status?: "ready" | "blocked" | "not-applicable";
    gaps?: { kind: string; reason: string }[];
    sourceCaseIds?: string[];
    operations: string[];
  }[];
};
export type ExecutionState = {
  id: string;
  preview: ExecutionPreview;
  status:
    "starting" | "running" | "stopping" | "finished" | "error" | "interrupted";
  startedAt: string;
  finishedAt?: string;
  progress?: AutomationProgress;
  error?: string;
  exitCode?: number | null;
};
export type ExecutionDetail = ExecutionState & {
  logs: string;
  record?: RecordedAutomation;
};
