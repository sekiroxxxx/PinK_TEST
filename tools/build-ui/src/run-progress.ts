import { join } from "node:path";
import type { LoadedConfigurationSteps } from "./configuration-steps-contract.js";
import type { ConfigurationStepCaseResult } from "./configuration-steps.js";
import { platformCatalog } from "./platform-catalog.js";
import { buildStepGroups } from "./build-step-scheduling.js";
import type { BuilderTarget } from "./builder-checks.js";
import { selectedStepCases, scheduledStepCases } from "./step-preflight.js";

export const progressPrefix = "PINK_BUILD_PROGRESS ";
export type CaseProgressStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "blocked"
  | "stopped"
  | "skipped"
  | "not-applicable";
export type RunPhase = "preflight" | "connecting" | "executing" | "cleanup" | "finished";
export interface CaseProgress {
  caseId: string;
  platform?: string;
  platformLabel?: string;
  target?: BuilderTarget;
  title: string;
  group?: string;
  groupLabel?: string;
  batch?: number;
  status: CaseProgressStatus;
  stage: string;
  startedAt?: string;
  finishedAt?: string;
  tasks: Array<{ taskId: string; state?: string; progress?: number; collected: boolean }>;
  failure?: { code: string; reason: string; details: string[] };
  evidence: Array<{ stepId: string; screenshot?: string; scene?: string; unavailable?: string }>;
}
export interface RunProgress {
  kind: "pink-build-progress";
  schemaVersion: 1;
  runId: string;
  sequence: number;
  updatedAt: string;
  lifecycle: "running" | "stopping" | "finished";
  phase: RunPhase;
  outcome: "incomplete" | "passed" | "failed";
  summary: {
    total: number;
    completed: number;
    pending: number;
    running: number;
    passed: number;
    failed: number;
    blocked: number;
    stopped: number;
    skipped: number;
    notApplicable: number;
  };
  cases: CaseProgress[];
  issues: { fatal?: string; warnings: string[] };
  artifacts: { plan: string; result: string; report: string };
}

const groupLabels: Record<string, string> = {
  publish: "发布",
  debug: "调试",
  mixed: "混合",
  conditional: "条件与扩展",
};

/** A display projection of this run only. It never turns historical or pending results into passes. */
export function buildRunProgress(
  loaded: LoadedConfigurationSteps,
  data: Record<string, unknown>,
  sequence: number,
): RunProgress {
  const lifecycle = data.lifecycle as RunProgress["lifecycle"];
  const runId = String(data.runId);
  const results = (data.cases ?? []) as ConfigurationStepCaseResult[];
  const selected = selectedStepCases(loaded);
  const batches = buildStepGroups(
    loaded.document.schemaVersion === 2
      ? scheduledStepCases(loaded.document, selected)
      : loaded.document.cases,
  );
  const cases = selected.map((definition): CaseProgress => {
    const result = results.find((c) => c.caseId === definition.caseId);
    const preflight = "status" in definition ? definition.status : "ready";
    const hasStarted = result?.lifecycle === "running" || !!result?.startedAt;
    let status: CaseProgressStatus;
    if (result?.lifecycle === "finished" && result.outcome === "stopped") status = "stopped";
    else if (preflight === "not-applicable") status = "not-applicable";
    else if (preflight === "blocked") status = "blocked";
    else if (result?.lifecycle === "finished") status = result.outcome;
    else if (lifecycle === "finished") status = hasStarted ? "stopped" : "skipped";
    else status = hasStarted ? "running" : "pending";
    const tasks = (result?.tasks ?? []).flatMap((task) =>
      task.taskId
        ? [
            {
              taskId: task.taskId,
              state: task.state,
              ...(typeof task.progress === "number" &&
              Number.isFinite(task.progress) &&
              task.progress >= 0 &&
              task.progress <= 1
                ? { progress: task.progress }
                : {}),
              collected: task.collected,
            },
          ]
        : [],
    );
    const activeStep = result?.steps?.find((s) => s.startedAt && !s.finishedAt);
    let stage: string = status;
    if (status === "running") {
      if (activeStep?.trigger === "cleanup")
        stage =
          activeStep.operation === "restore" || activeStep.operation === "stage.restore"
            ? "restoring"
            : "cleanup";
      else if (activeStep?.operation === "build.submit") stage = "submitting";
      else if (tasks.some((t) => !t.collected && t.state === "waiting")) stage = "queued";
      else if (tasks.some((t) => !t.collected && t.state === "processing")) stage = "building";
      else if (tasks.length) stage = "checking";
      else stage = "configuring";
    }
    const group = "group" in definition ? definition.group : undefined;
    const failure = result?.failure ?? result?.stopReason;
    return {
      caseId: definition.caseId,
      platform: definition.platform,
      ...("target" in definition && definition.target ? { target: definition.target } : {}),
      platformLabel:
        loaded.document.targets?.find((p) => p.id === definition.platform)?.label ??
        platformCatalog.find((p) => p.id === definition.platform)?.label ??
        definition.platform,
      title: ("title" in definition && definition.title) || definition.caseId,
      ...(group ? { group, groupLabel: groupLabels[group] ?? group } : {}),
      batch: batches.find((g) => g.caseIds.includes(definition.caseId))?.number,
      status,
      stage,
      startedAt: result?.startedAt,
      finishedAt: result?.finishedAt,
      tasks,
      ...(failure
        ? {
            failure: {
              code: failure.code,
              reason: failure.reason,
              details: [
                ...new Set(
                  (result?.steps ?? [])
                    .filter((s) => s.error)
                    .flatMap((s) => s.diagnostic?.chain.map((cause) => cause.message) ?? []),
                ),
              ],
            },
          }
        : {}),
      evidence: (result?.steps ?? []).flatMap((s) =>
        s.evidence ? [{ stepId: s.stepId, ...s.evidence }] : [],
      ),
    };
  });
  const count = (status: CaseProgressStatus) => cases.filter((c) => c.status === status).length;
  const pending = count("pending"),
    running = count("running");
  return {
    kind: "pink-build-progress",
    schemaVersion: 1,
    runId,
    sequence,
    updatedAt: new Date().toISOString(),
    lifecycle,
    phase: data.phase as RunPhase,
    outcome: data.outcome as RunProgress["outcome"],
    summary: {
      total: cases.length,
      completed: cases.length - pending - running,
      pending,
      running,
      passed: count("passed"),
      failed: count("failed"),
      blocked: count("blocked"),
      stopped: count("stopped"),
      skipped: count("skipped"),
      notApplicable: count("not-applicable"),
    },
    cases,
    issues: {
      ...(typeof data.fatal === "string" ? { fatal: data.fatal } : {}),
      warnings: Array.isArray(data.warnings)
        ? data.warnings.filter((w): w is string => typeof w === "string")
        : [],
    },
    artifacts: {
      plan: join(runId, "plan.json"),
      result: join(runId, "result.json"),
      report: join(runId, "report.html"),
    },
  };
}

/** Publish notifications after the corresponding checkpoint succeeds; ordinary logs remain separate. */
export function createProgressOutput(write: (line: string) => void = console.log) {
  let previous: string | undefined;
  let previousText: string | undefined;
  const stages: Record<string, string> = {
    configuring: "配置中",
    submitting: "提交中",
    queued: "排队中",
    building: "构建中",
    checking: "结果核对",
    restoring: "恢复中",
    cleanup: "收尾中",
  };
  return (progress: RunProgress) => {
    const { sequence: _sequence, updatedAt: _updatedAt, ...state } = progress;
    const key = JSON.stringify(state);
    if (key === previous) return;
    previous = key;
    write(progressPrefix + JSON.stringify(progress));
    const s = progress.summary;
    const active = progress.cases
      .filter((c) => c.status === "running")
      .map((c) => {
        const fraction =
          c.stage === "building"
            ? c.tasks.find((t) => t.state === "processing")?.progress
            : undefined;
        const targetLabel =
          c.platformLabel ??
          (c.target ? `构建公共页面 ${c.target.representativePlatform}` : "公共检查");
        return `${targetLabel}/${c.groupLabel ?? c.title}（${stages[c.stage] ?? c.stage}${fraction === undefined ? "" : ` ${Math.round(fraction * 100)}%`}）`;
      });
    const text = `[progress] ${progress.lifecycle}/${progress.phase} 已处理 ${s.completed}/${s.total}；通过 ${s.passed}，失败 ${s.failed}，受阻 ${s.blocked}，停止 ${s.stopped}，跳过 ${s.skipped}，不适用 ${s.notApplicable}${active.length ? `；当前：${active.join("、")}` : ""}`;
    if (text !== previousText) {
      previousText = text;
      write(text);
    }
  };
}
