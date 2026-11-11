import { useState } from "react";
import type { Environment, Project } from "../../shared/model";
import { targetLabel } from "./testTarget";

export function TestRunSetup({
  project,
  environment,
  count,
  mode,
  manual,
  simulate,
  selectProject,
  resumeDraft,
}: {
  project?: Project;
  environment?: Environment;
  count: number;
  mode: "manual" | "automation" | "both";
  manual: (version: string) => void;
  simulate: (version: string) => void;
  selectProject: () => void;
  resumeDraft?: () => void;
}) {
  const [version, setVersion] = useState(environment?.version || "");
  const ready = !!project && !!environment;
  return (
    <section className="test-run-setup" aria-label="确认本轮测试">
      <div className="test-run-target">
        <strong>
          {ready ? targetLabel(project, environment) : "尚未确认测试目标"}
        </strong>
        <span>已选 {count} 条链路</span>
        <button className="text-button" onClick={selectProject}>
          {ready ? "更换目标" : "选择测试目标"}
        </button>
      </div>
      {environment?.softwarePath && (
        <p className="target-help target-path">
          编辑器位置：{environment.softwarePath}
        </p>
      )}
      <div className="test-run-start">
        <label className="field">
          本次编辑器版本
          <input
            value={version}
            onChange={(event) => setVersion(event.target.value)}
            placeholder="例如 0.0.2.1"
            maxLength={50000}
            disabled={!ready}
          />
          {ready && version !== environment?.version && (
            <small className="target-help">
              修改版本时，请同时核对上方编辑器位置。
            </small>
          )}
        </label>
        <div className="toolbar">
          {mode !== "automation" && (
            <button
              className="primary"
              disabled={!ready || !count}
              onClick={() => manual(version.trim())}
            >
              开始本轮测试
            </button>
          )}
          {mode !== "manual" && (
            <button
              className={mode === "automation" ? "primary" : undefined}
              disabled={!ready || !count}
              onClick={() => simulate(version.trim())}
            >
              开始模拟
            </button>
          )}
        </div>
      </div>
      {resumeDraft && (
        <div className="test-run-draft" role="status">
          <span>
            {count
              ? "有尚未保存的用例草稿；新测试将使用上次保存的内容。"
              : "这条链路尚未保存，请先保存后开始测试。"}
          </span>
          <button className="text-button" onClick={resumeDraft}>
            继续编辑
          </button>
        </div>
      )}
    </section>
  );
}
