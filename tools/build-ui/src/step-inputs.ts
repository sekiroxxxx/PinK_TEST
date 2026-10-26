import { readFile, realpath } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { caseContract, type InputValues, type InputValue } from "./case-contract.js";
import {
  discoverScenes,
  confirmScenes,
  loadMaterialBindings,
  resolveCaseInputs,
  type SceneContext,
  type InputMaterials,
} from "./case-inputs.js";
import { supportedFieldTypes } from "./field-capabilities.js";
import { sensitiveConfigurationField } from "./configuration-steps-contract.js";
import { ConfigurationOperationError } from "./configuration-context.js";
import type { ConfigurationOperations } from "./configuration-operations.js";
import type { BuildStepsDocument, BuildStepCase } from "./build-steps-contract.js";
import { contentHash, valueHash } from "./plan-integrity.js";
import { stepObservationFields } from "./configuration-step-values.js";

export interface StepInputOptions {
  project?: string;
  materials?: string;
}

function assignments(c: BuildStepCase): InputValues[] {
  return c.steps.flatMap((s) =>
    s.op === "set" || s.op === "config.prepare"
      ? [{ [s.field]: s.value }]
      : s.op === "input.google-icon"
        ? [{ "packages.google-play.customIcon": s.file }]
        : s.op === "input.openpaas-game"
          ? [{ "packages.openpaas.appid": s.value }]
          : s.op === "assert" && s.check === "values"
            ? [s.values]
            : s.op === "config.require"
              ? [
                  s.expected.differs ?? {},
                  ...(s.expected.emptyWhen?.map((c) => ({ [c.field]: c.value })) ?? []),
                ]
              : [],
  );
}
function hasReference(value: InputValue): boolean {
  return (
    !!caseContract.reference(value) ||
    (Array.isArray(value)
      ? value.some(hasReference)
      : !!value && typeof value === "object" && Object.values(value).some(hasReference))
  );
}
function lookup(materials: InputMaterials, name: string): unknown {
  let value: unknown = materials.bindings;
  for (const part of name.split(".")) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, part)) return;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/** Uses the four-group input resolver. Public metadata never contains resolved credentials. */
export async function loadStepInputs(document: BuildStepsDocument, options: StepInputOptions = {}) {
  const project = options.project ? await realpath(resolve(options.project)) : undefined;
  const materialsPath = options.materials ? resolve(options.materials) : undefined;
  let materials: InputMaterials;
  try {
    materials = await loadMaterialBindings(materialsPath);
  } catch {
    throw new Error("步骤材料清单不可读取或格式无效（内容已省略）");
  }
  const scenes = await discoverScenes(project);
  const types = {
    ...supportedFieldTypes,
    ...stepObservationFields,
    ...Object.assign({}, ...(document.targets ?? []).map((t) => t.fields)),
  };
  const references = new Set<string>();
  const cases = await Promise.all(
    document.cases.map(async (c) => {
      const results = await Promise.all(
        assignments(c).map((inputs) => resolveCaseInputs(inputs, materials, scenes, types)),
      );
      const materialRefs = [...new Set(results.flatMap((r) => r.materialRefs))].sort();
      materialRefs.forEach((ref) => references.add(ref));
      const blockers = results.flatMap((r) => r.blockers);
      for (const r of results)
        for (const [field, value] of Object.entries(r.values))
          if (hasReference(value))
            blockers.push(`材料值须为实际数据，不能再引用其他输入：${field}`);
      // Literal scene IDs also require a current project resource, not just the correct JSON type.
      for (const r of results)
        for (const key of ["startScene", "scenes"]) {
          const value = r.values[key];
          if (value === undefined) continue;
          if (
            !(Array.isArray(value) ? value : [value]).every((id) =>
              scenes.candidates.some((s) => s.uuid === id),
            )
          )
            blockers.push(`场景身份未对应当前工程：${key}`);
        }
      return {
        caseId: c.caseId,
        materialRefs,
        sceneFields: [...new Set(results.flatMap((r) => Object.keys(r.sceneInputs)))],
        blockers: [...new Set(blockers)],
      };
    }),
  );
  const files = await Promise.all(
    [...references]
      .filter((ref) => ref.endsWith(".path"))
      .sort()
      .map(async (ref) => {
        const file = lookup(materials, ref);
        const sha256 =
          typeof file === "string"
            ? await readFile(file)
                .then(contentHash)
                .catch(() => null)
            : null;
        return { reference: ref, sha256 };
      }),
  );
  for (const c of cases)
    for (const file of files)
      if (
        file.sha256 === null &&
        c.materialRefs.includes(file.reference) &&
        !c.blockers.some((reason) => reason.includes(file.reference))
      )
        c.blockers.push(`材料文件不能读取内容：${file.reference}`);
  const preview = {
    documentSha256: valueHash(document),
    project,
    projectPackageSha256: project
      ? contentHash(await readFile(join(project, "package.json")))
      : undefined,
    materialsPath,
    materialsSha256: materialsPath ? contentHash(await readFile(materialsPath)) : undefined,
    files,
    scenes,
    cases,
  };
  return new StepInputs(document, { project, materials: materialsPath }, materials, preview);
}

export class StepInputs {
  readonly #document: BuildStepsDocument;
  readonly #options: StepInputOptions;
  readonly #materials: InputMaterials;
  readonly #preview: StepInputPreview;
  constructor(
    document: BuildStepsDocument,
    options: StepInputOptions,
    materials: InputMaterials,
    preview: StepInputPreview,
  ) {
    this.#document = structuredClone(document);
    this.#options = { ...options };
    this.#materials = materials;
    this.#preview = structuredClone(preview);
  }
  get preview() {
    return structuredClone(this.#preview);
  }
  async verify() {
    try {
      const current = await loadStepInputs(this.#document, this.#options);
      if (valueHash(current.preview) !== valueHash(this.#preview)) throw new Error("输入已变化");
    } catch {
      throw new ConfigurationOperationError(
        "snapshot",
        "工程场景或材料与计划不符，请重新预览",
        "stop",
      );
    }
  }
  case(caseId: string) {
    const definition = this.#document.cases.find((c) => c.caseId === caseId);
    if (!definition) throw new Error("输入不属于此用例文件");
    const types = {
      ...supportedFieldTypes,
      ...stepObservationFields,
      ...this.#document.targets?.find((t) => t.id === definition.platform)?.fields,
    };
    return new StepCaseInputs(
      structuredClone(this.#preview.scenes),
      this.#materials,
      types,
      this.#preview.cases.find((c) => c.caseId === caseId)!.blockers,
    );
  }
}
type StepInputPreview = {
  documentSha256: string;
  project?: string;
  projectPackageSha256?: string;
  materialsPath?: string;
  materialsSha256?: string;
  files: Array<{ reference: string; sha256: string | null }>;
  scenes: SceneContext;
  cases: Array<{
    caseId: string;
    materialRefs: string[];
    sceneFields: string[];
    blockers: string[];
  }>;
};

export class StepCaseInputs {
  readonly secrets: string[] = [];
  constructor(
    readonly scenes: SceneContext,
    private materials: InputMaterials,
    private types: typeof supportedFieldTypes,
    readonly blockers: string[],
  ) {}
  async resolve(field: string, input: InputValue, operations: ConfigurationOperations) {
    if ((field === "startScene" || field === "scenes") && !this.scenes.runtimeConfirmed)
      confirmScenes(this.scenes, String((await operations.read("startScene")).value));
    const result = await resolveCaseInputs(
      { [field]: input },
      this.materials,
      this.scenes,
      this.types,
    );
    if (result.blockers.length)
      throw new ConfigurationOperationError("precondition", result.blockers.join("；"), "blocked");
    let value = result.values[field];
    if (hasReference(value))
      throw new ConfigurationOperationError(
        "precondition",
        "材料值须为实际数据，不能再引用其他输入",
        "blocked",
      );
    if (sensitiveConfigurationField(field) && typeof value === "string" && value)
      this.secrets.push(value);
    const candidate = (id: InputValue) => {
      const match = this.scenes.candidates.find((s) => s.uuid === id);
      if (!match)
        throw new ConfigurationOperationError("precondition", "场景身份未对应当前工程", "blocked");
      return match;
    };
    const enumLabel =
      field === "startScene" ? basename(candidate(value).path, ".scene") : undefined;
    if (field === "scenes") value = (value as InputValue[]).map((id) => candidate(id).path);
    return { value, enumLabel };
  }
}

export function stepNeedsInputs(c: BuildStepCase): boolean {
  return assignments(c).some((values) =>
    Object.entries(values).some(
      ([key, value]) => key === "startScene" || key === "scenes" || hasReference(value),
    ),
  );
}
