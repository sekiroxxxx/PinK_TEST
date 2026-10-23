import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import {
  caseContract,
  type InputValue,
  type InputValues,
  type FieldType,
} from "./case-contract.js";

export interface SceneCandidate {
  uuid: string;
  path: string;
}
export interface SceneContext {
  candidates: SceneCandidate[];
  primary?: SceneCandidate;
  secondary?: SceneCandidate;
  runtimeConfirmed: boolean;
  basis: string;
}
export async function discoverScenes(project?: string): Promise<SceneContext> {
  const candidates: SceneCandidate[] = [];
  async function visit(dir: string, path: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) await visit(join(dir, entry.name), `${path}/${entry.name}`);
      else if (entry.isFile() && entry.name.endsWith(".scene.meta")) {
        if (!(await stat(join(dir, entry.name.slice(0, -5))).catch(() => undefined))?.isFile())
          continue;
        let meta: { uuid?: unknown };
        try {
          meta = JSON.parse(await readFile(join(dir, entry.name), "utf8"));
        } catch {
          continue;
        }
        if (typeof meta.uuid === "string" && meta.uuid)
          candidates.push({ uuid: meta.uuid, path: `db://${path}/${entry.name.slice(0, -5)}` });
      }
    }
  }
  if (project && (await stat(join(project, "assets")).catch(() => undefined))?.isDirectory())
    await visit(join(project, "assets"), "assets");
  candidates.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (new Set(candidates.map((s) => s.uuid)).size !== candidates.length)
    throw new Error("场景 UUID 重复，无法唯一绑定工程资源");
  return {
    candidates,
    primary: candidates[0],
    secondary: candidates[1],
    runtimeConfirmed: false,
    basis: "offline-sorted-candidate; current-UI-scene-not-observed",
  };
}
export function confirmScenes(context: SceneContext, current: string): void {
  if (context.runtimeConfirmed) return;
  context.primary =
    context.candidates.find((s) => s.uuid === current || s.path === current) ??
    context.candidates[0];
  context.secondary = context.candidates.find((s) => s.uuid !== context.primary?.uuid);
  context.runtimeConfirmed = true;
  context.basis =
    context.primary && [context.primary.uuid, context.primary.path].includes(current)
      ? "current-valid-UI-start-scene"
      : "stable-first-real-scene";
}
export function sceneValues(inputs: InputValues, scenes: SceneContext): InputValues {
  function visit(value: InputValue): InputValue {
    const ref = caseContract.reference(value);
    if (ref?.kind === "scene") {
      const candidate = ref.name === "primary" ? scenes.primary : scenes.secondary;
      if (!candidate) throw new Error(`没有有效的 ${ref.name} 场景`);
      return candidate.uuid;
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, visit(v)]));
    return value;
  }
  return Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, visit(value)]));
}

export interface InputMaterials {
  schemaVersion?: 1;
  bindings?: Record<string, InputValue>;
}
export async function loadMaterialBindings(
  path?: string,
): Promise<InputMaterials & Record<string, unknown>> {
  if (!path) return {};
  const data: unknown = JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("材料清单必须是 JSON 对象");
  const result = data as InputMaterials & Record<string, unknown>;
  if (result.schemaVersion !== undefined && result.schemaVersion !== 1)
    throw new Error("材料清单仅支持 schemaVersion 1");
  if (
    result.mixedPlatforms !== undefined &&
    (!Array.isArray(result.mixedPlatforms) ||
      result.mixedPlatforms.some((p) => typeof p !== "string") ||
      new Set(result.mixedPlatforms).size !== result.mixedPlatforms.length)
  )
    throw new Error("mixedPlatforms 需要不重复的平台ID数组");
  for (const key of ["platformValues", "scenarios"])
    if (
      result[key] !== undefined &&
      (!result[key] || typeof result[key] !== "object" || Array.isArray(result[key]))
    )
      throw new Error(`${key} 必须是对象`);
  if (
    result.bindings !== undefined &&
    (!result.bindings || typeof result.bindings !== "object" || Array.isArray(result.bindings))
  )
    throw new Error("bindings 必须是对象");
  function paths(value: InputValue): InputValue {
    if (Array.isArray(value)) return value.map(paths);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, v]) => [
          key,
          key === "path" && typeof v === "string" && v
            ? resolve(dirname(resolve(path!)), v)
            : paths(v),
        ]),
      );
    return value;
  }
  if (result.bindings)
    result.bindings = Object.fromEntries(
      Object.entries(result.bindings).map(([key, value]) => [key, paths(value)]),
    );
  return result;
}

export async function resolveCaseInputs(
  inputs: InputValues,
  materials: InputMaterials,
  scenes: SceneContext,
  types: Record<string, FieldType>,
): Promise<{
  values: InputValues;
  blockers: string[];
  materialRefs: string[];
  sceneInputs: InputValues;
}> {
  const blockers: string[] = [],
    materialRefs = new Set<string>(),
    sceneInputs: InputValues = {};
  function material(name: string): InputValue | undefined {
    let value: unknown = materials.bindings;
    for (const part of name.split(".")) {
      if (!value || typeof value !== "object" || !Object.hasOwn(value, part)) return;
      value = (value as Record<string, unknown>)[part];
    }
    return value as InputValue | undefined;
  }
  async function visit(value: InputValue, key: string): Promise<InputValue | undefined> {
    const ref = caseContract.reference(value);
    if (ref?.kind === "material") {
      materialRefs.add(ref.name);
      const privateName = /(?:password|appkey|token|secret)$/i;
      if (
        privateName.test(ref.name) &&
        !/(?:password|appkey|token|secret|xxteaKey|appid)$/i.test(key)
      ) {
        blockers.push(`私密材料不能绑定到普通显示字段：${key}`);
        return;
      }
      const bound = material(ref.name);
      if (bound === undefined || bound === "") {
        blockers.push(`缺少材料引用 ${ref.name}（${key}）`);
        return;
      }
      if (ref.name.endsWith(".path")) {
        if (typeof bound !== "string" || !(await stat(bound).catch(() => undefined))?.isFile()) {
          blockers.push(`材料文件不可访问 ${ref.name}（${key}）`);
          return;
        }
      }
      return bound;
    }
    if (ref?.kind === "scene") {
      sceneInputs[key] = inputs[key];
      const candidate = ref.name === "primary" ? scenes.primary : scenes.secondary;
      if (!candidate) {
        blockers.push(`场景材料不足：${ref.name}（${key}）`);
        return;
      }
      return candidate.uuid;
    }
    if (Array.isArray(value)) {
      const resolved = await Promise.all(value.map((v) => visit(v, key)));
      return resolved.some((v) => v === undefined) ? undefined : (resolved as InputValue[]);
    }
    if (value && typeof value === "object") {
      const entries = await Promise.all(
        Object.entries(value).map(async ([part, v]) => [part, await visit(v, key)] as const),
      );
      if (entries.some(([, v]) => v === undefined)) return;
      return Object.fromEntries(entries) as InputValue;
    }
    return value;
  }
  const values: InputValues = {};
  for (const [key, input] of Object.entries(inputs)) {
    const value = await visit(input, key);
    if (value === undefined) continue;
    try {
      caseContract.validateValue(key, value, types[key]);
    } catch {
      blockers.push(`材料绑定后的字段类型或候选不符：${key}`);
      continue;
    }
    values[key] = value;
  }
  return { values, blockers: [...new Set(blockers)], materialRefs: [...materialRefs], sceneInputs };
}

export function publicValues(values: InputValues, types?: Record<string, FieldType>): InputValues {
  function redact(value: InputValue): InputValue {
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object") return publicValues(value);
    return value;
  }
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      types?.[key]?.sensitive || /(?:password|appkey|token|secret|xxteaKey|appid)$/i.test(key)
        ? "[redacted]"
        : redact(value),
    ]),
  );
}
