import { setTimeout as sleep } from "node:timers/promises";

export interface Options {
  pink: string;
  project: string;
  port: number;
  timeoutMs: number;
  queueTimeoutMs: number;
  configurationTimeoutMs: number;
  resultsRoot: string;
}

export type FieldValue = boolean | string | number;

export interface TaskObservation {
  firstSeenAt: number;
  waitingAt?: number;
  processingAt?: number;
  terminalAt?: number;
}

export interface Task {
  caseOptions?: Record<string, unknown>;
  id: string;
  platform: string;
  state: string;
  progress: number;
  outputName?: string;
  createdAt?: number;
  groupId?: string;
  groupCreatedAt?: number;
  completedAt?: number;
  message?: string;
  displayName?: string;
  options?: Record<string, unknown>;
  parentTaskId?: string;
  childTaskIds?: string[];
  specialOptions?: Record<string, { present: boolean; value?: FieldValue }>;
  observation?: TaskObservation;
}

export interface TaskSnapshot {
  at: number;
  tasks: Task[];
}

export interface Configuration {
  name: string;
  buildPath: string;
  outputName: string;
  startScene: string;
  startSceneId: string;
  debug: boolean;
  selectedScenes: string[];
  fields: Record<string, boolean | string>;
}

export async function waitFor<T>(
  description: string,
  read: () => Promise<T | undefined>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const value = await read();
    if (value !== undefined) return value;
    await sleep(300, undefined, { signal });
  }
  throw new Error(`等待超时：${description}`);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
