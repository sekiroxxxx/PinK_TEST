import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, realpath } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readBuildPreferences } from "./build-preferences.js";
import { describeFieldCapabilities, validateExecutableCatalog } from "./field-capabilities.js";
import { createOfflinePlan } from "./offline-plan.js";
import { verifyExpectedPlan } from "./plan-integrity.js";
import {
  workspaceFolderPath,
  sameCanonicalPath,
  verifyWorkspaceObservation,
  type WorkspaceObservation,
} from "./workspace-identity.js";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
const rootCatalog = fileURLToPath(
  new URL("../../case-catalog/public-combinations.json", import.meta.url),
);

test("four-group preferences allow only an absent cache, preserving existing-mode and corrupt-file errors", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await readBuildPreferences(f.project, true), {});
  await assert.rejects(readBuildPreferences(f.project, false), { code: "ENOENT" });
  const preferences = join(f.project, "temp/pink-builder/preferences.json");
  await mkdir(dirname(preferences), { recursive: true });
  await writeFile(preferences, '{"android":{"nextStages":["generate"]}}');
  assert.deepEqual((await readBuildPreferences(f.project, true)).android.nextStages, ["generate"]);
  await writeFile(preferences, "invalid json");
  await assert.rejects(readBuildPreferences(f.project, true), SyntaxError);
});
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "pink-execution-contract-"));
  t.after(async () => {
    assert.equal(dirname(root), tmpdir());
    await rm(root, { recursive: true });
  });
  const project = join(root, "first", "project %20 #中文"),
    other = join(root, "second", "project %20 #中文");
  for (const dir of [project, other]) {
    await mkdir(join(dir, "assets"), { recursive: true });
    await writeFile(join(dir, "package.json"), '{"name":"fixture"}');
    await writeFile(join(dir, "assets", "a.scene"), "{}");
    await writeFile(join(dir, "assets", "a.scene.meta"), '{"uuid":"actual-fixture-scene"}');
  }
  const pink = join(root, "package"),
    executable = join(pink, "PinK.exe"),
    productFile = join(pink, "resources", "app", "product.json");
  await mkdir(dirname(productFile), { recursive: true });
  await writeFile(executable, "offline identity fixture, never executed");
  await writeFile(productFile, '{"pinkVersion":"offline-fixture","commit":"fixture"}');
  const casesFile = join(root, "cases.json"),
    materials = join(root, "materials.json"),
    signingFile = join(root, "test.keystore"),
    runConfig = join(root, "run.json");
  await writeFile(casesFile, await readFile(rootCatalog));
  await writeFile(signingFile, "offline fixture, not a real signing key");
  const privateData = {
    schemaVersion: 1,
    bindings: {
      androidSigning: {
        path: "./test.keystore",
        password: "private-fixture-password",
        alias: "fixture",
        aliasPassword: "private-fixture-alias-password",
      },
      android: { publish: { apiLevel: 35 } },
    },
  };
  await writeFile(materials, JSON.stringify(privateData));
  const options = {
    pink,
    project,
    casesFile,
    materials,
    groups: "publish",
    cases: "review.publish.web-desktop,review.publish.android",
    runConfig,
    port: 9222,
  };
  await writeFile(
    runConfig,
    JSON.stringify({
      schemaVersion: 1,
      pink,
      project,
      casesFile,
      materials,
      groups: options.groups,
      caseIds: options.cases.split(","),
      port: 9222,
    }),
  );
  const observed: WorkspaceObservation = {
    available: true,
    windowId: 1,
    execPath: executable,
    workspace: {
      uri: {
        scheme: "file",
        authority: "",
        path: (process.platform === "win32" ? "/" : "") + project.replaceAll("\\", "/"),
      },
    },
  };
  return {
    root,
    project,
    other,
    executable,
    productFile,
    casesFile,
    materials,
    signingFile,
    privateData,
    runConfig,
    options,
    observed,
  };
}

test("executor capabilities reject self-registered fields, type changes and sensitive downgrades", async () => {
  const doc = JSON.parse(await readFile(rootCatalog, "utf8"));
  assert.doesNotThrow(() => validateExecutableCatalog(doc));
  const unknown = structuredClone(doc);
  unknown.fieldTypes["qa.inventedField"] = { kind: "string" };
  assert.throws(() => validateExecutableCatalog(unknown), /未注册/);
  const changed = structuredClone(doc);
  changed.fieldTypes.name.kind = "object";
  assert.throws(() => validateExecutableCatalog(changed));
  const downgraded = structuredClone(doc);
  downgraded.fieldTypes["packages.android.keystorePassword"].sensitive = false;
  assert.throws(() => validateExecutableCatalog(downgraded), /敏感性/);
  const info = describeFieldCapabilities();
  assert.deepEqual(
    info.supportedFields.find((f) => f.key === "startScene")!.allowedReferenceKinds,
    ["material", "scene"],
  );
  assert.deepEqual(info.supportedFields.find((f) => f.key === "name")!.allowedReferenceKinds, [
    "material",
  ]);
  assert.deepEqual(info.supportedFields.find((f) => f.key === "sourceMaps")!.choices, [
    "false",
    "true",
    "inline",
  ]);
});

test("full workspace identity distinguishes same-name folders, validates executable and canonical aliases", async (t) => {
  const f = await fixture(t);
  const valid = await verifyWorkspaceObservation(f.observed, f.project, f.executable);
  assert.equal(valid.project, await realpath(f.project));
  await assert.rejects(
    verifyWorkspaceObservation(f.observed, f.other, f.executable),
    /工程路径不符/,
  );
  const otherExe = join(f.root, "other-PinK.exe");
  await writeFile(otherExe, "other identity fixture");
  await assert.rejects(verifyWorkspaceObservation(f.observed, f.project, otherExe), /程序路径/);
  await assert.rejects(
    verifyWorkspaceObservation(
      { available: true, execPath: f.executable },
      f.project,
      f.executable,
    ),
    /尚未打开工程/,
  );
  assert.throws(
    () => workspaceFolderPath({ configPath: { scheme: "file" }, uri: f.observed.workspace!.uri }),
    /多根/,
  );
  assert.throws(
    () => workspaceFolderPath({ uri: { scheme: "vscode-remote", path: "/project" } }),
    /file URI/,
  );
  const alias = join(f.root, "alias");
  await symlink(f.project, alias, process.platform === "win32" ? "junction" : "dir");
  assert.equal(
    (await verifyWorkspaceObservation(f.observed, alias, f.executable)).project,
    valid.project,
  );
  assert.equal(
    workspaceFolderPath({ uri: { scheme: "file", path: "/C:/QA %20 #中文/project" } }, "win32"),
    "C:\\QA %20 #中文\\project",
  );
  assert.equal(
    workspaceFolderPath(
      { uri: { scheme: "file", authority: "server", path: "/share/project" } },
      "win32",
    ),
    "\\\\server\\share\\project",
  );
  assert.equal(sameCanonicalPath("C:\\QA", "c:\\qa", "win32"), true);
  assert.equal(sameCanonicalPath("/QA", "/qa", "darwin"), false);
});

test("plan hash binds source, private material changes, files, target, scope and timeouts", async (t) => {
  const f = await fixture(t),
    plan = await createOfflinePlan(f.options),
    expected = join(f.root, "plan.json");
  assert.equal(plan.startup.issues.length, 0);
  await writeFile(expected, JSON.stringify(plan));
  assert.equal(
    (await verifyExpectedPlan(expected, await createOfflinePlan(f.options))).state,
    "matched",
  );
  assert.ok(!JSON.stringify(plan).includes("private-fixture-password"));
  const source = await readFile(f.casesFile);
  const edited = JSON.parse(source.toString());
  edited.platforms.find((p: { id: string }) => p.id === "web-desktop").combinations[0].values.name =
    "QA edited name";
  await writeFile(f.casesFile, JSON.stringify(edited));
  await assert.rejects(
    verifyExpectedPlan(expected, await createOfflinePlan(f.options)),
    /哈希不匹配/,
  );
  await writeFile(f.casesFile, source);
  f.privateData.bindings.androidSigning.password = "another-private-password";
  await writeFile(f.materials, JSON.stringify(f.privateData));
  await assert.rejects(
    verifyExpectedPlan(expected, await createOfflinePlan(f.options)),
    /哈希不匹配/,
  );
  f.privateData.bindings.androidSigning.password = "private-fixture-password";
  await writeFile(f.materials, JSON.stringify(f.privateData));
  await writeFile(f.signingFile, "changed referenced file");
  await assert.rejects(
    verifyExpectedPlan(expected, await createOfflinePlan(f.options)),
    /哈希不匹配/,
  );
  await writeFile(f.signingFile, "offline fixture, not a real signing key");
  for (const changedOptions of [
    { ...f.options, project: f.other },
    { ...f.options, cases: "review.publish.web-desktop" },
    { ...f.options, port: 9223 },
    {
      ...f.options,
      timeoutsMs: { startupWait: 1800000, processing: 600000, configuration: 123000 },
    },
  ])
    await assert.rejects(
      verifyExpectedPlan(expected, await createOfflinePlan(changedOptions)),
      /哈希不匹配/,
    );
  await writeFile(f.productFile, '{"pinkVersion":"different-version"}');
  await assert.rejects(
    verifyExpectedPlan(expected, await createOfflinePlan(f.options)),
    /哈希不匹配/,
  );
  const tampered = structuredClone(plan);
  tampered.cases[0].title = "tampered";
  await writeFile(expected, JSON.stringify(tampered));
  await assert.rejects(verifyExpectedPlan(expected, plan), /内容与其哈希不符/);
});

test("real CLI and PowerShell entry verify a plan offline and reject stale execution before launch", async (t) => {
  const f = await fixture(t),
    plan = await createOfflinePlan(f.options),
    expected = join(f.root, "plan.json");
  await writeFile(expected, JSON.stringify(plan));
  const args = ["--plan", "four-groups", "--run-config", f.runConfig, "--expected-plan", expected];
  const checked = JSON.parse((await exec(process.execPath, [cli, ...args, "--check-plan"])).stdout);
  assert.equal(checked.state, "matched");
  assert.equal(checked.runtimeVerified, false);
  assert.equal(checked.buildSubmitted, false);
  const config = JSON.parse(await readFile(f.runConfig, "utf8"));
  config.expectedPlan = "./plan.json";
  await writeFile(f.runConfig, JSON.stringify(config));
  assert.equal(
    JSON.parse(
      (await exec(process.execPath, [cli, "--run-config", f.runConfig, "--check-plan"])).stdout,
    ).state,
    "matched",
  );
  if (process.platform === "win32") {
    const ps = await exec("pwsh.exe", [
      "-NoProfile",
      "-File",
      fileURLToPath(new URL("../../../run-build-ui.ps1", import.meta.url)),
      "-RunConfig",
      f.runConfig,
      "-ExpectedPlan",
      expected,
      "-CheckPlan",
    ]);
    assert.equal(JSON.parse(ps.stdout).state, "matched");
  }
  const caps = JSON.parse((await exec(process.execPath, [cli, "--field-capabilities"])).stdout);
  assert.equal(caps.kind, "pink-build-field-capabilities");
  await writeFile(f.casesFile, (await readFile(f.casesFile, "utf8")) + "\n");
  await assert.rejects(exec(process.execPath, [cli, ...args]), (error: unknown) => {
    assert.match(String((error as { stderr: string }).stderr), /计划哈希不匹配/);
    return true;
  });
  delete config.expectedPlan;
  await writeFile(f.runConfig, JSON.stringify(config));
  await assert.rejects(
    exec(process.execPath, [cli, "--plan", "four-groups", "--run-config", f.runConfig]),
    (error: unknown) => {
      assert.match(String((error as { stderr: string }).stderr), /必须提供 expected-plan/);
      return true;
    },
  );
  assert.equal(resolve(f.root, "plan.json"), expected);
});
