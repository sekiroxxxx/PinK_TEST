import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigurationRunSession } from "./configuration-run-session.js";
import { ExecutionStop } from "./execution-stop.js";

test("ordinary stop leaves owned cleanup live and finalizes each resource and report once", async () => {
  const signalListeners = process.listenerCount("SIGINT");
  const stop = new ExecutionStop().listen();
  try {
    const run = new ConfigurationRunSession(stop);
    const events: string[] = [];
    const builder = {
      close: async () => {
        run.cleanupSignal.throwIfAborted();
        events.push("builder");
      },
    };
    run.ownBrowser({
      close: async () => {
        events.push("connection");
      },
    });
    run.ownContext({
      invalidate: () => {
        events.push("context");
      },
    });
    run.ownBuilder("native", builder);
    run.ownBuilder("native", builder);
    run.ownTaskObserver({
      stop: async () => {
        events.push("observer");
      },
    });
    run.subscribe(() => {
      events.push("stop");
    });
    stop.request("supervisor");
    assert.equal(run.workSignal.aborted, true);
    assert.equal(run.cleanupSignal.aborted, false);
    const finalization = run.finish(async (cleanup) => {
      run.cleanupSignal.throwIfAborted();
      assert.deepEqual(
        cleanup.map((item) => item.resource),
        ["task-observer", "execution-context", "builder-probe:native", "browser-connection"],
      );
      assert.ok(cleanup.every((item) => item.outcome === "passed"));
      events.push("report");
    });
    assert.equal(
      run.finish(async () => {
        assert.fail("duplicate report finalization");
      }),
      finalization,
    );
    await finalization;
    assert.deepEqual(events, ["stop", "observer", "context", "builder", "connection", "report"]);
    assert.equal(run.cleanupSignal.aborted, true);
    assert.equal(process.listenerCount("SIGINT"), signalListeners + 1);
  } finally {
    stop.dispose();
  }
  assert.equal(process.listenerCount("SIGINT"), signalListeners);
});

test("release failures preserve causes, release remaining resources and dispose after a report error", async () => {
  const signalListeners = process.listenerCount("SIGINT");
  const run = new ConfigurationRunSession();
  const events: string[] = [];
  run.ownTaskObserver({
    stop: async () => {
      events.push("observer");
      throw new Error("observer close failed");
    },
  });
  run.ownContext({
    invalidate: () => {
      events.push("context");
    },
  });
  run.ownBuilder("game", {
    close: async () => {
      events.push("builder");
      throw new Error("probe close failed");
    },
  });
  run.ownBrowser({
    close: async () => {
      events.push("connection");
    },
  });
  run.subscribe(() => {
    events.push("late-stop");
  });
  const reportError = new Error("final report write failed");
  await assert.rejects(
    run.finish(async (cleanup) => {
      assert.deepEqual(
        cleanup.filter((item) => item.outcome === "failed").map((item) => item.reason),
        ["observer close failed", "probe close failed"],
      );
      assert.ok(
        cleanup
          .filter((item) => item.outcome === "failed")
          .every((item) => item.diagnostic?.chain.length),
      );
      events.push("report");
      throw reportError;
    }),
    reportError,
  );
  run.stop.request("supervisor");
  assert.deepEqual(events, ["observer", "context", "builder", "connection", "report"]);
  assert.equal(run.cleanupSignal.aborted, true);
  assert.equal(process.listenerCount("SIGINT"), signalListeners);
  await assert.rejects(
    run.finish(async () => {
      assert.fail("report must not retry");
    }),
    reportError,
  );
});
