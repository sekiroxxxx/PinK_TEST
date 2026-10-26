import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { loadCatalogSteps, catalogStepResults } from "./catalog-steps-loader.js";
import { configurationStepsPlan } from "./configuration-steps-contract.js";
import {
  configurationStepsLaunchPlan,
  runConfigurationStepsFromStartup,
} from "./configuration-steps-startup.js";
import { runConfigurationSteps } from "./configuration-steps.js";
import { ConfigurationOperations, type ConfigurationPort } from "./configuration-operations.js";
import { ExecutionContext } from "./configuration-context.js";
import type { CatalogDocument } from "./case-contract.js";
import { describeFieldCapabilities } from "./field-capabilities.js";
import { loadConfigurationSteps } from "./configuration-steps-contract.js";
import type { BuildStepsDocument } from "./build-steps-contract.js";

const exec = promisify(execFile);
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pink-catalog-entry-"));
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "package.json"), "{}");
  for (const [name, uuid] of [
    ["a", "scene-A"],
    ["b", "scene-B"],
  ]) {
    await writeFile(join(root, `assets/${name}.scene`), "{}");
    await writeFile(join(root, `assets/${name}.scene.meta`), JSON.stringify({ uuid }));
  }
  const catalog = JSON.parse(
    await readFile(new URL("../../case-catalog/public-combinations.json", import.meta.url), "utf8"),
  ) as CatalogDocument;
  const publish = catalog.platforms
    .find((p) => p.id === "web-desktop")!
    .combinations.find((c) => c.template === "publish")!;
  publish.values = { name: "qa_catalog_A" };
  publish.fieldCoverage = {};
  publish.variants = [];
  publish.configurationOrder = [];
  publish.excludedFields = Object.keys(catalog.templates.find((t) => t.id === "publish")!.values);
  const forms = JSON.parse(
    await readFile(
      new URL("../../case-catalog/form-validation-design.json", import.meta.url),
      "utf8",
    ),
  );
  catalog.formValidation = forms;
  const file = join(root, "catalog.json");
  const save = () => writeFile(file, JSON.stringify(catalog));
  await save();
  await mkdir(join(root, "resources/app"), { recursive: true });
  await writeFile(join(root, "PinK.exe"), "offline executable identity fixture, never launched");
  await writeFile(
    join(root, "resources/app/product.json"),
    JSON.stringify({ pinkVersion: "fixture", commit: "fixture" }),
  );
  return {
    root,
    catalog,
    publish,
    file,
    save,
    dispose: async () => {
      assert.equal(dirname(root), tmpdir());
      await rm(root, { recursive: true });
    },
  };
}

test("catalog CLI previews and checks the same v2 launch plan; QA JSON edits invalidate it", async () => {
  const w = await fixture();
  try {
    const output = join(w.root, "plan.json");
    const cli = new URL("./configuration-steps-cli.js", import.meta.url).pathname.replace(
      /^\/(\w:)/,
      "$1",
    );
    const args = [
      cli,
      "--catalog",
      w.file,
      "--cases",
      "review.publish.web-desktop,review.mixed.web-mobile",
      "--pink",
      w.root,
      "--project",
      w.root,
      "--results",
      join(w.root, "results"),
    ];
    await exec(process.execPath, [...args, "--preview", "--output", output]);
    const plan = JSON.parse(await readFile(output, "utf8"));
    assert.equal(plan.steps.schemaVersion, 2);
    assert.equal(plan.steps.catalog.cases.length, 2);
    assert.equal(plan.steps.cases.length, 1);
    assert.equal(plan.steps.catalog.cases[1].status, "blocked");
    assert.equal(
      plan.steps.cases[0].steps.find((s: { op: string }) => s.op === "set").value,
      "qa_catalog_A",
    );
    assert.match(
      (await exec(process.execPath, [...args, "--check-plan", "--expected-plan", output])).stdout,
      /未连接 PinK/,
    );
    const loaded = await loadCatalogSteps(w.file, {
      project: w.root,
      cases: "review.publish.web-desktop",
    });
    w.publish.values.name = "qa_catalog_B";
    await w.save();
    await assert.rejects(loaded.verifySource!(), /重新预览/);
    await assert.rejects(
      exec(process.execPath, [...args, "--check-plan", "--expected-plan", output]),
      (error: Error & { stderr?: string }) => /预览计划不符/.test(error.stderr ?? ""),
    );
    const changed = await loadCatalogSteps(w.file, {
      project: w.root,
      cases: "review.publish.web-desktop",
    });
    assert.ok(
      changed.document.cases[0].steps.some((s) => s.op === "set" && s.value === "qa_catalog_B"),
    );
  } finally {
    await w.dispose();
  }
});

test("all-blocked catalog produces a report before any PinK connection and preserves selected reasons", async () => {
  const w = await fixture();
  try {
    const loaded = await loadCatalogSteps(w.file, {
      project: w.root,
      cases: "review.mixed.web-desktop",
      groups: "mixed",
    });
    assert.equal(loaded.document.cases.length, 0);
    assert.equal(configurationStepsPlan(loaded).catalog!.cases[0].status, "blocked");
    const plan = await configurationStepsLaunchPlan(loaded, {
      pink: w.root,
      project: w.root,
      port: 65534,
      configurationTimeoutMs: 1000,
      resultsRoot: join(w.root, "results"),
    });
    const result = await runConfigurationStepsFromStartup(loaded, plan);
    const data = JSON.parse(await readFile(join(result.directory, "result.json"), "utf8"));
    assert.equal(data.launch, undefined);
    assert.equal(data.evidenceKind, "offline-preflight");
    assert.equal(data.buildAttempted, false);
    assert.equal(data.cases[0].outcome, "blocked");
    assert.match(data.cases[0].failure.reason, /适用清单/);
    assert.match(
      await readFile(join(result.directory, "report.html"), "utf8"),
      /review.mixed.web-desktop/,
    );
    const merged = catalogStepResults(loaded, []);
    assert.equal(merged[0].caseId, "review.mixed.web-desktop");
  } finally {
    await w.dispose();
  }
});

test("FORM scene protection and parent visibility compile into editable v2 steps and restore real shared operations", async () => {
  const w = await fixture();
  try {
    const loaded = await loadCatalogSteps(w.file, {
      project: w.root,
      cases: "FORM-C06.s02,FORM-C08.s01",
      groups: "conditional",
    });
    assert.ok(
      loaded.catalog!.cases.every((c) => c.status === "ready"),
      JSON.stringify(loaded.catalog),
    );
    const initial = {
      startScene: "scene-A",
      scenes: ["db://assets/a.scene", "db://assets/b.scene"],
      md5Cache: true,
      "md5CacheOptions.handleTemplateMd5Link": true,
    };
    const values: Record<string, unknown> = structuredClone(initial);
    const identity = { executable: "fixture.exe", project: w.root, windowId: 1 };
    const session = new ExecutionContext(identity, async () => identity);
    let generation = 0,
      open = false,
      clearCalls = 0;
    const port: ConfigurationPort = {
      inspect: async (field) =>
        field === "md5CacheOptions.handleTemplateMd5Link" && !values.md5Cache
          ? null
          : {
              value: structuredClone(values[field]) as never,
              kind: field === "scenes" ? "array" : field === "startScene" ? "string" : "boolean",
              selector: "fixture",
              disabled: false,
              ...(field === "scenes"
                ? {
                    choices: [
                      {
                        value: "db://assets/a.scene",
                        checked: true,
                        disabled: true,
                        selector: "sceneA",
                        protectedReason: "initial-scene" as const,
                      },
                      {
                        value: "db://assets/b.scene",
                        checked: (values.scenes as string[]).includes("db://assets/b.scene"),
                        disabled: false,
                        selector: "sceneB",
                      },
                    ],
                  }
                : {}),
            },
      read: async (field) => {
        const control = await port.inspect(field);
        assert.ok(control);
        return control;
      },
      set: async (field, value) => {
        assert.equal(open, true);
        const changed = JSON.stringify(values[field]) !== JSON.stringify(value);
        values[field] = structuredClone(value);
        return changed;
      },
      restoreControl: async (field, value) => {
        values[field] = structuredClone(value.value);
      },
      alerts: async () => [],
      primaryBuildEnabled: async () => true,
      ready: async () => {
        assert.equal(open, true);
      },
      clearAllScenes: async () => {
        clearCalls++;
        values.scenes = ["db://assets/a.scene"];
      },
      cancelFileChoice: async () => assert.fail("not a cancellation case"),
      reopen: async () => {
        generation++;
      },
    };
    const result = await runConfigurationSteps(loaded, {
      session,
      evidenceKind: "offline-fixture",
      verifySource: loaded.verifySource,
      openConfiguration: async (platform) => {
        assert.equal(open, false);
        open = true;
        generation++;
        const bind = () =>
          session.bind(platform, platform, generation, async () => {
            assert.equal(open, true);
            return { title: platform, generation };
          });
        return new ConfigurationOperations(bind(), port, async () => bind());
      },
      closeConfiguration: async () => {
        open = false;
      },
    });
    assert.equal(
      result.outcome,
      "passed",
      JSON.stringify(result.cases.map((c) => c.steps.filter((s) => s.error))),
    );
    assert.equal(clearCalls, 1);
    assert.deepEqual(values, initial);
    assert.equal(result.buildSubmitted, false);
    assert.ok(result.cases.every((c) => c.restoration === "passed"));
    assert.ok(loaded.document.cases.every((c) => !c.steps.some((s) => s.op === "build.submit")));
  } finally {
    await w.dispose();
  }
});

test("operation capabilities advertise the validator's actions and assertions, including recovery constraints", () => {
  const capabilities = describeFieldCapabilities().steps;
  assert.equal(capabilities.schemaVersion, 2);
  assert.ok(capabilities.operations.some((op) => op.op === "input.cancel-file"));
  assert.ok(capabilities.assertions.some((check) => check.check === "unchanged"));
  assert.equal(capabilities.operations.find((op) => op.op === "build.submit")!.cleanup, false);
  assert.equal(capabilities.operations.find((op) => op.op === "stage.restore")!.cleanup, true);
});

test("FORM file cancellation and signing-empty input retain material references, rebind and restore without submitting", async () => {
  const w = await fixture();
  try {
    const keystore = join(w.root, "fixture.keystore"),
      services = join(w.root, "services.json");
    await writeFile(keystore, "offline file, never used for signing");
    await writeFile(services, JSON.stringify({ client: { package_name: "com.testcases.cocos" } }));
    const materials = join(w.root, "materials.json");
    const secret = "private-offline-fixture-password";
    await writeFile(
      materials,
      JSON.stringify({
        schemaVersion: 1,
        bindings: {
          androidSigning: {
            path: keystore,
            alias: "fixture-alias",
            password: secret,
            aliasPassword: secret,
          },
          agcServices: { path: services },
        },
      }),
    );
    const loaded = await loadCatalogSteps(w.file, {
      project: w.root,
      materials,
      cases: "FORM-N01.s02,FORM-A01.s01",
      groups: "conditional",
    });
    assert.ok(
      loaded.catalog!.cases.every((c) => c.status === "ready"),
      JSON.stringify(loaded.catalog!.cases),
    );
    assert.ok(!JSON.stringify(configurationStepsPlan(loaded)).includes(secret));
    assert.ok(loaded.document.cases[0].steps.some((s) => s.op === "input.clear-field"));
    const initial = {
      "packages.android.useDebugKeystore": false,
      "packages.android.keystorePath": "original.keystore",
      "packages.android.keystorePassword": "original-private-fixture",
      "packages.android.keystoreAlias": "original-alias",
      "packages.android.keystoreAliasPassword": "original-private-fixture",
      "packages.huawei-agc.serviceConfigPath": "original-services.json",
      "packages.huawei-agc.packageName": "com.original.fixture",
    };
    const values: Record<string, unknown> = structuredClone(initial);
    const identity = { executable: "fixture.exe", project: w.root, windowId: 1 };
    const session = new ExecutionContext(identity, async () => identity);
    let generation = 0,
      open = false,
      cancelled = 0;
    const port: ConfigurationPort = {
      inspect: async (field) =>
        !(field in values)
          ? null
          : {
              value: values[field] as never,
              kind: typeof values[field] === "boolean" ? "boolean" : "string",
              disabled: false,
              selector: "fixture",
            },
      read: async (field) => {
        const c = await port.inspect(field);
        assert.ok(c);
        return c;
      },
      set: async (field, value) => {
        assert.ok(open);
        const changed = values[field] !== value;
        values[field] = value;
        return changed;
      },
      restoreControl: async (field, original) => {
        values[field] = original.value;
      },
      alerts: async (field) =>
        field === "packages.android.keystorePassword" && values[field] === "" ? ["不能为空"] : [],
      primaryBuildEnabled: async () => true,
      ready: async () => {},
      cancelFileChoice: async (field) => {
        assert.equal(field, "packages.huawei-agc.serviceConfigPath");
        cancelled++;
        generation++;
      },
      reopen: async () => {
        generation++;
      },
    };
    const env = {
      session,
      evidenceKind: "offline-fixture" as const,
      openConfiguration: async (platform: string) => {
        assert.equal(open, false);
        open = true;
        generation++;
        const bind = () =>
          session.bind(platform, platform, generation, async () => {
            assert.ok(open);
            return { title: platform, generation };
          });
        return new ConfigurationOperations(bind(), port, async () => bind());
      },
      closeConfiguration: async () => {
        open = false;
      },
    };
    const result = await runConfigurationSteps(loaded, env);
    assert.equal(result.outcome, "passed", JSON.stringify(result.cases));
    assert.equal(result.buildSubmitted, false);
    assert.equal(cancelled, 1);
    assert.deepEqual(values, initial);
    assert.ok(!JSON.stringify(result).includes(secret));

    // QA can change failure policy/requirements in JSON, without changing the operation layer.
    const base = (loaded.document as BuildStepsDocument).cases[0];
    const blocked = structuredClone(base),
      failed = structuredClone(base),
      passed = structuredClone(base);
    blocked.caseId = "blocked-initial";
    failed.caseId = "failed-prompt";
    passed.caseId = "continued-after-recovery";
    blocked.steps.splice(2, 0, {
      id: "differentInitial",
      op: "config.require",
      page: "open",
      expected: { differs: { "packages.android.useDebugKeystore": false } },
    });
    const prompt = failed.steps.find((s) => s.op === "assert" && s.check === "prompt")!;
    if (prompt.op === "assert" && prompt.check === "prompt")
      prompt.expected = { kind: "contains", text: "a different product prompt" };
    const edited = join(w.root, "edited-steps.json");
    await writeFile(
      edited,
      JSON.stringify({
        kind: "pink-configuration-steps",
        schemaVersion: 2,
        cases: [blocked, failed, passed],
      }),
    );
    const changed = await loadConfigurationSteps(edited, { project: w.root, materials });
    const continued = await runConfigurationSteps(changed, env);
    assert.deepEqual(
      continued.cases.map((c) => c.outcome),
      ["blocked", "failed", "passed"],
    );
    assert.ok(continued.cases.every((c) => c.restoration === "passed"));
    assert.deepEqual(values, initial);
    assert.equal(continued.stopped, false);

    port.restoreControl = async () => {
      throw new Error("fixture recovery failure");
    };
    const stopped = await runConfigurationSteps(changed, env);
    assert.equal(stopped.stopped, true);
    assert.equal(stopped.cases[1].restoration, "failed");
    assert.equal(stopped.cases[2].outcome, "skipped");
  } finally {
    await w.dispose();
  }
});
