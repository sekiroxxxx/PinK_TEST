import assert from "node:assert/strict";
import { test } from "node:test";
import { assertBuildTaskValues } from "./build-task-values.js";
import type { Task } from "./common.js";

test("queued UUID and terminal db URL must independently resolve to the same project scene", () => {
  const evidence = {
    values: { startScene: "scene-a" },
    preserved: [],
    sceneCandidates: [
      { uuid: "scene-a", path: "db://assets/a.scene" },
      { uuid: "scene-b", path: "db://assets/b.scene" },
    ],
  };
  const task = (startScene: unknown) =>
    ({
      id: "task-scene",
      platform: "web-desktop",
      caseOptions: { startScene, scenes: [{ uuid: "scene-a", url: startScene }] },
    }) as unknown as Task;
  assert.doesNotThrow(() => assertBuildTaskValues(task("scene-a"), evidence));
  assert.doesNotThrow(() => assertBuildTaskValues(task("db://assets/a.scene"), evidence));
  for (const wrong of ["scene-b", "db://assets/b.scene", "db://assets/unknown.scene", undefined])
    assert.throws(() => assertBuildTaskValues(task(wrong), evidence), /startScene/);
  // A task cannot prove an arbitrary URI by claiming the expected UUID in its own scenes.
  assert.throws(
    () => assertBuildTaskValues(task("db://assets/spoofed.scene"), evidence),
    /startScene/,
  );
  assert.throws(
    () =>
      assertBuildTaskValues(task("db://assets/a.scene"), {
        values: evidence.values,
        preserved: [],
      }),
    /startScene/,
  );
  assert.throws(
    () =>
      assertBuildTaskValues(task("scene-a"), {
        ...evidence,
        sceneCandidates: [...evidence.sceneCandidates, { uuid: "duplicate", path: "scene-a" }],
      }),
    /startScene/,
  );
});
