import { readFile } from "node:fs/promises";
import { validateExecutableCatalog, describeFieldCapabilities } from "./field-capabilities.js";
import {
  validateConfigurationSteps,
  loadConfigurationSteps,
} from "./configuration-steps-contract.js";
import { loadCatalogSteps } from "./catalog-steps-loader.js";
import type { CatalogDocument, InputValues } from "./case-contract.js";
import { configurationTargetSchema, type ConfigurationTarget } from "./configuration-targets.js";
import type { BuildStepsDocument } from "./build-steps-contract.js";
import type { StepInputOptions } from "./step-inputs.js";
import { describeV1StepCapabilities } from "./step-operation-capabilities.js";
import { describeCaseComposition } from "./case-composition.js";
import { executorCapabilityVersion } from "./executor-identity.js";
import { legacyBuilderRepresentatives } from "./builder-checks.js";
export { getExecutorIdentity, verifyExecutorIdentity } from "./executor-identity.js";
export type { ExecutorIdentity } from "./executor-identity.js";
export type { CasePrecondition, StepPreflightCase } from "./step-preflight.js";
export {
  createCaseComposition,
  composeNativeCases,
  mapCompositionResults,
  describeCaseComposition,
  validateCaseComposition,
} from "./case-composition.js";
export type {
  CaseComposition,
  CompositionSelection,
  CaseAssembly,
  CompositionOrigin,
  CompositionDiagnostic,
  CompositionAction,
  CompositionActionNode,
  CompositionNode,
  CompositionFragment,
  CompositionParameter,
  CompositionUse,
  CompositionValue,
  CompositionValidation,
} from "./case-composition.js";
export { listNativeCaseReferences } from "./native-case-references.js";
export type { NativeCaseReference } from "./native-case-references.js";

export function identifyNativeDocument(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("用例必须是原生 JSON 对象");
  const document = value as Record<string, unknown>;
  if (
    document.kind === "pink-configuration-steps" &&
    [1, 2].includes(document.schemaVersion as number)
  )
    return {
      format: "steps" as const,
      schemaVersion: document.schemaVersion as 1 | 2,
      cliArgument: "--file" as const,
    };
  if (
    document.kind === undefined &&
    document.schemaVersion === 1 &&
    Array.isArray(document.templates) &&
    Array.isArray(document.platforms) &&
    document.fieldTypes &&
    Array.isArray(document.conditionalScenarios)
  )
    return {
      format: "catalog" as const,
      schemaVersion: 1 as const,
      cliArgument: "--catalog" as const,
    };
  throw new Error("无法识别原生用例格式或格式版本；不按 revision 或文件名猜测，不降级重试");
}
export function validateNativeDocument(value: unknown) {
  const format = identifyNativeDocument(value);
  return {
    ...format,
    document:
      format.format === "steps"
        ? validateConfigurationSteps(value)
        : validateExecutableCatalog(value),
  };
}
export function serializeNativeDocument(value: unknown) {
  return JSON.stringify(validateNativeDocument(value).document, null, 2) + "\n";
}
export async function loadNativeCases(
  file: string,
  options: StepInputOptions & { cases?: string; groups?: string; endpoint?: "ui" } = {},
) {
  let raw: unknown;
  try {
    raw = JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("原生用例不可读取或不是有效 JSON（内容已省略）");
  }
  const format = identifyNativeDocument(raw);
  if (format.format === "catalog") return loadCatalogSteps(file, options);
  if (options.cases || options.groups || options.endpoint)
    throw new Error("cases/groups/endpoint 仅用于 catalog；步骤的范围和顺序来自原生文件");
  return loadConfigurationSteps(file, options);
}

/** Module-owned default sequence. The workbench supplies data, not recovery algorithms. */
export function configurationCheckDocument(input: {
  caseId: string;
  platform: string;
  values: InputValues;
  targets?: ConfigurationTarget[];
}): BuildStepsDocument {
  const fields = [
    ...new Set([
      ...Object.keys(input.values),
      ...("startScene" in input.values || "scenes" in input.values ? ["startScene", "scenes"] : []),
    ]),
  ];
  const document: BuildStepsDocument = {
    kind: "pink-configuration-steps",
    schemaVersion: 2,
    ...(input.targets ? { targets: structuredClone(input.targets) } : {}),
    cases: [
      {
        caseId: input.caseId,
        platform: input.platform,
        steps: [
          { id: "open", op: "config.open" },
          { id: "ready", op: "config.ready", page: "open" },
          { id: "original", op: "record", page: "open", fields },
          ...Object.keys(input.values).flatMap((field, index) => [
            {
              id: `set-${index + 1}`,
              op: "set" as const,
              page: "open",
              field,
              value: structuredClone(input.values[field]),
            },
            { id: `ready-${index + 1}`, op: "config.ready" as const, page: "open" },
          ]),
          { id: "current", op: "read", page: "open", fields },
          {
            id: "check",
            op: "assert",
            check: "values",
            snapshot: "current",
            values: structuredClone(input.values),
          },
        ],
        finally: [
          { id: "cleanup", op: "config.open" },
          { id: "restore", op: "restore", page: "cleanup", record: "original" },
          { id: "close", op: "config.close", page: "cleanup" },
        ],
      },
    ],
  };
  return validateConfigurationSteps(document) as BuildStepsDocument;
}

export function describeNativeCaseCapabilities() {
  return {
    kind: "pink-native-case-capabilities",
    schemaVersion: 1,
    capabilityVersion: executorCapabilityVersion,
    runtimeVerified: false,
    composition: describeCaseComposition(),
    formats: [
      {
        format: "catalog",
        schemaVersion: 1,
        cliArgument: "--catalog",
        endpointOverride: ["ui"],
        order: "executionOrder then existing expansion order; cases only filters",
      },
      {
        format: "steps",
        schemaVersion: 1,
        kind: "pink-configuration-steps",
        cliArgument: "--file",
        capabilities: describeV1StepCapabilities(),
        order: "cases/steps; implicit open and close; last restore also runs on failure",
      },
      {
        format: "steps",
        schemaVersion: 2,
        kind: "pink-configuration-steps",
        cliArgument: "--file",
        order: "cases/steps/finally; groups of at most two",
      },
    ],
    autoInputArgument: "--input",
    configurationEndpointArgument: "--endpoint ui",
    planNoBuildField: "steps.execution.willSubmit",
    planVerification: "--expected-plan",
    preflight: {
      planField: "steps.preflight",
      statuses: ["ready", "blocked", "not-applicable"],
      caseField: "precondition",
      emptySteps: "explicit blocked/not-applicable records only; no execution",
      definitionErrors: "no executable assembly",
      prerequisites: "block whole case; preserve independent cases and onFailure policy",
      allBlocked: "report only; no PinK connection or submission",
      crossCaseOutputs: "unsupported dependency; definition error",
    },
    executorIdentity: {
      exports: ["getExecutorIdentity", "verifyExecutorIdentity"],
      planField: "executor",
      requiredForNewPlans: true,
      changePolicy: "reload host or restart entrypoint, then preview again; no in-process hot swap",
    },
    template: {
      export: "configurationCheckDocument",
      inputs: ["caseId", "platform", "values", "targets?"],
      endpoint: "ui",
      restores: true,
    },
    targetsSchema: { type: "array", items: configurationTargetSchema },
    targetDescription: {
      id: "case binding identity; does not assert the product internal platform ID",
      required: ["id", "label", "configurationTitle", "fields"],
      category: { optional: true, kind: "string", purpose: "display only; never used for routing" },
      scalarKinds: ["string", "number", "boolean"],
      mixedEnum: {
        kind: "scalar",
        valueKinds: "explicit unique scalarKinds, at least two; enum only",
      },
      controls: ["text", "number", "boolean", "enum"],
      locators: [
        { kind: "option-key", required: ["key"] },
        { kind: "label", required: ["name"] },
        {
          kind: "role",
          required: ["role", "name"],
          roles: ["textbox", "spinbutton", "checkbox", "combobox"],
        },
      ],
      scope: { required: ["readyKeys"], optional: ["section"], absenceRequiresCompleteScope: true },
      homeScope: { required: ["readyLabels"], absenceScope: "uniquely-matched-rendered-home-only" },
      families: {
        required: ["parent", "enabled", "children"],
        meaning: "existing parent/child recovery; no scripts or expressions",
      },
      sensitiveExtension:
        "unregistered secret fields are not supported; existing material adapters remain available",
    },
    builderTarget: {
      kind: "builder",
      required: ["representativePlatform"],
      legacy: { field: "category", representatives: legacyBuilderRepresentatives, exclusive: true },
      observationIdentity: ["representativePlatform", "entryKey"],
    },
    observations: {
      target: {
        required: [
          "scopeReady",
          "scopeComplete",
          "matchCount",
          "presence",
          "visible",
          "readable",
          "writable",
        ],
        presence: ["present", "absent", "undetermined"],
        reasons: ["not-ready", "ambiguous", "unsupported", "incomplete-scope"],
        optional: ["control", "reason"],
      },
      candidates: {
        required: ["target", "complete", "items"],
        item: ["value?", "label", "disabled"],
        valueTypes: ["string", "number", "boolean"],
        noValueCoercion: true,
      },
    },
    fields: describeFieldCapabilities(),
  };
}
export type NativeCaseDocument = CatalogDocument | ReturnType<typeof validateConfigurationSteps>;
