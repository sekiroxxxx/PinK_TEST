import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import {
  loadConfigurationSteps,
  configurationStepsPlan,
  validateConfigurationSteps,
} from "./configuration-steps-contract.js";
import { runConfigurationSteps } from "./configuration-steps.js";
import { ConfigurationOperations, type ConfigurationPort } from "./configuration-operations.js";
import { ExecutionContext } from "./configuration-context.js";
import type { BuildStepsDocument, BuildStepCase } from "./build-steps-contract.js";
import type { CaseValues } from "./finalized-cases.js";
import { catalogToSteps } from "./catalog-to-steps.js";
import { valueHash } from "./plan-integrity.js";
import type { CatalogDocument } from "./case-contract.js";

function sample(platform: string, targets: CaseValues, id = "input-sample"): BuildStepCase {
  const fields = [
    ...new Set([
      ...Object.keys(targets),
      ...(Object.keys(targets).some((k) => k === "startScene" || k === "scenes")
        ? ["startScene", "scenes"]
        : []),
    ]),
  ];
  return {
    caseId: id,
    platform,
    steps: [
      { id: "open", op: "config.open" },
      { id: "original", op: "record", page: "open", fields },
      ...Object.entries(targets).map(([field, value], i) => ({
        id: `set-${i}`,
        op: "set" as const,
        page: "open",
        field,
        value,
      })),
      { id: "read", op: "read", page: "open", fields },
      { id: "assert", op: "assert", check: "values", snapshot: "read", values: targets },
    ],
    finally: [
      { id: "cleanup", op: "config.open" },
      { id: "restore", op: "restore", page: "cleanup", record: "original" },
      { id: "close", op: "config.close", page: "cleanup" },
    ],
  };
}
const doc = (...cases: BuildStepCase[]): BuildStepsDocument => ({
  kind: "pink-configuration-steps",
  schemaVersion: 2,
  cases,
});

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "pink-step-inputs-"));
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "package.json"), "{}");
  for (const id of ["a", "b"]) {
    await writeFile(join(root, `assets/${id}.scene`), "{}");
    await writeFile(join(root, `assets/${id}.scene.meta`), JSON.stringify({ uuid: `uuid-${id}` }));
  }
  const key = join(root, "fixture.keystore"),
    materials = join(root, "materials.json"),
    file = join(root, "steps.json");
  await writeFile(key, "offline fixture, not a real keystore");
  await writeFile(
    materials,
    JSON.stringify({
      schemaVersion: 1,
      bindings: { signing: { path: "fixture.keystore", password: "fixture-private-password" } },
    }),
  );
  return {
    root,
    materials,
    key,
    file,
    load: async (document: BuildStepsDocument, materialFile: string | undefined = materials) => {
      await writeFile(file, JSON.stringify(document));
      return loadConfigurationSteps(file, { project: root, materials: materialFile });
    },
    dispose: async () => {
      assert.equal(dirname(root), tmpdir());
      await rm(root, { recursive: true });
    },
  };
}

/** Only external UI controls are fixtures; loading, binding, operations, dependencies and recovery are real. */
function ui(initial: CaseValues, failSecretInput = false) {
  const values = structuredClone(initial),
    events: string[] = [];
  const writes: Array<{ field: string; value: unknown }> = [];
  const identity = { executable: "fixture.exe", project: "fixture", windowId: 1 };
  const session = new ExecutionContext(identity, async () => identity);
  let opens = 0;
  const port: ConfigurationPort = {
    inspect: async (field) =>
      field in values
        ? {
            value: structuredClone(values[field]),
            kind: Array.isArray(values[field])
              ? "array"
              : typeof values[field] === "boolean"
                ? "boolean"
                : "string",
            selector: "fixture",
            disabled: false,
          }
        : null,
    read: async (field) => {
      const value = await port.inspect(field);
      assert.ok(value);
      return value;
    },
    set: async (field, value, _input, label) => {
      writes.push({ field, value: structuredClone(value) });
      events.push(field + (label ? `:${label}` : ""));
      if (field === "startScene")
        values.scenes = [
          ...new Set([
            ...(values.scenes as string[]),
            `db://assets/${String(value).slice(5)}.scene`,
          ]),
        ];
      if (field === "scenes")
        assert.ok(
          (value as string[]).includes(`db://assets/${String(values.startScene).slice(5)}.scene`),
          "mandatory initial scene cannot be unchecked",
        );
      const changed = valueHash(value) !== valueHash(values[field]);
      values[field] = structuredClone(value);
      if (failSecretInput && field.endsWith("Password") && value)
        throw new Error(`input failed: ${value}`);
      return changed;
    },
    restoreControl: async (field, original) => {
      events.push(`restore:${field}`);
      await port.set(field, original.value);
    },
    alerts: async () => [],
    primaryBuildEnabled: async () => true,
    reopen: async () => {
      throw new Error("unused");
    },
    cancelFileChoice: async () => {
      throw new Error("unused");
    },
  };
  return {
    values,
    events,
    writes,
    opens: () => opens,
    env: {
      session,
      evidenceKind: "offline-fixture" as const,
      openConfiguration: async (platform: string) => {
        opens++;
        const context = session.bind(platform, platform, opens, async () => ({
          title: platform,
          generation: opens,
        }));
        return new ConfigurationOperations(context, port, async () => context);
      },
      closeConfiguration: async () => {},
    },
  };
}

test("v2 binds current real scene roles, translates UI paths, and restores initial scene before selection", async () => {
  const w = await workspace();
  try {
    const initial = { startScene: "uuid-b", scenes: ["db://assets/b.scene"] };
    const loaded = await w.load(
      doc(
        sample("web-desktop", {
          startScene: { $scene: "secondary" },
          scenes: [{ $scene: "secondary" }],
        }),
      ),
    );
    assert.equal(loaded.inputs!.preview.scenes.primary!.uuid, "uuid-a"); // offline is a candidate, not a UI decision
    const fixture = ui(initial),
      result = await runConfigurationSteps(loaded, fixture.env);
    assert.equal(result.outcome, "passed");
    assert.ok(fixture.events.includes("startScene:a")); // current b is primary, so secondary is a
    assert.deepEqual(fixture.writes.slice(0, 2), [
      { field: "startScene", value: "uuid-a" },
      { field: "scenes", value: ["db://assets/a.scene"] },
    ]);
    assert.ok(
      fixture.events.indexOf("restore:startScene") < fixture.events.indexOf("restore:scenes"),
    );
    assert.deepEqual(fixture.values, initial);
    const changed = structuredClone(loaded.document) as BuildStepsDocument;
    const sceneSet = changed.cases[0].steps.find(
      (s) => s.op === "set" && s.field === "startScene",
    )!;
    assert.ok(sceneSet.op === "set");
    sceneSet.value = { $scene: "primary" };
    const selection = changed.cases[0].steps.find((s) => s.op === "set" && s.field === "scenes")!;
    assert.ok(selection.op === "set");
    selection.value = [{ $scene: "primary" }];
    const assertion = changed.cases[0].steps.find(
      (s) => s.op === "assert" && s.check === "values",
    )!;
    assert.ok(assertion.op === "assert" && assertion.check === "values");
    assertion.values = { startScene: { $scene: "primary" }, scenes: [{ $scene: "primary" }] };
    const edited = ui(initial);
    assert.equal(
      (await runConfigurationSteps(await w.load(changed), edited.env)).outcome,
      "passed",
    );
    assert.ok(edited.events.includes("startScene:b"));
    assert.deepEqual(edited.values, initial);
  } finally {
    await w.dispose();
  }
});

test("material references reach the real operations without publishing secrets; missing inputs block before opening", async () => {
  const w = await workspace();
  try {
    const targets = {
      "packages.android.keystorePath": { $material: "signing.path" },
      "packages.android.keystorePassword": { $material: "signing.password" },
    };
    const initial = {
      "packages.android.keystorePath": "original.keystore",
      "packages.android.keystorePassword": "original-password",
    };
    const loaded = await w.load(doc(sample("android", targets)));
    const fixture = ui(initial),
      result = await runConfigurationSteps(loaded, fixture.env);
    assert.equal(result.outcome, "passed");
    assert.deepEqual(fixture.values, initial);
    assert.deepEqual(fixture.writes.slice(0, 2), [
      { field: "packages.android.keystorePath", value: w.key },
      { field: "packages.android.keystorePassword", value: "fixture-private-password" },
    ]);
    assert.ok(
      !JSON.stringify({ loaded, plan: configurationStepsPlan(loaded), result }).includes(
        "fixture-private-password",
      ),
    );
    const failure = ui({ ...initial, "packages.android.keystorePassword": "" }, true);
    const failed = await runConfigurationSteps(loaded, failure.env);
    assert.equal(failed.cases[0].outcome, "failed");
    assert.ok(!JSON.stringify(failed).includes("fixture-private-password"));
    const absent = await w.load(
      doc(sample("android", targets), sample("web-desktop", { name: "next" }, "following")),
      undefined,
    );
    // Explicitly reload without a manifest (the helper's default intentionally supplies one).
    const missing = await loadConfigurationSteps(absent.path, { project: w.root });
    const next = ui({ name: "original" }),
      blocked = await runConfigurationSteps(missing, next.env);
    assert.deepEqual(
      blocked.cases.map((c) => c.outcome),
      ["blocked", "passed"],
    );
    assert.equal(next.opens(), 1);
    const stopDocument = structuredClone(missing.document) as BuildStepsDocument;
    stopDocument.cases[0].onFailure = "stop";
    await writeFile(w.file, JSON.stringify(stopDocument));
    const stopMissing = await loadConfigurationSteps(w.file, { project: w.root });
    const untouched = ui({ name: "original" });
    const stoppedMissing = await runConfigurationSteps(stopMissing, untouched.env);
    assert.deepEqual(
      stoppedMissing.cases.map((c) => c.outcome),
      ["stopped", "skipped"],
    );
    assert.equal(untouched.opens(), 0);
    const before = valueHash(configurationStepsPlan(loaded));
    await writeFile(w.key, "changed material bytes");
    const stopped = ui(initial);
    assert.equal((await runConfigurationSteps(loaded, stopped.env)).outcome, "failed");
    assert.equal(stopped.opens(), 0);
    await assert.rejects(loaded.inputs!.verify(), /与计划不符/);
    const reloaded = await w.load(doc(sample("android", targets)));
    assert.notEqual(valueHash(configurationStepsPlan(reloaded)), before);
    await writeFile(
      join(w.root, "assets/b.scene.meta"),
      JSON.stringify({ uuid: "changed-scene-uuid" }),
    );
    await assert.rejects(reloaded.inputs!.verify(), /与计划不符/);
  } finally {
    await w.dispose();
  }
});

test("references cannot bypass sensitive, platform, restoration or version contracts", async () => {
  const secret = doc(
    sample("android", { "packages.android.keystorePassword": { $material: "signing.password" } }),
  );
  validateConfigurationSteps(secret);
  const literal = structuredClone(secret);
  const set = literal.cases[0].steps[2];
  assert.ok(set.op === "set");
  set.value = "plaintext";
  assert.throws(() => validateConfigurationSteps(literal), /材料引用/);
  set.value = { $material: "signing.password" };
  set.input = "override";
  assert.throws(() => validateConfigurationSteps(literal), /明文 input/);
  assert.throws(
    () =>
      validateConfigurationSteps(
        doc(
          sample("web-mobile", {
            "packages.android.keystorePassword": { $material: "signing.password" },
          }),
        ),
      ),
    /其他平台/,
  );
  const scenes = doc(sample("web-desktop", { startScene: { $scene: "primary" } }));
  const record = scenes.cases[0].steps[1];
  assert.ok(record.op === "record");
  record.fields = ["startScene"];
  assert.throws(() => validateConfigurationSteps(scenes), /同时记录/);
  const v1 = {
    ...secret,
    schemaVersion: 1,
    cases: [
      {
        caseId: "v1",
        platform: "android",
        steps: [
          { id: "original", op: "record", fields: ["packages.android.keystorePassword"] },
          {
            id: "set",
            op: "set",
            field: "packages.android.keystorePassword",
            value: { $material: "signing.password" },
          },
          { id: "restore", op: "restore", record: "original" },
        ],
      },
    ],
  };
  assert.throws(() => validateConfigurationSteps(v1), /材料引用/);
});

test("catalog conversion preserves four-group identity and blockers; a simple supported case compiles to executable steps", async () => {
  const w = await workspace();
  try {
    const path = new URL(
      "../../case-catalog/public-combinations.json",
      import.meta.url,
    ).pathname.replace(/^\/(\w:)/, "$1");
    const result = await catalogToSteps(path, { project: w.root });
    assert.equal(new Set(result.cases.map((c) => c.platform)).size, 18);
    assert.deepEqual([...new Set(result.cases.map((c) => c.group))].sort(), [
      "conditional",
      "debug",
      "mixed",
      "publish",
    ]);
    const mixed = result.cases.find((c) => c.caseId === "review.mixed.web-desktop")!;
    assert.ok(mixed.gaps.some((g) => g.kind === "applicability"));
    assert.ok(
      result.cases
        .filter((c) => c.retained.length)
        .every(
          (c) =>
            !c.gaps.some((g) => g.reason.includes("保留字段的初态观察")) &&
            (!c.document || c.document.cases[0].steps.some((s) => s.op === "retain")),
        ),
    );
    const taobaoUi = result.cases.find(
      (c) => c.caseId === "conditional.taobao-mini-game.global-adapter",
    )!;
    assert.equal(taobaoUi.status, "ready");
    assert.ok(!taobaoUi.document!.cases[0].steps.some((s) => s.op === "build.submit"));
    assert.ok(
      result.cases
        .filter((c) => c.sourceCaseIds?.some((id) => id.startsWith("conditional.l10n.")))
        .every((c) => !c.document),
    );
    const raw = JSON.parse(await readFile(path, "utf8")) as CatalogDocument;
    const publish = raw.platforms
      .find((p) => p.id === "web-desktop")!
      .combinations.find((c) => c.template === "publish")!;
    publish.values = { name: "qa_from_catalog" };
    publish.fieldCoverage = {};
    publish.variants = [];
    publish.configurationOrder = [];
    publish.excludedFields = Object.keys(raw.templates.find((t) => t.id === "publish")!.values);
    const catalogFile = join(w.root, "catalog.json");
    await writeFile(catalogFile, JSON.stringify(raw));
    const compiled = await catalogToSteps(catalogFile, {
      project: w.root,
      groups: "publish",
      cases: publish.id,
    });
    assert.equal(compiled.cases[0].status, "ready");
    assert.equal(compiled.cases[0].document!.cases[0].caseId, publish.id);
    validateConfigurationSteps(compiled.cases[0].document);
    assert.ok(compiled.cases[0].document!.cases[0].steps.some((s) => s.op === "build.submit"));
    assert.equal(compiled.buildSubmitted, false);
  } finally {
    await w.dispose();
  }
});
