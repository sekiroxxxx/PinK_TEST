import {
  validateBuildSteps,
  buildStepDependencies,
  type BuildStepsDocument,
} from "./build-steps-contract.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { caseContract } from "./case-contract.js";
import { describeFieldCapabilities, supportedFieldTypes } from "./field-capabilities.js";
import type { CaseValue } from "./finalized-cases.js";
import { configurationFamilies } from "./configuration-operations.js";
import { platformCatalog } from "./platform-catalog.js";
import { contentHash, valueHash } from "./plan-integrity.js";
import { validateConfigurationTargets, type ConfigurationTarget } from "./configuration-targets.js";

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
    return validateBuildSteps(input, validateConfigurationStepsV1);
  return validateConfigurationStepsV1(input);
}
function validateConfigurationStepsV1(input: unknown): ConfigurationStepsDocument {
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
    const fieldTypes = { ...supportedFieldTypes, ...target?.fields };
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
      if (sensitiveConfigurationField(key)) fail(at, "本批不支持在步骤文件内填写或比较敏感值");
      const noReference = (v: unknown): void => {
        if (v && typeof v === "object") {
          if (
            Object.keys(v).some(
              (k) => k.startsWith("$") || ["__proto__", "constructor", "prototype"].includes(k),
            )
          )
            fail(at, "步骤格式尚未接入材料/场景引用或保留键");
          Object.values(v).forEach(noReference);
        }
      };
      noReference(value);
      caseContract.validateValue(key, value, fieldTypes[key], at);
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
            ...configurationFamilies(selected).flatMap((f) => [f.parent, ...f.children]),
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
              ? capability.operation !== "set-target-and-read-back"
              : !Object.hasOwn(target?.fields ?? {}, key)
          )
            fail(at, "该字段需要尚未接入步骤格式的专用操作");
          literal(key, step.value, `${at}.value`);
          if (
            step.input !== undefined &&
            (typeof step.input !== "string" || !["string", "number"].includes(fieldTypes[key].kind))
          )
            fail(at, "input 仅用于文本或数值输入");
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

export async function loadConfigurationSteps(file: string): Promise<LoadedConfigurationSteps> {
  const path = resolve(file);
  const bytes = await readFile(path);
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("步骤用例文件不是有效 JSON（内容已省略）");
  }
  const document = validateConfigurationSteps(raw);
  return { path, sourceSha256: contentHash(bytes), documentSha256: valueHash(document), document };
}

export function configurationStepsPlan(loaded: LoadedConfigurationSteps) {
  const document = validateConfigurationSteps(loaded.document);
  if (valueHash(document) !== loaded.documentSha256)
    throw new Error("已加载用例被修改，请重新加载文件");
  return {
    kind: "pink-configuration-steps-plan",
    schemaVersion: document.schemaVersion,
    phase: "offline",
    runtimeVerified: false,
    buildSubmitted: false,
    ...(document.schemaVersion === 2
      ? {
          execution: {
            willSubmit: document.cases.some((c) => c.steps.some((s) => s.op === "build.submit")),
            maxTasksPerCase: 1,
            maxTasksPerGroup: 1,
            scheduling: "serial",
            associationTimeoutMs: 30_000,
            queueTimeoutMs: 1_800_000,
            buildTimeoutMs: 600_000,
          },
        }
      : {}),
    sourceSha256: loaded.sourceSha256,
    documentSha256: loaded.documentSha256,
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
