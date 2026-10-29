import { isDeepStrictEqual } from "node:util";
import { valueHash } from "./plan-integrity.js";
import { compileCatalogDocument } from "./catalog-to-steps.js";
import { validateConfigurationSteps } from "./configuration-steps-contract.js";
import { validateExecutableCatalog } from "./field-capabilities.js";
import { stepOperations } from "./step-operation-capabilities.js";
import type { BuildStep, BuildStepCase, BuildStepsDocument } from "./build-steps-contract.js";
import type { CatalogDocument } from "./case-contract.js";
import type { ConfigurationTarget } from "./configuration-targets.js";
import type { StepInputOptions } from "./step-inputs.js";
import { caseCompositionSchema, compositionSelectionSchema } from "./case-composition-schema.js";
import { compositionTemplates } from "./case-composition-templates.js";

export type CompositionValue = unknown;
export interface CompositionParameter {
  kind: "string" | "number" | "boolean" | "array" | "object" | "output";
  default?: CompositionValue;
  references?: Array<"material" | "scene">;
}
export interface CompositionAction {
  id: string;
  kind: "action";
  moduleId: "pink-build";
  operationId: BuildStep["op"];
  inputs: Record<string, CompositionValue>;
}
export interface CompositionUse {
  id: string;
  kind: "use";
  fragmentId: string;
  arguments?: Record<string, CompositionValue>;
}
export type CompositionActionNode = CompositionAction | CompositionUse;
export type CompositionNode =
  | CompositionUse
  | {
      id: string;
      kind: "group";
      nodes: CompositionNode[];
    }
  | {
      id: string;
      kind: "case-ref";
      sourceId: string;
      caseId: string;
      endpoint?: "ui";
      values?: Record<string, CompositionValue>;
      expectedValues?: Record<string, CompositionValue>;
      stepInputs?: Record<string, Record<string, CompositionValue>>;
    }
  | {
      id: string;
      kind: "flow";
      target:
        | { kind: "platform"; id: CompositionValue }
        | {
            kind: "builder";
            category: CompositionValue;
          };
      onFailure?: "continue" | "stop";
      before?: CompositionActionNode[];
      steps: CompositionActionNode[];
      finally: CompositionActionNode[];
    };
export type CompositionFragment = {
  id: string;
  parameters?: Record<string, CompositionParameter>;
} & (
  | { kind: "nodes"; nodes: CompositionNode[] }
  | {
      kind: "actions";
      before?: CompositionActionNode[];
      steps: CompositionActionNode[];
      finally?: CompositionActionNode[];
    }
);
export interface CaseComposition {
  kind: "pink-case-composition";
  schemaVersion: 1;
  sources: Array<{ id: string; document: unknown }>;
  fragments: CompositionFragment[];
  targets?: ConfigurationTarget[];
  nodes: CompositionNode[];
}
export interface CompositionSelection {
  items: Array<{
    path: string[];
    instanceId?: string;
    arguments?: Record<string, CompositionValue>;
    values?: Record<string, CompositionValue>;
    expectedValues?: Record<string, CompositionValue>;
    stepInputs?: Record<string, Record<string, CompositionValue>>;
    steps?: string[];
  }>;
}
export interface CompositionDiagnostic {
  severity: "error";
  code: string;
  message: string;
  nodeId?: string;
  instancePath: string[];
  phase: "definition" | "selection" | "expansion" | "native-validation" | "result";
  /** Relative to the instance node; omitted when the owning input cannot be proven. */
  inputPath?: Array<string | number>;
  missingReferences?: Array<{
    kind: "parameter" | "output";
    name?: string;
    instancePath?: string[];
  }>;
}
export interface CompositionOrigin {
  caseId: string;
  nodeId: string;
  instanceId: string;
  instancePath: string[];
  sourceId?: string;
  sourceCaseId?: string;
  steps: Array<{
    stepId: string;
    nodeId: string;
    instancePath: string[];
    phase: "before" | "steps" | "finally";
    sourceStepId?: string;
  }>;
}
export interface CaseAssembly {
  kind: "pink-case-assembly";
  schemaVersion: 1;
  definitionSha256: string;
  selectionSha256: string;
  documentSha256?: string;
  mappingSha256?: string;
  document?: BuildStepsDocument;
  caseIds: string[];
  willSubmit: boolean;
  sourceMap: CompositionOrigin[];
  diagnostics: CompositionDiagnostic[];
}

class CompositionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly path: string[] = [],
    readonly details: Pick<CompositionDiagnostic, "inputPath" | "missingReferences"> = {},
  ) {
    super(message);
  }
}
const object = (value: unknown, where: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CompositionError("shape", `${where} 必须是对象`);
  return value as Record<string, unknown>;
};
const keys = (value: object, allowed: string[], where: string) => {
  if (Object.keys(value).some((k) => !allowed.includes(k)))
    throw new CompositionError("shape", `${where} 含未支持属性`);
};
const identifier = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][\w.-]*$/.test(value))
    throw new CompositionError("identifier", "需要稳定的节点/实例标识符");
  return value;
};
const list = <T>(value: unknown, where: string): T[] => {
  if (!Array.isArray(value)) throw new CompositionError("shape", `${where} 必须是数组`);
  return value as T[];
};
const refKeys = [
  "page",
  "snapshot",
  "observation",
  "task",
  "result",
  "retained",
  "hidden",
  "observed",
  "record",
];
const outputMarker = Symbol("composition-output");
type OutputBinding = { [outputMarker]: true; path: string[] };
const isOutput = (value: unknown): value is OutputBinding =>
  !!value && typeof value === "object" && outputMarker in value;
type Bindings = Record<string, unknown>;
const pathKey = (path: string[]) => JSON.stringify(path);
const prefix = (path: string[], parent: string[]) => parent.every((part, i) => path[i] === part);

function bind(
  value: unknown,
  parameters: Bindings,
  scope: string[],
  inputPath: Array<string | number> = [],
  owner: string[] = [],
): unknown {
  if (Array.isArray(value))
    return value.map((v, index) => bind(v, parameters, scope, [...inputPath, index], owner));
  if (!value || typeof value !== "object") return value;
  if (isOutput(value)) return value;
  const raw = value as Record<string, unknown>;
  if (Object.hasOwn(raw, "$param")) {
    keys(raw, ["$param"], "参数引用");
    if (typeof raw.$param !== "string" || !Object.hasOwn(parameters, raw.$param))
      throw new CompositionError("parameter-missing", "参数引用不存在", owner, {
        inputPath,
        ...(typeof raw.$param === "string"
          ? { missingReferences: [{ kind: "parameter", name: raw.$param }] }
          : {}),
      });
    return parameters[raw.$param];
  }
  if (Object.hasOwn(raw, "$output")) {
    keys(raw, ["$output"], "输出引用");
    const relative =
      typeof raw.$output === "string" ? [raw.$output] : list<string>(raw.$output, "$output");
    if (!relative.length)
      throw new CompositionError("dependency", "输出引用路径不能为空", owner, { inputPath });
    relative.forEach(identifier);
    return { [outputMarker]: true, path: [...scope, ...relative] } satisfies OutputBinding;
  }
  if (Object.keys(raw).some((k) => k.startsWith("$") && !["$material", "$scene"].includes(k)))
    throw new CompositionError("reference", "不支持的输入引用；不能使用表达式或脚本");
  return Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, bind(v, parameters, scope, [...inputPath, k], owner)]),
  );
}

function argumentsFor(
  fragment: CompositionFragment,
  raw: unknown,
  parent: Bindings,
  scope: string[],
  owner: string[],
) {
  const supplied = raw === undefined ? {} : object(raw, "arguments");
  const declarations = fragment.parameters ?? {};
  const unknown = Object.keys(supplied).find((k) => !Object.hasOwn(declarations, k));
  if (unknown !== undefined)
    throw new CompositionError("parameter-unknown", "引用传入了未声明的参数", owner, {
      inputPath: ["arguments", unknown],
    });
  return Object.fromEntries(
    Object.entries(declarations).map(([name, spec]) => {
      identifier(name);
      keys(spec, ["kind", "default", "references"], "参数声明");
      if (!["string", "number", "boolean", "array", "object", "output"].includes(spec.kind))
        throw new CompositionError("parameter-type", "参数声明类型不支持");
      if (!Object.hasOwn(supplied, name) && !Object.hasOwn(spec, "default"))
        throw new CompositionError("parameter-missing", `缺少参数 ${name}`, owner, {
          inputPath: ["arguments", name],
          missingReferences: [{ kind: "parameter", name }],
        });
      const value = bind(
        Object.hasOwn(supplied, name) ? supplied[name] : spec.default,
        parent,
        scope,
        ["arguments", name],
        owner,
      );
      const reference: "material" | "scene" | undefined =
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).length === 1
          ? Object.hasOwn(value, "$material")
            ? "material"
            : Object.hasOwn(value, "$scene")
              ? "scene"
              : undefined
          : undefined;
      const valid = isOutput(value)
        ? spec.kind === "output"
        : reference
          ? spec.references?.includes(reference)
          : spec.kind === "array"
            ? Array.isArray(value)
            : spec.kind === "object"
              ? !!value && typeof value === "object" && !Array.isArray(value)
              : typeof value === spec.kind && (spec.kind !== "number" || Number.isFinite(value));
      if (!valid)
        throw new CompositionError("parameter-type", `参数 ${name} 的类型不符合声明`, owner, {
          inputPath: ["arguments", name],
        });
      return [name, value];
    }),
  );
}

function catalogEntries(catalog: CatalogDocument) {
  const entries: Array<{
    id: string;
    platform: string;
    combo?: string;
    variant?: number;
    scenario?: number;
  }> = [];
  for (const group of ["publish", "debug", "mixed"])
    for (const platform of catalog.platforms) {
      const combo = platform.combinations.find((c) => c.template === group)!;
      entries.push({ id: combo.id, platform: platform.id, combo: combo.id });
      combo.variants.forEach((_, index) =>
        entries.push({
          id: `${combo.id}.variant-${index + 1}`,
          platform: platform.id,
          combo: combo.id,
          variant: index,
        }),
      );
    }
  catalog.conditionalScenarios.forEach((s, scenario) =>
    s.representativePlatforms.forEach((platform) =>
      entries.push({
        id: s.representativePlatforms.length === 1 ? s.id : `${s.id}.${platform}`,
        platform,
        scenario,
      }),
    ),
  );
  for (const family of catalog.formValidation?.cases ?? [])
    for (const sample of family.samples)
      for (const platform of sample.platforms)
        entries.push({ id: `${sample.id}.${platform}`, platform });
  const order = catalog.executionOrder ?? [];
  return [
    ...order.flatMap((id) => entries.filter((c) => c.id === id)),
    ...entries.filter((c) => !order.includes(c.id)),
  ];
}

/** Pure authoring helper. No compilation, resource discovery, file access or PinK connection. */
export function createCaseComposition(
  document: unknown,
  options: { sourceId?: string } = {},
): CaseComposition {
  const sourceId = identifier(options.sourceId ?? "source");
  const raw = object(document, "原生文档");
  const native =
    raw.kind === "pink-configuration-steps"
      ? validateConfigurationSteps(raw)
      : validateExecutableCatalog(raw);
  const ids =
    "templates" in native
      ? catalogEntries(native).map((c) => c.id)
      : native.cases.map((c) => c.caseId);
  return {
    kind: "pink-case-composition",
    schemaVersion: 1,
    sources: [{ id: sourceId, document: structuredClone(native) }],
    fragments: [],
    nodes: ids.map((caseId, i) => ({ id: `case-${i + 1}`, kind: "case-ref", sourceId, caseId })),
  };
}

interface Unit {
  path: string[];
  node: Extract<CompositionNode, { kind: "flow" | "case-ref" }>;
  parameters: Bindings;
  scope: string[];
}
interface ActionInstance {
  path: string[];
  phase: "before" | "steps" | "finally";
  action: CompositionAction;
  parameters: Bindings;
  scope: string[];
}

/** A finite assembler over existing actions/cases, not a runtime workflow interpreter. */
export async function composeNativeCases(
  definition: unknown,
  selection?: CompositionSelection,
  options: StepInputOptions = {},
): Promise<CaseAssembly> {
  const result: CaseAssembly = {
    kind: "pink-case-assembly",
    schemaVersion: 1,
    definitionSha256: "",
    selectionSha256: "",
    caseIds: [],
    willSubmit: false,
    sourceMap: [],
    diagnostics: [],
  };
  const diagnostic = (error: unknown, path: string[], phase: CompositionDiagnostic["phase"]) => {
    const known = error instanceof CompositionError;
    const location = known && error.path.length ? error.path : path;
    result.diagnostics.push({
      severity: "error",
      code: known ? error.code : "native-contract",
      message: error instanceof Error ? error.message : "组装失败",
      nodeId: location.at(-1),
      instancePath: location,
      phase,
      ...(known ? error.details : {}),
    });
  };
  try {
    result.definitionSha256 = valueHash(definition);
    result.selectionSha256 = valueHash(selection ?? null);
    keys(options, ["project", "materials"], "options");
    if (Object.values(options).some((v) => v !== undefined && typeof v !== "string"))
      throw new CompositionError("options", "工程和材料位置须为字符串");
    const raw = object(definition, "definition");
    keys(raw, ["kind", "schemaVersion", "sources", "fragments", "targets", "nodes"], "definition");
    if (raw.kind !== "pink-case-composition" || raw.schemaVersion !== 1)
      throw new CompositionError("format", "仅支持 pink-case-composition/1");
    const doc = structuredClone(raw) as unknown as CaseComposition;
    const sources = new Map<string, unknown>(),
      fragments = new Map<string, CompositionFragment>();
    for (const source of list<CaseComposition["sources"][number]>(doc.sources, "sources")) {
      keys(source, ["id", "document"], "source");
      const id = identifier(source.id);
      if (sources.has(id)) throw new CompositionError("duplicate-source", "source id 重复");
      sources.set(id, source.document);
    }
    for (const fragment of list<CompositionFragment>(doc.fragments, "fragments")) {
      const id = identifier(fragment.id);
      keys(
        fragment,
        fragment.kind === "nodes"
          ? ["id", "kind", "parameters", "nodes"]
          : ["id", "kind", "parameters", "before", "steps", "finally"],
        "fragment",
      );
      if (fragments.has(id) || !["nodes", "actions"].includes(fragment.kind))
        throw new CompositionError("fragment", "片段类型错误或 id 重复");
      fragments.set(id, fragment);
    }
    const units: Unit[] = [];
    const enter = (
      id: string,
      kind: CompositionFragment["kind"],
      stack: string[],
      path: string[],
    ) => {
      const fragment = fragments.get(id);
      if (!fragment || fragment.kind !== kind)
        throw new CompositionError("fragment-missing", "引用片段不存在或类型不匹配", path);
      if (stack.includes(id))
        throw new CompositionError("reference-cycle", "片段存在循环引用", path);
      return fragment;
    };
    const walk = (
      nodes: CompositionNode[],
      parent: string[],
      parameters: Bindings,
      stack: string[],
    ) => {
      if (parent.length > 100) throw new CompositionError("depth", "分组/引用层级超过 100", parent);
      const ids = new Set<string>();
      for (const node of list<CompositionNode>(nodes, "nodes")) {
        const id = identifier(node.id),
          path = [...parent, id];
        if (ids.has(id)) throw new CompositionError("duplicate-node", "同级节点 id 重复", path);
        ids.add(id);
        if (node.kind === "group") {
          keys(node, ["id", "kind", "nodes"], "group");
          walk(node.nodes, path, parameters, stack);
        } else if (node.kind === "use") {
          keys(node, ["id", "kind", "fragmentId", "arguments"], "use");
          const fragment = enter(node.fragmentId, "nodes", stack, path) as Extract<
            CompositionFragment,
            { kind: "nodes" }
          >;
          walk(
            fragment.nodes,
            path,
            argumentsFor(fragment, node.arguments, parameters, parent, path),
            [...stack, fragment.id],
          );
        } else if (node.kind === "flow" || node.kind === "case-ref") {
          keys(
            node,
            node.kind === "flow"
              ? ["id", "kind", "target", "onFailure", "before", "steps", "finally"]
              : [
                  "id",
                  "kind",
                  "sourceId",
                  "caseId",
                  "endpoint",
                  "values",
                  "expectedValues",
                  "stepInputs",
                ],
            node.kind,
          );
          units.push({ path, node, parameters, scope: parent });
        } else throw new CompositionError("node-kind", "未支持的组装节点", path);
      }
    };
    walk(doc.nodes, [], {}, []);
    const items: CompositionSelection["items"] =
      selection === undefined
        ? units.map((u) => ({ path: u.path }))
        : list<CompositionSelection["items"][number]>(
            object(selection, "selection").items,
            "selection.items",
          );
    if (selection) keys(selection, ["items"], "selection");
    if (!items.length) throw new CompositionError("selection-empty", "本轮未选择任何用例");
    const selected: Array<{
      unit: Unit;
      item: CompositionSelection["items"][number];
      instanceId: string;
    }> = [];
    const instanceIds = new Set<string>();
    for (const item of items) {
      keys(
        item,
        ["path", "instanceId", "arguments", "values", "expectedValues", "stepInputs", "steps"],
        "selection item",
      );
      const path = list<string>(item.path, "selection.path");
      path.forEach(identifier);
      if (!path.length) throw new CompositionError("selection-missing", "选择路径不能为空");
      const matching = units.filter((u) => prefix(u.path, path));
      if (!matching.length)
        throw new CompositionError("selection-missing", "选择的节点或引用实例不存在", path);
      if (
        matching.length > 1 &&
        (item.instanceId ||
          item.steps ||
          item.values ||
          item.expectedValues ||
          item.stepInputs ||
          item.arguments)
      )
        throw new CompositionError(
          "selection-ambiguous",
          "参数和覆盖须指向一个完整操作链或用例引用",
          path,
        );
      for (const unit of matching) {
        const instanceId = identifier(
          item.instanceId ?? `instance-${valueHash(unit.path).slice(0, 20)}`,
        );
        if (instanceIds.has(instanceId))
          throw new CompositionError(
            "duplicate-instance",
            "实例被重复选择；重复运行须使用独立 instanceId",
            path,
          );
        instanceIds.add(instanceId);
        selected.push({ unit, item, instanceId });
      }
    }
    const cases: BuildStepCase[] = [],
      targets = new Map<string, ConfigurationTarget>();
    const addTargets = (values: ConfigurationTarget[] = []) => {
      for (const target of values) {
        if (targets.has(target.id) && !isDeepStrictEqual(targets.get(target.id), target))
          throw new CompositionError("target-conflict", "所选目标描述存在冲突");
        targets.set(target.id, structuredClone(target));
      }
    };
    addTargets(doc.targets);
    for (const { unit, item, instanceId } of selected) {
      try {
        const caseId = `case-${valueHash([unit.path, instanceId]).slice(0, 24)}`;
        const origin: CompositionOrigin = {
          caseId,
          nodeId: unit.node.id,
          instanceId,
          instancePath: unit.path,
          steps: [],
        };
        let native: BuildStepCase;
        const actions: ActionInstance[] = [];
        const parameters = { ...unit.parameters };
        for (const [name, value] of Object.entries(item.arguments ?? {})) {
          if (!Object.hasOwn(parameters, name))
            throw new CompositionError("parameter-unknown", "本轮覆盖了未声明参数", unit.path, {
              inputPath: ["arguments", name],
            });
          const bound = bind(value, {}, [], ["arguments", name], unit.path),
            original = parameters[name];
          if (
            isOutput(bound) ||
            isOutput(original) ||
            (Array.isArray(bound) ? !Array.isArray(original) : typeof bound !== typeof original)
          )
            throw new CompositionError("parameter-type", "本轮参数类型与引用实例不符", unit.path, {
              inputPath: ["arguments", name],
            });
          parameters[name] = bound;
        }
        if (unit.node.kind === "case-ref") {
          const reference = unit.node;
          if (item.steps)
            throw new CompositionError(
              "selection-atomic",
              "原生用例引用按完整前置和收尾执行；部分操作请建立显式 flow",
            );
          if (!sources.has(unit.node.sourceId))
            throw new CompositionError("source-missing", "原生用例来源不存在");
          origin.sourceId = unit.node.sourceId;
          origin.sourceCaseId = unit.node.caseId;
          const source = structuredClone(
            object(sources.get(unit.node.sourceId), "source document"),
          );
          const values = bind(
            { ...unit.node.values, ...item.values },
            parameters,
            unit.path,
            ["values"],
            unit.path,
          ) as Record<string, unknown>;
          const expected = bind(
            { ...unit.node.expectedValues, ...item.expectedValues },
            parameters,
            unit.path,
            ["expectedValues"],
            unit.path,
          ) as Record<string, unknown>;
          if (source.kind === "pink-configuration-steps") {
            const document = validateConfigurationSteps(source);
            addTargets(document.targets);
            const found = document.cases.find((c) => c.caseId === reference.caseId);
            if (!found) throw new CompositionError("case-missing", "原生步骤用例不存在");
            if (unit.node.endpoint)
              throw new CompositionError("endpoint", "步骤用例终点只能由原生步骤定义");
            if (document.schemaVersion === 1) {
              const c = found as (typeof document.cases)[number];
              const restore = c.steps.find((s) => s.op === "restore");
              native = {
                caseId,
                platform: c.platform,
                onFailure: c.onFailure,
                steps: [
                  { id: "assembly-open", op: "config.open" },
                  ...c.steps
                    .filter((s) => s.op !== "restore")
                    .map(
                      (s) =>
                        ({
                          ...s,
                          ...(["record", "set", "read"].includes(s.op)
                            ? { page: "assembly-open" }
                            : {}),
                        }) as BuildStep,
                    ),
                ],
                finally: [
                  { id: "assembly-cleanup", op: "config.open" },
                  ...(restore ? [{ ...restore, page: "assembly-cleanup" } as BuildStep] : []),
                  { id: "assembly-close", op: "config.close", page: "assembly-cleanup" },
                ],
              };
            } else native = structuredClone(found) as BuildStepCase;
            for (const [field, value] of Object.entries(values)) {
              const writes = native.steps.filter(
                (s) => (s.op === "set" || s.op === "config.prepare") && s.field === field,
              );
              if (!writes.length)
                throw new CompositionError("override-field", "覆盖字段没有已有赋值步骤");
              for (const step of writes)
                (step as Extract<BuildStep, { op: "set" }>).value = value as never;
            }
          } else {
            const catalog = structuredClone(validateExecutableCatalog(source));
            addTargets(catalog.targets);
            const entry = catalogEntries(catalog).find((c) => c.id === reference.caseId);
            if (!entry) throw new CompositionError("case-missing", "Catalog 用例不存在");
            if (Object.keys(values).length) {
              if (entry.combo) {
                const combo = catalog.platforms
                  .find((p) => p.id === entry.platform)!
                  .combinations.find((c) => c.id === entry.combo)!;
                Object.assign(
                  entry.variant === undefined ? combo.values : combo.variants[entry.variant].values,
                  values,
                );
                combo.excludedFields = combo.excludedFields?.filter(
                  (k) => !Object.hasOwn(values, k),
                );
                for (const key of Object.keys(values))
                  if (combo.fieldCoverage?.[key]) combo.fieldCoverage[key] = { state: "specified" };
              } else if (entry.scenario !== undefined)
                Object.assign(
                  (catalog.conditionalScenarios[entry.scenario].valuesByPlatform[entry.platform] ??=
                    {}),
                  values,
                );
              else
                throw new CompositionError(
                  "override-field",
                  "反向样本请在原生定义中修改输入，不能改写样本语义",
                );
            }
            const compilation = await compileCatalogDocument(catalog, {
              ...options,
              cases: unit.node.caseId,
              ...(unit.node.caseId.startsWith("FORM-") ? { groups: "conditional" } : {}),
              endpoint: unit.node.endpoint,
            });
            const chosen = compilation.cases.find((c) => c.caseId === reference.caseId);
            if (!chosen?.document)
              throw new CompositionError(
                "case-blocked",
                chosen?.gaps.map((g) => g.reason).join("；") || "Catalog 用例没有完整执行定义",
              );
            native = structuredClone(chosen.document.cases[0]);
          }
          for (const [field, value] of Object.entries({ ...values, ...expected })) {
            const assertions = native.steps.filter(
              (s) => s.op === "assert" && s.check === "values" && Object.hasOwn(s.values, field),
            );
            if (!assertions.length)
              throw new CompositionError(
                "override-assertion",
                "覆盖预期没有已有结构化断言；不能省略隐藏/专项断言",
              );
            for (const step of assertions)
              (step as Extract<BuildStep, { check: "values" }>).values[field] = value as never;
          }
          const overrides = { ...unit.node.stepInputs, ...item.stepInputs };
          for (const [stepId, inputs] of Object.entries(overrides)) {
            const step = [...native.steps, ...native.finally].find((s) => s.id === stepId);
            if (!step)
              throw new CompositionError("step-missing", "覆盖的步骤不存在", unit.path, {
                inputPath: ["stepInputs", stepId],
              });
            if (Object.keys(inputs).some((k) => ["id", "op"].includes(k)))
              throw new CompositionError("override-operation", "本轮输入覆盖不能改写操作身份");
            Object.assign(
              step,
              bind(inputs, parameters, unit.path, ["stepInputs", stepId], unit.path),
            );
          }
          native.caseId = caseId;
          for (const [phase, sequence] of [
            ["steps", native.steps],
            ["finally", native.finally],
          ] as const)
            for (const step of sequence)
              actions.push({
                path: [...unit.path, step.id],
                phase,
                action: {
                  id: step.id,
                  kind: "action",
                  moduleId: "pink-build",
                  operationId: step.op,
                  inputs: Object.fromEntries(
                    Object.entries(step).filter(([k]) => !["id", "op"].includes(k)),
                  ),
                },
                parameters: {},
                scope: unit.path,
              });
        } else {
          const flow = unit.node;
          const target = bind(flow.target, parameters, unit.scope, ["target"], unit.path) as {
            kind: string;
            id?: string;
            category?: "X-Device" | "X-Application";
          };
          if (!target || !["platform", "builder"].includes(target.kind))
            throw new CompositionError("target", "操作链缺少受支持目标");
          keys(
            target,
            target.kind === "platform" ? ["kind", "id"] : ["kind", "category"],
            "flow.target",
          );
          const cleanup: ActionInstance[][] = [];
          const expand = (
            nodes: CompositionActionNode[],
            scope: string[],
            parameters: Bindings,
            phase: ActionInstance["phase"],
            stack: string[],
          ) => {
            const ids = new Set<string>();
            for (const node of list<CompositionActionNode>(nodes, "actions")) {
              const id = identifier(node.id),
                path = [...scope, id];
              if (ids.has(id))
                throw new CompositionError("duplicate-node", "同级操作 id 重复", path);
              ids.add(id);
              if (node.kind === "action") {
                keys(node, ["id", "kind", "moduleId", "operationId", "inputs"], "action");
                actions.push({ path, phase, action: node, parameters, scope });
              } else if (node.kind === "use") {
                keys(node, ["id", "kind", "fragmentId", "arguments"], "action use");
                const fragment = enter(node.fragmentId, "actions", stack, path) as Extract<
                  CompositionFragment,
                  { kind: "actions" }
                >;
                const args = argumentsFor(fragment, node.arguments, parameters, scope, path),
                  next = [...stack, fragment.id];
                const cleanupStart = cleanup.length;
                expand(fragment.before ?? [], path, args, phase, next);
                expand(fragment.steps, path, args, phase, next);
                if (phase === "finally")
                  expand(fragment.finally ?? [], path, args, "finally", next);
                else {
                  const inner = cleanup.splice(cleanupStart).reverse().flat();
                  const prior = actions.length;
                  expand(fragment.finally ?? [], path, args, "finally", next);
                  cleanup.push([...inner, ...actions.splice(prior)]);
                }
              } else
                throw new CompositionError("node-kind", "操作链只允许 action 或操作片段引用", path);
            }
          };
          expand(flow.before ?? [], unit.path, parameters, "before", []);
          let steps = flow.steps;
          if (item.steps) {
            if (!item.steps.length || new Set(item.steps).size !== item.steps.length)
              throw new CompositionError("selection-steps", "操作选择不能为空或重复");
            steps = item.steps.map((id) => {
              const step = flow.steps.find((s) => s.id === id);
              if (!step) throw new CompositionError("step-missing", "选中的操作不存在");
              return step;
            });
          }
          expand(steps, unit.path, parameters, "steps", []);
          for (const block of cleanup.reverse()) actions.push(...block);
          expand(flow.finally, unit.path, parameters, "finally", []);
          const overrides = item.stepInputs ?? {};
          for (const [id, patch] of Object.entries(overrides)) {
            const matches = actions.filter((a) => a.action.id === id);
            if (matches.length !== 1)
              throw new CompositionError(
                "override-ambiguous",
                "操作覆盖须匹配一个唯一节点",
                unit.path,
                {
                  inputPath: ["stepInputs", id],
                },
              );
            if (Object.keys(patch).some((k) => ["id", "op"].includes(k)))
              throw new CompositionError("override-operation", "输入覆盖不能改写操作身份");
            matches[0].action = {
              ...matches[0].action,
              inputs: { ...matches[0].action.inputs, ...patch },
            };
          }
          native = {
            caseId,
            ...(target.kind === "platform"
              ? { platform: target.id }
              : { target: { kind: "builder", category: target.category! } }),
            onFailure: flow.onFailure,
            steps: [],
            finally: [],
          };
          if (item.values || item.expectedValues)
            throw new CompositionError(
              "override-field",
              "显式操作链使用声明参数或 stepInputs 覆盖，不推断赋值位置",
            );
        }
        const names = new Map<string, string>();
        for (const action of actions) {
          const key = pathKey(action.path);
          if (names.has(key))
            throw new CompositionError("duplicate-node", "操作和收尾节点路径重复", action.path);
          names.set(key, `step-${valueHash([caseId, action.path]).slice(0, 24)}`);
        }
        const resolveOutputs = (
          value: unknown,
          owner: string[],
          inputPath: Array<string | number>,
        ): unknown => {
          if (isOutput(value)) {
            const id = names.get(pathKey(value.path));
            if (!id)
              throw new CompositionError("dependency", "输出引用的节点未进入本轮操作链", owner, {
                inputPath,
                missingReferences: [{ kind: "output", instancePath: value.path }],
              });
            return id;
          }
          if (Array.isArray(value))
            return value.map((v, index) => resolveOutputs(v, owner, [...inputPath, index]));
          if (value && typeof value === "object")
            return Object.fromEntries(
              Object.entries(value).map(([k, v]) => [
                k,
                resolveOutputs(v, owner, [...inputPath, k]),
              ]),
            );
          return value;
        };
        const expanded: BuildStep[] = [];
        for (const instance of actions) {
          const action = instance.action;
          if (
            action.moduleId !== "pink-build" ||
            !Object.hasOwn(stepOperations, action.operationId)
          )
            throw new CompositionError(
              "unsupported-operation",
              "模块或操作未受支持",
              instance.path,
              { inputPath: [action.moduleId !== "pink-build" ? "moduleId" : "operationId"] },
            );
          const inputs = resolveOutputs(
            bind(
              object(action.inputs, "action.inputs"),
              instance.parameters,
              instance.scope,
              ["inputs"],
              instance.path,
            ),
            instance.path,
            ["inputs"],
          ) as Record<string, unknown>;
          if (Object.hasOwn(inputs, "id") || Object.hasOwn(inputs, "op"))
            throw new CompositionError("operation-inputs", "动作输入不能覆盖 id/op", instance.path);
          for (const key of refKeys) {
            if (!Object.hasOwn(inputs, key)) continue;
            const rename = (ref: unknown) =>
              (typeof ref === "string" && names.get(pathKey([...instance.scope, ref]))) || ref;
            inputs[key] = Array.isArray(inputs[key])
              ? (inputs[key] as unknown[]).map(rename)
              : rename(inputs[key]);
          }
          const step = {
            id: names.get(pathKey(instance.path))!,
            op: action.operationId,
            ...inputs,
          } as BuildStep;
          expanded.push(step);
          origin.steps.push({
            stepId: step.id,
            nodeId: action.id,
            instancePath: instance.path,
            phase: instance.phase,
            ...(unit.node.kind === "case-ref" ? { sourceStepId: action.id } : {}),
          });
        }
        native.steps = expanded.filter((_, i) => actions[i].phase !== "finally");
        native.finally = expanded.filter((_, i) => actions[i].phase === "finally");
        try {
          validateConfigurationSteps({
            kind: "pink-configuration-steps",
            schemaVersion: 2,
            targets: [...targets.values()],
            cases: [native],
          });
        } catch (error) {
          const position =
            error instanceof Error && /cases\[\d+\]\.(steps|finally)\[(\d+)\]/.exec(error.message);
          const step =
            position &&
            origin.steps.filter((s) =>
              position[1] === "finally" ? s.phase === "finally" : s.phase !== "finally",
            )[Number(position[2])];
          throw new CompositionError(
            "native-contract",
            error instanceof Error ? error.message : "原生步骤校验失败",
            step ? step.instancePath : unit.path,
          );
        }
        cases.push(native);
        result.sourceMap.push(origin);
      } catch (error) {
        diagnostic(error, unit.path, "native-validation");
      }
    }
    if (!result.diagnostics.length) {
      const document = validateConfigurationSteps({
        kind: "pink-configuration-steps",
        schemaVersion: 2,
        ...(targets.size ? { targets: [...targets.values()] } : {}),
        cases,
      }) as BuildStepsDocument;
      result.document = document;
      result.documentSha256 = valueHash(document);
      result.mappingSha256 = valueHash({
        documentSha256: result.documentSha256,
        definitionSha256: result.definitionSha256,
        selectionSha256: result.selectionSha256,
        sourceMap: result.sourceMap,
      });
      result.caseIds = document.cases.map((c) => c.caseId);
      result.willSubmit = document.cases.some((c) => c.steps.some((s) => s.op === "build.submit"));
    }
  } catch (error) {
    diagnostic(error, [], "definition");
  }
  if (result.diagnostics.length) {
    result.sourceMap = [];
    result.caseIds = [];
  }
  return result;
}

/** Results stay original; only proven case/step identities are associated back to instances. */
export function mapCompositionResults(assembly: CaseAssembly, result: unknown) {
  const raw = object(result, "result");
  if (
    !assembly.document ||
    assembly.diagnostics.length ||
    valueHash(assembly.document) !== assembly.documentSha256 ||
    raw.documentSha256 !== assembly.documentSha256 ||
    assembly.mappingSha256 !==
      valueHash({
        documentSha256: assembly.documentSha256,
        definitionSha256: assembly.definitionSha256,
        selectionSha256: assembly.selectionSha256,
        sourceMap: assembly.sourceMap,
      }) ||
    raw.kind !== "pink-configuration-steps-result" ||
    raw.schemaVersion !== 2
  )
    throw new CompositionError("result-identity", "结果不属于本次派生执行快照");
  const cases = list<Record<string, unknown>>(raw.cases, "result.cases"),
    seen = new Set<string>();
  return cases.map((result) => {
    const caseId = String(result.caseId),
      source = assembly.sourceMap.find((c) => c.caseId === caseId);
    if (!source || seen.has(caseId))
      throw new CompositionError("result-identity", "结果含未知或重复用例");
    seen.add(caseId);
    return {
      source: structuredClone(source),
      result: structuredClone(result),
      steps: list<Record<string, unknown>>(result.steps, "result.steps").map((step) => {
        const origin = source.steps.find((s) => s.stepId === step.stepId);
        const generated =
          (step.operation === "interruption" && step.stepId === "interruption") ||
          (step.operation === "build.wait" &&
            step.trigger === "cleanup" &&
            assembly
              .document!.cases.find((c) => c.caseId === caseId)!
              .steps.some(
                (s) =>
                  s.op === "build.submit" &&
                  new RegExp(`^${s.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.collectX*$`).test(
                    String(step.stepId),
                  ),
              ));
        if (!origin && !generated)
          throw new CompositionError("result-identity", "结果含未知执行步骤");
        return {
          source: origin
            ? structuredClone(origin)
            : { caseId, instancePath: source.instancePath, generatedCleanup: true },
          result: structuredClone(step),
        };
      }),
    };
  });
}

export function describeCaseComposition() {
  return {
    kind: "pink-case-composition-capabilities",
    schemaVersion: 1,
    runtimeVerified: false,
    schema: caseCompositionSchema,
    selectionSchema: compositionSelectionSchema,
    format: { kind: "pink-case-composition", schemaVersion: 1 },
    exports: ["createCaseComposition", "composeNativeCases", "mapCompositionResults"],
    nodeKinds: ["group", "case-ref", "flow", "use"],
    fragmentKinds: ["nodes", "actions"],
    moduleIds: ["pink-build"],
    operations: Object.keys(stepOperations),
    templates: structuredClone(compositionTemplates),
    templatePolicy: {
      parameterLocation: "nodePath-in-template-definition.nodes-then-inputPath",
      import: "copy-definition-and-namespace-conflicting-root-node-and-fragment-ids",
      fragmentReferences: "rewrite-use.fragmentId-when-renaming-a-fragment",
      parametersAreIndependent: true,
      candidateSource:
        "static-module-hints; current-target-description-and-runtime-checks-still-apply",
      execution: "configuration-checks-only-no-build-submit",
    },
    parameters: {
      kinds: ["string", "number", "boolean", "array", "object", "output"],
      references: ["$param", "$output", "$material", "$scene"],
      bindings: {
        parameter: { key: "$param", valueType: "string", scope: "declared-fragment-parameters" },
        output: {
          key: "$output",
          valueTypes: ["string", "array-of-node-ids"],
          relativeTo: "containing-action-scope",
          scope: "same-flow-instance",
          crossCase: false,
          fragmentArgumentKind: "output",
          value: "operation-node-reference-not-an-output-property-path",
        },
      },
    },
    selection: {
      items:
        "ordered array of {path, instanceId?, arguments?, values?, expectedValues?, stepInputs?, steps?}",
      path: "node IDs including each reference instance; group selects descendants",
      steps: "flow main steps only; before/finally always retained; native case-ref is atomic",
      rules: {
        caseRef: { atomic: true },
        flow: {
          selectableSection: "steps",
          selectableUnit: "direct-child-action-or-action-fragment",
          alwaysInclude: ["before", "finally"],
        },
        group: { selectsDescendants: true, overridesRequireSingleUnit: true },
        duplicatesRequireDistinctInstanceId: true,
      },
    },
    editableOverrides: {
      arguments: {
        location: "selection.items[].arguments",
        definitionLocation: "use.arguments",
        nodeKinds: ["flow", "case-ref"],
        requiresDeclaredParameter: true,
        typePolicy: "same-bound-value-type",
        offerReferenceKindExchange: false,
      },
      values: {
        locations: ["case-ref.values", "selection.items[].values"],
        nodeKinds: ["case-ref"],
        nativeSteps: "existing-set-or-prepare-and-values-assertion",
        catalog: "existing-compiler-supported-combination-or-scenario",
        formSamples: false,
      },
      expectedValues: {
        locations: ["case-ref.expectedValues", "selection.items[].expectedValues"],
        nodeKinds: ["case-ref"],
        requiresExistingValuesAssertion: true,
      },
      stepInputs: {
        locations: ["case-ref.stepInputs", "selection.items[].stepInputs"],
        nodeKinds: ["flow", "case-ref"],
        matches: "unique-action-id-or-native-source-step-id",
        protectedKeys: ["id", "op"],
      },
      semanticAuthority: "composeNativeCases-and-native-validator",
    },
    diagnostics: {
      fields: ["severity", "code", "message", "nodeId?", "instancePath", "phase"],
      optionalFields: ["inputPath", "missingReferences"],
      inputPath: "string-or-index-segments-relative-to-instance-node-or-run-override",
      missingReferences: {
        kinds: ["parameter", "output"],
        fields: ["kind", "name?", "instancePath?"],
        outputPath: "absolute-action-instance-path",
      },
      completeness: "known-binding-errors-only; native-lifecycle-errors-may-locate-the-whole-flow",
      phasePrecision: "coarse",
    },
    targets: [
      { kind: "platform", required: ["id"] },
      { kind: "builder", required: ["category"], categories: ["X-Device", "X-Application"] },
    ],
    publicUi: {
      supported: ["builder.open", "builder.read", "assert/builder-state", "builder.home"],
      controls: ["history", "build-all"],
      unsupported: [
        "arbitrary-click",
        "history.search",
        "history.filter",
        "history.records",
        "arbitrary-prompt",
      ],
    },
    execution:
      "assembled native v2 document runs as a whole through existing --file and --expected-plan",
    failure:
      "errors omit executable document; no implicit build, missing assertion removal or invented platform",
    hashes: {
      documentSha256: "result.documentSha256; native parsed document",
      mappingSha256: "sourceMap, document, definition and selection identities",
    },
    sourceMap: {
      case: ["caseId", "nodeId", "instanceId", "instancePath", "sourceId?", "sourceCaseId?"],
      step: ["stepId", "nodeId", "instancePath", "phase", "sourceStepId?"],
    },
    actionParameters:
      "describeNativeCaseCapabilities().fields.steps operations/assertions parameters",
  };
}
