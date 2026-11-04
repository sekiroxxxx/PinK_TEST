import { runBuildSteps, type BuildStepsPort } from "./build-steps.js";
import type { BuildStep } from "./build-steps-contract.js";
import type { ExecutionContext } from "./configuration-context.js";
import { ConfigurationOperationError } from "./configuration-context.js";
import { checkExecutionStop } from "./execution-stop.js";
import { configurationErrorDetail } from "./configuration-diagnostics.js";
import type { TargetObservation } from "./standard-fields.js";
import type { BuilderTarget, BuilderUiPort } from "./builder-checks.js";
import type {
  ConfigurationOperations,
  ConfigurationRecord,
  ConfigurationSnapshot,
} from "./configuration-operations.js";
import {
  configurationStepsPlan,
  validateConfigurationSteps,
  sensitiveConfigurationField,
  type LoadedConfigurationSteps,
  type ConfigurationStep,
  type ConfigurationStepCase,
} from "./configuration-steps-contract.js";

type Outcome = "passed" | "failed" | "blocked" | "stopped" | "skipped" | "not-applicable";
export interface ConfigurationStepResult {
  stepId: string;
  operation: ConfigurationStep["op"] | BuildStep["op"] | "open-configuration" | "interruption";
  outcome: Outcome;
  trigger: "sequence" | "cleanup";
  error?: { code: string; reason: string; disposition: "blocked" | "failed" | "stop" };
  output?: unknown;
  startedAt?: string;
  finishedAt?: string;
  diagnostic?: ReturnType<typeof configurationErrorDetail>;
  evidence?: { screenshot?: string; scene?: string; unavailable?: string };
  restorationTrace?: ConfigurationRecord["restorationTrace"];
}
export interface ConfigurationStepCaseResult {
  caseId: string;
  platform?: string;
  target?: BuilderTarget;
  lifecycle?: "pending" | "running" | "finished";
  startedAt?: string;
  finishedAt?: string;
  outcome: Outcome;
  steps: ConfigurationStepResult[];
  failure?: ConfigurationStepResult["error"];
  openingFailure?: ConfigurationStepResult;
  stopReason?: ConfigurationStepResult["error"];
  restoration: "not-required" | "not-recorded" | "passed" | "failed" | "unsafe";
  stopFollowingCases: boolean;
  tasks?: Array<{
    reference: string;
    attempted: boolean;
    taskId?: string;
    state?: string;
    progress?: number;
    message?: string;
    submittedAt?: number;
    collected: boolean;
  }>;
}
export interface ConfigurationStepsEnvironment {
  stopSignal?: AbortSignal;
  onProgress?(progress: {
    cases: ConfigurationStepCaseResult[];
    buildAttempted: boolean;
    buildSubmitted: boolean;
    taskMayStillBeRunning: boolean;
  }): Promise<void>;
  verifySource?(): Promise<void>;
  session: ExecutionContext;
  /** Supplies an already verified UI adapter; no startup or build API is part of this executor. */
  openConfiguration(platform: string): Promise<ConfigurationOperations>;
  checkCapabilities?(
    operations: ConfigurationOperations,
    steps: readonly BuildStep[],
  ): Promise<unknown>;
  evidenceKind: "offline-fixture" | "runtime";
  probePlatform?(platform: string): Promise<TargetObservation>;
  builderUi?: BuilderUiPort;
  closeConfiguration?(operations: ConfigurationOperations): Promise<void>;
  build?: BuildStepsPort;
  captureFailure?(
    caseId: string,
    step: ConfigurationStepResult,
  ): Promise<NonNullable<ConfigurationStepResult["evidence"]>>;
}

function failure(error: unknown, restoring = false): NonNullable<ConfigurationStepResult["error"]> {
  if (restoring)
    return {
      code: "restore",
      disposition: "stop",
      reason: "配置恢复失败，停止后续用例；保留原失败和现场",
    };
  if (error instanceof ConfigurationOperationError)
    return {
      code: error.code,
      disposition: error.disposition,
      reason: {
        context: "程序、工程、窗口或配置页身份失效",
        snapshot: "配置快照已失效，需要重新回读",
        precondition: "配置操作前提不满足",
        assertion: "配置断言不符合用例预期（值已省略）",
        restore: "配置恢复失败",
        input: "配置输入失败",
        submission: "提交未能唯一确认",
        task: "任务跟踪中断",
        interrupted: "用户停止执行，按规则收集任务并恢复配置",
      }[error.code],
    };
  return {
    code: "operation",
    disposition: "failed",
    reason: "配置操作异常（原始错误已省略，避免泄露控件内容）",
  };
}

async function runCase(
  c: ConfigurationStepCase,
  env: ConfigurationStepsEnvironment,
): Promise<ConfigurationStepCaseResult> {
  const result: ConfigurationStepCaseResult = {
    caseId: c.caseId,
    platform: c.platform,
    lifecycle: "running",
    startedAt: new Date().toISOString(),
    outcome: "passed",
    steps: c.steps.map((s) => ({
      stepId: s.id,
      operation: s.op,
      outcome: "skipped",
      trigger: "sequence",
    })),
    restoration: c.steps.some((s) => s.op === "record") ? "not-recorded" : "not-required",
    stopFollowingCases: false,
  };
  let operations: ConfigurationOperations;
  try {
    checkExecutionStop(env.stopSignal);
    await env.session.verify();
    operations = await env.openConfiguration(c.platform);
    if (operations.context.session !== env.session || operations.platform !== c.platform)
      throw new ConfigurationOperationError("context", "打开的配置页不属于本次会话或平台", "stop");
    await operations.context.verify();
  } catch (error) {
    result.failure = failure(error);
    result.openingFailure = {
      stepId: "open-configuration",
      operation: "open-configuration",
      outcome: "stopped",
      trigger: "sequence",
      error: result.failure,
      diagnostic: configurationErrorDetail(error),
    };
    if (env.captureFailure)
      result.openingFailure.evidence = await env
        .captureFailure(c.caseId, result.openingFailure)
        .catch(() => ({ unavailable: "打开配置页的失败现场不可用" }));
    // A failed open has no confirmed configuration scope; do not navigate or mutate again.
    result.failure.disposition = "stop";
    result.stopReason = result.failure;
    result.outcome = "stopped";
    result.stopFollowingCases = true;
    return result;
  }
  const snapshots = new Map<string, ConfigurationSnapshot>();
  let recovery: ConfigurationRecord | undefined;
  let failed = false,
    unsafe = false;
  for (const [index, step] of c.steps.entries()) {
    const out = result.steps[index];
    if (failed && step.op !== "restore") continue;
    if (step.op === "restore") {
      if (!recovery) continue;
      out.trigger = failed ? "cleanup" : "sequence";
      if (unsafe) {
        result.restoration = "unsafe";
        out.error = {
          code: "context",
          disposition: "stop",
          reason: "上下文不可信，禁止向未知页面写入恢复值",
        };
        continue;
      }
    }
    try {
      out.startedAt = new Date().toISOString();
      if (step.op !== "restore") checkExecutionStop(env.stopSignal);
      switch (step.op) {
        case "record":
          recovery = await operations.record(step.fields);
          out.output = { record: step.id, fields: [...recovery.initial.keys()] };
          break;
        case "set":
          out.output = {
            field: step.field,
            changed: await operations.set(step.field, step.value, step.input),
          };
          break;
        case "read": {
          const snapshot = await operations.snapshot(step.fields);
          snapshots.set(step.id, snapshot);
          out.output = {
            snapshot: step.id,
            fields: Object.fromEntries(
              Object.entries(snapshot.fields).map(([key, control]) => [
                key,
                control && {
                  value: sensitiveConfigurationField(key)
                    ? "[redacted]"
                    : structuredClone(control.value),
                  kind: control.kind,
                  disabled: control.disabled,
                },
              ]),
            ),
          };
          break;
        }
        case "assert":
          if (step.check === "values")
            out.output = await operations.assertValues(snapshots.get(step.snapshot)!, step.values);
          else if (step.check === "prompt")
            out.output = await operations.assertPrompt(step.field, step.expected);
          else out.output = await operations.assertState(step.field, step.expected);
          break;
        case "restore":
          await operations.restore(recovery!);
          result.restoration = "passed";
          break;
      }
      out.outcome = "passed";
    } catch (error) {
      const secrets: string[] = [];
      for (const [field, original] of recovery?.restore ?? [])
        if (sensitiveConfigurationField(field) && typeof original.value === "string")
          secrets.push(original.value);
      out.diagnostic = configurationErrorDetail(error, secrets);
      out.error = failure(error, step.op === "restore");
      out.outcome = out.error.disposition === "stop" ? "stopped" : out.error.disposition;
      result.failure ??= out.error;
      failed = true;
      if (out.error.disposition === "stop") {
        result.stopFollowingCases = true;
        result.stopReason = out.error;
      }
      if (out.error.code === "context") unsafe = true;
      if (step.op === "restore") result.restoration = "failed";
      if (env.captureFailure)
        out.evidence = await env
          .captureFailure(c.caseId, out)
          .catch(() => ({ unavailable: "失败现场采集异常，保留错误链并继续既定恢复/停止处理" }));
    } finally {
      out.finishedAt = new Date().toISOString();
      if (step.op === "restore" && recovery)
        out.restorationTrace = structuredClone(recovery.restorationTrace);
      await env.onProgress?.({
        cases: [result],
        buildAttempted: false,
        buildSubmitted: false,
        taskMayStillBeRunning: false,
      });
    }
  }
  // Verify the session/page even when a port threw an unclassified error before writing.
  if (failed && !result.stopFollowingCases) {
    try {
      await operations.context.verify();
    } catch (error) {
      result.stopFollowingCases = true;
      result.stopReason = failure(error);
    }
  }
  if (failed && c.onFailure === "stop" && !result.stopFollowingCases) {
    result.stopFollowingCases = true;
    result.stopReason = {
      code: "case-policy",
      disposition: "stop",
      reason: "用例指定失败后停止；已完成本例恢复，不执行后续用例",
    };
  }
  if (failed)
    result.outcome = result.stopFollowingCases
      ? "stopped"
      : result.failure?.disposition === "blocked"
        ? "blocked"
        : "failed";
  return result;
}

/** Executes a frozen copy in declared order. Failure cleanup is mandatory, never a retry. */
export async function runConfigurationSteps(
  loaded: LoadedConfigurationSteps,
  env: ConfigurationStepsEnvironment,
) {
  configurationStepsPlan(loaded); // Full semantic validation before the first environment callback.
  const verifySource = async () => {
    await loaded.verifySource?.();
    if (env.verifySource !== loaded.verifySource) await env.verifySource?.();
  };
  await verifySource();
  const document = validateConfigurationSteps(loaded.document);
  if (document.schemaVersion === 2)
    return {
      ...(await runBuildSteps(document, { ...env, verifySource }, loaded.inputs)),
      sourceSha256: loaded.sourceSha256,
      documentSha256: loaded.documentSha256,
    };
  const cases: ConfigurationStepCaseResult[] = [];
  let stopped = false;
  for (const c of document.cases) {
    if (stopped) {
      cases.push({
        caseId: c.caseId,
        platform: c.platform,
        outcome: "skipped",
        steps: c.steps.map((s) => ({
          stepId: s.id,
          operation: s.op,
          outcome: "skipped",
          trigger: "sequence",
        })),
        restoration: "not-required",
        stopFollowingCases: true,
      });
      continue;
    }
    const result = await runCase(c, {
      ...env,
      onProgress: env.onProgress
        ? (p) => env.onProgress!({ ...p, cases: [...cases, ...p.cases] })
        : undefined,
    });
    cases.push(result);
    result.lifecycle = "finished";
    result.finishedAt = new Date().toISOString();
    stopped = result.stopFollowingCases;
  }
  return {
    kind: "pink-configuration-steps-result",
    schemaVersion: 1,
    sourceSha256: loaded.sourceSha256,
    documentSha256: loaded.documentSha256,
    evidenceKind: env.evidenceKind,
    buildSubmitted: false,
    stopped,
    outcome: cases.every((c) => c.outcome === "passed") ? "passed" : "failed",
    cases,
  };
}
