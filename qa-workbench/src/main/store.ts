import { join } from "node:path";
import {
  readJson,
  atomicWrite,
  json,
  Serial,
  JsonFileSizeError,
} from "./files.js";
import { emptyState, validateState, type State } from "../shared/model.js";

const stateLimit = 32 * 1024 * 1024;
export function serializeState(state: State) {
  const content = json(state);
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > stateLimit)
    throw new Error(
      `本次记录 ${(bytes / 1024 / 1024).toFixed(2)} MiB，超过当前 32 MiB 限制，未替换原记录。`,
    );
  return content;
}

export class StateStore {
  private serial = new Serial();
  readonly file: string;
  constructor(readonly root: string) {
    this.file = join(root, "workbench.json");
  }
  async read(): Promise<State> {
    try {
      return validateState(await readJson(this.file, stateLimit));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return emptyState();
      const reason =
        error instanceof JsonFileSizeError
          ? error.message
          : (error as NodeJS.ErrnoException).code ||
            (error instanceof Error ? error.name : "未知错误");
      throw new Error(
        `本地记录无法读取（${reason}），原文件已保留。请检查或从备份恢复。`,
        {
          cause: error,
        },
      );
    }
  }
  save(candidate: unknown, expected: number): Promise<State> {
    return this.serial.run(async () => {
      const state = validateState(candidate);
      const previous = await this.read();
      if (previous.revision !== expected)
        throw new Error("记录已被其他操作更新，请重新打开工作台后重试");
      state.revision = previous.revision + 1;
      const content = serializeState(state);
      try {
        await atomicWrite(this.file, content);
      } catch (error) {
        const reason =
          (error as NodeJS.ErrnoException).code ||
          (error instanceof Error ? error.name : "未知错误");
        throw new Error(
          `本地记录保存失败（${reason}），本次 ${(Buffer.byteLength(content) / 1024 / 1024).toFixed(2)} MiB，未替换原记录。`,
          { cause: error },
        );
      }
      return state;
    });
  }
}
