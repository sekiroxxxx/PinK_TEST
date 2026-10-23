// Loaded only by the developer command's child process through Node --import.
// No product files, persisted tasks, comparison logic or verdicts are replaced.
import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Builder } from "./builder.js";
import { CaseForm } from "./case-form.js";
import { readRunConfiguration } from "./offline-plan.js";
import {
  mismatchIds,
  mismatchRevision,
  terminalMismatchIds,
} from "./developer-mismatch-selfcheck.js";

const index = process.argv.indexOf("--run-config");
assert.ok(index > 0, "差异夹具仅用于带启动配置的开发子进程");
const config = await readRunConfiguration(process.argv[index + 1]);
const directory = dirname(process.argv[index + 1]);
const fixture = JSON.parse(readFileSync(join(directory, "mismatch-fixture.json"), "utf8"));
assert.equal(fixture.revision, mismatchRevision);
assert.equal(config.project, fixture.project);
assert.equal(config.casesFile, fixture.casesFile);
assert.deepEqual(
  config.caseIds,
  fixture.mode === "terminal-only" ? terminalMismatchIds : mismatchIds,
);
const pkg = JSON.parse(readFileSync(join(fixture.project, "package.json"), "utf8"));
assert.equal(pkg.name, "pink-build-developer-selfcheck");
assert.equal(pkg.pink.uuid, "ce183a71-c08d-40cf-bdc6-e41f59893d20");
const ledger = join(directory, "injections.jsonl");
const seen = new Set<string>();
function record(phase: string, source: string, extra: object = {}) {
  if (seen.has(phase)) return;
  seen.add(phase);
  appendFileSync(
    ledger,
    JSON.stringify({
      phase,
      source,
      at: Date.now(),
      field: "debug",
      original: true,
      injected: false,
      ...extra,
    }) + "\n",
  );
}

const set = CaseForm.prototype.set;
CaseForm.prototype.set = async function (...args) {
  const changed = await set.apply(this, args);
  if (
    !seen.has("ui") &&
    args[0] === "debug" &&
    args[1] === true &&
    (await this.read("name")).value === fixture.names[0]
  ) {
    assert.equal((await this.read("debug")).value, true);
    await set.call(this, "debug", false);
    assert.equal((await this.read("debug")).value, false);
    record("ui", "real-UI-input", { name: fixture.names[0] });
  }
  return changed;
};

let finalCollection = false;
const history = Builder.prototype.historySnapshot;
Builder.prototype.historySnapshot = async function (...args) {
  // Arm before requesting fresh history; the background observer can consume that
  // response before historySnapshot returns. Never alter snapshot timestamps.
  const snapshot = await latest.call(this);
  if (
    snapshot?.tasks.some((task) => task.outputName === fixture.names[3] && task.state === "success")
  )
    finalCollection = true;
  return history.apply(this, args);
};

const latest = Builder.prototype.latestSnapshot;
Builder.prototype.latestSnapshot = async function (...args) {
  const observed = await latest.apply(this, args);
  if (!observed) return observed;
  const copy = structuredClone(observed);
  for (const task of copy.tasks) {
    const phase =
      task.outputName === fixture.names[2]
        ? "queued"
        : finalCollection && task.outputName === fixture.names[3]
          ? "terminal"
          : undefined;
    if (!phase) continue;
    assert.equal(task.caseOptions?.debug, true, "只注入已核实为 true 的非敏感观察字段");
    assert.equal(task.options?.debug, true);
    task.caseOptions!.debug = false;
    record(phase, "runner-observation-copy", {
      taskId: task.id,
      outputName: task.outputName,
      realState: task.state,
    });
  }
  return copy;
};
