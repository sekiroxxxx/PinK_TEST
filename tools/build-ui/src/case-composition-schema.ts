const id = { type: "string", pattern: "^[a-zA-Z0-9][\\w.-]*$" };
const values = { type: "object", additionalProperties: true };
const strings = { type: "array", items: id, minItems: 1 };
const ref = (name: string) => ({ $ref: `#/$defs/${name}` });
const array = (name: string) => ({ type: "array", items: ref(name) });
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const use = object({ id, kind: { const: "use" }, fragmentId: id, arguments: values }, [
  "id",
  "kind",
  "fragmentId",
]);
const action = object({
  id,
  kind: { const: "action" },
  moduleId: { const: "pink-build" },
  operationId: id,
  inputs: values,
});
const target = {
  oneOf: [
    object({ kind: { const: "platform" }, id: {} }),
    object({ kind: { const: "builder" }, category: {} }),
  ],
};

/** Structural editor schema; binding resolution and native lifecycle validation stay in the assembler. */
export const caseCompositionSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  ...object(
    {
      kind: { const: "pink-case-composition" },
      schemaVersion: { const: 1 },
      sources: { type: "array", items: object({ id, document: { type: "object" } }) },
      fragments: array("fragment"),
      targets: { type: "array", items: { type: "object" } },
      nodes: array("node"),
    },
    ["kind", "schemaVersion", "sources", "fragments", "nodes"],
  ),
  $defs: {
    action,
    use,
    actionNode: { oneOf: [ref("action"), ref("use")] },
    node: { oneOf: [ref("use"), ref("group"), ref("caseRef"), ref("flow")] },
    group: object({ id, kind: { const: "group" }, nodes: array("node") }),
    caseRef: object(
      {
        id,
        kind: { const: "case-ref" },
        sourceId: id,
        caseId: id,
        endpoint: { const: "ui" },
        values,
        expectedValues: values,
        stepInputs: { type: "object", additionalProperties: values },
      },
      ["id", "kind", "sourceId", "caseId"],
    ),
    flow: object(
      {
        id,
        kind: { const: "flow" },
        target,
        onFailure: { enum: ["continue", "stop"] },
        before: array("actionNode"),
        steps: array("actionNode"),
        finally: array("actionNode"),
      },
      ["id", "kind", "target", "steps", "finally"],
    ),
    parameter: object(
      {
        kind: { enum: ["string", "number", "boolean", "array", "object", "output"] },
        default: {},
        references: { type: "array", items: { enum: ["material", "scene"] }, uniqueItems: true },
      },
      ["kind"],
    ),
    fragment: {
      oneOf: [
        object(
          {
            id,
            kind: { const: "nodes" },
            parameters: { type: "object", additionalProperties: ref("parameter") },
            nodes: array("node"),
          },
          ["id", "kind", "nodes"],
        ),
        object(
          {
            id,
            kind: { const: "actions" },
            parameters: { type: "object", additionalProperties: ref("parameter") },
            before: array("actionNode"),
            steps: array("actionNode"),
            finally: array("actionNode"),
          },
          ["id", "kind", "steps"],
        ),
      ],
    },
  },
};
export const compositionSelectionSchema = object({
  items: {
    type: "array",
    minItems: 1,
    items: object(
      {
        path: strings,
        instanceId: id,
        arguments: values,
        values,
        expectedValues: values,
        stepInputs: { type: "object", additionalProperties: values },
        steps: strings,
      },
      ["path"],
    ),
  },
});
