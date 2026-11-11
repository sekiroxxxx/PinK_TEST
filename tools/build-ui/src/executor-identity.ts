import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contentHash, valueHash } from "./plan-integrity.js";

export const executorCapabilityVersion = "5";

export interface ExecutorIdentity {
  kind: "pink-build-executor-identity";
  schemaVersion: 1;
  capabilityVersion: string;
  implementationSha256: string;
  files: Array<[name: string, sha256: string]>;
}

async function readIdentity(): Promise<ExecutorIdentity> {
  const directory = dirname(fileURLToPath(import.meta.url));
  const files: ExecutorIdentity["files"] = await Promise.all(
    (await readdir(directory))
      .filter((name) => name.endsWith(".js") && !name.endsWith(".test.js"))
      .sort()
      .map(async (name) => [name, contentHash(await readFile(join(directory, name)))]),
  );
  return {
    kind: "pink-build-executor-identity",
    schemaVersion: 1,
    capabilityVersion: executorCapabilityVersion,
    implementationSha256: valueHash(files),
    files,
  };
}

// ESM functions may stay cached after their files change. Keep the loaded generation fixed.
const loadedIdentity = await readIdentity();

export async function getExecutorIdentity(): Promise<ExecutorIdentity> {
  if (valueHash(await readIdentity()) !== valueHash(loadedIdentity))
    throw new Error("执行器文件已变化，请重新加载工作台或重启执行入口后重新预览");
  return structuredClone(loadedIdentity);
}

export async function verifyExecutorIdentity(expected: unknown): Promise<ExecutorIdentity> {
  const current = await getExecutorIdentity();
  if (
    !expected ||
    typeof expected !== "object" ||
    Array.isArray(expected) ||
    valueHash(expected) !== valueHash(current)
  )
    throw new Error("执行器身份与预览计划不符，请重新预览；执行器已更新时须先重新加载工作台");
  return current;
}
