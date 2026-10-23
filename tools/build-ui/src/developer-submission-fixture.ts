// Developer-only runner boundary fixture; never writes SDK, product tasks or verdicts.
import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Builder } from "./builder.js";
import { readRunConfiguration } from "./offline-plan.js";
import {
  submissionIds,
  submissionModes,
  submissionRevision,
} from "./developer-submission-selfcheck.js";

const index = process.argv.indexOf("--run-config");
assert.ok(index > 0);
const config = await readRunConfiguration(process.argv[index + 1]);
const directory = dirname(process.argv[index + 1]);
const fixture = JSON.parse(readFileSync(join(directory, "submission-fixture.json"), "utf8"));
assert.equal(fixture.revision, submissionRevision);
assert.ok(submissionModes.includes(fixture.mode));
assert.equal(config.project, fixture.project);
assert.equal(config.casesFile, fixture.casesFile);
assert.deepEqual(config.caseIds, submissionIds(fixture.mode));
const pkg = JSON.parse(readFileSync(join(fixture.project, "package.json"), "utf8"));
assert.equal(pkg.name, "pink-build-developer-selfcheck");
assert.equal(pkg.pink.uuid, "ce183a71-c08d-40cf-bdc6-e41f59893d20");
const ledger = join(directory, "actions.jsonl");
function record(kind: string, values: object = {}) {
  appendFileSync(
    ledger,
    JSON.stringify({ kind, mode: fixture.mode, at: Date.now(), ...values }) + "\n",
  );
}
let clicks = 0,
  injected = false;
const click = Builder.prototype.click;
Builder.prototype.click = async function (...args) {
  if (args[0] !== "button" || args[1] !== "构建") return click.apply(this, args);
  record("build-attempt", { number: ++clicks });
  // Protective limit: a second attempt fails the selfcheck; never deliver another build.
  if (clicks !== 1) throw new Error("开发自检保护：出现第二次构建尝试，自检失败");
  const view = await this.readConfiguration(["debug"]);
  assert.equal(view.outputName, fixture.names[0], "只能点击本项故障载体，不能点击后项");
  const at = await click.apply(this, args);
  record("click-delivered", { clickedAt: at });
  if (fixture.mode === "response") {
    injected = true;
    record("fixture", { source: "runner-return-after-real-click" });
    throw new Error("开发自检：构建点击已执行但调用响应不明；禁止自动重试");
  }
  return at;
};

const latest = Builder.prototype.latestSnapshot;
Builder.prototype.latestSnapshot = async function (...args) {
  const snapshot = await latest.apply(this, args);
  if (!snapshot || fixture.mode === "response") return snapshot;
  const copy = structuredClone(snapshot);
  const matching = copy.tasks.filter(
    (t) => t.platform === "web-desktop" && t.outputName === fixture.names[0],
  );
  if (!matching.length) return copy;
  assert.equal(matching.length, 1, "产品真实多任务不是本夹具的预期");
  const task = matching[0];
  const synthetic = `developer-synthetic:${task.id}`;
  if (fixture.mode === "none") copy.tasks = copy.tasks.filter((t) => t.id !== task.id);
  else copy.tasks.push({ ...structuredClone(task), id: synthetic });
  if (!injected) {
    injected = true;
    record("fixture", {
      source: "runner-observation-copy",
      ...(fixture.mode === "none"
        ? { hiddenIds: [task.id], visibleMatches: 0 }
        : { candidateIds: [task.id, synthetic], visibleMatches: 2 }),
    });
  }
  return copy;
};
