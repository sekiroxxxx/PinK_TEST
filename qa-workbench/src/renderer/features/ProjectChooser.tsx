import { useState } from "react";
import { z } from "zod";
import {
  stateSchema,
  type State,
  type Project,
  type Environment,
} from "../../shared/model";
import { Dialog } from "../components/Dialog";
import { useDraft } from "../components/useDraft";
import { hasHostAccess } from "../browserBridge";
import { editorName } from "./testTarget";

const draftSchema = z.object({
  project: stateSchema.shape.projects.element.nullable(),
  environment: stateSchema.shape.environments.element.nullable(),
});
const normalized = (path: string) =>
  /^[A-Za-z]:/.test(path) ? path.replaceAll("\\", "/").toLowerCase() : path;
export function ProjectChooser({
  state,
  save,
  close,
  advanced,
  launch,
}: {
  state: State;
  save: (s: State) => Promise<boolean>;
  close: () => void;
  advanced: () => void;
  launch: (environment: Environment) => Promise<boolean>;
}) {
  const initial =
    state.projects.find((p) => p.id === state.selectedProjectId) || null;
  const draft = useDraft(
    "project-chooser",
    {
      project: initial,
      environment:
        state.environments.find(
          (e) =>
            e.id === state.selectedEnvironmentId && e.projectId === initial?.id,
        ) || null,
    },
    draftSchema,
  );
  const { project, environment } = draft.draft;
  const [error, setError] = useState("");
  const [picking, setPicking] = useState(false);
  const [picker, setPicker] = useState<"editor" | "project" | "">("");
  const [editingPath, setEditingPath] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const recent = state.environments
    .slice()
    .sort((a, b) => (b.lastUsedAt || "").localeCompare(a.lastUsedAt || ""));
  const editors = recent.filter(
    (e, i, all) =>
      e.softwarePath &&
      all.findIndex(
        (x) =>
          normalized(x.softwarePath) === normalized(e.softwarePath) &&
          x.version === e.version,
      ) === i,
  );
  function baseEnvironment(): Environment {
    return (
      environment || {
        id: crypto.randomUUID(),
        projectId: project?.id || "pending",
        name: "本地",
        version: "",
        softwarePath: "",
        projectPath: "",
        materialsPath: "",
        notes: "",
      }
    );
  }
  function updateEditor(
    softwarePath: string,
    version = "",
    launchMode: Environment["launchMode"] = "editor",
  ) {
    draft.setDraft((d) => ({
      ...d,
      environment: { ...baseEnvironment(), softwarePath, version, launchMode },
    }));
  }
  async function selectEditor() {
    if (!hasHostAccess) {
      setEditingPath(true);
      return;
    }
    setPicking(true);
    setPicker("editor");
    setError("");
    try {
      const path = await window.qa.pickPath("file");
      if (
        path &&
        normalized(path) !== normalized(environment?.softwarePath || "")
      )
        updateEditor(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPicker("");
      setPicking(false);
    }
  }
  function chooseProject(next: Project, path: string) {
    const previous = recent.find((e) => e.projectId === next.id);
    draft.setDraft({
      project: next,
      environment: {
        ...baseEnvironment(),
        projectId: next.id,
        projectPath: path,
        materialsPath: previous?.materialsPath || "",
        notes: previous?.notes || "",
      },
    });
  }
  async function selectDirectory() {
    setError("");
    setPicking(true);
    setPicker("project");
    try {
      const info = await window.qa.pickProject();
      if (!info) return;
      const known =
        info.pathKind === "absolute"
          ? state.projects.find((p) =>
              state.environments.some(
                (e) =>
                  e.projectId === p.id &&
                  normalized(e.projectPath) === normalized(info.path),
              ),
            )
          : undefined;
      chooseProject(
        {
          ...(known || { id: crypto.randomUUID(), description: "" }),
          name: info.name,
          location: info,
        },
        info.path,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPicker("");
      setPicking(false);
    }
  }
  async function useTarget(
    start = false,
    selectedProject = project,
    selectedEnvironment = environment,
  ) {
    const project = selectedProject,
      environment = selectedEnvironment;
    if (!project || !environment) return;
    setPicking(true);
    setError("");
    try {
      const candidate = {
        ...environment,
        projectId: project.id,
        softwarePath: environment.softwarePath.trim(),
        version: environment.version.trim(),
      };
      const existing = state.environments.find(
        (e) =>
          e.projectId === project.id &&
          normalized(e.softwarePath) === normalized(candidate.softwarePath) &&
          normalized(e.projectPath) === normalized(candidate.projectPath) &&
          e.version === candidate.version,
      );
      const now = new Date().toISOString();
      const nextEnvironment = {
        ...(existing || candidate),
        launchMode: candidate.launchMode || ("editor" as const),
        id: existing?.id || crypto.randomUUID(),
        name: existing?.name || `本地 · ${project.name}`,
        lastUsedAt: now,
      };
      if (
        await save({
          ...state,
          projects: [
            ...state.projects.filter((p) => p.id !== project.id),
            { ...project, lastOpenedAt: now },
          ],
          environments: [
            ...state.environments.filter((e) => e.id !== nextEnvironment.id),
            nextEnvironment,
          ],
          selectedProjectId: project.id,
          selectedEnvironmentId: nextEnvironment.id,
        })
      ) {
        draft.clearDraft();
        if (!start || (await launch(nextEnvironment))) close();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPicking(false);
    }
  }
  return (
    <Dialog title="确认测试目标" wide onClose={close}>
      <div className="target-picker">
        {picker && (
          <p className="target-help" role="status">
            请在系统选择窗口中
            {picker === "project" ? "选择测试工程目录" : "选择编辑器程序"}
            ，或取消返回。此操作不会启动编辑器。
          </p>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {draft.storageError && (
          <p className="error-text" role="status">
            {draft.storageError}
          </p>
        )}
        {recent.length > 0 && (
          <section className="target-recents">
            <div className="target-section-heading">
              <span>最近使用</span>
              {recent.length > 3 && (
                <button
                  className="text-button"
                  onClick={() => setShowAll(!showAll)}
                >
                  {showAll ? "收起" : "查看全部"}
                </button>
              )}
            </div>
            <div className="target-recent-list">
              {recent.slice(0, showAll ? undefined : 3).map((e) => {
                const p = state.projects.find((p) => p.id === e.projectId);
                if (!p) return null;
                const selected =
                  project?.id === p.id &&
                  normalized(environment?.softwarePath || "") ===
                    normalized(e.softwarePath) &&
                  environment?.version === e.version &&
                  environment?.projectPath === e.projectPath;
                return (
                  <div className="target-recent-row" key={e.id}>
                    <button
                      key={e.id}
                      className={"target-recent" + (selected ? " active" : "")}
                      aria-pressed={selected}
                      title={`${e.softwarePath || "编辑器待补充"}\n${e.projectPath}`}
                      onClick={() => {
                        draft.setDraft({ project: p, environment: e });
                        setEditingPath(false);
                      }}
                    >
                      <strong>
                        {e.softwarePath
                          ? editorName(e.softwarePath)
                          : "编辑器待补充"}
                        {e.version && ` · ${e.version}`}
                      </strong>
                      <span>{p.name}</span>
                    </button>
                    <button
                      className="quiet"
                      disabled={picking || !e.softwarePath}
                      aria-label={
                        (!hasHostAccess ? "模拟启动" : "启动") +
                        "最近目标：" +
                        p.name +
                        " " +
                        e.version
                      }
                      onClick={() => void useTarget(true, p, e)}
                    >
                      {!hasHostAccess ? "模拟启动" : "启动"}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}
        <section className="target-part">
          <div className="target-section-heading">
            <h3>被测编辑器</h3>
            <button
              className="text-button"
              disabled={picking}
              onClick={() => void selectEditor()}
            >
              {environment?.softwarePath
                ? "更换"
                : !hasHostAccess
                  ? "填写路径"
                  : "选择程序"}
            </button>
          </div>
          {environment?.softwarePath && !editingPath ? (
            <div className="target-selected">
              <strong>{editorName(environment.softwarePath)}</strong>
              <span className="target-path" title={environment.softwarePath}>
                {environment.softwarePath}
              </span>
            </div>
          ) : (
            <label className="field">
              编辑器程序位置
              <input
                value={environment?.softwarePath || ""}
                placeholder="例如 D:\Tools\PinK\PinK.exe"
                onChange={(e) => {
                  setEditingPath(true);
                  updateEditor(e.target.value);
                }}
              />
            </label>
          )}
          <div className="target-editor-options">
            <label className="field">
              编辑器版本
              <input
                value={environment?.version || ""}
                placeholder="确认本次被测版本"
                maxLength={50000}
                onChange={(e) =>
                  draft.setDraft((d) => ({
                    ...d,
                    environment: {
                      ...baseEnvironment(),
                      version: e.target.value,
                    },
                  }))
                }
              />
            </label>
            {editors.length > 0 && (
              <label className="field">
                最近编辑器
                <select
                  value=""
                  onChange={(e) => {
                    const previous = editors.find(
                      (x) => x.id === e.target.value,
                    );
                    if (previous) {
                      updateEditor(
                        previous.softwarePath,
                        previous.version,
                        previous.launchMode,
                      );
                      setEditingPath(false);
                    }
                  }}
                >
                  <option value="">选择已记录的编辑器</option>
                  {editors.map((e) => (
                    <option key={e.id} value={e.id}>
                      {editorName(e.softwarePath)} · {e.version || "版本未填写"}{" "}
                      · {e.softwarePath}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <p className="target-help">
            {!hasHostAccess
              ? "网页只模拟启动；版本也可在开始测试前确认。"
              : "版本请核对编辑器后填写；选择程序不会启动它。"}
          </p>
        </section>
        <section className="target-part">
          <div className="target-section-heading">
            <h3>测试工程</h3>
            <button
              className="text-button"
              disabled={picking}
              onClick={() => void selectDirectory()}
            >
              {project ? "更换目录" : "选择工程目录"}
            </button>
          </div>
          {project ? (
            <div className="target-selected">
              <strong>{project.name}</strong>
              <span className="target-path">
                {environment?.projectPath || "目录待补充"}
              </span>
            </div>
          ) : (
            <p className="target-help">选择准备由编辑器打开的测试工程。</p>
          )}
          {state.projects.length > 0 && (
            <label className="field target-project-select">
              最近工程
              <select
                value={
                  state.projects.some((p) => p.id === project?.id)
                    ? project!.id
                    : ""
                }
                onChange={(e) => {
                  const p = state.projects.find((p) => p.id === e.target.value);
                  const env = recent.find((x) => x.projectId === p?.id);
                  if (p)
                    chooseProject(
                      p,
                      env?.projectPath || p.location?.path || "",
                    );
                }}
              >
                <option value="">选择已有工程，保留上面的编辑器</option>
                {state.projects.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name} ·{" "}
                    {recent.find((e) => e.projectId === p.id)?.projectPath ||
                      "目录待补充"}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>
        <details className="target-extra">
          <summary>启动方式与补充信息</summary>
          <label className="field">
            打开工程的方式
            <select
              value={environment?.launchMode || "editor"}
              onChange={(e) =>
                draft.setDraft((d) => ({
                  ...d,
                  environment: {
                    ...baseEnvironment(),
                    launchMode: e.target.value as Environment["launchMode"],
                  },
                }))
              }
            >
              <option value="editor">仅启动编辑器，在编辑器中打开工程</option>
              <option value="project-argument">将工程目录作为启动参数</option>
            </select>
            <small>
              目录参数方式适用于支持此约定的编辑器；工具不会判断工程是否已成功打开。
            </small>
          </label>
          <p className="hint">材料、备注和原有项目环境信息按需维护。</p>
          <button className="text-button" onClick={advanced}>
            管理已有项目与环境
          </button>
        </details>
        <footer className="dialog-actions target-picker-footer">
          <span>
            {environment?.launchMode === "project-argument"
              ? "启动时传入所选工程目录"
              : "启动后在编辑器中打开工程"}
          </span>
          <button
            disabled={
              !project ||
              !environment ||
              !environment.softwarePath.trim() ||
              !environment.projectPath ||
              picking
            }
            onClick={() => void useTarget()}
          >
            {picking ? "处理中…" : "使用此目标"}
          </button>
          <button
            className="primary"
            disabled={
              picking ||
              !project ||
              !environment?.softwarePath.trim() ||
              !environment?.projectPath
            }
            onClick={() => void useTarget(true)}
          >
            {!hasHostAccess ? "使用并模拟启动" : "使用并启动"}
          </button>
        </footer>
      </div>
    </Dialog>
  );
}
