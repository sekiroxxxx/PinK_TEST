import { test } from "node:test";
import assert from "node:assert/strict";
import type { CaseControl } from "./case-form.js";
import type { CaseValue } from "./finalized-cases.js";
import { ConfigurationOperations, type ConfigurationPort } from "./configuration-operations.js";
import { ConfigurationOperationError, ExecutionContext } from "./configuration-context.js";

/** Scripted external observations, not product validators. Tests call the production operations. */
function fixture(initial: Record<string, CaseValue> = { name: "Original", debug: false }) {
  const values = structuredClone(initial);
  const identity = { executable: "offline-PinK", project: "offline-project", windowId: 1 };
  let observedIdentity = { ...identity },
    title = "Web desktop",
    generation = 1,
    instance = 100;
  const writes: string[] = [];
  const session = new ExecutionContext(identity, async () => observedIdentity);
  const bind = () =>
    session.bind(
      "web-desktop",
      "Web desktop",
      generation,
      async () => ({ title, generation, instance }),
      instance,
    );
  const inspect = (field: string): CaseControl | null =>
    field in values
      ? {
          value: structuredClone(values[field]),
          kind: typeof values[field] === "boolean" ? "boolean" : "string",
          selector: "#offline",
          disabled: false,
        }
      : null;
  const port: ConfigurationPort = {
    inspect: async (field) => inspect(field),
    read: async (field) => {
      const c = inspect(field);
      assert.ok(c);
      return c;
    },
    set: async (field, value) => {
      writes.push(field);
      const changed = values[field] !== value;
      values[field] = structuredClone(value);
      return changed;
    },
    restoreControl: async (field, original) => {
      writes.push(field);
      values[field] = structuredClone(original.value);
    },
    alerts: async (field) => (values[field] === "" ? ["required"] : []),
    primaryBuildEnabled: async () => true,
    reopen: async () => {
      generation++;
    },
    cancelFileChoice: async () => {},
  };
  const operations = new ConfigurationOperations(bind(), port, async () => bind());
  return {
    operations,
    port,
    session,
    values,
    writes,
    bind,
    replaceModal: () => {
      instance++;
    },
    changeIdentity: (change: Partial<typeof identity>) => {
      observedIdentity = { ...observedIdentity, ...change };
    },
    changePage: (nextTitle: string, nextGeneration = generation) => {
      title = nextTitle;
      generation = nextGeneration;
    },
  };
}

const stopped = (code: ConfigurationOperationError["code"]) => (error: unknown) =>
  error instanceof ConfigurationOperationError &&
  error.code === code &&
  error.disposition === "stop";

test("independent operations compose record, set, read, assertions and restore", async () => {
  const f = fixture({ name: "", debug: false });
  const record = await f.operations.record(["name", "debug"], [], true);
  await f.operations.set("name", "QA temporary");
  await f.operations.set("debug", true);
  const readback = await f.operations.snapshot(["name", "debug"]);
  assert.equal(
    (await f.operations.assertValues(readback, { name: "QA temporary", debug: true })).length,
    2,
  );
  await f.operations.assertPrompt("name", { kind: "none" });
  await f.operations.assertState("name", { visible: true, disabled: false });
  await f.operations.restore(record);
  assert.deepEqual(f.values, { name: "", debug: false });
  await f.operations.assertPrompt("name", { kind: "contains", text: "required" });
});

test("a write attempt and an external UI edit both invalidate a prior snapshot", async () => {
  for (const external of [false, true]) {
    const f = fixture();
    const snapshot = await f.operations.snapshot(["name"]);
    if (external) f.values.name = "external change";
    else await f.operations.set("name", "changed");
    await assert.rejects(
      f.operations.assertValues(snapshot, { name: "Original" }),
      stopped("snapshot"),
    );
  }
});

test("close/rebuild and a different platform title reject old operations before a write", async () => {
  for (const rebuilt of [false, true]) {
    const f = fixture();
    f.changePage(rebuilt ? "Web desktop" : "Another platform", rebuilt ? 2 : 1);
    await assert.rejects(f.operations.set("name", "must not be written"), stopped("context"));
    assert.deepEqual(f.writes, []);
  }
});

test("project, executable and window identity drift stop before UI input", async () => {
  for (const change of [
    { project: "another-project" },
    { executable: "another-PinK" },
    { windowId: 2 },
  ]) {
    const f = fixture();
    f.changeIdentity(change);
    await assert.rejects(f.operations.set("name", "must not be written"), stopped("context"));
    assert.deepEqual(f.writes, []);
  }
});

test("reopen gives a new context, rejects old snapshots and preserves same-platform recovery", async () => {
  const f = fixture();
  const record = await f.operations.record(["name"]);
  await f.operations.set("name", "Changed");
  const snapshot = await f.operations.snapshot(["name"]);
  await f.operations.reopen();
  await assert.rejects(f.operations.assertSnapshotCurrent(snapshot), stopped("snapshot"));
  await f.operations.restore(record);
  assert.equal((await f.operations.read("name")).value, "Original");
});

test("another session cannot consume a recovery record and rebinding invalidates the old page", async () => {
  const first = fixture(),
    second = fixture();
  const record = await first.operations.record(["name"]);
  await assert.rejects(second.operations.restore(record), stopped("context"));
  assert.deepEqual(second.writes, []);
  first.bind();
  await assert.rejects(first.operations.read("name"), stopped("context"));
});

test("cross-platform fields are blocked and failed assertions disclose no observed values", async () => {
  const f = fixture({ name: "secret-observed-value" });
  await assert.rejects(
    f.operations.set("packages.vivo-mini-game.package", "x"),
    (error) => error instanceof ConfigurationOperationError && error.disposition === "blocked",
  );
  const snapshot = await f.operations.snapshot(["name"]);
  await assert.rejects(
    f.operations.assertValues(snapshot, { name: "secret-target" }),
    (error) =>
      error instanceof ConfigurationOperationError &&
      error.code === "assertion" &&
      !error.message.includes("secret-observed-value") &&
      !error.message.includes("secret-target"),
  );
  assert.deepEqual(f.writes, []);
});

test("partial input failure still leaves a restorable record and invalidates the old snapshot", async () => {
  const f = fixture();
  const record = await f.operations.record(["name"]),
    snapshot = await f.operations.snapshot(["name"]);
  const set = f.port.set;
  f.port.set = async (...args) => {
    await set(...args);
    throw new Error("transport after input");
  };
  await assert.rejects(f.operations.set("name", "Changed"), /transport/);
  await assert.rejects(f.operations.assertSnapshotCurrent(snapshot), stopped("snapshot"));
  await f.operations.restore(record);
  assert.equal(f.values.name, "Original");
});

test("restore mismatch is a typed stop result and does not count as recovery success", async () => {
  const f = fixture();
  const record = await f.operations.record(["name"]);
  await f.operations.set("name", "Changed");
  f.port.restoreControl = async () => {};
  await assert.rejects(f.operations.restore(record), stopped("restore"));
});

test("restoration preserves the underlying input exception and its exact phase", async () => {
  const f = fixture();
  const record = await f.operations.record(["name"]);
  await f.operations.set("name", "temporary");
  const inputFailure = new Error("CDP request timed out: Input.dispatchMouseEvent");
  f.port.restoreControl = async () => {
    throw inputFailure;
  };
  await assert.rejects(f.operations.restore(record), (error) => {
    assert.ok(error instanceof ConfigurationOperationError);
    assert.equal(error.cause, inputFailure);
    assert.deepEqual(error.recovery, { phase: "restore-input", field: "name" });
    assert.equal(error.disposition, "stop");
    return true;
  });
  assert.equal(record.restorationTrace.at(-1)?.state, "failed");
  assert.ok(record.restorationTrace.at(-1)?.finishedAt);
});

test("file cancellation can rebind a rebuilt modal without losing recovery ownership", async () => {
  const f = fixture();
  const record = await f.operations.record(["name"]);
  f.port.cancelFileChoice = async () => {
    f.changePage("Web desktop", 2);
  };
  await f.operations.cancelFileChoice("name");
  await f.operations.restore(record);
  assert.equal(f.values.name, "Original");
});

test("a replacement modal with the same title and tool generation invalidates the old context", async () => {
  const f = fixture();
  f.replaceModal();
  await assert.rejects(f.operations.set("name", "must not be written"), stopped("context"));
  assert.deepEqual(f.writes, []);
});
