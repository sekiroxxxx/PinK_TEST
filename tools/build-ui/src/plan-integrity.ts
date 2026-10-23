import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export function contentHash(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function valueHash(value: unknown): string {
  const sorted = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sorted)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([, child]) => child !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, child]) => [key, sorted(child)]),
          )
        : v;
  return contentHash(JSON.stringify(sorted(value)));
}

export function sealPlan<T extends object>(plan: T) {
  return { ...plan, integrity: { algorithm: "sha256" as const, sha256: valueHash(plan) } };
}

export async function verifyExpectedPlan(file: string, current: ReturnType<typeof sealPlan>) {
  const expected = JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
  if (!expected || typeof expected !== "object" || Array.isArray(expected))
    throw new Error("预期计划必须是对象，请重新预览");
  const { integrity, ...body } = expected;
  if (
    body.kind !== "pink-build-plan" ||
    body.schemaVersion !== 1 ||
    body.phase !== "offline" ||
    integrity?.algorithm !== "sha256" ||
    !/^[a-f0-9]{64}$/.test(integrity?.sha256 ?? "")
  )
    throw new Error("预期计划缺少有效哈希或格式不兼容，请重新预览");
  if (valueHash(body) !== integrity.sha256) throw new Error("预期计划内容与其哈希不符，请重新预览");
  if (current.integrity.sha256 !== integrity.sha256)
    throw new Error("用例、材料、环境、执行范围或超时已变化，计划哈希不匹配，请重新预览");
  return { path: file, sha256: integrity.sha256, state: "matched" as const };
}
