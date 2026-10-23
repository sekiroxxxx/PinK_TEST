import { parseArgs } from "node:util";
import { writeResultReport } from "./result-report.js";
import { errorMessage } from "./common.js";

async function main() {
  const { values } = parseArgs({ options: { result: { type: "string" } } });
  if (!values.result)
    throw new Error("用法：node dist/report-cli.js --result <result.json 或汇总 JSON>");
  console.log(`报告：${await writeResultReport(values.result)}`);
}
main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 2;
});
