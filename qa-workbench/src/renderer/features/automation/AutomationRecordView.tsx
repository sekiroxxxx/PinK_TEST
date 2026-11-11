import { useEffect, useState } from "react";
import type {
  AutomationProgress,
  RecordedAutomation,
} from "../../../shared/automation";
import {
  automationTargetLabel,
  automationCaseTitle,
} from "../../../shared/automation";
import type { Run } from "../../../shared/model";
import type { ExecutionPreview } from "../../../shared/execution";
import { Dialog } from "../../components/Dialog";
import { download } from "../../browserBridge";
import { automationStages, executionLabel } from "./executionLabel";
import { NativeResultChecks } from "../../integrations/pink-build/NativeResultChecks";
import { CompositionSnapshot } from "./CompositionSnapshot";

export const automationStatus: Record<
  AutomationProgress["cases"][number]["status"],
  string
> = {
  pending: "待执行",
  running: "执行中",
  passed: "通过",
  failed: "失败",
  blocked: "受阻",
  stopped: "已停止",
  skipped: "跳过",
  "not-applicable": "不适用",
};
export const automationPhases: Record<AutomationProgress["phase"], string> = {
  preflight: "检查执行前提",
  connecting: "连接测试目标",
  executing: "执行用例",
  cleanup: "整理现场",
  finished: "本轮已结束",
};
function caseSummary(item: AutomationProgress["cases"][number]) {
  return (
    [
      item.groupLabel || item.group,
      item.stage !== item.status
        ? automationStages[item.stage] || item.stage
        : "",
    ]
      .filter(Boolean)
      .join(" · ") || (item.title !== item.caseId ? item.caseId : "")
  );
}

export function AutomationTasks({
  tasks,
}: {
  tasks: AutomationProgress["cases"][number]["tasks"];
}) {
  return tasks.map((task) => (
    <div className="task-progress" key={task.taskId}>
      <span>{task.taskId}</span>
      <strong>{task.state || "未上报状态"}</strong>
      {task.progress !== undefined ? (
        <progress
          aria-label={"任务 " + task.taskId}
          max={1}
          value={task.progress}
        />
      ) : (
        <small>未上报百分比</small>
      )}
      <small>{task.collected ? "任务结果已收集" : "尚未收集任务结果"}</small>
    </div>
  ));
}

export function OriginalReport({
  title,
  html,
  close,
  note,
}: {
  title: string;
  html: string;
  close: () => void;
  note?: string;
}) {
  // Reports are data: no scripts, forms, same-origin access, or navigation grants.
  const document = new DOMParser().parseFromString(html, "text/html");
  document
    .querySelectorAll("a")
    .forEach((link) => link.removeAttribute("href"));
  document
    .querySelectorAll("script, meta[http-equiv='refresh'], base, form")
    .forEach((element) => element.remove());
  return (
    <Dialog title={title} onClose={close} wide>
      {note && <p className="notice">{note}</p>}
      <p className="hint">
        只读预览，不执行报告脚本或打开附件链接。证据文件请从原结果目录查看。
      </p>
      <iframe
        className="original-report"
        title="原始报告内容"
        sandbox=""
        srcDoc={document.documentElement.outerHTML}
      />
    </Dialog>
  );
}

export function AutomationRecordView({
  record,
  runs,
  back,
  backLabel = "返回测试记录",
  follow,
  openManual,
  local = false,
  executionMode,
  openFolder,
}: {
  record: RecordedAutomation;
  runs: Run[];
  back: () => void;
  backLabel?: string;
  follow: (item: AutomationProgress["cases"][number]) => void;
  openManual: (id: string) => void;
  local?: boolean;
  executionMode?: ExecutionPreview["executionMode"];
  openFolder?: () => void;
}) {
  const [index, setIndex] = useState(record.events.length - 1),
    [playing, setPlaying] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(false),
    [caseId, setCaseId] = useState("");
  const [report, setReport] = useState<"" | "html" | "json">("");
  const [snapshotPath, setSnapshotPath] = useState<string[]>();
  const progress = record.events[index] || record.progress;
  const summary = progress.summary;
  const stopped = summary.stopped > 0 || record.result.stopped === true;
  const replaying = !!record.events.length && index < record.events.length - 1;
  useEffect(() => {
    if (!playing) return;
    if (index >= record.events.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setIndex((value) => value + 1), 700);
    return () => clearTimeout(timer);
  }, [playing, index, record.events.length]);
  const item = progress.cases.find((item) => item.caseId === caseId);
  const origin = record.origins?.find((item) => item.caseId === caseId);
  const original = record.progress.cases.find((item) => item.caseId === caseId);
  const review = runs.findLast(
    (run) =>
      run.source.moduleId === "pink-build" &&
      run.source.revision === record.id &&
      run.source.hash === caseId,
  );
  const groups = [...new Set(progress.cases.map(automationTargetLabel))];
  const tasks = new Set(
    progress.cases.flatMap((item) => item.tasks.map((task) => task.taskId)),
  ).size;
  return (
    <section className="automation-record" data-page="automation-run">
      <div className="workspace-nav">
        <button className="text-button" onClick={back}>
          ← {backLabel}
        </button>
        <span>
          {local ? "本机真实结果" : "真实历史记录"}
          {replaying ? " · 回放中" : ""}
        </span>
      </div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{record.source}</p>
          <h1>{record.title}</h1>
          <p>
            {String(record.result.project || "未记录工程")} ·{" "}
            {new Date(progress.updatedAt).toLocaleString("zh-CN", {
              hour12: false,
            })}
          </p>
        </div>
        <div className="toolbar">
          {openFolder && <button onClick={openFolder}>打开本轮文件夹</button>}
          {!!record.events.length && (
            <button
              onClick={() => {
                if (playing) setPlaying(false);
                else {
                  if (!replaying) setIndex(0);
                  setPlaying(true);
                }
              }}
            >
              {playing ? "暂停回放" : replaying ? "继续回放" : "回放原进度"}
            </button>
          )}
          {replaying && (
            <button
              onClick={() => {
                setPlaying(false);
                setIndex(record.events.length - 1);
              }}
            >
              查看最终结果
            </button>
          )}
          <button
            onClick={() => setReport(record.reportHtml ? "html" : "json")}
          >
            查看原报告
          </button>
        </div>
      </div>
      <p className="entry-runtime-note">
        {local
          ? record.result.evidenceKind === "offline-preflight"
            ? "本轮仅完成离线预检并生成报告，未启动或连接编辑器，未提交构建。"
            : executionMode === "build"
              ? "本轮真实构建执行已收尾，构建任务、核验和恢复结果以独立执行器报告为准。"
              : "本轮配置检查已收尾，状态和结论来自独立执行器；未提交构建。"
          : "打开和回放均不重新执行。下方状态来自独立工具的正式进度；查看报告不会启动程序或提交构建。"}
      </p>
      <div className="record-summary">
        <strong>
          {automationPhases[progress.phase]}
          {progress.phase === "finished"
            ? " · " + executionLabel(progress, stopped)
            : ""}
        </strong>
        <span>
          已处理 {summary.completed} / {summary.total}
        </span>
        <span className="passed">通过 {summary.passed}</span>
        <span className={summary.failed ? "error-text" : ""}>
          失败 {summary.failed}
        </span>
        <span>受阻 {summary.blocked}</span>
        <span>构建任务 {tasks}</span>
        {typeof record.result.configurationRestored === "boolean" && (
          <span>
            {record.result.configurationRestored
              ? "配置已恢复"
              : "配置未恢复，请查看原报告"}
          </span>
        )}
      </div>
      <progress
        aria-label="历史用例处理进度"
        max={Math.max(1, summary.total)}
        value={summary.completed}
      />
      {summary.skipped + summary.stopped + summary.notApplicable > 0 && (
        <p className="hint">
          已停止 {summary.stopped} · 跳过 {summary.skipped} · 不适用{" "}
          {summary.notApplicable}（计入已处理，不计为通过）
        </p>
      )}
      {progress.issues.fatal && (
        <p className="notice error-text">{progress.issues.fatal}</p>
      )}
      {!!progress.issues.warnings.length && (
        <details className="notice">
          <summary>执行侧提示 · {progress.issues.warnings.length}</summary>
          <ul>
            {progress.issues.warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="section-heading">
        <h2>本轮用例</h2>
        <button
          className="text-button"
          onClick={() => setOnlyProblems(!onlyProblems)}
        >
          {onlyProblems ? "显示全部" : "只看失败、受阻与已停止"}
        </button>
      </div>
      {groups.map((group) => {
        const cases = progress.cases.filter(
          (item) =>
            automationTargetLabel(item) === group &&
            (!onlyProblems ||
              ["failed", "blocked", "stopped"].includes(item.status)),
        );
        return (
          cases.length > 0 && (
            <section className="record-group" key={group}>
              <h3>{group}</h3>
              {cases.map((item) => (
                <button
                  className={"record-case-row " + item.status}
                  key={item.caseId}
                  onClick={() => setCaseId(item.caseId)}
                >
                  <span className="record-case-name">
                    <strong>
                      {automationCaseTitle(
                        item,
                        record.origins,
                        record.composition?.presentation?.caseLabels,
                      )}
                    </strong>
                    {caseSummary(item) && <small>{caseSummary(item)}</small>}
                  </span>
                  <span className={"status " + item.status}>
                    {automationStatus[item.status]}
                  </span>
                  <span>查看 ›</span>
                </button>
              ))}
            </section>
          )
        );
      })}
      {onlyProblems &&
        !progress.cases.some((item) =>
          ["failed", "blocked", "stopped"].includes(item.status),
        ) && <p className="empty">当前进度没有失败、受阻或已停止项。</p>}
      <details className="context-details">
        <summary>记录来源与复用范围</summary>
        <code className="path-block">{record.id}</code>
        <p className="hint">
          {local
            ? "本轮用例快照、预览计划和结果保存在本机执行目录。重新执行请从自动化入口确认目标和范围，查看记录不会重跑。"
            : "这份结果没有附带完整可执行用例快照。重新执行请从自动化入口选择有效用例；这里不会从报告文字生成执行步骤。手动打开的报告只在当前窗口保留，请保留源文件。"}
        </p>
      </details>
      {item && (
        <Dialog
          title={automationCaseTitle(
            item,
            record.origins,
            record.composition?.presentation?.caseLabels,
          )}
          onClose={() => setCaseId("")}
          wide
          footer={
            <>
              <button
                onClick={() => {
                  setCaseId("");
                  setReport("json");
                }}
              >
                查看原始结果
              </button>
              <button
                className="primary"
                disabled={
                  !original ||
                  ["pending", "running"].includes(original.status) ||
                  replaying
                }
                onClick={() => {
                  if (review) openManual(review.id);
                  else if (original) follow(original);
                }}
              >
                {review ? "继续人工补查" : "人工补查"}
              </button>
            </>
          }
        >
          <p className={"status " + item.status}>
            {automationStatus[item.status]}
            {item.stage && item.stage !== item.status
              ? " · " + (automationStages[item.stage] || item.stage)
              : ""}
          </p>
          {origin && (
            <details className="context-details">
              <summary>本轮用例来源</summary>
              <p>{origin.sourceCaseId || origin.nodeId}</p>
              <p className="hint">
                引用位置：{origin.instancePath.join(" / ")}
              </p>
              <p className="hint">引用实例：{origin.instanceId}</p>
              {record.composition && (
                <button
                  className="text-button"
                  onClick={() => {
                    setCaseId("");
                    setSnapshotPath(origin.instancePath);
                  }}
                >
                  定位本轮链路
                </button>
              )}
            </details>
          )}
          {item.failure && (
            <div className="notice">
              <strong>{item.failure.reason}</strong>
              {!!item.failure.details.length && (
                <ul>
                  {item.failure.details.map((detail, i) => (
                    <li key={i}>{detail}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {!replaying && (
            <NativeResultChecks record={record} caseId={item.caseId} />
          )}
          <h3>构建任务</h3>
          {item.tasks.length ? (
            <AutomationTasks tasks={item.tasks} />
          ) : (
            <p className="hint">本用例没有上报构建任务。</p>
          )}
          <h3>证据</h3>
          {item.evidence.length ? (
            item.evidence.map((evidence, i) => (
              <div className="evidence-reference" key={i}>
                <strong>{evidence.stepId}</strong>
                {evidence.screenshot && <code>{evidence.screenshot}</code>}
                {evidence.scene && <code>{evidence.scene}</code>}
                {evidence.unavailable && <p>{evidence.unavailable}</p>}
              </div>
            ))
          ) : (
            <p className="hint">执行侧没有提供现场证据。</p>
          )}
          {!!item.evidence.length && (
            <p className="hint">
              以上为原报告的证据引用，相对路径以本轮结果目录为准；网页不会读取未选择的本机文件。
            </p>
          )}
        </Dialog>
      )}
      {snapshotPath && record.composition && (
        <CompositionSnapshot
          snapshot={record.composition}
          path={snapshotPath}
          close={() => setSnapshotPath(undefined)}
        />
      )}
      {report === "html" && record.reportHtml && (
        <OriginalReport
          title="执行侧原始报告"
          html={record.reportHtml}
          close={() => setReport("")}
          note={
            stopped
              ? "本轮包含停止操作。执行侧的整轮结论可能标为失败；请结合各用例状态判断。原始报告保持不变。"
              : undefined
          }
        />
      )}
      {report === "json" && (
        <Dialog title="执行侧原始结果" onClose={() => setReport("")} wide>
          <p className="hint">完整保留原内容，人工补查不会改写它。</p>
          <pre className="raw-result">
            {JSON.stringify(record.result, null, 2)}
          </pre>
          <footer className="dialog-actions">
            <button
              onClick={() => download("automation-result.json", record.result)}
            >
              导出原结果
            </button>
          </footer>
        </Dialog>
      )}
    </section>
  );
}
