import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const hash = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
export class JsonFileSizeError extends Error {
  constructor(
    readonly bytes: number,
    readonly limit: number,
  ) {
    super(
      `文件 ${(bytes / 1024 / 1024).toFixed(2)} MiB，超过 ${limit / 1024 / 1024} MiB 读取限制`,
    );
  }
}
export async function readJson(
  path: string,
  maxBytes = 32 * 1024 * 1024,
): Promise<unknown> {
  const bytes = (await stat(path)).size;
  if (bytes > maxBytes) throw new JsonFileSizeError(bytes, maxBytes);
  return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
}
export async function atomicWrite(path: string, bytes: string | Uint8Array) {
  await mkdir(dirname(path), { recursive: true });
  const temp = path + "." + randomUUID() + ".tmp";
  await writeFile(temp, bytes, { flag: "wx" });
  await rename(temp, path);
}

export class Serial {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail.then(action);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
