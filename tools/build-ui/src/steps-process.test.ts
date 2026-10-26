import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

for (const mode of ["signal", "launcher-death"]) {
  test(`supervised worker completes stop handling after ${mode}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "pink-stop-process-"));
    const done = join(root, "done.json"),
      worker = join(root, "worker.mjs"),
      parent = join(root, "parent.mjs");
    await writeFile(
      worker,
      `
      import { ExecutionStop } from ${JSON.stringify(new URL("./execution-stop.js", import.meta.url).href)};
      import { writeFileSync } from 'node:fs';
      const stop = new ExecutionStop().listen();
      process.on('exit', code => writeFileSync(${JSON.stringify(done)}, JSON.stringify({ ...stop.requestInfo, exitCode: code })));
      const hold = setInterval(() => {}, 50);
      const timeout = setTimeout(() => process.exit(2), 6000);
      stop.subscribe(async () => {
        console.log('recovery completed after launcher stop');
        clearInterval(hold); clearTimeout(timeout); stop.dispose();
        if (process.connected) process.disconnect();
      });
      console.log('worker-ready');
    `,
    );
    await writeFile(
      parent,
      `
      import { superviseSteps } from ${JSON.stringify(new URL("./steps-process.js", import.meta.url).href)};
      process.on('message', () => process.emit('SIGINT'));
      process.exitCode = await superviseSteps(${JSON.stringify(worker)}, []);
      if (process.connected) process.disconnect();
    `,
    );
    const p = spawn(process.execPath, [parent], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    let stderr = "";
    p.stderr!.on("data", (data) => {
      stderr += String(data);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Worker not ready: " + stderr)), 5000);
        p.once("error", reject);
        p.stdout!.on("data", (data) => {
          if (String(data).includes("worker-ready")) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      if (mode === "launcher-death") p.kill();
      else p.send({ stop: true });
      let result: { source: string; exitCode: number } | undefined;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        result = await readFile(done, "utf8")
          .then((v) => JSON.parse(v))
          .catch(() => undefined);
        if (result) break;
        await delay(30);
      }
      assert.equal(
        result?.source,
        mode === "launcher-death" ? "parent-disconnect" : "supervisor",
        stderr,
      );
      assert.equal(result?.exitCode, 0);
    } finally {
      if (p.connected) p.disconnect();
      assert.equal(dirname(root), tmpdir());
      await rm(root, { recursive: true });
    }
  });
}
