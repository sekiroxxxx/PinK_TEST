import { ConfigurationOperationError } from "./configuration-context.js";

export type StopSource = "SIGINT" | "SIGTERM" | "parent-disconnect" | "supervisor";
export interface StopRequest {
  source: StopSource;
  requestedAt: string;
}

/** Cooperative stop: never abort the UI operation, owned task collection or recovery in flight. */
export class ExecutionStop {
  private readonly controller = new AbortController();
  private readonly listeners = new Set<() => void>();
  private readonly disposers: Array<() => void> = [];
  requestInfo?: StopRequest;
  get signal() {
    return this.controller.signal;
  }
  request(source: StopSource) {
    if (this.requestInfo) return;
    this.requestInfo = { source, requestedAt: new Date().toISOString() };
    this.controller.abort(
      new ConfigurationOperationError(
        "interrupted",
        "收到停止请求；不再执行新步骤，完成已关联任务收集和安全恢复",
        "stop",
      ),
    );
    for (const listener of this.listeners) listener();
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    if (this.requestInfo) listener();
    return () => {
      this.listeners.delete(listener);
    };
  }
  listen() {
    for (const name of ["SIGINT", "SIGTERM"] as const) {
      const listener = () => this.request(name);
      process.on(name, listener);
      this.disposers.push(() => {
        process.removeListener(name, listener);
      });
    }
    if (typeof process.send === "function") {
      const disconnected = () => this.request("parent-disconnect");
      const message = (value: unknown) => {
        if (
          value &&
          typeof value === "object" &&
          "type" in value &&
          value.type === "pink-steps-stop"
        )
          this.request("supervisor");
      };
      const brokenPipe = (error: NodeJS.ErrnoException) => {
        if (error.code !== "EPIPE") throw error;
      };
      process.on("disconnect", disconnected);
      process.on("message", message);
      process.stdout.on("error", brokenPipe);
      process.stderr.on("error", brokenPipe);
      this.disposers.push(() => {
        process.removeListener("disconnect", disconnected);
        process.removeListener("message", message);
        // The worker may flush its final log after its launcher disappears. Stream guards
        // belong to this one-shot process and must outlive the execution listeners.
      });
      if (!process.connected) disconnected();
    }
    return this;
  }
  dispose() {
    for (const dispose of this.disposers.splice(0)) dispose();
    this.listeners.clear();
  }
}

export function checkExecutionStop(signal?: AbortSignal) {
  signal?.throwIfAborted();
}
