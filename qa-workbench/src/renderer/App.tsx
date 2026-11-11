import { useEffect, useRef, useState } from "react";
import { initializeDraftStore } from "./draftStore";
import { PersistenceError } from "./localDatabase";
import type {
  Bootstrap,
  Route,
  Run,
  State,
  Simulation,
  Environment,
} from "../shared/model";
import {
  readAutomationResult,
  type AutomationProgress,
  type RecordedAutomation,
} from "../shared/automation";
import {
  orderedContentGroups,
  type TestContent,
  type Mount,
} from "../shared/content";
import { ProjectChooser } from "./features/ProjectChooser";
import { targetLabel, editorName } from "./features/testTarget";
import { ProjectDialog } from "./features/ProjectDialog";
import { SettingsDialog } from "./features/SettingsDialog";
import { ManualRun } from "./features/ManualRun";
import { ManualEntry } from "./features/ManualEntry";
import { ContinueTests } from "./features/ContinueTests";
import { Memo } from "./features/Memo";
import { ChainWorkspace } from "./features/ChainWorkspace";
import { AutomationWorkspace } from "./features/automation/AutomationWorkspace";
import {
  AutomationRecordView,
  OriginalReport,
} from "./features/automation/AutomationRecordView";
import {
  TestPreparation,
  type PreparedSelection,
} from "./features/TestPreparation";
import {
  returnLabel,
  type RecordMode,
  type Page,
  type Preparation,
  type CaseLocation,
} from "./features/navigation";
import { sequenceOf } from "./features/routes/RouteSequence";
import type { ExecutionState } from "../shared/execution";
import { LiveAutomationView } from "./features/automation/LiveAutomationView";
import {
  executionLabel,
  executionModeLabel,
} from "./features/automation/executionLabel";
import { Dialog } from "./components/Dialog";
import { Feedback } from "./components/Feedback";
import {
  hasHostAccess,
  chooseFile,
  browserMode,
  exportBeforeRestoreBackup,
} from "./browserBridge";
import {
  MountDialog,
  SimulationView,
  contentSteps,
  fromRoute,
} from "./features/ContentWorkspace";

function ExecutionOutcome({ item }: { item: ExecutionState }) {
  const [stopped, setStopped] = useState(false);
  const needsDetail =
    item.status === "finished" &&
    item.progress?.outcome === "failed" &&
    item.progress.summary.stopped === 0;
  useEffect(() => {
    if (!needsDetail) return;
    let live = true;
    // An early stop may leave all cases skipped; the run-level flag is only
    // available from the existing result detail, not the progress summary.
    void window.qa.readAutomation(item.id).then(
      (detail) => {
        if (live) setStopped(detail.record?.result.stopped === true);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [item.id, needsDetail]);
  if (item.status === "finished") return executionLabel(item.progress, stopped);
  if (item.status === "error" || item.status === "interrupted")
    return "未完整完成";
  return item.status === "stopping" ? "正在收尾" : "执行中";
}

function pageKey(page: Page) {
  if (page.kind === "records")
    return "records:" + page.sourceId + ":" + page.mode;
  if ("location" in page)
    return page.kind + ":" + page.location.mode + ":" + page.location.mountId;
  return page.kind + ("id" in page ? ":" + page.id : "");
}
function definitionItems(run: Run) {
  return run.items.map(
    ({
      status: _status,
      reviews: _reviews,
      definitionHistory: _history,
      ...item
    }) => item,
  );
}
export function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [page, setPage] = useState<Page>({ kind: "home" });
  const [modal, setModal] = useState<
    | ""
    | "project"
    | "project-settings"
    | "memo"
    | "backup"
    | "mount"
    | "settings"
  >("");
  const [preparation, setPreparation] = useState<Preparation | null>(null);
  const [externalRecords, setExternalRecords] = useState<RecordedAutomation[]>(
    [],
  );
  const [externalHtml, setExternalHtml] = useState<{
    name: string;
    html: string;
  } | null>(null);
  const [samplesLoaded, setSamplesLoaded] = useState(false);
  const [executions, setExecutions] = useState<ExecutionState[]>([]);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("qa-theme") || "light",
  );
  const [feedback, setFeedback] = useState<{
    text: string;
    error: boolean;
    action?: { label: string; page: Page };
    detail?: string;
  }>({ text: "", error: false });
  const [busy, setBusy] = useState(false);
  const [progressSave, setProgressSave] = useState<{
    runId: string;
    status: "saving" | "saved" | "error";
  } | null>(null);
  const busyRef = useRef(false),
    started = useRef(false);
  const scrollPositions = useRef(new Map<string, number>());
  function navigate(next: Page) {
    if (pageKey(page) !== pageKey(next))
      scrollPositions.current.set(pageKey(page), window.scrollY);
    setPage(next);
    setFeedback((value) => (value.action ? { text: "", error: false } : value));
  }
  useEffect(() => {
    window.document.documentElement.dataset.theme = theme;
    localStorage.setItem("qa-theme", theme);
  }, [theme]);
  const locationKey = pageKey(page);
  useEffect(() => {
    window.scrollTo({ top: scrollPositions.current.get(locationKey) || 0 });
  }, [locationKey]);
  const notify = (text: string) => setFeedback({ text, error: false });
  const fail = (error: unknown) =>
    setFeedback({
      text: error instanceof Error ? error.message : String(error),
      error: true,
      detail: error instanceof PersistenceError ? error.detail : undefined,
    });
  async function task<T>(
    action: () => Promise<T>,
    onError: (error: unknown) => void = fail,
  ): Promise<T | undefined> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFeedback({ text: "", error: false });
    try {
      return await action();
    } catch (error) {
      onError(error);
      return;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!bootstrap || !hasHostAccess) return;
    let live = true,
      timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const records = await window.qa.listAutomation();
        if (live) setExecutions(records);
      } catch (error) {
        if (live) fail(error);
      }
      if (live) timer = setTimeout(read, 2000);
    }
    void read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [bootstrap]);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void Promise.all([window.qa.bootstrap(), initializeDraftStore()])
      .then(([value]) => {
        setBootstrap(value);
        setState({
          ...value.state,
          simulations: value.state.simulations.map((run) => ({
            ...run,
            status: run.status === "running" ? "paused" : run.status,
          })),
        });
      })
      .catch(fail);
  }, []);
  useEffect(() => {
    if (!feedback.text || feedback.error || feedback.action) return;
    const timer = setTimeout(
      () => setFeedback({ text: "", error: false }),
      4000,
    );
    return () => clearTimeout(timer);
  }, [feedback]);
  async function commit(next: State, onError?: (error: unknown) => void) {
    if (!state) return false;
    const saved = await task(
      () => window.qa.saveState(next, state.revision),
      onError,
    );
    if (!saved) return false;
    setState(saved);
    return true;
  }
  async function launchSelected(environment: Environment) {
    const result = await task(() =>
      window.qa.launchTarget({
        executable: environment.softwarePath,
        projectPath: environment.projectPath,
        mode: environment.launchMode || "editor",
      }),
    );
    if (result) notify(result.message);
    return !!result;
  }
  async function saveProgress(
    id: string,
    action: () => Promise<boolean | null>,
  ) {
    const previous = progressSave;
    setProgressSave({ runId: id, status: "saving" });
    const saved = await action();
    setProgressSave(
      saved === null
        ? previous
        : { runId: id, status: saved ? "saved" : "error" },
    );
    return saved === true;
  }
  function viewCases(
    mode: CaseLocation["mode"],
    mountId: string,
    nodeId?: string,
  ) {
    navigate({ kind: "case-view", location: { mode, mountId, nodeId } });
  }
  function editCases(
    mode: CaseLocation["mode"],
    mountId: string,
    nodeId?: string,
    resumeDraft?: boolean,
  ) {
    navigate({
      kind: "case-edit",
      location: { mode, mountId, nodeId, resumeDraft },
    });
  }
  function showRecords(sourceId = "", mode: RecordMode = "all") {
    navigate({
      kind: "records",
      sourceId,
      mode,
      back: page.kind === "records" ? page.back : page,
    });
  }
  function openRun(id: string, type: "manual" | "simulation") {
    navigate({
      kind: type === "manual" ? "manual-run" : "legacy-simulation",
      id,
      back: page,
    });
  }
  function prepare(mount: Mount, ids: string[], content = mount.content) {
    setPreparation({
      id: crypto.randomUUID(),
      mode: mount.editor ? "automation" : "manual",
      title: mount.name,
      content,
      mount,
      candidates: ids,
      returnTo: page,
    });
  }
  function emptyManual() {
    const content = fromRoute({
      id: crypto.randomUUID(),
      name: "探索测试",
      items: [],
    });
    setPreparation({
      id: crypto.randomUUID(),
      mode: "manual",
      title: "探索测试",
      content,
      candidates: [],
      blank: true,
      returnTo: page,
    });
  }
  function newRound(run: Run | Simulation) {
    const manual = "items" in run;
    const content = manual
      ? fromRoute({ id: run.id, name: run.title, items: definitionItems(run) })
      : structuredClone(run.content);
    setPreparation({
      id: crypto.randomUUID(),
      mode: manual ? "manual" : "automation",
      title: run.title,
      content,
      candidates: content.groups.flatMap((group) =>
        group.units.map((unit) => unit.id),
      ),
      blank: manual && !run.items.length,
      snapshot: true,
      snapshotItems: manual ? structuredClone(definitionItems(run)) : undefined,
      returnTo: page,
      target: {
        project: structuredClone(run.project),
        environment: structuredClone(run.environment),
      },
    });
  }
  async function begin(selection: PreparedSelection) {
    if (!state || !preparation) return false;
    const testEnvironment = {
      ...selection.environment,
      version: selection.version,
      lastUsedAt: new Date().toISOString(),
    };
    const environments = state.environments.some(
      (env) => env.id === testEnvironment.id,
    )
      ? state.environments.map((env) =>
          env.id === testEnvironment.id ? testEnvironment : env,
        )
      : [...state.environments, testEnvironment];
    const projects = state.projects.some(
      (project) => project.id === selection.project.id,
    )
      ? state.projects
      : [...state.projects, selection.project];
    const nextBase = {
      ...state,
      projects,
      environments,
      selectedProjectId: selection.project.id,
      selectedEnvironmentId: testEnvironment.id,
    };
    if (selection.executionId) {
      if (!(await commit(nextBase))) return false;
      const execution = await window.qa.startAutomation(selection.executionId);
      setExecutions((records) => [
        execution,
        ...records.filter((item) => item.id !== execution.id),
      ]);
      navigate({
        kind: "automation-run",
        id: execution.id,
        back: preparation.returnTo,
      });
      return true;
    }
    if (preparation.mode === "manual") {
      const run: Run = {
        id: crypto.randomUUID(),
        title: preparation.title,
        project: structuredClone(selection.project),
        environment: structuredClone(testEnvironment),
        startedAt: new Date().toISOString(),
        conclusion: "",
        source: {
          name: preparation.title,
          revision: preparation.snapshot ? "历史用例快照" : "已保存用例快照",
          hash: "",
          moduleId: preparation.mount?.id || "manual",
        },
        items: (preparation.blank
          ? []
          : preparation.snapshotItems ||
            contentSteps(preparation.content, new Set(selection.ids))
        ).map((item) => ({
          ...item,
          id: crypto.randomUUID(),
          status: "unchecked",
          reviews: [],
        })),
        issues: [],
      };
      if (await commit({ ...nextBase, runs: [...state.runs, run] })) {
        navigate({
          kind: "manual-run",
          id: run.id,
          back: preparation.returnTo,
        });
        return true;
      }
    } else {
      const content = structuredClone(preparation.content);
      const selected = new Set(selection.ids);
      content.groups = orderedContentGroups(content).map((group) => ({
        ...group,
        units: group.units
          .filter((unit) => selected.has(unit.id))
          .map((unit) => ({
            ...unit,
            stages: sequenceOf(unit).map((step) => step.title),
          })),
      }));
      if (!content.groups.some((group) => group.units.length))
        throw new Error("请先选择本轮用例");
      if (
        content.groups.some((group) =>
          group.units.some((unit) => !sequenceOf(unit).length),
        )
      )
        throw new Error("所选链路尚无检查项，请先完成用例再模拟");
      const simulation: Simulation = {
        progressBasis: "steps",
        id: crypto.randomUUID(),
        title: preparation.title,
        startedAt: new Date().toISOString(),
        project: structuredClone(selection.project),
        environment: structuredClone(testEnvironment),
        content,
        status: "running",
        units: content.groups
          .flatMap((group) =>
            group.units.map((unit) => ({
              id: unit.id,
              group: group.title,
              title: unit.title,
              stage: 0,
              status: "queued" as const,
              evidence: "",
            })),
          )
          .sort(
            (a, b) => selection.ids.indexOf(a.id) - selection.ids.indexOf(b.id),
          ),
      };
      if (
        await commit({
          ...nextBase,
          simulations: [...state.simulations, simulation],
        })
      ) {
        navigate({
          kind: "legacy-simulation",
          id: simulation.id,
          back: preparation.returnTo,
        });
        return true;
      }
    }
    return false;
  }
  // Existing simulated records retain their own snapshots. No process is launched.
  useEffect(() => {
    if (!state?.simulations.some((run) => run.status === "running")) return;
    const timer = setTimeout(() => {
      if (busyRef.current) return;
      const simulations = state.simulations.map((run) => {
        if (run.status !== "running") return run;
        const next = structuredClone(run);
        const unit = next.units.find(
          (item) => item.status === "queued" || item.status === "running",
        );
        if (!unit) {
          next.status = "done";
          return next;
        }
        const definition = next.content.groups
          .flatMap((group) => group.units)
          .find((item) => item.id === unit.id)!;
        if (unit.status === "queued") unit.status = "running";
        else {
          unit.stage++;
          if (
            unit.stage >=
            (next.progressBasis === "steps"
              ? sequenceOf(definition).length
              : definition.stages.length)
          ) {
            unit.status = next.units.indexOf(unit) === 1 ? "failed" : "passed";
            unit.evidence =
              unit.status === "failed"
                ? "模拟异常：仅演示定位和人工补查，没有执行真实测试。"
                : "";
          }
        }
        if (
          next.units.every(
            (item) => item.status === "passed" || item.status === "failed",
          )
        )
          next.status = "done";
        return next;
      });
      void commit({ ...state, simulations });
    }, 1600);
    return () => clearTimeout(timer);
  }, [state, busy]);
  async function mountContent(content: TestContent, sourceName: string) {
    if (!state) return false;
    const mount = {
      id: crypto.randomUUID(),
      name: content.name,
      sourceName,
      content,
    };
    if (await commit({ ...state, mounts: [...state.mounts, mount] })) {
      viewCases("manual", mount.id);
      return true;
    }
    return false;
  }
  async function followSimulation(simulation: Simulation, unitId: string) {
    if (!state) return;
    const unit = simulation.units.find((item) => item.id === unitId)!;
    const run: Run = {
      id: crypto.randomUUID(),
      title: unit.title + " · 人工补查",
      startedAt: new Date().toISOString(),
      project: structuredClone(simulation.project),
      environment: structuredClone(simulation.environment),
      source: {
        name: simulation.title,
        revision: "模拟记录",
        hash: "",
        moduleId: "simulation",
      },
      simulationSource: { runId: simulation.id, unitId, result: unit.status },
      conclusion: "",
      items: contentSteps(simulation.content, new Set([unitId])).map(
        (item) => ({ ...item, status: "unchecked", reviews: [] }),
      ),
      issues: [],
    };
    if (await commit({ ...state, runs: [...state.runs, run] }))
      navigate({ kind: "manual-run", id: run.id, back: page });
  }
  async function followRecord(
    record: RecordedAutomation,
    item: AutomationProgress["cases"][number],
  ) {
    if (!state) return;
    const raw = record.result;
    const pink =
      raw.pink && typeof raw.pink === "object"
        ? (raw.pink as Record<string, unknown>)
        : {};
    const projectPath = typeof raw.project === "string" ? raw.project : "";
    const project = {
      id: crypto.randomUUID(),
      name:
        projectPath.split(/[/\\]/).filter(Boolean).at(-1) || "外部报告测试对象",
      description: "由原报告保留的对象快照",
    };
    const environment = {
      id: crypto.randomUUID(),
      projectId: project.id,
      name: "报告中的测试目标",
      version: typeof pink.version === "string" ? pink.version : "",
      softwarePath: typeof pink.path === "string" ? pink.path : "",
      projectPath,
      materialsPath: "",
      notes: "来自历史报告，不采用工作台当前目标",
    };
    const run: Run = {
      id: crypto.randomUUID(),
      title: item.title + " · 人工补查",
      startedAt: new Date().toISOString(),
      project,
      environment,
      source: {
        name: record.title,
        revision: record.id,
        hash: item.caseId,
        moduleId: "pink-build",
      },
      conclusion: "",
      issues: [],
      items: [
        {
          id: crypto.randomUUID(),
          title: item.title,
          action: item.failure?.reason || "依据原报告复查该项",
          expected: "由 QA 复查并记录实际结果，保留自动化原判定。",
          status: "unchecked",
          reviews: [],
          details: [
            {
              title: "自动化原记录",
              fields: [
                { label: "原始状态", value: item.status },
                { label: "用例 ID", value: item.caseId },
                { label: "结果来源", value: record.id },
                ...item.evidence.flatMap((evidence) =>
                  [evidence.screenshot, evidence.scene, evidence.unavailable]
                    .filter(Boolean)
                    .map((value) => ({
                      label: evidence.stepId,
                      value: value!,
                    })),
                ),
              ],
            },
          ],
        },
      ],
    };
    if (await commit({ ...state, runs: [...state.runs, run] }))
      navigate({ kind: "manual-run", id: run.id, back: page });
  }
  async function openReport() {
    await task(async () => {
      const file = await chooseFile(".json,.html,.htm");
      if (!file) return;
      const text = await file.text();
      if (/\.html?$/i.test(file.name)) {
        setExternalHtml({ name: file.name, html: text });
        return;
      }
      const record = readAutomationResult(JSON.parse(text), file.name);
      setExternalRecords((records) => [
        ...records.filter((item) => item.id !== record.id),
        record,
      ]);
      navigate({ kind: "automation-run", id: record.id, back: page });
    });
  }
  async function loadSamples() {
    if (!import.meta.env.DEV) return;
    await task(async () => {
      const records = (
        await import("./integrations/pink-build/deliverySamples")
      ).deliverySamples();
      setExternalRecords((current) => [
        ...current.filter(
          (item) => !records.some((sample) => sample.id === item.id),
        ),
        ...records,
      ]);
      setSamplesLoaded(true);
    });
  }
  async function saveTarget(next: State) {
    if (!(await commit(next))) return false;
    setPreparation((value) => (value ? { ...value, target: undefined } : null));
    return true;
  }
  const currentProject = state?.projects.find(
    (project) => project.id === state.selectedProjectId,
  );
  const currentEnvironment = state?.environments.find(
    (env) => env.id === state.selectedEnvironmentId,
  );
  const run =
    page.kind === "manual-run"
      ? state?.runs.find((item) => item.id === page.id)
      : undefined;
  const simulation =
    page.kind === "legacy-simulation"
      ? state?.simulations.find((item) => item.id === page.id)
      : undefined;
  const external =
    page.kind === "automation-run"
      ? externalRecords.find((item) => item.id === page.id)
      : undefined;
  const execution =
    page.kind === "automation-run"
      ? executions.find((item) => item.id === page.id)
      : undefined;
  const location = "location" in page ? page.location : undefined;
  const continueTests = (mode?: "manual" | "automation") =>
    state && (
      <>
        <ContinueTests
          state={state}
          mode={mode}
          open={openRun}
          all={() => showRecords("", mode || "all")}
        />
        {mode !== "manual" &&
          executions
            .filter((item) =>
              ["starting", "running", "stopping"].includes(item.status),
            )
            .map((item) => (
              <button
                className="run-row"
                key={item.id}
                onClick={() =>
                  navigate({ kind: "automation-run", id: item.id, back: page })
                }
              >
                <strong>{item.preview.title}</strong>
                <span>
                  {executionModeLabel(
                    item.preview.executionMode,
                    item.preview.reportOnly,
                  )}{" "}
                  · {item.status === "stopping" ? "正在收尾" : "执行中"}
                </span>
                <span>查看进度 →</span>
              </button>
            ))}
      </>
    );
  if (!state || !bootstrap)
    return (
      <div className="startup">
        <h1>QA 工作台</h1>
        <p role="alert">{feedback.text || "正在读取本机记录…"}</p>
        {feedback.detail && (
          <details>
            <summary>错误详情</summary>
            <p>{feedback.detail}</p>
          </details>
        )}
        <p className="hint">记录读取失败时不会覆盖原数据。</p>
      </div>
    );
  const recordsSource = page.kind === "records" ? page.sourceId : "";
  const recordMode = page.kind === "records" ? page.mode : "all";
  const recordSource = state.mounts.find((item) => item.id === recordsSource);
  const showManual = recordMode !== "automation" && !recordsSource;
  const showAuto = recordMode !== "manual";
  const simulations = state.simulations.filter(
    (item) => !recordSource || item.content.id === recordSource.content.id,
  );
  const recordTitle = recordsSource
    ? (recordSource?.name || "来源已移除") + " · 运行记录"
    : "测试记录";
  const backPage: Page = "back" in page ? page.back : { kind: "home" };
  return (
    <Feedback.Provider value={feedback}>
      <fieldset
        className="application"
        disabled={busy}
        aria-busy={busy}
        onClick={(event) => {
          (event.target as HTMLElement)
            .closest("button")
            ?.closest("details.more-menu")
            ?.removeAttribute("open");
        }}
      >
        <header className="app-header">
          <button className="brand" onClick={() => navigate({ kind: "home" })}>
            <span className="brand-mark">✓</span> QA 工作台
          </button>
          <div className="header-tools">
            <button onClick={() => showRecords()}>测试记录</button>
            <button onClick={() => setModal("memo")}>备忘录</button>
            <details className="more-menu">
              <summary aria-label="更多功能">•••</summary>
              <div>
                <button onClick={() => setModal("settings")}>设置</button>
                <button onClick={() => setModal("backup")}>备份与恢复</button>
                <button
                  onClick={() => setTheme(theme === "light" ? "dark" : "light")}
                >
                  切换深浅主题
                </button>
              </div>
            </details>
          </div>
        </header>
        <main
          className={page.kind === "home" ? "main home-main" : "main"}
          data-page={page.kind}
        >
          {feedback.text && (
            <div
              role={feedback.error ? "alert" : "status"}
              className={"feedback " + (feedback.error ? "error" : "")}
            >
              <span className="feedback-message">
                {feedback.text}
                {feedback.action && (
                  <button
                    className="text-button"
                    onClick={() => navigate(feedback.action!.page)}
                  >
                    {feedback.action.label}
                  </button>
                )}
              </span>
              {feedback.detail && (
                <details>
                  <summary>错误详情</summary>
                  <small>{feedback.detail}</small>
                </details>
              )}
              <button
                aria-label="关闭提示"
                onClick={() => setFeedback({ text: "", error: false })}
              >
                ×
              </button>
            </div>
          )}
          {page.kind === "home" && (
            <section>
              <div className="page-heading">
                <div>
                  <h1>今天，从哪里开始？</h1>
                </div>
              </div>
              <div className="testing-entries">
                <button onClick={() => navigate({ kind: "manual-entry" })}>
                  <h2>自己测试</h2>
                  <p>使用已有链路，或边测边记录。</p>
                  <span>进入 →</span>
                </button>
                <button onClick={() => navigate({ kind: "automation-entry" })}>
                  <h2>自动化测试</h2>
                  <p>选择接入的工具和链路，查看用例与进度。</p>
                  <span>
                    {!hasHostAccess
                      ? "进入 · 模拟 →"
                      : "进入 · 真实执行 / 模拟 →"}
                  </span>
                </button>
              </div>
              {continueTests()}
              <section className="home-target">
                <div className="section-heading">
                  <h2>测试目标</h2>
                  <button
                    className="text-button"
                    onClick={() => setModal("project")}
                  >
                    {currentEnvironment ? "更换目标" : "选择目标"}
                  </button>
                </div>
                <div className="home-current-target">
                  <div>
                    <strong>
                      {targetLabel(currentProject, currentEnvironment)}
                    </strong>
                    {currentEnvironment?.softwarePath && (
                      <p className="target-path">
                        {currentEnvironment.softwarePath}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() =>
                      currentEnvironment?.softwarePath
                        ? void launchSelected(currentEnvironment)
                        : setModal("project")
                    }
                  >
                    {!hasHostAccess ? "模拟启动编辑器" : "启动编辑器"}
                  </button>
                </div>
                {state.environments
                  .filter((env) => env.id !== currentEnvironment?.id)
                  .sort((a, b) =>
                    (b.lastUsedAt || "").localeCompare(a.lastUsedAt || ""),
                  )
                  .slice(0, 3)
                  .map((env) => {
                    const project = state.projects.find(
                      (item) => item.id === env.projectId,
                    );
                    return (
                      <div className="recent-target-row" key={env.id}>
                        <button
                          className="text-button"
                          onClick={() =>
                            void commit({
                              ...state,
                              selectedProjectId: env.projectId,
                              selectedEnvironmentId: env.id,
                            })
                          }
                        >
                          <span>
                            {editorName(env.softwarePath)} {env.version}
                          </span>
                          <small>→ {project?.name}</small>
                        </button>
                        <button
                          className="quiet"
                          onClick={() => void launchSelected(env)}
                        >
                          {!hasHostAccess ? "模拟启动" : "启动"}
                        </button>
                      </div>
                    );
                  })}
              </section>
            </section>
          )}
          {page.kind === "manual-entry" && (
            <>
              <ManualEntry
                continuation={continueTests("manual")}
                state={state}
                back={() => navigate({ kind: "home" })}
                view={(id, unit) => viewCases("manual", id, unit)}
                edit={(id, unit) => editCases("manual", id, unit)}
                start={(mount, ids) => prepare(mount, ids)}
                blank={emptyManual}
                importContent={() => setModal("mount")}
              />
            </>
          )}
          {(page.kind === "automation-entry" ||
            location?.mode === "automation") && (
            <>
              <AutomationWorkspace
                modules={bootstrap.modules}
                continuation={continueTests("automation")}
                state={state}
                screen={
                  page.kind === "automation-entry"
                    ? "entry"
                    : page.kind === "case-edit"
                      ? "edit"
                      : "view"
                }
                mountId={location?.mountId}
                nodeId={location?.nodeId}
                resume={location?.resumeDraft}
                save={commit}
                back={() =>
                  navigate({
                    kind:
                      page.kind === "automation-entry"
                        ? "home"
                        : "automation-entry",
                  })
                }
                view={(id, node) => viewCases("automation", id, node)}
                edit={(id, node, resume) =>
                  editCases("automation", id, node, resume)
                }
                prepare={(mount, content, ids) => prepare(mount, ids, content)}
                records={(id) => showRecords(id, "automation")}
              />
            </>
          )}
          {location?.mode === "manual" && (
            <ChainWorkspace
              key={page.kind + ":" + location.mountId}
              state={state}
              mountId={location.mountId}
              unitId={location.nodeId}
              editing={page.kind === "case-edit"}
              resume={location.resumeDraft}
              save={commit}
              back={() => navigate({ kind: "manual-entry" })}
              view={(id, unit) => viewCases("manual", id, unit)}
              edit={(id, unit, resume) => editCases("manual", id, unit, resume)}
              prepare={(mount, ids) => prepare(mount, ids)}
              importContent={() => setModal("mount")}
            />
          )}
          {page.kind === "records" && (
            <section data-page="records">
              <button
                className="text-button"
                onClick={() => navigate(page.back)}
              >
                ← {returnLabel(page.back)}
              </button>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">查看原记录，继续检查与复查</p>
                  <h1>{recordTitle}</h1>
                </div>
                <button onClick={() => void openReport()}>打开已有报告</button>
              </div>
              <div className="records-filters">
                {recordsSource ? (
                  <button
                    className="text-button"
                    onClick={() =>
                      navigate({ ...page, sourceId: "", mode: "automation" })
                    }
                  >
                    查看全部自动化记录
                  </button>
                ) : (
                  (["all", "manual", "automation"] as const).map((mode) => (
                    <button
                      key={mode}
                      className={recordMode === mode ? "selected" : "quiet"}
                      aria-pressed={recordMode === mode}
                      onClick={() => navigate({ ...page, mode })}
                    >
                      {
                        {
                          all: "全部",
                          manual: "人工测试",
                          automation: "自动化",
                        }[mode]
                      }
                    </button>
                  ))
                )}
              </div>
              {showManual && (
                <section className="records-section">
                  <h2>人工测试</h2>
                  {state.runs.length ? (
                    [...state.runs].reverse().map((item) => (
                      <div className="record-list-row" key={item.id}>
                        <button
                          className="run-row"
                          onClick={() => openRun(item.id, "manual")}
                        >
                          <div>
                            <strong>{item.title}</strong>
                            <p>
                              {item.project.name} ·{" "}
                              {item.environment.version || "未填写版本"} ·{" "}
                              {new Date(item.startedAt).toLocaleString()}
                            </p>
                          </div>
                          <span className="badge">
                            {item.finishedAt ? "已整理 · 可复查" : "进行中"}
                          </span>
                          <span>
                            {
                              item.items.filter(
                                (step) => step.status !== "unchecked",
                              ).length
                            }
                            /{item.items.length}
                          </span>
                        </button>
                        <button
                          className="text-button"
                          onClick={() => newRound(item)}
                        >
                          开始新一轮
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="empty">还没有人工记录，可从自己测试开始。</p>
                  )}
                </section>
              )}
              {showAuto && hasHostAccess && (
                <section className="records-section">
                  <h2>本机真实执行</h2>
                  {executions
                    .filter(
                      (item) =>
                        !recordsSource ||
                        item.preview.sourceId === recordsSource,
                    )
                    .map((item) => (
                      <button
                        className="run-row"
                        key={item.id}
                        onClick={() =>
                          navigate({
                            kind: "automation-run",
                            id: item.id,
                            back: page,
                          })
                        }
                      >
                        <div>
                          <strong>{item.preview.title}</strong>
                          <p>
                            {item.preview.version || "未填写版本"} ·{" "}
                            {new Date(item.startedAt).toLocaleString()}
                          </p>
                        </div>
                        <span className="badge">
                          {executionModeLabel(
                            item.preview.executionMode,
                            item.preview.reportOnly,
                          )}
                        </span>
                        <span>
                          <ExecutionOutcome item={item} />
                        </span>
                      </button>
                    ))}
                  {!executions.some(
                    (item) =>
                      !recordsSource || item.preview.sourceId === recordsSource,
                  ) && (
                    <p className="empty">
                      还没有本机真实执行记录，可从自动化入口确认范围后开始。
                    </p>
                  )}
                </section>
              )}
              {showAuto && (
                <section className="records-section">
                  <h2>模拟运行</h2>
                  {simulations.length ? (
                    simulations
                      .slice()
                      .reverse()
                      .map((item) => (
                        <div className="record-list-row" key={item.id}>
                          <button
                            className="run-row"
                            onClick={() => openRun(item.id, "simulation")}
                          >
                            <div>
                              <strong>{item.title}</strong>
                              <p>
                                {item.environment.version || "未填写版本"} ·{" "}
                                {new Date(item.startedAt).toLocaleString()}
                              </p>
                            </div>
                            <span className="badge">模拟</span>
                            <span>
                              {item.status === "done"
                                ? "已结束"
                                : item.status === "running"
                                  ? "演示中"
                                  : "已暂停"}
                            </span>
                          </button>
                          <button
                            className="text-button"
                            onClick={() => newRound(item)}
                          >
                            开始新一轮
                          </button>
                        </div>
                      ))
                  ) : (
                    <p className="empty">这里还没有模拟运行记录。</p>
                  )}
                </section>
              )}
              {showAuto && !recordsSource && (
                <section className="records-section external-records">
                  <div className="section-heading">
                    <h2>独立工具的原始记录</h2>
                    {import.meta.env.DEV && !samplesLoaded && (
                      <button
                        className="text-button"
                        onClick={() => void loadSamples()}
                      >
                        载入执行侧交付记录
                      </button>
                    )}
                  </div>
                  <p className="hint">
                    与本轮模拟分开显示；查看和回放不会重新执行。
                  </p>
                  {externalRecords.map((item) => (
                    <button
                      key={item.id}
                      className="run-row"
                      onClick={() =>
                        navigate({
                          kind: "automation-run",
                          id: item.id,
                          back: page,
                        })
                      }
                    >
                      <div>
                        <strong>{item.title}</strong>
                        <p>
                          {item.source} ·{" "}
                          {new Date(item.progress.updatedAt).toLocaleString()}
                        </p>
                      </div>
                      <span className="badge">真实历史</span>
                      <span>
                        通过 {item.progress.summary.passed}/
                        {item.progress.summary.total}
                        {item.progress.summary.blocked
                          ? " · 受阻 " + item.progress.summary.blocked
                          : ""}
                      </span>
                    </button>
                  ))}
                  {!externalRecords.length && (
                    <p className="empty">
                      可打开执行侧 result.json 或 HTML
                      报告。原文件保留在原位置。
                    </p>
                  )}
                </section>
              )}
            </section>
          )}
          {simulation && (
            <SimulationView
              run={simulation}
              runs={state.runs}
              back={() => navigate(backPage)}
              backLabel={returnLabel(backPage)}
              newRound={() => newRound(simulation)}
              update={(value) =>
                commit({
                  ...state,
                  simulations: state.simulations.map((item) =>
                    item.id === value.id ? value : item,
                  ),
                })
              }
              follow={(id) => void followSimulation(simulation, id)}
              openManual={(id) => openRun(id, "manual")}
            />
          )}
          {execution && (
            <LiveAutomationView
              key={execution.id}
              id={execution.id}
              runs={state.runs}
              back={() => navigate(backPage)}
              backLabel={returnLabel(backPage)}
              follow={(record, item) => {
                setExternalRecords((records) =>
                  records.some((r) => r.id === record.id)
                    ? records
                    : [...records, record],
                );
                void followRecord(record, item);
              }}
              openManual={(id) => openRun(id, "manual")}
            />
          )}
          {external && !execution && (
            <AutomationRecordView
              key={external.id}
              record={external}
              runs={state.runs}
              back={() => navigate(backPage)}
              backLabel={returnLabel(backPage)}
              follow={(item) => void followRecord(external, item)}
              openManual={(id) => openRun(id, "manual")}
            />
          )}
          {run && (
            <ManualRun
              key={run.id}
              run={run}
              reviewing={page.kind === "manual-run" && !!page.reviewing}
              setReviewing={(reviewing) => {
                if (page.kind === "manual-run")
                  navigate({ ...page, reviewing });
              }}
              goHome={() => navigate({ kind: "home" })}
              back={() => navigate(backPage)}
              backLabel={returnLabel(backPage)}
              finished={() => {
                navigate(backPage);
                setFeedback({
                  text: "本轮测试已结束",
                  error: false,
                  action: {
                    label: "查看结果",
                    page: { kind: "manual-run", id: run.id, back: backPage },
                  },
                });
              }}
              newRound={() => newRound(run)}
              saveStatus={
                progressSave?.runId === run.id ? progressSave.status : "saved"
              }
              viewSource={() => {
                const local = executions.find(
                  (item) => item.progress?.runId === run.source.revision,
                );
                if (run.simulationSource) {
                  if (
                    backPage.kind === "legacy-simulation" &&
                    backPage.id === run.simulationSource.runId
                  )
                    navigate(backPage);
                  else
                    navigate({
                      kind: "legacy-simulation",
                      id: run.simulationSource.runId,
                      back: page,
                    });
                } else if (local) {
                  navigate(
                    backPage.kind === "automation-run" &&
                      backPage.id === local.id
                      ? backPage
                      : { kind: "automation-run", id: local.id, back: page },
                  );
                } else if (
                  externalRecords.some(
                    (item) => item.id === run.source.revision,
                  )
                ) {
                  if (
                    backPage.kind === "automation-run" &&
                    backPage.id === run.source.revision
                  )
                    navigate(backPage);
                  else
                    navigate({
                      kind: "automation-run",
                      id: run.source.revision,
                      back: page,
                    });
                } else {
                  showRecords("", "automation");
                  notify("请重新打开原报告，人工补查记录与来源引用已保留。");
                }
              }}
              update={(value) =>
                saveProgress(value.id, () =>
                  commit({
                    ...state,
                    runs: state.runs.map((item) =>
                      item.id === value.id ? value : item,
                    ),
                  }),
                )
              }
              attach={async (issueId) => {
                await saveProgress(run.id, async () => {
                  const next = await task(() =>
                    window.qa.addAttachment(run.id, issueId, state.revision),
                  );
                  if (next) {
                    setState(next);
                    notify("证据已保存，可随个人备份携带");
                  }
                  return next === null ? null : !!next;
                });
              }}
              openAttachment={(issueId, attachmentId) => {
                void task(() =>
                  window.qa.openAttachment(run.id, issueId, attachmentId),
                );
              }}
              exportRun={() => {
                void task(() => window.qa.exportRun(run.id)).then((path) => {
                  if (path) notify("结果已导出；完整附件请使用个人备份");
                });
              }}
              report={notify}
              saveRoute={(route: Route) =>
                commit({ ...state, routes: [...state.routes, route] })
              }
            />
          )}
        </main>
        {preparation && (
          <TestPreparation
            key={preparation.id}
            context={preparation}
            state={state}
            suspended={!!modal}
            close={() => setPreparation(null)}
            target={() => setModal("project")}
            start={begin}
            executionEnabled={
              !!bootstrap.modules.find(
                (module) =>
                  module.id === preparation.mount?.editor?.moduleId &&
                  module.capabilities.preview &&
                  module.capabilities.start,
              )
            }
            editDraft={
              preparation.mount
                ? (nodeId) => {
                    const mount = preparation.mount!;
                    setPreparation(null);
                    editCases(
                      mount.editor ? "automation" : "manual",
                      mount.id,
                      nodeId,
                      !nodeId,
                    );
                  }
                : undefined
            }
          />
        )}
        {modal === "mount" && (
          <MountDialog save={mountContent} close={() => setModal("")} />
        )}
        {modal === "project" && (
          <ProjectChooser
            state={state}
            save={saveTarget}
            close={() => setModal("")}
            advanced={() => setModal("project-settings")}
            launch={launchSelected}
          />
        )}
        {modal === "project-settings" && (
          <ProjectDialog
            state={state}
            save={saveTarget}
            close={() => setModal("")}
          />
        )}
        {modal === "memo" && (
          <Memo
            value={state.memo}
            close={() => setModal("")}
            save={async (memo) => {
              return commit({ ...state, memo });
            }}
          />
        )}
        {externalHtml && (
          <OriginalReport
            title={externalHtml.name}
            html={externalHtml.html}
            close={() => setExternalHtml(null)}
          />
        )}
        {modal === "settings" && (
          <SettingsDialog
            close={() => setModal("")}
            backup={() => setModal("backup")}
            saved={(settings) => {
              setBootstrap((value) =>
                value ? { ...value, moduleRoot: settings.moduleRoot } : value,
              );
              setModal("");
              notify("设置已保存，仅对新计划生效");
            }}
          />
        )}
        {modal === "backup" && (
          <Dialog title="个人备份与恢复" onClose={() => setModal("")}>
            <p>
              备份包含项目、目标、已保存用例、备忘录、人工与模拟记录及证据。外部报告和本机真实执行目录请另外保留。
            </p>
            <p className="hint">
              恢复前会保留当前记录副本{browserMode && "，可在此导出"}
              。未保存的编辑草稿仍留在本机，请先保存重要草稿再导出。
            </p>
            <code className="path-block">{bootstrap.dataPath}</code>
            <footer className="dialog-actions">
              <button
                onClick={() => {
                  void task(() => window.qa.exportBackup()).then((path) => {
                    if (path) notify("个人备份已保存");
                  });
                }}
              >
                导出个人备份
              </button>
              {browserMode && (
                <button
                  onClick={() => {
                    void task(exportBeforeRestoreBackup).then((path) => {
                      if (path) notify("恢复前副本已导出");
                    });
                  }}
                >
                  导出恢复前副本
                </button>
              )}
              <button
                onClick={() => {
                  void task(() => window.qa.restoreBackup(state.revision)).then(
                    (next) => {
                      if (next) {
                        setState(next);
                        navigate({ kind: "home" });
                        setPreparation(null);
                        setModal("");
                        notify("记录已恢复，请核对本机目标路径");
                      }
                    },
                  );
                }}
              >
                从备份恢复
              </button>
            </footer>
          </Dialog>
        )}
      </fieldset>
    </Feedback.Provider>
  );
}
