import { readFile } from "node:fs/promises";
import { validateExecutableCatalog, assertSupportedValues } from "./field-capabilities.js";
import type { BuildCase } from "./build-cases.js";
import { loadFormValidation, formSourceHash, type LoadedFormSample } from "./form-validation.js";
import {
  caseContract,
  type CatalogDocument,
  type CatalogCombo,
  type CatalogScenario,
} from "./case-contract.js";
import {
  loadMaterialBindings,
  discoverScenes,
  resolveCaseInputs,
  type InputMaterials,
  type SceneContext,
} from "./case-inputs.js";
import { catalogReferenceEntries } from "./native-case-references.js";

export type CaseValue = string | number | boolean | CaseValue[] | { [key: string]: CaseValue };
export type CaseValues = Record<string, CaseValue>;
export type FinalGroup = "publish" | "debug" | "mixed" | "conditional";
export interface CaseBinding {
  /** Only replaces material/candidate references in the reviewed definition. */
  values?: CaseValues;
  bundles?: Array<{ name: string; root: string; uuid?: string }>;
  presetIds?: [string, string];
  invalidJson?: [string, string];
  initialValues?: CaseValues;
}
export interface FinalMaterials extends InputMaterials {
  mixedPlatforms?: string[];
  platformValues?: Record<string, Partial<Record<FinalGroup, CaseValues>>>;
  scenarios?: Record<string, CaseBinding>;
}
export interface FinalCase {
  revision: string;
  group: FinalGroup;
  endpoint: "build" | "ui";
  values: CaseValues;
  /** Unresolved input expressions for the v2 compiler; never serialize private bound values. */
  inputs?: CaseValues;
  retained: string[];
  scenario?: string;
  binding?: CaseBinding;
  configurationOrder?: string[];
  sceneContext?: SceneContext;
  sceneInputs?: CaseValues;
  materialRefs?: string[];
  executionOperation?: "configure-and-restore";
  formValidation?: LoadedFormSample;
  blockers: Array<{
    kind: "material" | "applicability" | "not-applicable" | "ui-adapter";
    reason: string;
  }>;
}

export async function readFinalMaterials(path?: string): Promise<FinalMaterials> {
  return (await loadMaterialBindings(path)) as FinalMaterials;
}

/** One source for both presentation and executable targets; no second platform/profile matrix. */
export async function selectFinalizedCases(
  ids?: string,
  groups?: string,
  materials: FinalMaterials = {},
  source: {
    catalogPath?: string;
    project?: string;
    catalog?: CatalogDocument;
    captureInputs?: boolean;
    endpoint?: "ui";
  } = {},
): Promise<BuildCase[]> {
  const catalog = caseContract.normalize(
    validateExecutableCatalog(
      source.catalog ??
        JSON.parse(
          await readFile(
            source.catalogPath ??
              new URL("../../case-catalog/public-combinations.json", import.meta.url),
            "utf8",
          ),
        ),
    ),
  );
  const sceneContext = await discoverScenes(source.project);
  return selectCases(
    catalog,
    ids,
    groups,
    materials,
    source,
    (values) => resolveCaseInputs(values, materials, sceneContext, catalog.fieldTypes),
    () => loadFormValidation(catalog, source.catalogPath),
    sceneContext,
  );
}

/** Symbolic definitions preserve references; this path never discovers or resolves local resources. */
export async function selectCatalogDefinitionCases(
  raw: CatalogDocument,
  id: string,
  endpoint?: "ui",
): Promise<BuildCase[]> {
  const catalog = caseContract.normalize(validateExecutableCatalog(raw));
  return selectCases(
    catalog,
    id,
    undefined,
    {},
    { captureInputs: true, endpoint },
    async (values) => ({
      values: structuredClone(values),
      blockers: [],
      materialRefs: [],
      sceneInputs: {},
    }),
    async () => {
      if (!catalog.formValidation) throw new Error("引用 FORM 样本必须内嵌 formValidation 定义");
      return catalog.formValidation;
    },
  );
}

async function selectCases(
  catalog: CatalogDocument,
  ids: string | undefined,
  groups: string | undefined,
  materials: FinalMaterials,
  source: { captureInputs?: boolean; endpoint?: "ui" },
  resolveInputs: (values: CaseValues) => ReturnType<typeof resolveCaseInputs>,
  formsSource: () => ReturnType<typeof loadFormValidation>,
  sceneContext?: SceneContext,
): Promise<BuildCase[]> {
  const references = catalogReferenceEntries(catalog);
  const groupIds = (groups ?? "publish,debug,mixed,conditional").split(",").map((s) => s.trim());
  if (
    !groupIds.length ||
    new Set(groupIds).size !== groupIds.length ||
    groupIds.some((g) => !["publish", "debug", "mixed", "conditional"].includes(g))
  )
    throw new Error("groups 仅接受不重复的 publish,debug,mixed,conditional");
  if (materials.mixedPlatforms?.some((id) => !catalog.platforms.some((p) => p.id === id)))
    throw new Error("mixedPlatforms 含未知平台");
  const cases: BuildCase[] = [];
  const make = async (
    platform: CatalogDocument["platforms"][number],
    combo: CatalogCombo,
    id: string,
    title: string,
    overrides: CaseValues = {},
    scenario?: CatalogScenario,
    variantRetained: string[] = [],
  ) => {
    const binding = scenario ? materials.scenarios?.[scenario.id] : undefined;
    const values: CaseValues = {};
    const retained: string[] = [
      ...variantRetained,
      ...(scenario?.retainedByPlatform?.[platform.id] ?? []),
    ];
    const blockers: FinalCase["blockers"] = [];
    const targets = { ...combo.values, ...overrides };
    const bound = materials.platformValues?.[platform.id]?.[combo.template] ?? {};
    for (const [key, coverage] of Object.entries(combo.fieldCoverage ?? {}))
      if (coverage.state === "retain" && !(key in overrides)) retained.push(key);
    for (const [key, raw] of Object.entries(targets)) {
      if (retained.includes(key)) continue;
      if (combo.fieldCoverage?.[key]?.state === "retain" && !(key in overrides)) {
        continue;
      }
      // Legacy candidate bindings can only replace an explicitly declared material reference.
      values[key] = caseContract.reference(raw)?.kind === "material" ? (bound[key] ?? raw) : raw;
    }
    // Material files can bind only fields declared by that scenario, never arbitrary scripts/steps.
    const candidateKeys: Record<string, string[]> = {
      "conditional.engine.presets": [
        "engineModulesConfigKey",
        "overwriteProjectSettings.includeModules.physics",
        "overwriteProjectSettings.includeModules.physics-2d",
        "overwriteProjectSettings.macroConfig.cleanupImageCache",
      ],
      "conditional.engine.additional-physics": [
        "overwriteProjectSettings.includeModules.physics",
        "overwriteProjectSettings.includeModules.physics-2d",
      ],
      "conditional.native.candidates": [
        `packages.${platform.id}.apiLevel`,
        `packages.${platform.id}.appABIs`,
      ],
    };
    for (const [key, value] of Object.entries(binding?.values ?? {})) {
      if (
        !(key in targets) &&
        !(scenario?.fieldKeysByPlatform?.[platform.id] ?? scenario?.fieldKeys ?? []).includes(
          key,
        ) &&
        !(candidateKeys[scenario?.id ?? ""] ?? []).includes(key)
      )
        throw new Error(`材料覆盖了未声明目标：${id}/${key}`);
      values[key] = value;
    }
    if (combo.template === "mixed" && !materials.mixedPlatforms?.includes(platform.id))
      blockers.push({
        kind: materials.mixedPlatforms === undefined ? "applicability" : "not-applicable",
        reason:
          materials.mixedPlatforms === undefined
            ? "未提供工程/平台混合组适用清单；不推定所有平台适用"
            : "已提供的工程/平台混合组适用清单未包含该平台",
      });
    if (
      scenario?.requiresBinding &&
      !binding &&
      !scenario.id.startsWith("conditional.l10n.") &&
      scenario.id !== "conditional.agc.services" &&
      scenario.id !== "conditional.resources.scenes"
    )
      blockers.push({ kind: "material", reason: scenario.materials.join("；") });
    if (
      scenario &&
      [
        "conditional.engine.presets",
        "conditional.engine.additional-physics",
        "conditional.native.candidates",
      ].includes(scenario.id) &&
      !binding?.values
    )
      blockers.push({ kind: "material", reason: "缺少该场景明确的候选目标 values" });
    if (scenario?.id === "conditional.l10n.gate")
      blockers.push({
        kind: "ui-adapter",
        reason: "跨页面 L10N 项目启用/恢复操作尚未适配；未以当前启用状态冒充转换覆盖",
      });
    const resolved = await resolveInputs(values);
    assertSupportedValues(resolved.values, id, catalog.targets);
    blockers.push(...resolved.blockers.map((reason) => ({ kind: "material" as const, reason })));
    const definition: FinalCase = {
      revision: catalog.revision,
      group: scenario ? "conditional" : combo.template,
      endpoint: scenario?.executionEndpoint ?? source.endpoint ?? "build",
      values: resolved.values,
      ...(source.captureInputs ? { inputs: structuredClone(values) } : {}),
      retained: [...new Set(retained)],
      scenario: scenario?.id,
      binding,
      blockers,
      configurationOrder: combo.configurationOrder,
      sceneContext: Object.keys(resolved.sceneInputs).length ? sceneContext : undefined,
      sceneInputs: resolved.sceneInputs,
      materialRefs: resolved.materialRefs,
      executionOperation: scenario?.executionOperation,
    };
    cases.push({
      caseId: id,
      platform: platform.id,
      title,
      purpose: "target",
      profile: `final-${definition.group}`,
      expected: {},
      specials: [],
      writes: [],
      sourceCaseIds: [scenario?.id ?? combo.id],
      finalized: definition,
    });
  };
  for (const group of ["publish", "debug", "mixed"] as const) {
    if (!groupIds.includes(group)) continue;
    for (const platform of catalog.platforms) {
      const combo = platform.combinations.find((c) => c.template === group)!;
      await make(
        platform,
        combo,
        references.find((r) => r.combo === combo.id && r.variant === undefined)!.caseId,
        combo.title,
      );
      for (const [i, variant] of combo.variants.entries())
        await make(
          platform,
          combo,
          references.find((r) => r.combo === combo.id && r.variant === i)!.caseId,
          `${combo.title} · ${variant.title}`,
          variant.values,
          undefined,
          variant.retained,
        );
    }
  }
  if (groupIds.includes("conditional")) {
    for (const [scenarioIndex, scenario] of catalog.conditionalScenarios.entries()) {
      for (const pid of scenario.representativePlatforms) {
        const platform = catalog.platforms.find((p) => p.id === pid)!;
        if (!platform || !scenario.platforms.includes(pid))
          throw new Error(`条件场景平台不适用：${scenario.id}/${pid}`);
        const baseline = platform.combinations.find((c) => c.template === "publish")!;
        // UI-only checks do not rewrite an entire release profile just to inspect one control.
        const uiOnly = scenario.executionEndpoint === "ui";
        await make(
          platform,
          uiOnly ? { ...baseline, values: {}, fieldCoverage: {} } : baseline,
          references.find((r) => r.scenario === scenarioIndex && r.platform === pid)!.caseId,
          scenario.title,
          scenario.valuesByPlatform[pid] ?? {},
          scenario,
        );
      }
    }
  }
  if (ids?.split(",").some((id) => id.trim().startsWith("FORM-"))) {
    if (!groupIds.includes("conditional")) throw new Error("FORM 样本属于第四组 conditional");
    const forms = await formsSource();
    const formReferences = catalogReferenceEntries({ ...catalog, formValidation: forms });
    const sourceSha256 = formSourceHash(forms);
    for (const family of forms.cases)
      for (const sample of family.samples)
        for (const pid of sample.platforms) {
          const caseId = formReferences.find(
            (r) => r.origin.sampleId === sample.id && r.platform === pid,
          )!.caseId;
          const blockers: FinalCase["blockers"] = [];
          const target = sample.executionByPlatform?.[pid] ?? sample.execution;
          const execution = target && structuredClone(target);
          const inputExecution = execution && structuredClone(execution);
          if (sample.kind === "applicability-only")
            blockers.push({ kind: "not-applicable", reason: "适用性说明，不计反向执行覆盖" });
          else if (!execution)
            blockers.push({
              kind: sample.executionBlockerKind ?? "ui-adapter",
              reason: sample.executionBlocker ?? "未定义可执行输入与断言",
            });
          const targets: CaseValues = {};
          if (execution) {
            for (const step of execution.setup ?? []) targets[step.field] = step.value;
            if (execution.value !== undefined) targets[execution.field] = execution.value;
          }
          const resolved = await resolveInputs(targets);
          assertSupportedValues(resolved.values, caseId);
          const prepared = await resolveInputs(
            Object.fromEntries((execution?.prepare ?? []).map((step) => [step.field, step.value])),
          );
          assertSupportedValues(prepared.values, caseId + ".prepare");
          blockers.push(
            ...[...resolved.blockers, ...prepared.blockers].map((reason) => ({
              kind: "material" as const,
              reason,
            })),
          );
          if (execution) {
            for (const step of execution.setup ?? []) step.value = resolved.values[step.field];
            for (const step of execution.prepare ?? []) step.value = prepared.values[step.field];
            if (execution.value !== undefined) execution.value = resolved.values[execution.field];
          }
          cases.push({
            caseId,
            platform: pid,
            title: `${family.title} · ${sample.title}`,
            purpose: "target",
            profile: "final-conditional",
            expected: {},
            specials: [],
            writes: [],
            sourceCaseIds: [family.id, sample.id],
            finalized: {
              revision: forms.revision,
              group: "conditional",
              endpoint: "ui",
              values: resolved.values,
              ...(source.captureInputs ? { inputs: structuredClone(targets) } : {}),
              retained: [],
              scenario: sample.id,
              executionOperation: "configure-and-restore",
              materialRefs: [...new Set([...resolved.materialRefs, ...prepared.materialRefs])],
              blockers,
              formValidation: execution
                ? {
                    sampleId: sample.id,
                    sourceSha256,
                    execution: source.captureInputs ? inputExecution! : execution,
                  }
                : undefined,
            },
          });
        }
  }
  if (catalog.executionOrder) {
    const defined = new Set(references.filter((r) => !r.form).map((r) => r.caseId));
    if (
      catalog.executionOrder.some((id) => !cases.some((c) => c.caseId === id) && !defined.has(id))
    )
      throw new Error("executionOrder 含当前展开范围之外的用例 ID");
    const order = new Map(catalog.executionOrder.map((id, index) => [id, index]));
    cases.sort((a, b) => (order.get(a.caseId) ?? Infinity) - (order.get(b.caseId) ?? Infinity));
  }
  if (ids !== undefined) {
    const requested = ids.split(",").map((id) => id.trim());
    const matches = (id: string, caseId: string) =>
      id === caseId || (id.startsWith("FORM-") && caseId.startsWith(id + "."));
    if (
      !requested.length ||
      new Set(requested).size !== requested.length ||
      requested.some((id) => !cases.some((c) => matches(id, c.caseId)))
    )
      throw new Error("cases 须来自所选四组；可查看定稿中的用例 ID（变体追加 .variant-序号）");
    return cases.filter((c) => requested.some((id) => matches(id, c.caseId)));
  }
  return cases;
}

export function finalCaseKeys(cases: BuildCase[]): string[] {
  return [
    ...new Set([
      "bundleConfigs",
      "md5CacheOptions.handleTemplateMd5Link",
      "binGroupConfig.enable",
      "binGroupConfig.threshold",
      ...cases.flatMap((c) => [
        ...Object.keys(c.finalized?.values ?? {}),
        ...(c.finalized?.retained ?? []),
      ]),
    ]),
  ];
}
