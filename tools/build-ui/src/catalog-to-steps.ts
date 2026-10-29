import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { caseContract, type InputValues } from "./case-contract.js";
import { readFinalMaterials, selectFinalizedCases } from "./finalized-cases.js";
import { describeFieldCapabilities, validateExecutableCatalog } from "./field-capabilities.js";
import { publicValues } from "./case-inputs.js";
import {
  validateConfigurationSteps,
  sensitiveConfigurationField,
} from "./configuration-steps-contract.js";
import { loadStepInputs, type StepInputOptions } from "./step-inputs.js";
import { contentHash, sealPlan } from "./plan-integrity.js";
import type { BuildStepsDocument } from "./build-steps-contract.js";
import { catalogStepSequence, catalogRetainedFields } from "./catalog-step-sequence.js";
import { buildStepScheduling, buildStepGroups } from "./build-step-scheduling.js";
import { formToSteps } from "./form-to-steps.js";

/** The shared catalog compiler; unsupported checks remain explicit blockers. */
export async function catalogToSteps(
  file: string,
  options: StepInputOptions & { cases?: string; groups?: string; endpoint?: "ui" } = {},
) {
  const path = resolve(file),
    bytes = await readFile(path);
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("四组用例不是有效 JSON（内容已省略）");
  }
  return compileCatalogDocument(raw, options, { path, bytes });
}

/** The same compiler for a selected in-memory source; no temporary source file or source mutation. */
export async function compileCatalogDocument(
  raw: unknown,
  options: StepInputOptions & { cases?: string; groups?: string; endpoint?: "ui" } = {},
  source?: { path: string; bytes: Uint8Array },
) {
  const path = source?.path ?? "inline:catalog";
  const bytes = source ? Buffer.from(source.bytes) : Buffer.from(JSON.stringify(raw));
  const catalog = validateExecutableCatalog(raw);
  if (options.endpoint !== undefined && options.endpoint !== "ui")
    throw new Error("endpoint 覆盖仅支持 ui；省略时沿用原定义");
  const targets = catalog.targets ?? [];
  let materials;
  try {
    materials = await readFinalMaterials(options.materials);
  } catch {
    throw new Error("步骤材料清单不可读取或格式无效（内容已省略）");
  }
  const selected = await selectFinalizedCases(options.cases, options.groups, materials, {
    catalog,
    catalogPath: path,
    project: options.project,
    captureInputs: true,
    endpoint: options.endpoint,
  });
  const capabilities = describeFieldCapabilities().supportedFields;
  const cases = [];
  const drafts: BuildStepsDocument["cases"] = [];
  for (const item of selected) {
    const definition = item.finalized!;
    const values = definition.inputs ?? {};
    const gaps: Array<{ kind: string; reason: string }> = [...definition.blockers];
    const supportedScenario =
      definition.scenario &&
      (definition.scenario === "conditional.agc.services" ||
        definition.scenario === "conditional.openpaas.game-switch" ||
        definition.scenario === "conditional.windows.generator" ||
        definition.scenario === "conditional.resources.scenes" ||
        definition.scenario === "conditional.taobao-mini-game.global-adapter" ||
        /\.(icon|keystore|pem-signing|runtime|app-identity|plugin)$/.test(definition.scenario));
    if (definition.scenario && !supportedScenario && !definition.formValidation)
      gaps.push({
        kind: "ui-adapter",
        reason: "条件/反向专项的临时初态、提示、状态及恢复断言尚未转换；不能以基础配置代替",
      });
    for (const [field, value] of Object.entries(values)) {
      const capability = capabilities.find((c) => c.key === field);
      if (
        (!capability && !targets.find((t) => t.id === item.platform)?.fields[field]) ||
        (capability &&
          ![
            "set-target-and-read-back",
            "scene-selection",
            "google-icon",
            "select-existing-game",
          ].includes(capability.operation))
      )
        gaps.push({ kind: "ui-adapter", reason: `专用操作未迁移：${field}` });
      if (
        sensitiveConfigurationField(field) &&
        caseContract.reference(value)?.kind !== "material" &&
        !(definition.formValidation && value === "")
      )
        gaps.push({ kind: "input-contract", reason: `敏感输入需改为材料引用：${field}` });
    }
    if (
      definition.formValidation &&
      [definition.formValidation.execution.field, ...Object.keys(values)].some((key) =>
        key.startsWith("packages.localization-editor."),
      )
    )
      gaps.push({ kind: "ui-adapter", reason: "L10N 专项继续保留，未迁移跨页启用和 Catalog 前提" });
    if (!Object.keys(values).length && !definition.formValidation)
      gaps.push({ kind: "ui-adapter", reason: "没有可转换的明确输入与回读目标" });
    const document: BuildStepsDocument = {
      kind: "pink-configuration-steps",
      schemaVersion: 2,
      ...(targets.length ? { targets } : {}),
      cases: [definition.formValidation ? formToSteps(item) : catalogStepSequence(item)],
    };
    try {
      validateConfigurationSteps(document);
    } catch (error) {
      gaps.push({
        kind:
          error instanceof Error && error.message.includes("敏感")
            ? "input-contract"
            : "ui-adapter",
        reason: error instanceof Error ? error.message : "步骤合同未满足",
      });
    }
    drafts.push(...document.cases);
    const safeValues = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        caseContract.reference(value) ? value : publicValues({ [key]: value })[key],
      ]),
    ) as InputValues;
    cases.push({
      caseId: item.caseId,
      title: item.title ?? item.caseId,
      platform: item.platform,
      group: definition.group,
      endpoint: definition.endpoint,
      sourceCaseIds: item.sourceCaseIds,
      ...(definition.formValidation
        ? { formSourceSha256: definition.formValidation.sourceSha256 }
        : {}),
      status: gaps.some((g) => g.kind === "not-applicable")
        ? "not-applicable"
        : gaps.length
          ? "blocked"
          : "ready",
      inputs: safeValues,
      retained: definition.retained,
      derivedFromParent: definition.retained
        .filter((field) => !catalogRetainedFields(definition).includes(field))
        .map((field) => ({
          field,
          parent: "nativeCodeBundleMode",
          value: false,
          coverage: "parent-derived; not-retained-unchanged",
        })),
      gaps,
      // A blocked draft is deliberately not an executable document with omitted assertions.
      document: gaps.length ? undefined : document,
    });
  }
  // Discover project resources and read material files once for the selected set.
  const inputs = await loadStepInputs(
    { kind: "pink-configuration-steps", schemaVersion: 2, targets, cases: drafts },
    options,
  );
  const inputPreview = inputs.preview;
  for (const c of cases) {
    for (const reason of inputPreview.cases.find((input) => input.caseId === c.caseId)!.blockers)
      if (!c.gaps.some((g) => g.reason === reason)) c.gaps.push({ kind: "material", reason });
    if (c.gaps.length) {
      c.document = undefined;
      if (c.status !== "not-applicable") c.status = "blocked";
    }
  }
  const ready = cases.flatMap((c) => c.document?.cases ?? []);
  const document: BuildStepsDocument | undefined = ready.length
    ? { kind: "pink-configuration-steps", schemaVersion: 2, targets, cases: ready }
    : undefined;
  if (document) validateConfigurationSteps(document);
  return sealPlan({
    kind: "pink-catalog-to-steps-plan",
    schemaVersion: 1,
    phase: "offline",
    runtimeVerified: false,
    buildSubmitted: false,
    targets,
    source: { path, sha256: contentHash(bytes), revision: catalog.revision },
    inputs: inputPreview,
    execution: {
      endpointOverride: options.endpoint,
      willSubmit: !!document?.cases.some((c) => c.steps.some((s) => s.op === "build.submit")),
      ...buildStepScheduling,
      groups: buildStepGroups(
        cases.filter((c) => c.document).map((c) => ({ caseId: c.caseId, platform: c.platform })),
      ),
      restoreRecordedConfiguration: true,
    },
    cases,
    document,
  });
}
