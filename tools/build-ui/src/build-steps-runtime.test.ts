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
  } finally {
    await runtime?.stop();
    assert.equal(dirname(project), tmpdir());
    await rm(project, { recursive: true });
  }
});
