import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import {
  identifyNativeDocument,
  validateNativeDocument,
  serializeNativeDocument,
  loadNativeCases,
  configurationCheckDocument,
  describeNativeCaseCapabilities,
} from "./native-case-contract.js";
import { configurationStepsPlan, loadConfigurationSteps } from "./configuration-steps-contract.js";
import {
  configurationStepsLaunchPlan,
  verifyConfigurationStepsPlan,
} from "./configuration-steps-startup.js";
import { supportedFieldTypes } from "./supported-field-types.js";
import { validateConfigurationTargets, type ConfigurationTarget } from "./configuration-targets.js";
import type { CatalogDocument } from "./case-contract.js";
import { ExecutionContext } from "./configuration-context.js";
import { ConfigurationOperations, type ConfigurationPort } from "./configuration-operations.js";
import { runConfigurationSteps } from "./configuration-steps.js";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("./configuration-steps-cli.js", import.meta.url));
const sample = (name: string) =>
  new URL(`../fixtures/configuration-steps/${name}.json`, import.meta.url);
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "pink-native-contract-"));
  t.after(async () => {
    assert.equal(dirname(root), tmpdir());
    await rm(root, { recursive: true });
  });
  await mkdir(join(root, "assets"));
  await mkdir(join(root, "resources/app"), { recursive: true });
  await writeFile(join(root, "package.json"), "{}");
  await writeFile(join(root, "PinK.exe"), "offline identity only; never launched");
  await writeFile(join(root, "resources/app/product.json"), '{"pinkVersion":"offline-fixture"}');
  const catalog = JSON.parse(
    await readFile(new URL("../../case-catalog/public-combinations.json", import.meta.url), "utf8"),
  ) as CatalogDocument;
  catalog.platforms = catalog.platforms.filter((p) => p.id === "web-desktop");
  catalog.conditionalScenarios = [];
  for (const combo of catalog.platforms[0].combinations) {
    combo.values = { name: "qa_native_check" };
    combo.variants = [];
    combo.fieldCoverage = {};
    combo.configurationOrder = [];
    combo.excludedFields = Object.keys(
      catalog.templates.find((template) => template.id === combo.template)!.values,
    );
  }
  const file = join(root, "native.json");
  const save = () => writeFile(file, serializeNativeDocument(catalog));
  await save();
  return {
    root,
    catalog,
    file,
    save,
    options: {
      pink: root,
      project: root,
      port: 9222,
      configurationTimeoutMs: 1000,
      resultsRoot: join(root, "results"),
    },
  };
}

test("native formats round-trip without converting steps into catalog or losing ordered actions", async () => {
  for (const name of ["new-platform-edited", "standard-target-v2"]) {
    const source = JSON.parse(await readFile(sample(name), "utf8"));
    const recognized = validateNativeDocument(source);
    assert.equal(recognized.format, "steps");
    assert.equal(recognized.cliArgument, "--file");
    assert.deepEqual(JSON.parse(serializeNativeDocument(source)), source);
    const loaded = await loadConfigurationSteps(fileURLToPath(sample(name)));
    assert.equal(configurationStepsPlan(loaded).execution.willSubmit, false);
  }
  assert.throws(
    () => identifyNativeDocument({ schemaVersion: 1, revision: "looks-like-catalog" }),
    /无法识别/,
  );
  assert.throws(
    () =>
      identifyNativeDocument({
        kind: "unknown",
        schemaVersion: 1,
        templates: [],
        platforms: [],
        fieldTypes: {},
        conditionalScenarios: [],
      }),
    /无法识别/,
  );
  assert.throws(
    () => validateNativeDocument({ kind: "pink-configuration-steps", schemaVersion: 3 }),
    /无法识别/,
  );
});

test("catalog config endpoint compiles recovery, removes build prerequisites and binds endpoint to the launch hash", async (t) => {
  const f = await fixture(t);
  const args = { project: f.root, cases: "review.publish.web-desktop" };
  const normal = await loadNativeCases(f.file, args);
  const ui = await loadNativeCases(f.file, { ...args, endpoint: "ui" });
  const normalPlan = await configurationStepsLaunchPlan(normal, f.options);
  const uiPlan = await configurationStepsLaunchPlan(ui, f.options);
  assert.equal(normalPlan.steps.execution.willSubmit, true);
  assert.equal(uiPlan.steps.execution.willSubmit, false);
  const c = ui.document.cases[0];
  assert.ok(c.steps.some((s) => s.op === "record"));
  assert.ok("finally" in c && c.finally.some((s) => s.op === "restore"));
  assert.ok(
    !c.steps.some(
      (s) => s.op.startsWith("build.") || (s.op === "read" && "scope" in s && s.scope === "build"),
    ),
  );
  let name = "Original";
  const identity = { executable: "offline", project: f.root, windowId: 1 };
  const session = new ExecutionContext(identity, async () => identity);
  const port: ConfigurationPort = {
    inspect: async () => ({ kind: "string", value: name, disabled: false, selector: "offline" }),
    read: async () => ({ kind: "string", value: name, disabled: false, selector: "offline" }),
    set: async (_field, value) => {
      const changed = name !== value;
      name = String(value);
      return changed;
    },
    restoreControl: async (_field, original) => {
      name = String(original.value);
    },
    alerts: async () => [],
    primaryBuildEnabled: async () => false,
    ready: async () => {},
    reopen: async () => assert.fail("this case reuses its owned page"),
    cancelFileChoice: async () => assert.fail("no file input in this case"),
  };
  const execution = await runConfigurationSteps(ui, {
    session,
    evidenceKind: "offline-fixture",
    closeConfiguration: async (operations) => operations.context.invalidate(),
    openConfiguration: async (platform) => {
      const bind = () =>
        session.bind(platform, "UI config", 1, async () => ({ title: "UI config", generation: 1 }));
      return new ConfigurationOperations(bind(), port, async () => bind());
    },
  });
  assert.equal(execution.outcome, "passed");
  assert.equal(execution.buildSubmitted, false);
  assert.equal(execution.cases[0].restoration, "passed");
  assert.equal(name, "Original");
  const expected = join(f.root, "expected.json");
  await writeFile(expected, JSON.stringify(uiPlan));
  await verifyConfigurationStepsPlan(expected, uiPlan);
  await assert.rejects(verifyConfigurationStepsPlan(expected, normalPlan), /不符/);
  const out = join(f.root, "cli-plan.json");
  await exec(process.execPath, [
    cli,
    "--input",
    f.file,
    "--endpoint",
    "ui",
    "--cases",
    args.cases,
    "--pink",
    f.root,
    "--project",
    f.root,
    "--preview",
    "--output",
    out,
  ]);
  const plan = JSON.parse(await readFile(out, "utf8"));
  assert.equal(plan.steps.execution.willSubmit, false);
  const v1 = join(f.root, "v1.json");
  await writeFile(v1, await readFile(sample("new-platform-edited")));
  await exec(process.execPath, [
    cli,
    "--input",
    v1,
    "--pink",
    f.root,
    "--project",
    f.root,
    "--preview",
    "--output",
    join(f.root, "v1-plan.json"),
  ]);
  assert.equal(
    JSON.parse(await readFile(join(f.root, "v1-plan.json"), "utf8")).steps.execution.willSubmit,
    false,
  );
  await assert.rejects(
    exec(process.execPath, [cli, "--input", v1, "--endpoint", "ui"]),
    /endpoint/,
  );
});

test("new platform and standard field definitions are carried by native catalog, with explicit execution order", async (t) => {
  const f = await fixture(t);
  const p = f.catalog.platforms[0];
  p.id = "qa-native-platform";
  p.label = "QA Native Platform";
  for (const c of p.combinations) c.id = `qa.${c.template}`;
  f.catalog.targets = [
    {
      id: p.id,
      label: p.label,
      configurationTitle: p.label,
      category: "X-Application",
      fields: { qaQuality: { kind: "string", control: "enum" } },
    },
  ];
  f.catalog.fieldTypes.qaQuality = { kind: "string", choices: ["qa-added"] };
  p.combinations.find((c) => c.template === "publish")!.values.qaQuality = "qa-added";
  f.catalog.executionOrder = ["qa.debug", "qa.publish"];
  await f.save();
  const loaded = await loadNativeCases(f.file, {
    project: f.root,
    cases: "qa.publish,qa.debug",
    endpoint: "ui",
  });
  assert.deepEqual(
    loaded.document.cases.map((c) => c.caseId),
    ["qa.debug", "qa.publish"],
  );
  assert.deepEqual(loaded.document.targets, f.catalog.targets);
  assert.equal(configurationStepsPlan(loaded).execution.willSubmit, false);
  const blocked = await loadNativeCases(f.file, { project: f.root, cases: "qa.publish" });
  assert.equal(blocked.document.cases.length, 0);
  assert.match(blocked.catalog!.cases[0].gaps.map((g) => g.reason).join(";"), /新标准平台/);
  // A UI-only document can be read without a fabricated four-group wrapper.
  const generated = configurationCheckDocument({
    caseId: "qa.custom",
    platform: p.id,
    targets: f.catalog.targets,
    values: { qaQuality: "qa-added" },
  });
  assert.equal(validateNativeDocument(generated).format, "steps");
});

test("runtime candidate validation does not mutate or reuse the fixed candidate list as a product whitelist", async (t) => {
  const f = await fixture(t);
  const original = structuredClone(supportedFieldTypes);
  const document = configurationCheckDocument({
    caseId: "qa.candidate",
    platform: "web-desktop",
    values: { nativeCodeBundleMode: "new-product-candidate" },
  });
  const file = join(f.root, "new-candidate.json");
  await writeFile(file, serializeNativeDocument(document));
  const loaded = await loadNativeCases(file, { project: f.root });
  assert.deepEqual(loaded.inputs!.preview.cases[0].blockers, []);
  assert.deepEqual(supportedFieldTypes, original);
  const info = describeNativeCaseCapabilities();
  const parameters = info.fields.steps.operations.find(
    (op) => op.op === "config.select",
  )!.parameters;
  assert.ok("properties" in parameters);
  assert.equal(parameters.properties!.candidate.oneOf!.length, 2);
  const printed = JSON.parse((await exec(process.execPath, [cli, "--describe"])).stdout);
  assert.equal(printed.planNoBuildField, "steps.execution.willSubmit");
  assert.equal(resolve(loaded.path), file);
});

test("explicit mixed enum descriptors preserve typed inputs through loading and keep ordinary control restrictions", async (t) => {
  const f = await fixture(t);
  const target: ConfigurationTarget = {
    id: "web-desktop",
    label: "Web 桌面端",
    configurationTitle: "Web 桌面端",
    category: "X-Device",
    fields: {
      sourceMaps: {
        kind: "scalar",
        control: "enum",
        valueKinds: ["boolean", "string"],
        locator: { kind: "option-key", key: "sourceMaps" },
        scope: { readyKeys: ["name", "buildPath"] },
      },
    },
  };
  for (const value of [false, true, "inline"]) {
    const document = configurationCheckDocument({
      caseId: "qa.mixed",
      platform: target.id,
      targets: [target],
      values: { sourceMaps: value },
    });
    const file = join(f.root, "mixed.json");
    await writeFile(file, serializeNativeDocument(document));
    const loaded = await loadNativeCases(file, { project: f.root });
    assert.deepEqual(loaded.inputs!.preview.cases[0].blockers, []);
    assert.equal(configurationStepsPlan(loaded).execution.willSubmit, false);
    assert.deepEqual(loaded.document.targets, [target]);
    const set = loaded.document.cases[0].steps.find((s) => s.op === "set");
    assert.ok(set?.op === "set");
    assert.equal(set.value, value);
  }
  assert.throws(
    () =>
      configurationCheckDocument({
        caseId: "qa.bad-type",
        platform: target.id,
        targets: [target],
        values: { sourceMaps: 0 },
      }),
    /boolean\/string/,
  );
  for (const field of [
    { kind: "scalar", control: "text", valueKinds: ["boolean", "string"] },
    { kind: "scalar", control: "enum", valueKinds: ["string"] },
    { kind: "scalar", control: "enum", valueKinds: ["string", "string"] },
    { kind: "string", control: "enum", valueKinds: ["string", "boolean"] },
  ])
    assert.throws(
      () => validateConfigurationTargets([{ ...target, fields: { sourceMaps: field } }]),
      /标准文本/,
    );
  assert.throws(
    () =>
      validateConfigurationTargets([
        { ...target, fields: { "packages.android.mode": target.fields.sourceMaps } },
      ]),
    /其他平台/,
  );
  assert.throws(
    () =>
      validateConfigurationTargets([{ ...target, fields: { token: target.fields.sourceMaps } }]),
    /敏感/,
  );
});
