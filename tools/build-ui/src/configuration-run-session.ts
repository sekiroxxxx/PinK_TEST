import type { Browser } from "playwright-core";
import type { Builder } from "./builder.js";
import type { ExecutionContext } from "./configuration-context.js";
import { configurationErrorDetail } from "./configuration-diagnostics.js";
import { ExecutionStop } from "./execution-stop.js";

export interface RunCleanup {
  resource: string;
  outcome: "passed" | "failed";
  reason?: string;
  diagnostic?: ReturnType<typeof configurationErrorDetail>;
}

/** Owns the existing UI run's resources; case operations still own their page cleanup. */
export class ConfigurationRunSession {
  readonly stop: ExecutionStop;
  readonly workSignal: AbortSignal;
  readonly cleanupSignal: AbortSignal;
  readonly cleanup: RunCleanup[] = [];
  private readonly lifetime = new AbortController();
  private readonly ownsStop: boolean;
  private browser?: Pick<Browser, "close">;
  private context?: Pick<ExecutionContext, "invalidate">;
  private taskObserver?: { stop(): Promise<void> };
  private readonly builders = new Map<Pick<Builder, "close">, string>();
  private readonly subscriptions: Array<() => void> = [];
  private finalization?: Promise<void>;

  constructor(stop?: ExecutionStop) {
    this.ownsStop = !stop;
    this.stop = stop ?? new ExecutionStop().listen();
    this.cleanupSignal = this.lifetime.signal;
    this.workSignal = AbortSignal.any([this.cleanupSignal, this.stop.signal]);
  }

  ownBrowser(browser: Pick<Browser, "close">) {
    this.browser = browser;
  }
  ownContext(context: Pick<ExecutionContext, "invalidate">) {
    this.context = context;
  }
  ownBuilder(key: string, builder: Pick<Builder, "close">) {
    this.builders.set(builder, key);
  }
  ownTaskObserver(observer: { stop(): Promise<void> }) {
    this.taskObserver = observer;
  }
  subscribe(listener: () => void) {
    this.subscriptions.push(this.stop.subscribe(listener));
  }

  finish(finalize: (cleanup: readonly RunCleanup[]) => Promise<void>): Promise<void> {
    if (this.finalization) return this.finalization;
    this.finalization = Promise.resolve().then(async () => {
      const release = async (resource: string, action: () => void | Promise<void>) => {
        try {
          await action();
          this.cleanup.push({ resource, outcome: "passed" });
        } catch (error) {
          const diagnostic = configurationErrorDetail(error);
          this.cleanup.push({
            resource,
            outcome: "failed",
            reason: diagnostic.chain[0]?.message ?? "资源释放失败，不能计收尾通过",
            diagnostic,
          });
        }
      };
      try {
        if (this.taskObserver) await release("task-observer", () => this.taskObserver!.stop());
        if (this.context) await release("execution-context", () => this.context!.invalidate());
        for (const [builder, key] of this.builders)
          await release(`builder-probe:${key}`, () => builder.close());
        if (this.browser) await release("browser-connection", () => this.browser!.close());
        for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe();
        await finalize(this.cleanup);
      } finally {
        for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe();
        if (this.ownsStop) this.stop.dispose();
        this.lifetime.abort();
      }
    });
    return this.finalization;
  }
}
