import { runObservedFormSample as runFormSample } from "./configuration-test-port.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { caseContract, type CatalogDocument } from "./case-contract.js";
import {
  loadFormValidation,
  FormSampleError,
  type FormSamplePort,
  type LoadedFormSample,
} from "./form-validation.js";
import { selectFinalizedCases } from "./finalized-cases.js";
import { createOfflinePlan } from "./offline-plan.js";
import type { CaseControl } from "./case-form.js";

const catalog = JSON.parse(
  await readFile(new URL("../../case-catalog/public-combinations.json", import.meta.url), "utf8"),
) as CatalogDocument;
const forms = await loadFormValidation(catalog);
const sample: LoadedFormSample = {
  sampleId: "FORM-C01.s01",
  sourceSha256: "offline-fixture",
  execution: structuredClone(forms.cases.find((c) => c.id === "FORM-C01")!.samples[0].execution!),
};
const control = (value: string): CaseControl => ({
  value,
  selector: "#name",
  kind: "string",
  disabled: false,
});

/** Scripted UI observations test the real runner, not PinK's validation rules. */
function observations(
  prompts: string[][],
  options: { restoreFails?: boolean; buttons?: boolean[]; initial?: string } = {},
) {
  let value = options.initial ?? "Original QA name";
  const inputs: unknown[] = [];
  const errors = structuredClone(prompts);
  const buttons = [...(options.buttons ?? [true, true, true])];
  const port: FormSamplePort = {
    inspect: async () => control(value),
    read: async () => control(value),
    set: async (_field, next) => {
      inputs.push(next);
      value = String(next);
      return true;
    },
    restoreControl: async (_field, original) => {
      if (!options.restoreFails) value = String(original.value);
    },
    alerts: async () => {
      assert.ok(errors.length, "unexpected prompt observation");
      return errors.shift()!;
    },
    primaryBuildEnabled: async () => {
      assert.ok(buttons.length, "unexpected button observation");
      return buttons.shift()!;
    },
    reopen: async () => assert.fail("input-trigger sample must not reopen"),
    cancelFileChoice: async () => assert.fail("name sample must not open a file picker"),
  };
  return { port, inputs, value: () => value };
}

test("explicit FORM loading uses typed targets; shared UI is limited to web-desktop", async () => {
  const selected = await selectFinalizedCases("FORM-C01", undefined, {}, { catalog });
  assert.deepEqual(
    selected.map((c) => c.caseId),
    ["FORM-C01.s01.web-desktop", "FORM-C01.s02.web-desktop"],
  );
  assert.equal(selected[0].finalized!.endpoint, "ui");
  assert.deepEqual(selected[0].finalized!.formValidation!.execution.alert, {
    kind: "contains",
    text: "此项为必填项",
  });
  const exported = { ...structuredClone(catalog), formValidation: structuredClone(forms) };
  exported.formValidation.cases[0].samples[0].execution!.value = "QA revised input";
  const modified = await selectFinalizedCases(
    "FORM-C01.s01.web-desktop",
    undefined,
    {},
    { catalog: exported, catalogPath: join(tmpdir(), "qa-export.json") },
  );
  assert.equal(modified[0].finalized!.formValidation!.execution.value, "QA revised input");
  assert.notEqual(
    modified[0].finalized!.formValidation!.sourceSha256,
    selected[0].finalized!.formValidation!.sourceSha256,
  );
  await assert.rejects(
    loadFormValidation(catalog, join(tmpdir(), "foreign.json")),
    /缺少 formValidation/,
  );
  const platformSamples = await selectFinalizedCases("FORM-Q01.s17", undefined, {}, { catalog });
  assert.equal(platformSamples.length, 4);
  for (const item of platformSamples) {
    assert.equal(
      item.finalized!.formValidation!.execution.field,
      `packages.${item.platform}.versionCode`,
    );
    assert.equal(item.finalized!.formValidation!.execution.value, "0");
  }
});

test("form contract rejects unregistered fields, another platform and build actions", () => {
  for (const change of [
    { field: "unknownField" },
    { field: "packages.android.packageName" },
    { kind: "build" },
    { input: "unchecked raw text" },
  ]) {
    const doc = { ...structuredClone(catalog), formValidation: structuredClone(forms) };
    Object.assign(doc.formValidation.cases[0].samples[0].execution!, change);
    assert.throws(() => caseContract.validate(doc));
  }
});

test("runner checks prompt and button observations and restores the legal initial value", async () => {
  const fixture = observations([[], [], ["此项为必填项"], []]);
  const result = await runFormSample(fixture.port, sample);
  assert.equal(result.submitted, false);
  assert.equal(result.restoration, "passed");
  assert.equal(fixture.value(), "Original QA name");
  assert.deepEqual(fixture.inputs, [""]);
  assert.ok(result.assertions.some((a) => a.phase === "prompt" && a.passed));
});

test("missing prompt or unexpected disabled button fails while preserving recovery evidence", async () => {
  for (const fixture of [
    observations([[], [], [], []]),
    observations([[], [], ["此项为必填项"], []], { buttons: [true, false, true] }),
  ]) {
    await assert.rejects(
      runFormSample(fixture.port, sample),
      (error: unknown) =>
        error instanceof FormSampleError &&
        !error.prerequisite &&
        error.evidence.restoration === "passed" &&
        error.evidence.assertions.some((a) => !a.passed),
    );
    assert.equal(fixture.value(), "Original QA name");
  }
});

test("a target already present is blocked rather than counted; failed restoration is fatal", async () => {
  const noEdit = observations([[], [], []], { initial: "", buttons: [true, true] });
  await assert.rejects(
    runFormSample(noEdit.port, sample),
    (error: unknown) =>
      error instanceof FormSampleError &&
      error.prerequisite &&
      error.evidence.restoration === "passed",
  );
  assert.deepEqual(noEdit.inputs, []);
  const failed = observations([[], [], ["此项为必填项"]], { restoreFails: true });
  await assert.rejects(
    runFormSample(failed.port, sample),
    (error: unknown) =>
      error instanceof FormSampleError &&
      error.message.includes("条件用例配置恢复失败") &&
      error.evidence.restoration === "failed",
  );
});

test("an initially disabled button is blocked without a false restoration failure", async () => {
  const fixture = observations([], { buttons: [false, false] });
  await assert.rejects(
    runFormSample(fixture.port, sample),
    (error: unknown) =>
      error instanceof FormSampleError &&
      error.prerequisite &&
      error.evidence.restoration === "passed",
  );
  assert.deepEqual(fixture.inputs, []);
});

test("offline preview binds edited sample content into the plan hash and never submits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pink-form-plan-"));
  try {
    const path = join(directory, "cases.json");
    const doc = { ...structuredClone(catalog), formValidation: structuredClone(forms) };
    await writeFile(path, JSON.stringify(doc));
    const options = { casesFile: path, cases: "FORM-C01.s01.web-desktop" };
    const first = await createOfflinePlan(options);
    assert.equal(first.buildSubmitted, false);
    assert.equal(first.runtimeVerified, false);
    assert.equal(first.cases[0].endpoint, "ui");
    doc.formValidation.cases[0].samples[0].execution!.alert = { kind: "none" };
    await writeFile(path, JSON.stringify(doc));
    const second = await createOfflinePlan(options);
    assert.notEqual(first.integrity.sha256, second.integrity.sha256);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("hidden children are restored while accessible before the parent returns to its initial state", async () => {
  const execution = structuredClone(
    forms.cases.find((c) => c.id === "FORM-C08")!.samples[0].execution!,
  );
  const parent = execution.field;
  const child = execution.child!;
  const values: Record<string, boolean> = { [parent]: true, [child]: true };
  const current = (field: string): CaseControl | null =>
    field === child && !values[parent]
      ? null
      : { value: values[field], kind: "boolean", disabled: false, selector: "#observed" };
  const port: FormSamplePort = {
    inspect: async (field) => current(field),
    read: async (field) => {
      const c = current(field);
      assert.ok(c, "hidden child cannot be read");
      return c;
    },
    alerts: async () => [],
    primaryBuildEnabled: async () => true,
    set: async (field, value) => {
      assert.ok(current(field), "hidden child cannot be edited");
      values[field] = Boolean(value);
      return true;
    },
    restoreControl: async (field, original) => {
      assert.ok(current(field), "restore needs visible child");
      values[field] = Boolean(original.value);
    },
    reopen: async () => assert.fail("not required"),
    cancelFileChoice: async () => assert.fail("not required"),
  };
  const result = await runFormSample(port, { ...sample, execution });
  assert.equal(result.restoration, "passed");
  assert.deepEqual(values, { [parent]: true, [child]: true });
  assert.ok(result.assertions.some((a) => a.phase === "child-hidden" && a.passed));
});

test("an input operation that mutates and then throws still triggers restoration", async () => {
  const fixture = observations([[], [], []]);
  const set = fixture.port.set;
  fixture.port.set = async (...args) => {
    await set(...args);
    throw new Error("transport failed after input");
  };
  await assert.rejects(
    runFormSample(fixture.port, sample),
    (error: unknown) => error instanceof FormSampleError && error.evidence.restoration === "passed",
  );
  assert.equal(fixture.value(), "Original QA name");
});

test("AGC cancellation detects an unintended package-name change and restores both fields", async () => {
  const execution = structuredClone(
    forms.cases.find((c) => c.id === "FORM-A01")!.samples[0].execution!,
  );
  // This controller fixture already supplies valid initial paths; material preparation is
  // covered separately. Isolate the unintended side effect of cancellation here.
  execution.prepare = [];
  const packageField = "packages.huawei-agc.packageName";
  const initial = {
    [execution.field]: "offline-fixture.json",
    [packageField]: "com.pink.qa.original",
  };
  const values = { ...initial };
  const port: FormSamplePort = {
    inspect: async (field) => control(values[field]),
    read: async (field) => control(values[field]),
    alerts: async () => [],
    primaryBuildEnabled: async () => true,
    set: async () => assert.fail("cancellation must not type a new value"),
    restoreControl: async (field, original) => {
      values[field] = String(original.value);
    },
    cancelFileChoice: async () => {
      values[packageField] = "unexpected-package-change";
    },
    reopen: async () => assert.fail("not required"),
  };
  await assert.rejects(
    runFormSample(port, { ...sample, execution }),
    (error: unknown) =>
      error instanceof FormSampleError &&
      error.evidence.restoration === "passed" &&
      error.evidence.assertions.some((a) => a.phase === "preserves-linked-field" && !a.passed),
  );
  assert.deepEqual(values, initial);
});

test("returning to debug signing checks cleared children and disabled state separately", async () => {
  const execution = structuredClone(
    forms.cases.find((c) => c.id === "FORM-N01")!.samples.find((s) => s.id === "FORM-N01.s05")!
      .execution!,
  );
  for (const disabledObserved of [true, false]) {
    const values: Record<string, string | boolean> = {
      [execution.field]: false,
      ...Object.fromEntries(execution.after!.map((a) => [a.field, "offline-initial-value"])),
    };
    const initial = structuredClone(values);
    const current = (field: string): CaseControl => ({
      value: values[field],
      kind: typeof values[field] === "boolean" ? "boolean" : "string",
      disabled: field !== execution.field && values[execution.field] === true && disabledObserved,
      selector: "#observed",
    });
    const port: FormSamplePort = {
      inspect: async (field) => current(field),
      read: async (field) => current(field),
      alerts: async () => [],
      primaryBuildEnabled: async () => true,
      set: async (field, value) => {
        values[field] = value as string | boolean;
        if (field === execution.field && value === true)
          for (const a of execution.after!) values[a.field] = "";
        return true;
      },
      restoreControl: async (field, original) => {
        assert.equal(current(field).disabled, false);
        values[field] = original.value as string | boolean;
      },
      cancelFileChoice: async () => assert.fail("not required"),
      reopen: async () => assert.fail("not required"),
    };
    if (disabledObserved)
      assert.equal((await runFormSample(port, { ...sample, execution })).restoration, "passed");
    else
      await assert.rejects(
        runFormSample(port, { ...sample, execution }),
        (error: unknown) =>
          error instanceof FormSampleError &&
          error.evidence.restoration === "passed" &&
          error.evidence.assertions.some((a) => a.phase === "linked-disabled" && !a.passed),
      );
    assert.deepEqual(values, initial);
  }
});
