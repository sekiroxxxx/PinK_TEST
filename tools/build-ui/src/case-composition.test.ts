import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  composeNativeCases,
  createCaseComposition,
  mapCompositionResults,
  describeCaseComposition,
  validateCaseComposition,
  type CaseComposition,
  type CompositionNode,
  type CompositionAction,
} from "./case-composition.js";
import {
  validateConfigurationSteps,
  configurationStepsPlan,
  loadConfigurationSteps,
} from "./configuration-steps-contract.js";
import {
  runConfigurationSteps,
  type ConfigurationStepsEnvironment,
} from "./configuration-steps.js";
import { ExecutionContext } from "./configuration-context.js";
import { ConfigurationOperations, type ConfigurationPort } from "./configuration-operations.js";
import { valueHash } from "./plan-integrity.js";
import type { CatalogDocument } from "./case-contract.js";
import type { BuilderHomeObservation } from "./builder-checks.js";
import { buildRunProgress } from "./run-progress.js";
import { configurationStepsLaunchPlan } from "./configuration-steps-startup.js";

const sample = async () =>
  JSON.parse(
    await readFile(new URL("../fixtures/case-composition/reuse.json", import.meta.url), "utf8"),
  ) as CaseComposition;
const flow = (d: CaseComposition) => {
  const fragment = d.fragments[0];
  assert.equal(fragment.kind, "nodes");
  const flow = fragment.nodes[0];
  assert.equal(flow.kind, "flow");
  return flow;
};
const loaded = (
  document: NonNullable<Awaited<ReturnType<typeof composeNativeCases>>["document"]>,
) => ({
  path: "offline",
  sourceSha256: valueHash(document),
  documentSha256: valueHash(document),
  document,
});

test("a page-free platform probe saves, assembles and runs without inventing configuration cleanup", async () => {
  const definition: CaseComposition = {
    kind: "pink-case-composition",
    schemaVersion: 1,
    sources: [],
    fragments: [],
    targets: [
      {
        id: "qa-absent",
        label: "QA absent platform",
        configurationTitle: "QA absent config",
        category: "X-Device",
        fields: {},
        homeScope: { readyLabels: ["Web 桌面端"] },
      },
    ],
    nodes: [
      {
        id: "absence",
        kind: "flow",
        target: { kind: "platform", id: "qa-absent" },
        steps: [
          {
            id: "probe",
            kind: "action",
            moduleId: "pink-build",
            operationId: "platform.probe",
            inputs: {},
          },
          {
            id: "expected",
            kind: "action",
            moduleId: "pink-build",
            operationId: "assert",
            inputs: {
              check: "probe",
              observation: { $output: "probe" },
              expected: { presence: "absent" },
            },
          },
        ],
        finally: [],
      },
    ],
  };
  assert.equal((await validateCaseComposition(definition)).valid, true);
  const assembly = await composeNativeCases(definition);
  assert.deepEqual(assembly.diagnostics, []);
  assert.ok(assembly.document);
  assert.deepEqual(assembly.document.cases[0].finally, []);
  assert.equal(configurationStepsPlan(loaded(assembly.document)).execution.willSubmit, false);
  for (const complete of [true, false]) {
    const identity = { executable: "offline", project: "offline", windowId: 1 };
    const result = await runConfigurationSteps(loaded(assembly.document), {
      session: new ExecutionContext(identity, async () => identity),
      evidenceKind: "offline-fixture",
      openConfiguration: async () => assert.fail("an absent platform must never be opened"),
      probePlatform: async () => ({
        scopeReady: true,
        scopeComplete: complete,
        matchCount: 0,
        presence: complete ? "absent" : "undetermined",
        visible: null,
        readable: false,
        writable: false,
      }),
    });
    assert.equal(result.cases[0].outcome, complete ? "passed" : "blocked");
    assert.ok("buildAttempted" in result);
    assert.equal(result.buildAttempted, false);
  }
  const pageFlow = structuredClone(assembly.document);
  pageFlow.cases[0].steps.unshift({ id: "open", op: "config.open" });
  assert.throws(() => validateConfigurationSteps(pageFlow), /finally/);
});
function externalControls(homeFailure = false) {
  const identity = { executable: "offline.exe", project: "offline-project", windowId: 1 };
  const session = new ExecutionContext(identity, async () => identity);
  const values = new Map<string, string>(),
    events: string[] = [];
  let generation = 0;
  const home: BuilderHomeObservation = {
    representativePlatform: "web-desktop",
    entryKey: "fixture-builder-native",
    ready: true,
    view: "home",
    buttons: {
      history: { visible: true, disabled: false, matchCount: 1 },
      "build-all": { visible: true, disabled: false, matchCount: 1 },
    },
  };
  const env: ConfigurationStepsEnvironment = {
    session,
    evidenceKind: "offline-fixture",
    openConfiguration: async (platform) => {
      events.push(`open:${platform}`);
      if (!values.has(platform)) values.set(platform, `Original ${platform}`);
      const read = async () => ({
        kind: "string" as const,
        value: values.get(platform)!,
        disabled: false,
        selector: "fixture-control",
      });
      const port: ConfigurationPort = {
        inspect: read,
        read,
        set: async (field, value) => {
          assert.equal(field, "name");
          const changed = values.get(platform) !== value;
          values.set(platform, String(value));
          events.push(`write:${platform}:${value}`);
          return changed;
        },
        restoreControl: async (_field, control) => {
          values.set(platform, String(control.value));
          events.push(`restore:${platform}`);
        },
        alerts: async () => [],
        primaryBuildEnabled: async () => true,
        ready: async () => {},
        reopen: async () => assert.fail("not requested"),
        cancelFileChoice: async () => assert.fail("no file input in this fixture"),
      };
      const index = ++generation;
      const bind = () =>
        session.bind(platform, "Fixture configuration", index, async () => ({
          title: "Fixture configuration",
          generation: index,
        }));
      return new ConfigurationOperations(bind(), port, async () => bind());
    },
    closeConfiguration: async (op) => {
      events.push(`close:${op.platform}`);
      op.context.invalidate();
    },
    builderUi: {
      open: async (target) => {
        assert.equal(target.kind, "builder");
        events.push("builder:open");
      },
      read: async () => structuredClone(home),
      home: async () => {
        events.push("builder:home");
        if (homeFailure) throw new Error("fixture navigation failed");
      },
    },
  };
  return { env, events, values };
}

test("public targets migrate legacy categories without modifying input and reject ambiguous declarations", async () => {
  const reuse = await sample();
  const home = reuse.nodes.at(-1)!;
  assert.equal(home.kind, "flow");
  const definition: CaseComposition = { ...reuse, sources: [], fragments: [], nodes: [home] };
  for (const [category, platform] of [
    ["X-Device", "web-desktop"],
    ["X-Application", "wechatgame"],
  ]) {
    const node = definition.nodes[0] as Extract<CompositionNode, { kind: "flow" }>;
    node.target = { kind: "builder", category };
    const original = structuredClone(definition);
    const assembly = await composeNativeCases(definition);
    assert.deepEqual(assembly.diagnostics, []);
    assert.deepEqual(assembly.document!.cases[0].target, {
      kind: "builder",
      representativePlatform: platform,
    });
    assert.deepEqual(definition, original);
    const raw = structuredClone(assembly.document!);
    (raw.cases[0] as unknown as Record<string, unknown>).target = node.target;
    const rawOriginal = structuredClone(raw);
    const normalized = validateConfigurationSteps(raw);
    assert.ok(normalized.schemaVersion === 2);
    assert.deepEqual(normalized.cases[0].target, {
      kind: "builder",
      representativePlatform: platform,
    });
    assert.deepEqual(raw, rawOriginal);
  }
  for (const target of [
    { kind: "builder", category: "终端" },
    { kind: "builder", representativePlatform: "web-desktop", category: "X-Device" },
    { kind: "builder", representativePlatform: "not-declared" },
  ]) {
    (definition.nodes[0] as unknown as Record<string, unknown>).target = target;
    const invalid = await composeNativeCases(definition);
    assert.equal(invalid.document, undefined);
    assert.ok(invalid.diagnostics.length);
  }
  definition.targets = [
    { id: "qa-public", label: "QA 平台", configurationTitle: "QA 配置", fields: {} },
  ];
  (definition.nodes[0] as Extract<CompositionNode, { kind: "flow" }>).target = {
    kind: "builder",
    representativePlatform: "qa-public",
  };
  const custom = await composeNativeCases(definition);
  assert.deepEqual(custom.diagnostics, []);
  assert.deepEqual(custom.document!.cases[0].target, {
    kind: "builder",
    representativePlatform: "qa-public",
  });
});

test("representative platform parameters drive public operations and wrong observations stop without opening configuration", async () => {
  const reuse = await sample();
  const home = structuredClone(reuse.nodes.at(-1)!) as Extract<CompositionNode, { kind: "flow" }>;
  home.target = { kind: "builder", representativePlatform: { $param: "representative" } };
  const definition: CaseComposition = {
    kind: "pink-case-composition",
    schemaVersion: 1,
    sources: [],
    fragments: [
      {
        id: "public",
        kind: "nodes",
        parameters: { representative: { kind: "string" } },
        nodes: [home],
      },
    ],
    nodes: [
      {
        id: "check",
        kind: "use",
        fragmentId: "public",
        arguments: { representative: "web-desktop" },
      },
    ],
  };
  const assembly = await composeNativeCases(definition);
  assert.deepEqual(assembly.diagnostics, []);
  const fixture = externalControls();
  const result = await runConfigurationSteps(loaded(assembly.document!), fixture.env);
  assert.equal(result.outcome, "passed");
  assert.deepEqual(fixture.events, ["builder:open", "builder:home"]);
  const chosen = definition.nodes[0] as Extract<CompositionNode, { kind: "use" }>;
  chosen.arguments = { representative: "wechatgame" };
  const changed = await composeNativeCases(definition);
  assert.deepEqual(changed.diagnostics, []);
  assert.deepEqual(changed.document!.cases[0].target, {
    kind: "builder",
    representativePlatform: "wechatgame",
  });
  const wrongPage = externalControls();
  const stopped = await runConfigurationSteps(loaded(changed.document!), wrongPage.env);
  assert.equal(stopped.cases[0].outcome, "stopped");
  assert.equal(stopped.cases[0].failure!.code, "context");
  assert.equal(stopped.cases[0].stopFollowingCases, true);
  assert.ok(wrongPage.events.every((event) => event.startsWith("builder:")));
});

test("two references bind different values and outputs, execute real operations, restore and map evidence", async () => {
  const definition = await sample(),
    original = structuredClone(definition);
  const assembled = await composeNativeCases(definition);
  assert.deepEqual(assembled.diagnostics, []);
  assert.ok(assembled.document);
  assert.equal(assembled.document.cases.length, 3);
  assert.equal(assembled.willSubmit, false);
  assert.equal(assembled.document.cases[2].platform, undefined);
  assert.deepEqual(assembled.document.cases[2].target, {
    kind: "builder",
    representativePlatform: "web-desktop",
  });
  const allIds = assembled.sourceMap.flatMap((c) => [c.caseId, ...c.steps.map((s) => s.stepId)]);
  assert.equal(new Set(allIds).size, allIds.length);
  const fixture = externalControls();
  const result = await runConfigurationSteps(loaded(assembled.document), fixture.env);
  assert.equal(result.outcome, "passed");
  assert.ok("buildAttempted" in result);
  assert.ok("groups" in result);
  assert.equal(result.buildAttempted, false);
  assert.deepEqual(
    [...fixture.values],
    [
      ["web-desktop", "Original web-desktop"],
      ["web-mobile", "Original web-mobile"],
    ],
  );
  assert.ok(fixture.events.includes("write:web-desktop:qa_desktop_composition"));
  assert.ok(fixture.events.includes("write:web-mobile:qa_mobile_composition"));
  assert.ok(fixture.events.indexOf("builder:open") > fixture.events.indexOf("restore:web-mobile"));
  assert.deepEqual(
    result.groups.map((g) => g.caseIds.length),
    [2, 1],
  );
  const mapped = mapCompositionResults(assembled, {
    ...result,
    documentSha256: assembled.documentSha256,
  });
  assert.deepEqual(
    mapped.map((c) => c.source.instancePath),
    [["desktop", "check"], ["mobile", "check"], ["common-home"]],
  );
  assert.ok(
    mapped[0].steps.some(
      (s) =>
        "nodeId" in s.source && s.source.nodeId === "expected" && s.result.outcome === "passed",
    ),
  );
  assert.deepEqual(definition, original);
});

test("per-run selection orders instances, retains before/finally and excludes unselected actions", async () => {
  const definition = await sample();
  const selection = {
    items: [
      { path: ["common-home"] },
      {
        path: ["mobile", "check"],
        arguments: { name: "Local override", expectedName: "Local override" },
      },
    ],
  };
  const result = await composeNativeCases(definition, selection);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.document!.cases.map((c) => c.platform ?? c.target!.kind),
    ["builder", "web-mobile"],
  );
  const mobile = result.document!.cases[1];
  assert.ok(mobile.steps.some((s) => s.op === "set" && s.value === "Local override"));
  assert.ok(mobile.steps.some((s) => s.op === "record"));
  assert.ok(mobile.finally.some((s) => s.op === "restore"));
  assert.equal(
    result.document!.cases.some((c) => c.platform === "web-desktop"),
    false,
  );
  const run = await runConfigurationSteps(loaded(result.document!), externalControls().env);
  assert.equal(run.outcome, "passed");
  assert.ok("groups" in run);
  assert.deepEqual(
    run.groups.map((g) => g.caseIds.length),
    [1, 1],
  );
  const invalid = await composeNativeCases(definition, {
    items: [{ path: ["desktop", "check"], steps: ["expected"] }],
  });
  assert.equal(invalid.document, undefined);
  assert.equal(invalid.diagnostics[0].code, "dependency");
  assert.equal(invalid.diagnostics[0].nodeId, "expected");
});

test("inline action fragments bind caller outputs without sharing two local snapshots", async () => {
  const definition = await sample(),
    body = flow(definition);
  definition.fragments.push({
    id: "write-check",
    kind: "actions",
    parameters: {
      page: { kind: "output" },
      value: { kind: "string" },
      expected: { kind: "string" },
    },
    steps: structuredClone(body.steps),
  });
  const fragment = definition.fragments[1];
  assert.equal(fragment.kind, "actions");
  for (const action of fragment.steps as CompositionAction[]) {
    if (action.inputs.page) action.inputs.page = { $param: "page" };
    if (action.operationId === "set") action.inputs.value = { $param: "value" };
    if (action.operationId === "assert") action.inputs.values = { name: { $param: "expected" } };
  }
  body.steps = ["first", "second"].map((id) => ({
    id,
    kind: "use",
    fragmentId: "write-check",
    arguments: { page: { $output: "open" }, value: id, expected: id },
  }));
  const result = await composeNativeCases(definition, { items: [{ path: ["desktop"] }] });
  assert.deepEqual(result.diagnostics, []);
  const run = await runConfigurationSteps(loaded(result.document!), externalControls().env);
  assert.equal(run.outcome, "passed");
  assert.equal(result.sourceMap[0].steps.filter((s) => s.nodeId === "read").length, 2);
  assert.notEqual(
    result.sourceMap[0].steps.find((s) => s.instancePath.includes("first") && s.nodeId === "read")!
      .stepId,
    result.sourceMap[0].steps.find((s) => s.instancePath.includes("second") && s.nodeId === "read")!
      .stepId,
  );
});

test("changed structured expectation fails, restores and continues the next reference", async () => {
  const definition = await sample();
  const first = definition.nodes[0];
  assert.equal(first.kind, "use");
  first.arguments!.expectedName = "Deliberate mismatch";
  const assembly = await composeNativeCases(definition);
  assert.deepEqual(assembly.diagnostics, []);
  const fixture = externalControls();
  const result = await runConfigurationSteps(loaded(assembly.document!), fixture.env);
  assert.deepEqual(
    result.cases.map((c) => c.outcome),
    ["failed", "passed", "passed"],
  );
  assert.equal(result.cases[0].restoration, "passed");
  assert.equal(fixture.values.get("web-desktop"), "Original web-desktop");
  assert.equal(result.stopped, false);
  const blockedCleanup = await composeNativeCases(await sample(), {
    items: [{ path: ["common-home"] }, { path: ["desktop"] }],
  });
  const stopped = await runConfigurationSteps(
    loaded(blockedCleanup.document!),
    externalControls(true).env,
  );
  assert.deepEqual(
    stopped.cases.map((c) => c.outcome),
    ["stopped", "skipped"],
  );
  assert.equal(stopped.cases[0].stopFollowingCases, true);
});

test("nested action fragments retain inner and outer cleanup before the flow recovery", async () => {
  const definition = await sample(),
    body = flow(definition);
  const cleanup = (id: string): CompositionAction[] => [
    {
      id: `${id}-open`,
      kind: "action",
      moduleId: "pink-build",
      operationId: "config.open",
      inputs: {},
    },
    {
      id: `${id}-close`,
      kind: "action",
      moduleId: "pink-build",
      operationId: "config.close",
      inputs: { page: { $output: `${id}-open` } },
    },
  ];
  definition.fragments.push({
    id: "inner",
    kind: "actions",
    parameters: { page: { kind: "output" } },
    steps: [
      {
        id: "set-inner",
        kind: "action",
        moduleId: "pink-build",
        operationId: "set",
        inputs: { page: { $param: "page" }, field: "name", value: "Nested value" },
      },
    ],
    finally: cleanup("inner"),
  });
  definition.fragments.push({
    id: "outer",
    kind: "actions",
    parameters: { page: { kind: "output" } },
    steps: [
      {
        id: "inner-use",
        kind: "use",
        fragmentId: "inner",
        arguments: { page: { $param: "page" } },
      },
    ],
    finally: cleanup("outer"),
  });
  body.steps = [
    { id: "outer-use", kind: "use", fragmentId: "outer", arguments: { page: { $output: "open" } } },
  ];
  const assembly = await composeNativeCases(definition, { items: [{ path: ["desktop"] }] });
  assert.deepEqual(assembly.diagnostics, []);
  assert.deepEqual(
    assembly.sourceMap[0].steps.filter((s) => s.phase === "finally").map((s) => s.nodeId),
    ["inner-open", "inner-close", "outer-open", "outer-close", "cleanup", "restore", "close"],
  );
  const fixture = externalControls();
  const result = await runConfigurationSteps(loaded(assembly.document!), fixture.env);
  assert.equal(result.outcome, "passed");
  assert.equal(fixture.values.get("web-desktop"), "Original web-desktop");
});

test("two platform Catalog combinations plus one public check compile in selected order without source edits", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "pink-composition-"));
  t.after(async () => {
    assert.equal(dirname(project), tmpdir());
    await rm(project, { recursive: true });
  });
  await mkdir(join(project, "assets"));
  await writeFile(join(project, "package.json"), "{}");
  const catalog = JSON.parse(
    await readFile(new URL("../../case-catalog/public-combinations.json", import.meta.url), "utf8"),
  ) as CatalogDocument;
  catalog.platforms = catalog.platforms.filter((p) => ["web-desktop", "web-mobile"].includes(p.id));
  catalog.conditionalScenarios = [];
  for (const platform of catalog.platforms)
    for (const c of platform.combinations) {
      c.values = { name: "Original case setting" };
      c.variants = [];
      c.fieldCoverage = {};
      c.configurationOrder = [];
      c.excludedFields = Object.keys(catalog.templates.find((t) => t.id === c.template)!.values);
    }
  const original = structuredClone(catalog),
    definition = createCaseComposition(catalog);
  definition.nodes.push((await sample()).nodes[2]);
  const find = (caseId: string) =>
    definition.nodes.find((n) => n.kind === "case-ref" && n.caseId === caseId)!;
  const selection = {
    items: [
      {
        path: [find("review.debug.web-mobile").id],
        values: { name: "Changed mobile" },
        expectedValues: { name: "Changed mobile" },
      },
      { path: ["common-home"] },
      { path: [find("review.publish.web-desktop").id] },
    ],
  };
  const result = await composeNativeCases(definition, selection, { project });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.document!.cases.map((c) => c.platform ?? c.target!.kind),
    ["web-mobile", "builder", "web-desktop"],
  );
  assert.equal(result.willSubmit, true);
  assert.equal(
    result.document!.cases.flatMap((c) => c.steps).filter((s) => s.op === "build.submit").length,
    2,
  );
  assert.equal(
    result.document!.cases[0].steps.some((s) => s.op === "set" && s.value === "Changed mobile"),
    true,
  );
  for (const c of result.document!.cases.filter((c) => c.platform)) {
    assert.ok(c.steps.some((s) => s.op === "build.wait"));
    assert.ok(c.steps.some((s) => s.op === "assert" && s.check === "build-result"));
  }
  assert.deepEqual(catalog, original);
  const file = join(project, "assembled.json");
  await writeFile(file, JSON.stringify(result.document));
  const loadedFile = await loadConfigurationSteps(file, { project });
  assert.equal(configurationStepsPlan(loadedFile).execution.willSubmit, true);
  await mkdir(join(project, "resources/app"), { recursive: true });
  await writeFile(join(project, "PinK.exe"), "offline fixture; never launched");
  await writeFile(join(project, "resources/app/product.json"), '{"pinkVersion":"offline-fixture"}');
  const plan = await configurationStepsLaunchPlan(loadedFile, {
    pink: project,
    project,
    port: 9222,
    configurationTimeoutMs: 1000,
    resultsRoot: join(project, "results"),
  });
  assert.equal(plan.steps.cases[1].platform, undefined);
  assert.equal("target" in plan.steps.cases[1] && plan.steps.cases[1].target?.kind, "builder");
  const progress = buildRunProgress(
    loadedFile,
    { runId: project, lifecycle: "running", phase: "preflight", outcome: "incomplete", cases: [] },
    1,
  );
  assert.equal(progress.cases[1].platform, undefined);
  assert.equal(progress.cases[1].target?.kind, "builder");
  assert.equal(progress.cases[1].target?.representativePlatform, "web-desktop");
});

test("invalid references, unsupported actions and missing cleanup return located errors and no partial document", async () => {
  const cycle = await sample();
  cycle.fragments.push({
    id: "cycle",
    kind: "nodes",
    nodes: [{ id: "self", kind: "use", fragmentId: "cycle" }],
  });
  cycle.nodes.push({ id: "cycle-instance", kind: "use", fragmentId: "cycle" });
  const badCycle = await composeNativeCases(cycle);
  assert.equal(badCycle.diagnostics[0].code, "reference-cycle");
  assert.deepEqual(badCycle.diagnostics[0].instancePath, ["cycle-instance", "self"]);
  assert.equal(badCycle.document, undefined);
  const missing = await sample();
  (missing.nodes[0] as Extract<CompositionNode, { kind: "use" }>).fragmentId = "not-there";
  assert.equal((await composeNativeCases(missing)).diagnostics[0].code, "fragment-missing");
  const badAction = await sample();
  (flow(badAction).steps[0] as CompositionAction).operationId = "unknown.action" as never;
  const unsupported = await composeNativeCases(badAction);
  assert.equal(unsupported.diagnostics[0].code, "unsupported-operation");
  assert.equal(unsupported.diagnostics[0].nodeId, "name");
  const noRestore = await sample();
  flow(noRestore).finally.splice(1, 1);
  const invalid = await composeNativeCases(noRestore);
  assert.equal(invalid.document, undefined);
  assert.match(invalid.diagnostics[0].message, /恢复/);
  assert.equal(invalid.diagnostics[0].inputPath, undefined);
  assert.deepEqual(invalid.caseIds, []);
  assert.equal((await composeNativeCases(undefined)).document, undefined);
});

test("candidate parameter diagnostics name exact nested fields without values and retain action origin", async () => {
  const definition: CaseComposition = {
    kind: "pink-case-composition",
    schemaVersion: 1,
    sources: [],
    fragments: [],
    nodes: [
      {
        id: "diagnostics",
        kind: "flow",
        target: { kind: "platform", id: "web-desktop" },
        before: [
          {
            id: "open",
            kind: "action",
            moduleId: "pink-build",
            operationId: "config.open",
            inputs: {},
          },
          {
            id: "ready",
            kind: "action",
            moduleId: "pink-build",
            operationId: "config.ready",
            inputs: { page: { $output: "open" } },
          },
          {
            id: "candidates",
            kind: "action",
            moduleId: "pink-build",
            operationId: "config.candidates",
            inputs: { page: { $output: "open" }, field: "sourceMaps" },
          },
        ],
        steps: [
          {
            id: "check",
            kind: "action",
            moduleId: "pink-build",
            operationId: "assert",
            inputs: {
              check: "candidate",
              observation: { $output: "candidates" },
              candidate: { by: "value", value: "inline" },
              expected: { present: true, disabled: false },
            },
          },
        ],
        finally: [
          {
            id: "cleanup",
            kind: "action",
            moduleId: "pink-build",
            operationId: "config.open",
            inputs: {},
          },
          {
            id: "close",
            kind: "action",
            moduleId: "pink-build",
            operationId: "config.close",
            inputs: { page: { $output: "cleanup" } },
          },
        ],
      },
    ],
  };
  const valid = await composeNativeCases(definition);
  assert.deepEqual(valid.diagnostics, []);
  assert.ok(valid.document);
  const privateValue = "diagnostic-private-content";
  const samples: Array<{
    overrides: Record<string, unknown>;
    remove?: string;
    path: string;
    inputPath: string[];
    fields: string[];
  }> = [
    {
      overrides: { unexpected: privateValue },
      path: "unexpected",
      inputPath: ["unexpected"],
      fields: ["含未支持的属性：unexpected"],
    },
    {
      overrides: { candidate: { value: privateValue } },
      path: "candidate.by",
      inputPath: ["candidate", "by"],
      fields: ["缺少必填属性：by"],
    },
    {
      overrides: { candidate: { by: privateValue, value: "inline" } },
      path: "candidate.by",
      inputPath: ["candidate", "by"],
      fields: ["value 或 label"],
    },
    {
      overrides: { candidate: { by: "value", label: privateValue } },
      path: "candidate.value",
      inputPath: ["candidate", "value"],
      fields: ["缺少必填属性：value", "含未支持的属性：label"],
    },
    {
      overrides: { candidate: { by: "label", value: privateValue } },
      path: "candidate.label",
      inputPath: ["candidate", "label"],
      fields: ["缺少必填属性：label", "含未支持的属性：value"],
    },
    {
      overrides: { expected: { present: true, extra: privateValue } },
      path: "expected.extra",
      inputPath: ["expected", "extra"],
      fields: ["含未支持的属性：extra"],
    },
    {
      overrides: { expected: { disabled: false } },
      path: "expected.present",
      inputPath: ["expected", "present"],
      fields: ["缺少必填属性：present"],
    },
    {
      overrides: { expected: { present: privateValue } },
      path: "expected.present",
      inputPath: ["expected", "present"],
      fields: ["布尔值"],
    },
    {
      overrides: { expected: { present: false, disabled: false } },
      path: "expected.disabled",
      inputPath: ["expected", "disabled"],
      fields: ["仅用于存在的候选"],
    },
    {
      overrides: {},
      remove: "candidate",
      path: "candidate",
      inputPath: ["candidate"],
      fields: ["缺少必填属性：candidate"],
    },
    {
      overrides: {},
      remove: "expected",
      path: "expected",
      inputPath: ["expected"],
      fields: ["缺少必填属性：expected"],
    },
    {
      overrides: { expected: { present: true, "extra.part": privateValue } },
      path: 'expected["extra.part"]',
      inputPath: ["expected", "extra.part"],
      fields: ["含未支持的属性：extra.part"],
    },
  ];
  for (const sample of samples) {
    const edited = structuredClone(definition);
    const node = edited.nodes[0] as Extract<CompositionNode, { kind: "flow" }>;
    const action = node.steps[0] as CompositionAction;
    Object.assign(action.inputs, sample.overrides);
    if (sample.remove) delete action.inputs[sample.remove];
    const validation = await validateCaseComposition(edited);
    assert.equal(validation.valid, false);
    const result = await composeNativeCases(edited);
    assert.equal(result.document, undefined);
    const error = result.diagnostics[0];
    assert.equal(error.code, "native-contract");
    assert.deepEqual(error.instancePath, ["diagnostics", "check"]);
    assert.deepEqual(error.inputPath, sample.inputPath);
    assert.ok(error.message.startsWith(`cases[0].steps[3].${sample.path}：`), error.message);
    for (const field of sample.fields) assert.ok(error.message.includes(field), error.message);
    assert.ok(!error.message.includes(privateValue));
    assert.equal(validation.diagnostics[0].message, error.message);
    assert.deepEqual(validation.diagnostics[0].inputPath, sample.inputPath);
  }
  const noField = await sample();
  const check = flow(noField).steps.find(
    (step) => step.kind === "action" && step.operationId === "assert",
  ) as CompositionAction;
  check.inputs.snapshot = { $output: "open" };
  const coarse = (await composeNativeCases(noField)).diagnostics[0];
  assert.equal(coarse.code, "native-contract");
  assert.equal(coarse.nodeId, "expected");
  assert.equal(
    coarse.inputPath,
    undefined,
    "a dependency error without a field path must stay coarse",
  );
  const selection = structuredClone(valid.document);
  selection.cases[0].steps[3] = {
    id: "select",
    op: "config.select",
    page: selection.cases[0].steps[0].id,
    field: "sourceMaps",
    candidate: { by: "value", value: "inline" },
  };
  const badSelection = selection as unknown as {
    cases: Array<{ steps: Array<{ candidate?: unknown }> }>;
  };
  badSelection.cases[0].steps[3].candidate = { value: privateValue };
  assert.throws(
    () => validateConfigurationSteps(selection),
    /cases\[0\]\.steps\[3\]\.candidate\.by：缺少必填属性：by/,
  );
});

test("source native v1 cases remain atomic and duplicate selections receive independent identities", async () => {
  const native = JSON.parse(
    await readFile(new URL("../fixtures/configuration-steps/basic.json", import.meta.url), "utf8"),
  );
  const source = structuredClone(native),
    composition = createCaseComposition(native);
  const originalRef = composition.nodes[0];
  assert.equal(originalRef.kind, "case-ref");
  const copied = structuredClone(originalRef);
  copied.id = "copy";
  copied.values = { name: "Independent copy" };
  copied.expectedValues = { name: "Independent copy" };
  composition.nodes.push(copied);
  const result = await composeNativeCases(composition);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.caseIds.length, 2);
  assert.notEqual(result.caseIds[0], result.caseIds[1]);
  assert.equal(
    result.document!.cases[0].steps.some((s) => s.op === "set" && s.value === "Independent copy"),
    false,
  );
  assert.equal(
    result.document!.cases[1].steps.some((s) => s.op === "set" && s.value === "Independent copy"),
    true,
  );
  assert.deepEqual(native, source);
  const twice = await composeNativeCases(composition, {
    items: [
      { path: [originalRef.id], instanceId: "first", values: { name: "First" } },
      { path: [originalRef.id], instanceId: "second", values: { name: "Second" } },
    ],
  });
  assert.deepEqual(twice.diagnostics, []);
  assert.notEqual(twice.caseIds[0], twice.caseIds[1]);
  assert.deepEqual(
    twice.sourceMap.map((c) => c.instanceId),
    ["first", "second"],
  );
  const partial = await composeNativeCases(composition, {
    items: [{ path: [originalRef.id], steps: ["anything"] }],
  });
  assert.equal(partial.diagnostics[0].code, "selection-atomic");
});

test("materialized native v2 copies stay independent of later shared-fragment changes", async () => {
  const shared = await sample();
  const first = await composeNativeCases(shared, { items: [{ path: ["desktop"] }] });
  const independent = createCaseComposition(first.document, { sourceId: "independent" });
  const reference = shared.nodes[0];
  assert.equal(reference.kind, "use");
  reference.arguments!.name = "Shared changed";
  reference.arguments!.expectedName = "Shared changed";
  const changed = await composeNativeCases(shared, { items: [{ path: ["desktop"] }] });
  const copy = await composeNativeCases(independent);
  assert.deepEqual(copy.diagnostics, []);
  assert.ok(
    changed.document!.cases[0].steps.some((s) => s.op === "set" && s.value === "Shared changed"),
  );
  assert.ok(
    copy.document!.cases[0].steps.some(
      (s) => s.op === "set" && s.value === "qa_desktop_composition",
    ),
  );
  assert.equal(
    copy.document!.cases[0].steps.some((s) => s.op === "set" && s.value === "Shared changed"),
    false,
  );
});

test("result mapping rejects the wrong native document, corrupted origins and unknown step evidence", async () => {
  const assembly = await composeNativeCases(await sample());
  const result = await runConfigurationSteps(loaded(assembly.document!), externalControls().env);
  const payload = { ...result, documentSha256: assembly.documentSha256 };
  const legacy = structuredClone(assembly);
  delete legacy.preflight;
  legacy.mappingSha256 = valueHash({
    documentSha256: legacy.documentSha256,
    definitionSha256: legacy.definitionSha256,
    selectionSha256: legacy.selectionSha256,
    sourceMap: legacy.sourceMap,
  });
  assert.equal(mapCompositionResults(legacy, payload).length, assembly.caseIds.length);
  const changedPreflight = structuredClone(assembly);
  changedPreflight.preflight![0].status = "blocked";
  assert.throws(() => mapCompositionResults(changedPreflight, payload), /快照/);
  assert.throws(
    () => mapCompositionResults(assembly, { ...payload, documentSha256: "other" }),
    /快照/,
  );
  const corrupt = structuredClone(assembly);
  corrupt.sourceMap[0].instancePath = ["wrong-instance"];
  assert.throws(() => mapCompositionResults(corrupt, payload), /快照/);
  const unknown = structuredClone(payload);
  unknown.cases[0].steps[0].stepId = "not-a-real-step";
  assert.throws(() => mapCompositionResults(assembly, unknown), /未知执行步骤/);
  assert.doesNotThrow(() => JSON.stringify(describeCaseComposition()));
  validateConfigurationSteps(assembly.document);
});

test("missing flow materials block the complete flow, retain independent cases and cannot hide invalid dependencies", async () => {
  const definition = await sample();
  const body = flow(definition);
  const set = body.steps.find(
    (step) => step.kind === "action" && step.operationId === "set",
  ) as CompositionAction;
  const check = body.steps.find(
    (step) => step.kind === "action" && step.operationId === "assert",
  ) as CompositionAction;
  definition.fragments[0].parameters!.name.references = ["material"];
  definition.fragments[0].parameters!.expectedName.references = ["material"];
  const desktop = definition.nodes[0] as Extract<CompositionNode, { kind: "use" }>;
  desktop.arguments!.name = { $material: "qa.missingName" };
  desktop.arguments!.expectedName = { $material: "qa.missingName" };
  const original = structuredClone(definition);
  const assembly = await composeNativeCases(definition);
  assert.deepEqual(assembly.diagnostics, []);
  assert.deepEqual(
    assembly.preflight!.map((c) => c.status),
    ["blocked", "ready", "ready"],
  );
  assert.equal(assembly.caseIds.length, 3);
  assert.equal(assembly.sourceMap.length, 3);
  assert.ok(assembly.document!.cases[0].steps.length > 0);
  const fixture = externalControls();
  const result = await runConfigurationSteps(loaded(assembly.document!), fixture.env);
  assert.deepEqual(
    result.cases.map((c) => c.outcome),
    ["blocked", "passed", "passed"],
  );
  assert.ok(!fixture.events.some((event) => event.includes("web-desktop")));
  assert.equal(
    mapCompositionResults(assembly, { ...result, documentSha256: assembly.documentSha256 }).length,
    3,
  );
  assert.deepEqual(definition, original);
  const invalidBlocked = structuredClone(assembly.document!);
  invalidBlocked.cases[0].steps[0].op = "unsupported.action" as never;
  assert.throws(() => validateConfigurationSteps(invalidBlocked), /未支持/);
  set.operationId = "unsupported.action" as never;
  const malformed = await composeNativeCases(definition);
  assert.equal(malformed.document, undefined);
  assert.equal(malformed.diagnostics[0].code, "unsupported-operation");
  set.operationId = "set";
  check.inputs.snapshot = { $output: ["mobile", "check", "read"] };
  const crossCase = await composeNativeCases(definition);
  assert.equal(crossCase.document, undefined);
  assert.equal(crossCase.diagnostics[0].code, "dependency");
});

test("Catalog reference prerequisites remain per-case preflight records, including all-blocked and not-applicable scopes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pink-composition-preflight-"));
  t.after(async () => {
    assert.equal(dirname(root), tmpdir());
    await rm(root, { recursive: true });
  });
  const catalog = JSON.parse(
    await readFile(new URL("../../case-catalog/public-combinations.json", import.meta.url), "utf8"),
  ) as CatalogDocument;
  catalog.platforms = catalog.platforms.filter((p) => p.id === "web-desktop");
  catalog.conditionalScenarios = [];
  for (const combo of catalog.platforms[0].combinations) {
    combo.values =
      combo.template === "publish" ? { name: { $material: "qa.name" } } : { name: "qa_ready" };
    combo.variants = [];
    combo.fieldCoverage = {};
    combo.configurationOrder = [];
    combo.excludedFields = Object.keys(
      catalog.templates.find((template) => template.id === combo.template)!.values,
    );
  }
  const definition = createCaseComposition(catalog);
  const references = ["publish", "debug", "mixed"].map((group) => {
    const reference = definition.nodes.find(
      (node) => node.kind === "case-ref" && node.caseId === `review.${group}.web-desktop`,
    )!;
    assert.ok(reference.kind === "case-ref");
    reference.endpoint = "ui";
    return reference;
  });
  const selection = { items: references.map((reference) => ({ path: [reference.id] })) };
  delete references[0].endpoint;
  const assembly = await composeNativeCases(definition, selection);
  assert.deepEqual(assembly.diagnostics, []);
  assert.deepEqual(
    assembly.preflight!.map((c) => c.status),
    ["blocked", "ready", "blocked"],
  );
  assert.ok(assembly.preflight![0].gaps.some((gap) => gap.kind === "material"));
  assert.ok(assembly.preflight![2].gaps.some((gap) => gap.kind === "applicability"));
  assert.ok(assembly.document!.cases[0].steps.some((step) => step.op === "build.submit"));
  assert.equal(assembly.willSubmit, false);
  const fixture = externalControls();
  const result = await runConfigurationSteps(loaded(assembly.document!), fixture.env);
  assert.deepEqual(
    result.cases.map((c) => c.outcome),
    ["blocked", "passed", "blocked"],
  );
  assert.equal(fixture.events.filter((event) => event.startsWith("open:")).length, 1);
  assert.ok("groups" in result);
  assert.deepEqual(
    result.groups.map((group) => group.caseIds),
    [[assembly.caseIds[1]]],
  );
  const allBlocked = await composeNativeCases(definition, {
    items: [selection.items[0], selection.items[2]],
  });
  assert.deepEqual(allBlocked.diagnostics, []);
  assert.ok(allBlocked.document);
  assert.equal(allBlocked.willSubmit, false);
  assert.equal(allBlocked.caseIds.length, 2);
  assert.equal(allBlocked.sourceMap.length, 2);
  const materials = join(root, "materials.json");
  await writeFile(
    materials,
    JSON.stringify({ schemaVersion: 1, bindings: {}, mixedPlatforms: [] }),
  );
  const notApplicable = await composeNativeCases(
    definition,
    { items: [selection.items[2]] },
    { materials },
  );
  assert.deepEqual(notApplicable.diagnostics, []);
  assert.equal(notApplicable.preflight![0].status, "not-applicable");
  const ignored = externalControls();
  const na = await runConfigurationSteps(loaded(notApplicable.document!), ignored.env);
  assert.equal(na.cases[0].outcome, "not-applicable");
  assert.deepEqual(ignored.events, []);
  const badOverride = await composeNativeCases(definition, {
    items: [{ ...selection.items[0], expectedValues: { name: false } }],
  });
  assert.equal(badOverride.document, undefined);
  assert.ok(badOverride.diagnostics.length);
});
