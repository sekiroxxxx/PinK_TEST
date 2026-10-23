import { errorMessage } from "./common.js";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** A small standard CDP client for the Builder iframe target, not a PinK protocol. */
export class Cdp {
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
      };
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    socket.addEventListener("close", () => this.rejectPending("Builder 调试连接已断开"));
    socket.addEventListener("error", () => this.rejectPending("Builder 调试连接发生错误"));
  }

  static async connect(url: string): Promise<Cdp> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("连接 Builder 调试目标超时"));
      }, 10_000);
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error("无法连接 Builder 调试目标"));
        },
        { once: true },
      );
    });
    return new Cdp(socket);
  }

  private rejectPending(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }

  private send(method: string, params: unknown): Promise<unknown> {
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error("Builder 调试连接不可用");
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP 请求超时：${method}`));
      }, 10_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Only self-contained, tool-owned DOM functions are passed here. */
  async evaluate<Args extends unknown[], Result>(
    fn: (...args: Args) => Result,
    ...args: Args
  ): Promise<Awaited<Result>> {
    return this.evaluateExpression<Awaited<Result>>(
      `(${fn.toString()})(...${JSON.stringify(args)})`,
    );
  }

  async dom<Args extends unknown[], Result>(
    fn: (document: Document, ...args: Args) => Result,
    ...args: Args
  ): Promise<Awaited<Result>> {
    return this.evaluateExpression<Awaited<Result>>(`(() => {
      const frame = document.querySelector('#active-frame');
      const content = frame?.contentDocument;
      if (!content) throw new Error('Builder 内容 Frame 尚未就绪或已重建');
      return (${fn.toString()})(content, ...${JSON.stringify(args)});
    })()`);
  }

  /** Standard read-only CDP node identity, surviving repeated reads but not modal replacement. */
  async configurationNode(): Promise<number> {
    const evaluated = (await this.send("Runtime.evaluate", {
      expression: `document.querySelector('#active-frame')?.contentDocument?.querySelector('button[aria-label="Close"]')?.parentElement?.parentElement`,
      returnByValue: false,
    })) as { result?: { objectId?: string }; exceptionDetails?: unknown };
    const objectId = evaluated.result?.objectId;
    if (!objectId || evaluated.exceptionDetails) throw new Error("配置页节点不可用");
    try {
      const described = (await this.send("DOM.describeNode", { objectId })) as {
        node?: { backendNodeId?: number };
      };
      const node = described.node?.backendNodeId;
      if (!Number.isInteger(node)) throw new Error("配置页节点身份不可用");
      return node!;
    } finally {
      await this.send("Runtime.releaseObject", { objectId });
    }
  }

  private async evaluateExpression<Result>(expression: string): Promise<Result> {
    const response = (await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as {
      result: { value?: Result; subtype?: string; description?: string };
      exceptionDetails?: { text: string; exception?: { description: string } };
    };
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ?? response.exceptionDetails.text,
      );
    }
    if (response.result.subtype === "error") throw new Error(response.result.description);
    return response.result.value as Result;
  }

  close(): void {
    this.rejectPending("Builder 观察连接已释放");
    try {
      this.socket.close();
    } catch (error) {
      console.error(errorMessage(error));
    }
  }
}
