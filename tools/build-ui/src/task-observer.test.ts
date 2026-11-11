import { test } from "node:test";
import assert from "node:assert/strict";
import { TaskObserver } from "./task-observer.js";
import { observedBuildTask } from "./build-operations.js";
import { ConfigurationOperationError } from "./configuration-context.js";
import { configurationErrorDetail } from "./configuration-diagnostics.js";
import type { Builder } from "./builder.js";
import type { Task, TaskSnapshot } from "./common.js";

const task = (state: string): Task => ({
  id: "owned",
  platform: "vivo-mini-game",
  state,
  progress: state === "success" ? 1 : 0,
  createdAt: 1,
});
const builder = (get: () => TaskSnapshot) =>
  ({ latestSnapshot: async () => get() }) as unknown as Builder;

test("background observation failure retains the source and page diagnostic and never reinstalls it", async () => {
  const failure = new ConfigurationOperationError("task", "probe owner lost", "stop", {
    diagnostic: {
      phase: "task-observer",
      observations: { installedDocument: 10, currentDocument: 11 },
    },
  });
  let reads = 0;
  const observer = new TaskObserver(
    [
      builder(() => {
        reads++;
        throw failure;
      }),
    ],
    [["web-desktop"]],
  );
  observer.start(() => assert.fail("a failed read cannot publish an update"));
  await observer.stop();
  assert.throws(
    () => observer.assertHealthy(),
    (error: unknown) => {
      const detail = configurationErrorDetail(error);
      assert.ok(detail.chain.some((cause) => cause.message === "probe owner lost"));
      assert.ok(
        detail.chain.some(
          (cause) => cause.diagnostic && JSON.stringify(cause.diagnostic).includes("web-desktop"),
        ),
      );
      return true;
    },
  );
  assert.equal(reads, 1);
  assert.deepEqual(observer.tasks(), []);
});

test("an inactive category's delayed waiting response cannot replace the owning category's processing task", async () => {
  let own: TaskSnapshot = {
    at: 20,
    requestSequence: 4,
    tasks: [{ ...task("processing"), observation: { firstSeenAt: 1, processingAt: 18 } }],
  };
  let other: TaskSnapshot = { at: 21, requestSequence: 10, tasks: [task("waiting")] };
  const observer = new TaskObserver(
    [builder(() => other), builder(() => own)],
    [["web-desktop"], ["vivo-mini-game"]],
  );
  await observer.poll();
  assert.equal(observedBuildTask(observer, "owned").state, "processing");
  other = { at: 30, requestSequence: 11, tasks: [task("waiting")] };
  await observer.poll();
  assert.equal(observedBuildTask(observer, "owned").state, "processing");
  own = { at: 31, requestSequence: 5, tasks: [task("success")] };
  await observer.poll();
  assert.equal(observedBuildTask(observer, "owned").state, "success");
});

test("old response sequences are ignored but a confirmed requeue or disappearance still stops", async () => {
  let snapshot: TaskSnapshot = {
    at: 10,
    requestSequence: 3,
    tasks: [{ ...task("processing"), observation: { firstSeenAt: 1, processingAt: 9 } }],
  };
  const observer = new TaskObserver([builder(() => snapshot)], [["vivo-mini-game"]]);
  await observer.poll();
  snapshot = { at: 20, requestSequence: 2, tasks: [task("waiting")] };
  await observer.poll();
  assert.equal(observedBuildTask(observer, "owned").state, "processing");
  snapshot = { at: 10, requestSequence: 4, tasks: [task("success")] };
  await observer.poll();
  assert.equal(observedBuildTask(observer, "owned").state, "success");
  snapshot = { at: 21, requestSequence: 5, tasks: [task("waiting")] };
  await observer.poll();
  assert.throws(() => observedBuildTask(observer, "owned"), /重新排队/);
  snapshot = { at: 22, requestSequence: 6, tasks: [] };
  await observer.poll();
  assert.throws(() => observedBuildTask(observer, "owned"), /完整列表消失/);
});
