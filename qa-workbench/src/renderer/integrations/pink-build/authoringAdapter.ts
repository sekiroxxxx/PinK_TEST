import sourceText from "@pink-data/public-combinations.json?raw";
import descriptionText from "./authoring-description.json?raw";
import platformPresentation from "./platform-presentation.json";
import {
  caseContract,
  type CatalogDocument,
  type CatalogCombo,
  type InputValue,
  type InputValues,
  type FormValidationSample,
} from "@pink-build/case-contract";
import type { describeFieldCapabilities } from "@pink-build/field-capabilities";
import { buildEditorAdapter } from "./editorAdapter";
import { readDraft } from "../../components/useDraft";
import {
  sha256,
  serialize,
  changeSchema,
} from "../../features/structured/contract";
import type {
  AuthoringAdapter,
  EditNode,
  EditField,
  EditCommand,
} from "../../features/structured/authoring";

const rules = JSON.parse(descriptionText) as {
  labels: Record<string, string>;
  choiceLabels: Record<string, Record<string, string>>;
  dependencies: {
    target: string;
    field: string;
    equals: unknown;
    message: string;
  }[];
  sampleText: { key: string; label: string }[];
  editableExecution: string[];
  alertOptions: { value: string; label: string }[];
  newCombinationTemplates: string[];
  combinationHelp: string;
  sections: Record<string, string>;
  configSections: { title: string; fields: string[]; collapsed: boolean }[];
};
const source = JSON.parse(sourceText) as CatalogDocument;
let capabilities: ReturnType<
  typeof describeFieldCapabilities
>["supportedFields"] = [];
const nid = (...parts: (string | number)[]) => JSON.stringify(parts);
const uuid = () => crypto.randomUUID();
const orderActions = [
  { id: "up", label: "上移" },
  { id: "down", label: "下移" },
];
const fieldLabels: Record<string, string> = {
  ...platformPresentation.labels,
  ...rules.labels,
};
const label = (key: string) => fieldLabels[key] || key;
const text = (
  key: string,
  label: string,
  value: unknown,
  control: EditField["control"] = "text",
): EditField => ({ key, label, value: value ?? "", control });
function locate(doc: CatalogDocument, id: string) {
  const [kind, p, c, v] = JSON.parse(id) as [string, string, string, number];
  const platform = doc.platforms.find((x) => x.id === p);
  const combo = platform?.combinations.find((x) => x.id === c);
  const group = doc.formValidation?.cases.find((x) => x.id === p);
  return {
    kind,
    p,
    c,
    v,
    platform,
    combo,
    variant: v === undefined ? undefined : combo?.variants[v],
    group,
    sample: group?.samples.find((x) => x.id === c),
    template: doc.templates.find((x) => x.id === p),
  };
}
function configFields(
  doc: CatalogDocument,
  own: InputValues,
  inherited: InputValues,
  options: {
    platform?: string;
    excluded?: string[];
    retained?: string[];
    coverage?: CatalogCombo["fieldCoverage"];
  } = {},
): EditField[] {
  const values = { ...inherited, ...own };
  return capabilities
    .filter(
      (c) =>
        !options.excluded?.includes(c.key) &&
        (c.availability.scope === "common" ||
          c.availability.platforms?.includes(options.platform || "") ||
          (c.availability.scope === "l10n" && Object.hasOwn(values, c.key))),
    )
    .map((cap) => {
      const key = cap.key,
        type = doc.fieldTypes[key];
      const value = values[key];
      const reference = caseContract.reference(value);
      const section =
        cap.availability.scope === "common"
          ? rules.configSections.find((s) => s.fields.includes(key)) ||
            rules.configSections.at(-1)!
          : undefined;
      const dependency = rules.dependencies.find((r) => r.target === key);
      const retained =
        options.retained?.includes(key) ||
        (options.coverage?.[key]?.state === "retain" &&
          !Object.hasOwn(own, key));
      return {
        key: "value:" + key,
        label: label(key),
        value,
        display: rules.choiceLabels[key]?.[String(value)],
        control:
          reference || type?.sensitive
            ? "reference"
            : type?.choices
              ? "select"
              : type?.kind === "boolean"
                ? "toggle"
                : type?.kind === "string"
                  ? "text"
                  : type?.kind === "number"
                    ? "number"
                    : type?.kind === "array" &&
                        Array.isArray(value) &&
                        value.every((v) => typeof v === "string")
                      ? "lines"
                      : "readonly",
        options: type?.choices?.map((v) => ({
          value: v,
          label: rules.choiceLabels[key]?.[String(v)] || String(v),
        })),
        section: section?.title || rules.sections[cap.availability.scope],
        collapsed: section?.collapsed,
        origin: Object.hasOwn(own, key)
          ? "本项配置"
          : retained
            ? "保留现场值"
            : Object.hasOwn(inherited, key)
              ? "继承"
              : "未指定",
        reset: Object.hasOwn(own, key),
        condition: dependency
          ? { ...dependency, field: "value:" + dependency.field }
          : undefined,
        help: retained
          ? "当前只保留现场值；填写目标后会明确覆盖该字段。"
          : undefined,
        disabled: !type ? "未声明字段类型" : undefined,
      } satisfies EditField;
    })
    .sort((a, b) => {
      const rank = (f: EditField) => {
        const i = rules.configSections.findIndex((s) => s.title === f.section);
        return i < 0 ? rules.configSections.length : i;
      };
      const fields =
        rules.configSections.find((s) => s.title === a.section)?.fields || [];
      return (
        rank(a) - rank(b) ||
        (a.section === b.section && fields.length
          ? fields.indexOf(a.key.slice(6)) - fields.indexOf(b.key.slice(6))
          : 0)
      );
    });
}
function inputFields(doc: CatalogDocument, platforms: string[]) {
  return capabilities.filter(
    (cap) =>
      doc.fieldTypes[cap.key] &&
      !cap.sensitive &&
      cap.operation === "set-target-and-read-back" &&
      !rules.dependencies.some((rule) => rule.target === cap.key) &&
      ["string", "number", "boolean"].includes(cap.kind) &&
      (cap.availability.scope === "common" ||
        platforms.every((platform) =>
          cap.availability.platforms?.includes(platform),
        )),
  );
}
function sampleNode(
  doc: CatalogDocument,
  groupId: string,
  s: FormValidationSample,
): EditNode {
  const fields: EditField[] = rules.sampleText.map((f) => ({
    ...text(
      "text:" + f.key,
      f.label,
      s[f.key],
      f.key === "title" ? "text" : "textarea",
    ),
    section: f.key === "title" ? "基本信息" : "说明与复查",
    collapsed: f.key !== "title",
  }));
  const e = s.execution;
  fields.push({
    ...text(
      "platforms",
      "适用平台",
      s.platforms
        .map(
          (id) =>
            doc.platforms.find((platform) => platform.id === id)?.label || id,
        )
        .join("、"),
      "readonly",
    ),
    section: "基本信息",
  });
  if (e && rules.editableExecution.includes(e.kind)) {
    const type = doc.fieldTypes[e.field];
    const canChangeField =
      e.kind === "field-input" &&
      !e.setup?.length &&
      !e.prepare?.length &&
      !e.after?.length &&
      !e.requiresNonEmpty?.length &&
      !e.unchanged?.length &&
      !e.child &&
      e.input === undefined;
    fields.push({
      ...text(
        "execution:field",
        "检查的配置项",
        e.field,
        canChangeField ? "select" : "readonly",
      ),
      options: inputFields(doc, s.platforms).map((cap) => ({
        value: cap.key,
        label: label(cap.key),
      })),
      section: "自动化断言",
      help: canChangeField
        ? "选择工具支持的独立输入项。更换后需重新确认测试输入与提示断言。"
        : "此检查含专属操作或前置步骤，保留原字段绑定。",
    });
    fields.push({
      ...text(
        "execution:value",
        "测试输入",
        e.value,
        type?.choices
          ? "select"
          : typeof e.value === "boolean"
            ? "toggle"
            : typeof e.value === "number"
              ? "number"
              : typeof e.value === "string"
                ? "text"
                : "readonly",
      ),
      section: "自动化断言",
      options: type?.choices?.map((value) => ({
        value,
        label: rules.choiceLabels[e.field]?.[String(value)] || String(value),
      })),
      help: "保留空字符串和空格。这里的实际输入与下面断言由执行器读取。",
    });
    if (e.alert) {
      fields.push({
        ...text("execution:alertKind", "提示匹配", e.alert.kind, "select"),
        options: rules.alertOptions,
        section: "自动化断言",
      });
      fields.push({
        ...text("execution:alertText", "提示包含文字", e.alert.text),
        section: "自动化断言",
        condition: {
          field: "execution:alertKind",
          equals: "contains",
          message: "仅“包含指定文字”需要填写。",
        },
      });
    }
    if (!type)
      fields.forEach((f) => {
        if (f.key.startsWith("execution:")) f.disabled = "执行器未注册该字段";
      });
  }
  return {
    id: nid("sample", groupId, s.id),
    definitionId: s.id,
    title: s.title,
    selectable: true,
    fields,
    actions: [
      { id: "copy", label: "复制用例" },
      { id: "remove", label: "移除用例", destructive: true },
    ],
    note:
      s.executionBlocker ||
      (!e && !s.executionByPlatform
        ? "人工用例：没有自动化操作映射；可以维护内容，不能作为已适配自动化执行。"
        : "文字说明供 QA 阅读；自动化读取操作定义与断言，修改说明不会自动改写操作。"),
  };
}
function tree(doc: CatalogDocument): EditNode[] {
  const platformNodes: EditNode[] = doc.platforms.map((p) => ({
    id: nid("platform", p.id),
    title: p.label,
    canHaveFolders: true,
    fields: [text("label", "平台名称", p.label)],
    actions: [
      ...orderActions,
      {
        id: "add-combination",
        creates: true,
        label: "＋ 新增组合",
        options: p.combinations
          .filter((c) => rules.newCombinationTemplates.includes(c.template))
          .map((c) => ({ value: c.id, label: c.title })),
        help: rules.combinationHelp,
      },
    ],
    children: p.combinations.flatMap((c) => {
      const base = doc.templates.find((t) => t.id === c.template)!.values;
      const node: EditNode = {
        id: nid("combo", p.id, c.id),
        orderGroup: nid("combo-order", p.id),
        definitionId: c.id,
        title: c.title,
        selectable: c.template !== "conditional",
        fields: [
          text("title", "组合名称", c.title),
          ...configFields(doc, c.values, base, {
            platform: p.id,
            excluded: c.excludedFields,
            coverage: c.fieldCoverage,
          }),
        ],
        actions: [
          ...orderActions,
          ...(rules.newCombinationTemplates.includes(c.template)
            ? [{ id: "copy", label: "复制组合" }]
            : []),
          { id: "add-check", creates: true, label: "＋ 添加检查项" },
        ],
        note:
          c.template === "conditional"
            ? "条件场景独立执行，不能把本组当作一套同时开启的配置。"
            : undefined,
        children:
          doc.formValidation?.cases
            .filter((g) => g.sourceCombinationId === c.id)
            .flatMap((g) => g.samples.map((s) => sampleNode(doc, g.id, s))) ||
          [],
      };
      const variants: EditNode[] = c.variants.map((v, i) => ({
        id: nid("variant", p.id, c.id, i),
        orderGroup: nid("variant-order", p.id, c.id),
        definitionId: `${c.id}.variant-${i + 1}`,
        title: v.title,
        badge: "派生",
        selectable: true,
        fields: [
          text("title", "组合名称", v.title),
          ...configFields(
            doc,
            v.values,
            { ...base, ...c.values },
            {
              platform: p.id,
              excluded: c.excludedFields,
              coverage: c.fieldCoverage,
              retained: v.retained,
            },
          ),
        ],
        actions: [
          ...orderActions,
          { id: "copy", label: "复制组合" },
          { id: "remove", label: "移除组合", destructive: true },
          { id: "add-check", creates: true, label: "＋ 添加检查项" },
        ],
        children:
          doc.formValidation?.cases
            .filter((g) => g.sourceCombinationId === `${c.id}.variant-${i + 1}`)
            .flatMap((g) => g.samples.map((s) => sampleNode(doc, g.id, s))) ||
          [],
        note: `继承「${c.title}」。未修改的选项随父组合继承。`,
      }));
      return [node, ...variants];
    }),
  }));
  return [
    {
      id: nid("platforms"),
      title: "平台配置",
      canHaveFolders: true,
      actions: [
        {
          id: "add-platform",
          creates: true,
          label: "＋ 添加平台",
          options: source.platforms.map((p) => ({
            value: p.id,
            label: p.label,
            disabled: doc.platforms.some((x) => x.id === p.id),
          })),
          help: "从接入模块支持的平台中选择；已添加的平台会禁用。",
        },
      ],
      children: platformNodes,
    },
    {
      id: nid("forms"),
      title: "公共界面",
      canHaveFolders: true,
      actions: [{ id: "add-case", creates: true, label: "＋ 新建检查主题" }],
      children: (doc.formValidation?.cases || [])
        .filter((g) => !g.sourceCombinationId)
        .map((g) => ({
          id: nid("group", g.id),
          title: g.title,
          canHaveFolders: true,
          fields: [text("title", "主题名称", g.title)],
          actions: [{ id: "add-sample", creates: true, label: "＋ 新增用例" }],
          children: g.samples.map((s) => sampleNode(doc, g.id, s)),
        })),
    },
    {
      id: nid("templates"),
      title: "公共配置模板",
      children: doc.templates.map((t) => ({
        id: nid("template", t.id),
        title: t.title,
        fields: [
          text("title", "模板名称", t.title),
          ...configFields(doc, t.values, {}),
        ],
        note: `修改后影响所有继承此模板且未覆盖该字段的组合（${doc.platforms.length} 个平台）。已有测试快照不变。`,
      })),
    },
    {
      id: nid("scenarios"),
      title: "条件场景",
      children: doc.conditionalScenarios.map((s) => ({
        id: nid("scenario", s.id),
        title: s.title,
        note: "保留已有执行操作、材料要求和适用范围。",
        fields: [
          text("title", "场景名称", s.title),
          text("endpoint", "执行类型", s.executionEndpoint, "readonly"),
        ],
        children: s.platforms.map((p) => ({
          id: nid("scenario-platform", s.id, p),
          title: doc.platforms.find((x) => x.id === p)?.label || p,
          fields: configFields(
            doc,
            s.valuesByPlatform[p] || {},
            {},
            { platform: p },
          ),
        })),
      })),
    },
  ];
}
function apply(doc: CatalogDocument, command: EditCommand) {
  const next = structuredClone(doc);
  const r = locate(next, command.node);
  const { action, key, value } = command;
  let selection: string | undefined;
  const remap: Record<string, string | null> = {};
  const current = tree(next)
    .flatMap(function flat(n): EditNode[] {
      return [n, ...(n.children || []).flatMap(flat)];
    })
    .find((n) => n.id === command.node);
  if (!current) throw new Error("用例已变化，请重新选择");
  if (["up", "down", "move-after"].includes(action)) {
    if (!current.actions?.some((item) => item.id === "up"))
      throw new Error("此内容不支持调整执行顺序。");
    const anchor =
      action === "move-after" ? locate(next, String(value)) : undefined;
    let list: unknown[], item: unknown, target: unknown;
    if (r.kind === "platform") {
      list = next.platforms;
      item = r.platform;
      target = anchor?.platform;
      if (anchor && anchor.kind !== r.kind)
        throw new Error("只能在平台之间调整顺序。");
    } else if (r.kind === "combo") {
      list = r.platform!.combinations;
      item = r.combo;
      target = anchor?.combo;
      if (anchor && (anchor.kind !== r.kind || anchor.p !== r.p))
        throw new Error("基础组合按整组移动；派生组合随所属基础组合排列。");
    } else if (r.kind === "variant") {
      list = r.combo!.variants;
      item = r.variant;
      target = anchor?.variant;
      if (
        anchor &&
        (anchor.kind !== r.kind || anchor.p !== r.p || anchor.c !== r.c)
      )
        throw new Error("派生组合只能在同一基础组合内调整顺序。");
    } else throw new Error("此内容不支持调整执行顺序。");
    const before = [...list],
      from = list.indexOf(item);
    const after = anchor ? list.indexOf(target) : -1;
    const to = anchor
      ? after + (from > after ? 1 : 0)
      : from + (action === "up" ? -1 : 1);
    if (from < 0 || (anchor && after < 0))
      throw new Error("排序目标已变化，请重新选择。");
    if (to >= 0 && to < list.length && from !== to) {
      list.splice(from, 1);
      list.splice(to, 0, item);
    }
    if (r.kind === "variant") {
      const references = new Map<string, string>();
      before.forEach((variant, previous) => {
        const position = list.indexOf(variant);
        remap[nid("variant", r.p, r.c, previous)] = nid(
          "variant",
          r.p,
          r.c,
          position,
        );
        references.set(
          `${r.c}.variant-${previous + 1}`,
          `${r.c}.variant-${position + 1}`,
        );
      });
      for (const group of next.formValidation?.cases || [])
        if (
          typeof group.sourceCombinationId === "string" &&
          references.has(group.sourceCombinationId)
        )
          group.sourceCombinationId = references.get(
            group.sourceCombinationId,
          )!;
    }
    return {
      document: next as unknown as Record<string, unknown>,
      selection: remap[command.node] || command.node,
      remap,
    };
  }
  if (action === "set" || action === "reset") {
    const field = current.fields?.find((f) => f.key === key);
    if (!field || field.control === "readonly" || field.disabled)
      throw new Error("该字段当前不能编辑");
    if (
      field.condition &&
      current.fields?.find((f) => f.key === field.condition!.field)?.value !==
        field.condition.equals
    )
      throw new Error(field.condition.message);
    if (key?.startsWith("value:")) {
      const k = key.slice(6);
      const scenario = next.conditionalScenarios.find((s) => s.id === r.p);
      const values =
        r.kind === "template"
          ? r.template!.values
          : r.kind === "scenario-platform"
            ? (scenario!.valuesByPlatform[r.c] ??= {})
            : r.variant?.values || r.combo!.values;
      if (action === "reset") delete values[k];
      else values[k] = value as InputValue;
      if (r.combo && !r.variant) {
        r.combo.fieldCoverage ??= {};
        if (action !== "reset")
          r.combo.fieldCoverage[k] = {
            ...r.combo.fieldCoverage[k],
            state: "specified",
          };
        else if (r.combo.fieldCoverage[k]) delete r.combo.fieldCoverage[k];
      }
      if (r.variant?.retained && action !== "reset")
        r.variant.retained = r.variant.retained.filter((x) => x !== k);
    } else if (key?.startsWith("text:") && r.sample)
      r.sample[key.slice(5)] = value;
    else if (key?.startsWith("execution:") && r.sample?.execution) {
      const e = r.sample.execution;
      if (!rules.editableExecution.includes(e.kind))
        throw new Error("该操作类型尚未开放编辑");
      if (key === "execution:field") {
        const cap = inputFields(next, r.sample.platforms).find(
          (item) => item.key === value,
        );
        if (!cap || e.kind !== "field-input")
          throw new Error("请选择工具支持的输入配置项");
        e.field = cap.key;
        e.value =
          cap.choices?.[0] ??
          (cap.kind === "boolean" ? false : cap.kind === "number" ? 0 : "");
        e.alert = { kind: "none" };
      } else if (key === "execution:value") e.value = value as InputValue;
      else if (key === "execution:alertKind")
        e.alert =
          value === "none"
            ? { kind: "none" }
            : { kind: "contains", text: e.alert?.text || "" };
      else if (key === "execution:alertText" && e.alert?.kind === "contains")
        e.alert.text = String(value);
    } else if (key === "label" && r.platform) r.platform.label = String(value);
    else if (key === "title") {
      const target =
        r.kind === "scenario"
          ? next.conditionalScenarios.find((s) => s.id === r.p)
          : r.kind === "group"
            ? r.group
            : r.kind === "template"
              ? r.template
              : r.variant || r.combo;
      if (!target) throw new Error("编辑对象不存在");
      target.title = String(value);
    } else throw new Error("未知编辑字段");
  } else {
    if (!current.actions?.some((a) => a.id === action))
      throw new Error("该节点不支持此操作");
    if (action === "add-platform") {
      const p = source.platforms.find((p) => p.id === value);
      if (!p || next.platforms.some((x) => x.id === p.id))
        throw new Error("请选择尚未添加的受支持平台");
      const copied = structuredClone(p);
      // Conditional definitions stay owned by the catalog. Do not add dangling references.
      for (const c of copied.combinations)
        if (c.template === "conditional")
          c.scenarioIds = next.conditionalScenarios
            .filter((s) => s.platforms.includes(p.id))
            .map((s) => s.id);
      next.platforms.push(copied);
      selection = nid("platform", p.id);
    } else if (
      action === "add-combination" ||
      (action === "copy" && (r.combo || r.variant))
    ) {
      const c =
        action === "add-combination"
          ? r.platform!.combinations.find((c) => c.id === value)
          : r.combo;
      if (!c || !rules.newCombinationTemplates.includes(c.template))
        throw new Error("请选择可执行的基础组合");
      const v = r.variant
        ? structuredClone(r.variant)
        : {
            title: action === "copy" ? c.title + " · 副本" : "新组合",
            values: {},
          };
      if (r.variant) v.title += " · 副本";
      c.variants.push(v);
      selection = nid("variant", r.platform!.id, c.id, c.variants.length - 1);
    } else if (action === "copy" && r.sample && r.group) {
      const s = structuredClone(r.sample);
      s.id = r.group.id + ".qa-" + uuid();
      s.title += " · 副本";
      r.group.samples.push(s);
      selection = nid("sample", r.group.id, s.id);
    } else if (action === "remove") {
      if (r.variant && r.combo) {
        for (let i = r.v; i < r.combo.variants.length; i++)
          remap[nid("variant", r.p, r.combo.id, i)] =
            i === r.v ? null : nid("variant", r.p, r.combo.id, i - 1);
        for (const group of next.formValidation?.cases || []) {
          const index = r.combo.variants.findIndex(
            (_, i) =>
              group.sourceCombinationId === `${r.combo!.id}.variant-${i + 1}`,
          );
          if (index === r.v) delete group.sourceCombinationId;
          else if (index > r.v)
            group.sourceCombinationId = `${r.combo.id}.variant-${index}`;
        }
        r.combo.variants.splice(r.v, 1);
      } else if (r.sample && r.group)
        r.group.samples = r.group.samples.filter((s) => s.id !== r.sample!.id);
      selection = r.variant ? nid("platform", r.p) : nid("group", r.p);
    } else if (["add-case", "add-check", "add-sample"].includes(action)) {
      next.formValidation ??= {
        schemaVersion: 1,
        revision: next.revision,
        cases: [],
      };
      let g = r.group;
      if (!g) {
        g = {
          id: "FORM-QA-" + uuid(),
          title: "新检查主题",
          platforms: r.platform
            ? [r.platform.id]
            : next.platforms.map((p) => p.id),
          samples: [],
        };
        if (!g.platforms.length) throw new Error("请先添加适用平台");
        if (r.combo)
          g.sourceCombinationId = r.variant
            ? `${r.combo.id}.variant-${r.v + 1}`
            : r.combo.id;
        next.formValidation.cases.push(g);
      }
      const s: FormValidationSample = {
        id: g.id + ".qa-" + uuid(),
        title: "新配置检查",
        platforms: [...g.platforms],
        condition: "",
        input: "",
        trigger: "",
        prompt: "",
        recovery: "",
        execution: {
          kind: "field-input",
          field: "name",
          value: "QA_check",
          alert: { kind: "none" },
        },
      };
      g.samples.push(s);
      selection = nid("sample", g.id, s.id);
    }
  }
  return {
    document: next as unknown as Record<string, unknown>,
    selection,
    remap,
  };
}
export async function loadAuthoringAdapter(
  fields?: typeof capabilities,
): Promise<AuthoringAdapter> {
  capabilities =
    fields ||
    (
      (await window.qa.authorAutomation({
        moduleId: "pink-build",
        action: "describe",
      })) as unknown as { fields: { supportedFields: typeof capabilities } }
    ).fields.supportedFields;
  const legacy = await buildEditorAdapter();
  const hash = await sha256(descriptionText);
  return {
    hash,
    accepts: [
      hash,
      legacy.descriptionHash,
      "d4022e2ff3e5eb48c5bdf23f0632b07533aa8d39254ce5d4cc915be3af9b9680",
      "8b110b3a4efc44e5d33de82ae446b960d2683930c3e65c4cc5616ce4b4f2b971",
    ], // Same rules before presentation-only grouping.
    exportName: "build-cases.edited.json",
    tree: (doc) => tree(doc as unknown as CatalogDocument),
    apply: (doc, c) => apply(doc as unknown as CatalogDocument, c),
    validate: async (doc) => {
      await window.qa.authorAutomation({
        moduleId: "pink-build",
        action: "validate",
        document: doc,
      });
    },
    recover(original, mountId) {
      let doc = original.document;
      if (original.descriptionHash !== legacy.descriptionHash) return doc;
      const saved = readDraft(
        "structured:" + mountId + ":" + original.documentHash,
      ) as { changes?: unknown[] } | null;
      if (saved?.changes?.length)
        doc = legacy.apply(
          doc,
          saved.changes.map((c) => changeSchema.parse(c)),
        );
      for (const f of legacy.description.fields) {
        const oldValue = legacy.read(doc, f).value;
        const fieldDraft = readDraft(
          "structured-field:" +
            mountId +
            ":" +
            original.documentHash +
            ":" +
            f.id +
            ":" +
            JSON.stringify(oldValue),
        ) as { value?: unknown } | null;
        if (
          fieldDraft &&
          f.allowedActions.length &&
          JSON.stringify(fieldDraft.value) !== JSON.stringify(oldValue)
        )
          doc = legacy.apply(doc, [
            {
              fieldId: f.id,
              action: f.allowedActions.find(
                (a) => a !== "restore-inheritance",
              )!,
              value: fieldDraft.value,
            },
          ]);
      }
      return doc;
    },
  };
}
export async function emptyBuildEditor() {
  const a = await loadAuthoringAdapter();
  const document = {
    ...structuredClone(source),
    platforms: [],
    conditionalScenarios: [],
    formValidation: { schemaVersion: 1, revision: source.revision, cases: [] },
  };
  return {
    moduleId: "pink-build",
    descriptionHash: a.hash,
    document: document as unknown as Record<string, unknown>,
    documentHash: await sha256(serialize(document)),
  };
}
