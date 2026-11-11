import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, copyFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConfigurationSteps } from "./configuration-steps-contract.js";
import { getExecutorIdentity } from "./native-case-contract.js";
import { sealPlan } from "./plan-integrity.js";
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
    assert.deepEqual(plan.executor, await getExecutorIdentity());
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
    assert.ok(multi.steps.execution.groups);
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

test("cached contracts and fresh CLI reject a changed runtime dependency and require a new preview", async () => {
  const directory = dirname(fileURLToPath(import.meta.url));
  const root = await mkdtemp(join(directory, "executor-identity-fixture-"));
  const exec = promisify(execFile);
  try {
    const identity = await getExecutorIdentity();
    await Promise.all(
      identity.files.map(([name]) => copyFile(join(directory, name), join(root, name))),
    );
    await mkdir(join(root, "resources/app"), { recursive: true });
    await mkdir(join(root, "project"));
    await writeFile(join(root, "PinK.exe"), "offline identity only; never launched");
    await writeFile(join(root, "resources/app/product.json"), '{"pinkVersion":"fixture"}');
    await writeFile(join(root, "project/package.json"), "{}");
    const cli = join(root, "configuration-steps-cli.js");
    const file = fileURLToPath(
      new URL("../fixtures/configuration-steps/build-v2-basic.json", import.meta.url),
    );
    const results = join(root, "results");
    const args = [
      "--file",
      file,
      "--pink",
      root,
      "--project",
      join(root, "project"),
      "--results",
      results,
    ];
    const preview = join(root, "preview.json");
    await exec(process.execPath, [cli, ...args, "--preview", "--output", preview]);
    const plan = JSON.parse(await readFile(preview, "utf8"));
    assert.deepEqual(plan.executor, identity);
    await exec(process.execPath, [cli, ...args, "--check-plan", "--expected-plan", preview]);

    const legacyBody = { ...plan };
    delete legacyBody.executor;
    delete legacyBody.integrity;
    const legacy = join(root, "legacy.json");
    await writeFile(legacy, JSON.stringify(sealPlan(legacyBody)));
    await assert.rejects(
      exec(process.execPath, [cli, ...args, "--check-plan", "--expected-plan", legacy]),
      /旧预览计划缺少执行器身份/,
    );

    await exec(process.execPath, [
      "--input-type=module",
      "--eval",
      `import assert from 'node:assert/strict';
       import { readFile, writeFile, appendFile } from 'node:fs/promises';
       const contract = await import(${JSON.stringify(pathToFileURL(join(root, "native-case-contract.js")).href)});
       const startup = await import(${JSON.stringify(pathToFileURL(join(root, "configuration-steps-startup.js")).href)});
       const loaded = await contract.getExecutorIdentity();
       const cases = await contract.loadNativeCases(${JSON.stringify(file)});
       const preview = JSON.parse(await readFile(${JSON.stringify(preview)}, 'utf8'));
       await writeFile(${JSON.stringify(join(root, "unexecuted.test.js"))}, '// not part of runtime');
       await contract.verifyExecutorIdentity(loaded);
       await assert.rejects(contract.verifyExecutorIdentity({...loaded, capabilityVersion: 'unknown'}), /执行器身份/);
       await appendFile(${JSON.stringify(join(root, "build-task-values.js"))}, '\\n// offline dependency change\\n');
       await assert.rejects(contract.getExecutorIdentity(), /重新加载/);
       await assert.rejects(contract.verifyExecutorIdentity(loaded), /重新加载/);
       await assert.rejects(startup.runConfigurationStepsFromStartup(cases, preview), /重新加载/);`,
    ]);
    assert.equal(
      await readFile(cli, "utf8"),
      await readFile(join(directory, "configuration-steps-cli.js"), "utf8"),
    );
    await assert.rejects(
      exec(process.execPath, [cli, ...args, "--check-plan", "--expected-plan", preview]),
      /执行器身份与预览计划不符/,
    );
    const refreshed = join(root, "refreshed.json");
    await exec(process.execPath, [cli, ...args, "--preview", "--output", refreshed]);
    assert.notEqual(
      JSON.parse(await readFile(refreshed, "utf8")).executor.implementationSha256,
      identity.implementationSha256,
    );
    await exec(process.execPath, [cli, ...args, "--check-plan", "--expected-plan", refreshed]);
    await assert.rejects(stat(results), { code: "ENOENT" });
  } finally {
    assert.equal(dirname(root), directory);
    await rm(root, { recursive: true });
  }
});
