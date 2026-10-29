import { ConfigurationOperationError } from "./configuration-context.js";
import { checkExecutionStop } from "./execution-stop.js";
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
  observedBuildTask,
  type TaskSource,
} from "./build-operations.js";
import { assertBuildTaskValues } from "./build-task-values.js";
import { isTerminal, taskTimeout } from "./task-observer.js";
import { buildStepGroups, buildStepScheduling } from "./build-step-scheduling.js";
import type { Configuration, Task } from "./common.js";
import type { CaseValues } from "./finalized-cases.js";
import { stepNeedsInputs, type StepInputs } from "./step-inputs.js";
import type { BuildStepsDocument, BuildStep, BuildStepCase } from "./build-steps-contract.js";
import { sensitiveConfigurationField } from "./configuration-steps-contract.js";
import { readFile } from "node:fs/promises";
import { contentHash } from "./plan-integrity.js";
import { assertExistingGameSelectable } from "./openpaas.js";
import { requireInitial, cancelFile, clearScenes } from "./configuration-input-actions.js";
import { assertBuildOnly, type StageRecord, type StageSnapshot } from "./configuration-stages.js";
import { assertBuilderHome, type BuilderHomeObservation } from "./builder-checks.js";
import {
  assertTargetObservation,
  assertCandidateObservation,
  type TargetObservation,
  type CandidateObservation,
} from "./standard-fields.js";
import {
  retainedValues,
  assertHiddenValue,
  assertAgcConfiguration,
  prepareConfigurationWrite,
  configurationValueMatches,
  hiddenCondition,
} from "./configuration-step-values.js";
import type {
  ConfigurationStepsEnvironment,
  ConfigurationStepResult,
  ConfigurationStepCaseResult,
} from "./configuration-steps.js";

export interface BuildCapture {
  configuration: Configuration;
  values: CaseValues;
  preserved?: string[];
  stages?: string[][];
}
export interface BuildSupplement {
  values: CaseValues;
  preserved: string[];
}
/** Only external UI/task observation boundaries; validation and orchestration stay in production. */
export interface BuildStepsPort {
  source: TaskSource;
  baselineIds: ReadonlySet<string>;
  signal: AbortSignal;
  queueTimeoutMs: number;
  buildTimeoutMs: number;
  capture(
    operations: ConfigurationOperations,
    fields: string[],
    supplement?: BuildSupplement,
  ): Promise<BuildCapture>;
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
  queuedBehindOwned?: boolean;
  collectionAttempted?: boolean;
}

function assertParameters(task: Task, platform: string, capture: BuildCapture) {
  if (task.platform !== platform || task.outputName !== capture.configuration.outputName)
    throw new ConfigurationOperationError(
      "assertion",
      "任务平台或输出名称与提交快照不一致",
      "failed",
    );
  assertBuildTaskValues(task, { values: capture.values, preserved: capture.preserved ?? [] });
}

export async function runBuildSteps(
  document: BuildStepsDocument,
  env: ConfigurationStepsEnvironment,
  inputs?: StepInputs,
) {
  if (
    document.cases.some((c) => c.steps.some((s) => s.op === "config.open")) &&
    !env.closeConfiguration
  )
    throw new Error("v2 缺少配置页关闭适配");
  const hasBuild = document.cases.some((c) => c.steps.some((s) => s.op === "build.submit"));
  if (hasBuild && !env.build) throw new Error("v2 构建步骤缺少任务观察及 UI 提交适配");
  const cases: ConfigurationStepCaseResult[] = [];
  const owned = new Set<string>();
  const ownedSubmissions = new Map<string, Submission>();
  const groups: Array<
    ReturnType<typeof buildStepGroups>[number] & {
      startedAt?: number;
      submissionsClosedAt?: number;
      settledAt?: number;
      outcome: "passed" | "failed" | "skipped";
      taskIds: string[];
      queueCoverage: "observed" | "not-observed" | "not-applicable";
    }
  > = buildStepGroups(document.cases).map((g) => ({
    ...g,
    outcome: "skipped",
    taskIds: [],
    queueCoverage: "not-applicable",
  }));
  let stopped = false,
    unsafeContext = false,
    attempted = false,
    submitted = false,
    uncertain = false;
  const checkTasks = () => {
    if (!env.build) return;
    try {
      env.build.source.assertHealthy();
      for (const [id, submission] of ownedSubmissions) {
        if (submission.terminal) continue;
        const task = observedBuildTask(env.build.source, id);
        submission.task = task;
        const timeout = taskTimeout(
          task,
          submission.submittedAt!,
          Date.now(),
          env.build.queueTimeoutMs,
          env.build.buildTimeoutMs,
        );
        if (timeout)
          throw new Error(`任务 ${id} ${timeout === "startup-wait" ? "启动等待" : "构建观察"}超时`);
      }
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
  const results = new Map(
    document.cases.map((c) => {
      const result: ConfigurationStepCaseResult = {
        caseId: c.caseId,
        platform: c.platform,
        ...(c.target ? { target: c.target } : {}),
        lifecycle: "pending",
        outcome: "skipped",
        steps: [...c.steps, ...c.finally].map((s, i) => ({
          stepId: s.id,
          operation: s.op,
          outcome: "skipped",
          trigger: i < c.steps.length ? "sequence" : "cleanup",
        })),
        restoration: c.steps.some((s) => s.op === "record" || s.op === "stage.record")
          ? "not-recorded"
          : "not-required",
        stopFollowingCases: false,
      };
      cases.push(result);
      return [c.caseId, result] as const;
    }),
  );
  const progress = () => {
    for (const result of cases)
      for (const task of result.tasks ?? []) {
        const submission = task.taskId ? ownedSubmissions.get(task.taskId) : undefined;
        if (submission?.task) {
          task.state = submission.task.state;
          task.progress = submission.task.progress;
          task.collected = !!submission.terminal;
        }
      }
    return env.onProgress?.({
      cases,
      buildAttempted: attempted,
      buildSubmitted: submitted,
      taskMayStillBeRunning:
        cases.some((c) => c.tasks?.some((s) => s.attempted && !s.collected)) || uncertain,
    });
  };
  const finishCase = async (result: ConfigurationStepCaseResult) => {
    result.lifecycle = "finished";
    result.finishedAt = new Date().toISOString();
    await progress();
  };
  for (const group of groups) {
    if (stopped) break;
    group.startedAt = Date.now();
    const pending: Array<{
      execution: AsyncGenerator<void, void>;
      result: ConfigurationStepCaseResult;
    }> = [];
    for (const id of group.caseIds) {
      if (stopped) break;
      const c = document.cases.find((c) => c.caseId === id)!;
      const result = results.get(id)!;
      result.outcome = "passed";
      result.lifecycle = "running";
      result.startedAt = new Date().toISOString();
      await progress();
      const execution = runCase(c, result);
      const state = await execution.next();
      if (!state.done) pending.push({ execution, result });
      else await finishCase(result);
      stopped ||= result.stopFollowingCases;
    }
    group.submissionsClosedAt = Date.now();
    // Only configuration/submission is interleaved. All waits, assertions and recovery finish
    // before the next group; a stop never abandons another already-owned task.
    for (const { execution, result } of pending) {
      for (;;) {
        const state = await execution.next();
        if (state.done) break;
      }
      await finishCase(result);
    }
    const members = group.caseIds.map((id) => results.get(id)!);
    group.taskIds = members.flatMap(
      (c) => c.tasks?.flatMap((t) => (t.taskId ? [t.taskId] : [])) ?? [],
    );
    group.queueCoverage =
      group.taskIds.length < 2
        ? "not-applicable"
        : group.taskIds.some((id) => {
              const s = ownedSubmissions.get(id)!;
              return (
                s.queuedBehindOwned && s.terminal && s.task?.observation?.processingAt !== undefined
              );
            })
          ? "observed"
          : "not-observed";
    group.settledAt = Date.now();
    group.outcome = members.every((c) => c.outcome === "passed") ? "passed" : "failed";
    stopped ||= members.some((c) => c.stopFollowingCases);
    await progress();
  }
  for (const c of cases) if (c.outcome === "skipped") c.stopFollowingCases = stopped;
  return {
    kind: "pink-configuration-steps-result",
    schemaVersion: 2,
    evidenceKind: env.evidenceKind,
    buildSubmitted: submitted,
    buildAttempted: attempted,
    taskMayStillBeRunning: uncertain,
    stopped,
    outcome: cases.every((c) => c.outcome === "passed") ? "passed" : "failed",
    execution: buildStepScheduling,
    groups,
    cases,
  };

  async function* runCase(
    c: BuildStepCase,
    result: ConfigurationStepCaseResult,
  ): AsyncGenerator<void, void> {
    const caseInputs = inputs?.case(c.caseId);
    const inputBlockers =
      caseInputs?.blockers ??
      (stepNeedsInputs(c) ? ["步骤输入尚未绑定工程/材料，请通过加载入口准备"] : []);
    if (inputBlockers.length) {
      result.outcome = "blocked";
      result.restoration = "not-required";
      result.failure = {
        code: "precondition",
        reason: inputBlockers.join("；"),
        disposition: "blocked",
      };
      if (c.onFailure === "stop") {
        result.outcome = "stopped";
        result.stopFollowingCases = true;
        result.stopReason = {
          code: "case-policy",
          reason: "用例输入受阻，按用例策略停止后续执行",
          disposition: "stop",
        };
      }
      return;
    }
    const cleanupEntries = result.steps.slice(c.steps.length);
    let builderPage: string | undefined;
    const builderSnapshots = new Map<string, BuilderHomeObservation>();
    const requirePlatform = () => {
      if (!c.platform)
        throw new ConfigurationOperationError("context", "公共检查不能借用平台配置操作", "stop");
      return c.platform;
    };
    let active: { id: string; operations: ConfigurationOperations } | undefined;
    let original: ConfigurationRecord | undefined;
    let stageOriginal: StageRecord | undefined;
    const stageSnapshots = new Map<string, StageSnapshot>();
    const observations = new Map<
      string,
      {
        value: TargetObservation | CandidateObservation;
        refresh: () => Promise<TargetObservation | CandidateObservation>;
        context?: ConfigurationOperations["context"];
        revision?: number;
      }
    >();
    let failed = false,
      unsafe = false;
    const snapshots = new Map<
      string,
      {
        ui: ConfigurationSnapshot;
        capture?: BuildCapture;
        definition: Extract<BuildStep, { op: "read" }>;
      }
    >();
    const retained = new Map<string, ConfigurationSnapshot>();
    const hidden = new Map<string, { field: string; observed?: ConfigurationSnapshot }>();
    const guards = new Map<string, (operations: ConfigurationOperations) => Promise<void>>();
    const submissions = new Map<string, Submission>();
    const finished = new Map<string, { reference: string; task: Task }>();
    const publish = async () => {
      result.tasks = [...submissions].map(([reference, s]) => ({
        reference,
        attempted: s.attempted,
        taskId: s.task?.id,
        state: s.task?.state,
        progress: s.task?.progress,
        submittedAt: s.submittedAt,
        collected: !!s.terminal,
      }));
      await progress();
    };
    const page = (id: string) => {
      if (!active || active.id !== id)
        throw new ConfigurationOperationError("context", "页面引用已经失效", "stop");
      return active.operations;
    };
    const capture = async (
      operations: ConfigurationOperations,
      step: Extract<BuildStep, { op: "read" }>,
    ) => {
      const supplemental: BuildSupplement = { values: {}, preserved: [] };
      if (step.retained) {
        const result = await retainedValues(operations, retained.get(step.retained)!, true);
        supplemental.values = result.values;
        supplemental.preserved = result.preserved;
      }
      for (const ref of step.hidden ?? []) {
        const value = hidden.get(ref)!;
        supplemental.values[value.field] = await assertHiddenValue(
          operations,
          value.field,
          value.observed,
        );
      }
      for (const check of guards.values()) await check(operations);
      return env.build!.capture(
        operations,
        step.fields.filter((field) => !Object.hasOwn(supplemental.values, field)),
        supplemental,
      );
    };
    const failure = async (out: ConfigurationStepResult, error: unknown) => {
      const typed = error instanceof ConfigurationOperationError ? error : undefined;
      const disposition = typed?.disposition ?? "failed";
      const secrets = [
        ...(caseInputs?.secrets ?? []),
        ...[...(original?.restore ?? [])].flatMap(([field, value]) =>
          sensitiveConfigurationField(field) && typeof value.value === "string"
            ? [value.value]
            : [],
        ),
      ];
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
      if (c.onFailure === "stop") result.stopFollowingCases = true;
      if (typed && ["context", "submission", "task"].includes(typed.code))
        unsafe = unsafeContext = true;
      if (out.operation === "restore" || out.operation === "stage.restore") {
        result.restoration = "failed";
        unsafe = true;
        unsafeContext = true;
      }
      if (env.captureFailure)
        out.evidence = await env
          .captureFailure(c.caseId, out)
          .catch(() => ({ unavailable: "现场采集失败，继续既定收尾" }));
    };
    const collect = async (reference: string, submission: Submission) => {
      if (!submission.task || submission.terminal) return submission.terminal;
      submission.collectionAttempted = true;
      const build = env.build!;
      let lastObservation = "";
      const value = await waitBuild({
        ...build,
        verify: () => env.session.verify(),
        taskId: submission.task.id,
        submittedAt: submission.submittedAt!,
        onObservation: async (task) => {
          submission.task = task;
          if (!unsafeContext) checkTasks();
          const state = JSON.stringify(
            [...ownedSubmissions].map(([id, s]) => [id, s.task?.state, s.task?.progress]),
          );
          if (state !== lastObservation) {
            lastObservation = state;
            await publish();
          }
        },
      });
      submission.terminal = value.task;
      submission.task = value.task;
      return (finished.set(reference, { reference, task: value.task }), value.task);
    };
    const execute = async (step: BuildStep, out: ConfigurationStepResult, cleanup: boolean) => {
      out.startedAt = new Date().toISOString();
      try {
        if (!cleanup) checkExecutionStop(env.stopSignal);
        await publish();
        await env.session.verify();
        checkTasks();
        switch (step.op) {
          case "builder.open":
            if (!c.target || !env.builderUi)
              throw new ConfigurationOperationError(
                "precondition",
                "缺少公共构建页面适配",
                "blocked",
              );
            await env.builderUi.open(c.target);
            builderPage = step.id;
            builderSnapshots.clear();
            out.output = { target: c.target, opened: true };
            break;
          case "builder.read":
            if (!c.target || !env.builderUi || builderPage !== step.page)
              throw new ConfigurationOperationError("context", "公共页面引用无效", "stop");
            out.output = await env.builderUi.read(c.target);
            if ((out.output as BuilderHomeObservation).category !== c.target.category)
              throw new ConfigurationOperationError("context", "公共观察不属于声明的分类", "stop");
            builderSnapshots.set(step.id, out.output as BuilderHomeObservation);
            break;
          case "builder.home":
            if (!c.target || !env.builderUi)
              throw new ConfigurationOperationError("context", "缺少公共页面收尾适配", "stop");
            await env.builderUi.home(c.target);
            builderPage = undefined;
            out.output = { target: c.target, home: true };
            break;
          case "platform.probe":
            if (!env.probePlatform)
              throw new ConfigurationOperationError("precondition", "缺少平台探查适配", "blocked");
            out.output = await env.probePlatform(requirePlatform());
            observations.set(step.id, {
              value: out.output as TargetObservation,
              refresh: () => env.probePlatform!(requirePlatform()),
            });
            break;
          case "config.probe":
          case "config.candidates": {
            const operations = page(step.page);
            const value =
              step.op === "config.probe"
                ? await operations.probe(step.field)
                : await operations.candidates(step.field);
            observations.set(step.id, {
              value,
              refresh: () =>
                step.op === "config.probe"
                  ? operations.probe(step.field)
                  : operations.candidates(step.field),
              context: operations.context,
              revision: operations.context.revision,
            });
            out.output = value;
            break;
          }
          case "config.select":
            out.output = await page(step.page).selectCandidate(step.field, step.candidate);
            break;
          case "config.open": {
            if (!cleanup) {
              await env.verifySource?.();
              await inputs?.verify();
            }
            if (active) {
              if (!cleanup)
                throw new ConfigurationOperationError("context", "不能隐式关闭现有配置页", "stop");
              await active.operations.context.verify();
              active.id = step.id;
              out.output = { platform: c.platform, mode: "reused" };
            } else {
              const operations = await env.openConfiguration(requirePlatform());
              if (operations.context.session !== env.session || operations.platform !== c.platform)
                throw new ConfigurationOperationError(
                  "context",
                  "配置页不属于目标会话或平台",
                  "stop",
                );
              await operations.context.verify();
              operations.stages.bindTaskGuard(checkTasks);
              active = { id: step.id, operations };
              if (original) await operations.continueRecord(original);
              out.output = { platform: c.platform, mode: "opened" };
              if (document.targets?.some((target) => target.id === c.platform))
                out.output = {
                  ...(out.output as object),
                  identityEvidence: {
                    bindingId: c.platform,
                    configurationTitle: operations.context.title,
                    basis: "declared-card-and-title",
                    productPlatformIdVerified: false,
                  },
                };
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
          case "stage.record":
            stageOriginal = await page(step.page).stages.record();
            out.output = { groups: stageOriginal.view.groups, visible: stageOriginal.view.visible };
            break;
          case "stage.read": {
            const snapshot = await page(step.page).stages.read();
            stageSnapshots.set(step.id, snapshot);
            out.output = snapshot.view;
            break;
          }
          case "stage.hint":
            out.output = await page(step.page).stages.hint(step.control, step.stage, step.contains);
            break;
          case "stage.link":
          case "stage.unlink":
            out.output = await page(step.page).stages.change(
              stageOriginal!,
              step.op === "stage.link" ? "link" : "unlink",
              step.op === "stage.link" ? step.previous : step.group,
              step.stage,
            );
            break;
          case "stage.restore": {
            if (!stageOriginal) {
              out.output = { reason: "尚未取得阶段记录" };
              break;
            }
            const operations = page(step.page);
            out.output = await operations.stages.restore(stageOriginal);
            if (step.reopen) {
              await operations.reopen();
              const current = await operations.stages.read();
              await operations.stages.assert(current, {
                groups: stageOriginal.view.groups,
                visible: stageOriginal.view.visible,
              });
              out.output = { ...(out.output as object), reopened: true };
            }
            if (!original) result.restoration = "passed";
            break;
          }
          case "retain": {
            const baseline = await page(step.page).snapshot(step.fields);
            retained.set(step.id, baseline);
            out.output = {
              fields: Object.entries(baseline.fields).map(([field, control]) => ({
                field,
                state: control ? "observed" : "not-observed-at-start",
              })),
            };
            break;
          }
          case "config.ready":
            await page(step.page).ready();
            break;
          case "config.require": {
            const operations = page(step.page),
              expected = structuredClone(step.expected);
            if (caseInputs) {
              for (const [field, value] of Object.entries(expected.differs ?? {}))
                expected.differs![field] = (
                  await caseInputs.resolve(field, value, operations)
                ).value;
              for (const condition of expected.emptyWhen ?? [])
                condition.value = (
                  await caseInputs.resolve(condition.field, condition.value, operations)
                ).value;
            }
            out.output = await requireInitial(operations, expected);
            break;
          }
          case "input.cancel-file":
            out.output = await cancelFile(page(step.page), step.field);
            break;
          case "input.clear-field": {
            const operations = page(step.page),
              before = await operations.read(step.field);
            if (typeof before.value !== "string")
              throw new ConfigurationOperationError(
                "precondition",
                "清空操作只适用于字符串控件",
                "blocked",
              );
            await operations.set(step.field, "");
            operations.check(
              "cleared",
              step.field,
              (await operations.read(step.field)).value === "",
            );
            out.output = { field: step.field, cleared: true };
            break;
          }
          case "input.clear-scenes":
            out.output = await clearScenes(page(step.page));
            break;
          case "config.expand":
            await page(step.page).expandSection("网络超时");
            break;
          case "config.prepare": {
            const operations = page(step.page);
            const target = caseInputs
              ? (await caseInputs.resolve(step.field, step.value, operations)).value
              : step.value;
            out.output = await prepareConfigurationWrite(operations, step.field, target);
            break;
          }
          case "input.google-icon": {
            const operations = page(step.page),
              field = "packages.google-play.customIcon";
            const file = String(
              caseInputs
                ? (await caseInputs.resolve(field, step.file, operations)).value
                : step.file,
            );
            let hash: string;
            try {
              hash = contentHash(await readFile(file));
            } catch {
              throw new ConfigurationOperationError(
                "precondition",
                "Google 图标材料不可读取",
                "blocked",
              );
            }
            await operations.googleIcon(file);
            const originalFile = (await operations.read(field + "File")).value;
            const verify = async (current: ConfigurationOperations) => {
              let currentHash;
              try {
                currentHash = contentHash(await readFile(file));
              } catch {
                /* Report a closed material contract below. */
              }
              if (currentHash !== hash)
                throw new ConfigurationOperationError("snapshot", "Google 图标材料已变化", "stop");
              current.check(
                "google-icon-mode",
                field,
                (await current.read(field)).value === "custom",
              );
              current.check(
                "google-icon-file",
                field + "File",
                !!originalFile &&
                  configurationEqual((await current.read(field + "File")).value, originalFile),
              );
            };
            await verify(operations);
            guards.set("google-icon", verify);
            out.output = { mode: "custom", fileSha256: hash, readback: "mode-and-file" };
            break;
          }
          case "input.openpaas-game": {
            const operations = page(step.page),
              field = "packages.openpaas.appid";
            const id = String(
              caseInputs
                ? (await caseInputs.resolve(field, step.value, operations)).value
                : step.value,
            );
            const before = await operations.openpaasPage();
            if (
              !/^\d+$/.test(id) ||
              !before.ids.includes(id) ||
              (step.requireChange && before.id === id)
            )
              throw new ConfigurationOperationError(
                "precondition",
                "目标必须是已有游戏；切换专项需与当前游戏不同",
                "blocked",
              );
            if (before.id !== id) {
              try {
                assertExistingGameSelectable(before, id);
                if (original) assertExistingGameSelectable(before, before.id);
              } catch {
                throw new ConfigurationOperationError(
                  "precondition",
                  "目标游戏须可选择；声明恢复时原游戏也须可选择",
                  "blocked",
                );
              }
              await operations.selectOpenpaasGame(id);
            }
            const after = await operations.openpaasPage();
            operations.check(
              "existing-game",
              field,
              after.id === id &&
                after.codeVersion === after.games.find((g) => g.id === id)?.codeVersion,
            );
            out.output = {
              changed: before.id !== id,
              selectedExisting: true,
              codeVersionMatched: true,
            };
            break;
          }
          case "set": {
            const operations = page(step.page);
            const resolved = caseInputs
              ? await caseInputs.resolve(step.field, step.value, operations)
              : { value: step.value, enumLabel: undefined };
            out.output = {
              field: step.field,
              changed: await operations.set(
                step.field,
                resolved.value,
                step.input,
                resolved.enumLabel,
              ),
              ...(["startScene", "scenes"].includes(step.field) && caseInputs
                ? { sceneResolution: structuredClone(caseInputs.scenes) }
                : {}),
            };
            break;
          }
          case "read": {
            const operations = page(step.page);
            const extraFields = [
              ...(step.retained ? Object.keys(retained.get(step.retained)!.fields) : []),
              ...(step.hidden ?? []).flatMap((ref) => {
                const field = hidden.get(ref)!.field;
                return [field, hiddenCondition(field)!.field];
              }),
            ];
            const ui = await operations.snapshot([...new Set([...step.fields, ...extraFields])]);
            const buildCapture =
              step.scope === "build" ? await capture(operations, step) : undefined;
            await operations.assertSnapshotCurrent(ui);
            snapshots.set(step.id, { ui, capture: buildCapture, definition: step });
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
              await env.verifySource?.();
              await inputs?.verify();
              await env.session.verify();
              checkTasks();
              await operations.assertSnapshotCurrent(snapshot.ui);
              const current = await capture(operations, snapshot.definition);
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
              platform: requirePlatform(),
              outputName: submission.capture.configuration.outputName,
              verify,
              click: () => env.build!.click(operations, verify),
              signal: env.build!.signal,
              onAttempt: async (at) => {
                attempted = true;
                submission.attempted = true;
                submission.submittedAt = at;
                await publish();
              },
            });
            // Retain ownership before parameter assertions so failed cases still collect this task.
            submission.task = accepted.task;
            submission.queuedBehindOwned =
              accepted.task.state === "waiting" &&
              [...owned].some((id) => {
                const previous = env.build!.source.get(id);
                return previous && !isTerminal(previous);
              });
            submitted = true;
            owned.add(accepted.task.id);
            ownedSubmissions.set(accepted.task.id, submission);
            out.output = {
              taskId: accepted.task.id,
              submittedAt: accepted.submittedAt,
              acceptedAt: accepted.acceptedAt,
            };
            operations.context.invalidate();
            active = undefined;
            assertParameters(accepted.task, requirePlatform(), submission.capture);
            break;
          }
          case "build.wait": {
            const task = await collect(step.task, submissions.get(step.task)!);
            finished.set(step.id, { reference: step.task, task: task! });
            out.output = { taskId: task!.id, state: task!.state };
            break;
          }
          case "assert": {
            if (step.check === "probe" || step.check === "candidate") {
              const observed = observations.get(step.observation)!;
              if (observed.context) {
                await observed.context.verify();
                if (observed.revision !== observed.context.revision)
                  throw new ConfigurationOperationError("snapshot", "目标观察已过期", "stop");
              }
              if (!configurationEqual(observed.value, await observed.refresh()))
                throw new ConfigurationOperationError(
                  "snapshot",
                  "目标或候选在观察后已变化，请重新探查",
                  "stop",
                );
              out.output =
                step.check === "probe"
                  ? assertTargetObservation(observed.value as TargetObservation, step.expected)
                  : assertCandidateObservation(
                      observed.value as CandidateObservation,
                      step.candidate,
                      step.expected,
                    );
            } else if (step.check === "empty") {
              const operations = page(step.page);
              out.output = operations.check(
                "empty",
                step.field,
                (await operations.read(step.field)).value === "",
              );
            } else if (step.check === "protected-choice") {
              const operations = page(step.page),
                control = await operations.read(step.field);
              out.output = operations.check(
                "protected-choice",
                step.field,
                !!control.choices?.some((c) => c.checked && c.disabled),
              );
            } else if (step.check === "build-enabled") {
              const operations = page(step.page);
              out.output = operations.check(
                "build-enabled",
                "build",
                (await operations.primaryBuildEnabled()) === step.expected,
              );
            } else if (step.check === "unchanged") {
              const operations = page(step.page),
                baseline = snapshots.get(step.snapshot)!.ui;
              if (
                baseline.context.session !== operations.context.session ||
                baseline.context.platform !== operations.platform
              )
                throw new ConfigurationOperationError(
                  "context",
                  "历史观察不属于当前会话和平台",
                  "stop",
                );
              out.output = [];
              for (const field of step.fields) {
                const before = baseline.fields[field],
                  current = await operations.inspect(field);
                (out.output as unknown[]).push(
                  operations.check(
                    "unchanged",
                    field,
                    !!before && !!current && configurationEqual(before.value, current.value),
                  ),
                );
              }
            } else if (step.check === "stages") {
              out.output = await active!.operations.stages.assert(
                stageSnapshots.get(step.snapshot)!,
                step.expected,
              );
            } else if (step.check === "build-scope") {
              const view = (await page(step.page).stages.read()).view;
              let allowed = true;
              try {
                assertBuildOnly(view);
              } catch (error) {
                if (
                  !(error instanceof ConfigurationOperationError) ||
                  error.disposition !== "blocked"
                )
                  throw error;
                allowed = false;
              }
              page(step.page).check("build-scope", "build", allowed === step.expected.allowed);
              out.output = { allowed, groups: view.groups, buildClicked: false };
            } else if (step.check === "retained") {
              out.output = (
                await retainedValues(
                  page(step.page),
                  retained.get(step.retained)!,
                  c.steps.some((s) => s.op === "build.submit"),
                )
              ).observations;
            } else if (step.check === "hidden") {
              const observed = step.observed ? snapshots.get(step.observed)!.ui : undefined;
              await assertHiddenValue(page(step.page), step.field, observed);
              hidden.set(step.id, { field: step.field, observed });
              out.output = {
                field: step.field,
                hidden: true,
                source: step.observed ?? "parent-derived-false",
              };
            } else if (step.check === "agc-material" || step.check === "openpaas-ready") {
              const operations = page(step.page);
              const observe =
                step.check === "agc-material"
                  ? assertAgcConfiguration
                  : (current: ConfigurationOperations) => current.assertOpenpaasReady();
              const expected = await observe(operations);
              guards.set(step.check, async (current) => {
                if (!configurationEqual(await observe(current), expected))
                  throw new ConfigurationOperationError(
                    "snapshot",
                    "平台专属材料或已有游戏与已检查状态不一致",
                    "stop",
                  );
              });
              out.output = expected;
            } else if (step.check === "build-result") {
              const submission = submissions.get(step.task)!,
                value = finished.get(step.result)!;
              if (value.reference !== step.task || value.task.id !== submission.task?.id)
                throw new ConfigurationOperationError("context", "终态结果不属于指定任务", "stop");
              assertBuildSucceeded(value.task);
              assertParameters(value.task, requirePlatform(), submission.capture);
              await env.build!.assertCard(value.task);
              submission.checked = true;
              out.output = {
                taskId: value.task.id,
                state: value.task.state,
                parameters: "matched",
                card: "passed",
              };
            } else if (step.check === "builder-state") {
              const snapshot = builderSnapshots.get(step.snapshot);
              if (!c.target || !env.builderUi || !snapshot || !builderPage)
                throw new ConfigurationOperationError("context", "公共断言缺少当前观察", "stop");
              out.output = assertBuilderHome(
                snapshot,
                await env.builderUi.read(c.target),
                step.expected,
              );
            } else if (step.check === "values") {
              const expected: CaseValues = {};
              for (const [field, value] of Object.entries(step.values))
                expected[field] = caseInputs
                  ? (await caseInputs.resolve(field, value, active!.operations)).value
                  : value;
              const snapshot = snapshots.get(step.snapshot)!.ui;
              await active!.operations.assertSnapshotCurrent(snapshot);
              out.output = Object.entries(expected).map(([field, target]) =>
                active!.operations.check(
                  "readback",
                  field,
                  !!snapshot.fields[field] &&
                    configurationValueMatches(field, snapshot.fields[field]!.value, target),
                ),
              );
            } else if (step.check === "prompt")
              out.output = await active!.operations.assertPrompt(step.field, step.expected);
            else if (step.check === "state")
              out.output = await active!.operations.assertState(step.field, step.expected);
            break;
          }
          case "restore":
            if (!original) {
              out.output = { reason: "尚未取得原值记录" };
              return;
            }
            await page(step.page).restore(original, undefined, step.reopen ?? false);
            result.restoration = "passed";
            break;
        }
        out.outcome = "passed";
      } catch (error) {
        // Opening may have left an unverified modal behind; never continue to another case.
        if (
          ["config.open", "builder.open", "builder.home"].includes(step.op) &&
          !(error instanceof ConfigurationOperationError)
        )
          error = new ConfigurationOperationError(
            "context",
            step.op === "config.open"
              ? "配置页未能确认，停止后续输入"
              : "公共页面未能打开或收尾，停止后续输入",
            "stop",
            { cause: error },
          );
        await failure(out, error);
      } finally {
        out.finishedAt = new Date().toISOString();
        if (step.op === "restore" && original)
          out.restorationTrace = structuredClone(original.restorationTrace);
        await publish();
      }
    };
    let deferred = false;
    for (const [i, step] of c.steps.entries()) {
      if (failed) break;
      if (step.op === "build.wait" && !deferred) {
        deferred = true;
        yield;
      }
      if (unsafeContext && !unsafe) {
        await failure(
          result.steps[i],
          new ConfigurationOperationError(
            "context",
            "同组其他用例已使会话或提交范围不安全；仅收集已关联任务，停止配置操作",
            "stop",
          ),
        );
        break;
      }
      await execute(step, result.steps[i], false);
    }
    if (env.stopSignal?.aborted && !failed) {
      const out: ConfigurationStepResult = {
        stepId: "interruption",
        operation: "interruption",
        trigger: "sequence",
        outcome: "stopped",
      };
      result.steps.push(out);
      await failure(out, env.stopSignal.reason);
    }
    // A queued-parameter failure also yields its known task to the group barrier.
    if (!deferred && [...submissions.values()].some((s) => s.task && !s.terminal)) yield;
    // A failed assertion never abandons an already-owned task. Uncertain submissions are not retried.
    for (const [reference, submission] of submissions) {
      if (
        !submission.task ||
        submission.terminal ||
        submission.checked ||
        submission.collectionAttempted
      )
        continue;
      let cleanupId = reference + ".collect";
      while (result.steps.some((s) => s.stepId === cleanupId)) cleanupId += "X";
      const out: ConfigurationStepResult = {
        stepId: cleanupId,
        operation: "build.wait",
        trigger: "cleanup",
        outcome: "skipped",
        startedAt: new Date().toISOString(),
      };
      const index = result.steps.indexOf(cleanupEntries[0]);
      result.steps.splice(index < 0 ? result.steps.length : index, 0, out);
      try {
        const task = await collect(reference, submission);
        if (task) {
          out.output = { taskId: task.id, state: task.state };
          assertBuildSucceeded(task);
          assertParameters(task, requirePlatform(), submission.capture);
        }
        out.outcome = "passed";
      } catch (error) {
        await failure(out, error);
      }
      out.finishedAt = new Date().toISOString();
    }
    if (unsafe || unsafeContext) {
      result.stopFollowingCases = true;
      result.stopReason ??= {
        code: "context",
        reason: "同组状态不安全，停止配置恢复及后续用例；已关联任务保留收集结果",
        disposition: "stop",
      };
      result.failure ??= result.stopReason;
      failed = true;
      if ((original || stageOriginal) && result.restoration !== "failed")
        result.restoration = "unsafe";
    } else if (original || stageOriginal || active || builderPage) {
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
      progress: s.task?.progress,
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
    if (failed && c.onFailure === "stop" && !result.stopReason) {
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
