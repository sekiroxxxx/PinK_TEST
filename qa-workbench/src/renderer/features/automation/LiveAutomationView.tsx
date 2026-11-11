import { useEffect, useState } from "react";
import type { ExecutionDetail } from "../../../shared/execution";
import type { Run } from "../../../shared/model";
import type {
  AutomationProgress,
  RecordedAutomation,
} from "../../../shared/automation";
import {
  automationTargetLabel,
  automationCaseTitle,
} from "../../../shared/automation";
import {
  AutomationRecordView,
  AutomationTasks,
  automationStatus,
  automationPhases,
} from "./AutomationRecordView";
import { automationStages, executionModeLabel } from "./executionLabel";

export function LiveAutomationView({
  id,
  runs,
  back,
  backLabel,
  follow,
  openManual,
}: {
  id: string;
  runs: Run[];
  back: () => void;
  backLabel: string;
  follow: (
    record: RecordedAutomation,
    item: AutomationProgress["cases"][number],
  ) => void;
  openManual: (id: string) => void;
}) {
  const [detail, setDetail] = useState<ExecutionDetail>();
  const [error, setError] = useState("");
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    let live = true,
      timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const value = await window.qa.readAutomation(id);
        if (!live) return;
        setDetail(value);
        setError("");
        if (["starting", "running", "stopping"].includes(value.status))
          timer = setTimeout(read, 800);
      } catch (error) {
        if (live) {
          setError(String(error));
          timer = setTimeout(read, 2000);
        }
      }
    }
    void read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id]);
  const active =
    !!detail && ["starting", "running", "stopping"].includes(detail.status);
  async function stop() {
    setStopping(true);
    try {
      await window.qa.stopAutomation(id);
    } catch (error) {
      setError(String(error));
      setStopping(false);
    }
  }
  async function openFolder() {
    try {
      await window.qa.openAutomationDirectory(id);
    } catch (error) {
      setError(String(error));
    }
  }
  return (
    <>
      {detail?.record ? (
        <AutomationRecordView
          record={detail.record}
          runs={runs}
          back={back}
          backLabel={backLabel}
          local
          executionMode={detail.preview.executionMode}
          openFolder={() => void openFolder()}
          follow={(item) => follow(detail.record!, item)}
          openManual={openManual}
        />
      ) : (
        <section className="automation-record" data-page="automation-run">
          <button className="text-button" onClick={back}>
            ← {backLabel}
          </button>
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                本机执行 ·{" "}
                {executionModeLabel(
                  detail?.preview.executionMode,
                  detail?.preview.reportOnly,
                )}
              </p>
              <h1>{detail?.preview.title || "正在读取本轮执行"}</h1>
              <p>
                {detail?.preview.version} ·{" "}
                {detail ? new Date(detail.startedAt).toLocaleString() : ""}
              </p>
            </div>
            <div className="toolbar">
              <button disabled={!detail} onClick={() => void openFolder()}>
                打开本轮文件夹
              </button>
              {active && (
                <button
                  disabled={stopping || detail.status === "stopping"}
                  onClick={() => void stop()}
                >
                  {stopping || detail.status === "stopping"
                    ? "正在安全停止…"
                    : "安全停止"}
                </button>
              )}
            </div>
          </div>
          <p role="status">
            {!detail
              ? error
                ? "尚未读取到本轮状态，请恢复连接后重试。"
                : "正在读取本轮执行状态…"
              : stopping || detail.status === "stopping"
                ? "正在等待已提交任务收尾，并按用例定义恢复配置，请勿关闭执行器。"
                : detail.status === "starting"
                  ? detail.preview.reportOnly
                    ? "正在生成预检报告，不连接编辑器或提交构建…"
                    : "正在启动独立执行器，等待正式进度…"
                  : detail?.status === "error"
                    ? "执行未完整完成，请查看日志。"
                    : detail?.status === "interrupted"
                      ? "上次运行的收尾状态未确认，不会自动重跑。"
                      : detail.preview.reportOnly
                        ? "正在整理本轮预检记录，不连接编辑器或提交构建。"
                        : detail.preview.executionMode === "build"
                          ? "执行器正在执行构建用例，任务成功后仍需完成核验和收尾。"
                          : "执行器正在检查配置。"}
          </p>
          {detail?.progress && (
            <>
              <div className="record-summary">
                <strong>{automationPhases[detail.progress.phase]}</strong>
                <span>
                  已处理 {detail.progress.summary.completed} /{" "}
                  {detail.progress.summary.total}
                </span>
                <span>通过 {detail.progress.summary.passed}</span>
                <span>失败 {detail.progress.summary.failed}</span>
                <span>受阻 {detail.progress.summary.blocked}</span>
              </div>
              <progress
                aria-label={
                  executionModeLabel(
                    detail.preview.executionMode,
                    detail.preview.reportOnly,
                  ) + "进度"
                }
                max={Math.max(1, detail.progress.summary.total)}
                value={detail.progress.summary.completed}
              />
              {detail.progress.issues.fatal && (
                <p className="error-text">{detail.progress.issues.fatal}</p>
              )}
              {detail.progress.cases.map((item) => (
                <div
                  className={"record-case-row " + item.status}
                  key={item.caseId}
                >
                  <div className="record-case-name">
                    <strong>
                      {automationCaseTitle(
                        item,
                        detail.preview.composition?.origins,
                        detail.preview.composition?.presentation?.caseLabels,
                      )}
                    </strong>
                    <small>
                      {automationTargetLabel(item)} ·{" "}
                      {automationStages[item.stage] ||
                        automationStatus[item.status]}
                    </small>
                    {item.failure && (
                      <span className="error-text">{item.failure.reason}</span>
                    )}
                    <AutomationTasks tasks={item.tasks} />
                  </div>
                  <span className={"status " + item.status}>
                    {automationStatus[item.status]}
                  </span>
                </div>
              ))}
            </>
          )}
        </section>
      )}
      {(error || detail?.error) && (
        <p className="notice error-text" role="alert">
          {error || detail?.error}
        </p>
      )}
      {detail && (
        <details className="context-details">
          <summary>本轮目标、计划与执行日志</summary>
          <p>版本：{detail.preview.version || "未填写"}</p>
          <p className="target-path">{detail.preview.executable}</p>
          <p className="target-path">{detail.preview.projectPath}</p>
          <code className="path-block">{detail.preview.planPath}</code>
          <p className="hint">
            结果保存在本轮目录；退出后可从测试记录重新打开。
          </p>
          <pre className="raw-result">{detail.logs || "尚无日志"}</pre>
        </details>
      )}
    </>
  );
}
