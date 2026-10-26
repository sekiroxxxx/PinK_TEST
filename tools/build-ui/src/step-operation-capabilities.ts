import type { BuildStep } from "./build-steps-contract.js";

type Description = {
  inputs: readonly string[];
  requires: readonly string[];
  output: string;
  cleanup?: boolean;
};
/** Executor-owned names; validation consumes this same table. No selectors, scripts or product commands. */
export const stepOperations = {
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
    requires: ["current-page", "recorded-field", "registered-preparation"],
    output: "changed-fields",
  },
  record: {
    inputs: ["page", "fields"],
    requires: ["current-page"],
    output: "configuration-record",
  },
  set: {
    inputs: ["page", "field", "value", "input?"],
    requires: ["current-page", "recorded-field", "field-capability"],
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
    requires: ["google-play-page", "recorded-icon-mode-and-file"],
    output: "mode-and-material-fingerprint",
  },
  "input.openpaas-game": {
    inputs: ["page", "value", "requireChange?"],
    requires: ["openpaas-page", "recorded-game", "existing-selectable-games"],
    output: "selected-existing-game",
  },
  "input.cancel-file": {
    inputs: ["page", "field"],
    requires: ["current-page", "recorded-file-control"],
    output: "cancelled-and-preserved",
  },
  "input.clear-field": {
    inputs: ["page", "field"],
    requires: ["current-page", "recorded-string-control"],
    output: "cleared",
  },
  "input.clear-scenes": {
    inputs: ["page"],
    requires: ["current-page", "recorded-startScene-and-scenes", "one-protected-initial-scene"],
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

export function describeStepCapabilities() {
  return {
    kind: "pink-configuration-steps",
    schemaVersion: 2,
    operations: Object.entries(stepOperations).map(([op, details]) => ({
      op,
      ...details,
      cleanup: "cleanup" in details && details.cleanup,
    })),
    assertions: Object.entries(stepAssertions).map(([check, inputs]) => ({ check, inputs })),
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
    extensionBoundary: "registered-fields-and-actions; new-standard-targets-configuration-only",
  };
}
