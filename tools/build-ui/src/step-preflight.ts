import type { BuildStepsDocument } from "./build-steps-contract.js";
import type { BuilderTarget } from "./builder-checks.js";
import type { LoadedConfigurationSteps } from "./configuration-steps-contract.js";
import type { ConfigurationStepCaseResult } from "./configuration-steps.js";

export interface CasePrecondition {
  status: "blocked" | "not-applicable";
  gaps: Array<{ kind: string; reason: string }>;
}
export interface StepPreflightCase {
  caseId: string;
  platform?: string;
  target?: BuilderTarget;
  title?: string;
  group?: string;
  status: "ready" | CasePrecondition["status"];
  gaps: CasePrecondition["gaps"];
  sourceCaseIds?: string[];
}

export function validateCasePrecondition(value: unknown): CasePrecondition | undefined {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("precondition 必须明确声明受阻或不适用及原因");
  const condition = value as CasePrecondition;
  if (
    Object.keys(condition).some((key) => !["status", "gaps"].includes(key)) ||
    !["blocked", "not-applicable"].includes(condition.status) ||
    !Array.isArray(condition.gaps) ||
    !condition.gaps.length ||
    condition.gaps.some(
      (gap) =>
        !gap ||
        typeof gap !== "object" ||
        Array.isArray(gap) ||
        Object.keys(gap).some((key) => !["kind", "reason"].includes(key)) ||
        [gap.kind, gap.reason].some((text) => typeof text !== "string" || !text.trim()),
    )
  )
    throw new Error("precondition 仅支持 blocked/not-applicable，且每项原因需要 kind/reason");
  return structuredClone(condition);
}

/** One readiness projection for plans, operation execution and reports. No steps are removed. */
export function stepPreflight(
  document: BuildStepsDocument,
  inputs?: { cases: Array<{ caseId: string; blockers: string[] }> },
): StepPreflightCase[] {
  return document.cases.map((c) => {
    const gaps = [...(c.precondition?.gaps ?? [])];
    for (const reason of inputs?.cases.find((input) => input.caseId === c.caseId)?.blockers ?? [])
      if (!gaps.some((gap) => gap.reason === reason)) gaps.push({ kind: "material", reason });
    return {
      caseId: c.caseId,
      platform: c.platform,
      ...(c.target ? { target: c.target } : {}),
      ...(c.title ? { title: c.title } : {}),
      ...(c.group ? { group: c.group } : {}),
      status:
        c.precondition?.status === "not-applicable"
          ? "not-applicable"
          : gaps.length
            ? "blocked"
            : "ready",
      gaps,
    };
  });
}

export function selectedStepCases(loaded: LoadedConfigurationSteps): StepPreflightCase[] {
  if (loaded.catalog)
    return loaded.catalog.cases.map((c) => ({
      ...c,
      status: c.status as StepPreflightCase["status"],
    }));
  if (loaded.document.schemaVersion === 2)
    return stepPreflight(loaded.document, loaded.inputs?.preview);
  return loaded.document.cases.map((c) => ({
    caseId: c.caseId,
    platform: c.platform,
    status: "ready",
    gaps: [],
  }));
}

/** A blocked stop-policy case remains an ordered barrier; other non-ready cases need no UI slot. */
export function scheduledStepCases(document: BuildStepsDocument, preflight: StepPreflightCase[]) {
  const rows = new Map(preflight.map((row) => [row.caseId, row]));
  return document.cases.filter(
    (c) =>
      rows.get(c.caseId)?.status === "ready" ||
      (rows.get(c.caseId)?.status === "blocked" && c.onFailure === "stop"),
  );
}

/** Preserve the complete selection, including cases which never enter the UI executor. */
export function selectedStepResults(
  loaded: LoadedConfigurationSteps,
  executed: ConfigurationStepCaseResult[],
): ConfigurationStepCaseResult[] {
  return selectedStepCases(loaded).map(
    (c) =>
      executed.find((r) => r.caseId === c.caseId) ?? {
        caseId: c.caseId,
        platform: c.platform,
        ...(c.target ? { target: c.target } : {}),
        outcome: c.status === "ready" ? "skipped" : c.status,
        steps: [],
        restoration: "not-required",
        stopFollowingCases: false,
        ...(c.status !== "ready"
          ? {
              failure: {
                code: c.status === "not-applicable" ? "not-applicable" : "precondition",
                reason: c.gaps.map((g) => `[${g.kind}] ${g.reason}`).join("；"),
                disposition: "blocked" as const,
              },
            }
          : {}),
      },
  );
}
