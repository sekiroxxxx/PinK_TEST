import { ConfigurationOperationError } from "./configuration-context.js";
import { configurationErrorDetail } from "./configuration-diagnostics.js";
import {
  configurationEqual,
  type ConfigurationOperations,
  type ConfigurationRecord,
  type ConfigurationSnapshot,
} from "./configuration-operations.js";
import {
  submitBuild,
  waitBuild,
  assertBuildSucceeded,
  type TaskSource,
} from "./build-operations.js";
import { assertBuildTaskValues } from "./build-task-values.js";
import { isTerminal } from "./task-observer.js";
import type { Configuration, Task } from "./common.js";
import type { CaseValues } from "./finalized-cases.js";
import type { BuildStepsDocument, BuildStep, BuildStepCase } from "./build-steps-contract.js";
import { sensitiveConfigurationField } from "./configuration-steps-contract.js";
import type {
  ConfigurationStepsEnvironment,
  ConfigurationStepResult,
  ConfigurationStepCaseResult,
} from "./configuration-steps.js";

export interface BuildCapture {
  configuration: Configuration;
  values: CaseValues;
}
/** Only external UI/task observation boundaries; validation and orchestration stay in production. */
export interface BuildStepsPort {
  source: TaskSource;
  baselineIds: ReadonlySet<string>;
  signal: AbortSignal;
  queueTimeoutMs: number;
  buildTimeoutMs: number;
  capture(operations: ConfigurationOperations, fields: string[]): Promise<BuildCapture>;
  click(operations: ConfigurationOperations, verify: () => Promise<void>): Promise<number>;
  assertCard(task: Task): Promise<void>;
}
interface Submission {
  attempted: boolean;
  submittedAt?: number;
  task?: Task;
  capture: BuildCapture;
  terminal?: Task;
  checked: boolean;
}

function assertParameters(task: Task, platform: string, capture: BuildCapture) {
  if (task.platform !== platform || task.outputName !== capture.configuration.outputName)
    throw new ConfigurationOperationError(
      "assertion",
      "任务平台或输出名称与提交快照不一致",
      "failed",
    );
  assertBuildTaskValues(task, { values: capture.values, preserved: [] });
}

export async function runBuildSteps(
  document: BuildStepsDocument,
  env: ConfigurationStepsEnvironment,
) {
  if (!env.closeConfiguration) throw new Error("v2 缺少配置页关闭适配");
  const hasBuild = document.cases.some((c) => c.steps.some((s) => s.op === "build.submit"));
  if (hasBuild && !env.build) throw new Error("v2 构建步骤缺少任务观察及 UI 提交适配");
  const cases: ConfigurationStepCaseResult[] = [];
  const owned = new Set<string>();
  let stopped = false,
    attempted = false,
    submitted = false,
    uncertain = false;
  const checkTasks = () => {
    if (!env.build) return;
    try {
      env.build.source.assertHealthy();
      for (const task of env.build.source.tasks()) {
        const ours = owned.has(task.id) || (!!task.parentTaskId && owned.has(task.parentTaskId));
        if (!ours && (!env.build.baselineIds.has(task.id) || !isTerminal(task)))
          throw new Error(`出现未关联或本轮之外的活动任务：${task.id}`);
      }
    } catch (cause) {
      throw new ConfigurationOperationError("task", "任务范围不可信，停止后续提交", "stop", {
        cause,
      });
    }
  };
  for (const c of document.cases) {
    const result: ConfigurationStepCaseResult = {
      caseId: c.caseId,
      platform: c.platform,
      outcome: stopped ? "skipped" : "passed",
      steps: [...c.steps, ...c.finally].map((s, i) => ({
        stepId: s.id,
        operation: s.op,
        outcome: "skipped",
        trigger: i < c.steps.length ? "sequence" : "cleanup",
      })),
      restoration: c.steps.some((s) => s.op === "record") ? "not-recorded" : "not-required",
      stopFollowingCases: stopped,
    };
    cases.push(result);
    if (stopped) continue;
    await runCase(c, result);
    stopped = result.stopFollowingCases;
  }
  return {
    kind: "pink-configuration-steps-result",
    schemaVersion: 2,
    evidenceKind: env.evidenceKind,
    buildSubmitted: submitted,
    buildAttempted: attempted,
    taskMayStillBeRunning: uncertain,
    stopped,
    outcome: cases.every((c) => c.outcome === "passed") ? "passed" : "failed",
    cases,
  };

  async function runCase(c: BuildStepCase, result: ConfigurationStepCaseResult) {
    const cleanupEntries = result.steps.slice(c.steps.length);
    let active: { id: string; operations: ConfigurationOperations } | undefined;
    let original: ConfigurationRecord | undefined;
    let failed = false,
      unsafe = false;
    const snapshots = new Map<
      string,
      { ui: ConfigurationSnapshot; capture?: BuildCapture; fields: string[] }
    >();
    const submissions = new Map<string, Submission>();
    const finished = new Map<string, { reference: string; task: Task }>();
    const page = (id: string) => {
      if (!active || active.id !== id)
        throw new ConfigurationOperationError("context", "页面引用已经失效", "stop");
      return active.operations;
    };
    const failure = async (out: ConfigurationStepResult, error: unknown) => {
      const typed = error instanceof ConfigurationOperationError ? error : undefined;
      const disposition = typed?.disposition ?? "failed";
      const secrets = [...(original?.restore ?? [])].flatMap(([field, value]) =>
        sensitiveConfigurationField(field) && typeof value.value === "string" ? [value.value] : [],
      );
      out.diagnostic = configurationErrorDetail(error, secrets);
      out.error = {
        code: typed?.code ?? "operation",
        reason: typed?.message ?? "步骤失败，详见脱敏底层原因",
        disposition,
      };
      out.outcome = disposition === "stop" ? "stopped" : disposition;
      result.failure ??= out.error;
      failed = true;
      if (disposition === "stop") {
        result.stopFollowingCases = true;
        result.stopReason = out.error;
      }
      if (typed && ["context", "submission", "task"].includes(typed.code)) unsafe = true;
      if (out.operation === "restore") {
        result.restoration = "failed";
        unsafe = true;
      }
      if (env.captureFailure)
        out.evidence = await env
          .captureFailure(c.caseId, out)
          .catch(() => ({ unavailable: "现场采集失败，继续既定收尾" }));
    };
    const collect = async (reference: string, submission: Submission) => {
      if (!submission.task || submission.terminal) return submission.terminal;
      const build = env.build!;
      const value = await waitBuild({
        ...build,
        verify: () => env.session.verify(),
        taskId: submission.task.id,
        submittedAt: submission.submittedAt!,
        onObservation: (task) => {
          submission.task = task;
          checkTasks();
        },
      });
      submission.terminal = value.task;
      submission.task = value.task;
      return (finished.set(reference, { reference, task: value.task }), value.task);
    };
    const execute = async (step: BuildStep, out: ConfigurationStepResult, cleanup: boolean) => {
      out.startedAt = new Date().toISOString();
      try {
        await env.session.verify();
        checkTasks();
        switch (step.op) {
          case "config.open": {
            if (active) {
              if (!cleanup)
                throw new ConfigurationOperationError("context", "不能隐式关闭现有配置页", "stop");
              await active.operations.context.verify();
              active.id = step.id;
              out.output = { platform: c.platform, mode: "reused" };
            } else {
              const operations = await env.openConfiguration(c.platform);
              if (operations.context.session !== env.session || operations.platform !== c.platform)
                throw new ConfigurationOperationError(
                  "context",
                  "配置页不属于目标会话或平台",
                  "stop",
                );
              await operations.context.verify();
              active = { id: step.id, operations };
              if (original) await operations.continueRecord(original);
              out.output = { platform: c.platform, mode: "opened" };
            }
            break;
          }
          case "config.close": {
            const operations = page(step.page);
            await operations.context.verify();
            try {
              await env.closeConfiguration!(operations);
            } catch (cause) {
              throw new ConfigurationOperationError("context", "关闭配置页失败，保留现场", "stop", {
                cause,
              });
            }
            operations.context.invalidate();
            active = undefined;
            break;
          }
          case "record":
            original = await page(step.page).record(step.fields);
            out.output = { record: step.id, fields: [...original.initial.keys()] };
            break;
          case "set":
            out.output = {
              field: step.field,
              changed: await page(step.page).set(step.field, step.value, step.input),
            };
            break;
          case "read": {
            const operations = page(step.page),
              ui = await operations.snapshot(step.fields);
            const capture =
              step.scope === "build"
                ? await env.build!.capture(operations, step.fields)
                : undefined;
            await operations.assertSnapshotCurrent(ui);
            snapshots.set(step.id, { ui, capture, fields: step.fields });
            out.output = {
              snapshot: step.id,
              scope: step.scope ?? "configuration",
              fields: Object.fromEntries(
                Object.entries(ui.fields).map(([k, v]) => [
                  k,
                  sensitiveConfigurationField(k) ? "[redacted]" : v?.value,
                ]),
              ),
            };
            break;
          }
          case "build.submit": {
            const operations = page(step.page),
              snapshot = snapshots.get(step.snapshot)!;
            const submission: Submission = {
              attempted: false,
              capture: structuredClone(snapshot.capture!),
              checked: false,
            };
            submissions.set(step.id, submission);
            const verify = async () => {
              await env.session.verify();
              checkTasks();
              await operations.assertSnapshotCurrent(snapshot.ui);
              const current = await env.build!.capture(operations, snapshot.fields);
              if (!configurationEqual(current, submission.capture))
                throw new ConfigurationOperationError(
                  "snapshot",
                  "提交前配置身份或选项发生变化",
                  "stop",
                );
            };
            const accepted = await submitBuild({
              source: env.build!.source,
              baselineIds: new Set([...env.build!.baselineIds, ...owned]),
              platform: c.platform,
              outputName: submission.capture.configuration.outputName,
              verify,
              click: () => env.build!.click(operations, verify),
              signal: env.build!.signal,
              onAttempt: (at) => {
                attempted = true;
                submission.attempted = true;
                submission.submittedAt = at;
              },
            });
            // Retain ownership before parameter assertions so failed cases still collect this task.
            submission.task = accepted.task;
            submitted = true;
            owned.add(accepted.task.id);
            out.output = {
              taskId: accepted.task.id,
              submittedAt: accepted.submittedAt,
              acceptedAt: accepted.acceptedAt,
            };
            operations.context.invalidate();
            active = undefined;
            assertParameters(accepted.task, c.platform, submission.capture);
            break;
          }
          case "build.wait": {
            const task = await collect(step.task, submissions.get(step.task)!);
            finished.set(step.id, { reference: step.task, task: task! });
            out.output = { taskId: task!.id, state: task!.state };
            break;
          }
          case "assert": {
            if (step.check === "build-result") {
              const submission = submissions.get(step.task)!,
                value = finished.get(step.result)!;
              if (value.reference !== step.task || value.task.id !== submission.task?.id)
                throw new ConfigurationOperationError("context", "终态结果不属于指定任务", "stop");
              assertBuildSucceeded(value.task);
              assertParameters(value.task, c.platform, submission.capture);
              await env.build!.assertCard(value.task);
              submission.checked = true;
              out.output = {
                taskId: value.task.id,
                state: value.task.state,
                parameters: "matched",
                card: "passed",
              };
            } else if (step.check === "values")
              out.output = await active!.operations.assertValues(
                snapshots.get(step.snapshot)!.ui,
                step.values,
              );
            else if (step.check === "prompt")
              out.output = await active!.operations.assertPrompt(step.field, step.expected);
            else out.output = await active!.operations.assertState(step.field, step.expected);
            break;
          }
          case "restore":
            if (!original) {
              out.output = { reason: "尚未取得原值记录" };
              return;
            }
            await page(step.page).restore(original);
            result.restoration = "passed";
            break;
        }
        out.outcome = "passed";
      } catch (error) {
        // Opening may have left an unverified modal behind; never continue to another case.
        if (step.op === "config.open" && !(error instanceof ConfigurationOperationError))
          error = new ConfigurationOperationError(
            "context",
            "配置页未能确认，停止后续输入",
            "stop",
            { cause: error },
          );
        await failure(out, error);
      } finally {
        out.finishedAt = new Date().toISOString();
        if (step.op === "restore" && original)
          out.restorationTrace = structuredClone(original.restorationTrace);
      }
    };
    for (const [i, step] of c.steps.entries()) {
      if (failed) break;
      await execute(step, result.steps[i], false);
    }
    // A failed assertion never abandons an already-owned task. Uncertain submissions are not retried.
    if (!unsafe)
      for (const [reference, submission] of submissions) {
        if (!submission.task || submission.terminal || submission.checked) continue;
        let cleanupId = reference + ".collect";
        while (result.steps.some((s) => s.stepId === cleanupId)) cleanupId += "X";
        const out: ConfigurationStepResult = {
          stepId: cleanupId,
          operation: "build.wait",
          trigger: "cleanup",
          outcome: "skipped",
          startedAt: new Date().toISOString(),
        };
        result.steps.splice(result.steps.indexOf(cleanupEntries[0]), 0, out);
        try {
          const task = await collect(reference, submission);
          if (task) {
            out.output = { taskId: task.id, state: task.state };
            assertBuildSucceeded(task);
            assertParameters(task, c.platform, submission.capture);
          }
          out.outcome = "passed";
        } catch (error) {
          await failure(out, error);
        }
        out.finishedAt = new Date().toISOString();
      }
    if (unsafe) {
      if (original && result.restoration !== "failed") result.restoration = "unsafe";
    } else if (original || active) {
      for (const [i, step] of c.finally.entries()) {
        await execute(step, cleanupEntries[i], true);
        if (unsafe || result.restoration === "failed") break;
      }
    }
    const taskData = [...submissions].map(([reference, s]) => ({
      reference,
      attempted: s.attempted,
      taskId: s.task?.id,
      state: s.task?.state,
      message: s.task?.message,
      submittedAt: s.submittedAt,
      collected: !!s.terminal,
    }));
    result.tasks = taskData;
    const unresolved = [...submissions.values()].some(
      (s) => s.attempted && (!s.task || !s.terminal),
    );
    uncertain ||= unresolved;
    if (unresolved) result.stopFollowingCases = true;
    if (failed && c.onFailure === "stop" && !result.stopFollowingCases) {
      result.stopFollowingCases = true;
      result.stopReason = {
        code: "case-policy",
        disposition: "stop",
        reason: "用例要求失败后停止；本例已完成必要收集与恢复",
      };
    }
    if (failed)
      result.outcome = result.stopFollowingCases
        ? "stopped"
        : result.failure?.disposition === "blocked"
          ? "blocked"
          : "failed";
  }
}
