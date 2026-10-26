import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { catalogToSteps } from "./catalog-to-steps.js";
import { loadCatalogSteps } from "./catalog-steps-loader.js";
import { fileURLToPath } from "node:url";
import { superviseSteps } from "./steps-process.js";
import { ExecutionStop } from "./execution-stop.js";
import { configurationStepsPlan, loadConfigurationSteps } from "./configuration-steps-contract.js";
import {
  configurationStepsLaunchPlan,
  verifyConfigurationStepsPlan,
  runConfigurationStepsFromStartup,
} from "./configuration-steps-startup.js";

/** File-only calls remain offline; real execution requires explicit --run and a matching plan. */
async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: "string" },
      catalog: { type: "string" },
      cases: { type: "string" },
      groups: { type: "string" },
      materials: { type: "string" },
      output: { type: "string" },
      pink: { type: "string" },
      project: { type: "string" },
      port: { type: "string", default: "9222" },
      results: { type: "string", default: "results" },
      "configuration-timeout": { type: "string", default: "120" },
      run: { type: "boolean" },
      preview: { type: "boolean" },
      "check-plan": { type: "boolean" },
      "expected-plan": { type: "string" },
    },
  });
  if (!!values.file === !!values.catalog)
    throw new Error("需要且仅能选择 --file <steps.json> 或 --catalog <四组.json>");
  if (
    values.catalog &&
    !values.run &&
    !values.preview &&
    !values["check-plan"] &&
    !values["expected-plan"] &&
    !values.pink
  ) {
    const plan = await catalogToSteps(values.catalog, {
      project: values.project,
      materials: values.materials,
      cases: values.cases,
      groups: values.groups,
    });
    const json = JSON.stringify(plan, null, 2) + "\n";
    if (values.output) await writeFile(values.output, json, { flag: "wx" });
    else process.stdout.write(json);
    return;
  }
  if (!values.catalog && (values.cases || values.groups))
    throw new Error("cases/groups 仅用于 catalog 选择；步骤文件的顺序由文件决定");
  if ([values.run, values.preview, values["check-plan"]].filter(Boolean).length > 1)
    throw new Error("run/preview/check-plan 不能混用");
  if (
    values.run &&
    !(process.env.PINK_BUILD_STEPS_WORKER === "1" && typeof process.send === "function")
  ) {
    process.exitCode = await superviseSteps(fileURLToPath(import.meta.url), process.argv.slice(2));
    return;
  }
  const stop = values.run ? new ExecutionStop().listen() : undefined;
  try {
    const loaded = values.catalog
      ? await loadCatalogSteps(values.catalog, {
          project: values.project,
          materials: values.materials,
          cases: values.cases,
          groups: values.groups,
        })
      : await loadConfigurationSteps(values.file!, {
          project: values.project,
          materials: values.materials,
        });
    if (values.run || values.preview || values["check-plan"]) {
      if (!values.pink || !values.project) throw new Error("步骤启动计划需要指定 pink 和 project");
      const plan = await configurationStepsLaunchPlan(loaded, {
        pink: values.pink,
        project: values.project,
        port: Number(values.port),
        configurationTimeoutMs: Number(values["configuration-timeout"]) * 1000,
        resultsRoot: values.results!,
      });
      if (values.preview) {
        const json = JSON.stringify(plan, null, 2) + "\n";
        if (values.output) await writeFile(values.output, json, { flag: "wx" });
        else process.stdout.write(json);
        return;
      }
      if (values.output) throw new Error("output 仅用于预览");
      if (!values["expected-plan"])
        throw new Error("实际执行或核验必须提供 expected-plan，请先预览");
      await verifyConfigurationStepsPlan(values["expected-plan"], plan);
      if (values["check-plan"]) {
        console.log("步骤计划匹配；未连接 PinK");
        return;
      }
      const result = await runConfigurationStepsFromStartup(loaded, plan, stop);
      if (result.outcome !== "passed") process.exitCode = 1;
      return;
    }
    if (values.pink || values["expected-plan"])
      throw new Error("启动参数需要明确 run/preview/check-plan");
    const plan = configurationStepsPlan(loaded);
    const json = JSON.stringify(plan, null, 2) + "\n";
    if (values.output) await writeFile(values.output, json, { flag: "wx" });
    else process.stdout.write(json);
  } finally {
    stop?.dispose();
  }
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "步骤文件加载失败");
  process.exitCode = 2;
});
