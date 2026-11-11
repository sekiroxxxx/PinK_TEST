import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { caseContract } from "./case-contract.js";
import { discoverScenes, confirmScenes, sceneValues } from "./case-inputs.js";
import { createOfflinePlan, readRunConfiguration } from "./offline-plan.js";

const exec = promisify(execFile);
const catalogFile = fileURLToPath(
  new URL("../../case-catalog/public-combinations.json", import.meta.url),
);
const catalog = () => readFile(catalogFile, "utf8").then((s) => JSON.parse(s));
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "pink-case-loading-test-"));
  t.after(async () => {
    assert.equal(dirname(root), tmpdir());
    await rm(root, { recursive: true });
  });
  const project = join(root, "project"),
    assets = join(project, "assets"),
    local = join(root, "local");
  await mkdir(assets, { recursive: true });
  await mkdir(local);
  await writeFile(join(project, "package.json"), '{"name":"fixture"}');
  for (const [name, uuid] of [
    ["z", "scene-z"],
    ["a", "scene-a"],
  ]) {
    await writeFile(join(assets, `${name}.scene`), "{}");
    await writeFile(join(assets, `${name}.scene.meta`), JSON.stringify({ uuid }));
  }
  await writeFile(join(assets, "orphan.scene.meta"), '{"uuid":"orphan"}');
  const source = join(root, "cases.json");
  await writeFile(source, JSON.stringify(await catalog()));
  await writeFile(join(local, "android.keystore"), "test material, not a valid signing key");
  const materials = join(local, "materials.json");
  await writeFile(
    materials,
    JSON.stringify({
      schemaVersion: 1,
      bindings: {
        androidSigning: {
          path: "./android.keystore",
          alias: "fixture",
          password: "fixture-private-password",
          aliasPassword: "fixture-private-alias-password",
        },
        nativeEncryption: { key: "fixture-private-native-key" },
      },
      platformValues: { android: { publish: { "packages.android.apiLevel": 35 } } },
    }),
  );
  return { root, project, assets, local, source, materials };
}

test("shared contract inherits templates, respects overrides/exclusions and accepts a new revision and Chinese literal", async () => {
  const c = await catalog();
  c.revision = "qa-edited-next-version";
  c.templates.find((t: { id: string }) => t.id === "publish").values.md5Cache = false;
  const combo = c.platforms.find((p: { id: string }) => p.id === "web-desktop").combinations[0];
  combo.values.name = "QA 中文测试名称";
  const normalized = caseContract.normalize(c);
  const target = normalized.platforms.find((p) => p.id === "web-desktop")!.combinations[0];
  assert.equal(target.values.name, "QA 中文测试名称");
  assert.equal(target.values.md5Cache, false);
  assert.ok(!Object.hasOwn(combo.values, "md5Cache"));
  const next = normalized.platforms.find((p) => p.id === "harmonyos-next")!.combinations[0];
  assert.ok(!Object.hasOwn(next.values, "sourceMaps"));
  combo.values.md5Cache = true;
  assert.equal(
    caseContract.normalize(c).platforms.find((p) => p.id === "web-desktop")!.combinations[0].values
      .md5Cache,
    true,
  );
});

test("bad field names, types, platform fields and schema fail before execution", async () => {
  for (const change of [
    (c: Awaited<ReturnType<typeof catalog>>) => {
      c.platforms[0].combinations[0].values.typoOption = true;
    },
    (c: Awaited<ReturnType<typeof catalog>>) => {
      c.platforms[0].combinations[0].values.debug = "false";
    },
    (c: Awaited<ReturnType<typeof catalog>>) => {
      c.platforms[0].combinations[0].values["packages.android.keystoreAlias"] = "x";
    },
    (c: Awaited<ReturnType<typeof catalog>>) => {
      c.schemaVersion = 2;
    },
    (c: Awaited<ReturnType<typeof catalog>>) => {
      c.bindings = { privateData: "must-not-embed" };
    },
    (c: Awaited<ReturnType<typeof catalog>>) => {
      c.platforms
        .find((p: { id: string }) => p.id === "harmonyos-next")
        .combinations[0].variants.push({ title: "wrong", values: { sourceMaps: "false" } });
    },
    (c: Awaited<ReturnType<typeof catalog>>) => {
      c.conditionalScenarios[0].executionOperation = "unknown-operation";
    },
    (c: Awaited<ReturnType<typeof catalog>>) => {
      c.platforms.find((p: { id: string }) => p.id === "android").combinations[0].values[
        "packages.android.keystorePassword"
      ] = "must-not-export-this";
    },
  ]) {
    const c = await catalog();
    change(c);
    assert.throws(() => caseContract.validate(c));
  }
});

test("automatic scenes exclude orphan metadata, sort deterministically and prefer an observed current scene", async (t) => {
  const f = await fixture(t),
    context = await discoverScenes(f.project);
  assert.deepEqual(
    context.candidates.map((s) => s.uuid),
    ["scene-a", "scene-z"],
  );
  assert.equal(context.runtimeConfirmed, false);
  confirmScenes(context, "scene-z");
  assert.equal(context.primary?.uuid, "scene-z");
  assert.deepEqual(
    sceneValues(
      {
        startScene: { $scene: "primary" },
        scenes: [{ $scene: "primary" }, { $scene: "secondary" }],
      },
      context,
    ),
    { startScene: "scene-z", scenes: ["scene-z", "scene-a"] },
  );
});

test("a retained template field is excluded from variant assignments", async (t) => {
  const f = await fixture(t),
    c = await catalog();
  c.platforms.find((p: { id: string }) => p.id === "web-desktop").combinations[0].variants = [
    { title: "仅保留", values: {}, retained: ["md5Cache"] },
  ];
  await writeFile(f.source, JSON.stringify(c));
  const plan = await createOfflinePlan({
    casesFile: f.source,
    project: f.project,
    groups: "publish",
    cases: "review.publish.web-desktop.variant-1",
  });
  assert.ok(plan.cases[0].retained.includes("md5Cache"));
  assert.ok(!Object.hasOwn(plan.cases[0].values, "md5Cache"));
  assert.ok(!plan.cases[0].assignments.some((a) => a.field === "md5Cache"));
});

test("real material binding and project scene inputs produce a redacted offline plan; missing material is case-local", async (t) => {
  const f = await fixture(t);
  const cases = "review.publish.android,review.publish.taobao-mini-game,review.publish.web-desktop";
  const plan = await createOfflinePlan({
    casesFile: f.source,
    project: f.project,
    materials: f.materials,
    groups: "publish",
    cases,
  });
  assert.equal(plan.summary.total, 3);
  assert.equal(plan.summary.blocked, 0);
  assert.equal(plan.maxTasksPerGroup, 2);
  assert.deepEqual(
    plan.cases.map((c) => c.batch),
    [1, 1, 2],
  );
  const android = plan.cases.find((c) => c.platform === "android")!;
  assert.equal(android.values["packages.android.keystorePath"], join(f.local, "android.keystore"));
  assert.equal(android.values["packages.android.keystorePassword"], "[redacted]");
  const taobao = plan.cases.find((c) => c.platform === "taobao-mini-game")!;
  assert.equal(taobao.values.startSceneAssetBundle, false);
  assert.equal(taobao.values["packages.taobao-mini-game.globalAdapter"], false);
  assert.equal(
    taobao.values["packages.taobao-mini-game.globalVariable"],
    "localStorage,CANNON,LZString,protobuf",
  );
  assert.equal(taobao.values.startScene, "scene-a");
  assert.equal(taobao.sceneResolution?.runtimeConfirmed, false);
  assert.ok(!JSON.stringify(plan).includes("fixture-private"));
  const missing = await createOfflinePlan({
    casesFile: f.source,
    project: f.project,
    groups: "publish",
    cases,
  });
  assert.equal(missing.summary.blocked, 1);
  assert.equal(missing.summary.readyForRuntimePreflight, 2);
  assert.equal(missing.buildSubmitted, false);
  assert.equal(missing.runtimeVerified, false);
});

test("run config resolves paths relative to its own file and real CLI preview never requires a running PinK", async (t) => {
  const f = await fixture(t),
    config = join(f.root, "run.json"),
    output = join(f.root, "plan.json");
  await writeFile(
    config,
    JSON.stringify({
      schemaVersion: 1,
      casesFile: "./cases.json",
      project: "./project",
      materials: "./local/materials.json",
      groups: "publish",
      caseIds: ["review.publish.taobao-mini-game"],
    }),
  );
  assert.equal((await readRunConfiguration(config)).project, f.project);
  await exec(
    process.execPath,
    [
      fileURLToPath(new URL("./cli.js", import.meta.url)),
      "--run-config",
      config,
      "--preview",
      "--preview-file",
      output,
    ],
    { cwd: tmpdir() },
  );
  const plan = JSON.parse(await readFile(output, "utf8"));
  assert.equal(plan.kind, "pink-build-plan");
  assert.equal(plan.buildSubmitted, false);
  assert.equal(plan.runtimeVerified, false);
  assert.equal(plan.cases[0].caseId, "review.publish.taobao-mini-game");
  assert.ok(plan.snapshot.sha256);
  assert.equal(await readFile(join(f.project, "package.json"), "utf8"), '{"name":"fixture"}');
});

test("directories are not signing files and password references cannot leak through ordinary text fields", async (t) => {
  const f = await fixture(t);
  const material = JSON.parse(await readFile(f.materials, "utf8"));
  material.bindings.androidSigning.path = ".";
  await writeFile(f.materials, JSON.stringify(material));
  const badFile = await createOfflinePlan({
    casesFile: f.source,
    project: f.project,
    materials: f.materials,
    groups: "publish",
    cases: "review.publish.android",
  });
  assert.equal(badFile.summary.blocked, 1);
  assert.ok(badFile.cases[0].blockers.some((b) => b.reason.includes("材料文件不可访问")));
  const c = await catalog();
  c.platforms.find((p: { id: string }) => p.id === "web-desktop").combinations[0].values.name = {
    $material: "androidSigning.password",
  };
  await writeFile(f.source, JSON.stringify(c));
  const wrongField = await createOfflinePlan({
    casesFile: f.source,
    project: f.project,
    materials: f.materials,
    groups: "publish",
    cases: "review.publish.web-desktop",
  });
  assert.equal(wrongField.summary.blocked, 1);
  assert.ok(!JSON.stringify(wrongField).includes("fixture-private"));
});

test(
  "PowerShell QA entry preserves explicitly selected timeouts during offline preview",
  { skip: process.platform !== "win32" },
  async (t) => {
    const f = await fixture(t),
      config = join(f.root, "run.json"),
      output = join(f.root, "plan.json");
    await writeFile(
      config,
      JSON.stringify({
        schemaVersion: 1,
        casesFile: f.source,
        project: f.project,
        groups: "publish",
        caseIds: ["review.publish.taobao-mini-game"],
      }),
    );
    await exec("pwsh.exe", [
      "-NoProfile",
      "-File",
      fileURLToPath(new URL("../../../run-build-ui.ps1", import.meta.url)),
      "-RunConfig",
      config,
      "-Preview",
      "-PreviewFile",
      output,
      "-TimeoutSeconds",
      "321",
      "-QueueTimeoutSeconds",
      "654",
      "-ConfigurationTimeoutSeconds",
      "87",
    ]);
    const plan = JSON.parse(await readFile(output, "utf8"));
    assert.deepEqual(plan.timeoutsMs, {
      startupWait: 654000,
      processing: 321000,
      configuration: 87000,
    });
    assert.equal(plan.buildSubmitted, false);
  },
);

test("generated page and runner consume the same QA-edited source and the browser receives the same validator", async (t) => {
  const f = await fixture(t),
    c = await catalog(),
    output = join(f.root, "cases.html");
  const combo = c.platforms.find((p: { id: string }) => p.id === "taobao-mini-game")
    .combinations[0];
  combo.values["packages.taobao-mini-game.globalVariable"] = "QAChangedGlobal";
  c.revision = "qa-edited-document";
  await writeFile(f.source, JSON.stringify(c));
  await exec(process.execPath, [
    fileURLToPath(new URL("../../case-catalog/generate.mjs", import.meta.url)),
    "--cases-file",
    f.source,
    "--output",
    output,
  ]);
  const html = await readFile(output, "utf8");
  const json = html.match(
    /<script id="catalog-data" type="application\/json">([\s\S]*?)<\/script>/,
  )![1];
  const page = JSON.parse(json);
  assert.deepEqual(page.executionSource, c);
  const plan = await createOfflinePlan({
    casesFile: f.source,
    project: f.project,
    groups: "publish",
    cases: combo.id,
  });
  assert.equal(page.executionSourceHash, plan.snapshot.sha256);
  assert.equal(plan.snapshot.revision, "qa-edited-document");
  const shown = page.presentation.platforms
    .find((p: { id: string }) => p.id === "taobao-mini-game")
    .combinations.find((x: { id: string }) => x.id === combo.id);
  assert.equal(shown.values["packages.taobao-mini-game.globalVariable"], "QAChangedGlobal");
  assert.equal(plan.cases[0].values["packages.taobao-mini-game.globalVariable"], "QAChangedGlobal");
  const shared = html
    .match(/<script>\s*globalThis\.PinkCaseContract\s*=([\s\S]*?)<\/script>/)![0]
    .replace(/^<script>|<\/script>$/g, "");
  const browser = { structuredClone, globalThis: {} as { PinkCaseContract?: typeof caseContract } };
  runInNewContext(shared, browser);
  const invalid = structuredClone(c);
  invalid.platforms[0].combinations[0].values.debug = "bad";
  assert.throws(() => browser.globalThis.PinkCaseContract!.validate(invalid));
});
