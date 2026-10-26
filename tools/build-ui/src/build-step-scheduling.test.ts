import { test } from "node:test";
import assert from "node:assert/strict";
import { ExecutionContext } from "./configuration-context.js";
import { ConfigurationOperations, type ConfigurationPort } from "./configuration-operations.js";
import { runConfigurationSteps } from "./configuration-steps.js";
import {
  configurationStepsPlan,
  validateConfigurationSteps,
} from "./configuration-steps-contract.js";
import type { BuildStepsDocument, BuildStepCase } from "./build-steps-contract.js";
import type { BuildStepsPort } from "./build-steps.js";
import { valueHash } from "./plan-integrity.js";
import type { Task } from "./common.js";

function example(caseId: string, platform: string): BuildStepCase {
  return {
    caseId,
    platform,
    steps: [
      { id: "page", op: "config.open" },
      { id: "original", op: "record", page: "page", fields: ["name"] },
      { id: "edit", op: "set", page: "page", field: "name", value: caseId },
      { id: "final", op: "read", page: "page", scope: "build", fields: ["name"] },
      { id: "check", op: "assert", check: "values", snapshot: "final", values: { name: caseId } },
      { id: "submitted", op: "build.submit", page: "page", snapshot: "final" },
      { id: "finished", op: "build.wait", task: "submitted" },
      {
        id: "success",
        op: "assert",
        check: "build-result",
        task: "submitted",
        result: "finished",
        expected: { state: "success" },
      },
    ],
    finally: [
      { id: "cleanup", op: "config.open" },
      { id: "restore", op: "restore", page: "cleanup", record: "original" },
      { id: "close", op: "config.close", page: "cleanup" },
    ],
  };
}
function document(platforms = ["web-desktop", "web-mobile", "windows", "web-desktop"]) {
  return {
    kind: "pink-configuration-steps",
    schemaVersion: 2,
    cases: platforms.map((p, i) => example(`case${i + 1}`, p)),
  } as BuildStepsDocument;
}
function load(doc: BuildStepsDocument) {
  return {
    path: "offline",
    document: validateConfigurationSteps(doc),
    sourceSha256: valueHash(doc),
    documentSha256: valueHash(doc),
  };
}
type Mode =
  | "normal"
  | "queued-mismatch"
  | "terminal-failure"
  | "ambiguous-second"
  | "queued-mismatch-and-ambiguous-second"
  | "restore-failure"
  | "queue"
  | "timeout-during-configuration";

/** Only the external UI and task notifications are fixtures. The scheduler and all operations are real. */
function fixture(mode: Mode = "normal") {
  const identity = { executable: "offline.exe", project: "offline", windowId: 1 };
  const session = new ExecutionContext(identity, async () => identity);
  const values = new Map<string, Record<string, string>>();
  const tasks: Task[] = [],
    events: string[] = [],
    timers: NodeJS.Timeout[] = [];
  let active: string | undefined,
    generation = 0,
    clicks = 0;
  const source = {
    tasks: () => tasks,
    get: (id: string) => tasks.find((t) => t.id === id),
    assertHealthy: () => {},
  };
  const build: BuildStepsPort = {
    source,
    baselineIds: new Set(),
    signal: new AbortController().signal,
    queueTimeoutMs: 2000,
    buildTimeoutMs: 2000,
    capture: async (operations) => ({
      configuration: {
        name: values.get(operations.platform)!.name,
        buildPath: "build",
        outputName: operations.platform,
        startScene: "scene",
        startSceneId: "uuid",
        selectedScenes: ["scene"],
        debug: false,
        fields: {},
      },
      values: structuredClone(values.get(operations.platform)!),
    }),
    click: async (operations, verify) => {
      await verify();
      assert.equal(active, operations.platform);
      clicks++;
      const at = Date.now();
      const task: Task = {
        id: `task${clicks}`,
        platform: operations.platform,
        outputName: operations.platform,
        createdAt: at,
        state: "success",
        progress: 1,
        caseOptions: structuredClone(values.get(operations.platform)!),
      };
      if (
        ["queued-mismatch", "queued-mismatch-and-ambiguous-second"].includes(mode) &&
        clicks === 1
      )
        task.caseOptions!.name = "wrong";
      if (mode === "terminal-failure" && clicks === 1) {
        task.state = "failure";
        task.message = "controlled build failure";
      }
      if (mode === "timeout-during-configuration" && clicks === 1) task.state = "waiting";
      if (mode === "queue" && clicks <= 2) {
        task.state = clicks === 1 ? "processing" : "waiting";
        task.progress = 0;
        task.observation =
          clicks === 1 ? { firstSeenAt: at, processingAt: at } : { firstSeenAt: at, waitingAt: at };
        if (clicks === 2) {
          timers.push(
            setTimeout(() => {
              tasks[0].state = "success";
              tasks[0].observation!.terminalAt = Date.now();
              task.state = "processing";
              task.observation!.processingAt = Date.now();
            }, 5),
          );
          timers.push(
            setTimeout(() => {
              task.state = "success";
              task.observation!.terminalAt = Date.now();
            }, 10),
          );
        }
      }
      tasks.push(task);
      if (
        ["ambiguous-second", "queued-mismatch-and-ambiguous-second"].includes(mode) &&
        clicks === 2
      )
        tasks.push({ ...task, id: "ambiguous" });
      events.push(`submit:${operations.platform}`);
      active = undefined;
      return at;
    },
    assertCard: async (task) => {
      events.push(`card:${task.platform}`);
    },
  };
  return {
    values,
    tasks,
    events,
    clicks: () => clicks,
    dispose: () => timers.forEach(clearTimeout),
    env: {
      session,
      evidenceKind: "offline-fixture" as const,
      build,
      openConfiguration: async (platform: string) => {
        assert.equal(active, undefined, "only one configuration modal may be active");
        active = platform;
        events.push(`open:${platform}`);
        if (!values.has(platform)) values.set(platform, { name: `original:${platform}` });
        const data = values.get(platform)!;
        const currentGeneration = ++generation;
        const bind = () =>
          session.bind(platform, platform, currentGeneration, async () => {
            assert.equal(active, platform);
            assert.equal(generation, currentGeneration);
            return { title: platform, generation: currentGeneration };
          });
        const port: ConfigurationPort = {
          inspect: async (field) =>
            field in data
              ? { value: data[field], kind: "string", disabled: false, selector: "offline" }
              : null,
          read: async (field) => (await port.inspect(field))!,
          set: async (field, value) => {
            const changed = data[field] !== value;
            data[field] = String(value);
            events.push(`set:${platform}`);
            if (mode === "timeout-during-configuration" && platform === "web-mobile")
              tasks[0].createdAt = Date.now() - 10_000;
            return changed;
          },
          restoreControl: async (field, value) => {
            if (mode === "restore-failure" && platform === "web-desktop")
              throw new Error("restore unavailable");
            data[field] = String(value.value);
            events.push(`restore:${platform}`);
          },
          alerts: async () => [],
          primaryBuildEnabled: async () => true,
          reopen: async () => assert.fail("explicit lifecycle required"),
          cancelFileChoice: async () => assert.fail("not used"),
        };
        return new ConfigurationOperations(bind(), port, async () => bind());
      },
      closeConfiguration: async () => {
        events.push(`close:${active}`);
        active = undefined;
      },
    },
  };
}

test("v2 groups submit two different platforms before collection, and finish recovery before next group", async () => {
  const f = fixture("queue");
  try {
    const loaded = load(document());
    const plan = configurationStepsPlan(loaded);
    assert.ok("execution" in plan);
    assert.equal(plan.execution?.maxTasksPerGroup, 2);
    const result = await runConfigurationSteps(loaded, f.env);
    assert.ok("groups" in result);
    assert.equal(result.outcome, "passed");
    assert.deepEqual(
      result.groups.map((g) => g.caseIds),
      [
        ["case1", "case2"],
        ["case3", "case4"],
      ],
    );
    assert.equal(result.groups[0].queueCoverage, "observed");
    assert.equal(result.groups[1].queueCoverage, "not-observed");
    assert.ok(f.events.indexOf("submit:web-mobile") < f.events.indexOf("card:web-desktop"));
    assert.ok(f.events.indexOf("open:windows") > f.events.indexOf("restore:web-mobile"));
    assert.ok(result.groups[1].startedAt! >= result.groups[0].settledAt!);
    assert.deepEqual(
      result.cases.map((c) => c.tasks?.[0].taskId),
      ["task1", "task2", "task3", "task4"],
    );
    for (const [platform, data] of f.values) assert.equal(data.name, `original:${platform}`);
  } finally {
    f.dispose();
  }
});

test("repeated platform flushes its previous task and restores before the next case", async () => {
  const f = fixture();
  const result = await runConfigurationSteps(
    load(document(["web-mobile", "web-mobile", "windows"])),
    f.env,
  );
  assert.ok("groups" in result);
  assert.deepEqual(
    result.groups.map((g) => g.caseIds),
    [["case1"], ["case2", "case3"]],
  );
  assert.equal(result.outcome, "passed");
  const submits = f.events.flatMap((e, i) => (e === "submit:web-mobile" ? [i] : []));
  assert.ok(submits[1] > f.events.indexOf("restore:web-mobile"));
});

test("blocked inputs do not open their page or refill the group with a third case", async () => {
  const f = fixture(),
    doc = document();
  const edit = doc.cases[0].steps.find((s) => s.op === "set")!;
  if (edit.op === "set") edit.value = { $material: "missing.value" };
  const result = await runConfigurationSteps(load(doc), f.env);
  assert.equal(result.cases[0].outcome, "blocked");
  assert.equal(result.cases[1].outcome, "passed");
  assert.equal(f.events[0], "open:web-mobile");
  assert.ok(f.events.indexOf("open:windows") > f.events.indexOf("restore:web-mobile"));
  assert.equal(f.clicks(), 3);
});

test("steps declared after wait still execute before finally and the next group", async () => {
  const f = fixture(),
    doc = document();
  doc.cases[0].steps.push(
    { id: "inspectAgain", op: "config.open" },
    { id: "inspectClose", op: "config.close", page: "inspectAgain" },
  );
  const result = await runConfigurationSteps(load(doc), f.env);
  assert.equal(result.outcome, "passed");
  assert.equal(result.cases[0].steps.find((s) => s.stepId === "inspectAgain")?.outcome, "passed");
  assert.ok(f.events.indexOf("open:windows") > f.events.indexOf("restore:web-mobile"));
});

test("queued parameter and terminal failures collect owned tasks, restore and continue by case policy", async () => {
  for (const mode of ["queued-mismatch", "terminal-failure"] as const) {
    const f = fixture(mode);
    const result = await runConfigurationSteps(load(document()), f.env);
    assert.equal(result.cases[0].outcome, "failed");
    assert.equal(result.cases[0].tasks?.[0].collected, true);
    assert.equal(result.cases[0].restoration, "passed");
    assert.equal(result.cases[3].outcome, "passed");
    assert.equal(f.clicks(), 4);
  }
});

test("stop policy prevents new submissions but drains another task already submitted in the group", async () => {
  for (const mode of ["queued-mismatch", "terminal-failure"] as const) {
    const f = fixture(mode),
      doc = document();
    doc.cases[0].onFailure = "stop";
    const result = await runConfigurationSteps(load(doc), f.env);
    assert.equal(f.clicks(), mode === "queued-mismatch" ? 1 : 2);
    assert.equal(result.cases[0].stopReason?.code, "case-policy");
    assert.equal(result.cases[0].restoration, "passed");
    assert.equal(result.cases[1].outcome, mode === "queued-mismatch" ? "skipped" : "passed");
    if (mode === "terminal-failure") assert.equal(result.cases[1].tasks?.[0].collected, true);
    assert.equal(result.cases[2].outcome, "skipped");
  }
});

test("uncertain second submission stops without retry, collects known first task and prevents unsafe writes", async () => {
  for (const mode of ["ambiguous-second", "queued-mismatch-and-ambiguous-second"] as const) {
    const f = fixture(mode);
    const result = await runConfigurationSteps(load(document()), f.env);
    assert.equal(f.clicks(), 2);
    assert.equal(result.cases[0].tasks?.[0].collected, true);
    assert.equal(result.cases[0].restoration, "unsafe");
    assert.equal(result.cases[0].stopFollowingCases, true);
    assert.equal(result.cases[0].stopReason?.disposition, "stop");
    assert.equal(result.cases[1].failure?.code, "submission");
    assert.equal(result.cases[1].restoration, "unsafe");
    assert.equal(result.cases[2].outcome, "skipped");
    assert.ok("taskMayStillBeRunning" in result && result.taskMayStillBeRunning);
    assert.equal(
      f.events.some((e) => e.startsWith("restore:")),
      false,
    );
  }
});

test("restoration failure drains the sibling task and stops before next group", async () => {
  const f = fixture("restore-failure");
  const result = await runConfigurationSteps(load(document()), f.env);
  assert.equal(f.clicks(), 2);
  assert.equal(result.cases[0].restoration, "failed");
  assert.equal(result.cases[1].tasks?.[0].collected, true);
  assert.equal(result.cases[1].restoration, "unsafe");
  assert.equal(result.cases[2].outcome, "skipped");
});

test("task timeout during the next configuration stops before its click and blocks next group", async () => {
  const f = fixture("timeout-during-configuration");
  const result = await runConfigurationSteps(load(document()), f.env);
  assert.equal(f.clicks(), 1);
  assert.equal(result.cases[1].failure?.code, "task");
  assert.equal(result.cases[2].outcome, "skipped");
  assert.ok("taskMayStillBeRunning" in result && result.taskMayStillBeRunning);
});
