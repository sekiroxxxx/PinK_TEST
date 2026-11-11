import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import {
  loadConfigurationSteps,
  validateConfigurationSteps,
} from "./configuration-steps-contract.js";
import { runConfigurationSteps } from "./configuration-steps.js";
import { ConfigurationOperations, type ConfigurationPort } from "./configuration-operations.js";
import { ExecutionContext } from "./configuration-context.js";
import { createStepBuildPort } from "./build-steps-runtime.js";
import { CaseForm } from "./case-form.js";
import { catalogToSteps } from "./catalog-to-steps.js";
import { valueHash } from "./plan-integrity.js";
import type { BuildStep, BuildStepsDocument } from "./build-steps-contract.js";
import type { CaseValues } from "./finalized-cases.js";
import type { Builder } from "./builder.js";
import type { Task } from "./common.js";
import type { FormView } from "./configuration-page.js";

function document(
  platform: string,
  fields: string[],
  steps: BuildStep[],
  build = false,
): BuildStepsDocument {
  return {
    kind: "pink-configuration-steps",
    schemaVersion: 2,
    cases: [
      {
        caseId: "actions",
        platform,
        steps: [
          { id: "open", op: "config.open" },
          { id: "original", op: "record", page: "open", fields },
          ...steps,
          ...(build
            ? [
                { id: "submit", op: "build.submit" as const, page: "open", snapshot: "final" },
                { id: "wait", op: "build.wait" as const, task: "submit" },
                {
                  id: "success",
                  op: "assert" as const,
                  check: "build-result" as const,
                  task: "submit",
                  result: "wait",
                  expected: { state: "success" as const },
                },
              ]
            : []),
        ],
        finally: [
          { id: "cleanup", op: "config.open" },
          { id: "restore", op: "restore", page: "cleanup", record: "original" },
          { id: "close", op: "config.close", page: "cleanup" },
        ],
      },
    ],
  };
}

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "pink-v2-actions-"));
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "package.json"), "{}");
  await writeFile(join(root, "assets/a.scene"), "{}");
  await writeFile(join(root, "assets/a.scene.meta"), '{"uuid":"scene-A"}');
  const agc = join(root, "services.json"),
    icon = join(root, "icon.png"),
    materials = join(root, "materials.json");
  await writeFile(agc, '{"client":{"package_name":"com.qa.fixture"}}');
  await writeFile(icon, "offline image input fixture");
  await writeFile(
    materials,
    JSON.stringify({
      schemaVersion: 1,
      bindings: { agc: { path: "services.json" }, icon: { path: "icon.png" }, game: { id: "200" } },
    }),
  );
  return {
    root,
    agc,
    icon,
    materials,
    load: async (doc: BuildStepsDocument) => {
      const file = join(root, "steps.json");
      await writeFile(file, JSON.stringify(doc));
      return loadConfigurationSteps(file, { project: root, materials });
    },
    dispose: async () => {
      assert.equal(dirname(root), tmpdir());
      await rm(root, { recursive: true });
    },
  };
}

/** Only controls, notifications and the click boundary are simulated. Capture, inputs, checks and recovery are production. */
async function observe(
  w: Awaited<ReturnType<typeof workspace>>,
  initial: CaseValues,
  options: {
    taskOptions?: CaseValues;
    mismatch?: "ui" | "queued" | "terminal";
    changeAgcOnName?: boolean;
    hideNativeOnBuiltin?: boolean;
  } = {},
) {
  const original: CaseValues = {
    name: "Original",
    buildPath: "project://build",
    outputName: "fixture",
    startScene: "scene-A",
    scenes: ["db://assets/a.scene"],
    debug: false,
    ...initial,
  };
  const values = structuredClone(original),
    events: string[] = [],
    tasks: Task[] = [];
  let opened = false,
    generation = 0,
    platform = "web-desktop",
    pending = false;
  const identity = { executable: "offline.exe", project: w.root, windowId: 1 };
  const session = new ExecutionContext(identity, async () => identity);
  const gameState = () => ({
    id: String(values["packages.openpaas.appid"]),
    ids: ["100", "200"],
    codeVersion: values["packages.openpaas.appid"] === "100" ? "one" : "two",
    games: [
      { id: "100", codeVersion: "one" },
      { id: "200", codeVersion: "two" },
    ],
  });
  const port: ConfigurationPort = {
    inspect: async (field) => {
      if (
        !(field in values) ||
        (options.hideNativeOnBuiltin &&
          ["nativeCodeBundleMode", "wasmCompressionMode"].includes(field) &&
          values["overwriteProjectSettings.includeModules.physics"] === "physics-builtin") ||
        (field === "wasmCompressionMode" && values.nativeCodeBundleMode === "asmjs") ||
        (field.endsWith(".compressZip") &&
          values[field.replace(/compressZip$/, "encrypted")] === false) ||
        (field.endsWith(".globalVariable") &&
          values[field.replace(/globalVariable$/, "globalAdapter")] === true) ||
        (field === "packages.google-play.customIconFile" &&
          values["packages.google-play.customIcon"] !== "custom") ||
        (pending && field.startsWith("overwriteProjectSettings."))
      )
        return null;
      return {
        kind: Array.isArray(values[field])
          ? "array"
          : typeof values[field] === "boolean"
            ? "boolean"
            : "string",
        value: structuredClone(values[field]),
        selector: "fixture",
        disabled: field.endsWith(".encrypted") && values.debug === true,
      };
    },
    read: async (field) => {
      const control = await port.inspect(field);
      assert.ok(control, `fixture field absent: ${field}`);
      return control;
    },
    set: async (field, value) => {
      assert.ok(opened);
      events.push(`set:${field}`);
      if (field.endsWith(".encrypted") && values.debug && values[field] !== value)
        throw new Error("fixture encryption is disabled");
      if (
        field === "mainBundleCompressionType" &&
        values[field] === "subpackage" &&
        !["none", "subpackage"].includes(String(value))
      )
        throw new Error("fixture requires leaving subpackage first");
      const changed = valueHash(value) !== valueHash(values[field]);
      values[field] = structuredClone(value);
      if (field === "nativeCodeBundleMode" && value === "asmjs") values.wasmCompressionMode = false;
      if (field === "engineModulesConfigKey") pending = true;
      if (field === "name" && value === "QA" && options.mismatch === "ui")
        values.server = "unexpected";
      if (field === "name" && options.changeAgcOnName)
        await writeFile(w.agc, '{"client":{"package_name":"com.qa.fixture"},"changed":true}');
      return changed;
    },
    restoreControl: async (field, value) => {
      events.push(`restore:${field}`);
      await port.set(field, value.value);
    },
    alerts: async () => [],
    primaryBuildEnabled: async () => true,
    reopen: async () => assert.fail("explicit lifecycle required"),
    cancelFileChoice: async () => assert.fail("unused"),
    ready: async () => {
      events.push("ready");
      pending = false;
    },
    expandSection: async (label) => {
      events.push(`expand:${label}`);
    },
    googleIcon: async (file) => {
      assert.equal(values["packages.google-play.customIcon"], "custom");
      events.push("icon");
      values["packages.google-play.customIconFile"] = file;
    },
    openpaasPage: async () => gameState(),
    selectOpenpaasGame: async (id) => {
      assert.ok(["100", "200"].includes(id));
      events.push(`game:${id}`);
      values["packages.openpaas.appid"] = id;
    },
    configurationPage: async () =>
      ({
        title: "openpaas小游戏",
        fields: [
          {
            key: "packages.openpaas.versionName",
            visible: true,
            label: "* 游戏版本名",
            controls: [
              {
                type: "input:text",
                disabled: false,
                value: values["packages.openpaas.versionName"],
              },
            ],
          },
        ],
      }) as FormView,
  };
  const builder = {
    caseDom: async () => ({ groups: [["build"]] }),
    bindHistoryPlatformTitle: () => {},
    installProbe: async () => {},
    baseline: async () => [],
    latestSnapshot: async () => ({ at: 1, tasks: [] }),
    readConfiguration: async () => ({
      name: String(values.name),
      buildPath: "build",
      outputName: "fixture",
      startScene: "a",
      startSceneId: "scene-A",
      selectedScenes: ["a"],
      debug: values.debug,
      fields: {},
    }),
  } as unknown as Builder;
  const runtime = await createStepBuildPort(
    builder,
    session,
    w.root,
    [],
    new AbortController().signal,
  );
  const build = {
    ...runtime.port,
    source: {
      tasks: () => tasks,
      assertHealthy: () => {},
      get: (id: string) => {
        const t = tasks.find((t) => t.id === id);
        return t && options.mismatch === "terminal"
          ? { ...t, caseOptions: { ...t.caseOptions, server: "wrong terminal" } }
          : t;
      },
    },
    click: async (_: ConfigurationOperations, verify: () => Promise<void>) => {
      await verify();
      events.push("click");
      opened = false;
      // External SDK task fixture follows the product contract, not capture.values or the compiled plan.
      const task: Task = {
        id: `task-${tasks.length + 1}`,
        platform,
        outputName: "fixture",
        createdAt: Date.now(),
        state: "success",
        progress: 1,
        caseOptions: {
          name: "Original",
          buildPath: "project://build",
          outputName: "fixture",
          startScene: "scene-A",
          scenes: [{ uuid: "scene-A" }],
          debug: false,
          ...options.taskOptions,
        },
      };
      if (options.mismatch === "queued") task.caseOptions!.server = "wrong queued";
      tasks.push(task);
      return task.createdAt!;
    },
    assertCard: async (task: Task) => {
      assert.equal(task.state, "success");
    },
  };
  return {
    values,
    original,
    events,
    tasks,
    dispose: runtime.stop,
    env: {
      session,
      build,
      evidenceKind: "offline-fixture" as const,
      openConfiguration: async (id: string) => {
        assert.equal(opened, false);
        opened = true;
        platform = id;
        const gen = ++generation;
        const bind = () =>
          session.bind(id, id, gen, async () => {
            assert.ok(opened && generation === gen);
            return { title: id, generation: gen };
          });
        return new ConfigurationOperations(bind(), port, async () => bind());
      },
      closeConfiguration: async () => {
        opened = false;
      },
    },
  };
}

test("retained observations feed UI, queued and terminal checks; missing controls remain unobserved and failures recover", async () => {
  const w = await workspace();
  try {
    const doc = document(
      "web-desktop",
      ["name", "server"],
      [
        {
          id: "retained",
          op: "retain",
          page: "open",
          fields: ["server", "binGroupConfig.threshold", "custom-common:includeInAll"],
        },
        { id: "name", op: "set", page: "open", field: "name", value: "QA" },
        { id: "unchanged", op: "assert", check: "retained", page: "open", retained: "retained" },
        {
          id: "final",
          op: "read",
          page: "open",
          fields: ["name"],
          scope: "build",
          retained: "retained",
        },
      ],
      true,
    );
    const loaded = await w.load(doc);
    for (const mismatch of [undefined, "ui", "queued", "terminal"] as const) {
      const f = await observe(
        w,
        { server: "https://example.com/qa", "custom-common:includeInAll": true },
        { mismatch, taskOptions: { name: "QA", server: "https://example.com/qa" } },
      );
      try {
        const result = await runConfigurationSteps(loaded, f.env);
        assert.equal(result.cases[0].outcome, mismatch ? "failed" : "passed");
        assert.equal(result.cases[0].restoration, "passed");
        assert.deepEqual(f.values, f.original);
        assert.equal(f.tasks.length, mismatch === "ui" ? 0 : 1);
        if (!mismatch) {
          const proof = result.cases[0].steps.find((s) => s.stepId === "unchanged")!.output;
          assert.deepEqual(proof, [
            { field: "server", state: "unchanged", taskCheck: "pending-task" },
            {
              field: "binGroupConfig.threshold",
              state: "not-observed-at-start",
              taskCheck: "not-observed",
            },
            { field: "custom-common:includeInAll", state: "unchanged", taskCheck: "ui-only" },
          ]);
        }
      } finally {
        await f.dispose();
      }
    }
  } finally {
    await w.dispose();
  }
});

test("ordered dynamic preparation, ready and hidden evidence reach the task and restore dependencies", async () => {
  const w = await workspace();
  try {
    const doc = document(
      "taobao-mini-game",
      [
        "engineModulesConfigKey",
        "overwriteProjectSettings.includeModules.physics",
        "nativeCodeBundleMode",
        "wasmCompressionMode",
        "mainBundleCompressionType",
      ],
      [
        {
          id: "preset",
          op: "set",
          page: "open",
          field: "engineModulesConfigKey",
          value: "defaultConfig",
        },
        { id: "ready", op: "config.ready", page: "open" },
        {
          id: "physics",
          op: "set",
          page: "open",
          field: "overwriteProjectSettings.includeModules.physics",
          value: "physics-ammo",
        },
        {
          id: "prepare-wasm",
          op: "config.prepare",
          page: "open",
          field: "nativeCodeBundleMode",
          value: "asmjs",
        },
        { id: "before-hide", op: "read", page: "open", fields: ["wasmCompressionMode"] },
        { id: "mode", op: "set", page: "open", field: "nativeCodeBundleMode", value: "asmjs" },
        {
          id: "hidden",
          op: "assert",
          check: "hidden",
          page: "open",
          field: "wasmCompressionMode",
          observed: "before-hide",
        },
        {
          id: "prepare-compress",
          op: "config.prepare",
          page: "open",
          field: "mainBundleCompressionType",
          value: "merge_all_json",
        },
        {
          id: "compress",
          op: "set",
          page: "open",
          field: "mainBundleCompressionType",
          value: "merge_all_json",
        },
        {
          id: "final",
          op: "read",
          page: "open",
          fields: [
            "engineModulesConfigKey",
            "overwriteProjectSettings.includeModules.physics",
            "nativeCodeBundleMode",
            "mainBundleCompressionType",
          ],
          scope: "build",
          hidden: ["hidden"],
        },
      ],
      true,
    );
    const f = await observe(
      w,
      {
        engineModulesConfigKey: "project-preset",
        "overwriteProjectSettings.includeModules.physics": "physics-builtin",
        nativeCodeBundleMode: "wasm",
        wasmCompressionMode: true,
        mainBundleCompressionType: "subpackage",
      },
      {
        taskOptions: {
          engineModulesConfigKey: "defaultConfig",
          "overwriteProjectSettings.includeModules.physics": "physics-ammo",
          nativeCodeBundleMode: "asmjs",
          wasmCompressionMode: false,
          mainBundleCompressionType: "merge_all_json",
        },
      },
    );
    try {
      const result = await runConfigurationSteps(await w.load(doc), f.env);
      assert.equal(result.outcome, "passed", JSON.stringify(result.cases[0].failure));
      assert.deepEqual(f.values, f.original);
      assert.ok(
        f.events.indexOf("restore:engineModulesConfigKey") <
          f.events.indexOf("restore:wasmCompressionMode"),
      );
      const stale = structuredClone(doc);
      stale.cases[0].steps.splice(7, 0, {
        id: "rewrite-child",
        op: "set",
        page: "open",
        field: "wasmCompressionMode",
        value: true,
      });
      assert.throws(() => validateConfigurationSteps(stale), /隐藏/);
    } finally {
      await f.dispose();
    }
    const exposed = document(
      "web-desktop",
      [
        "engineModulesConfigKey",
        "overwriteProjectSettings.includeModules.physics",
        "nativeCodeBundleMode",
        "wasmCompressionMode",
      ],
      [
        {
          id: "preset",
          op: "set",
          page: "open",
          field: "engineModulesConfigKey",
          value: "defaultConfig",
        },
        { id: "ready", op: "config.ready", page: "open" },
        {
          id: "physics",
          op: "set",
          page: "open",
          field: "overwriteProjectSettings.includeModules.physics",
          value: "physics-ammo",
        },
      ],
    );
    const transient = await observe(
      w,
      {
        engineModulesConfigKey: "project-preset",
        "overwriteProjectSettings.includeModules.physics": "physics-builtin",
        nativeCodeBundleMode: "wasm",
        wasmCompressionMode: true,
      },
      { hideNativeOnBuiltin: true },
    );
    try {
      const result = await runConfigurationSteps(await w.load(exposed), transient.env);
      assert.equal(result.outcome, "passed", JSON.stringify(result.cases[0]));
      assert.deepEqual(transient.values, transient.original);
      assert.ok(
        transient.events.indexOf("restore:wasmCompressionMode") <
          transient.events.indexOf("restore:engineModulesConfigKey"),
      );
    } finally {
      await transient.dispose();
    }
  } finally {
    await w.dispose();
  }
});

test("platform actions use existing game/file contracts and restore the original selection and exposed icon input", async () => {
  const w = await workspace();
  try {
    for (const platform of ["google-play", "openpaas"]) {
      const icon = platform === "google-play";
      const doc = document(
        platform,
        icon ? ["packages.google-play.customIcon"] : ["packages.openpaas.appid"],
        icon
          ? [
              {
                id: "icon",
                op: "input.google-icon",
                page: "open",
                file: { $material: "icon.path" },
              },
              {
                id: "final",
                op: "read",
                page: "open",
                fields: ["packages.google-play.customIcon"],
              },
              {
                id: "custom",
                op: "assert",
                check: "values",
                snapshot: "final",
                values: { "packages.google-play.customIcon": "custom" },
              },
            ]
          : [
              { id: "expand", op: "config.expand", page: "open", section: "network-timeout" },
              {
                id: "game",
                op: "input.openpaas-game",
                page: "open",
                value: { $material: "game.id" },
                requireChange: true,
              },
              { id: "game-ready", op: "assert", check: "openpaas-ready", page: "open" },
            ],
      );
      const f = await observe(
        w,
        icon
          ? {
              "packages.google-play.customIcon": "default",
              "packages.google-play.customIconFile": "previous.png",
            }
          : { "packages.openpaas.appid": "100", "packages.openpaas.versionName": "1.2.3" },
      );
      try {
        const result = await runConfigurationSteps(await w.load(doc), f.env);
        assert.equal(result.outcome, "passed", JSON.stringify(result.cases[0].failure));
        assert.equal(result.buildSubmitted, false);
        assert.deepEqual(f.values, f.original);
        assert.ok(f.events.includes(icon ? "icon" : "game:200"));
      } finally {
        await f.dispose();
      }
    }
    let selected = "200";
    const calls: string[] = [];
    const form = new CaseForm(
      {
        openpaasPage: async () => ({ id: selected, ids: ["100", "200"] }),
        selectOpenpaasGame: async (id: string) => {
          calls.push(id);
          selected = id;
        },
      } as unknown as Builder,
      "openpaas",
      new AbortController().signal,
    );
    await form.restoreControl("packages.openpaas.appid", {
      kind: "select",
      value: "100",
      disabled: false,
      selector: "",
    });
    assert.deepEqual(calls, ["100"]); // Real adapter uses the existing-game operation for recovery too.
    const invalidGame = document(
      "openpaas",
      ["packages.openpaas.appid"],
      [{ id: "game", op: "input.openpaas-game", page: "open", value: { $material: "game.id" } }],
    );
    await writeFile(
      w.materials,
      '{"schemaVersion":1,"bindings":{"game":{"id":"__create_game__"}}}',
    );
    const rejected = await observe(w, {
      "packages.openpaas.appid": "100",
      "packages.openpaas.versionName": "1.2.3",
    });
    try {
      const result = await runConfigurationSteps(await w.load(invalidGame), rejected.env);
      assert.equal(result.cases[0].outcome, "blocked");
      assert.ok(!rejected.events.some((event) => event.startsWith("game:")));
      assert.deepEqual(rejected.values, rejected.original);
    } finally {
      await rejected.dispose();
    }
    await writeFile(w.materials, '{"schemaVersion":1,"bindings":{"game":{"id":"200"}}}');
    const noOriginalGame = await observe(w, {
      "packages.openpaas.appid": "",
      "packages.openpaas.versionName": "1.2.3",
    });
    try {
      const result = await runConfigurationSteps(await w.load(invalidGame), noOriginalGame.env);
      assert.equal(result.cases[0].outcome, "blocked");
      assert.ok(!noOriginalGame.events.some((event) => event.startsWith("game:")));
      assert.deepEqual(noOriginalGame.values, noOriginalGame.original);
    } finally {
      await noOriginalGame.dispose();
    }
    const keepGame = structuredClone(invalidGame);
    keepGame.cases[0].steps = keepGame.cases[0].steps.filter((s) => s.op !== "record");
    keepGame.cases[0].finally = keepGame.cases[0].finally.filter((s) => s.op !== "restore");
    const retainedGame = await observe(w, {
      "packages.openpaas.appid": "",
      "packages.openpaas.versionName": "1.2.3",
    });
    try {
      const result = await runConfigurationSteps(await w.load(keepGame), retainedGame.env);
      assert.equal(result.outcome, "passed", JSON.stringify(result.cases[0].failure));
      assert.equal(result.cases[0].restoration, "not-required");
      assert.equal(retainedGame.values["packages.openpaas.appid"], "200");
      assert.deepEqual(
        retainedGame.events.filter((event) => event.startsWith("game:")),
        ["game:200"],
      );
    } finally {
      await retainedGame.dispose();
    }
  } finally {
    await w.dispose();
  }
});

test("encryption unlock and hidden Zip carry observed values while restoring Debug and hidden originals", async () => {
  const w = await workspace();
  try {
    const enc = "packages.android.encrypted",
      zip = "packages.android.compressZip";
    const doc = document(
      "android",
      ["debug", enc, zip],
      [
        { id: "unlock", op: "config.prepare", page: "open", field: enc, value: true },
        { id: "expose", op: "set", page: "open", field: enc, value: true },
        { id: "zip", op: "set", page: "open", field: zip, value: false },
        { id: "before-hide", op: "read", page: "open", fields: [zip] },
        { id: "hide", op: "set", page: "open", field: enc, value: false },
        { id: "debug", op: "set", page: "open", field: "debug", value: true },
        {
          id: "hidden",
          op: "assert",
          check: "hidden",
          page: "open",
          field: zip,
          observed: "before-hide",
        },
        {
          id: "final",
          op: "read",
          page: "open",
          fields: [enc, "debug"],
          scope: "build",
          hidden: ["hidden"],
        },
      ],
      true,
    );
    const f = await observe(
      w,
      { debug: true, [enc]: false, [zip]: true },
      { taskOptions: { debug: true, [enc]: false, [zip]: false } },
    );
    try {
      const result = await runConfigurationSteps(await w.load(doc), f.env);
      assert.equal(result.outcome, "passed", JSON.stringify(result.cases[0]));
      assert.deepEqual(f.values, f.original);
      const missingObservation = structuredClone(doc);
      const hidden = missingObservation.cases[0].steps.find(
        (s) => s.op === "assert" && s.check === "hidden",
      )!;
      assert.ok(hidden.op === "assert" && hidden.check === "hidden");
      delete hidden.observed;
      assert.throws(() => validateConfigurationSteps(missingObservation), /隐藏子项/);
    } finally {
      await f.dispose();
    }
  } finally {
    await w.dispose();
  }
});

test("AGC rejects package mismatch and changed service bytes before submission; both paths restore configuration", async () => {
  const w = await workspace();
  try {
    for (const drift of [false, true]) {
      await writeFile(w.agc, '{"client":{"package_name":"com.qa.fixture"}}');
      const doc = document(
        "huawei-agc",
        ["name", "packages.huawei-agc.serviceConfigPath", "packages.huawei-agc.packageName"],
        [
          {
            id: "file",
            op: "set",
            page: "open",
            field: "packages.huawei-agc.serviceConfigPath",
            value: { $material: "agc.path" },
          },
          {
            id: "package",
            op: "set",
            page: "open",
            field: "packages.huawei-agc.packageName",
            value: drift ? "com.qa.fixture" : "com.qa.wrong",
          },
          { id: "agc", op: "assert", check: "agc-material", page: "open" },
          { id: "name", op: "set", page: "open", field: "name", value: "QA" },
          {
            id: "final",
            op: "read",
            page: "open",
            fields: [
              "name",
              "packages.huawei-agc.serviceConfigPath",
              "packages.huawei-agc.packageName",
            ],
            scope: "build",
          },
        ],
        true,
      );
      const f = await observe(
        w,
        { "packages.huawei-agc.serviceConfigPath": "", "packages.huawei-agc.packageName": "old" },
        { changeAgcOnName: drift },
      );
      try {
        const result = await runConfigurationSteps(await w.load(doc), f.env);
        assert.equal(result.cases[0].outcome, drift ? "stopped" : "failed");
        assert.equal(f.tasks.length, 0);
        assert.equal(result.cases[0].restoration, "passed");
        assert.deepEqual(f.values, f.original);
      } finally {
        await f.dispose();
      }
      const missingGuard = structuredClone(doc);
      missingGuard.cases[0].steps = missingGuard.cases[0].steps.filter((s) => s.id !== "agc");
      assert.throws(() => validateConfigurationSteps(missingGuard), /AGC/);
    }
  } finally {
    await w.dispose();
  }
});

test("catalog uses retained, dynamic and platform operations without skipping remaining conditional prerequisites", async () => {
  const w = await workspace();
  try {
    const path = new URL(
      "../../case-catalog/public-combinations.json",
      import.meta.url,
    ).pathname.replace(/^\/(\w:)/, "$1");
    const plan = await catalogToSteps(path, { project: w.root, groups: "publish,debug,mixed" });
    const web = plan.cases.find((c) => c.caseId === "review.publish.web-desktop")!;
    assert.equal(web.status, "ready", JSON.stringify(web.gaps));
    const steps = web.document!.cases[0].steps;
    assert.ok(steps.some((s) => s.op === "retain"));
    assert.ok(steps.some((s) => s.op === "config.ready"));
    assert.ok(
      steps.some((s) => s.op === "read" && s.scope === "build" && s.retained === "retained"),
    );
    for (const c of plan.cases.filter((c) => c.group === "debug"))
      assert.ok(!c.gaps.some((g) => g.kind === "ui-adapter"), c.caseId + JSON.stringify(c.gaps));
    for (const c of plan.document!.cases) {
      assert.ok(!c.steps.some((s) => s.op === "record"), c.caseId);
      assert.ok(!c.finally.some((s) => s.op === "restore"), c.caseId);
    }
    const raw = JSON.parse(await readFile(path, "utf8"));
    // Keep source prerequisites: do not turn unrelated fourth-group assertions into basic builds.
    const conditional = await catalogToSteps(path, {
      project: w.root,
      groups: "conditional",
      cases: "conditional.l10n.gate",
    });
    assert.ok(conditional.cases.every((c) => c.status === "blocked" && !c.document));
    assert.equal(new Set(raw.platforms.map((p: { id: string }) => p.id)).size, 18);
  } finally {
    await w.dispose();
  }
});
