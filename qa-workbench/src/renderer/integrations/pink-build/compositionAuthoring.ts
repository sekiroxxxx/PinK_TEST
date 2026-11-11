import type {
  CaseComposition,
  CompositionNode,
  CompositionActionNode,
  CompositionFragment,
  CompositionParameter,
  CompositionSelection,
  CompositionDiagnostic,
} from "@pink-build/case-composition";
import type { Mount } from "../../../shared/content";
import { contentSchema } from "../../../shared/content";
import {
  AuthoringValidationError,
  flatten,
  labelNodes,
  authoringTree,
  type AuthoringAdapter,
  type EditNode,
  type EditField,
  type EditAction,
} from "../../features/structured/authoring";
import type {
  ExecutionAdjustment,
  ExecutionOptions,
} from "../../features/automation/modules";
import { displayValue } from "../../features/structured/contract";
import type { ParameterSchema } from "../../features/structured/SchemaInput";
import {
  nativeFieldLabels,
  nativeFieldReferences,
  nativePlatformOptions,
  nativeOperationLabel,
  type NativeDescription,
} from "./nativeAuthoringAdapter";
import { standardTargets } from "./standardTargets";
import { nativeSettingParameter } from "./nativeStepRelations";

type Obj = Record<string, unknown>;
type Node = CompositionNode | CompositionActionNode;
type Template = {
  id: string;
  title: string;
  definition: CaseComposition;
  parameters?: {
    key: string;
    title: string;
    schema: ParameterSchema;
    candidates?: { value: string; label: string }[];
    nodePath: string[];
    inputPath: string[];
  }[];
};
export type CompositionDescription = {
  kind: string;
  schemaVersion: number;
  templates?: Template[];
};
type Located = {
  node: Node;
  list: Node[];
  path: string[];
  virtual: boolean;
  library: boolean;
  fragment?: CompositionFragment;
  preceding?: Node[];
  phase?: string;
  position?: number;
};
type Unit = {
  path: string[];
  node: Extract<CompositionNode, { kind: "case-ref" | "flow" }>;
  fields: EditField[];
};
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const scalar = (v: unknown) =>
  ["string", "number", "boolean"].includes(typeof v);
const flowTargetProperty = (target: Obj) =>
  target.kind === "platform"
    ? "id"
    : Object.hasOwn(target, "representativePlatform")
      ? "representativePlatform"
      : "category";
const platformParameterBindings = (nodes: CompositionNode[]): string[] =>
  nodes.flatMap((node) => {
    if (node.kind === "group") return platformParameterBindings(node.nodes);
    if (node.kind !== "flow") return [];
    const value =
      node.target.kind === "platform"
        ? node.target.id
        : obj(node.target).representativePlatform;
    const parameter = obj(value).$param;
    return typeof parameter === "string" ? [parameter] : [];
  });
const hasBindings = (value: unknown): boolean =>
  Array.isArray(value)
    ? value.some(hasBindings)
    : !!value &&
      typeof value === "object" &&
      (Object.hasOwn(value, "$param") ||
        Object.hasOwn(value, "$output") ||
        Object.values(value).some(hasBindings));
const fresh = (prefix: string) => prefix + "-" + crypto.randomUUID();
export const isComposition = (doc: Obj) => doc.kind === "pink-case-composition";
export const compositionNodeId = (path: string[]) =>
  JSON.stringify(["composition", "instance", ...path]);
const fragmentId = (id: string) =>
  JSON.stringify(["composition", "fragment", id]);
const rootId = JSON.stringify(["composition", "nodes"]);
const fragmentsId = JSON.stringify(["composition", "fragments"]);
const key = (...parts: string[]) => JSON.stringify(parts);
const scalarField = (id: string, label: string, value: unknown): EditField => ({
  key: id,
  label,
  value,
  control:
    typeof value === "boolean"
      ? "toggle"
      : typeof value === "number"
        ? "number"
        : "text",
});

export function compositionAuthoring(
  native: AuthoringAdapter,
  capabilities: NativeDescription,
  description: CompositionDescription,
  sources: Mount[],
) {
  const sourceKey = (source: Mount) =>
    "source-" + source.id + "-" + source.editor!.documentHash.slice(0, 12);
  const library = sources.filter(
    (source) =>
      source.editor?.moduleId === "pink-build" &&
      !isComposition(source.editor.document),
  );
  const templates = description.templates || [];
  const nativeLabels = nativeFieldLabels({});
  const targetEditor = standardTargets(
    key("composition", "targets"),
    capabilities.targetsSchema,
    nativeLabels,
  );
  const platformParameter = templates
    .flatMap((template) => template.parameters || [])
    .find(
      (parameter) => parameter.schema["x-reference"] === "platform-description",
    );
  const platformOptions = (doc: CaseComposition) =>
    nativePlatformOptions(
      { ...capabilities, composition: description },
      doc as unknown as Obj,
    );
  const platformReferences = (doc: CaseComposition) =>
    platformOptions(doc).map((option) => option.value);
  const fragmentTitle = (id: string, doc: CaseComposition) =>
    templates.find((t) =>
      t.definition.fragments.some(
        (f) => id === f.id || id.startsWith(f.id + "-"),
      ),
    )?.title || "公共片段 " + (doc.fragments.findIndex((f) => f.id === id) + 1);
  const parameterLabel = (name: string) =>
    name === "category"
      ? "旧分类（兼容）"
      : name.startsWith("value.")
        ? "设置 · " + (nativeLabels[name.slice(6)] || name.slice(6))
        : name.startsWith("expected.")
          ? "预期 · " + (nativeLabels[name.slice(9)] || name.slice(9))
          : nativeLabels[name] ||
            ({ expectedName: "预期名称" } as Record<string, string>)[name] ||
            name;
  function referenceValues(
    doc: CaseComposition,
    node: Extract<CompositionNode, { kind: "case-ref" }>,
  ) {
    const source = obj(
      doc.sources.find((item) => item.id === node.sourceId)?.document,
    );
    const values: Obj = {},
      expected: Obj = {};
    if (source.kind === "pink-configuration-steps") {
      const item = ((source.cases as Obj[]) || []).find(
        (item) => item.caseId === node.caseId,
      );
      for (const step of (item?.steps as Obj[]) || []) {
        if (
          ["set", "config.prepare"].includes(String(step.op)) &&
          typeof step.field === "string" &&
          scalar(step.value)
        )
          values[step.field] = step.value;
        if (step.op === "assert" && step.check === "values")
          Object.assign(expected, obj(step.values));
      }
    } else if (source.platforms && source.templates) {
      const target = flatten(native.tree(source)).find(
        (item) => item.definitionId === node.caseId,
      );
      for (const field of target?.fields || [])
        if (field.key.startsWith("value:") && scalar(field.value))
          values[field.key.slice(6)] = field.value;
      Object.assign(expected, values);
    }
    return { values, expected };
  }
  function referenceFields(
    doc: CaseComposition,
    node: Extract<CompositionNode, { kind: "case-ref" }>,
  ) {
    const original = referenceValues(doc, node);
    const fields: EditField[] = [];
    for (const name of Object.keys(original.values)) {
      if (!Object.hasOwn(original.expected, name)) continue;
      for (const [section, base, own] of [
        ["values", original.values, node.values],
        ["expectedValues", original.expected, node.expectedValues],
      ] as const) {
        const value =
          own?.[name] ??
          (section === "expectedValues" ? node.values?.[name] : undefined) ??
          base[name];
        fields.push({
          ...scalarField(
            key(section, name),
            (section === "values" ? "设置 · " : "预期 · ") +
              (nativeLabels[name] || name),
            value,
          ),
          section: section === "values" ? "设置值" : "独立预期",
          reset: Object.hasOwn(own || {}, name),
          origin: Object.hasOwn(own || {}, name) ? "当前引用覆盖" : "来源快照",
          ...(!scalar(value)
            ? {
                control: "readonly" as const,
                display: obj(value).$param
                  ? "由参数「" +
                    parameterLabel(String(obj(value).$param)) +
                    "」提供"
                  : displayValue(value),
              }
            : {}),
        });
      }
    }
    return fields;
  }
  function argumentFields(
    declarations: Record<string, CompositionParameter>,
    supplied: Obj,
    defaults: Obj = {},
  ) {
    return Object.entries(declarations).map(([name, spec]): EditField => {
      const value = Object.hasOwn(supplied, name)
        ? supplied[name]
        : Object.hasOwn(defaults, name)
          ? defaults[name]
          : spec.default;
      return {
        ...scalarField(key("arguments", name), parameterLabel(name), value),
        ...(value === undefined
          ? {
              control:
                spec.kind === "number"
                  ? ("number" as const)
                  : spec.kind === "boolean"
                    ? ("toggle" as const)
                    : ("text" as const),
            }
          : {}),
        ...(!["string", "number", "boolean"].includes(spec.kind) ||
        (value !== undefined && !scalar(value))
          ? {
              control: "readonly" as const,
              display: obj(value).$param
                ? "引用参数「" + String(obj(value).$param) + "」"
                : displayValue(value),
              help: "复杂引用保持模板原值，本轮暂不开放类型转换。",
            }
          : {}),
        reset: Object.hasOwn(supplied, name),
        origin: Object.hasOwn(supplied, name) ? "本实例参数" : "片段默认值",
        ...(() => {
          const hint = templates
            .flatMap((t) => t.parameters || [])
            .find((p) => p.key === name);
          return hint ? { label: hint.title, options: hint.candidates } : {};
        })(),
      };
    });
  }
  const order: EditAction[] = [
    { id: "up", label: "上移", secondary: true },
    { id: "down", label: "下移", secondary: true },
  ];
  function referenceOptions(source: Mount) {
    const options: { value: string; label: string; disabled?: boolean }[] = [],
      seen = new Set<string>();
    const visit = (nodes: EditNode[], path: string[]) =>
      nodes.forEach((node) => {
        const current = [...path, node.title];
        if (
          node.selectable &&
          node.definitionId &&
          !seen.has(node.definitionId)
        ) {
          seen.add(node.definitionId);
          options.push({
            value: key(source.id, node.definitionId),
            label: [source.name, ...current].join(" / "),
          });
        }
        visit(node.children || [], current);
      });
    visit(
      authoringTree(native, source.editor!.document, source.editor!.labels),
      [],
    );
    return options.length
      ? options
      : [
          {
            value: source.id,
            label: source.name + "（暂无可引用用例）",
            disabled: true,
          },
        ];
  }
  function referenceTitle(
    document: Obj,
    caseId: string,
    labels?: Record<string, string>,
  ) {
    let result: string[] | undefined;
    const visit = (nodes: EditNode[], path: string[]) => {
      for (const node of nodes) {
        if (result) return;
        const current = [...path, node.title];
        if (node.definitionId === caseId) result = current;
        else visit(node.children || [], current);
      }
    };
    visit(authoringTree(native, document, labels), []);
    return result?.slice(-3).join(" / ");
  }
  function insertActions(doc: CaseComposition): EditAction[] {
    const options = [...library]
      .sort(
        (a, b) =>
          Number(doc.sources.some((s) => s.id === sourceKey(b))) -
          Number(doc.sources.some((s) => s.id === sourceKey(a))),
      )
      .flatMap(referenceOptions);
    return [
      ...(platformParameter
        ? [
            {
              id: "add-flow",
              label: "新建操作链路",
              creates: true,
              schema: {
                type: "object",
                required: ["platform"],
                additionalProperties: false,
                properties: { platform: platformParameter.schema },
              },
              initial: { platform: platformReferences(doc)[0] || "" },
              labels: nativeLabels,
              references: { "platform-description": platformReferences(doc) },
              help: "选择或输入测试对象，再按顺序添加工具操作和收尾。可使用当前用例声明的新对象。",
            },
          ]
        : []),
      {
        id: "add-reference",
        label: "引用已有用例",
        creates: true,
        options,
        help: "插入已保存用例的完整引用及来源快照，保留其前置和收尾。",
      },
      { id: "add-group", label: "添加执行分组", creates: true },
      ...(doc.fragments.some((f) => f.kind === "nodes")
        ? [
            {
              id: "add-use",
              label: "引用公共片段",
              creates: true,
              options: doc.fragments
                .filter((f) => f.kind === "nodes")
                .map((f) => ({ value: f.id, label: f.id })),
            },
          ]
        : []),
      ...(templates.length
        ? [
            {
              id: "add-template",
              label: "添加工具模板",
              creates: true,
              options: templates.map((t) => ({ value: t.id, label: t.title })),
            },
          ]
        : []),
    ];
  }
  function project(doc: CaseComposition) {
    const locations = new Map<string, Located>(),
      units = new Map<string, Unit>();
    const associationCache = new Map<
      object,
      Map<string, EditNode["associations"]>
    >();
    const fragments = new Map(doc.fragments.map((f) => [f.id, f]));
    const sections = new Map<
      string,
      {
        flow: Extract<CompositionNode, { kind: "flow" }>;
        phase: "before" | "steps" | "finally";
        path: string[];
        library: boolean;
        virtual: boolean;
        fragment?: CompositionFragment;
      }
    >();
    function actionAssociations(
      scope: {
        id: string;
        before?: CompositionActionNode[];
        steps: CompositionActionNode[];
        finally?: CompositionActionNode[];
      },
      platform: string,
      path: string[],
      libraryView: boolean,
      fragment?: CompositionFragment,
    ) {
      const cached = associationCache.get(scope);
      if (cached) return cached;
      const linked = new Map<string, EditNode["associations"]>();
      associationCache.set(scope, linked);
      const groups: {
        action: Extract<CompositionActionNode, { kind: "action" }>;
        phase: string;
        position: number;
      }[][] = [[]];
      for (const phase of ["before", "steps", "finally"] as const)
        (scope[phase] || []).forEach((action, index) => {
          // Referenced actions may mutate the page; do not infer across them.
          if (action.kind === "use") groups.push([]);
          else groups.at(-1)!.push({ action, phase, position: index + 1 });
        });
      for (const group of groups.filter((group) => group.length)) {
        const actions = new Map(group.map((item) => [item.action.id, item]));
        // This projection is used only by the existing editor association logic.
        // Saved inputs, references and execution definitions are not converted.
        const projected = flatten(
          native.tree({
            kind: "pink-configuration-steps",
            schemaVersion: 2,
            targets: doc.targets,
            cases: [
              {
                caseId: scope.id,
                platform,
                steps: group.map(({ action }) => ({
                  ...action.inputs,
                  id: action.id,
                  op: action.operationId,
                  ...Object.fromEntries(
                    ["page", "snapshot"].flatMap((name) => {
                      const output = obj(action.inputs[name]).$output;
                      return typeof output === "string" ? [[name, output]] : [];
                    }),
                  ),
                })),
                finally: [],
              },
            ],
          }),
        );
        const nativeIds = new Map<string, string>();
        for (const node of projected) {
          const id = node.fields?.find((field) => field.key === "id")?.value;
          if (typeof id === "string" && actions.has(id))
            nativeIds.set(node.id, id);
        }
        for (const node of projected) {
          const actionId = nativeIds.get(node.id);
          if (!actionId || !node.associations?.length) continue;
          linked.set(
            actionId,
            node.associations.map((association) => ({
              ...association,
              id: key(
                "composition-association",
                ...path,
                group[0].action.id,
                association.id,
              ),
              fields: association.fields.map((cell) => {
                const source = actions.get(nativeIds.get(cell.nodeId)!)!;
                const setting = cell.field.key === "linked-setting";
                const phase =
                  source.phase === "before"
                    ? "必要前置"
                    : source.phase === "finally"
                      ? "收尾与恢复"
                      : "主步骤";
                const sourcePath = [...path, source.action.id];
                return {
                  nodeId: libraryView
                    ? key(
                        "composition",
                        "definition",
                        fragment!.id,
                        ...sourcePath,
                      )
                    : compositionNodeId(sourcePath),
                  source: `查看${phase}第 ${source.position} 项${setting ? "设置" : "预期"}`,
                  field: {
                    ...cell.field,
                    key: setting
                      ? key(
                          "input",
                          nativeSettingParameter({
                            op: source.action.operationId,
                          })!,
                        )
                      : key(
                          "expectation",
                          cell.field.key.slice("linked-expectation:".length),
                        ),
                    ...(hasBindings(cell.field.value)
                      ? {
                          control: "readonly" as const,
                          display: "由片段参数或前序输出提供",
                          help: "请在外层实例调整参数，引用关系保持工具模板定义。",
                        }
                      : {}),
                  },
                };
              }),
            })),
          );
        }
      }
      return linked;
    }
    const build = (
      list: Node[],
      path: string[],
      virtual = false,
      libraryView = false,
      environment: Obj = {},
      declarations: Record<string, CompositionParameter> = {},
      fragment?: CompositionFragment,
      stack: string[] = [],
      preceding: Node[] = [],
      orderScope = "",
    ): EditNode[] =>
      list.map((node) => {
        const p = [...path, node.id];
        const id = libraryView
          ? key("composition", "definition", fragment!.id, ...p)
          : compositionNodeId(p);
        locations.set(id, {
          node,
          list,
          path: p,
          virtual,
          library: libraryView,
          phase: orderScope,
          position: list.indexOf(node) + 1,
          fragment,
          preceding: [...preceding, ...list.slice(0, list.indexOf(node))],
        });
        const actions: EditAction[] = virtual
          ? []
          : [
              {
                id: "copy",
                label: node.kind === "use" ? "复制引用" : "复制节点",
                creates: true,
              },
              ...order,
              { id: "remove", label: "移除" },
            ];
        const result: EditNode = {
          id,
          title: node.id,
          actions,
          fields: [],
          nameable: !virtual,
          orderGroup: libraryView
            ? key("definition-order", fragment!.id, ...path, orderScope)
            : key("instance-order", ...path, orderScope),
        };
        if (node.kind === "group") {
          result.title = node.id.startsWith("template-")
            ? "工具模板"
            : "执行分组 " + (list.indexOf(node) + 1);
          result.children = build(
            node.nodes,
            p,
            virtual,
            libraryView,
            environment,
            declarations,
            fragment,
            stack,
          );
          if (!virtual) result.actions!.unshift(...insertActions(doc));
        } else if (node.kind === "use") {
          const f = fragments.get(node.fragmentId);
          const platformBindings = new Set(
            f?.kind === "nodes" ? platformParameterBindings(f.nodes) : [],
          );
          result.title = "引用 · " + fragmentTitle(node.fragmentId, doc);
          result.badge = "片段实例";
          result.note =
            "本实例参数只影响本次引用；编辑片段定义会影响使用该定义的实例。";
          result.fields = argumentFields(
            f?.parameters || {},
            obj(node.arguments),
          );
          for (const field of result.fields) {
            const name = (JSON.parse(field.key) as string[])[1];
            const hint = templates
              .flatMap((t) => t.parameters || [])
              .find((parameter) => parameter.key === name);
            if (hint) {
              field.label = hint.title;
              field.options =
                hint.schema["x-reference"] === "platform-description"
                  ? platformOptions(doc)
                  : hint.candidates;
            }
            if (platformBindings.has(name))
              field.options = platformOptions(doc);
          }
          result.actions!.unshift({
            id: "edit-fragment",
            label: "编辑片段定义",
          });
          if (f && !stack.includes(f.id) && stack.length < 50) {
            const bound = Object.fromEntries(
              Object.entries(f.parameters || {}).map(([name, spec]) => {
                const value = Object.hasOwn(node.arguments || {}, name)
                  ? node.arguments![name]
                  : spec.default;
                return [
                  name,
                  obj(value).$param
                    ? environment[String(obj(value).$param)]
                    : value,
                ];
              }),
            );
            result.children = build(
              f.kind === "nodes"
                ? f.nodes
                : [...(f.before || []), ...f.steps, ...(f.finally || [])],
              p,
              true,
              libraryView,
              bound,
              f.parameters || {},
              f,
              [...stack, f.id],
            );
          } else result.note = "片段缺失或存在循环引用，请核对片段定义。";
        } else if (node.kind === "case-ref") {
          const source = library.find(
            (source) => sourceKey(source) === node.sourceId,
          );
          const snapshot = doc.sources.find(
            (item) => item.id === node.sourceId,
          )?.document;
          const referenced = snapshot
            ? referenceTitle(
                snapshot as Obj,
                node.caseId,
                source?.editor?.labels,
              )
            : undefined;
          result.title = referenced
            ? [source?.name, referenced].filter(Boolean).join(" / ")
            : node.caseId.startsWith("case-")
              ? "独立用例副本"
              : node.caseId;
          result.badge = "完整引用";
          result.note =
            "整条引用执行，前置、核验和收尾均保留；配置覆盖不修改来源快照。";
          result.fields = referenceFields(doc, node);
          if (!libraryView) {
            result.selectable = true;
            result.definitionId = JSON.stringify(p);
            units.set(id, {
              path: p,
              node,
              fields: [
                ...argumentFields(declarations, {}, environment),
                ...result.fields,
              ],
            });
          }
        } else if (node.kind === "flow") {
          result.title =
            node.target.kind === "builder" ? "公共界面检查" : "配置操作链路";
          result.badge = node.target.kind === "builder" ? "模块级" : "操作链";
          const target = obj(node.target);
          const name =
            node.target.kind === "builder" ? "representativePlatform" : "id";
          const value = target[name];
          let targetField: EditField = {
            ...scalarField(
              key("target", name),
              node.target.kind === "builder" ? "代表平台" : "测试对象",
              value ?? "",
            ),
            ...(value === undefined || scalar(value)
              ? { options: platformOptions(doc) }
              : {}),
            ...(value !== undefined && !scalar(value)
              ? {
                  control: "readonly" as const,
                  display: "由参数「" + String(obj(value).$param) + "」提供",
                }
              : {}),
            ...(node.target.kind === "builder"
              ? {
                  help: "通过代表平台定位构建主页，不打开平台配置页。选择后替换旧分类写法。",
                }
              : {}),
          };
          const targetHint = templates
            .flatMap((t) => t.parameters || [])
            .find(
              (hint) =>
                hint.nodePath.at(-1) === node.id &&
                hint.inputPath.join(".") === `target.${name}`,
            );
          if (targetHint && (value === undefined || scalar(value)))
            targetField = {
              key: key("target", name),
              label: targetHint.title,
              value: value ?? "",
              control: "schema",
              schema: {
                ...targetHint.schema,
                "x-reference": "platform-description",
              },
              references: { "platform-description": platformReferences(doc) },
              help: targetField.help,
            };
          result.fields = [
            ...(node.target.kind === "builder" &&
            !Object.hasOwn(target, "representativePlatform") &&
            Object.hasOwn(target, "category")
              ? [
                  {
                    key: key("legacyTarget"),
                    label: "旧分类（兼容）",
                    value: target.category,
                    control: "readonly" as const,
                    display: scalar(target.category)
                      ? String(target.category)
                      : "由参数「" +
                        String(obj(target.category).$param) +
                        "」提供",
                  },
                ]
              : []),
            targetField,
          ];
          result.children = (["before", "steps", "finally"] as const).map(
            (phase) => {
              const sectionId = key(
                "composition",
                "section",
                ...(libraryView ? [fragment!.id] : []),
                ...p,
                phase,
              );
              sections.set(sectionId, {
                flow: node,
                phase,
                path: p,
                library: libraryView,
                virtual,
                fragment,
              });
              const options = capabilities.fields.steps.operations
                .filter(
                  (operation) =>
                    operation.targetKinds?.includes(node.target.kind) &&
                    operation.allowedPhases?.includes(phase),
                )
                .flatMap((operation) =>
                  operation.op === "assert"
                    ? capabilities.fields.steps.assertions
                        .filter(
                          (assertion) =>
                            assertion.targetKinds?.includes(node.target.kind) &&
                            assertion.allowedPhases?.includes(phase),
                        )
                        .map((assertion) => ({
                          value: JSON.stringify({
                            op: operation.op,
                            check: assertion.check,
                          }),
                          label: nativeOperationLabel(
                            operation.op,
                            assertion.check,
                          ),
                        }))
                    : [
                        {
                          value: JSON.stringify({ op: operation.op }),
                          label: nativeOperationLabel(operation.op),
                        },
                      ],
                );
              return {
                id: sectionId,
                title:
                  phase === "before"
                    ? "必要前置"
                    : phase === "finally"
                      ? "收尾与恢复"
                      : "主步骤",
                selectable: false,
                actions:
                  !virtual && options.length
                    ? [
                        {
                          id: "add-operation",
                          label: "添加工具步骤",
                          creates: true,
                          options,
                          help: "选择工具声明的动作，填写参数后由模块核对依赖与收尾。",
                        },
                      ]
                    : [],
                children: build(
                  node[phase] || [],
                  p,
                  virtual,
                  libraryView,
                  environment,
                  declarations,
                  fragment,
                  stack,
                  phase === "before"
                    ? []
                    : phase === "steps"
                      ? node.before || []
                      : [...(node.before || []), ...node.steps],
                  phase,
                ),
              };
            },
          );
          if (!libraryView) {
            result.selectable = true;
            result.definitionId = JSON.stringify(p);
            units.set(id, {
              path: p,
              node,
              fields: argumentFields(declarations, {}, environment),
            });
          }
        } else if (node.kind === "action") {
          const enclosing = [...locations.values()]
            .filter(
              (item) =>
                item.node.kind === "flow" &&
                item.path.length < p.length &&
                item.path.every((part, index) => p[index] === part),
            )
            .sort((a, b) => b.path.length - a.path.length)[0];
          const flowTarget =
            enclosing?.node.kind === "flow" ? enclosing.node.target : undefined;
          const rawTarget =
            flowTarget?.kind === "platform" ? flowTarget.id : undefined;
          const targetId =
            typeof rawTarget === "string"
              ? rawTarget
              : String(environment[String(obj(rawTarget).$param)] || "");
          const references = {
            "field-description": nativeFieldReferences(
              capabilities,
              doc as unknown as Obj,
              targetId,
            ),
          };
          const fieldLabels = nativeFieldLabels(
            doc as unknown as Obj,
            targetId,
          );
          result.title = nativeOperationLabel(
            node.operationId,
            String(node.inputs.check || ""),
          );
          const operation = capabilities.fields.steps.operations.find(
            (op) => op.op === node.operationId,
          );
          const schema =
            node.operationId === "assert"
              ? capabilities.fields.steps.assertions.find(
                  (a) => a.check === node.inputs.check,
                )?.parameters
              : operation?.parameters;
          const properties = schema?.properties || {};
          const referenceRules =
            node.operationId === "assert"
              ? capabilities.fields.steps.assertions.find(
                  (a) => a.check === node.inputs.check,
                )?.references
              : operation?.references;
          result.fields = [
            ...new Set([
              ...(schema?.required || []),
              ...Object.keys(node.inputs),
            ]),
          ].map((name): EditField => {
            const value = node.inputs[name],
              binding = obj(value);
            const spec = properties[name] || {};
            const reference = referenceRules?.find(
              (rule) =>
                rule.inputPath.length === 1 &&
                rule.inputPath[0] === name &&
                rule.source === "step-output",
            );
            if (reference && !binding.$param) {
              const candidates = [
                ...preceding,
                ...list.slice(0, list.indexOf(node)),
              ].filter(
                (previous) =>
                  previous.kind === "action" &&
                  reference.producers.some(
                    (producer) =>
                      producer.operationId === previous.operationId &&
                      Object.entries(producer.when || {}).every(
                        ([key, value]) => previous.inputs[key] === value,
                      ),
                  ),
              );
              return {
                key: key("binding", name),
                label: nativeLabels[name] || name,
                value: value === undefined ? undefined : JSON.stringify(value),
                control: "select",
                options: candidates.map((previous) => {
                  const producer = [...locations].find(
                    ([, location]) =>
                      location.node === previous &&
                      location.library === libraryView &&
                      location.virtual === virtual &&
                      location.fragment?.id === fragment?.id &&
                      location.path.length === p.length &&
                      location.path
                        .slice(0, -1)
                        .every((part, index) => part === p[index]),
                  );
                  const location = producer?.[1];
                  const phase =
                    location?.phase === "finally"
                      ? "收尾与恢复"
                      : location?.phase === "before"
                        ? "必要前置"
                        : location?.phase === "steps"
                          ? "主步骤"
                          : "前序";
                  return {
                    value: JSON.stringify({ $output: previous.id }),
                    relatedNode: producer?.[0],
                    label: `${phase}${location?.position ? " · " + location.position : ""} · ${
                      previous.kind === "action"
                        ? nativeOperationLabel(
                            previous.operationId,
                            String(previous.inputs.check || ""),
                          )
                        : previous.id
                    }`,
                  };
                }),
                help: "仅列出当前操作链内、位于此前且类型符合模块描述的输出。",
              };
            }
            if (binding.$param || binding.$output)
              return {
                key: key("input", name),
                label: nativeLabels[name] || name,
                value,
                control: "readonly",
                display: binding.$param
                  ? "参数 · " + parameterLabel(String(binding.$param))
                  : "前序输出 · " + String(binding.$output),
              };
            if (hasBindings(value))
              return {
                key: key("input", name),
                label: nativeLabels[name] || name,
                value,
                control: "readonly",
                display: "由片段参数或前序输出提供",
                help: "请在外层实例调整参数，引用关系保持工具模板定义。",
              };
            return {
              key: key("input", name),
              label: nativeLabels[name] || name,
              value,
              control: "schema",
              schema: spec as ParameterSchema,
              labels: fieldLabels,
              references,
            };
          });
          const scope =
            enclosing?.node.kind === "flow"
              ? enclosing.node
              : libraryView && fragment?.kind === "actions"
                ? fragment
                : undefined;
          if (!virtual && scope)
            result.associations = actionAssociations(
              scope,
              targetId,
              p.slice(0, -1),
              libraryView,
              fragment,
            ).get(node.id);
          result.note = "参数与动作来自工具合同，依赖和收尾由模块校验。";
        }
        if (
          !virtual &&
          !libraryView &&
          ["case-ref", "flow"].includes(node.kind)
        )
          result.actions!.push({
            id: "save-fragment",
            label: "存为公共片段",
            secondary: true,
          });
        if (
          !libraryView &&
          ["case-ref", "flow", "use"].includes(node.kind) &&
          !virtual
        )
          result.actions!.push({
            id: "independent",
            label: "创建独立副本",
            secondary: true,
            creates: true,
            help: "由工具生成完整原生快照，副本与原片段解除共享。",
          });
        if (virtual) {
          result.fields = result.fields?.map((field) => ({
            ...field,
            control: "readonly",
            display: field.display || displayValue(field.value),
          }));
          result.note =
            "引用内容只读。选中外层实例修改参数，或从外层实例进入片段定义编辑。";
        }
        return result;
      });
    const tree: EditNode[] = [
      {
        id: rootId,
        title: "执行编排",
        selectable: false,
        actions: insertActions(doc),
        children: build(doc.nodes, []),
      },
    ];
    tree.push({
      id: fragmentsId,
      title: "公共片段",
      selectable: false,
      note: "在执行项的更多操作中可存为公共片段。修改定义影响引用实例，独立副本保持不变。",
      children: doc.fragments.map((fragment): EditNode => ({
        id: fragmentId(fragment.id),
        title: fragmentTitle(fragment.id, doc),
        nameable: true,
        fields: Object.entries(fragment.parameters || {}).map(
          ([name, spec]) => ({
            ...scalarField(
              key("default", name),
              "默认 · " + parameterLabel(name),
              spec.default,
            ),
            ...(spec.default === undefined
              ? {
                  control:
                    spec.kind === "boolean"
                      ? ("toggle" as const)
                      : spec.kind === "number"
                        ? ("number" as const)
                        : ("text" as const),
                }
              : {}),
            ...(!["string", "number", "boolean"].includes(spec.kind)
              ? {
                  control: "readonly" as const,
                  help: "复杂参数保持现有类型与引用。",
                }
              : {}),
            ...(!scalar(spec.default) && spec.default !== undefined
              ? { control: "readonly" as const }
              : {}),
          }),
        ),
        children:
          fragment.kind === "nodes"
            ? build(
                fragment.nodes,
                [],
                false,
                true,
                {},
                fragment.parameters,
                fragment,
              )
            : (["before", "steps", "finally"] as const).map((phase) => ({
                id: key("composition", "fragment-section", fragment.id, phase),
                title:
                  phase === "before"
                    ? "必要前置"
                    : phase === "finally"
                      ? "收尾与恢复"
                      : "主步骤",
                children: build(
                  fragment[phase] || [],
                  [],
                  false,
                  true,
                  {},
                  fragment.parameters,
                  fragment,
                  [],
                  phase === "before"
                    ? []
                    : phase === "steps"
                      ? fragment.before || []
                      : [...(fragment.before || []), ...fragment.steps],
                  phase,
                ),
              })),
      })),
    });
    if (capabilities.targetsSchema)
      tree.push(targetEditor.tree(doc as unknown as Obj));
    return { tree, locations, units, sections };
  }
  function displayLabels(
    raw: Obj,
    labels: Record<string, string>,
    graph?: ReturnType<typeof project>,
  ) {
    if (!isComposition(raw))
      return native.displayLabels?.(raw, labels) || labels;
    graph ||= project(raw as unknown as CaseComposition);
    const result = { ...labels };
    const definitionLabels = new Map<Node, string>();
    for (const [id, location] of graph.locations)
      if (location.library && !location.virtual && labels[id])
        definitionLabels.set(location.node, labels[id]);
    for (const [id, location] of graph.locations) {
      if (result[id]) continue;
      if (location.virtual && definitionLabels.has(location.node))
        result[id] = definitionLabels.get(location.node)!;
      else if (
        location.node.kind === "use" &&
        labels[fragmentId(location.node.fragmentId)]
      )
        result[id] = "引用 · " + labels[fragmentId(location.node.fragmentId)];
    }
    return result;
  }
  function presentation(
    raw: Obj,
    labels: Record<string, string>,
    adjustments: Record<string, ExecutionAdjustment> = {},
  ) {
    const caseLabels: Record<string, string> = {};
    if (isComposition(raw)) {
      const doc = raw as unknown as CaseComposition;
      const graph = project(doc);
      const names = new Map(
        flatten(labelNodes(graph.tree, displayLabels(raw, labels, graph))).map(
          (node) => [node.id, node.title],
        ),
      );
      for (const [id, unit] of graph.units) {
        const parts: string[] = [];
        for (let length = 1; length < unit.path.length; length++) {
          const parentId = compositionNodeId(unit.path.slice(0, length));
          if (graph.locations.get(parentId)?.node.kind === "use")
            parts.push(names.get(parentId) || "片段实例");
        }
        const title = names.get(id) || "组合执行项";
        if (!parts.includes(title)) parts.push(title);
        const bound = (value: unknown) => {
          if (!obj(value).$param) return value;
          const fieldKey = key("arguments", String(obj(value).$param));
          return Object.hasOwn(adjustments[id]?.fields || {}, fieldKey)
            ? adjustments[id].fields![fieldKey]
            : unit.fields.find((field) => field.key === fieldKey)?.value;
        };
        let target = "";
        if (unit.node.kind === "flow") {
          const targetDescription = obj(unit.node.target);
          const value = bound(
            targetDescription[flowTargetProperty(targetDescription)],
          );
          if (scalar(value)) {
            const declared = (doc.targets || []).find(
              (item) => item.id === value,
            );
            const candidate = templates
              .flatMap((template) => template.parameters || [])
              .flatMap((parameter) => parameter.candidates || [])
              .find((item) => item.value === value);
            target = declared?.label || candidate?.label || String(value);
          }
        }
        caseLabels[JSON.stringify(unit.path)] =
          parts.join(" / ") + (target ? " · " + target : "");
      }
    }
    return { nodeLabels: { ...labels }, caseLabels };
  }
  async function assemble(
    doc: CaseComposition,
    selection?: CompositionSelection,
  ) {
    return (await window.qa.authorAutomation({
      moduleId: "pink-build",
      action: "compose",
      definition: doc as unknown as Obj,
      ...(selection ? { selection } : {}),
    })) as unknown as { document?: Obj; diagnostics: CompositionDiagnostic[] };
  }
  async function validateDefinition(
    doc: CaseComposition,
    selection?: CompositionSelection,
  ) {
    const result = await window.qa.authorAutomation({
      moduleId: "pink-build",
      action: "validateComposition",
      definition: doc as unknown as Obj,
      ...(selection ? { selection } : {}),
    });
    if (
      typeof result.valid !== "boolean" ||
      result.contextChecked !== false ||
      !Array.isArray(result.diagnostics)
    )
      throw new Error("工具未返回有效的组合定义校验，未保存或生成计划。");
    return result.diagnostics as CompositionDiagnostic[];
  }
  function diagnose(
    doc: CaseComposition,
    diagnostics: CompositionDiagnostic[],
  ) {
    if (!diagnostics.length) return;
    const first = diagnostics[0],
      graph = project(doc),
      nodes = flatten(graph.tree);
    let path = [...first.instancePath],
      selected = compositionNodeId(path);
    while (path.length && !nodes.some((node) => node.id === selected)) {
      path.pop();
      selected = compositionNodeId(path);
    }
    const current = nodes.find((node) => node.id === selected);
    const field = first.inputPath?.flatMap((part) =>
      (current?.fields || []).filter((field) => {
        try {
          return (JSON.parse(field.key) as string[]).at(-1) === String(part);
        } catch {
          return false;
        }
      }),
    )[0]?.key;
    throw new AuthoringValidationError(
      {
        node: nodes.some((node) => node.id === selected) ? selected : rootId,
        message: first.message,
        field,
      },
      diagnostics
        .map(
          (d) =>
            `${d.instancePath.join(" / ") || "编排"}：${d.message}（${d.code}）${d.inputPath?.length ? "；参数：" + d.inputPath.join(" / ") : ""}`,
        )
        .join("\n"),
    );
  }
  const adapter: AuthoringAdapter = {
    ...native,
    displayLabels,
    async checkCompatibility(original) {
      if (!isComposition(original.document))
        return native.checkCompatibility?.(original);
      await adapter.validate(original.document);
    },
    tree(raw) {
      return isComposition(raw)
        ? project(raw as unknown as CaseComposition).tree
        : native.tree(raw);
    },
    recover(original, mountId) {
      return isComposition(original.document)
        ? original.document
        : native.recover(original, mountId);
    },
    async validate(raw) {
      if (!isComposition(raw)) return native.validate(raw);
      const doc = raw as unknown as CaseComposition,
        result = await validateDefinition(doc);
      const diagnostics = !project(doc).units.size
        ? result.filter((d) => d.code !== "selection-empty")
        : result;
      diagnose(doc, diagnostics);
    },
    async apply(raw, command) {
      if (!isComposition(raw)) return native.apply(raw, command);
      const doc = structuredClone(raw) as unknown as CaseComposition,
        graph = project(doc),
        located = graph.locations.get(command.node);
      const targetChange = targetEditor.apply(doc as unknown as Obj, command);
      if (targetChange) return targetChange;
      if (command.action === "edit-fragment" && located?.node.kind === "use")
        return {
          document: doc as unknown as Obj,
          selection: fragmentId(located.node.fragmentId),
        };
      if (
        command.node === key("composition", "targets") &&
        command.action === "set"
      ) {
        doc.targets = command.value as CaseComposition["targets"];
        return { document: doc as unknown as Obj };
      }
      if (command.action === "set" || command.action === "reset") {
        const parts = JSON.parse(command.key || "[]") as string[],
          [kind, name] = parts;
        const definition = doc.fragments.find(
          (f) => fragmentId(f.id) === command.node,
        );
        if (definition && kind === "default") {
          if (command.action === "reset")
            delete definition.parameters![name].default;
          else definition.parameters![name].default = command.value;
        } else {
          if (!located || located.virtual)
            throw new Error("请在外层实例修改参数，或编辑片段定义。");
          const n = located.node;
          if (kind === "arguments" && n.kind === "use") {
            n.arguments ||= {};
            if (command.action === "reset") delete n.arguments[name];
            else n.arguments[name] = command.value;
          } else if (
            (kind === "values" || kind === "expectedValues") &&
            n.kind === "case-ref"
          ) {
            if (
              kind === "values" &&
              !Object.hasOwn(n.expectedValues || {}, name)
            ) {
              n.expectedValues ||= {};
              n.expectedValues[name] =
                n.values?.[name] ?? referenceValues(doc, n).expected[name];
            }
            n[kind] ||= {};
            if (command.action === "reset") delete n[kind]![name];
            else n[kind]![name] = command.value;
          } else if (kind === "binding" && n.kind === "action") {
            n.inputs[name] = JSON.parse(String(command.value));
          } else if (kind === "input" && n.kind === "action") {
            n.inputs[name] = command.value;
          } else if (
            kind === "expectation" &&
            n.kind === "action" &&
            n.operationId === "assert" &&
            n.inputs.check === "values"
          ) {
            const expected = obj(n.inputs.values);
            if (!Object.hasOwn(expected, name))
              throw new Error("关联预期已变化，请重新选择该步骤。");
            n.inputs.values = { ...expected, [name]: command.value };
          } else if (kind === "target" && n.kind === "flow") {
            (n.target as unknown as Obj)[name] = command.value;
            if (
              n.target.kind === "builder" &&
              name === "representativePlatform"
            )
              delete (n.target as unknown as Obj).category;
          } else throw new Error("该字段不支持修改，原内容保留。");
        }
        return { document: doc as unknown as Obj };
      }
      const parent =
        located?.node.kind === "group"
          ? located.node.nodes
          : command.node === rootId
            ? doc.nodes
            : located?.list;
      if (command.action === "add-operation") {
        const section = graph.sections.get(command.node);
        if (!section || section.virtual)
          throw new Error("请选择可编辑的步骤分组。");
        const choice = JSON.parse(String(command.value)) as {
          op: string;
          check?: string;
        };
        const operation = capabilities.fields.steps.operations.find(
          (operation) => operation.op === choice.op,
        );
        const assertion = choice.check
          ? capabilities.fields.steps.assertions.find(
              (a) => a.check === choice.check,
            )
          : undefined;
        if (
          !operation?.targetKinds?.includes(section.flow.target.kind) ||
          !operation.allowedPhases?.includes(section.phase) ||
          (choice.op === "assert" &&
            (!assertion?.targetKinds?.includes(section.flow.target.kind) ||
              !assertion.allowedPhases?.includes(section.phase)))
        )
          throw new Error("工具未声明当前目标和阶段支持该操作。");
        const action: CompositionActionNode = {
          id: fresh("step"),
          kind: "action",
          moduleId: "pink-build",
          operationId: choice.op as Extract<
            CompositionActionNode,
            { kind: "action" }
          >["operationId"],
          inputs: choice.check ? { check: choice.check } : {},
        };
        (section.flow[section.phase] ||= []).push(action);
        const path = [...section.path, action.id];
        return {
          document: doc as unknown as Obj,
          selection: section.library
            ? key("composition", "definition", section.fragment!.id, ...path)
            : compositionNodeId(path),
        };
      }
      if (command.action.startsWith("add-")) {
        if (!parent || located?.virtual)
          throw new Error("请选择执行编排或可编辑分组。");
        let node: CompositionNode;
        if (command.action === "add-flow") {
          const platform = obj(command.value).platform;
          if (typeof platform !== "string" || !platform.trim())
            throw new Error("请填写或选择测试对象。");
          node = {
            id: fresh("flow"),
            kind: "flow",
            target: { kind: "platform", id: platform },
            before: [],
            steps: [],
            finally: [],
          };
        } else if (command.action === "add-group")
          node = { id: fresh("group"), kind: "group", nodes: [] };
        else if (command.action === "add-reference") {
          const [sourceId, caseId] = JSON.parse(
            String(command.value),
          ) as string[];
          const source = library.find((source) => source.id === sourceId);
          if (!source) throw new Error("用例来源已变化，请重新选择。");
          const id = sourceKey(source);
          if (!doc.sources.some((item) => item.id === id))
            doc.sources.push({
              id,
              document: structuredClone(source.editor!.document),
            });
          node = {
            id: fresh("reference"),
            kind: "case-ref",
            sourceId: id,
            caseId,
          };
        } else if (command.action === "add-use")
          node = {
            id: fresh("instance"),
            kind: "use",
            fragmentId: String(command.value),
            arguments: {},
          };
        else if (command.action === "add-template") {
          const template = templates.find((t) => t.id === command.value);
          if (!template) throw new Error("当前模板不可用。");
          const value = structuredClone(template.definition),
            suffix = "-" + crypto.randomUUID();
          const rename = (nodes: Node[]): void =>
            nodes.forEach((node) => {
              if (node.kind === "use") node.fragmentId += suffix;
              else if (node.kind === "case-ref") node.sourceId += suffix;
              else if (node.kind === "group") rename(node.nodes);
              else if (node.kind === "flow") {
                rename(node.before || []);
                rename(node.steps);
                rename(node.finally);
              }
            });
          rename(value.nodes);
          for (const fragment of value.fragments)
            if (fragment.kind === "nodes") rename(fragment.nodes);
            else {
              rename(fragment.before || []);
              rename(fragment.steps);
              rename(fragment.finally || []);
            }
          value.sources.forEach((s) => (s.id += suffix));
          value.fragments.forEach((f) => (f.id += suffix));
          doc.sources.push(...value.sources);
          doc.fragments.push(...value.fragments);
          for (const target of value.targets || []) {
            const old = doc.targets?.find((old) => old.id === target.id);
            if (old && JSON.stringify(old) !== JSON.stringify(target))
              throw new Error(
                "工具模板中的对象描述与当前定义冲突，未替换原描述。",
              );
            if (!old) (doc.targets ||= []).push(target);
          }
          node = { id: fresh("template"), kind: "group", nodes: value.nodes };
        } else throw new Error("当前工具未声明此添加操作。");
        parent.push(node);
        const selected = compositionNodeId([
          ...(located?.node.kind === "group" ? located.path : []),
          node.id,
        ]);
        return {
          document: doc as unknown as Obj,
          selection: selected,
          labels:
            command.action === "add-template"
              ? {
                  [selected]: templates.find((t) => t.id === command.value)!
                    .title,
                }
              : command.action === "add-group"
                ? { [selected]: "新分组" }
                : undefined,
        };
      }
      if (!located || located.virtual)
        throw new Error("请在片段定义中编辑，或创建独立副本。");
      const n = located.node,
        list = located.list,
        index = list.indexOf(n);
      if (
        command.action === "save-fragment" &&
        (n.kind === "case-ref" || n.kind === "flow")
      ) {
        const id = fresh("fragment"),
          content = structuredClone(n);
        content.id = "content";
        const parameters: Record<string, CompositionParameter> = {},
          args: Obj = {};
        if (content.kind === "case-ref") {
          const baseline = referenceValues(doc, content);
          content.values = { ...content.values };
          content.expectedValues = { ...content.expectedValues };
          for (const [field, value] of Object.entries(baseline.values))
            if (scalar(value) && /^[a-zA-Z0-9][\w.-]*$/.test(field)) {
              const expected = "expected." + field,
                setting = content.values[field] ?? value,
                expectation =
                  content.expectedValues[field] ?? baseline.expected[field];
              if (!scalar(setting) || !scalar(expectation)) continue;
              parameters[field] = {
                kind: typeof setting as "string" | "number" | "boolean",
                default: setting,
              };
              parameters[expected] = {
                kind: typeof expectation as "string" | "number" | "boolean",
                default: expectation,
              };
              content.values[field] = { $param: field };
              content.expectedValues[field] = { $param: expected };
              args[field] = setting;
              args[expected] = expectation;
            }
        }
        if (content.kind === "flow") {
          const parameterize = (value: unknown, base: string): unknown => {
            if (!scalar(value)) return value;
            let name = base.replace(/[^\w.-]/g, "-");
            if (!/^[a-zA-Z0-9]/.test(name)) name = "parameter-" + name;
            let suffix = 2;
            const stem = name;
            while (Object.hasOwn(parameters, name))
              name = stem + "-" + suffix++;
            parameters[name] = {
              kind: typeof value as "string" | "number" | "boolean",
              default: value,
            };
            args[name] = value;
            return { $param: name };
          };
          const target = content.target as unknown as Obj;
          const property = flowTargetProperty(target);
          target[property] = parameterize(
            target[property],
            content.target.kind === "platform" ? "platform" : property,
          );
          for (const phase of ["before", "steps", "finally"] as const)
            for (const action of content[phase] || [])
              if (action.kind === "action") {
                if (Object.hasOwn(action.inputs, "value"))
                  action.inputs.value = parameterize(
                    action.inputs.value,
                    "value." + String(action.inputs.field || "input"),
                  );
                if (action.operationId === "assert")
                  for (const input of ["values", "expected"]) {
                    const map = obj(action.inputs[input]);
                    const visit = (record: Obj, prefix: string) => {
                      for (const [field, value] of Object.entries(record)) {
                        if (scalar(value))
                          record[field] = parameterize(value, prefix + field);
                        else if (
                          !hasBindings(value) &&
                          value &&
                          typeof value === "object" &&
                          !Array.isArray(value)
                        )
                          visit(value as Obj, prefix + field + ".");
                      }
                    };
                    visit(map, "expected.");
                  }
              }
        }
        doc.fragments.push({ id, kind: "nodes", parameters, nodes: [content] });
        list[index] = {
          id: n.id,
          kind: "use",
          fragmentId: id,
          arguments: args,
        };
      } else if (command.action === "independent") {
        const result = await assemble(doc, { items: [{ path: located.path }] });
        diagnose(doc, result.diagnostics);
        if (!result.document)
          throw new Error("工具未生成独立快照，原片段保留。");
        await native.validate(result.document);
        const sourceId = fresh("copy");
        doc.sources.push({ id: sourceId, document: result.document });
        const refs = (result.document.cases as { caseId: string }[]).map(
          (item): CompositionNode => ({
            id: fresh("reference"),
            kind: "case-ref",
            sourceId,
            caseId: item.caseId,
          }),
        );
        const node: CompositionNode = {
          id: fresh("independent"),
          kind: "group",
          nodes: refs,
        };
        list.splice(index + 1, 0, node);
        return {
          document: doc as unknown as Obj,
          selection: compositionNodeId([...located.path.slice(0, -1), node.id]),
        };
      } else if (command.action === "copy") {
        const copy = structuredClone(n);
        copy.id = fresh(n.kind);
        list.splice(index + 1, 0, copy);
        return {
          document: doc as unknown as Obj,
          selection: compositionNodeId([...located.path.slice(0, -1), copy.id]),
        };
      } else if (command.action === "remove") list.splice(index, 1);
      else if (command.action === "up" || command.action === "down") {
        const to = index + (command.action === "up" ? -1 : 1);
        if (to >= 0 && to < list.length)
          [list[index], list[to]] = [list[to], list[index]];
      } else if (command.action === "move-after") {
        const target = graph.locations.get(String(command.value));
        if (!target || target.list !== list)
          throw new Error("只能在同组节点间连接排序。");
        list.splice(index, 1);
        list.splice(list.indexOf(target.node) + 1, 0, n);
      } else throw new Error("当前节点不支持此操作。");
      return {
        document: doc as unknown as Obj,
        selection: command.action === "remove" ? rootId : command.node,
      };
    },
  };
  function executionOptions(
    raw: Obj,
    id: string,
  ): ExecutionOptions | undefined {
    if (!isComposition(raw)) return;
    const unit = project(raw as unknown as CaseComposition).units.get(id);
    if (!unit) return;
    return {
      fields: unit.fields,
      steps:
        unit.node.kind === "flow"
          ? unit.node.steps.map((step) => ({
              id: step.id,
              title:
                step.kind === "use"
                  ? "片段 · " + step.fragmentId
                  : nativeOperationLabel(
                      step.operationId,
                      String(step.inputs.check || ""),
                    ),
            }))
          : undefined,
      note:
        unit.node.kind === "case-ref"
          ? "完整引用保留来源用例的前置、核验和收尾。"
          : "可选取主步骤；必要前置和收尾始终保留，缺少依赖时由模块指出。",
    };
  }
  function executionDefinition(raw: Obj, mode: "configuration" | "build"): Obj {
    if (mode !== "configuration") return raw;
    const doc = structuredClone(raw) as unknown as CaseComposition;
    const walk = (nodes: Node[]) =>
      nodes.forEach((node) => {
        if (
          node.kind === "case-ref" &&
          obj(
            doc.sources.find((source) => source.id === node.sourceId)?.document,
          ).kind !== "pink-configuration-steps"
        )
          node.endpoint = "ui";
        if (node.kind === "group") walk(node.nodes);
      });
    walk(doc.nodes);
    for (const fragment of doc.fragments)
      if (fragment.kind === "nodes") walk(fragment.nodes);
    return doc as unknown as Obj;
  }
  async function validateSelection(raw: Obj, selection: CompositionSelection) {
    const doc = raw as unknown as CaseComposition;
    diagnose(doc, await validateDefinition(doc, selection));
  }
  function selection(
    raw: Obj,
    ids: string[],
    changes: Record<string, ExecutionAdjustment> = {},
  ): CompositionSelection {
    const graph = project(raw as unknown as CaseComposition);
    return {
      items: ids.map((id) => {
        const unit = graph.units.get(id);
        if (!unit) throw new Error("所选引用实例已变化，请重新选择。");
        const item: CompositionSelection["items"][number] = {
          path: unit.path,
          ...(changes[id]?.steps ? { steps: changes[id].steps } : {}),
        };
        for (const [field, value] of Object.entries(
          changes[id]?.fields || {},
        )) {
          const definition = unit.fields.find((f) => f.key === field);
          if (!definition || definition.control === "readonly")
            throw new Error("本轮覆盖的字段不在可编辑范围。");
          const [kind, name] = JSON.parse(field) as [
            "arguments" | "values" | "expectedValues",
            string,
          ];
          item[kind] ||= {};
          item[kind]![name] = value;
          if (
            kind === "values" &&
            !Object.hasOwn(
              changes[id]?.fields || {},
              key("expectedValues", name),
            )
          ) {
            item.expectedValues ||= {};
            item.expectedValues[name] = unit.fields.find(
              (f) => f.key === key("expectedValues", name),
            )?.value;
          }
        }
        return item;
      }),
    };
  }
  function preview(raw: Obj, id: string, name: string) {
    const graph = project(raw as unknown as CaseComposition);
    return contentSchema.parse({
      kind: "qa-test-content",
      schemaVersion: 1,
      id,
      name,
      groups: [
        {
          id: "composition",
          title: "组合链路",
          units: [...graph.units].map(([id, unit]) => ({
            id,
            title:
              flatten(graph.tree).find((node) => node.id === id)?.title ||
              unit.path.join(" / "),
            summary: unit.path.join(" / "),
            stages: ["执行检查", "恢复与收尾"],
            steps: [
              {
                id,
                title:
                  flatten(graph.tree).find((node) => node.id === id)?.title ||
                  "组合执行项",
                action: "按当前组合定义的完整操作和收尾执行。",
                expected: "模拟仅演示进度；实际结论由真实执行结果给出。",
              },
            ],
          })),
        },
      ],
    });
  }
  return {
    adapter,
    project,
    selection,
    executionOptions,
    executionDefinition,
    validateSelection,
    preview,
    presentation,
    diagnose,
  };
}
