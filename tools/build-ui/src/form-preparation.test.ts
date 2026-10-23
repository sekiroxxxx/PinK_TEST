import { runObservedFormSample as runFormSample } from "./configuration-test-port.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CaseControl } from "./case-form.js";
import type { CaseValue } from "./finalized-cases.js";
import { selectFinalizedCases } from "./finalized-cases.js";
import { caseContract, type CatalogDocument } from "./case-contract.js";
import {
  loadFormValidation,
  FormSampleError,
  type FormSamplePort,
  type LoadedFormSample,
} from "./form-validation.js";

const catalog = JSON.parse(
  await readFile(new URL("../../case-catalog/public-combinations.json", import.meta.url), "utf8"),
) as CatalogDocument;
const forms = await loadFormValidation(catalog);
const sample = (id: string): LoadedFormSample => ({
  sampleId: id,
  sourceSha256: "offline-fixture",
  execution: structuredClone(
    forms.cases.flatMap((c) => c.samples).find((s) => s.id === id)!.execution!,
  ),
});
// Controlled observations exercise the actual controller and restoration, not PinK's validators.
function fixture(
  initial: Record<string, CaseValue>,
  hidden?: (field: string, values: Record<string, CaseValue>) => boolean,
) {
  const values = structuredClone(initial),
    writes: Array<[string, CaseValue]> = [];
  const current = (field: string): CaseControl | null =>
    hidden?.(field, values)
      ? null
      : {
          value: structuredClone(values[field]),
          kind: Array.isArray(values[field])
            ? "array"
            : (typeof values[field] as "boolean" | "string"),
          selector: "#fixture",
          disabled: false,
        };
  const port: FormSamplePort = {
    inspect: async (field) => current(field),
    read: async (field) => {
      const c = current(field);
      assert.ok(c);
      return c;
    },
    set: async (field, value) => {
      assert.ok(current(field));
      writes.push([field, value]);
      values[field] = structuredClone(value);
      return true;
    },
    restoreControl: async (field, original) => {
      assert.ok(current(field));
      values[field] = structuredClone(original.value);
    },
    alerts: async () => [],
    primaryBuildEnabled: async () => true,
    reopen: async () => {},
    cancelFileChoice: async () => assert.fail("not required"),
  };
  return { port, values, writes };
}

test("the eight explicit samples load with separate preparation targets and L10N stays blocked", async () => {
  const ids = [
    "FORM-C02.s01",
    "FORM-C02.s04",
    "FORM-C04.s03",
    "FORM-C06.s02",
    "FORM-C07.s01",
    "FORM-C07.s02",
    "FORM-C08.s01",
    "FORM-C08.s02",
  ];
  const cases = await selectFinalizedCases(ids.join(","), "conditional", {}, { catalog });
  assert.equal(cases.length, 8);
  assert.ok(
    cases.every(
      (c) =>
        c.platform === "web-desktop" &&
        c.finalized!.endpoint === "ui" &&
        !c.finalized!.blockers.length,
    ),
  );
  const remote = cases.find((c) => c.caseId.startsWith("FORM-C04.s03."))!.finalized!;
  assert.equal(remote.values.server, "");
  assert.equal(remote.formValidation!.execution.prepare![0].value, "https://example.com/pink-qa/");
  const l10n = await selectFinalizedCases("FORM-C09", "conditional", {}, { catalog });
  assert.ok(l10n.every((c) => c.finalized!.blockers.length > 0));
  const invalid = { ...structuredClone(catalog), formValidation: structuredClone(forms) };
  invalid.formValidation.cases[0].samples[0].execution!.prepare = [
    { field: "packages.android.packageName", value: "x" },
  ];
  assert.throws(() => caseContract.validate(invalid), /其他平台/);
});

test("explicit preparation tests a real transition and restores the value from before preparation", async () => {
  const f = fixture({ server: "" });
  const result = await runFormSample(f.port, sample("FORM-C04.s03"));
  assert.deepEqual(f.writes, [
    ["server", "https://example.com/pink-qa/"],
    ["server", ""],
  ]);
  assert.equal(f.values.server, "");
  assert.deepEqual(result.preparedFields, ["server"]);
  assert.equal(result.restoration, "passed");
});

test("prepared visibility checks preserve and restore the originally hidden child", async () => {
  const f = fixture(
    { md5Cache: false, "md5CacheOptions.handleTemplateMd5Link": true },
    (field, v) => field === "md5CacheOptions.handleTemplateMd5Link" && !v.md5Cache,
  );
  const result = await runFormSample(f.port, sample("FORM-C08.s01"));
  assert.equal(result.restoration, "passed");
  assert.deepEqual(f.values, { md5Cache: false, "md5CacheOptions.handleTemplateMd5Link": true });
  assert.ok(result.assertions.some((a) => a.phase === "hidden-child-preserved" && a.passed));
});

test("Zip restoration leaves the forced mode before restoring the remote flag", async () => {
  const f = fixture({ mainBundleCompressionType: "none", mainBundleIsRemote: false });
  const current = f.port.read,
    set = f.port.set;
  f.port.read = async (field) => ({
    ...(await current(field)),
    disabled: field === "mainBundleIsRemote" && f.values.mainBundleCompressionType === "zip",
  });
  f.port.inspect = async (field) => f.port.read(field);
  f.port.set = async (field, value) => {
    const changed = await set(field, value);
    if (field === "mainBundleCompressionType" && value === "zip")
      f.values.mainBundleIsRemote = true;
    return changed;
  };
  f.port.restoreControl = async (field, original) => {
    assert.equal(
      (await f.port.read(field)).disabled,
      false,
      "remote must be writable when restored",
    );
    f.values[field] = original.value;
  };
  const result = await runFormSample(f.port, sample("FORM-C07.s01"));
  assert.equal(result.restoration, "passed");
  assert.deepEqual(f.values, { mainBundleCompressionType: "none", mainBundleIsRemote: false });
});

test("clear-all uses the UI operation, checks the protected scene and restores the original set", async () => {
  const f = fixture({
    scenes: ["db://initial.scene", "db://second.scene", "db://bundle.scene"],
    startScene: "initial-uuid",
  });
  const current = f.port.read;
  let attempted = false;
  f.port.read = async (field) =>
    field === "scenes"
      ? {
          ...(await current(field)),
          choices: [
            {
              value: "db://initial.scene",
              selector: "#initial",
              checked: true,
              disabled: true,
              protectedReason: "initial-scene",
            },
            {
              value: "db://bundle.scene",
              selector: "#bundle",
              checked: true,
              disabled: true,
              protectedReason: "bundle",
            },
            {
              value: "db://second.scene",
              selector: "#second",
              checked: (f.values.scenes as string[]).includes("db://second.scene"),
              disabled: false,
            },
          ],
        }
      : current(field);
  f.port.inspect = async (field) => f.port.read(field);
  f.port.clearAllScenes = async () => {
    attempted = true;
    f.values.scenes = ["db://initial.scene", "db://bundle.scene"];
  };
  const result = await runFormSample(f.port, sample("FORM-C06.s02"));
  assert.ok(attempted);
  assert.equal(result.restoration, "passed");
  assert.deepEqual(f.values.scenes, [
    "db://initial.scene",
    "db://second.scene",
    "db://bundle.scene",
  ]);
});

test("CCONB follows the editable threshold baseline and restores the pre-preparation value", async () => {
  const f = fixture({ "binGroupConfig.enable": false, "binGroupConfig.threshold": 27 });
  const result = await runFormSample(f.port, sample("FORM-C08.s02"));
  assert.equal(result.restoration, "passed");
  assert.deepEqual(f.values, { "binGroupConfig.enable": false, "binGroupConfig.threshold": 27 });
  assert.ok(
    f.writes.some(([field, value]) => field === "binGroupConfig.threshold" && value === 32),
  );
});

test("a restored path with the wrong protocol fails recovery instead of allowing continuation", async () => {
  const f = fixture({ buildPath: "project://build", outputName: "qa" });
  let protocol: "project" | "file" = "project";
  const current = f.port.read;
  f.port.read = async (field) => ({
    ...(await current(field)),
    ...(field === "buildPath" ? { protocol } : {}),
  });
  f.port.inspect = async (field) => f.port.read(field);
  const set = f.port.set;
  f.port.set = async (field, value) => {
    protocol = "file";
    return set(field, value);
  };
  const restore = f.port.restoreControl;
  f.port.restoreControl = async (field, original) => restore(field, original);
  await assert.rejects(
    runFormSample(f.port, sample("FORM-C02.s04")),
    (error: unknown) =>
      error instanceof FormSampleError &&
      error.evidence.restoration === "failed" &&
      error.evidence.assertions.some((a) => a.phase === "restore-path-protocol" && !a.passed),
  );
});

test("platform eight samples load explicit temporary initial states without a build endpoint", async () => {
  const cases = await selectFinalizedCases(
    "FORM-M01,FORM-W01,FORM-T01",
    "conditional",
    {},
    { catalog },
  );
  assert.equal(cases.length, 8);
  assert.ok(cases.every((c) => c.finalized!.endpoint === "ui" && !c.finalized!.blockers.length));
  for (const c of cases) assert.ok(c.finalized!.formValidation!.execution.prepare?.length);
  const taobao = cases.find((c) => c.caseId.startsWith("FORM-T01.s01."))!.finalized!;
  assert.equal(taobao.values["packages.taobao-mini-game.globalVariable"], "");
  assert.equal(
    taobao.formValidation!.execution.prepare!.at(-1)!.value,
    "localStorage,CANNON,LZString,protobuf",
  );
});

test("platform Taobao preparation snapshots revealed text before editing and restores its original visibility", async () => {
  for (const adapter of [true, false])
    for (const id of ["FORM-T01.s01", "FORM-T01.s02"]) {
      const initial = {
        startSceneAssetBundle: true,
        "packages.taobao-mini-game.globalAdapter": adapter,
        "packages.taobao-mini-game.globalVariable": "UserOriginalGlobal",
      };
      const f = fixture(
        initial,
        (field, values) =>
          field === "packages.taobao-mini-game.globalVariable" &&
          values["packages.taobao-mini-game.globalAdapter"] === true,
      );
      const result = await runFormSample(f.port, sample(id));
      assert.equal(result.restoration, "passed");
      assert.deepEqual(f.values, initial);
      assert.ok(
        f.writes.some(
          ([field, value]) =>
            field === "packages.taobao-mini-game.globalVariable" &&
            value === "localStorage,CANNON,LZString,protobuf",
        ),
      );
      if (id.endsWith("s02"))
        assert.ok(result.assertions.some((a) => a.phase === "hidden-child-preserved" && a.passed));
    }
});

test("an unprepared hidden target stays blocked without reading or editing its hidden child", async () => {
  const initial = {
    "packages.taobao-mini-game.globalAdapter": true,
    "packages.taobao-mini-game.globalVariable": "UserOriginalGlobal",
  };
  const f = fixture(initial, (field) => field.endsWith(".globalVariable"));
  const unprepared = sample("FORM-T01.s02");
  delete unprepared.execution.prepare;
  delete unprepared.execution.after;
  await assert.rejects(
    runFormSample(f.port, unprepared),
    (error: unknown) =>
      error instanceof FormSampleError &&
      error.prerequisite &&
      error.message.includes("初态已等于异常目标") &&
      error.evidence.restoration === "passed",
  );
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.values, initial);
});

test("native signature and AGC eighteen UI samples resolve existing material references", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pink-native-inputs-"));
  try {
    const signing = join(dir, "offline.keystore"),
      services = join(dir, "services.json");
    await writeFile(signing, "offline material-resolution fixture; not a valid keystore");
    await writeFile(services, '{"client":{"package_name":"com.testcases.cocos"}}');
    const materials = {
      bindings: {
        androidSigning: {
          path: signing,
          password: "offline-private-value",
          alias: "offline",
          aliasPassword: "offline-private-value",
        },
        agcServices: { path: services },
      },
    };
    const cases = await selectFinalizedCases(
      "FORM-N01,FORM-A01.s01,FORM-A01.s02,FORM-A02",
      "conditional",
      materials,
      { catalog },
    );
    assert.equal(cases.length, 18);
    assert.ok(cases.every((c) => c.finalized!.endpoint === "ui" && !c.finalized!.blockers.length));
    const signature = cases.find((c) => c.caseId === "FORM-N01.s02.android")!.finalized!;
    assert.equal(signature.values["packages.android.keystorePassword"], "");
    assert.equal(
      signature.formValidation!.execution.prepare!.find((s) =>
        s.field.endsWith(".keystorePassword"),
      )!.value,
      "offline-private-value",
    );
    const missing = await selectFinalizedCases(
      "FORM-N01.s02.android",
      "conditional",
      {},
      { catalog },
    );
    assert.ok(missing[0].finalized!.blockers.some((b) => b.kind === "material"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("native signature preparation restores debug mode and original children after its clearing effect", async () => {
  const e = sample("FORM-N01.s05");
  const prefix = "packages.android.",
    children = ["keystorePath", "keystorePassword", "keystoreAlias", "keystoreAliasPassword"].map(
      (k) => prefix + k,
    );
  for (const step of e.execution.prepare!)
    if (typeof step.value === "object") step.value = "offline-private-value";
  const initial = {
    [e.execution.field]: true,
    ...Object.fromEntries(children.map((k) => [k, ""])),
  };
  const f = fixture(initial),
    current = f.port.read,
    set = f.port.set;
  f.port.read = async (field) => ({
    ...(await current(field)),
    disabled: children.includes(field) && f.values[e.execution.field] === true,
  });
  f.port.inspect = async (field) => f.port.read(field);
  f.port.set = async (field, value) => {
    assert.equal((await f.port.read(field)).disabled, false);
    const changed = await set(field, value);
    if (field === e.execution.field && value === true)
      for (const child of children) f.values[child] = "";
    return changed;
  };
  f.port.restoreControl = async (field, original) => {
    await f.port.set(field, original.value);
  };
  const result = await runFormSample(f.port, e);
  assert.equal(result.restoration, "passed");
  assert.deepEqual(f.values, initial);
  assert.ok(result.assertions.some((a) => a.phase === "linked-disabled" && a.passed));
});

test("AGC preparation compares cancellation against prepared identity and restores the original required error", async () => {
  for (const id of ["FORM-A01.s01", "FORM-A01.s02"]) {
    const e = sample(id),
      path = e.execution.field,
      packageName = "packages.huawei-agc.packageName";
    e.execution.prepare!.find((s) => s.field === path)!.value = "offline-services.json";
    const initial = { [path]: "", [packageName]: "com.user.original" },
      f = fixture(initial);
    f.port.alerts = async (field) =>
      field === path && f.values[path] === "" ? ["此项为必填项"] : [];
    f.port.cancelFileChoice = async () => {
      assert.equal(f.values[path], "offline-services.json");
      assert.equal(f.values[packageName], "com.testcases.cocos");
    };
    const result = await runFormSample(f.port, e);
    assert.equal(result.restoration, "passed");
    assert.deepEqual(f.values, initial);
    assert.deepEqual(await f.port.alerts(path), ["此项为必填项"]);
  }
});

test("AGC nonempty invalid initial path stays protected despite explicit preparation", async () => {
  const e = sample("FORM-A01.s02"),
    path = e.execution.field;
  e.execution.prepare![0].value = "offline-services.json";
  const initial = {
      [path]: "user-invalid-path",
      "packages.huawei-agc.packageName": "com.user.original",
    },
    f = fixture(initial);
  f.port.alerts = async (field) => (field === path ? ["existing error"] : []);
  await assert.rejects(
    runFormSample(f.port, e),
    (error: unknown) =>
      error instanceof FormSampleError &&
      error.prerequisite &&
      error.evidence.restoration === "passed",
  );
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.values, initial);
});

test("quick-game samples resolve 36 explicit string preparations without PEM or L10N", async () => {
  const cases = await selectFinalizedCases("FORM-Q01", "conditional", {}, { catalog });
  assert.equal(cases.length, 36);
  for (const platform of [
    "oppo-mini-game",
    "vivo-mini-game",
    "honor-mini-game",
    "huawei-quick-game",
  ])
    assert.equal(cases.filter((c) => c.platform === platform).length, 9);
  for (const c of cases) {
    assert.equal(c.finalized!.endpoint, "ui");
    assert.deepEqual(c.finalized!.blockers, []);
    const e = c.finalized!.formValidation!.execution;
    assert.equal(e.prepare!.length, 1);
    assert.equal(e.prepare![0].field, e.field);
    assert.equal(typeof e.prepare![0].value, "string");
    assert.notEqual(e.prepare![0].value, e.value);
    assert.ok(e.field.startsWith("packages." + c.platform + "."));
  }
});

test("quick-game empty package restores the original empty value and original required prompt", async () => {
  const f = fixture({ "packages.vivo-mini-game.package": "" });
  f.port.alerts = async (key) => (f.values[key] === "" ? ["不能为空"] : []);
  const result = await runFormSample(f.port, sample("FORM-Q01.s02"));
  assert.equal(result.restoration, "passed");
  assert.equal(result.submitted, false);
  assert.deepEqual(f.writes, [
    ["packages.vivo-mini-game.package", "com.pink.qa.quickgame"],
    ["packages.vivo-mini-game.package", ""],
  ]);
  assert.equal(f.values["packages.vivo-mini-game.package"], "");
  assert.deepEqual(await f.port.alerts("packages.vivo-mini-game.package"), ["不能为空"]);
});
