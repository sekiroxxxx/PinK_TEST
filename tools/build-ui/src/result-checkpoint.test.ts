import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createResultCheckpoint, CheckpointWriteError } from "./result-checkpoint.js";
import { configurationErrorDetail } from "./configuration-diagnostics.js";

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "pink-checkpoint-"));
  t.after(async () => {
    assert.equal(dirname(root), tmpdir());
    await rm(root, { recursive: true });
  });
  return { root, file: join(root, "result.json") };
}

/** A real Windows reader that permits reads/writes but holds the replacement until released. */
async function withReaderLock(file: string, action: (release: () => void) => Promise<void>) {
  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `
      $stream = [IO.File]::Open($env:PINK_CHECKPOINT_FILE, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
      try { [Console]::WriteLine('locked'); [Console]::ReadLine() | Out-Null }
      finally { $stream.Dispose() }
    `,
    ],
    {
      windowsHide: true,
      env: { ...process.env, PINK_CHECKPOINT_FILE: file },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  let released = false,
    stderr = "";
  child.stderr.on("data", (data) => {
    stderr += String(data);
  });
  const release = () => {
    if (!released) {
      released = true;
      child.stdin.end("\n");
    }
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Reader lock not ready: " + stderr)), 5000);
      child.once("error", reject);
      child.stdout.on("data", (data) => {
        if (String(data).includes("locked")) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    await action(release);
  } finally {
    release();
    await Promise.race([exited, delay(2000)]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await exited;
    }
  }
}

test("checkpoint publishes whole snapshots while an ordinary reader polls the same JSON", async (t) => {
  const { file } = await fixture(t),
    errors: unknown[] = [];
  const checkpoint = createResultCheckpoint(file, (error) => errors.push(error));
  const original = { sequence: -1, cases: [] };
  const first = checkpoint.publish(original);
  original.sequence = -2;
  await first;
  assert.equal(JSON.parse(await readFile(file, "utf8")).sequence, -1);
  let reading = true,
    reads = 0;
  const readErrors: unknown[] = [];
  const reader = (async () => {
    while (reading) {
      try {
        JSON.parse(await readFile(file, "utf8"));
        reads++;
      } catch (error) {
        readErrors.push(error);
      }
    }
  })();
  try {
    for (let sequence = 0; sequence < 50; sequence++)
      await checkpoint.publish({ sequence, cases: [], padding: "x".repeat(60000) });
  } finally {
    reading = false;
    await reader;
  }
  assert.ok(reads > 0);
  assert.deepEqual(readErrors, []);
  assert.deepEqual(errors, []);
  assert.equal(JSON.parse(await readFile(file, "utf8")).sequence, 49);
});

test(
  "Windows replacement waits for a transient reader and preserves the old JSON on a persistent lock",
  { skip: process.platform !== "win32", timeout: 15000 },
  async (t) => {
    const { file } = await fixture(t),
      errors: CheckpointWriteError[] = [];
    const checkpoint = createResultCheckpoint(file, (error) => errors.push(error));
    await checkpoint.publish({ sequence: 0, cases: [] });
    await withReaderLock(file, async (release) => {
      const releaseSoon = setTimeout(release, 80);
      try {
        await checkpoint.publish({ sequence: 1, cases: [] });
      } finally {
        clearTimeout(releaseSoon);
      }
    });
    assert.deepEqual(errors, []);
    assert.equal(JSON.parse(await readFile(file, "utf8")).sequence, 1);
    await withReaderLock(file, async () => {
      await assert.rejects(
        checkpoint.publish({ sequence: 2, cases: [] }),
        (error) =>
          error instanceof CheckpointWriteError &&
          error.phase === "replace-json" &&
          error.systemCode === "EPERM" &&
          error.message.includes("EPERM"),
      );
      assert.equal(JSON.parse(await readFile(file, "utf8")).sequence, 1);
    });
    await checkpoint.drain();
    assert.equal(errors.length, 1);
    await checkpoint.publish({ sequence: 3, cases: [] });
    assert.equal(JSON.parse(await readFile(file, "utf8")).sequence, 3);
  },
);

test("draining includes a late report failure before the final diagnostic snapshot", async (t) => {
  const { root, file } = await fixture(t);
  const data = {
    outcome: "incomplete",
    lifecycle: "stopping",
    cases: [],
    checkpointErrors: [] as unknown[],
  };
  const checkpoint = createResultCheckpoint(file, (error) => {
    data.checkpointErrors.push({
      ...configurationErrorDetail(error),
      phase: error.phase,
      systemCode: error.systemCode,
    });
  });
  // A directory at the HTML output path is a real report-write failure, not a mocked writer.
  await mkdir(join(root, "report.html"));
  const writing = checkpoint.publish(data, true);
  const rejected = assert.rejects(
    writing,
    (error) => error instanceof CheckpointWriteError && error.phase === "render-html",
  );
  await checkpoint.drain();
  await rejected;
  assert.equal(data.checkpointErrors.length, 1);
  await rmdir(join(root, "report.html"));
  data.outcome = "failed";
  data.lifecycle = "finished";
  await checkpoint.publish(data, true);
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.equal(saved.checkpointErrors.length, 1);
  assert.equal(saved.checkpointErrors[0].phase, "render-html");
  assert.match(await readFile(join(root, "report.html"), "utf8"), /检查点发布失败：render-html/);
});
