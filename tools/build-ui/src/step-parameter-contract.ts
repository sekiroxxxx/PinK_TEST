import type { BuildStep } from "./build-steps-contract.js";

/** JSON Schema descriptions for editing. The native validator remains the semantic authority. */
export type ParameterSchema = {
  type?: string;
  enum?: readonly unknown[];
  const?: unknown;
  properties?: Record<string, ParameterSchema>;
  required?: string[];
  items?: ParameterSchema;
  additionalProperties?: boolean | ParameterSchema;
  oneOf?: ParameterSchema[];
  minItems?: number;
  minLength?: number;
  minProperties?: number;
  uniqueItems?: boolean;
  pattern?: string;
  "x-reference"?: string;
};
const text: ParameterSchema = { type: "string", minLength: 1 };
const boolean: ParameterSchema = { type: "boolean" };
const strings: ParameterSchema = { type: "array", items: text, minItems: 1, uniqueItems: true };
const object = (
  properties: Record<string, ParameterSchema>,
  required = Object.keys(properties),
): ParameterSchema => ({ type: "object", properties, required, additionalProperties: false });
const reference = (type: string): ParameterSchema => ({ ...text, "x-reference": type });
const scalar: ParameterSchema = { oneOf: [{ type: "string" }, { type: "number" }, boolean] };
const value: ParameterSchema = {
  oneOf: [
    { type: "string" },
    { type: "number" },
    boolean,
    {
      type: "array",
      items: {
        oneOf: [
          { type: "string" },
          object({ $scene: { enum: ["primary", "secondary"] } }),
          object({ $material: text }),
        ],
      },
    },
    { type: "object" },
  ],
};
const values: ParameterSchema = { type: "object", additionalProperties: value };
const stage: ParameterSchema = { enum: ["build", "make", "run", "upload", "publish"] };
export const candidateMatchSchema = {
  oneOf: [
    object({ by: { const: "value" }, value: scalar }),
    object({ by: { const: "label" }, label: text }),
  ],
};
const probeExpected = object(
  {
    presence: { enum: ["present", "absent"] },
    visible: boolean,
    readable: boolean,
    writable: boolean,
    control: { enum: ["text", "number", "boolean", "enum", "platform-card"] },
  },
  [],
);
const page = reference("page");
const field = { ...text, "x-reference": "field-description" };
const fields = { ...strings, items: field };
const initial = object(
  {
    buildEnabled: boolean,
    visible: fields,
    nonEmpty: fields,
    noPrompt: fields,
    cleanOrEmpty: fields,
    differs: values,
    emptyWhen: { type: "array", minItems: 1, items: object({ field, value, children: fields }) },
  },
  [],
);
export const assertionParameterSchemas = {
  "builder-state": object({
    snapshot: reference("builder-home-observation"),
    expected: object(
      {
        ready: boolean,
        buttons: object(
          {
            history: object({ visible: boolean, disabled: boolean }, []),
            "build-all": object({ visible: boolean, disabled: boolean }, []),
          },
          [],
        ),
      },
      [],
    ),
  }),
  values: object({ snapshot: reference("configuration-snapshot"), values }),
  prompt: object({
    field,
    expected: {
      oneOf: [object({ kind: { const: "none" } }), object({ kind: { const: "contains" }, text })],
    },
  }),
  state: object({ field, expected: object({ visible: { const: true }, disabled: boolean }, []) }),
  probe: object({ observation: reference("target-observation"), expected: probeExpected }),
  candidate: object({
    observation: reference("candidate-observation"),
    candidate: candidateMatchSchema,
    expected: object({ present: boolean, disabled: boolean }, ["present"]),
  }),
  retained: object({ page, retained: reference("retained-baseline") }),
  hidden: object({ page, field, observed: reference("configuration-snapshot") }, ["page", "field"]),
  "agc-material": object({ page }),
  "openpaas-ready": object({ page }),
  "build-result": object({
    task: reference("unique-task-reference"),
    result: reference("terminal-task-result"),
    expected: object({ state: { const: "success" } }),
  }),
  stages: object({
    snapshot: reference("stage-snapshot"),
    expected: object(
      {
        groups: { type: "array", items: strings },
        visible: strings,
        disabled: { type: "object", additionalProperties: boolean },
        linkDisabled: { type: "object", additionalProperties: boolean },
      },
      ["groups"],
    ),
  }),
  "build-scope": object({ page, expected: object({ allowed: boolean }) }),
  "build-enabled": object({ page, expected: boolean }),
  empty: object({ page, field }),
  "protected-choice": object({ page, field }),
  unchanged: object({ page, snapshot: reference("configuration-snapshot"), fields }),
} satisfies Record<Extract<BuildStep, { op: "assert" }>["check"], ParameterSchema>;
export const operationParameterSchemas = {
  "builder.open": object({}),
  "builder.read": object({ page: reference("builder-page") }),
  "builder.home": object({}),
  "platform.probe": object({}),
  "config.probe": object({ page, field }),
  "config.candidates": object({ page, field }),
  "config.select": object({ page, field, candidate: candidateMatchSchema }),
  "config.open": object({}),
  "config.close": object({ page }),
  "config.ready": object({ page }),
  "config.require": object({ page, expected: initial }),
  "config.expand": object({ page, section: { const: "network-timeout" } }),
  "config.prepare": object({ page, field, value }),
  record: object({ page, fields }),
  set: object({ page, field, value, input: { type: "string" } }, ["page", "field", "value"]),
  read: object(
    {
      page,
      fields,
      scope: { const: "build" },
      retained: reference("retained-baseline"),
      hidden: { ...strings, items: reference("hidden-assertion") },
    },
    ["page", "fields"],
  ),
  retain: object({ page, fields }),
  restore: object({ page, record: reference("configuration-record"), reopen: boolean }, [
    "page",
    "record",
  ]),
  assert: {
    oneOf: Object.entries(assertionParameterSchemas).map(([check, schema]) =>
      object({ check: { const: check }, ...schema.properties }, ["check", ...schema.required!]),
    ),
  },
  "input.google-icon": object({ page, file: value }),
  "input.openpaas-game": object({ page, value, requireChange: boolean }, ["page", "value"]),
  "input.cancel-file": object({ page, field }),
  "input.clear-field": object({ page, field }),
  "input.clear-scenes": object({ page }),
  "stage.record": object({ page }),
  "stage.read": object({ page }),
  "stage.link": object({ page, record: reference("stage-record"), previous: stage, stage }),
  "stage.unlink": object({ page, record: reference("stage-record"), group: stage, stage }),
  "stage.hint": object({
    page,
    control: { enum: ["button", "link", "unlink"] },
    stage,
    contains: text,
  }),
  "stage.restore": object({ page, record: reference("stage-record"), reopen: boolean }, [
    "page",
    "record",
  ]),
  "build.submit": object({ page, snapshot: reference("build-configuration-snapshot") }),
  "build.wait": object({ task: reference("unique-task-reference") }),
} satisfies Record<BuildStep["op"], ParameterSchema>;
