import { setTimeout as delay } from "node:timers/promises";
import type { Builder } from "./builder.js";
import { type Task, type TaskObservation, type TaskSnapshot } from "./common.js";
import { ConfigurationOperationError } from "./configuration-context.js";

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
  private snapshots: Array<TaskSnapshot | undefined> = [];
  private stopped = false;
  private runner?: Promise<void>;
  private failure?: unknown;

  constructor(
    private readonly builders: Builder[],
    private readonly platformsBySource: readonly (readonly string[])[] = [],
  ) {}

  tasks(): Task[] {
    return [...this.current.values()];
  }
  get(id: string): Task | undefined {
    return this.current.get(id);
  }

  assertHealthy(): void {
    if (this.failure)
      throw new ConfigurationOperationError("task", "任务观察中断，停止后续提交", "stop", {
        cause: this.failure,
      });
  }

  async poll(): Promise<void> {
    const received = await Promise.all(
      this.builders.map(async (builder, index) => {
        try {
          return await builder.latestSnapshot();
        } catch (cause) {
          throw new ConfigurationOperationError("task", `任务来源 ${index} 读取失败`, "stop", {
            cause,
            diagnostic: {
              phase: "task-observer-poll",
              observations: { source: index, platforms: this.platformsBySource[index] },
            },
          });
        }
      }),
    );
    let changed = false;
    for (const [index, snapshot] of received.entries()) {
      const previous = this.snapshots[index];
      if (
        !snapshot ||
        (previous &&
          (snapshot.requestSequence !== undefined && previous.requestSequence !== undefined
            ? snapshot.requestSequence <= previous.requestSequence
            : snapshot.at <= previous.at))
      )
        continue;
      this.snapshots[index] = snapshot;
      changed = true;
    }
    if (!changed) return;
    const snapshots = this.snapshots.filter((s): s is TaskSnapshot => !!s);
    const latest = [...snapshots].sort((a, b) => a.at - b.at).at(-1)!;
    const next = new Map<string, Task>();
    const candidates = new Map(
      snapshots.flatMap((snapshot) => snapshot.tasks.map((task) => [task.id, task] as const)),
    );
    for (const candidate of candidates.values()) {
      const source = this.platformsBySource.findIndex((platforms) =>
        platforms.includes(candidate.platform),
      );
      const authoritative = source < 0 ? latest : this.snapshots[source];
      const task = authoritative?.tasks.find((task) => task.id === candidate.id);
      if (!task) continue;
      const observations = [this.current.get(task.id)?.observation, task.observation].filter(
        (observation) => observation !== undefined,
      );
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
  }

  start(onUpdate: () => void): void {
    this.runner = (async () => {
      while (!this.stopped) {
        try {
          await this.poll();
          onUpdate();
        } catch (error) {
          this.failure = error;
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
