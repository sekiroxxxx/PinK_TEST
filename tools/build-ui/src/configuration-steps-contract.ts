import {
  validateBuildSteps,
  buildStepDependencies,
  type BuildStepsDocument,
} from "./build-steps-contract.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { caseContract, type FieldType } from "./case-contract.js";
import { describeFieldCapabilities, supportedFieldTypes } from "./field-capabilities.js";
import type { CaseValue } from "./finalized-cases.js";
import { configurationFamilies } from "./configuration-operations.js";
import { platformCatalog } from "./platform-catalog.js";
import { contentHash, valueHash } from "./plan-integrity.js";
import { validateConfigurationTargets, type ConfigurationTarget } from "./configuration-targets.js";
import { selectedStepCases, scheduledStepCases } from "./step-preflight.js";
import { loadStepInputs, type StepInputs, type StepInputOptions } from "./step-inputs.js";
import { stepObservationFields } from "./configuration-step-values.js";
import { buildStepScheduling, buildStepGroups } from "./build-step-scheduling.js";

export type ConfigurationStep = { id: string } & (
  | { op: "record"; fields: string[] }
  | { op: "set"; field: string; value: CaseValue; input?: string }
  | { op: "read"; fields: string[] }
  | { op: "assert"; check: "values"; snapshot: string; values: Record<string, CaseValue> }
  | {
      op: "assert";
      check: "prompt";
      field: string;
      expected: { kind: "none" | "contains"; text?: string };
    }
  | {
      op: "assert";
      check: "state";
      field: string;
      expected: { visible?: boolean; disabled?: boolean };
    }
  | { op: "restore"; record: string }
);

export interface ConfigurationStepCase {
  caseId: string;
  platform: string;
  onFailure?: "continue" | "stop";
  steps: ConfigurationStep[];
}
export interface ConfigurationStepsDocument {
  kind: "pink-configuration-steps";
  schemaVersion: 1;
  targets?: ConfigurationTarget[];
  cases: ConfigurationStepCase[];
}
export interface LoadedConfigurationSteps {
  path: string;
  sourceSha256: string;
  documentSha256: string;
  document: ConfigurationStepsDocument | BuildStepsDocument;
  inputs?: StepInputs;
  catalog?: {
    source: { path: string; sha256: string; revision: string };
    compilationSha256: string;
    inputs: StepInputs["preview"];
    selection: { cases?: string; groups?: string; endpoint?: "ui" };
    cases: Array<{
      caseId: string;
      title?: string;
      platform: string;
      group: string;
      endpoint: string;
      status: string;
      sourceCaseIds?: string[];
      gaps: Array<{ kind: string; reason: string }>;
    }>;
  };
  verifySource?(): Promise<void>;
}

function fail(path: string, reason: string): never {
  throw new Error(`${path}：${reason}`);
}
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "必须是对象");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[], path: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail(path, "含未支持的属性");
}
function identifier(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][\w.-]*$/.test(value))
    fail(path, "需要有效标识符");
  return value as string;
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value) || !value.length) fail(path, "需要非空数组");
  return value as unknown[];
}
export function sensitiveConfigurationField(field: string): boolean {
  return (
    !!supportedFieldTypes[field]?.sensitive || /(?:password|appkey|xxteaKey|appid)$/i.test(field)
  );
}

/** A separate, bounded format. Legacy four-group/FORM files and validators stay unchanged. */
export function validateConfigurationSteps(
  input: unknown,
): ConfigurationStepsDocument | BuildStepsDocument {
  if (input && typeof input === "object" && "schemaVersion" in input && input.schemaVersion === 2)
    return validateBuildSteps(input, (projection) =>
      validateConfigurationStepsV1(projection, true),
    );
  return validateConfigurationStepsV1(input);
}
function validateConfigurationStepsV1(
  input: unknown,
  references = false,
): ConfigurationStepsDocument {
  const doc = object(input, "document");
  keys(doc, ["kind", "schemaVersion", "cases", "targets"], "document");
  if (doc.kind !== "pink-configuration-steps" || doc.schemaVersion !== 1)
    fail("document", "仅支持 pink-configuration-steps 格式版本 1");
  const caseIds = new Set<string>();
  const targets = validateConfigurationTargets(doc.targets);
  for (const [ci, rawCase] of array(doc.cases, "cases").entries()) {
    const path = `cases[${ci}]`,
      c = object(rawCase, path);
    keys(c, ["caseId", "platform", "steps", "onFailure"], path);
    if (c.onFailure !== undefined && c.onFailure !== "continue" && c.onFailure !== "stop")
      fail(path, "onFailure 仅支持 continue 或 stop");
    const caseId = identifier(c.caseId, `${path}.caseId`);
    if (caseIds.has(caseId)) fail(path, "caseId 重复");
    caseIds.add(caseId);
    const target = targets.find((p) => p.id === c.platform);
    if (!platformCatalog.some((p) => p.id === c.platform) && !target)
      fail(path, "平台尚无现有适配或标准目标描述");
    const fieldTypes: Record<string, FieldType> = {
      ...supportedFieldTypes,
      ...(references ? stepObservationFields : {}),
      ...target?.fields,
    };
    const field = (value: unknown, at: string): string => {
      if (typeof value !== "string" || !Object.hasOwn(fieldTypes, value))
        fail(at, "字段尚无现有适配");
      const key = value as string;
      if (
        key.startsWith("packages.") &&
        !key.startsWith(`packages.${c.platform}.`) &&
        !key.startsWith("packages.localization-editor.")
      )
        fail(at, "字段属于其他平台");
      return key;
    };
    const fields = (value: unknown, at: string) => {
      const result = array(value, at).map((v) => field(v, at));
      if (new Set(result).size !== result.length) fail(at, "字段重复");
      return result;
    };
    const literal = (key: string, value: unknown, at: string) => {
      if (
        sensitiveConfigurationField(key) &&
        !(references && caseContract.reference(value)?.kind === "material")
      )
        fail(at, "敏感字段须使用 v2 材料引用，不能在步骤文件内填写或比较明文");
      const noReference = (v: unknown): void => {
        if (v && typeof v === "object") {
          if (
            Object.keys(v).some(
              (k) =>
                (!references && k.startsWith("$")) ||
                ["__proto__", "constructor", "prototype"].includes(k),
            )
          )
            fail(at, "步骤格式不支持此引用或保留键");
          if (references && Object.keys(v).some((k) => k.startsWith("$"))) {
            if (!caseContract.reference(v)) fail(at, "未知引用格式");
            caseContract.validateValue(key, v, fieldTypes[key], at);
            return;
          }
          Object.values(v).forEach(noReference);
        }
      };
      noReference(value);
      caseContract.validateValue(key, value, { ...fieldTypes[key], choices: undefined }, at);
    };
    let record: string | undefined,
      restored = false,
      revision = 0;
    const recorded = new Set<string>(),
      ids = new Set<string>();
    const snapshots = new Map<string, { revision: number; fields: string[] }>();
    const steps = array(c.steps, `${path}.steps`);
    for (const [si, rawStep] of steps.entries()) {
      const at = `${path}.steps[${si}]`,
        step = object(rawStep, at);
      const id = identifier(step.id, `${at}.id`);
      if (ids.has(id)) fail(at, "步骤 id 重复");
      ids.add(id);
      if (restored) fail(at, "恢复必须是最后一步");
      switch (step.op) {
        case "record": {
          keys(step, ["id", "op", "fields"], at);
          if (record) fail(at, "每项用例只允许一份恢复记录");
          record = id;
          const selected = fields(step.fields, `${at}.fields`);
          for (const key of [
            ...selected,
            ...configurationFamilies(selected, target?.families).flatMap((f) => [
              f.parent,
              ...f.children,
            ]),
          ])
            recorded.add(key);
          break;
        }
        case "set": {
          keys(step, ["id", "op", "field", "value", "input"], at);
          const key = field(step.field, `${at}.field`);
          if (!record || !recorded.has(key)) fail(at, "修改前必须记录该字段或其已支持的联动字段");
          const capability = describeFieldCapabilities().supportedFields.find((f) => f.key === key);
          if (
            capability
              ? capability.operation !== "set-target-and-read-back" &&
                !(
                  references &&
                  (capability.operation === "scene-selection" ||
                    (key === "packages.google-play.customIcon" &&
                      ["default", "custom"].includes(String(step.value))))
                )
              : !Object.hasOwn(target?.fields ?? {}, key)
          )
            fail(at, "该字段需要尚未接入步骤格式的专用操作");
          literal(key, step.value, `${at}.value`);
          if (
            step.input !== undefined &&
            (typeof step.input !== "string" || !["string", "number"].includes(fieldTypes[key].kind))
          )
            fail(at, "input 仅用于文本或数值输入");
          if (step.input !== undefined && sensitiveConfigurationField(key))
            fail(at, "敏感字段不能使用明文 input 覆盖材料");
          revision++;
          break;
        }
        case "read":
          keys(step, ["id", "op", "fields"], at);
          snapshots.set(id, { revision, fields: fields(step.fields, `${at}.fields`) });
          break;
        case "assert": {
          if (step.check === "values") {
            keys(step, ["id", "op", "check", "snapshot", "values"], at);
            const snapshot = snapshots.get(identifier(step.snapshot, `${at}.snapshot`));
            if (!snapshot || snapshot.revision !== revision)
              fail(at, "必须引用前面未过期的回读步骤");
            const expected = object(step.values, `${at}.values`);
            if (!Object.keys(expected).length) fail(at, "断言目标不能为空");
            for (const [key, value] of Object.entries(expected)) {
              field(key, `${at}.values`);
              if (!snapshot.fields.includes(key)) fail(at, "断言字段不在引用快照中");
              literal(key, value, `${at}.values.${key}`);
            }
          } else if (step.check === "prompt" || step.check === "state") {
            keys(step, ["id", "op", "check", "field", "expected"], at);
            field(step.field, `${at}.field`);
            const expected = object(step.expected, `${at}.expected`);
            if (step.check === "prompt") {
              keys(expected, ["kind", "text"], at);
              if (
                expected.kind === "none"
                  ? expected.text !== undefined
                  : expected.kind !== "contains" ||
                    typeof expected.text !== "string" ||
                    !expected.text.trim()
              )
                fail(at, "提示预期需要 none 或 contains 加非空 text");
            } else {
              keys(expected, ["visible", "disabled"], at);
              if (expected.visible === false)
                fail(at, "本批不能用未识别到控件证明隐藏；仅支持 visible=true 和禁用状态检查");
              if (
                !Object.keys(expected).length ||
                Object.values(expected).some((v) => typeof v !== "boolean")
              )
                fail(at, "状态断言需要显隐或禁用布尔值");
            }
          } else fail(at, "未支持的断言类型");
          break;
        }
        case "restore":
          keys(step, ["id", "op", "record"], at);
          if (!record || step.record !== record) fail(at, "必须引用本用例前面的记录步骤");
          if (si !== steps.length - 1) fail(at, "恢复必须是最后一步");
          restored = true;
          break;
        default:
          fail(at, "未支持的操作；不能执行任意脚本或提交构建");
      }
    }
    if (record && !restored) fail(path, "记录后必须声明末尾恢复步骤，失败时也会执行");
  }
  return structuredClone(doc) as unknown as ConfigurationStepsDocument;
}

export async function loadConfigurationSteps(
  file: string,
  options: StepInputOptions = {},
): Promise<LoadedConfigurationSteps> {
  const path = resolve(file);
  const bytes = await readFile(path);
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("步骤用例文件不是有效 JSON（内容已省略）");
  }
  const document = validateConfigurationSteps(raw);
  if (document.schemaVersion === 1 && options.materials)
    throw new Error("材料引用仅支持 v2 步骤文件");
  return {
    path,
    sourceSha256: contentHash(bytes),
    documentSha256: valueHash(document),
    document,
    inputs: document.schemaVersion === 2 ? await loadStepInputs(document, options) : undefined,
  };
}

export function configurationStepsPlan(loaded: LoadedConfigurationSteps) {
  const emptyCatalog =
    loaded.document.schemaVersion === 2 &&
    loaded.document.cases.length === 0 &&
    loaded.catalog?.cases.length &&
    loaded.catalog.cases.every((c) => c.status !== "ready");
  const document = emptyCatalog
    ? structuredClone(loaded.document)
    : validateConfigurationSteps(loaded.document);
  if (
    loaded.catalog &&
    JSON.stringify(
      loaded.catalog.cases.filter((c) => c.status === "ready").map((c) => c.caseId),
    ) !== JSON.stringify(document.cases.map((c) => c.caseId))
  )
    throw new Error("四组迁移中的可运行集合与步骤文件不一致");
  if (valueHash(document) !== loaded.documentSha256)
    throw new Error("已加载用例被修改，请重新加载文件");
  if (loaded.inputs && loaded.inputs.preview.documentSha256 !== loaded.documentSha256)
    throw new Error("材料/场景绑定不属于当前步骤文件，请重新加载");
  const preflight = selectedStepCases(loaded);
  const readyIds = new Set(preflight.filter((c) => c.status === "ready").map((c) => c.caseId));
  const execution: { willSubmit: boolean } & Partial<
    typeof buildStepScheduling & {
      groups: ReturnType<typeof buildStepGroups>;
      associationTimeoutMs: number;
      queueTimeoutMs: number;
      buildTimeoutMs: number;
    }
  > =
    document.schemaVersion === 1
      ? { willSubmit: false }
      : {
          willSubmit: document.cases.some(
            (c) => readyIds.has(c.caseId) && c.steps.some((s) => s.op === "build.submit"),
          ),
          ...buildStepScheduling,
          groups: buildStepGroups(scheduledStepCases(document, preflight)),
          associationTimeoutMs: 30_000,
          queueTimeoutMs: 1_800_000,
          buildTimeoutMs: 600_000,
        };
  return {
    kind: "pink-configuration-steps-plan",
    schemaVersion: document.schemaVersion,
    capabilityVersion: "2",
    phase: "offline",
    runtimeVerified: false,
    buildSubmitted: false,
    execution,
    preflight,
    sourceSha256: loaded.sourceSha256,
    documentSha256: loaded.documentSha256,
    ...(loaded.catalog ? { catalog: structuredClone(loaded.catalog) } : {}),
    ...(loaded.inputs ? { inputs: loaded.inputs.preview } : {}),
    targets: document.targets ?? [],
    cases:
      document.schemaVersion === 2
        ? document.cases.map((c) => ({
            ...c,
            dependencies: buildStepDependencies(c),
            failurePolicy:
              "collect-owned-task-before-cleanup; stop-on-uncertain-submission-or-context; restore-only-when-safe",
          }))
        : document.cases.map((c) => ({
            ...c,
            dependencies: c.steps.map((step) => ({
              id: step.id,
              requires:
                step.op === "restore"
                  ? [step.record]
                  : step.op === "assert" && step.check === "values"
                    ? [step.snapshot]
                    : step.op === "set"
                      ? [c.steps.find((s) => s.op === "record")!.id]
                      : [],
            })),
            failurePolicy:
              "skip-remaining-steps; restore-if-recorded; continue-next-case-only-after-safe-recovery",
          })),
    restorationScope: "explicit-record-fields-and-existing-linked-field-families",
  };
}
