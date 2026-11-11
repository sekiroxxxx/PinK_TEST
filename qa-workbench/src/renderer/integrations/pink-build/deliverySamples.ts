// Read-only delivery evidence. This module is loaded explicitly in development;
// it never starts the executor or creates a new successful test record.
import crossLog from "@pink-delivery/cross-category.stdout.log?raw";
import crossResult from "@pink-delivery/cross-category/2026-10-26T09-00-52.219Z-steps/result.json?raw";
import crossReport from "@pink-delivery/cross-category/2026-10-26T09-00-52.219Z-steps/report.html?raw";
import queueLog from "@pink-delivery/queue-regression-fixed.stdout.log?raw";
import queueResult from "@pink-delivery/queue-regression/2026-10-26T09-08-29.399Z-steps/result.json?raw";
import queueReport from "@pink-delivery/queue-regression/2026-10-26T09-08-29.399Z-steps/report.html?raw";
import remainingLog from "@pink-delivery/remaining.stdout.log?raw";
import remainingResult from "@pink-delivery/remaining/2026-10-26T09-11-49.052Z-steps/result.json?raw";
import remainingReport from "@pink-delivery/remaining/2026-10-26T09-11-49.052Z-steps/report.html?raw";
import blockedLog from "@pink-delivery/blocked.stdout.log?raw";
import blockedResult from "@pink-delivery/blocked/2026-10-26T09-29-57.832Z-steps/result.json?raw";
import blockedReport from "@pink-delivery/blocked/2026-10-26T09-29-57.832Z-steps/report.html?raw";
import {
  ProgressLines,
  readAutomationResult,
} from "../../../shared/automation";

export function deliverySamples() {
  return [
    {
      title: "跨类别构建",
      log: crossLog,
      result: crossResult,
      report: crossReport,
    },
    {
      title: "构建排队与只读检查",
      log: queueLog,
      result: queueResult,
      report: queueReport,
    },
    {
      title: "补充平台构建",
      log: remainingLog,
      result: remainingResult,
      report: remainingReport,
    },
    {
      title: "混合组前提受阻",
      log: blockedLog,
      result: blockedResult,
      report: blockedReport,
    },
  ].map((sample) => {
    const record = readAutomationResult(
      JSON.parse(sample.result),
      "执行侧交付 · 2026-10-26",
      sample.title,
    );
    const events = new ProgressLines().push(sample.log, true);
    if (JSON.stringify(events.at(-1)) !== JSON.stringify(record.progress))
      throw new Error("交付日志与最终结果不一致：" + sample.title);
    return { ...record, events, reportHtml: sample.report };
  });
}
