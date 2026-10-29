import type { BuildStep } from "./build-steps-contract.js";
import {
  operationParameterSchemas,
  assertionParameterSchemas,
  type ParameterSchema,
} from "./step-parameter-contract.js";

type Description = {
  inputs: readonly string[];
  requires: readonly string[];
  output: string;
  cleanup?: boolean;
};
/** Executor-owned names; validation consumes this same table. No selectors, scripts or product commands. */
export const stepOperations = {
  "builder.open": {
    inputs: [],
    requires: ["verified-session", "case.target", "no-user-configuration"],
    output: "builder-page",
  },
  "builder.read": {
    inputs: ["page"],
    requires: ["builder-page"],
    output: "builder-home-observation",
  },
  "builder.home": {
    inputs: [],
    requires: ["owned-builder-page"],
    output: "builder-home",
    cleanup: true,
  },
  "platform.probe": {
    inputs: [],
    requires: ["verified-session", "case.platform", "no-open-page"],
    output: "target-observation",
  },
  "config.probe": {
    inputs: ["page", "field"],
    requires: ["current-page", "field-description"],
    output: "target-observation",
  },
  "config.candidates": {
    inputs: ["page", "field"],
    requires: ["current-page", "standard-enum"],
    output: "candidate-observation",
  },
  "config.select": {
    inputs: ["page", "field", "candidate"],
    requires: ["current-page", "standard-enum", "recorded-field-if-restoring"],
    output: "selected-candidate",
  },
  "config.open": {
    inputs: [],
    requires: ["verified-session", "case.platform"],
    output: "page",
    cleanup: true,
  },
  "config.close": {
    inputs: ["page"],
    requires: ["current-page"],
    output: "page-invalidated",
    cleanup: true,
  },
  "config.ready": { inputs: ["page"], requires: ["current-page"], output: "stable-form" },
  "config.require": {
    inputs: ["page", "expected"],
    requires: ["current-page"],
    output: "satisfied-or-blocked",
  },
  "config.expand": {
    inputs: ["page", "section"],
    requires: ["current-page", "registered-section"],
    output: "expanded-section",
  },
  "config.prepare": {
    inputs: ["page", "field", "value"],
    requires: ["current-page", "recorded-field-if-restoring", "registered-preparation"],
    output: "changed-fields",
  },
  record: {
    inputs: ["page", "fields"],
    requires: ["current-page"],
    output: "configuration-record",
  },
  set: {
    inputs: ["page", "field", "value", "input?"],
    requires: ["current-page", "recorded-field-if-restoring", "field-capability"],
    output: "changed",
  },
  read: {
    inputs: ["page", "fields", "scope?", "retained?", "hidden?"],
    requires: ["current-page"],
    output: "configuration-snapshot",
  },
  retain: {
    inputs: ["page", "fields"],
    requires: ["current-page", "unmodified-fields"],
    output: "retained-baseline",
  },
  restore: {
    inputs: ["page", "record", "reopen?"],
    requires: ["cleanup-page", "same-session-and-platform-record"],
    output: "restored-or-hard-stop",
    cleanup: true,
  },
  assert: {
    inputs: ["check", "check-specific-inputs"],
    requires: ["check-specific-dependencies"],
    output: "assertions",
  },
  "input.google-icon": {
    inputs: ["page", "file"],
    requires: ["google-play-page", "recorded-icon-mode-and-file-if-restoring"],
    output: "mode-and-material-fingerprint",
  },
  "input.openpaas-game": {
    inputs: ["page", "value", "requireChange?"],
    requires: ["openpaas-page", "recorded-game-if-restoring", "existing-selectable-games"],
    output: "selected-existing-game",
  },
  "input.cancel-file": {
    inputs: ["page", "field"],
    requires: ["current-page", "recorded-file-control-if-restoring"],
    output: "cancelled-and-preserved",
  },
  "input.clear-field": {
    inputs: ["page", "field"],
    requires: ["current-page", "recorded-string-control-if-restoring"],
    output: "cleared",
  },
  "input.clear-scenes": {
    inputs: ["page"],
    requires: [
      "current-page",
      "recorded-startScene-and-scenes-if-restoring",
      "one-protected-initial-scene",
    ],
    output: "protected-scenes-preserved",
  },
  "stage.record": { inputs: ["page"], requires: ["current-page"], output: "stage-record" },
  "stage.read": { inputs: ["page"], requires: ["current-page"], output: "stage-snapshot" },
  "stage.link": {
    inputs: ["page", "record", "previous", "stage"],
    requires: ["current-page", "stage-record", "adjacent-enabled-groups"],
    output: "stage-view",
  },
  "stage.unlink": {
    inputs: ["page", "record", "group", "stage"],
    requires: ["current-page", "stage-record", "enabled-parent-button"],
    output: "stage-view",
  },
  "stage.hint": {
    inputs: ["page", "control", "stage", "contains"],
    requires: ["current-page", "unique-stage-control"],
    output: "observed-tooltip",
  },
  "stage.restore": {
    inputs: ["page", "record", "reopen?"],
    requires: ["cleanup-page", "same-session-and-platform-stage-record"],
    output: "restored-or-hard-stop",
    cleanup: true,
  },
  "build.submit": {
    inputs: ["page", "snapshot"],
    requires: ["current-build-snapshot", "build-only-stage-group", "healthy-observer"],
    output: "unique-task-reference",
  },
  "build.wait": {
    inputs: ["task"],
    requires: ["owned-task-reference"],
    output: "terminal-task-result",
  },
} as const satisfies Record<BuildStep["op"], Description>;

export const stepAssertions = {
  "builder-state": ["snapshot", "expected"],
  probe: ["observation", "expected"],
  candidate: ["observation", "candidate", "expected"],
  values: ["snapshot", "values"],
  prompt: ["field", "expected"],
  state: ["field", "expected"],
  retained: ["page", "retained"],
  hidden: ["page", "field", "observed?"],
  "agc-material": ["page"],
  "openpaas-ready": ["page"],
  "build-result": ["task", "result", "expected"],
  stages: ["snapshot", "expected"],
  "build-scope": ["page", "expected"],
  "build-enabled": ["page", "expected"],
  empty: ["page", "field"],
  "protected-choice": ["page", "field"],
  unchanged: ["page", "snapshot", "fields"],
} as const satisfies Record<Extract<BuildStep, { op: "assert" }>["check"], readonly string[]>;

type EditingPhase = "before" | "steps" | "finally";
type TargetKind = "platform" | "builder";
const placement = (op: BuildStep["op"]) => {
  const details = stepOperations[op];
  const cleanupOnly = ["restore", "stage.restore", "builder.home"].includes(op);
  return {
    targetKinds: (op === "assert"
      ? ["platform", "builder"]
      : [op.startsWith("builder.") ? "builder" : "platform"]) as TargetKind[],
    allowedPhases: (cleanupOnly
      ? ["finally"]
      : "cleanup" in details && details.cleanup
        ? ["before", "steps", "finally"]
        : ["before", "steps"]) as EditingPhase[],
  };
};

/** Reference types come from the same schemas used to describe action parameters. */
function referenceInputs(schema: ParameterSchema) {
  const references: Array<{
    inputPath: string[];
    type: string;
    source: "field-description" | "step-output";
    scope: "case-target" | "same-flow-instance";
    when?: Record<string, unknown>;
    producers: Array<{ operationId: string; when?: Record<string, unknown> }>;
  }> = [];
  const outputs = Object.entries(stepOperations).flatMap(([operationId, details]) => [
    { operationId, type: details.output, when: undefined as Record<string, unknown> | undefined },
    ...(operationId === "read"
      ? [{ operationId, type: "build-configuration-snapshot", when: { scope: "build" } }]
      : operationId === "assert"
        ? [{ operationId, type: "hidden-assertion", when: { check: "hidden" } }]
        : []),
  ]);
  const walk = (node: ParameterSchema, path: string[], when: Record<string, unknown>) => {
    if (node["x-reference"]) {
      const type = node["x-reference"];
      const field = type === "field-description";
      references.push({
        inputPath: path,
        type,
        source: field ? "field-description" : "step-output",
        scope: field ? "case-target" : "same-flow-instance",
        ...(Object.keys(when).length ? { when } : {}),
        producers: field
          ? []
          : outputs
              .filter((output) => output.type === type)
              .map(({ operationId, when }) => ({
                operationId,
                ...(when ? { when } : {}),
              })),
      });
    }
    for (const variant of node.oneOf ?? []) {
      const constants = Object.fromEntries(
        Object.entries(variant.properties ?? {})
          .filter(([, value]) => Object.hasOwn(value, "const"))
          .map(([key, value]) => [key, value.const]),
      );
      walk(variant, path, { ...when, ...constants });
    }
    for (const [key, child] of Object.entries(node.properties ?? {}))
      walk(child, [...path, key], when);
    if (node.items) walk(node.items, [...path, "*"], when);
  };
  walk(schema, [], {});
  return references;
}

export function describeStepCapabilities() {
  return {
    kind: "pink-configuration-steps",
    schemaVersion: 2,
    capabilityVersion: "2",
    operations: Object.entries(stepOperations).map(([op, details]) => ({
      op,
      ...details,
      ...placement(op as BuildStep["op"]),
      parameters: operationParameterSchemas[op as BuildStep["op"]],
      references: referenceInputs(operationParameterSchemas[op as BuildStep["op"]]),
      cleanup: "cleanup" in details && details.cleanup,
    })),
    assertions: Object.entries(stepAssertions).map(([check, inputs]) => ({
      check,
      inputs,
      targetKinds: check === "builder-state" ? ["builder"] : ["platform"],
      allowedPhases: ["before", "steps"],
      parameters: assertionParameterSchemas[check as keyof typeof assertionParameterSchemas],
      references: referenceInputs(
        assertionParameterSchemas[check as keyof typeof assertionParameterSchemas],
      ),
    })),
    referencePolicy: {
      scope: "same-flow-instance",
      order: "producer-before-consumer-in-expanded-order",
      crossCase: false,
      validity: "native-validator-checks-page-lifetime-snapshot-revision-and-task-ownership",
      fieldCandidates: "supportedFields-and-current-case-target-fields",
      inputPathRoot: "action.inputs",
      inputPathWildcard: "* matches an array item",
      placementIsNotDependencyProof: true,
    },
    initialChecks: [
      "buildEnabled",
      "visible",
      "nonEmpty",
      "noPrompt",
      "cleanOrEmpty",
      "differs",
      "emptyWhen",
    ],
    inputReferences: ["material", "scene"],
    runtimeVerified: false,
    extensionBoundary:
      "executor-owned-actions; document-owned-standard-targets; new-targets-configuration-only",
  };
}

/** v1 stays native: implicit page, one-platform startup, mandatory last restore after recording. */
export function describeV1StepCapabilities() {
  const names = ["record", "set", "read", "assert", "restore"] as const;
  const assertions = ["values", "prompt", "state"] as const;
  return {
    kind: "pink-configuration-steps",
    schemaVersion: 1,
    capabilityVersion: "2",
    runtimeVerified: false,
    implicitPage: true,
    startupSinglePlatform: true,
    inputReferences: [],
    operations: names.map((op) => {
      const schema = structuredClone(operationParameterSchemas[op]);
      const parameters =
        op === "assert"
          ? {
              oneOf: assertions.map((check) => {
                const description = assertionParameterSchemas[check];
                return {
                  type: "object",
                  properties: { check: { const: check }, ...description.properties },
                  required: ["check", ...description.required!],
                  additionalProperties: false,
                };
              }),
            }
          : {
              ...schema,
              properties: Object.fromEntries(
                Object.entries("properties" in schema ? (schema.properties ?? {}) : {}).filter(
                  ([key]) => !["page", "reopen", "scope", "retained", "hidden"].includes(key),
                ),
              ),
              required: ("required" in schema ? (schema.required ?? []) : []).filter(
                (key) => key !== "page",
              ),
            };
      return {
        op,
        parameters,
        output: stepOperations[op].output,
        requires: stepOperations[op].requires.filter((name) => name !== "current-page"),
        cleanup: op === "restore",
      };
    }),
    recovery: "record before writes; restore is last and also runs after failure",
  };
}
