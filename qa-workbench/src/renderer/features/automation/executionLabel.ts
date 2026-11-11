import type { AutomationProgress } from "../../../shared/automation";
import type { ExecutionPreview } from "../../../shared/execution";

export function executionModeLabel(
  mode?: ExecutionPreview["executionMode"],
  reportOnly = false,
) {
  return reportOnly
    ? "预检报告"
    : mode === "build"
      ? "真实构建"
      : "真实配置检查";
}

export const automationStages: Record<string, string> = {
  configuring: "检查配置",
  submitting: "提交构建",
  queued: "等待构建",
  building: "正在构建",
  checking: "核对结果",
  restoring: "恢复配置",
  cleanup: "整理现场",
};

// Display individual outcomes without changing the executor's overall result.
export function executionLabel(
  progress?: AutomationProgress,
  stopped = false,
): string {
  if (!progress) return "未完整完成";
  const { failed, blocked, stopped: stoppedCases } = progress.summary;
  const parts = [
    progress.issues.fatal ? "运行异常" : "",
    failed ? `失败 ${failed}` : "",
    blocked ? `受阻 ${blocked}` : "",
    stoppedCases ? `已停止 ${stoppedCases}` : stopped ? "已停止" : "",
  ].filter(Boolean);
  if (parts.length) return parts.join(" · ");
  return progress.outcome === "passed" ? "通过" : "未完整完成";
}
