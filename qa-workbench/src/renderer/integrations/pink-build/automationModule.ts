import sourceText from "@pink-data/public-combinations.json?raw";
import formText from "@pink-data/form-validation-design.json?raw";
import type { CatalogDocument } from "@pink-build/case-contract";
import { contentSchema, type Mount } from "../../../shared/content";
import { loadAuthoringAdapter, emptyBuildEditor } from "./authoringAdapter";
import {
  displayValue,
  serialize,
  sha256,
} from "../../features/structured/contract";
import { flatten, type EditNode } from "../../features/structured/authoring";
import { hasHostAccess } from "../../browserBridge";
import {
  automationTargetLabel,
  type AutomationTarget,
} from "../../../shared/automation";
import {
  isStepDocument,
  loadNativeAuthoring,
  type NativeDescription,
  nativeFieldLabels,
} from "./nativeAuthoringAdapter";
import {
  compositionAuthoring,
  isComposition,
  type CompositionDescription,
} from "./compositionAuthoring";
import type { ExecutionAdjustment } from "../../features/automation/modules";
import { caseReferences } from "./caseReferences";

export async function loadModule(context?: {
  sources?: Mount[];
  document?: Record<string, unknown>;
}) {
  const description = hasHostAccess
    ? ((await window.qa.authorAutomation({
        moduleId: "pink-build",
        action: "describe",
      })) as unknown as NativeDescription)
    : undefined;
  if (!description)
    throw new Error(
      "请先连接本机自动化模块以读取正式编辑描述。已有数据和草稿仍保留。",
    );
  const legacy = await loadAuthoringAdapter(
    (
      description as unknown as {
        fields: { supportedFields: Parameters<typeof loadAuthoringAdapter>[0] };
      }
    ).fields.supportedFields,
  );
  if (
    description &&
    (description.kind !== "pink-native-case-capabilities" ||
      typeof description.capabilityVersion !== "string" ||
      !description.capabilityVersion.trim())
  )
    throw new Error("自动化工具的描述版本不匹配，请核对工具位置。");
  const baseNative = description
    ? await loadNativeAuthoring(legacy, description)
    : legacy;
  // Older installed modules retain their existing native, whole-file execution.
  // A failed optional description never grants composition capabilities.
  let canCompose = false;
  let compositionDescription: CompositionDescription | undefined;
  try {
    const composition = await window.qa.authorAutomation({
      moduleId: "pink-build",
      action: "describeComposition",
    });
    canCompose =
      composition.kind === "pink-case-composition-capabilities" &&
      composition.schemaVersion === 1;
    if (canCompose)
      compositionDescription = composition as unknown as CompositionDescription;
  } catch {
    canCompose = false;
  }
  const references = caseReferences();
  async function loadReferences(document: Record<string, unknown>) {
    if (!canCompose) return;
    const documents = isComposition(document)
      ? (
          (document.sources as { document: Record<string, unknown> }[]) || []
        ).map((source) => source.document)
      : [document];
    await Promise.all(documents.map((source) => references.load(source)));
  }
  const documents = [
    ...(context?.document ? [context.document] : []),
    ...(context?.sources || []).flatMap((source) =>
      source.editor?.moduleId === "pink-build" ? [source.editor.document] : [],
    ),
  ].flatMap((document) =>
    isComposition(document)
      ? (
          (document.sources as { document: Record<string, unknown> }[]) || []
        ).map((source) => source.document)
      : [document],
  );
  if (canCompose)
    await Promise.all(
      documents.map((document) =>
        references.load(document).catch(() => undefined),
      ),
    );
  if (context?.document) await loadReferences(context.document);
  const native = canCompose ? references.adapter(baseNative) : baseNative;
  const composition = compositionDescription
    ? compositionAuthoring(
        native,
        description,
        compositionDescription,
        context?.sources || [],
      )
    : undefined;
  const adapter = composition?.adapter || native;
  function caseIds(doc: Record<string, unknown>, unitIds: string[]) {
    const tree = adapter.tree(doc);
    const definitions = new Map(
      flatten(tree)
        .filter((node) => node.definitionId)
        .map((node) => [node.id, node.definitionId!]),
    );
    return [
      ...new Set(
        unitIds.flatMap((id) => {
          if (definitions.has(id)) return [definitions.get(id)!];
          const node = flatten(tree).find((node) => node.id === id);
          return node
            ? flatten(node.children || []).flatMap((child) =>
                child.selectable && child.definitionId
                  ? [child.definitionId]
                  : [],
              )
            : [];
        }),
      ),
    ];
  }
  async function importDocument(value: unknown) {
    const document = value as Record<string, unknown>;
    if (isStepDocument(document) && !description)
      throw new Error(
        "步骤文件需要本机自动化模块提供正式描述与校验，请先连接本机服务。",
      );
    await adapter.validate(document);
    await loadReferences(document);
    return {
      moduleId: "pink-build",
      descriptionHash: adapter.hash,
      document,
      documentHash: await sha256(serialize(document)),
    };
  }
  return {
    adapter,
    importDocument,
    canCompose,
    ...(composition
      ? {
          executionOptions: composition.executionOptions,
          originNode: (doc: Record<string, unknown>, path: string[]) =>
            isComposition(doc)
              ? JSON.stringify(["composition", "instance", ...path])
              : undefined,
          presentation: composition.presentation,
          async newComposition(source?: Mount) {
            const document = source?.editor
              ? isComposition(source.editor.document)
                ? structuredClone(source.editor.document)
                : await window.qa.authorAutomation({
                    moduleId: "pink-build",
                    action: "createComposition",
                    document: structuredClone(source.editor.document),
                    sourceId:
                      "source-" +
                      source.id +
                      "-" +
                      source.editor.documentHash.slice(0, 12),
                  })
              : {
                  kind: "pink-case-composition",
                  schemaVersion: 1,
                  sources: [],
                  fragments: [],
                  nodes: [],
                };
            if (
              source?.editor &&
              !isComposition(source.editor.document) &&
              !isStepDocument(source.editor.document)
            )
              document.nodes = [];
            return importDocument(document);
          },
        }
      : {}),
    caseIds,
    async prepareExecution(
      doc: Record<string, unknown>,
      unitIds: string[],
      mode: "configuration" | "build",
      adjustments?: Record<string, ExecutionAdjustment>,
    ) {
      if (isComposition(doc)) {
        if (!composition) throw new Error("当前工具未提供组合能力。");
        const definition = composition.executionDefinition(doc, mode);
        const selection = composition.selection(doc, unitIds, adjustments);
        await composition.validateSelection(definition, selection);
        return {
          inputKind: "composition" as const,
          document: definition,
          caseIds: [],
          selection,
        };
      }
      const ids = caseIds(doc, unitIds);
      if (!ids.length) throw new Error("所选内容没有可执行用例。");
      if (Array.isArray(doc.platforms) && Array.isArray(doc.templates))
        return {
          inputKind: "native" as const,
          document: { ...structuredClone(doc), executionOrder: ids },
          caseIds: ids,
        };
      if (!canCompose)
        return { inputKind: "native" as const, document: doc, caseIds: ids };
      const definition = await window.qa.authorAutomation({
        moduleId: "pink-build",
        action: "createComposition",
        document: doc,
      });
      const nodes = definition.nodes as {
        id: string;
        kind: string;
        caseId: string;
        endpoint?: "ui";
      }[];
      if (definition.kind !== "pink-case-composition" || !Array.isArray(nodes))
        throw new Error("工具未提供有效的用例引用结构；未生成计划。");
      if (!isStepDocument(doc) && mode === "configuration")
        nodes.forEach((node) => {
          if (node.kind === "case-ref") node.endpoint = "ui";
        });
      return {
        inputKind: "composition" as const,
        document: definition,
        caseIds: [],
        selection: {
          items: ids.map((caseId) => {
            const node = nodes.find(
              (node) => node.kind === "case-ref" && node.caseId === caseId,
            );
            if (!node)
              throw new Error("所选用例不在工具返回的引用结构中：" + caseId);
            return { path: [node.id] };
          }),
        },
      };
    },
    empty: async () =>
      description
        ? importDocument(
            await window.qa.authorAutomation({
              moduleId: "pink-build",
              action: "template",
              input: {
                caseId: "qa.configuration-check",
                platform: (JSON.parse(sourceText) as CatalogDocument)
                  .platforms[0].id,
                values: { name: "QA_configuration_check" },
              },
            }),
          )
        : emptyBuildEditor(),
    catalog: () =>
      importDocument({
        ...JSON.parse(sourceText),
        formValidation: JSON.parse(formText),
      }),
    preview(value: Record<string, unknown>, id: string, name: string) {
      if (isComposition(value)) {
        if (!composition) throw new Error("当前工具未提供组合能力。");
        return composition.preview(value, id, name);
      }
      if (isStepDocument(value)) {
        const cases = value.cases as {
          caseId: string;
          platform?: string;
          target?: AutomationTarget;
          steps: Record<string, unknown>[];
          finally?: Record<string, unknown>[];
        }[];
        const definitions = adapter.tree(value)[0]?.children || [];
        return contentSchema.parse({
          kind: "qa-test-content",
          schemaVersion: 1,
          id,
          name,
          groups: [
            {
              id: "native-chain",
              title: "原生执行链路",
              units: cases.map((item) => ({
                id: JSON.stringify(["native", "case", cases.indexOf(item)]),
                title: item.caseId,
                summary: `${automationTargetLabel(item)} · ${item.steps.length} 个操作${item.finally?.length ? ` · ${item.finally.length} 个收尾步骤` : ""}`,
                stages: ["执行检查", "恢复与收尾"],
                details: [
                  {
                    title: "执行定义",
                    fields: [
                      { label: "测试对象", value: automationTargetLabel(item) },
                      { label: "格式", value: `步骤 v${value.schemaVersion}` },
                    ],
                  },
                ],
                steps: [],
                outline: ["steps", "finally"].flatMap((section) => {
                  const operations =
                    (section === "steps" ? item.steps : item.finally) || [];
                  const branch = definitions[
                    cases.indexOf(item)
                  ]?.children?.find(
                    (node) =>
                      node.id ===
                      JSON.stringify([
                        "native",
                        "section",
                        cases.indexOf(item),
                        section,
                      ]),
                  );
                  const names = nativeFieldLabels(value, item.platform);
                  return operations.length
                    ? [
                        {
                          id: `${item.caseId}:${section}`,
                          kind: "group",
                          title:
                            section === "steps"
                              ? "操作步骤"
                              : "收尾与恢复（异常或停止后仍执行）",
                          children: operations.map((step, position) => ({
                            id: String(step.id),
                            kind: "step",
                            title: (
                              branch?.children?.[position]?.title ||
                              String(step.op)
                            ).replace(/^\d+\.\s*/, ""),
                            action: Object.entries(step)
                              .filter(([key]) => !["id", "op"].includes(key))
                              .map(
                                ([key, val]) =>
                                  `${names[key] || key}：${key === "field" ? names[String(val)] || val : displayValue(val)}`,
                              )
                              .join("；"),
                            expected:
                              section === "finally"
                                ? "按用例定义完成收尾与恢复。"
                                : (
                                    branch?.children?.[position] as
                                      EditNode | undefined
                                  )?.associations
                                    ?.map(
                                      (pair) =>
                                        `${pair.title}：${displayValue(pair.fields.find((cell) => cell.field.key.startsWith("linked-expectation:"))?.field.value)}`,
                                    )
                                    .join("；") || "",
                          })),
                        },
                      ]
                    : [];
                }),
              })),
            },
          ],
        });
      }
      const doc = value as unknown as CatalogDocument;
      const tree = adapter.tree(value);
      const nodes = new Map(flatten(tree).map((n) => [n.id, n]));
      function unit(node: EditNode, expected: string, summaryKeys: string[]) {
        const fields = node.fields || [];
        const summary = summaryKeys
          .flatMap((key) => {
            const field = fields.find((f) => f.key === key);
            if (
              field?.condition &&
              fields.find((f) => f.key === field.condition!.field)?.value !==
                field.condition.equals
            )
              return [];
            return field && field.value !== undefined
              ? [
                  `${field.label}：${field.display ?? field.options?.find((o) => o.value === field.value)?.label ?? displayValue(field.value)}`,
                ]
              : [];
          })
          .join(" · ");
        return {
          id: node.id,
          title: node.title,
          summary,
          details: [...new Set(fields.map((f) => f.section || "用例说明"))].map(
            (title) => ({
              title,
              fields: fields
                .filter((f) => (f.section || "用例说明") === title)
                .map((f) => ({
                  label: f.label,
                  value:
                    f.display ??
                    f.options?.find((o) => o.value === f.value)?.label ??
                    displayValue(f.value) ??
                    "未指定",
                })),
            }),
          ),
          stages: ["执行检查"],
          // One combination/check is one execution unit. Configuration fields
          // describe the unit; they are not invented executable steps.
          steps: [
            {
              id: node.definitionId || node.id,
              title: node.title,
              action: summary,
              expected,
            },
          ],
        };
      }
      const groups = doc.platforms.map((p) => ({
        id: JSON.stringify(["platform", p.id]),
        title: p.label,
        units: p.combinations
          .filter((c) => c.template !== "conditional")
          .flatMap((c) => [
            nodes.get(JSON.stringify(["combo", p.id, c.id]))!,
            ...c.variants.map((_, i) =>
              nodes.get(JSON.stringify(["variant", p.id, c.id, i]))!,
            ),
          ])
          .map((node) =>
            unit(node, "按该组合的配置与执行侧规则核验。", [
              "value:debug",
              "value:sourceMaps",
              "value:mainBundleCompressionType",
              ...(p.id === "web-mobile"
                ? ["value:packages.web-mobile.orientation"]
                : []),
            ]),
          ),
      }));
      for (const group of doc.formValidation?.cases || []) {
        const samples = group.samples.filter(
          (sample) =>
            !sample.executionBlocker &&
            !!(sample.execution || sample.executionByPlatform),
        );
        if (samples.length)
          groups.push({
            id: JSON.stringify(["group", group.id]),
            title: group.title,
            units: samples.flatMap((sample) => {
              const node = nodes.get(
                JSON.stringify(["sample", group.id, sample.id]),
              )!;
              return (
                node.selectable
                  ? [node]
                  : (node.children as EditNode[] | undefined)?.filter(
                      (child) => child.selectable,
                    ) || []
              ).map((binding) =>
                unit(
                  binding.id === node.id
                    ? node
                    : {
                        ...node,
                        id: binding.id,
                        definitionId: binding.definitionId,
                        title: binding.title,
                      },
                  typeof sample.prompt === "string"
                    ? sample.prompt
                    : "按用例断言核验。",
                  [
                    "execution:value",
                    "execution:alertKind",
                    "execution:alertText",
                  ],
                ),
              );
            }),
          });
      }
      return contentSchema.parse({
        kind: "qa-test-content",
        schemaVersion: 1,
        id,
        name,
        groups,
      });
    },
  };
}
