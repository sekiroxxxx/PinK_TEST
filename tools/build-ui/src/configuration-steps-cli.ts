import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
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
  if (!values.file)
    throw new Error(
      "用法：node dist/configuration-steps-cli.js --file <steps.json> [--output <plan.json>]",
    );
  if ([values.run, values.preview, values["check-plan"]].filter(Boolean).length > 1)
    throw new Error("run/preview/check-plan 不能混用");
  const loaded = await loadConfigurationSteps(values.file);
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
    if (!values["expected-plan"]) throw new Error("实际执行或核验必须提供 expected-plan，请先预览");
    await verifyConfigurationStepsPlan(values["expected-plan"], plan);
    if (values["check-plan"]) {
      console.log("步骤计划匹配；未连接 PinK");
      return;
    }
    const result = await runConfigurationStepsFromStartup(loaded, plan);
    if (result.outcome !== "passed") process.exitCode = 1;
    return;
  }
  if (values.pink || values.project || values["expected-plan"])
    throw new Error("启动参数需要明确 run/preview/check-plan");
  const plan = configurationStepsPlan(loaded);
  const json = JSON.stringify(plan, null, 2) + "\n";
  if (values.output) await writeFile(values.output, json, { flag: "wx" });
  else process.stdout.write(json);
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "步骤文件加载失败");
  process.exitCode = 2;
});
