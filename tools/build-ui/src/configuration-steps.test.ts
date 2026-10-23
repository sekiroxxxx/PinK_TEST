import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigurationOperationError, ExecutionContext } from "./configuration-context.js";
import { ConfigurationOperations, type ConfigurationPort } from "./configuration-operations.js";
import {
  configurationStepsPlan,
  loadConfigurationSteps,
  validateConfigurationSteps,
  type ConfigurationStepsDocument,
  type ConfigurationStepCase,
} from "./configuration-steps-contract.js";
import { runConfigurationSteps } from "./configuration-steps.js";
import type { CaseValue } from "./finalized-cases.js";

const samplePath = (name: string) =>
  fileURLToPath(new URL(`../fixtures/configuration-steps/${name}.json`, import.meta.url));
const basic = JSON.parse(await readFile(samplePath("basic"), "utf8")) as ConfigurationStepsDocument;

/** Only external UI observations/inputs are simulated; loader, runner and operations are production. */
function fixture(
  options: {
    restoreFails?: boolean;
    failAfterInput?: boolean;
    driftAfterInput?: boolean;
    externalEditAfterRead?: boolean;
    initialName?: string;
    blockedOnce?: boolean;
  } = {},
) {
  const values: Record<string, CaseValue> = {
    name: options.initialName ?? "Original name",
    debug: false,
  };
  const inputs: Array<[string, CaseValue]> = [],
    opens: string[] = [];
  const identity = { executable: "offline-PinK", project: "offline-project", windowId: 1 };
  let observed = { ...identity },
    generation = 0,
    buttonReads = 0,
    mutated = false;
  const session = new ExecutionContext(identity, async () => observed);
  const port: ConfigurationPort = {
    inspect: async (field) =>
      field in values
        ? {
            value: structuredClone(values[field]),
            kind: typeof values[field] === "boolean" ? "boolean" : "string",
            disabled: false,
            selector: "#offline",
          }
        : null,
    read: async (field) => {
      const control = await port.inspect(field);
      assert.ok(control);
      return control;
    },
    set: async (field, value) => {
      if (options.blockedOnce) {
        options.blockedOnce = false;
        throw new ConfigurationOperationError("precondition", "control disabled", "blocked");
      }
      const changed = values[field] !== value;
      inputs.push([field, structuredClone(value)]);
      values[field] = structuredClone(value);
      mutated = true;
      if (options.driftAfterInput) observed = { ...identity, project: "another-project" };
      if (options.failAfterInput)
        throw new Error('transport after input: password="private-content"');
      return changed;
    },
    restoreControl: async (field, original) => {
      inputs.push([field, structuredClone(original.value)]);
      if (!options.restoreFails) values[field] = structuredClone(original.value);
    },
    alerts: async (field) => (values[field] === "" ? ["required"] : []),
    primaryBuildEnabled: async () => {
      // An external edit between a completed read and a later assertion invalidates its snapshot.
      if (mutated && ++buttonReads === 2 && options.externalEditAfterRead) values.name = "external";
      return true;
    },
    reopen: async () => assert.fail("no reopen step in this contract"),
    cancelFileChoice: async () => assert.fail("no file chooser step in this contract"),
  };
  return {
    values,
    inputs,
    opens,
    env: {
      session,
      evidenceKind: "offline-fixture" as const,
      openConfiguration: async (platform: string) => {
        opens.push(platform);
        const bind = () =>
          session.bind(platform, platform, ++generation, async () => ({
            title: platform,
            generation,
          }));
        return new ConfigurationOperations(bind(), port, async () => bind());
      },
    },
  };
}

async function withFile<T>(document: unknown, action: (file: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "pink-steps-"));
  try {
    const file = join(directory, "cases.json");
    await writeFile(file, JSON.stringify(document));
    return await action(file);
  } finally {
    assert.equal(dirname(resolve(directory)).toLowerCase(), resolve(tmpdir()).toLowerCase());
    await rm(directory, { recursive: true, force: true });
  }
}
const nextCase = (id: string): ConfigurationStepCase => ({
  ...structuredClone(basic.cases[0]),
  caseId: id,
});

test("two JSON files alone change the action order, targets and assertions; both restore", async () => {
  const first = await loadConfigurationSteps(samplePath("basic"));
  const edited = await loadConfigurationSteps(samplePath("edited"));
  assert.notEqual(first.sourceSha256, edited.sourceSha256);
  const a = fixture(),
    b = fixture();
  const r1 = await runConfigurationSteps(first, a.env);
  const r2 = await runConfigurationSteps(edited, b.env);
  assert.equal(r1.outcome, "passed");
  assert.equal(r2.outcome, "passed");
  assert.deepEqual(a.inputs, [
    ["name", "qa_steps_basic"],
    ["name", "Original name"],
  ]);
  assert.deepEqual(b.inputs, [
    ["debug", true],
    ["name", "qa_steps_edited"],
    ["debug", false],
    ["name", "Original name"],
  ]);
  assert.deepEqual(b.values, { name: "Original name", debug: false });
  assert.deepEqual(
    r2.cases[0].steps.map((s) => s.stepId),
    ["original", "debug", "rename", "current", "check", "prompt", "editable", "restore"],
  );
  assert.equal(r2.evidenceKind, "offline-fixture");
  assert.equal(r2.buildSubmitted, false);
  assert.deepEqual(configurationStepsPlan(edited).cases[0].dependencies[4], {
    id: "check",
    requires: ["current"],
  });
});

test("a new standard platform and its ordinary fields are loaded from JSON, with QA edits preserved", async () => {
  const first = await loadConfigurationSteps(samplePath("new-platform-basic"));
  const edited = await loadConfigurationSteps(samplePath("new-platform-edited"));
  const plan = configurationStepsPlan(edited);
  assert.equal(plan.targets[0].id, "pink-builder-basic-platform");
  assert.equal(plan.cases[0].steps[1].id, "diagnostics");
  assert.notEqual(first.documentSha256, edited.documentSha256);
  assert.equal(first.document.cases[0].steps[1].id, "api");
  const bad = structuredClone(first.document);
  bad.targets![0].fields["packages.pink-builder-basic-platform.apiEnvironment"].control = "boolean";
  assert.throws(() => validateConfigurationSteps(bad), /标准/);
  const injected = structuredClone(first.document);
  Object.assign(injected.targets![0], { selector: "#anything" });
  assert.throws(() => validateConfigurationSteps(injected), /不支持/);
  const override = structuredClone(first.document);
  override.targets![0].id = "web-desktop";
  assert.throws(() => validateConfigurationSteps(override), /覆盖/);
});

test("editing and reloading the same file changes execution; a previously loaded run stays frozen", async () => {
  await withFile(basic, async (file) => {
    const old = await loadConfigurationSteps(file);
    const doc = structuredClone(basic);
    doc.cases[0].steps[1] = { id: "rename", op: "set", field: "name", value: "QA second revision" };
    doc.cases[0].steps[3] = {
      id: "check",
      op: "assert",
      check: "values",
      snapshot: "current",
      values: { name: "QA second revision" },
    };
    await writeFile(file, JSON.stringify(doc));
    const changed = await loadConfigurationSteps(file),
      f = fixture();
    await runConfigurationSteps(changed, f.env);
    assert.deepEqual(f.inputs[0], ["name", "QA second revision"]);
    assert.notEqual(changed.documentSha256, old.documentSha256);
    const original = fixture();
    await runConfigurationSteps(old, original.env);
    assert.deepEqual(original.inputs[0], ["name", "qa_steps_basic"]);
    old.document.cases[0].steps.pop();
    const invalid = fixture();
    await assert.rejects(runConfigurationSteps(old, invalid.env), /恢复|修改/);
    assert.deepEqual(invalid.opens, []);
  });
});

test("semantic errors are rejected before opening a page", async () => {
  const invalid: Array<(doc: ConfigurationStepsDocument) => void> = [
    (d) => {
      d.schemaVersion = 2 as 1;
    },
    (d) => {
      d.cases[0].steps.shift();
    },
    (d) => {
      d.cases[0].steps.pop();
    },
    (d) => {
      d.cases[0].steps[1] = { id: "wrong", op: "set", field: "debug", value: true };
    },
    (d) => {
      d.cases[0].steps[3] = {
        id: "check",
        op: "assert",
        check: "values",
        snapshot: "original",
        values: { name: "x" },
      };
    },
    (d) => {
      d.cases[0].steps.splice(3, 0, { id: "late-write", op: "set", field: "name", value: "later" });
    },
    (d) => {
      d.cases[0].steps[3] = {
        id: "check",
        op: "assert",
        check: "values",
        snapshot: "current",
        values: { debug: true },
      };
    },
    (d) => {
      d.cases[0].steps[1].id = "original";
    },
    (d) => {
      d.cases[0].steps[4] = { id: "restore", op: "restore", record: "another-case.original" };
    },
    (d) => {
      d.cases[0].steps[1] = {
        id: "cross",
        op: "set",
        field: "packages.android.packageName",
        value: "x",
      };
    },
    (d) => {
      (d.cases[0].steps[1] as unknown as Record<string, unknown>).op = "build";
    },
    (d) => {
      (d.cases[0].steps[1] as unknown as Record<string, unknown>).selector = "#arbitrary";
    },
    (d) => {
      d.cases.push(structuredClone(d.cases[0]));
    },
    (d) => {
      d.cases[0].steps[3] = {
        id: "hidden",
        op: "assert",
        check: "state",
        field: "name",
        expected: { visible: false },
      };
    },
  ];
  for (const mutate of invalid) {
    const doc = structuredClone(basic);
    mutate(doc);
    await withFile(doc, async (file) => {
      await assert.rejects(loadConfigurationSteps(file));
    });
  }
});

test("malformed JSON does not expose its contents", async () => {
  await withFile(basic, async (file) => {
    await writeFile(file, '{"private-content":');
    await assert.rejects(
      loadConfigurationSteps(file),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes("有效 JSON") &&
        !error.message.includes("private-content"),
    );
  });
});

test("assertion failure skips further changes, always restores and permits the next case", async () => {
  const doc = structuredClone(basic);
  doc.cases[0].steps[3] = {
    id: "check",
    op: "assert",
    check: "values",
    snapshot: "current",
    values: { name: "deliberately different" },
  };
  doc.cases[0].steps.splice(4, 0, {
    id: "must-skip",
    op: "set",
    field: "name",
    value: "must not execute",
  });
  doc.cases.push(nextCase("next"));
  await withFile(doc, async (file) => {
    const f = fixture(),
      r = await runConfigurationSteps(await loadConfigurationSteps(file), f.env);
    assert.deepEqual(
      r.cases.map((c) => c.outcome),
      ["failed", "passed"],
    );
    assert.equal(r.cases[0].steps[4].outcome, "skipped");
    assert.equal(r.cases[0].steps[5].trigger, "cleanup");
    assert.equal(r.cases[0].restoration, "passed");
    assert.equal(r.stopped, false);
    assert.equal(
      f.inputs.some(([, v]) => v === "must not execute"),
      false,
    );
    assert.equal(f.values.name, "Original name");
  });
});

test("a blocked field restores and permits the next case without retrying that step", async () => {
  const doc = structuredClone(basic);
  doc.cases.push(nextCase("next"));
  await withFile(doc, async (file) => {
    const f = fixture({ blockedOnce: true });
    const result = await runConfigurationSteps(await loadConfigurationSteps(file), f.env);
    assert.deepEqual(
      result.cases.map((c) => c.outcome),
      ["blocked", "passed"],
    );
    assert.equal(result.cases[0].restoration, "passed");
    assert.equal(f.inputs.filter(([, value]) => value === "qa_steps_basic").length, 1);
  });
});

test("failed recovery keeps the original assertion error and stops following cases", async () => {
  const doc = structuredClone(basic);
  doc.cases[0].steps[3] = {
    id: "check",
    op: "assert",
    check: "values",
    snapshot: "current",
    values: { name: "wrong" },
  };
  doc.cases.push(nextCase("next"));
  await withFile(doc, async (file) => {
    const f = fixture({ restoreFails: true }),
      r = await runConfigurationSteps(await loadConfigurationSteps(file), f.env);
    assert.equal(r.cases[0].failure?.code, "assertion");
    assert.equal(r.cases[0].steps.at(-1)?.error?.code, "restore");
    assert.equal(r.cases[0].restoration, "failed");
    assert.equal(r.cases[1].outcome, "skipped");
    assert.equal(r.stopped, true);
    assert.equal(f.opens.length, 1);
  });
});

test("case stop policy restores before stopping and cannot override hard failure stops", async () => {
  const doc = structuredClone(basic);
  doc.cases[0].onFailure = "stop";
  doc.cases[0].steps[3] = {
    id: "check",
    op: "assert",
    check: "values",
    snapshot: "current",
    values: { name: "deliberately wrong" },
  };
  doc.cases.push(nextCase("must-not-run"));
  await withFile(doc, async (file) => {
    const f = fixture();
    const result = await runConfigurationSteps(await loadConfigurationSteps(file), f.env);
    assert.equal(result.cases[0].restoration, "passed");
    assert.equal(result.cases[0].failure?.code, "assertion");
    assert.equal(result.cases[0].stopReason?.code, "case-policy");
    assert.equal(result.cases[1].outcome, "skipped");
    assert.equal(f.values.name, "Original name");
    assert.equal(f.opens.length, 1);
  });
});

test("partial input exception is not retried and restores before the next case", async () => {
  await withFile(basic, async (file) => {
    const f = fixture({ failAfterInput: true }),
      r = await runConfigurationSteps(await loadConfigurationSteps(file), f.env);
    assert.equal(r.cases[0].outcome, "failed");
    assert.equal(r.cases[0].restoration, "passed");
    assert.deepEqual(f.inputs, [
      ["name", "qa_steps_basic"],
      ["name", "Original name"],
    ]);
    assert.equal(JSON.stringify(r).includes("private-content"), false);
  });
});

test("failure evidence is captured before cleanup and retains a redacted cause", async () => {
  const f = fixture({ failAfterInput: true });
  let capturedName: CaseValue | undefined;
  const result = await runConfigurationSteps(await loadConfigurationSteps(samplePath("basic")), {
    ...f.env,
    captureFailure: async () => {
      capturedName = f.values.name;
      return { scene: "failure.json" };
    },
  });
  assert.equal(capturedName, "qa_steps_basic");
  assert.equal(f.values.name, "Original name");
  const step = result.cases[0].steps[1];
  assert.equal(step.evidence?.scene, "failure.json");
  assert.ok(step.diagnostic?.chain[0].message.includes("transport after input"));
  assert.equal(JSON.stringify(step).includes("private-content"), false);
  assert.equal(result.cases[0].steps.at(-1)?.restorationTrace?.at(-1)?.state, "passed");
});

test("an evidence capture error cannot prevent configuration restoration", async () => {
  const f = fixture({ failAfterInput: true });
  const result = await runConfigurationSteps(await loadConfigurationSteps(samplePath("basic")), {
    ...f.env,
    captureFailure: async () => {
      throw new Error("screenshot unavailable");
    },
  });
  assert.equal(result.cases[0].restoration, "passed");
  assert.equal(f.values.name, "Original name");
  assert.ok(result.cases[0].steps[1].evidence?.unavailable);
  assert.ok(result.cases[0].steps[1].diagnostic?.chain.length);
});

test("identity loss stops all subsequent inputs including restoration to an unknown page", async () => {
  const doc = structuredClone(basic);
  doc.cases.push(nextCase("next"));
  await withFile(doc, async (file) => {
    const f = fixture({ driftAfterInput: true }),
      r = await runConfigurationSteps(await loadConfigurationSteps(file), f.env);
    assert.equal(r.stopped, true);
    assert.equal(r.cases[0].restoration, "unsafe");
    assert.equal(r.cases[1].outcome, "skipped");
    assert.deepEqual(f.inputs, [["name", "qa_steps_basic"]]);
  });
});

test("external snapshot drift stops the run but restores while identity is still valid", async () => {
  const doc = structuredClone(basic);
  doc.cases.push(nextCase("next"));
  await withFile(doc, async (file) => {
    const f = fixture({ externalEditAfterRead: true }),
      r = await runConfigurationSteps(await loadConfigurationSteps(file), f.env);
    assert.equal(r.cases[0].failure?.code, "snapshot");
    assert.equal(r.cases[0].restoration, "passed");
    assert.equal(r.cases[1].outcome, "skipped");
    assert.equal(f.values.name, "Original name");
  });
});

test("wrong platform binding is rejected before any field operation", async () => {
  const loaded = await loadConfigurationSteps(samplePath("basic")),
    f = fixture();
  const open = f.env.openConfiguration;
  f.env.openConfiguration = () => open("web-mobile");
  const r = await runConfigurationSteps(loaded, f.env);
  assert.equal(r.stopped, true);
  assert.deepEqual(f.inputs, []);
});

test("prompts and state assertions use the declared expectation and restore original alerts", async () => {
  const doc = structuredClone(basic);
  doc.cases[0].steps[1] = { id: "empty", op: "set", field: "name", value: "" };
  doc.cases[0].steps[3] = {
    id: "required",
    op: "assert",
    check: "prompt",
    field: "name",
    expected: { kind: "contains", text: "required" },
  };
  await withFile(doc, async (file) => {
    const f = fixture(),
      r = await runConfigurationSteps(await loadConfigurationSteps(file), f.env);
    assert.equal(r.outcome, "passed");
    assert.equal(f.values.name, "Original name");
  });
});

test("sensitive writes and unresolved references fail loading, read evidence is redacted", async () => {
  const doc = structuredClone(basic);
  doc.cases[0].platform = "android";
  doc.cases[0].steps = [
    { id: "original", op: "record", fields: ["packages.android.keystorePassword"] },
    { id: "set", op: "set", field: "packages.android.keystorePassword", value: "secret" },
    { id: "restore", op: "restore", record: "original" },
  ];
  assert.throws(() => validateConfigurationSteps(doc), /敏感/);
  const ref = structuredClone(basic);
  ref.cases[0].steps[1] = { id: "ref", op: "set", field: "name", value: { $material: "x" } };
  assert.throws(() => validateConfigurationSteps(ref), /引用/);
  doc.cases[0].steps = [{ id: "read", op: "read", fields: ["packages.android.keystorePassword"] }];
  await withFile(doc, async (file) => {
    const f = fixture();
    f.values["packages.android.keystorePassword"] = "existing-secret";
    const r = await runConfigurationSteps(await loadConfigurationSteps(file), f.env);
    assert.equal(r.outcome, "passed");
    assert.equal(JSON.stringify(r).includes("existing-secret"), false);
    assert.ok(JSON.stringify(r).includes("[redacted]"));
  });
});
