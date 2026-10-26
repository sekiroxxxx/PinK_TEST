import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfigurationOperations, type ConfigurationPort } from "./configuration-operations.js";
import { ExecutionContext } from "./configuration-context.js";
import { assertBuildOnly, type StageView } from "./configuration-stages.js";
import {
  validateConfigurationSteps,
  type LoadedConfigurationSteps,
} from "./configuration-steps-contract.js";
import { runConfigurationSteps } from "./configuration-steps.js";
import { valueHash } from "./plan-integrity.js";
import type { BuildStepsDocument } from "./build-steps-contract.js";

const doc = (): BuildStepsDocument => ({
  kind: "pink-configuration-steps",
  schemaVersion: 2,
  cases: [
    {
      caseId: "stages",
      platform: "wechatgame",
      steps: [
        { id: "page", op: "config.open" },
        { id: "original", op: "stage.record", page: "page" },
        {
          id: "connect",
          op: "stage.link",
          page: "page",
          record: "original",
          previous: "build",
          stage: "run",
        },
        { id: "after", op: "stage.read", page: "page" },
        {
          id: "check",
          op: "assert",
          check: "stages",
          snapshot: "after",
          expected: { groups: [["build", "run"]] },
        },
        {
          id: "scope",
          op: "assert",
          check: "build-scope",
          page: "page",
          expected: { allowed: false },
        },
      ],
      finally: [
        { id: "cleanup", op: "config.open" },
        { id: "restore", op: "stage.restore", page: "cleanup", record: "original", reopen: true },
        { id: "close", op: "config.close", page: "cleanup" },
      ],
    },
  ],
});

function fixture(restoreFails = false) {
  let joined = false,
    generation = 0,
    opened = false,
    changes = 0;
  const identity = { executable: "offline.exe", project: "offline-project", windowId: 1 };
  const session = new ExecutionContext(identity, async () => identity);
  const view = (): StageView => ({
    groups: joined ? [["build", "run"]] : [["build"], ["run"]],
    visible: ["build", "run"],
    buttons: joined
      ? [{ stage: "build", label: "构建运行", disabled: false }]
      : [
          { stage: "build", label: "构建", disabled: false },
          { stage: "run", label: "运行", disabled: true },
        ],
    links: joined ? [] : [{ previous: "build", stage: "run", disabled: false, selector: "link" }],
    unlinks: joined ? [{ group: "build", stage: "run", selector: "unlink" }] : [],
  });
  const port: ConfigurationPort = {
    inspect: async () => null,
    read: async () => {
      throw new Error("unused");
    },
    set: async () => {
      throw new Error("unused");
    },
    restoreControl: async () => {
      throw new Error("unused");
    },
    alerts: async () => [],
    primaryBuildEnabled: async () => true,
    cancelFileChoice: async () => {
      throw new Error("unused");
    },
    reopen: async () => {
      generation++;
    },
    readStages: async () => structuredClone(view()),
    changeStage: async (kind, anchor, stage) => {
      assert.equal(opened, true);
      assert.equal(anchor, "build");
      assert.equal(stage, "run");
      if (kind === "unlink" && restoreFails) throw new Error("connector unavailable");
      if (kind === "link") {
        assert.equal(joined, false);
        joined = true;
      } else {
        assert.equal(joined, true);
        joined = false;
      }
      changes++;
    },
  };
  return {
    port,
    externalUnlink: () => {
      joined = false;
    },
    joined: () => joined,
    changes: () => changes,
    env: {
      session,
      evidenceKind: "offline-fixture" as const,
      openConfiguration: async (platform: string) => {
        opened = true;
        generation++;
        const bind = () =>
          session.bind(platform, "wechat", generation, async () => {
            assert.equal(opened, true);
            return { title: "wechat", generation };
          });
        return new ConfigurationOperations(bind(), port, async () => bind());
      },
      closeConfiguration: async () => {
        opened = false;
      },
    },
  };
}
function load(document: BuildStepsDocument): LoadedConfigurationSteps {
  return {
    document: validateConfigurationSteps(document),
    path: "offline",
    sourceSha256: valueHash(document),
    documentSha256: valueHash(document),
  };
}

test("v2 stage JSON executes ordered operations and finally restores across a verified reopening", async () => {
  const f = fixture(),
    result = await runConfigurationSteps(load(doc()), f.env);
  assert.equal(result.outcome, "passed");
  assert.equal(result.cases[0].restoration, "passed");
  assert.equal(f.joined(), false);
  assert.equal(f.changes(), 2);
  assert.equal(result.buildSubmitted, false);
});

test("stage assertion failure restores then continues; failed recovery stops following cases", async () => {
  const document = doc();
  const check = document.cases[0].steps.find((s) => s.op === "assert" && s.check === "stages")!;
  if (check.op === "assert" && check.check === "stages")
    check.expected.groups = [["build"], ["run"]];
  document.cases.push({ ...structuredClone(doc().cases[0]), caseId: "second" });
  const f = fixture(),
    result = await runConfigurationSteps(load(document), f.env);
  assert.equal(result.cases[0].outcome, "failed");
  assert.equal(result.cases[0].restoration, "passed");
  assert.equal(result.cases[1].outcome, "passed");
  assert.equal(f.joined(), false);
  const bad = fixture(true),
    stopped = await runConfigurationSteps(load(document), bad.env);
  assert.equal(stopped.stopped, true);
  assert.equal(stopped.cases[0].restoration, "failed");
  assert.equal(stopped.cases[1].outcome, "skipped");
  assert.equal(bad.changes(), 1);
});

test("v2 rejects unrecorded writes, stale stage snapshots and missing recovery before connecting", () => {
  const missingRecord = doc();
  missingRecord.cases[0].steps.splice(1, 1);
  assert.throws(() => validateConfigurationSteps(missingRecord), /修改前须引用/);
  const stale = doc();
  stale.cases[0].steps.splice(4, 0, {
    id: "detach",
    op: "stage.unlink",
    page: "page",
    record: "original",
    group: "build",
    stage: "run",
  });
  assert.throws(() => validateConfigurationSteps(stale), /未过期/);
  const missingRecovery = doc();
  missingRecovery.cases[0].finally.splice(1, 1);
  assert.throws(() => validateConfigurationSteps(missingRecovery), /finally 恢复/);
  assert.throws(
    () => assertBuildOnly({ groups: [["build", "publish"]] } as StageView),
    /仅构建用例不能提交/,
  );
});

test("recovery restores a disabled trailing group through the available build group without executing stages", async () => {
  const f = fixture();
  let state = "separate";
  const states: Record<string, string[][]> = {
    separate: [["build"], ["make"], ["run"]],
    tail: [["build"], ["make", "run"]],
    all: [["build", "make", "run"]],
    prefix: [["build", "make"], ["run"]],
  };
  const transitions: Record<string, string> = {
    "separate/link/make/run": "tail",
    "tail/link/build/make": "all",
    "all/unlink/build/run": "prefix",
    "prefix/unlink/build/make": "separate",
  };
  const actions: string[] = [];
  f.port.readStages = async () => {
    const groups = states[state];
    return {
      groups: structuredClone(groups),
      visible: ["build", "make", "run"],
      buttons: groups.map((g) => ({ stage: g[0], label: g.join(" "), disabled: g[0] !== "build" })),
      links: groups.slice(1).map((g, i) => ({
        previous: groups[i][0],
        stage: g[0],
        disabled: false,
        selector: "offline",
      })),
      unlinks: groups.flatMap((g) =>
        g.slice(1).map((s) => ({ group: g[0], stage: s, selector: "offline" })),
      ),
    };
  };
  f.port.changeStage = async (kind, anchor, stage) => {
    const key = [state, kind, anchor, stage].join("/");
    assert.ok(transitions[key], "unexpected external UI action: " + key);
    actions.push(key);
    state = transitions[key];
  };
  const operations = await f.env.openConfiguration("windows"),
    record = await operations.stages.record();
  await operations.stages.change(record, "link", "make", "run");
  await assert.rejects(operations.stages.change(record, "unlink", "make", "run"), /禁用阶段按钮内/);
  await operations.stages.restore(record);
  assert.equal(state, "separate");
  assert.deepEqual(actions, [
    "separate/link/make/run",
    "tail/link/build/make",
    "all/unlink/build/run",
    "prefix/unlink/build/make",
  ]);
});

test("external stage edits stop restoration rather than overwriting an unowned relation", async () => {
  const f = fixture(),
    operations = await f.env.openConfiguration("wechatgame");
  const record = await operations.stages.record();
  await operations.stages.change(record, "link", "build", "run");
  f.externalUnlink();
  await assert.rejects(operations.stages.restore(record), (error: Error) => {
    assert.match(error.message, /恢复失败/);
    assert.match((error.cause as Error).message, /本例之外/);
    return true;
  });
  assert.equal(f.changes(), 1);
});
