import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Builder } from "./builder.js";
import { createStepBuildPort } from "./build-steps-runtime.js";
import { ExecutionContext } from "./configuration-context.js";
import { ConfigurationOperations, type ConfigurationPort } from "./configuration-operations.js";
import type { CaseValue } from "./finalized-cases.js";
import { waitFor, type Task } from "./common.js";

test("runtime adapter captures mandatory UI identity and resolves real scene metadata without launching PinK", async () => {
  const project = await mkdtemp(join(tmpdir(), "pink-step-capture-"));
  let runtime: Awaited<ReturnType<typeof createStepBuildPort>> | undefined;
  try {
    await mkdir(join(project, "assets"));
    await writeFile(join(project, "assets/a.scene"), "{}");
    await writeFile(join(project, "assets/a.scene.meta"), '{"uuid":"scene-A"}');
    const identity = { executable: "offline.exe", project, windowId: 1 };
    const session = new ExecutionContext(identity, async () => identity);
    const values: Record<string, CaseValue> = {
      name: "QA",
      buildPath: "project://build",
      outputName: "mobile",
      startScene: "scene-A",
      scenes: ["db://assets/a.scene"],
      debug: false,
      "packages.web-mobile.orientation": "portrait",
    };
    const port: ConfigurationPort = {
      inspect: async (field) => ({
        value: structuredClone(values[field]),
        kind: Array.isArray(values[field])
          ? "array"
          : typeof values[field] === "boolean"
            ? "boolean"
            : "string",
        selector: "offline",
        disabled: false,
      }),
      read: async (field) => (await port.inspect(field))!,
      set: async () => assert.fail("capture is read-only"),
      restoreControl: async () => assert.fail("capture is read-only"),
      alerts: async () => [],
      primaryBuildEnabled: async () => true,
      reopen: async () => assert.fail("no UI"),
      cancelFileChoice: async () => assert.fail("no UI"),
    };
    const bind = () =>
      session.bind("web-mobile", "mobile", 1, async () => ({ title: "mobile", generation: 1 }));
    const operations = new ConfigurationOperations(bind(), port, async () => bind());
    let observedKeys: string[] = [];
    // These are external page observations. The capture, scene lookup and snapshot verification are real.
    const builder = {
      caseDom: async () => ({ groups: [["build"]] }),
      installProbe: async (_a: unknown, _b: unknown, keys: string[]) => {
        observedKeys = keys;
      },
      baseline: async () => [],
      latestSnapshot: async () => ({ at: 1, tasks: [] }),
      readConfiguration: async () => ({
        name: "QA",
        buildPath: "build",
        outputName: "mobile",
        startScene: "a",
        startSceneId: "scene-A",
        debug: false,
        selectedScenes: ["a"],
        fields: { debug: false },
      }),
    } as unknown as Builder;
    runtime = await createStepBuildPort(
      builder,
      session,
      project,
      ["packages.web-mobile.orientation"],
      new AbortController().signal,
    );
    const capture = await runtime.port.capture(operations, ["packages.web-mobile.orientation"]);
    assert.deepEqual(capture.values, {
      name: "QA",
      buildPath: "project://build",
      outputName: "mobile",
      startScene: "scene-A",
      scenes: ["scene-A"],
      debug: false,
      "packages.web-mobile.orientation": "portrait",
    });
    assert.ok(
      observedKeys.includes("scenes") && observedKeys.includes("packages.web-mobile.orientation"),
    );
    values.scenes = ["db://assets/missing.scene"];
    await assert.rejects(
      runtime.port.capture(operations, ["packages.web-mobile.orientation"]),
      /当前工程资源/,
    );
    builder.caseDom = async () => ({ groups: [["build", "run"]] }) as never;
    await assert.rejects(runtime.port.capture(operations, ["name"]), /仅构建用例不能提交显式串联/);
  } finally {
    await runtime?.stop();
    assert.equal(dirname(project), tmpdir());
    await rm(project, { recursive: true });
  }
});

test("cross-category runtime establishes one baseline and routes clicks/cards without recreating observers", async () => {
  const project = await mkdtemp(join(tmpdir(), "pink-step-categories-"));
  let runtime: Awaited<ReturnType<typeof createStepBuildPort>> | undefined;
  try {
    await mkdir(join(project, "assets"));
    const identity = { executable: "offline.exe", project, windowId: 1 };
    const session = new ExecutionContext(identity, async () => identity);
    const events: string[] = [];
    const historical: Task = { id: "old", platform: "web-desktop", state: "success", progress: 1 };
    let latest = { at: 1, tasks: [historical] };
    const binding = (category: string, platform: string) => ({
      platforms: [platform],
      activate: async () => {
        events.push(`activate:${category}`);
      },
      builder: {
        caseDom: async () => ({ groups: [["build"]] }),
        installProbe: async () => {
          events.push(`probe:${category}`);
        },
        baseline: async () => {
          events.push(`baseline:${category}`);
          return [historical];
        },
        latestSnapshot: async () => latest,
        click: async (
          _a: unknown,
          _b: unknown,
          _c: unknown,
          _d: unknown,
          verify: () => Promise<void>,
        ) => {
          await verify();
          events.push(`click:${category}`);
          return Date.now();
        },
        revealTask: async (task: Task) => {
          events.push(`card:${category}:${task.id}`);
        },
        successText: async () => true,
      } as unknown as Builder,
    });
    const device = binding("X-Device", "web-desktop"),
      application = binding("X-Application", "wechatgame");
    runtime = await createStepBuildPort(
      [device, application],
      session,
      project,
      ["name"],
      new AbortController().signal,
    );
    assert.deepEqual(events, [
      "activate:X-Device",
      "probe:X-Device",
      "baseline:X-Device",
      "activate:X-Application",
      "probe:X-Application",
      "baseline:X-Application",
    ]);
    assert.deepEqual([...runtime.port.baselineIds], ["old"]);
    const task = { ...historical, id: "new", platform: "wechatgame", outputName: "wechat" };
    latest = { at: 2, tasks: [historical, task] };
    await waitFor(
      "跨分类任务观察",
      async () => runtime!.port.source.get("new"),
      1000,
      runtime.port.signal,
    );
    await runtime.port.click({ platform: "wechatgame" } as ConfigurationOperations, () =>
      session.verify(),
    );
    await runtime.port.assertCard(task);
    assert.deepEqual(events.slice(-3), [
      "click:X-Application",
      "activate:X-Application",
      "card:X-Application:new",
    ]);
    assert.equal(events.filter((e) => e.startsWith("baseline:")).length, 2);
    application.builder.caseDom = async () => ({ groups: [["build", "run"]] }) as never;
    const clicksBefore = events.filter((e) => e.startsWith("click:")).length;
    await assert.rejects(
      runtime.port.click({ platform: "wechatgame" } as ConfigurationOperations, async () => {}),
      /仅构建用例不能提交显式串联/,
    );
    assert.equal(events.filter((e) => e.startsWith("click:")).length, clicksBefore);
    await assert.rejects(
      async () =>
        runtime!.port.click({ platform: "unbound" } as ConfigurationOperations, async () => {}),
      /缺少构建分类/,
    );
    await runtime.stop();
    runtime = undefined;
    application.builder.baseline = async () => [];
    await assert.rejects(
      createStepBuildPort(
        [device, application],
        session,
        project,
        [],
        new AbortController().signal,
      ),
      /完整任务基线不一致/,
    );
  } finally {
    await runtime?.stop();
    assert.equal(dirname(project), tmpdir());
    await rm(project, { recursive: true });
  }
});
