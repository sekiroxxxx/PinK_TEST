import type {
  AuthoringAdapter,
  EditField,
  EditNode,
} from "../../features/structured/authoring";
import { AuthoringValidationError } from "../../features/structured/authoring";
import {
  initialParameter,
  type ParameterSchema,
} from "../../features/structured/SchemaInput";
import presentationText from "./authoring-description.json?raw";
import platformPresentation from "./platform-presentation.json";
import { standardTargets } from "./standardTargets";
import {
  nativeSettingParameter,
  nativeValueRelations,
  type NativeValueRelation,
} from "./nativeStepRelations";
import { sha256, serialize } from "../../features/structured/contract";
import {
  automationTargetLabel,
  type AutomationTarget,
} from "../../../shared/automation";
type ObjectValue = Record<string, unknown>;
type Operation = {
  op: string;
  output?: string;
  requires?: string[];
  parameters: ParameterSchema;
  cleanup?: boolean;
  targetKinds?: string[];
  allowedPhases?: string[];
  references?: {
    inputPath: string[];
    source: string;
    producers: { operationId: string; when?: Record<string, unknown> }[];
  }[];
};
type Assertion = {
  check: string;
  parameters: ParameterSchema;
  targetKinds?: string[];
  allowedPhases?: string[];
  references?: Operation["references"];
};
type NativeCase = {
  caseId: string;
  platform?: string;
  target?: AutomationTarget;
  steps: ObjectValue[];
  finally?: ObjectValue[];
  onFailure?: string;
};
export type NativeDescription = {
  kind: string;
  capabilityVersion: string;
  targetsSchema: ParameterSchema;
  composition?: {
    templates?: {
      parameters?: {
        schema: ParameterSchema;
        candidates?: { value: string; label: string }[];
      }[];
    }[];
  };
  formats: {
    format: string;
    schemaVersion: number;
    capabilities?: { operations: Operation[] };
  }[];
  fields: {
    supportedFields?: {
      key: string;
      availability?: { scope: string; platforms?: string[] };
    }[];
    steps: { operations: Operation[]; assertions: Assertion[] };
  };
};
const presentation = JSON.parse(presentationText) as {
  labels: Record<string, string>;
};
const labels: Record<string, string> = {
  ...platformPresentation.labels,
  ...presentation.labels,
  id: "标识",
  label: "显示名称",
  configurationTitle: "配置页标题",
  category: "分类（仅展示）",
  representativePlatform: "代表平台",
  fields: "配置项",
  kind: "数据类型",
  control: "标准控件",
  valueKinds: "允许的值类型",
  locator: "定位方式",
  key: "选项键",
  name: "名称",
  role: "控件角色",
  scope: "就绪范围",
  readyKeys: "就绪标记",
  section: "展开区域",
  homeScope: "平台列表就绪范围",
  readyLabels: "就绪卡片名称",
  families: "联动关系",
  parent: "父项",
  enabled: "启用值",
  children: "子项",
  page: "配置页引用",
  field: "配置项标识",
  value: "设置值",
  input: "输入方式",
  record: "原值记录引用",
  snapshot: "回读结果引用",
  observation: "观察结果引用",
  expected: "预期",
  presence: "是否存在",
  visible: "是否可见",
  readable: "是否可读",
  writable: "是否可写",
  candidate: "选项匹配",
  by: "匹配方式",
  present: "是否存在",
  disabled: "是否禁用",
  values: "预期值",
  check: "断言类型",
  text: "包含文本",
  platform: "平台标识",
  caseId: "用例标识",
  onFailure: "失败后行为",
  task: "构建任务引用",
  result: "任务结果引用",
  reopen: "恢复后重开核对",
  "choice:string": "文本",
  "choice:number": "数值",
  "choice:boolean": "开关",
  "choice:text": "文本输入",
  "choice:enum": "下拉选项",
  "choice:scalar": "混合类型",
  "choice:option-key": "按选项键",
  "choice:label": "按页面显示名称",
  "choice:role": "按控件角色",
  "choice:value": "按机器值",
  "choice:present": "存在",
  "choice:absent": "不存在",
  "choice:platform-card": "平台卡片",
  "choice:textbox": "文本框",
  "choice:spinbutton": "数值输入框",
  "choice:checkbox": "复选框",
  "choice:combobox": "下拉框",
};
const opLabels: Record<string, string> = {
  "builder.open": "打开构建主页",
  "builder.read": "读取构建主页",
  "builder.home": "返回构建主页",
  "platform.probe": "检查平台存在",
  "config.open": "打开配置页",
  "config.close": "关闭配置页",
  "config.ready": "等待配置就绪",
  "config.probe": "检查配置项",
  "config.candidates": "读取选项",
  "config.select": "选择选项",
  record: "记录原值",
  set: "设置配置",
  read: "回读配置",
  restore: "恢复原值",
  assert: "核验结果",
  retain: "保留当前值",
  "config.prepare": "准备配置项",
  "config.expand": "展开配置区域",
  "config.require": "核对执行前提",
  "build.submit": "提交构建",
  "build.wait": "等待构建完成",
  "stage.record": "记录阶段关系",
  "stage.read": "读取阶段关系",
  "stage.link": "连接阶段",
  "stage.unlink": "拆分阶段",
  "stage.restore": "恢复阶段关系",
};
const assertionLabels: Record<string, string> = {
  "builder-state": "构建主页状态",
  probe: "目标存在与状态",
  candidate: "选项存在与状态",
  values: "配置值核对",
  prompt: "提示信息",
  state: "控件状态",
  retained: "保留项未改变",
  hidden: "隐藏项检查",
  "agc-material": "AGC 材料检查",
  "openpaas-ready": "游戏配置就绪",
  "build-result": "构建结果",
  stages: "阶段关系",
  "build-scope": "构建范围",
  "build-enabled": "构建按钮状态",
  empty: "空值检查",
  "protected-choice": "受保护选项",
  unchanged: "原值未改变",
};
export function nativeOperationLabel(operation: string, check?: string) {
  return operation === "assert" && check
    ? assertionLabels[check] || check
    : opLabels[operation] || operation;
}
const dependencyLabels: Record<string, string> = {
  "verified-session": "已确认测试目标",
  "case.platform": "本用例的测试对象",
  "current-page": "已打开配置页",
  "recorded-field-if-restoring": "需恢复时已记录原值",
  "field-capability": "配置项操作能力",
  "unmodified-fields": "尚未修改的配置项",
  "registered-preparation": "模块提供的准备操作",
  "check-specific-dependencies": "对应核验的前置条件",
  "current-build-snapshot": "当前构建配置快照",
  "build-only-stage-group": "仅构建的阶段范围",
  "healthy-observer": "任务监听已就绪",
  "owned-task-reference": "本用例已提交的任务",
  "cleanup-page": "收尾配置页",
  "same-session-and-platform-record": "同一目标和会话的原值记录",
};
const id = (...parts: (string | number)[]) =>
  JSON.stringify(["native", ...parts]);
const record = (value: unknown): ObjectValue =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectValue)
    : {};
function stepTitle(
  step: ObjectValue,
  position: number,
  names: Record<string, string>,
) {
  return `${position + 1}. ${step.op === "assert" && step.check ? assertionLabels[String(step.check)] || "核验结果" : opLabels[String(step.op)] || step.op}${step.field ? " · " + (names[String(step.field)] || step.field) : ""}`;
}
function locatedValidationError(doc: ObjectValue, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  const match = /cases\[(\d+)\](?:\.(steps|finally)\[(\d+)\])?/.exec(detail);
  if (!match || !isStepDocument(doc)) return error;
  const caseIndex = Number(match[1]),
    item = (doc.cases as NativeCase[])[caseIndex];
  if (!item) return error;
  const phase = match[2] as "steps" | "finally" | undefined;
  const position = Number(match[3]),
    step = phase && item[phase]?.[position];
  const reason = detail
    .slice(match.index + match[0].length)
    .replace(/^[\s：:]+/, "");
  if (!phase || !step)
    return new AuthoringValidationError(
      {
        node: id("case", caseIndex),
        message: `「${item.caseId}」：${reason || detail}`,
      },
      detail,
    );
  const names = nativeFieldLabels(doc, item.platform);
  const title = stepTitle(step, position, names);
  const references = [
    "snapshot",
    "record",
    "page",
    "task",
    "result",
    "observation",
  ];
  const key = references.find(
    (key) =>
      typeof step[key] === "string" &&
      ((key === "snapshot" && /快照|snapshot/.test(reason)) ||
        (key === "record" && /原值|记录|record/.test(reason)) ||
        (key === "page" && /页面|page/.test(reason)) ||
        (["task", "result"].includes(key) &&
          /任务|结果|task|result/.test(reason))),
  );
  const related = key
    ? (["steps", "finally"] as const).flatMap((branch) =>
        (item[branch] || []).flatMap((candidate, index) =>
          candidate.id === step[key]
            ? [
                {
                  node: id("step", caseIndex, branch, index),
                  label: stepTitle(candidate, index, names),
                  branch,
                  index,
                },
              ]
            : [],
        ),
      )
    : [];
  const dependency = related[0];
  const later =
    dependency &&
    (dependency.branch === phase
      ? dependency.index >= position
      : phase === "steps");
  return new AuthoringValidationError(
    {
      node: id("step", caseIndex, phase, position),
      field: "parameters",
      message:
        dependency && later
          ? `「${title}」需要先执行「${dependency.label}」。请把依赖步骤放到当前步骤之前。`
          : `「${title}」：${reason || detail}`,
      related: related.map(({ node, label }) => ({ node, label })),
    },
    detail,
  );
}
export const isStepDocument = (doc: ObjectValue) =>
  doc.kind === "pink-configuration-steps";

export function nativeFieldLabels(doc: ObjectValue, platform?: string) {
  const target = ((doc.targets as ObjectValue[]) || []).find(
    (item) => item.id === platform,
  );
  return {
    ...labels,
    ...Object.fromEntries(
      Object.entries(record(target?.fields)).flatMap(([key, value]) => {
        const field = record(value),
          locator = record(field.locator);
        const label = field.label || (locator.kind === "label" && locator.name);
        return typeof label === "string" ? [[key, label]] : [];
      }),
    ),
  };
}
export function nativePlatformOptions(
  description: NativeDescription,
  doc: ObjectValue,
) {
  const candidates = (description.composition?.templates || [])
    .flatMap((template) => template.parameters || [])
    .filter(
      (parameter) => parameter.schema["x-reference"] === "platform-description",
    )
    .flatMap((parameter) => parameter.candidates || []);
  const targets = (doc.targets || []) as ObjectValue[];
  return [
    ...new Set([
      ...targets.map((target) => String(target.id)),
      ...candidates.map((item) => item.value),
    ]),
  ].map((value) => ({
    value,
    label: String(
      targets.find((target) => target.id === value)?.label ||
        candidates.find((item) => item.value === value)?.label ||
        value,
    ),
  }));
}
export function nativeFieldReferences(
  description: NativeDescription,
  doc: ObjectValue,
  platform?: string,
) {
  const declared = ((doc.targets as ObjectValue[]) || []).find(
    (target) => target.id === platform,
  );
  return [
    ...new Set([
      ...(description.fields.supportedFields || [])
        .filter(
          (field) =>
            field.availability?.scope === "common" ||
            field.availability?.platforms?.includes(platform || ""),
        )
        .map((field) => field.key),
      ...Object.keys(record(declared?.fields)),
    ]),
  ];
}
export async function loadNativeAuthoring(
  catalog: AuthoringAdapter,
  description: NativeDescription,
): Promise<AuthoringAdapter> {
  const hash = await sha256(catalog.hash + serialize(description));
  const schemaField = (
    key: string,
    label: string,
    value: unknown,
    schema: ParameterSchema,
    references?: Record<string, string[]>,
  ): EditField => ({
    key,
    label,
    value,
    control: "schema",
    schema,
    labels,
    references,
  });
  const targetEditor = standardTargets(
    id("targets"),
    description.targetsSchema,
    labels,
  );
  const targetNode = (doc: ObjectValue) => targetEditor.tree(doc);
  const operations = (doc: ObjectValue) =>
    doc.schemaVersion === 1
      ? description.formats.find(
          (item) => item.format === "steps" && item.schemaVersion === 1,
        )?.capabilities?.operations || []
      : description.fields.steps.operations;
  function stepSchema(doc: ObjectValue, step: ObjectValue): ParameterSchema {
    if (step.op === "assert" && doc.schemaVersion === 2)
      return (
        description.fields.steps.assertions.find(
          (item) => item.check === step.check,
        )?.parameters || { type: "object" }
      );
    return (
      operations(doc).find((item) => item.op === step.op)?.parameters || {
        type: "object",
      }
    );
  }
  function fieldLabels(doc: ObjectValue, item: NativeCase) {
    return nativeFieldLabels(doc, item.platform);
  }
  function linkedField(
    key: string,
    label: string,
    value: unknown,
    schema: ParameterSchema,
    names: Record<string, string>,
  ): EditField {
    const control =
      typeof value === "number"
        ? "number"
        : typeof value === "boolean"
          ? "toggle"
          : typeof value === "string"
            ? "text"
            : "schema";
    return {
      key,
      label,
      value,
      control,
      schema,
      labels: { ...labels, ...names },
    };
  }
  function associations(
    doc: ObjectValue,
    item: NativeCase,
    index: number,
    position: number,
    relations: NativeValueRelation[],
  ): EditNode["associations"] {
    const names = fieldLabels(doc, item);
    return relations
      .filter(
        (link) => link.setting === position || link.assertion === position,
      )
      .map((link) => {
        const setting = item.steps[link.setting];
        const parameter = nativeSettingParameter(setting)!;
        const assertion = item.steps[link.assertion];
        const valuesSchema = stepSchema(doc, assertion).properties?.values
          ?.additionalProperties;
        return {
          id: `${link.setting}:${link.assertion}:${link.field}`,
          title: names[link.field] || link.field,
          fields: [
            {
              nodeId: id("step", index, "steps", link.setting),
              source: `查看第 ${link.setting + 1} 步设置`,
              field: linkedField(
                "linked-setting",
                "设置值",
                setting[parameter],
                stepSchema(doc, setting).properties?.[parameter] || {},
                names,
              ),
            },
            {
              nodeId: id("step", index, "steps", link.assertion),
              source: `查看第 ${link.assertion + 1} 步预期`,
              field: linkedField(
                "linked-expectation:" + link.field,
                "预期值",
                record(assertion.values)[link.field],
                typeof valuesSchema === "object" ? valuesSchema : {},
                names,
              ),
            },
          ],
        };
      });
  }
  function stepNode(
    doc: ObjectValue,
    item: NativeCase,
    index: number,
    section: "steps" | "finally",
    position: number,
    relations: NativeValueRelation[],
  ): EditNode {
    const step = item[section]![position];
    const preceding =
      section === "steps"
        ? item.steps.slice(0, position)
        : [...item.steps, ...(item.finally || []).slice(0, position)];
    const references: Record<string, string[]> = {
      "field-description": nativeFieldReferences(
        description,
        doc,
        item.platform,
      ),
    };
    for (const previous of preceding) {
      const output = operations(doc).find(
        (operation) => operation.op === previous.op,
      )?.output;
      if (output) (references[output] ||= []).push(String(previous.id));
    }
    const parameters = Object.fromEntries(
      Object.entries(step).filter(
        ([key]) =>
          !["id", "op", ...(doc.schemaVersion === 2 ? ["check"] : [])].includes(
            key,
          ),
      ),
    );
    const fields: EditField[] = [
      { key: "id", label: "步骤标识", value: step.id, control: "readonly" },
    ];
    if (step.op === "assert" && doc.schemaVersion === 2)
      fields.push({
        key: "check",
        label: "断言类型",
        value: step.check,
        control: "select",
        options: description.fields.steps.assertions.map((assertion) => ({
          value: assertion.check,
          label: assertionLabels[assertion.check] || assertion.check,
        })),
      });
    fields.push({
      ...schemaField(
        "parameters",
        "步骤参数",
        parameters,
        stepSchema(doc, step),
        references,
      ),
      labels: fieldLabels(doc, item),
    });
    const linked =
      section === "steps"
        ? associations(doc, item, index, position, relations)
        : [];
    const operation = operations(doc).find(
      (operation) => operation.op === step.op,
    );
    return {
      id: id("step", index, section, position),
      title: stepTitle(step, position, fieldLabels(doc, item)),
      note: operation?.requires?.length
        ? "依赖：" +
          operation.requires
            .map((key) => dependencyLabels[key] || key)
            .join("、") +
          "。保存时由模块校验引用和顺序。"
        : undefined,
      fields,
      associations: linked,
      actions: [
        { id: "copy", label: "复制步骤", creates: true },
        { id: "up", label: "上移" },
        { id: "down", label: "下移" },
        { id: "remove", label: "移除步骤" },
      ],
    };
  }
  return {
    hash,
    accepts: [...catalog.accepts, hash],
    async checkCompatibility(original) {
      const doc = original.document;
      const format = isStepDocument(doc)
        ? "steps"
        : !doc.kind &&
            Array.isArray(doc.platforms) &&
            Array.isArray(doc.templates)
          ? "catalog"
          : undefined;
      const formatLabel = (format: string) =>
        format === "steps"
          ? "步骤文件"
          : format === "catalog"
            ? "配置用例"
            : format;
      if (
        !format ||
        !description.formats.some(
          (item) =>
            item.format === format && item.schemaVersion === doc.schemaVersion,
        )
      )
        throw new Error(
          `此用例为${format ? formatLabel(format) : String(doc.kind || "未知格式")} v${doc.schemaVersion ?? "未知"}，当前工具支持${description.formats.map((item) => `${formatLabel(item.format)} v${item.schemaVersion}`).join("、")}。原用例与草稿仍保留。`,
        );
      // A presentation hash can change without changing the file contract.
      // The owning module must still validate the unchanged saved document.
      try {
        await window.qa.authorAutomation({
          moduleId: "pink-build",
          action: "validate",
          document: doc,
        });
      } catch (error) {
        throw new Error(
          `此用例未通过当前工具的兼容校验，原用例与草稿仍保留：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    exportName: "native-automation-cases.json",
    tree(doc) {
      if (!isStepDocument(doc)) return [...catalog.tree(doc), targetNode(doc)];
      const cases = doc.cases as NativeCase[];
      const relations = cases.map((item) =>
        doc.schemaVersion === 2 ? nativeValueRelations(item.steps) : [],
      );
      return [
        {
          id: id("cases"),
          title: "执行链路",
          canHaveFolders: true,
          note: "按下列用例、步骤和收尾的原生顺序执行；目录整理不改变执行顺序。",
          actions:
            doc.schemaVersion === 2
              ? [
                  {
                    id: "add-case",
                    label: "新增检查链路",
                    creates: true,
                    help: "填写目标和值，由模块生成记录、设置、回读、断言和恢复步骤。尚未连接或检查实际页面。",
                    schema: {
                      type: "object",
                      required: ["platform", "values"],
                      properties: {
                        platform: { type: "string", minLength: 1 },
                        values: {
                          type: "object",
                          additionalProperties: {
                            oneOf: [
                              { type: "string" },
                              { type: "number" },
                              { type: "boolean" },
                              { type: "array", items: { type: "string" } },
                              { type: "object" },
                            ],
                          },
                        },
                      },
                      additionalProperties: false,
                    },
                    labels: { ...labels, values: "检查配置" },
                    initial: {
                      platform: cases[0]?.platform || "web-desktop",
                      values: { name: "QA_configuration_check" },
                    },
                  },
                ]
              : [],
          children: cases.map((item, index) => ({
            id: id("case", index),
            title: `${index + 1}. ${automationTargetLabel(item)} · ${item.caseId}`,
            selectable: true,
            definitionId: item.caseId,
            fields: [
              {
                key: "caseId",
                label: "用例标识",
                value: item.caseId,
                control: "text",
              },
              ...(item.target?.kind === "builder"
                ? [
                    ...(!item.target.representativePlatform &&
                    item.target.category
                      ? [
                          {
                            key: "legacyCategory",
                            label: "旧分类（兼容）",
                            value: item.target.category,
                            control: "readonly" as const,
                          },
                        ]
                      : []),
                    {
                      key: "representativePlatform",
                      label: "代表平台",
                      value: item.target.representativePlatform || "",
                      control: "text" as const,
                      options: nativePlatformOptions(description, doc),
                      help: "通过代表平台定位构建主页，不打开平台配置页。选择后替换旧分类写法。",
                    },
                  ]
                : [
                    item.target
                      ? {
                          key: "target",
                          label: "测试对象",
                          value: item.target,
                          display: automationTargetLabel(item),
                          control: "readonly" as const,
                        }
                      : {
                          key: "platform",
                          label: "平台标识",
                          value: item.platform,
                          control: "text" as const,
                        },
                  ]),
              {
                key: "onFailure",
                label: "失败后行为",
                value: item.onFailure || "stop",
                control: "select",
                options: [
                  { value: "stop", label: "停止后续用例" },
                  { value: "continue", label: "继续后续用例" },
                ],
              },
            ],
            actions: [
              { id: "copy", label: "复制链路", creates: true },
              { id: "up", label: "上移" },
              { id: "down", label: "下移" },
              { id: "remove", label: "移除链路" },
            ],
            children: (
              ["steps", ...(doc.schemaVersion === 2 ? ["finally"] : [])] as (
                "steps" | "finally"
              )[]
            ).map((section) => ({
              id: id("section", index, section),
              title: section === "steps" ? "操作步骤" : "收尾与恢复",
              note:
                section === "finally"
                  ? "执行器在失败或停止后仍按合同执行收尾。不要删除必要恢复步骤。"
                  : undefined,
              actions: [
                {
                  id: "add-step",
                  label: "添加步骤",
                  creates: true,
                  options: operations(doc)
                    .filter(
                      (operation) => section !== "finally" || operation.cleanup,
                    )
                    .map((operation) => ({
                      value: operation.op,
                      label: opLabels[operation.op] || operation.op,
                    })),
                },
              ],
              children: (item[section] || []).map((_, position) =>
                stepNode(doc, item, index, section, position, relations[index]),
              ),
            })),
          })),
        },
        targetNode(doc),
      ];
    },
    async apply(value, command) {
      if (!command.node.startsWith('["native",'))
        return catalog.apply(value, command);
      const doc = structuredClone(value);
      const targetChange = targetEditor.apply(doc, command);
      if (targetChange) return targetChange;
      const [, kind, index, section, position] = JSON.parse(command.node) as [
        string,
        string,
        number,
        "steps" | "finally",
        number,
      ];
      if (kind === "targets") {
        doc.targets = command.value;
        return { document: doc };
      }
      const cases = doc.cases as NativeCase[];
      if (command.action === "add-case") {
        const input = record(command.value);
        const template = await window.qa.authorAutomation({
          moduleId: "pink-build",
          action: "template",
          input: {
            caseId: "qa.check." + crypto.randomUUID(),
            platform: input.platform,
            values: input.values,
            ...(doc.targets ? { targets: doc.targets } : {}),
          },
        });
        const created = (template.cases as NativeCase[])[0];
        if (doc.schemaVersion !== 2)
          throw new Error(
            "v1 文件保留隐式页面语义。请复制现有 v1 链路，或新建 v2 用例集。",
          );
        cases.push(created);
        return { document: doc, selection: id("case", cases.length - 1) };
      }
      const item = cases[index];
      if (command.action === "set") {
        if (kind === "case") {
          if (
            command.key === "representativePlatform" &&
            item.target?.kind === "builder"
          ) {
            item.target.representativePlatform = String(command.value ?? "");
            delete item.target.category;
          } else (item as unknown as ObjectValue)[command.key!] = command.value;
        }
        if (kind === "step") {
          const step = item[section]![position];
          if (command.key === "check")
            item[section]![position] = {
              id: step.id,
              op: step.op,
              check: command.value,
              ...record(
                initialParameter(
                  stepSchema(doc, { ...step, check: command.value }),
                ),
              ),
            };
          else if (command.key === "parameters")
            item[section]![position] = {
              id: step.id,
              op: step.op,
              ...(doc.schemaVersion === 2 && step.check
                ? { check: step.check }
                : {}),
              ...record(command.value),
            };
          else if (command.key === "linked-setting") {
            const parameter = nativeSettingParameter(step);
            if (!parameter)
              throw new Error("关联设置已变化，请重新选择该步骤。");
            step[parameter] = command.value;
          } else if (
            command.key?.startsWith("linked-expectation:") &&
            step.op === "assert" &&
            step.check === "values"
          ) {
            const field = command.key.slice("linked-expectation:".length);
            if (!Object.hasOwn(record(step.values), field))
              throw new Error("关联预期已变化，请重新选择该步骤。");
            step.values = { ...record(step.values), [field]: command.value };
          }
        }
        return { document: doc };
      }
      if (command.action === "add-step") {
        const op = String(command.value),
          spec = operations(doc).find((operation) => operation.op === op);
        if (!spec) throw new Error("动作不在模块描述中");
        const check =
          op === "assert" && doc.schemaVersion === 2
            ? description.fields.steps.assertions[0]?.check
            : undefined;
        const step = {
          id: "step-" + crypto.randomUUID(),
          op,
          ...(check ? { check } : {}),
        };
        Object.assign(step, record(initialParameter(stepSchema(doc, step))));
        (item[section] ||= []).push(step);
        return {
          document: doc,
          selection: id("step", index, section, item[section]!.length - 1),
        };
      }
      const list = kind === "case" ? cases : item[section]!;
      const from = kind === "case" ? index : position;
      // Positional UI ids stay compatible with saved directories and drafts.
      // Track the original objects so insertion/reordering cannot transfer their
      // directory ownership to the object that takes the same array position.
      const before = cases.map((entry) => ({
        item: entry,
        steps: [...entry.steps],
        finally: [...(entry.finally || [])],
      }));
      const finish = (selection: string) => {
        const remap: Record<string, string | null> = {};
        before.forEach((entry, previousIndex) => {
          const nextIndex = cases.indexOf(entry.item);
          remap[id("case", previousIndex)] =
            nextIndex < 0 ? null : id("case", nextIndex);
          for (const branch of ["steps", "finally"] as const) {
            remap[id("section", previousIndex, branch)] =
              nextIndex < 0 ? null : id("section", nextIndex, branch);
            entry[branch].forEach((step, previousPosition) => {
              const nextPosition = entry.item[branch]?.indexOf(step) ?? -1;
              remap[id("step", previousIndex, branch, previousPosition)] =
                nextIndex < 0 || nextPosition < 0
                  ? null
                  : id("step", nextIndex, branch, nextPosition);
            });
          }
        });
        return { document: doc, selection, remap };
      };
      if (command.action === "copy") {
        const clone = structuredClone(list[from]);
        if (kind === "case")
          (clone as NativeCase).caseId += ".copy-" + crypto.randomUUID();
        else (clone as ObjectValue).id = "step-" + crypto.randomUUID();
        list.splice(from + 1, 0, clone as NativeCase & ObjectValue);
        return finish(
          kind === "case"
            ? id("case", from + 1)
            : id("step", index, section, from + 1),
        );
      }
      if (command.action === "remove") list.splice(from, 1);
      else if (
        command.action === "up" ||
        command.action === "down" ||
        command.action === "move-after"
      ) {
        let to = from + (command.action === "up" ? -1 : 1);
        if (command.action === "move-after") {
          const [, targetKind, targetIndex, targetSection, targetPosition] =
            JSON.parse(String(command.value));
          if (
            targetKind !== kind ||
            (kind !== "case" &&
              (targetIndex !== index || targetSection !== section))
          )
            throw new Error(
              "只能连接同一链路、同一执行分组中的节点。操作步骤和收尾步骤不能混排。",
            );
          const anchor = kind === "case" ? targetIndex : targetPosition;
          if (anchor === from) return finish(command.node);
          to = anchor + (from > anchor ? 1 : 0);
        }
        if (to >= 0 && to < list.length) {
          const [moved] = list.splice(from, 1);
          list.splice(to, 0, moved as NativeCase & ObjectValue);
          return finish(
            kind === "case" ? id("case", to) : id("step", index, section, to),
          );
        }
      }
      return finish(
        kind === "case" ? id("cases") : id("section", index, section),
      );
    },
    async validate(doc) {
      if (isStepDocument(doc) || doc.targets) {
        try {
          await window.qa.authorAutomation({
            moduleId: "pink-build",
            action: "validate",
            document: doc,
          });
        } catch (error) {
          throw locatedValidationError(doc, error);
        }
      } else await catalog.validate(doc);
    },
    recover(original, mountId) {
      return isStepDocument(original.document)
        ? original.document
        : catalog.recover(original, mountId);
    },
  };
}
