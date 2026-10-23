import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { selectAcceptanceCases } from "./acceptance-cases.js";

test("acceptance covers 18 debug/release entries and eight platform variants/returns without duplicate submissions", () => {
  const cases = selectAcceptanceCases();
  assert.equal(cases.length, 52);
  assert.equal(new Set(cases.map((c) => c.caseId)).size, 52);
  assert.equal(new Set(cases.map((c) => c.platform)).size, 18);
  for (const phase of ["debug", "release"]) {
    assert.equal(cases.filter((c) => c.caseId.startsWith(`acceptance.${phase}.`)).length, 18);
  }
  for (const item of cases) {
    assert.equal(new Set(item.writes.map((w) => w.key)).size, item.writes.length);
    assert(!item.caseId.startsWith("existing."));
    assert(!item.caseId.startsWith("planned."));
  }
});

test("desktop compression and Source Map states share the same builds", () => {
  const cases = selectAcceptanceCases();
  const release = cases.find((c) => c.caseId === "acceptance.release.web-desktop")!;
  const variant = cases.find((c) => c.caseId === "acceptance.variant.web-desktop")!;
  const returned = cases.find((c) => c.caseId === "acceptance.return.web-desktop")!;
  assert.equal(release.expected.sourceMaps, "false");
  assert.equal(release.expected.mainBundleCompressionType, "none");
  assert.equal(release.expected.mangleProperties, true);
  assert.equal(variant.expected.sourceMaps, "true");
  assert.equal(variant.expected.mainBundleCompressionType, "merge_dep");
  assert.equal(variant.expected.mangleProperties, false);
  assert.equal(returned.expected.sourceMaps, "inline");
  assert.equal(returned.expected.mainBundleCompressionType, "merge_all_json");
});

test("ordinary encrypted targets accept either initial side; return checks retain explicit initial requirements", () => {
  const cases = selectAcceptanceCases();
  for (const id of ["android", "windows", "ohos", "harmonyos-next"]) {
    const item = cases.find((c) => c.caseId === `acceptance.release.${id}`)!;
    assert.equal(item.purpose, "target");
    assert.equal(item.initialSpecial, undefined);
    assert.equal(item.hiddenAtStart, undefined);
    assert.equal(item.specials.find((f) => f.key === `packages.${id}.encrypted`)?.expected, true);
  }
  const oppo = cases.find((c) => c.caseId === "acceptance.return.oppo-mini-game")!;
  assert.equal(oppo.purpose, "transition");
  assert.equal(oppo.initialSpecial?.["packages.oppo-mini-game.separateEngine"], true);
  assert.equal(oppo.specials.find((f) => f.key.endsWith(".separateEngine"))?.expected, false);
  assert.deepEqual(oppo.requiresInitialFrom, ["acceptance.variant.oppo-mini-game"]);
});

test("Taobao keeps Wasm compression while merging hidden global-adapter transitions", () => {
  const cases = selectAcceptanceCases();
  const release = cases.find((c) => c.caseId === "acceptance.release.taobao-mini-game")!;
  assert.equal(release.expected.nativeCodeBundleMode, "asmjs");
  const variant = cases.find((c) => c.caseId === "acceptance.variant.taobao-mini-game")!;
  const returned = cases.find((c) => c.caseId === "acceptance.return.taobao-mini-game")!;
  assert.equal(variant.expected.nativeCodeBundleMode, "wasm");
  assert.equal(variant.expected.wasmCompressionMode, true);
  assert.equal(variant.initialSpecial?.["packages.taobao-mini-game.globalAdapter"], false);
  assert.deepEqual(variant.hiddenAtEnd, ["packages.taobao-mini-game.globalVariable"]);
  assert.equal(returned.expected.nativeCodeBundleMode, "asmjs");
  assert.deepEqual(returned.hiddenAtStart, ["packages.taobao-mini-game.globalVariable"]);
  assert.equal(returned.specials.find((f) => f.key.endsWith(".globalVariable"))?.expected, "");
});

test("selecting a dependent case never silently adds prerequisite builds", () => {
  const selected = selectAcceptanceCases("acceptance.return.web-mobile");
  assert.equal(selected.length, 1);
  assert.equal(selected[0].purpose, "transition");
  assert.deepEqual(selected[0].requiresInitialFrom, ["acceptance.release.web-mobile"]);
  assert.throws(() => selectAcceptanceCases("planned.public.md5-child-on"));
  assert.throws(() =>
    selectAcceptanceCases("acceptance.return.web-mobile,acceptance.return.web-mobile"),
  );
});

test("offline CLI preview needs no app/project and exports no write inputs", () => {
  const output = execFileSync(
    process.execPath,
    [fileURLToPath(new URL("./cli.js", import.meta.url)), "--plan", "acceptance", "--list-cases"],
    { encoding: "utf8", windowsHide: true },
  );
  const preview = JSON.parse(output);
  assert.equal(preview.count, 52);
  assert.equal(preview.maxTasksPerGroup, 2);
  assert(!output.includes('"input":'));
  const encrypted = preview.cases.find(
    (c: { caseId: string }) => c.caseId === "acceptance.release.android",
  );
  assert.equal(
    encrypted.specials.find((f: { key: string }) => f.key.endsWith(".xxteaKey")).expected,
    "[redacted]",
  );
});
