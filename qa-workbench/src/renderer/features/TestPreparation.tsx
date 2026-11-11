import { useEffect, useMemo, useRef, useState } from "react";
import type { State, Project, Environment } from "../../shared/model";
import type { Preparation } from "./navigation";
import { Dialog } from "../components/Dialog";
import { readDraft, useDraft } from "../components/useDraft";
import { z } from "zod";
import { hasPendingContentDraft } from "./ContentEditor";
import { targetLabel } from "./testTarget";
import {
  automationModule,
  automationContent,
  type AutomationModule,
} from "./automation/modules";
import { hasHostAccess } from "../browserBridge";
import type { ExecutionPreview } from "../../shared/execution";
import { automationTargetLabel } from "../../shared/automation";
import { ExecutionOverrides } from "./automation/ExecutionOverrides";
import type { ExecutionAdjustment } from "./automation/modules";
import { authoringTree, type EditNode } from "./structured/authoring";

export type PreparedSelection = {
  ids: string[];
  version: string;
  project: Project;
  environment: Environment;
  executionId?: string;
};

export function TestPreparation({
  context,
  state,
  suspended,
  close,
  target,
  editDraft,
  start,
  executionEnabled = false,
}: {
  context: Preparation;
  state: State;
  suspended: boolean;
  close: () => void;
  target: () => void;
  editDraft?: (nodeId?: string) => void;
  start: (selection: PreparedSelection) => Promise<boolean>;
  executionEnabled?: boolean;
}) {
  const environment =
    context.target?.environment ||
    state.environments.find((item) => item.id === state.selectedEnvironmentId);
  const project =
    context.target?.project ||
    state.projects.find((item) => item.id === state.selectedProjectId);
  const [version, setVersion] = useState(environment?.version || "");
  const [loadedModule, setLoadedModule] =
    useState<Awaited<ReturnType<AutomationModule["load"]>>>();
  const [loadingModule, setLoadingModule] = useState(!!context.mount?.editor);
  const nativeWholeChain =
    context.mode === "automation" &&
    context.mount?.editor?.document.kind === "pink-configuration-steps" &&
    !loadedModule?.canCompose;
  const [ids, setIds] = useState<string[]>(
    nativeWholeChain
      ? context.content.groups.flatMap((group) =>
          group.units.map((unit) => unit.id),
        )
      : context.candidates,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const realAvailable =
    !!hasHostAccess && context.mode === "automation" && executionEnabled;
  const [runMode, setRunMode] = useState<
    "configuration" | "build" | "simulation"
  >(realAvailable ? "configuration" : "simulation");
  const real = runMode !== "simulation";
  const building = runMode === "build";
  const [previewState, setPreview] = useState<{
    key: string;
    value: ExecutionPreview;
  } | null>(null);
  const previewRef = useRef<HTMLElement>(null);
  const editorPath = (environment?.softwarePath || "").replaceAll("\\", "/");
  const editorSelection = JSON.stringify([
    /^[a-z]:/i.test(editorPath) ? editorPath.toLowerCase() : editorPath,
    environment?.version || "",
  ]);
  const source = context.mount;
  const caseLocations = useMemo(() => {
    const result = new Map<string, { nodeId: string; title: string }>();
    if (!source?.editor || !loadedModule) return result;
    const visit = (nodes: EditNode[], path: string[]) => {
      for (const node of nodes) {
        const names = [...path, node.title];
        if (
          node.selectable &&
          node.definitionId &&
          !result.has(node.definitionId)
        )
          result.set(node.definitionId, {
            nodeId: node.id,
            title: names.slice(-3).join(" / "),
          });
        visit(node.children || [], names);
      }
    };
    visit(
      authoringTree(
        loadedModule.adapter,
        source.editor.document,
        source.editor.labels,
      ),
      [],
    );
    return result;
  }, [source?.editor, loadedModule]);
  const adjustments = useDraft<Record<string, ExecutionAdjustment>>(
    "execution-options:" +
      (source?.id || context.id) +
      ":" +
      (source?.editor?.documentHash || ""),
    {},
    z.record(
      z.string(),
      z.object({
        fields: z.record(z.string(), z.unknown()).optional(),
        steps: z.array(z.string()).optional(),
      }),
    ),
  );
  const [diagnostic, setDiagnostic] = useState<string>();
  useEffect(() => {
    if (context.mode !== "automation" || !source?.editor) {
      setLoadingModule(false);
      return;
    }
    let current = true;
    const module = automationModule(source.editor.moduleId);
    if (!module) {
      setLoadingModule(false);
      return;
    }
    setLoadingModule(true);
    module
      .load({ document: source.editor.document })
      .then((loaded) => {
        if (!current) return;
        setLoadedModule(loaded);
        setIds(
          loaded.canCompose
            ? context.candidates
            : source.editor?.document.kind === "pink-configuration-steps"
              ? context.content.groups.flatMap((group) =>
                  group.units.map((unit) => unit.id),
                )
              : context.candidates,
        );
      })
      .catch((error) => {
        if (current)
          setError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (current) setLoadingModule(false);
      });
    return () => {
      current = false;
    };
  }, [context.id]);
  const rawDraft = source?.editor
    ? (readDraft(
        "authoring:" + source.id + ":" + source.editor.documentHash,
      ) as {
        document?: unknown;
        organization?: unknown;
        labels?: unknown;
      } | null)
    : null;
  const dirty = source?.editor
    ? !!rawDraft &&
      (JSON.stringify(rawDraft.labels || {}) !==
        JSON.stringify(source.editor.labels || {}) ||
        JSON.stringify(rawDraft.document) !==
          JSON.stringify(source.editor.document) ||
        JSON.stringify(rawDraft.organization) !==
          JSON.stringify(
            source.editor.organization || { folders: [], parents: {} },
          ))
    : !!source && hasPendingContentDraft(source);
  useEffect(() => {
    setVersion(environment?.version || "");
    // A different project creates a new environment ID, but does not replace
    // the version already confirmed for this editor in this preparation.
  }, [editorSelection]);
  const content =
    source?.editor && loadedModule
      ? automationContent(
          loadedModule,
          source.editor,
          context.content.id,
          context.content.name,
          adjustments.draft,
        )
      : context.content;
  const units = content.groups.flatMap((group) => group.units);
  const selected = new Set(ids);
  const names = new Map(
    content.groups.flatMap((group) =>
      group.units.map(
        (unit) =>
          [
            unit.id,
            { id: unit.id, group: group.title, title: unit.title },
          ] as const,
      ),
    ),
  );
  const selectedNames = ids.flatMap((id) =>
    names.has(id) ? [names.get(id)!] : [],
  );
  const previewKey = JSON.stringify([
    runMode,
    ids,
    version,
    environment?.softwarePath,
    environment?.projectPath,
    environment?.materialsPath,
    source?.editor?.document,
    adjustments.draft,
  ]);
  const preview = previewState?.key === previewKey ? previewState.value : null;
  const preflightCounts = preview?.cases.some((item) => item.status)
    ? {
        ready: preview.cases.filter((item) => item.status === "ready").length,
        blocked: preview.cases.filter((item) => item.status === "blocked")
          .length,
        notApplicable: preview.cases.filter(
          (item) => item.status === "not-applicable",
        ).length,
      }
    : undefined;
  useEffect(() => {
    setPreview(null);
    setError("");
    setDiagnostic(undefined);
  }, [previewKey, real]);
  useEffect(() => {
    if (preview) previewRef.current?.scrollIntoView({ block: "start" });
  }, [preview]);
  async function submit() {
    if (!environment || !project) return;
    setBusy(true);
    setError("");
    try {
      if (context.mode === "automation" && source?.editor) {
        const module = automationModule(source.editor.moduleId);
        if (!module) throw new Error("当前接入模块不可用");
        const loaded =
          loadedModule ||
          (await module.load({ document: source.editor.document }));
        await loaded.adapter.validate(source.editor.document);
        if (!loaded.caseIds(source.editor.document, ids).length)
          throw new Error("没有可对应的执行用例；说明和模板不能作为执行项");
        if (real && !preview) {
          const executionInput = loaded.prepareExecution
            ? await loaded.prepareExecution(
                source.editor.document,
                ids,
                building ? "build" : "configuration",
                adjustments.draft,
              )
            : {
                inputKind: "native" as const,
                document: source.editor.document,
                caseIds: loaded.caseIds(source.editor.document, ids),
              };
          setPreview({
            key: previewKey,
            value: await window.qa.previewAutomation({
              moduleId: source.editor.moduleId,
              sourceId: source.id,
              title: source.name,
              ...executionInput,
              presentation: loaded.presentation?.(
                executionInput.document,
                source.editor.labels || {},
                adjustments.draft,
              ),
              executable: environment.softwarePath,
              projectPath: environment.projectPath,
              materialsPath: environment.materialsPath,
              version: version.trim(),
              executionMode: building ? "build" : "configuration",
            }),
          });
          return;
        }
      }
      if (real && !preview?.canStart)
        throw new Error("请核对运行方式和范围后重新生成执行计划");
      if (
        await start({
          ids,
          version: version.trim(),
          project,
          environment,
          executionId: real ? preview?.id : undefined,
        })
      )
        close();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      if (error && typeof error === "object" && "issue" in error)
        setDiagnostic(
          String((error as { issue: { node: string } }).issue.node),
        );
    } finally {
      setBusy(false);
    }
  }
  if (suspended) return null;
  return (
    <Dialog title="准备本轮测试" onClose={close} wide>
      <div className="preparation-layout">
        <div className="preparation-content">
          <div className="preparation-summary">
            <div>
              <p className="eyebrow">
                {context.mode === "manual"
                  ? "人工测试"
                  : real
                    ? preview?.reportOnly
                      ? "自动化测试 · 预检报告"
                      : building
                        ? "自动化测试 · 真实构建"
                        : "自动化测试 · 真实配置检查"
                    : "自动化测试 · 模拟"}
                {context.snapshot ? " · 沿用历史快照" : ""}
              </p>
              <h3>{context.title}</h3>
            </div>
            <span>
              {context.blank ? "空白开始" : "已选 " + ids.length + " 项"}
            </span>
          </div>
          {realAvailable && (
            <label className="field">
              运行方式
              <select
                value={runMode}
                disabled={busy}
                onChange={(event) =>
                  setRunMode(event.target.value as typeof runMode)
                }
              >
                <option value="configuration">真实配置检查 · 不提交构建</option>
                <option value="build">真实构建 · 提交并等待结果</option>
                <option value="simulation">仅模拟进度</option>
              </select>
            </label>
          )}
          <section className="preparation-target">
            <div>
              <strong>
                {targetLabel(
                  project,
                  environment ? { ...environment, version } : undefined,
                )}
              </strong>
              <button className="text-button" onClick={target}>
                {environment ? "更换目标" : "选择测试目标"}
              </button>
            </div>
            <label className="field">
              本次编辑器版本
              <input
                value={version}
                onChange={(event) => setVersion(event.target.value)}
                placeholder="确认或修改这次的版本"
              />
            </label>
            {environment && (
              <details>
                <summary>核对程序和工程路径</summary>
                <p className="target-path">
                  编辑器：{environment.softwarePath || "未选择"}
                </p>
                <p className="target-path">
                  工程：{environment.projectPath || "未选择"}
                </p>
              </details>
            )}
          </section>
          {real && preview && (
            <section
              ref={previewRef}
              className="notice preparation-plan"
              aria-label={preview.reportOnly ? "预检计划" : "真实执行计划"}
              aria-live="polite"
            >
              <h3>
                {preview.reportOnly ? "预检计划" : "真实执行计划"} ·{" "}
                {preview.cases.length} 项
              </h3>
              <p className={preview.canStart ? "" : "error-text"}>
                {preview.reason}
              </p>
              <p className="hint">
                计划只核验文件和执行定义；页面中的目标、选项和可读写状态，在实际执行时确认。
              </p>
              {preflightCounts && (
                <p>
                  可执行 {preflightCounts.ready} 项 · 受阻{" "}
                  {preflightCounts.blocked} 项
                  {preflightCounts.notApplicable
                    ? ` · 不适用 ${preflightCounts.notApplicable} 项`
                    : ""}
                </p>
              )}
              <details
                open={
                  !!preflightCounts?.blocked ||
                  !!preflightCounts?.notApplicable ||
                  !!preview.reportOnly
                }
              >
                <summary>本轮全部 {preview.cases.length} 项及预检明细</summary>
                <div className="result-values-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">用例</th>
                        <th scope="col">预检状态</th>
                        <th scope="col">原因</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.cases.map((item) => {
                        const origin = preview.composition?.origins.find(
                          (origin) => origin.caseId === item.caseId,
                        );
                        const instance = origin
                          ? JSON.stringify(origin.instancePath)
                          : undefined;
                        const location =
                          caseLocations.get(item.caseId) ||
                          (instance
                            ? caseLocations.get(instance)
                            : undefined) ||
                          item.sourceCaseIds
                            ?.map((id) => caseLocations.get(id))
                            .find(Boolean);
                        return (
                          <tr key={item.caseId}>
                            <th scope="row">
                              {location?.title ||
                                (instance &&
                                  preview.composition?.presentation?.caseLabels[
                                    instance
                                  ]) ||
                                [item.group, item.title || item.caseId]
                                  .filter(Boolean)
                                  .join(" / ")}
                              {location && editDraft && (
                                <button
                                  className="text-button"
                                  onClick={() => editDraft(location.nodeId)}
                                >
                                  定位用例
                                </button>
                              )}
                            </th>
                            <td>
                              {item.status === "ready"
                                ? "可执行"
                                : item.status === "blocked"
                                  ? "受阻"
                                  : item.status === "not-applicable"
                                    ? "不适用"
                                    : "未提供"}
                            </td>
                            <td>
                              {item.gaps?.length ? (
                                <ul>
                                  {item.gaps.map((gap, index) => (
                                    <li key={index}>{gap.reason}</li>
                                  ))}
                                </ul>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
              <p>
                测试对象：
                {[...new Set(preview.cases.map(automationTargetLabel))].join(
                  "、",
                ) || "未指定"}
              </p>
              <p className="target-path">编辑器：{preview.executable}</p>
              <p className="target-path">工程：{preview.projectPath}</p>
              <details>
                <summary>执行项编号、计划文件与步骤</summary>
                <code className="path-block">{preview.planPath}</code>
                <p className="hint">计划摘要：{preview.planHash}</p>
                {preview.cases.map((item) => (
                  <p key={item.caseId}>
                    {automationTargetLabel(item)} · {item.caseId}：
                    {item.status === "blocked"
                      ? "受阻，本轮不执行"
                      : item.status === "not-applicable"
                        ? "不适用，本轮不执行"
                        : item.operations.join(" → ")}
                  </p>
                ))}
              </details>
            </section>
          )}
          {context.blank ? (
            <p className="notice">
              进入测试后随时添加检查项。无需先建立用例集。
            </p>
          ) : (
            <details className="preparation-range" open={!preview}>
              <summary>
                本轮用例范围{" "}
                <small>
                  {ids.length} / {units.length}
                </small>
              </summary>
              <div className="toolbar">
                {nativeWholeChain ? (
                  <p className="hint">
                    该步骤文件按完整链路执行。范围与顺序请在用例编辑中调整；实际计划由模块核验。
                  </p>
                ) : (
                  <>
                    <button
                      className="text-button"
                      disabled={loadingModule || busy}
                      onClick={() => setIds(units.map((unit) => unit.id))}
                    >
                      全选此用例集
                    </button>
                    <button
                      className="text-button"
                      disabled={loadingModule || busy}
                      onClick={() => setIds([])}
                    >
                      清空选择
                    </button>
                  </>
                )}
              </div>
              <div className="preparation-range-list">
                {content.groups
                  .filter((group) => group.units.length)
                  .map((group) => (
                    <section key={group.id}>
                      <h4>{group.title}</h4>
                      {group.units.map((unit) => (
                        <label key={unit.id}>
                          <input
                            type="checkbox"
                            disabled={nativeWholeChain || loadingModule || busy}
                            checked={selected.has(unit.id)}
                            onChange={(event) =>
                              setIds((value) =>
                                event.target.checked
                                  ? [...value, unit.id]
                                  : value.filter((id) => id !== unit.id),
                              )
                            }
                          />
                          <span>{unit.title}</span>
                        </label>
                      ))}
                    </section>
                  ))}
              </div>
            </details>
          )}
          {context.mode === "automation" && (
            <details className="preparation-order">
              <summary>查看所选用例顺序</summary>
              <ol>
                {ids.map((id, index) => {
                  const unit = units.find((unit) => unit.id === id);
                  const title = [names.get(id)?.group, unit?.title]
                    .filter(Boolean)
                    .join(" · ");
                  return unit ? (
                    <li key={unit.id}>
                      <span>{title}</span>
                      {loadedModule?.canCompose && !preview && (
                        <span>
                          <button
                            className="text-button"
                            disabled={index === 0 || busy}
                            aria-label={"上移 " + title}
                            onClick={() =>
                              setIds((value) => {
                                const next = [...value];
                                [next[index - 1], next[index]] = [
                                  next[index],
                                  next[index - 1],
                                ];
                                return next;
                              })
                            }
                          >
                            上移
                          </button>
                          <button
                            className="text-button"
                            disabled={index === ids.length - 1 || busy}
                            aria-label={"下移 " + title}
                            onClick={() =>
                              setIds((value) => {
                                const next = [...value];
                                [next[index], next[index + 1]] = [
                                  next[index + 1],
                                  next[index],
                                ];
                                return next;
                              })
                            }
                          >
                            下移
                          </button>
                        </span>
                      )}
                    </li>
                  ) : null;
                })}
              </ol>
            </details>
          )}
          {context.mode === "automation" &&
            source?.editor &&
            loadedModule?.executionOptions && (
              <ExecutionOverrides
                items={selectedNames.map((item) => ({
                  id: item.id,
                  title: item.title,
                }))}
                options={(id) =>
                  loadedModule.executionOptions!(source.editor!.document, id)
                }
                values={adjustments.draft}
                change={(id, value) =>
                  adjustments.setDraft((draft) => ({ ...draft, [id]: value }))
                }
                disabled={busy || !!preview}
              />
            )}
          {context.mode === "automation" && (
            <p className="notice">
              {real
                ? preview?.reportOnly
                  ? "本轮只生成预检报告，不启动或连接编辑器，不提交构建。"
                  : building
                    ? "本轮将通过编辑器提交真实构建。先核对计划，再开始；配置是否恢复由用例中的恢复步骤决定。"
                    : "本轮只检查配置，不提交构建。先核对计划，再开始；含构建操作的步骤文件会被拦住。"
                : "本轮只模拟所选用例的进度，不启动编辑器或构建。"}
            </p>
          )}
        </div>
        {(dirty || error) && (
          <div className="preparation-messages">
            {dirty && (
              <p className="case-draft-note">
                有未保存草稿，本轮使用上次保存的用例。
                {editDraft && (
                  <button className="text-button" onClick={() => editDraft()}>
                    继续编辑
                  </button>
                )}
              </p>
            )}
            {error && (
              <p role="alert" className="error-text">
                {error}
                {diagnostic && editDraft && (
                  <button
                    className="text-button"
                    onClick={() => editDraft(diagnostic)}
                  >
                    定位用例问题
                  </button>
                )}
              </p>
            )}
          </div>
        )}
        <footer className="dialog-actions">
          <button onClick={close}>取消</button>
          {real && preview && (
            <button disabled={busy} onClick={() => setPreview(null)}>
              重新预览
            </button>
          )}
          <button
            className="primary"
            disabled={
              busy ||
              loadingModule ||
              !environment ||
              !project ||
              (!context.blank && !ids.length) ||
              (real && !!preview && !preview.canStart)
            }
            onClick={() => void submit()}
          >
            {loadingModule
              ? "正在读取用例能力…"
              : busy
                ? "正在处理…"
                : context.mode === "manual"
                  ? "开始本轮测试"
                  : real
                    ? preview
                      ? preview.reportOnly
                        ? "生成预检报告"
                        : building
                          ? "开始真实构建"
                          : "开始配置检查"
                      : "生成真实计划"
                    : "开始模拟"}
          </button>
        </footer>
      </div>
    </Dialog>
  );
}
