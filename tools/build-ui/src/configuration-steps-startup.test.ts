import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { loadConfigurationSteps } from "./configuration-steps-contract.js";
import {
  configurationStepsLaunchPlan,
  verifyConfigurationStepsPlan,
} from "./configuration-steps-startup.js";

test("launch plan binds JSON and exact installation/project before any UI connection", async () => {
  const root = await mkdtemp(join(tmpdir(), "pink-steps-startup-"));
  try {
    await mkdir(join(root, "resources/app"), { recursive: true });
    await mkdir(join(root, "project"));
    await writeFile(join(root, "PinK.exe"), "offline-only-file");
    await writeFile(
      join(root, "resources/app/product.json"),
      JSON.stringify({ pinkVersion: "fixture", commit: "fixture" }),
    );
    await writeFile(join(root, "project/package.json"), "{}");
    const loaded = await loadConfigurationSteps(
      new URL("../fixtures/configuration-steps/basic.json", import.meta.url).pathname.replace(
        /^\/(\w:)/,
        "$1",
      ),
    );
    const options = {
      pink: root,
      project: join(root, "project"),
      port: 9222,
      configurationTimeoutMs: 120000,
      resultsRoot: join(root, "results"),
    };
    const plan = await configurationStepsLaunchPlan(loaded, options),
      file = join(root, "plan.json");
    await writeFile(file, JSON.stringify(plan));
    await verifyConfigurationStepsPlan(file, plan);
    assert.equal(plan.runtimeVerified, false);
    assert.equal(plan.buildSubmitted, false);
    const multiFile = join(root, "multi.json");
    await writeFile(
      multiFile,
      JSON.stringify({
        kind: "pink-configuration-steps",
        schemaVersion: 2,
        cases: ["web-desktop", "wechatgame"].map((platform) => ({
          caseId: `case.${platform}`,
          platform,
          steps: [
            { id: "page", op: "config.open" },
            { id: "close", op: "config.close", page: "page" },
          ],
          finally: [
            { id: "cleanup", op: "config.open" },
            { id: "cleanupClose", op: "config.close", page: "cleanup" },
          ],
        })),
      }),
    );
    const multi = await configurationStepsLaunchPlan(
      await loadConfigurationSteps(multiFile),
      options,
    );
    assert.equal(multi.steps.execution?.maxTasksPerGroup, 2);
    assert.deepEqual(multi.steps.execution?.groups[0].caseIds, [
      "case.web-desktop",
      "case.wechatgame",
    ]);
    await assert.rejects(verifyConfigurationStepsPlan(file, multi), /不符/);
    await assert.rejects(
      verifyConfigurationStepsPlan(
        file,
        await configurationStepsLaunchPlan(loaded, { ...options, port: 9333 }),
      ),
      /不符/,
    );
    const changed = await loadConfigurationSteps(
      new URL("../fixtures/configuration-steps/edited.json", import.meta.url).pathname.replace(
        /^\/(\w:)/,
        "$1",
      ),
    );
    await assert.rejects(
      verifyConfigurationStepsPlan(file, await configurationStepsLaunchPlan(changed, options)),
      /不符/,
    );
    await writeFile(
      file,
      JSON.stringify({ ...plan, startup: { ...plan.startup, project: "changed" } }),
    );
    await assert.rejects(verifyConfigurationStepsPlan(file, plan), /不符/);
  } finally {
    assert.equal(dirname(root), tmpdir());
    await rm(root, { recursive: true });
  }
});
