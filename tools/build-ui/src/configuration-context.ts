import { sameCanonicalPath } from "./workspace-identity.js";

export interface ExecutionIdentity {
  executable: string;
  project: string;
  windowId?: number;
}

export interface ConfigurationPageIdentity {
  title: string;
  generation: number;
  instance?: number;
}

export class ConfigurationOperationError extends Error {
  recovery?: { phase: string; field?: string };
  readonly diagnostic?: { phase: string; observations?: unknown };
  constructor(
    readonly code:
      | "context"
      | "snapshot"
      | "precondition"
      | "assertion"
      | "restore"
      | "input"
      | "submission"
      | "task",
    message: string,
    readonly disposition: "blocked" | "failed" | "stop",
    options?: ErrorOptions & {
      diagnostic?: { phase: string; observations?: unknown };
      recovery?: { phase: string; field?: string };
    },
  ) {
    super(message, options);
    this.diagnostic = options?.diagnostic;
    this.recovery = options?.recovery;
  }
}

/** Run-local ownership. This neither starts PinK nor changes its project or settings. */
export class ExecutionContext {
  readonly identity: Readonly<ExecutionIdentity>;
  private active?: ConfigurationContext;
  private invalid = false;

  constructor(
    identity: ExecutionIdentity,
    private readonly observeIdentity: () => Promise<ExecutionIdentity>,
  ) {
    if (!Number.isInteger(identity.windowId))
      throw new ConfigurationOperationError("context", "缺少已核实的窗口身份", "stop");
    this.identity = Object.freeze({ ...identity });
  }

  async verify(): Promise<void> {
    if (this.invalid) throw this.failure();
    try {
      const observed = await this.observeIdentity();
      if (
        !sameCanonicalPath(observed.executable, this.identity.executable) ||
        !sameCanonicalPath(observed.project, this.identity.project) ||
        observed.windowId !== this.identity.windowId
      )
        throw this.failure();
      if (this.invalid) throw this.failure();
    } catch {
      this.invalidate();
      throw this.failure();
    }
  }

  bind(
    platform: string,
    title: string,
    generation: number,
    observePage: () => Promise<ConfigurationPageIdentity>,
    instance?: number,
  ): ConfigurationContext {
    if (this.invalid) throw this.failure();
    this.active?.invalidate();
    const context = new ConfigurationContext(
      this,
      platform,
      title,
      generation,
      observePage,
      instance,
    );
    this.active = context;
    return context;
  }

  owns(context: ConfigurationContext): boolean {
    return !this.invalid && this.active === context;
  }

  invalidate(): void {
    this.invalid = true;
    this.active?.invalidate();
  }

  private failure() {
    return new ConfigurationOperationError(
      "context",
      "程序、工程或窗口身份失效，停止后续操作",
      "stop",
    );
  }
}

/** A modal opening has its own lifetime; every attempted mutation invalidates old snapshots. */
export class ConfigurationContext {
  private invalid = false;
  private revisionValue = 0;
  private writing = false;

  constructor(
    readonly session: ExecutionContext,
    readonly platform: string,
    readonly title: string,
    readonly generation: number,
    private readonly observePage: () => Promise<ConfigurationPageIdentity>,
    readonly instance?: number,
  ) {}

  get revision(): number {
    return this.revisionValue;
  }

  async verify(): Promise<void> {
    this.assertOwned();
    await this.session.verify();
    this.assertOwned();
    try {
      const page = await this.observePage();
      if (
        page.title !== this.title ||
        page.generation !== this.generation ||
        page.instance !== this.instance
      )
        throw new Error();
    } catch {
      this.invalidate();
      throw new ConfigurationOperationError(
        "context",
        "配置页已关闭、重建或平台身份不一致",
        "stop",
      );
    }
    this.assertOwned();
  }

  beginMutation(): void {
    this.assertOwned();
    if (this.writing)
      throw new ConfigurationOperationError("context", "同一配置页存在并发修改，停止操作", "stop");
    this.writing = true;
    this.revisionValue++;
  }

  endMutation(): void {
    this.writing = false;
  }

  invalidate(): void {
    this.invalid = true;
  }

  private assertOwned(): void {
    if (this.invalid || !this.session.owns(this))
      throw new ConfigurationOperationError(
        "context",
        "配置上下文已失效，必须重新打开并核对平台",
        "stop",
      );
  }
}
