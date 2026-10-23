import { setTimeout as delay } from "node:timers/promises";
import type { Builder } from "./builder.js";
import { errorMessage, type Task, type TaskObservation } from "./common.js";

export function isTerminal(task: Task): boolean {
  return ["success", "failure", "cancelled", "generated"].includes(task.state);
}

export function taskTiming(task: Task, submittedAt: number, now: number) {
  const observation = task.observation;
  const createdAt = task.createdAt ?? submittedAt;
  const end = observation?.terminalAt ?? now;
  const processingAt = observation?.processingAt;
  return {
    basis: "webview-observation" as const,
    createdAt,
    waitingObservedAt: observation?.waitingAt,
    processingObservedAt: processingAt,
    terminalObservedAt: observation?.terminalAt,
    startupWaitMs: Math.max(0, (processingAt ?? end) - createdAt),
    processingMs: processingAt === undefined ? undefined : Math.max(0, end - processingAt),
    phase: isTerminal(task)
      ? processingAt === undefined
        ? "terminal-without-processing"
        : "terminal"
      : processingAt === undefined
        ? "waiting-for-processing"
        : "processing",
  };
}

export function taskTimeout(
  task: Task,
  submittedAt: number,
  now: number,
  queueTimeoutMs: number,
  buildTimeoutMs: number,
): "startup-wait" | "processing" | undefined {
  const timing = taskTiming(task, submittedAt, now);
  if (timing.startupWaitMs > queueTimeoutMs) return "startup-wait";
  if (timing.processingMs !== undefined && timing.processingMs > buildTimeoutMs)
    return "processing";
  return undefined;
}

/** Reads only responses produced by PinK's own UI. UI input remains in the main flow. */
export class TaskObserver {
  private current = new Map<string, Task>();
  private latestAt = 0;
  private stopped = false;
  private runner?: Promise<void>;
  private failure?: string;

  constructor(private readonly builders: Builder[]) {}

  tasks(): Task[] {
    return [...this.current.values()];
  }
  get(id: string): Task | undefined {
    return this.current.get(id);
  }

  assertHealthy(): void {
    if (this.failure) throw new Error(`任务观察中断：${this.failure}`);
  }

  async poll(): Promise<void> {
    const snapshots = (await Promise.all(this.builders.map((builder) => builder.latestSnapshot())))
      .filter((snapshot) => snapshot !== undefined)
      .sort((a, b) => a.at - b.at);
    const latest = snapshots.at(-1);
    if (!latest || latest.at <= this.latestAt) return;
    const next = new Map<string, Task>();
    for (const task of latest.tasks) {
      const observations = [
        this.current.get(task.id)?.observation,
        ...snapshots.map(
          (snapshot) => snapshot.tasks.find((item) => item.id === task.id)?.observation,
        ),
      ].filter((observation) => observation !== undefined);
      const observation = {} as TaskObservation;
      for (const key of ["firstSeenAt", "waitingAt", "processingAt", "terminalAt"] as const) {
        const times = observations.flatMap((value) =>
          value[key] === undefined ? [] : [value[key]!],
        );
        if (times.length) observation[key] = Math.min(...times);
      }
      next.set(task.id, { ...task, observation });
    }
    this.current = next;
    this.latestAt = latest.at;
  }

  start(onUpdate: () => void): void {
    this.runner = (async () => {
      while (!this.stopped) {
        try {
          await this.poll();
          onUpdate();
        } catch (error) {
          this.failure = errorMessage(error);
          return;
        }
        await delay(300);
      }
    })();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.runner;
  }
}
