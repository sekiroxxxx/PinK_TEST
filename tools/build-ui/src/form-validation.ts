import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  ConfigurationOperations,
  configurationFamilies,
  configurationEqual as equal,
  type ConfigurationPort,
  type ConfigurationRecord,
} from "./configuration-operations.js";
import { ConfigurationOperationError } from "./configuration-context.js";
import {
  caseContract,
  type CatalogDocument,
  type FormValidationDocument,
  type FormValidationExecution,
} from "./case-contract.js";
import { valueHash } from "./plan-integrity.js";
import type { CaseValue } from "./finalized-cases.js";

export interface LoadedFormSample {
  sampleId: string;
  sourceSha256: string;
  execution: FormValidationExecution;
}
export interface FormSampleEvidence {
  sampleId: string;
  sourceSha256: string;
  submitted: false;
  assertions: Array<{ phase: string; field: string; passed: boolean }>;
  restoration: "pending" | "passed" | "failed";
  changedFields: string[];
  preparedFields: string[];
}
/** This port deliberately has no build, task mutation, or arbitrary script operation. */
export interface FormSamplePort extends ConfigurationPort {}

export class FormSampleError extends Error {
  constructor(
    message: string,
    readonly evidence: FormSampleEvidence,
    readonly prerequisite = false,
  ) {
    super(message);
  }
}

export async function loadFormValidation(
  catalog: CatalogDocument,
  catalogPath?: string,
): Promise<FormValidationDocument> {
  let source = catalog.formValidation;
  if (!source) {
    const builtin = fileURLToPath(
      new URL("../../case-catalog/public-combinations.json", import.meta.url),
    );
    if (catalogPath && resolve(catalogPath).toLowerCase() !== resolve(builtin).toLowerCase())
      throw new Error("外部用例文件缺少 formValidation；请重新从当前页面导出，不混用本机样本");
    source = JSON.parse(
      await readFile(
        new URL("../../case-catalog/form-validation-design.json", import.meta.url),
        "utf8",
      ),
    );
  }
  return caseContract.validate({ ...catalog, formValidation: source }).formValidation!;
}

export function formSourceHash(doc: FormValidationDocument): string {
  return valueHash(doc);
}

/** Executes the real observation/assertion/restoration logic. No product rules are inferred here. */
export async function runFormSample(
  port: ConfigurationOperations,
  sample: LoadedFormSample,
): Promise<FormSampleEvidence> {
  const e = sample.execution;
  const evidence: FormSampleEvidence = {
    sampleId: sample.sampleId,
    sourceSha256: sample.sourceSha256,
    submitted: false,
    assertions: [],
    restoration: "pending",
    changedFields: [],
    preparedFields: [],
  };
  let recovery: ConfigurationRecord | undefined;
  const affectedFamilies = configurationFamilies([
    e.field,
    ...(e.prepare ?? []).map((a) => a.field),
    ...(e.setup ?? []).map((a) => a.field),
  ]);
  if (e.kind === "parent-visibility" && !affectedFamilies.some((f) => f.parent === e.field))
    affectedFamilies.push({ parent: e.field, enabled: !e.value, children: [e.child!] });
  let failure: string | undefined;
  let prerequisite = false;
  let buttonAtStart: boolean | undefined;
  const check = (phase: string, field: string, passed: boolean) => {
    evidence.assertions.push({ phase, field, passed });
    port.check(phase, field, passed);
  };
  try {
    buttonAtStart = await port.primaryBuildEnabled();
    if (!buttonAtStart) {
      prerequisite = true;
      throw new Error("反向样本初态构建按钮不可用；未修改配置");
    }
    const keys = [
      ...new Set([
        ...(e.setup ?? []).map((a) => a.field),
        ...(e.prepare ?? []).map((a) => a.field),
        e.field,
        ...(e.child ? [e.child] : []),
        ...(e.unchanged ?? []),
        ...(e.after ?? []).map((a) => a.field),
        ...affectedFamilies.flatMap((f) => [f.parent, ...f.children]),
      ]),
    ];
    recovery = await port.record(keys, affectedFamilies, buttonAtStart);
    const { initial, restore, prompts: originalErrors } = recovery;
    // Explicit preparation may supply a missing value; preserve nonempty invalid user input.
    const preparesEmptyTarget =
      initial.get(e.field)?.value === "" &&
      e.prepare?.some((a) => a.field === e.field && typeof a.value === "string" && a.value !== "");
    if (e.prepare?.length && originalErrors.get(e.field)?.length && !preparesEmptyTarget) {
      prerequisite = true;
      throw new Error(`初态字段已有错误：${e.field}；不覆盖用户已有异常配置`);
    }
    for (const f of affectedFamilies) {
      const parent = initial.get(f.parent);
      if (
        parent?.value === !f.enabled &&
        f.parent.endsWith("useDebugKeystore") &&
        f.children.some((k) => initial.get(k)?.value)
      ) {
        prerequisite = true;
        throw new Error("调试签名初态存在未清空子值；不清除用户数据制造通过");
      }
    }
    for (const a of [...(e.prepare ?? []), ...(e.setup ?? [])]) {
      if (!(await port.inspect(a.field))) {
        prerequisite = true;
        throw new Error(`前提控件当前不可用：${a.field}`);
      }
      if (await port.set(a.field, a.value)) evidence.changedFields.push(a.field);
      check("prepare-readback", a.field, equal((await port.read(a.field)).value, a.value));
      if (e.prepare?.includes(a)) evidence.preparedFields.push(a.field);
    }
    for (const key of e.requiresNonEmpty ?? []) {
      if (!(await port.read(key)).value) {
        prerequisite = true;
        throw new Error(`缺合法非空初态：${key}；不自动填充材料或其他错误项`);
      }
    }
    const before = await port.read(e.field);
    const unchangedBefore = new Map<string, CaseValue>();
    for (const key of e.unchanged ?? [])
      unchangedBefore.set(key, structuredClone((await port.read(key)).value));
    if ((await port.alerts(e.field)).length && e.kind === "field-input") {
      prerequisite = true;
      throw new Error(`初态字段已有错误：${e.field}；不覆盖用户已有异常配置`);
    }
    if (!restore.has(e.field)) restore.set(e.field, structuredClone(before));
    if (e.kind === "field-input" || e.kind === "parent-visibility") {
      if (e.input === undefined && equal(before.value, e.value)) {
        prerequisite = true;
        throw new Error(`初态已等于异常目标，不能计本次修改覆盖：${e.field}`);
      }
      const childBefore = e.kind === "parent-visibility" ? await port.read(e.child!) : undefined;
      if (await port.set(e.field, e.value!, e.input)) evidence.changedFields.push(e.field);
      if (e.trigger === "reopen") await port.reopen();
      check("readback", e.field, equal((await port.read(e.field)).value, e.value));
      if (e.kind === "parent-visibility")
        check("child-hidden", e.child!, (await port.inspect(e.child!)) === null);
      if (
        e.kind === "parent-visibility" &&
        e.prepare?.some((a) => a.field === e.field) &&
        restore.has(e.child!)
      ) {
        await port.set(e.field, !e.value);
        check(
          "hidden-child-preserved",
          e.child!,
          equal((await port.read(e.child!)).value, childBefore!.value),
        );
        await port.set(e.field, e.value!);
      }
      if (e.alert) {
        const errors = await port.alerts(e.field);
        check(
          "prompt",
          e.field,
          e.alert.kind === "none"
            ? errors.length === 0
            : errors.some((text) => text.toLowerCase().includes(e.alert!.text!.toLowerCase())),
        );
      }
    } else if (e.kind === "required-choice") {
      check(
        "required-choice-disabled",
        e.field,
        !!before.choices?.some((c) => c.checked && c.disabled),
      );
    } else if (e.kind === "scene-clear-all") {
      const protectedChoices = before.choices?.filter((c) => c.checked && c.disabled) ?? [];
      if (
        protectedChoices.filter((c) => c.protectedReason === "initial-scene").length !== 1 ||
        !port.clearAllScenes
      ) {
        prerequisite = true;
        throw new Error("前提场景初始项无法唯一确认或全选操作未适配");
      }
      await port.clearAllScenes();
      evidence.changedFields.push(e.field);
      check(
        "scene-clear-preserves-initial",
        e.field,
        equal(
          (await port.read(e.field)).value,
          protectedChoices.map((c) => c.value),
        ),
      );
    } else {
      await port.cancelFileChoice(e.field);
      check(
        "cancel-preserves-value",
        e.field,
        equal((await port.read(e.field)).value, before.value),
      );
    }
    for (const key of e.unchanged ?? []) {
      check(
        "preserves-linked-field",
        key,
        unchangedBefore.has(key) && equal((await port.read(key)).value, unchangedBefore.get(key)),
      );
    }
    for (const a of e.after ?? []) {
      const actual = await port.read(a.field);
      check("linked-readback", a.field, equal(actual.value, a.value));
      if (a.disabled !== undefined)
        check("linked-disabled", a.field, actual.disabled === a.disabled);
    }
    check("build-button-enabled", e.field, await port.primaryBuildEnabled());
  } catch (error) {
    if (error instanceof ConfigurationOperationError) {
      if (error.disposition === "stop") throw error;
      prerequisite ||= error.disposition === "blocked";
    }
    // Error messages intentionally exclude observed text and secrets.
    failure =
      error instanceof Error &&
      /^(反向样本|配置断言|初态|缺合法|前提|调试签名|取消文件选择改变了原路径)/.test(error.message)
        ? error.message
        : `反向样本操作失败：${e.field}（值已省略）`;
  }
  try {
    if (recovery) await port.restore(recovery, check, e.trigger === "reopen");
    else if (buttonAtStart !== undefined)
      check("restore-build-button", e.field, (await port.primaryBuildEnabled()) === buttonAtStart);
    evidence.restoration = "passed";
  } catch (error) {
    if (error instanceof ConfigurationOperationError && error.code === "context") throw error;
    evidence.restoration = "failed";
    throw new FormSampleError("条件用例配置恢复失败；停止后续提交，保留当前现场", evidence);
  }
  if (failure) throw new FormSampleError(failure, evidence, prerequisite);
  return evidence;
}
