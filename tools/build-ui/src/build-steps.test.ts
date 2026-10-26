import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  loadConfigurationSteps,
  validateConfigurationSteps,
  type LoadedConfigurationSteps,
} from "./configuration-steps-contract.js";
import { runConfigurationSteps } from "./configuration-steps.js";
import { ExecutionContext } from "./configuration-context.js";
import { ConfigurationOperations, type ConfigurationPort } from "./configuration-operations.js";
import type { BuildStepsDocument } from "./build-steps-contract.js";
import type { BuildStepsPort } from "./build-steps.js";
import type { CaseValue } from "./finalized-cases.js";
import { valueHash } from "./plan-integrity.js";
import type { Task } from "./common.js";
import { submitBuild, waitBuild } from "./build-operations.js";
import { ExecutionStop } from "./execution-stop.js";

const path = (name: string) =>
  fileURLToPath(new URL(`../fixtures/configuration-steps/${name}.json`, import.meta.url));
const base = JSON.parse(await readFile(path("build-v2-basic"), "utf8")) as BuildStepsDocument;
function loaded(document: BuildStepsDocument): LoadedConfigurationSteps {
  validateConfigurationSteps(document);
  return {
    path: "offline",
    document,
    documentSha256: valueHash(document),
    sourceSha256: valueHash(document),
  };
}

/** Simulates only external controls/task notifications; uses real loader, operations, association and checks. */
function fixture(
  mode:
    | "normal"
    | "queued-mismatch"
    | "terminal-failure"
    | "terminal-mismatch"
    | "ambiguous"
    | "restore-failure"
    | "lost-task" = "normal",
) {
  const initial: Record<string, CaseValue> = {
    name: "Original",
    "packages.web-mobile.orientation": "auto",
    "packages.web-mobile.embedWebDebugger": false,
  };
  const values = structuredClone(initial),
    events: string[] = [],
    tasks: Task[] = [];
  let generation = 0,
    open = false,
    clicks = 0,
    lastClosedGeneration = 0;
  const identity = { executable: "offline.exe", project: "offline-project", windowId: 1 };
  const session = new ExecutionContext(identity, async () => identity);
  const port: ConfigurationPort = {
    inspect: async (field) =>
      field in values
        ? {
            value: values[field],
            kind: typeof values[field] === "boolean" ? "boolean" : "string",
            disabled: false,
            selector: "offline",
          }
        : null,
    read: async (field) => {
      const value = await port.inspect(field);
      assert.ok(value);
      return value;
    },
    set: async (field, value) => {
      assert.ok(open);
      events.push(`set:${field}:${value}`);
      const changed = values[field] !== value;
      values[field] = value;
      return changed;
    },
    restoreControl: async (field, value) => {
      if (mode === "restore-failure") throw new Error("restore input unavailable");
      values[field] = value.value;
    },
    alerts: async () => [],
    primaryBuildEnabled: async () => true,
    reopen: async () => {
      throw new Error("must use explicit lifecycle");
    },
    cancelFileChoice: async () => {
      throw new Error("unused");
    },
  };
  const source = {
    tasks: () => tasks,
    get: (id: string) => {
      if (mode === "lost-task") return undefined;
      const task = tasks.find((t) => t.id === id);
      return task && mode === "terminal-mismatch" && clicks === 1
        ? { ...task, caseOptions: { ...task.caseOptions, name: "Changed at terminal" } }
        : task;
    },
    assertHealthy: () => {},
  };
  const build: BuildStepsPort = {
    source,
    baselineIds: new Set(),
    signal: new AbortController().signal,
    queueTimeoutMs: 1000,
    buildTimeoutMs: 1000,
    capture: async (_operations, fields) => ({
      configuration: {
        name: String(values.name),
        buildPath: "build",
        outputName: "mobile",
        startScene: "scene",
        startSceneId: "scene-uuid",
        debug: false,
        selectedScenes: ["scene"],
        fields: {},
      },
      values: Object.fromEntries(fields.map((k) => [k, values[k]])),
    }),
    click: async (_operations, verify) => {
      await verify();
      clicks++;
      events.push("click");
      const at = Date.now();
      const task: Task = {
        id: `task-${clicks}`,
        platform: "web-mobile",
        outputName: "mobile",
        createdAt: at,
        progress: 1,
        state: mode === "terminal-failure" && clicks === 1 ? "failure" : "success",
        message: mode === "terminal-failure" ? "fixture compile failed" : undefined,
        caseOptions: structuredClone(values),
      };
      if (mode === "queued-mismatch" && clicks === 1) task.caseOptions!.name = "Wrong task name";
      tasks.push(task);
      if (mode === "ambiguous") tasks.push({ ...task, id: "second-match" });
      open = false;
      lastClosedGeneration = generation;
      return at;
    },
    assertCard: async (task) => {
      events.push(`card:${task.id}`);
      assert.equal(task.state, "success");
    },
  };
  return {
    values,
    initial,
    events,
    tasks,
    clicks: () => clicks,
    env: {
      session,
      evidenceKind: "offline-fixture" as const,
      build,
      openConfiguration: async (platform: string) => {
        assert.equal(open, false);
        open = true;
        events.push("open");
        const gen = ++generation;
        const bind = () =>
          session.bind(platform, platform, gen, async () => {
            if (!open || gen <= lastClosedGeneration) throw new Error("closed page");
            return { title: platform, generation: gen };
          });
        return new ConfigurationOperations(bind(), port, async () => bind());
      },
      closeConfiguration: async () => {
        assert.ok(open);
        open = false;
        lastClosedGeneration = generation;
        events.push("close");
      },
    },
  };
}

test("v2 JSON changes lifecycle and configuration order; real shared operations submit, collect and restore", async () => {
  const a = fixture(),
    b = fixture();
  const ra = await runConfigurationSteps(
    await loadConfigurationSteps(path("build-v2-basic")),
    a.env,
  );
  const rb = await runConfigurationSteps(
    await loadConfigurationSteps(path("build-v2-edited")),
    b.env,
  );
  assert.equal(ra.outcome, "passed");
  assert.equal(rb.outcome, "passed");
  assert.equal(ra.buildSubmitted, true);
  assert.equal(ra.evidenceKind, "offline-fixture");
  assert.deepEqual(a.values, a.initial);
  assert.deepEqual(b.values, b.initial);
  assert.equal(a.clicks(), 1);
  assert.equal(b.clicks(), 1);
  assert.deepEqual(b.events.slice(0, 6), [
    "open",
    "close",
    "open",
    "set:packages.web-mobile.embedWebDebugger:true",
    "set:packages.web-mobile.orientation:portrait",
    "set:name:qa_v2_edited",
  ]);
  assert.equal(rb.cases[0].restoration, "passed");
  assert.equal(rb.cases[0].tasks?.[0].taskId, "task-1");
});

test("v2 rejects stale pages/snapshots, missing collection, foreign references and cleanup builds offline", () => {
  const bad: Array<(d: BuildStepsDocument) => void> = [
    (d) => {
      d.cases[0].steps.splice(2, 0, { id: "closed", op: "config.close", page: "page" });
    },
    (d) => {
      d.cases[0].steps.splice(6, 0, {
        id: "late",
        op: "set",
        page: "page",
        field: "name",
        value: "after-snapshot",
      });
    },
    (d) => {
      d.cases[0].steps = d.cases[0].steps.filter((s) => s.op !== "build.wait");
    },
    (d) => {
      d.cases[0].finally = [];
    },
    (d) => {
      d.cases[0].steps.push({ id: "again", op: "build.wait", task: "other-case" });
    },
    (d) => {
      d.cases[0].finally.unshift({
        id: "unsafe",
        op: "build.submit",
        page: "page",
        snapshot: "final",
      });
    },
    (d) => {
      const read = d.cases[0].steps.find((s) => s.op === "read")!;
      if (read.op === "read") read.fields = ["name"];
    },
  ];
  for (const modify of bad) {
    const doc = structuredClone(base);
    modify(doc);
    assert.throws(() => validateConfigurationSteps(doc));
  }
});

test("queued mismatch and explicit build failure retain task, collect, restore and continue next case", async () => {
  for (const mode of ["queued-mismatch", "terminal-failure", "terminal-mismatch"] as const) {
    const doc = structuredClone(base);
    doc.cases.push({ ...structuredClone(doc.cases[0]), caseId: "next" });
    const f = fixture(mode),
      result = await runConfigurationSteps(loaded(doc), f.env);
    assert.equal(result.cases[0].outcome, "failed");
    assert.equal(result.cases[0].tasks?.[0].collected, true);
    assert.equal(result.cases[0].restoration, "passed");
    assert.equal(result.cases[1].outcome, "passed");
    assert.equal(f.clicks(), 2);
    assert.deepEqual(f.values, f.initial);
  }
});

test("ambiguous submission and lost task stop without retry or unsafe restoration", async () => {
  for (const mode of ["ambiguous", "lost-task"] as const) {
    const doc = structuredClone(base);
    doc.cases.push({ ...structuredClone(doc.cases[0]), caseId: "sentinel" });
    const f = fixture(mode),
      result = await runConfigurationSteps(loaded(doc), f.env);
    assert.equal(result.cases[0].outcome, "stopped");
    assert.equal(result.cases[1].outcome, "skipped");
    assert.equal(result.cases[0].restoration, "unsafe");
    assert.equal(f.clicks(), 1);
    assert.ok("taskMayStillBeRunning" in result && result.taskMayStillBeRunning);
  }
});

test("restoration failure stops after terminal task and keeps cleanup failure evidence", async () => {
  const doc = structuredClone(base);
  doc.cases.push({ ...structuredClone(doc.cases[0]), caseId: "sentinel" });
  const f = fixture("restore-failure"),
    result = await runConfigurationSteps(loaded(doc), f.env);
  assert.equal(result.cases[0].restoration, "failed");
  assert.equal(result.cases[1].outcome, "skipped");
  assert.ok(
    result.cases[0].steps
      .find((s) => s.stepId === "restore")
      ?.diagnostic?.chain.some((c) => c.message.includes("restore input unavailable")),
  );
});

test("shared submission handles no-task and uncertain delivery with one click; wait distinguishes timeout phases", async () => {
  for (const uncertain of [false, true]) {
    let clicks = 0;
    await assert.rejects(
      submitBuild({
        source: { tasks: () => [], get: () => undefined, assertHealthy: () => {} },
        baselineIds: new Set(),
        platform: "web-mobile",
        outputName: "out",
        verify: async () => {},
        click: async () => {
          clicks++;
          if (uncertain) throw new Error("delivery unknown");
          return Date.now();
        },
        onAttempt: () => {},
        signal: new AbortController().signal,
        associationTimeoutMs: 1,
      }),
      /提交未能唯一确认/,
    );
    assert.equal(clicks, 1);
  }
  for (const processing of [false, true]) {
    const at = Date.now() - 10000;
    const task: Task = {
      id: "t",
      platform: "web-mobile",
      state: processing ? "processing" : "waiting",
      progress: 0,
      createdAt: at,
      observation: processing ? { firstSeenAt: at, processingAt: at } : undefined,
    };
    await assert.rejects(
      waitBuild({
        source: { tasks: () => [task], get: () => task, assertHealthy: () => {} },
        taskId: "t",
        submittedAt: at,
        queueTimeoutMs: 100,
        buildTimeoutMs: 100,
        signal: new AbortController().signal,
      }),
      (error: unknown) =>
        error instanceof Error &&
        error.cause instanceof Error &&
        error.cause.message.includes(processing ? "构建观察超时" : "启动等待超时"),
    );
  }
});

test("pre-submit assertion failure restores without clicking; onFailure stop is honored after cleanup", async () => {
  for (const policy of ["continue", "stop"] as const) {
    const doc = structuredClone(base);
    doc.cases.push({ ...structuredClone(doc.cases[0]), caseId: "next" });
    doc.cases[0].onFailure = policy;
    const step = doc.cases[0].steps.find((s) => s.op === "assert" && s.check === "values")!;
    if (step.op === "assert" && step.check === "values") step.values.name = "deliberate mismatch";
    const f = fixture(),
      result = await runConfigurationSteps(loaded(doc), f.env);
    assert.equal(result.cases[0].restoration, "passed");
    assert.equal(result.cases[1].outcome, policy === "continue" ? "passed" : "skipped");
    assert.equal(f.clicks(), policy === "continue" ? 1 : 0);
    assert.deepEqual(f.values, f.initial);
  }
});

for (const phase of ["configuration", "owned-task", "restore-failure"] as const) {
  test(`cooperative stop at ${phase} prevents later cases and retains safe recovery/collection`, async () => {
    const f = fixture(phase === "restore-failure" ? "restore-failure" : "normal");
    const stop = new ExecutionStop();
    const doc = structuredClone(base);
    doc.cases.push({ ...structuredClone(doc.cases[0]), caseId: "must-not-run" });
    if (phase === "owned-task") {
      const click = f.env.build.click;
      f.env.build.click = async (operations, verify) => {
        const at = await click(operations, verify);
        f.tasks[0].state = "processing";
        setTimeout(() => {
          f.tasks[0].state = "success";
        }, 50);
        return at;
      };
    }
    const result = await runConfigurationSteps(loaded(doc), {
      ...f.env,
      stopSignal: stop.signal,
      onProgress: async (p) => {
        const first = p.cases[0];
        if (
          first.steps.some(
            (s) =>
              s.stepId === (phase === "owned-task" ? "submitted" : "rename") &&
              s.outcome === "passed",
          )
        )
          stop.request("SIGINT");
      },
    });
    assert.equal(result.stopped, true);
    assert.equal(f.clicks(), phase === "owned-task" ? 1 : 0);
    assert.equal(result.cases[1].outcome, "skipped");
    assert.equal(result.cases[0].failure!.code, "interrupted");
    if (phase === "restore-failure") assert.equal(result.cases[0].restoration, "failed");
    else {
      assert.equal(result.cases[0].restoration, "passed");
      assert.deepEqual(f.values, f.initial);
    }
    if (phase === "owned-task") {
      assert.equal(result.cases[0].tasks![0].state, "success");
      assert.equal(result.cases[0].tasks![0].collected, true);
      assert.equal("taskMayStillBeRunning" in result && result.taskMayStillBeRunning, false);
    }
  });
}
