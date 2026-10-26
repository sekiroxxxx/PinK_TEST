import { setTimeout as delay } from "node:timers/promises";
import { ConfigurationOperationError } from "./configuration-context.js";
import { waitFor, type Task } from "./common.js";
import { isTerminal, taskTimeout, taskTiming } from "./task-observer.js";

export interface TaskSource {
  tasks(): Task[];
  get(id: string): Task | undefined;
  assertHealthy(): void;
}

/** Shared by the legacy runner and step runner. Association never clicks a second time. */
export async function submitBuild(input: {
  source: TaskSource;
  baselineIds: ReadonlySet<string>;
  platform: string;
  outputName: string;
  verify(): Promise<void>;
  click(): Promise<number>;
  onAttempt(at: number): void | Promise<void>;
  signal: AbortSignal;
  associationTimeoutMs?: number;
}) {
  await input.verify();
  input.source.assertHealthy();
  let submittedAt = Date.now();
  await input.onAttempt(submittedAt);
  try {
    submittedAt = await input.click();
    await input.onAttempt(submittedAt);
    const task = await waitFor(
      "本次唯一新任务",
      async () => {
        input.source.assertHealthy();
        const matches = input.source
          .tasks()
          .filter(
            (task) =>
              !input.baselineIds.has(task.id) &&
              !task.parentTaskId &&
              task.platform === input.platform &&
              task.outputName === input.outputName &&
              typeof task.createdAt === "number" &&
              task.createdAt >= submittedAt,
          );
        const unique = new Map(matches.map((task) => [task.id, task]));
        if (unique.size > 1)
          throw new Error(`多个新任务匹配本次点击，无法唯一关联：${[...unique.keys()].join(", ")}`);
        return [...unique.values()][0];
      },
      input.associationTimeoutMs ?? 30_000,
      input.signal,
    );
    return { task, submittedAt, acceptedAt: Date.now() };
  } catch (cause) {
    throw new ConfigurationOperationError(
      "submission",
      `提交未能唯一确认；停止后续提交，不自动重试：${cause instanceof Error ? cause.message : "未知响应"}`,
      "stop",
      { cause },
    );
  }
}

export function observedBuildTask(source: TaskSource, id: string): Task {
  source.assertHealthy();
  const task = source.get(id);
  if (!task) throw new Error(`本次任务从完整列表消失：${id}`);
  if (
    !["waiting", "processing", "success", "failure", "cancelled", "generated"].includes(task.state)
  )
    throw new Error(`未知任务状态：${task.state}`);
  if (task.state === "waiting" && task.observation?.processingAt !== undefined)
    throw new Error(`本次任务被重新排队，无法继续关联本轮执行：${id}`);
  return task;
}

export async function waitBuild(input: {
  source: TaskSource;
  taskId: string;
  submittedAt: number;
  queueTimeoutMs: number;
  buildTimeoutMs: number;
  signal: AbortSignal;
  onObservation?(task: Task): void;
  verify?(): Promise<void>;
}) {
  try {
    for (;;) {
      input.signal.throwIfAborted();
      await input.verify?.();
      const task = observedBuildTask(input.source, input.taskId);
      input.onObservation?.(task);
      const timeout = taskTimeout(
        task,
        input.submittedAt,
        Date.now(),
        input.queueTimeoutMs,
        input.buildTimeoutMs,
      );
      if (timeout)
        throw new Error(
          timeout === "startup-wait"
            ? "启动等待超时：尚未观察到 processing"
            : "构建观察超时：首次 processing 后超过上限",
        );
      if (isTerminal(task))
        return { task, timing: taskTiming(task, input.submittedAt, Date.now()) };
      await delay(300, undefined, { signal: input.signal });
    }
  } catch (cause) {
    throw new ConfigurationOperationError(
      "task",
      "任务跟踪中断或超时；任务可能仍在运行，停止后续提交",
      "stop",
      { cause },
    );
  }
}

export function assertBuildSucceeded(task: Task): void {
  if (task.state !== "success")
    throw new Error(`任务未构建成功：${task.state}；${task.message ?? ""}`);
}
