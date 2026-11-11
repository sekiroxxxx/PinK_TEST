import { z } from "zod";
import type { ExecutionPresentation } from "./execution.js";

// Wire validation only. Business statuses and counters are owned by
// PinK-Test/tools/build-ui/src/run-progress.ts, never inferred from logs here.
const text = z.string().max(200000);
const count = z.number().int().nonnegative();
export const automationTargetSchema = z
  .object({
    kind: text.min(1),
    id: text.optional(),
    label: text.optional(),
    representativePlatform: text.optional(),
    category: text.optional(),
  })
  .passthrough();
export type AutomationTarget = z.infer<typeof automationTargetSchema>;
export const automationOriginSchema = z
  .object({
    caseId: text.min(1),
    nodeId: text.min(1),
    instanceId: text.min(1),
    instancePath: z.array(text.min(1)),
    sourceId: text.optional(),
    sourceCaseId: text.optional(),
    steps: z.array(
      z
        .object({
          stepId: text.min(1),
          nodeId: text.min(1),
          instancePath: z.array(text.min(1)),
          phase: z.enum(["before", "steps", "finally"]),
          sourceStepId: text.optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export type AutomationOrigin = z.infer<typeof automationOriginSchema>;

export function automationCaseTitle(
  item: { caseId: string; title: string },
  origins?: AutomationOrigin[],
  caseLabels?: Record<string, string>,
) {
  const origin = origins?.find((origin) => origin.caseId === item.caseId);
  return (
    (origin && caseLabels?.[JSON.stringify(origin.instancePath)]) ||
    origin?.sourceCaseId ||
    (origin ? origin.instancePath.join(" / ") : item.title)
  );
}

export function automationTargetLabel(item: {
  target?: AutomationTarget;
  platform?: string;
  platformLabel?: string;
}) {
  if (item.target)
    return (
      item.target.label ||
      [
        "公共检查",
        item.target.representativePlatform ||
          item.target.id ||
          item.target.category,
      ]
        .filter(Boolean)
        .join(" · ")
    );
  return item.platformLabel || item.platform || "公共检查";
}
export const automationProgressSchema = z.object({
  kind: z.literal("pink-build-progress"),
  schemaVersion: z.literal(1),
  runId: text.min(1),
  sequence: count,
  updatedAt: text,
  lifecycle: z.enum(["running", "stopping", "finished"]),
  phase: z.enum([
    "preflight",
    "connecting",
    "executing",
    "cleanup",
    "finished",
  ]),
  outcome: z.enum(["incomplete", "passed", "failed"]),
  summary: z.object({
    total: count,
    completed: count,
    pending: count,
    running: count,
    passed: count,
    failed: count,
    blocked: count,
    stopped: count,
    skipped: count,
    notApplicable: count,
  }),
  cases: z
    .array(
      z.object({
        caseId: text,
        platform: text.optional(),
        platformLabel: text.optional(),
        target: automationTargetSchema.optional(),
        title: text,
        group: text.optional(),
        groupLabel: text.optional(),
        batch: count.optional(),
        status: z.enum([
          "pending",
          "running",
          "passed",
          "failed",
          "blocked",
          "stopped",
          "skipped",
          "not-applicable",
        ]),
        stage: text,
        startedAt: text.optional(),
        finishedAt: text.optional(),
        tasks: z.array(
          z.object({
            taskId: text,
            state: text.optional(),
            progress: z.number().min(0).max(1).optional(),
            collected: z.boolean(),
          }),
        ),
        failure: z
          .object({
            code: text,
            reason: text,
            details: z.array(text).default([]),
          })
          .optional(),
        evidence: z.array(
          z.object({
            stepId: text,
            screenshot: text.optional(),
            scene: text.optional(),
            unavailable: text.optional(),
          }),
        ),
      }),
    )
    .max(5000),
  issues: z
    .object({ fatal: text.optional(), warnings: z.array(text) })
    .default({ warnings: [] }),
  artifacts: z.object({ plan: text, result: text, report: text }),
});
export type AutomationProgress = z.infer<typeof automationProgressSchema>;
export const progressPrefix = "PINK_BUILD_PROGRESS ";

export class ProgressLines {
  private buffer = "";
  private runId?: string;
  private sequence = -1;
  constructor(private readonly onLog: (line: string) => void = () => {}) {}
  push(chunk: string, end = false): AutomationProgress[] {
    this.buffer += chunk;
    if (this.buffer.length > 16 * 1024 * 1024)
      throw new Error("进度行超过读取限制");
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = end ? "" : lines.pop()!;
    const accepted: AutomationProgress[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      if (!line.startsWith(progressPrefix)) {
        this.onLog(line);
        continue;
      }
      const value = automationProgressSchema.parse(
        JSON.parse(line.slice(progressPrefix.length)),
      );
      if (this.runId && this.runId !== value.runId)
        throw new Error("收到其他轮次的进度，已拒绝混入当前记录");
      if (value.sequence <= this.sequence) continue;
      this.runId = value.runId;
      this.sequence = value.sequence;
      accepted.push(value);
    }
    return accepted;
  }
}

export type RecordedAutomation = {
  id: string;
  title: string;
  source: string;
  result: Record<string, unknown>;
  progress: AutomationProgress;
  events: AutomationProgress[];
  reportHtml?: string;
  // Optional, read-only execution plan matched to this result. Never the live editor.
  definition?: Record<string, unknown>;
  // Verified against the frozen execution snapshot; does not rewrite results.
  origins?: AutomationOrigin[];
  composition?: {
    moduleId: string;
    definition: Record<string, unknown>;
    selection: unknown;
    presentation?: ExecutionPresentation;
  };
};

export function readAutomationResult(
  input: unknown,
  source: string,
  title = source,
): RecordedAutomation {
  const parsed = z
    .object({
      kind: z.literal("pink-configuration-steps-result"),
      schemaVersion: z.literal(2),
      runId: z.string(),
      progress: automationProgressSchema,
    })
    .passthrough()
    .safeParse(input);
  if (!parsed.success)
    throw new Error(
      "这份 JSON 没有符合已接入合同的结果与进度。请选择执行侧 result.json，或直接打开其 HTML 报告；原文件未改动。",
    );
  const result = parsed.data;
  if (result.runId !== result.progress.runId)
    throw new Error("结果文件与进度不属于同一轮测试");
  return {
    id: result.runId,
    title,
    source,
    result,
    progress: result.progress,
    events: [],
  };
}
