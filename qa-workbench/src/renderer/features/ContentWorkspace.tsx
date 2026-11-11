import { useState } from "react";
import {
  contentSchema,
  orderedContentGroups,
  type TestContent,
  type ContentUnit,
  type Detail,
  type Mount,
} from "../../shared/content";
import {
  routeFileSchema,
  type State,
  type Step,
  type Simulation,
  type Project,
  type Environment,
} from "../../shared/model";
import { TestRunSetup } from "./TestRunSetup";
import { sequenceOf, SequenceList } from "./routes/RouteSequence";
import {
  hasPendingContentDraft,
  type ContentEditTarget,
} from "./ContentEditor";
import { Dialog } from "../components/Dialog";
import { chooseFile, download, browserMode } from "../browserBridge";

export function ContentDetails({ details }: { details: Detail }) {
  return (
    <div className="domain-details">
      {details.map((section, i) => (
        <section key={i}>
          <h3>{section.title}</h3>
          {section.fields.map((f, n) => (
            <div className="domain-field" key={n}>
              <span>{f.label}</span>
              <span>{f.value}</span>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
export function contentSteps(content: TestContent, ids: Set<string>): Step[] {
  return orderedContentGroups(content).flatMap((g) =>
    g.units
      .filter((u) => ids.has(u.id))
      .flatMap((u) =>
        sequenceOf(u).map((s) => ({
          ...s,
          id: crypto.randomUUID(),
          sourceId: content.id + ":" + u.id + ":" + s.id,
          group: [g.title, u.title, s.group].filter(Boolean).join(" / "),
          details: s.target
            ? [
                ...u.details,
                {
                  title: "测试对象",
                  fields: [{ label: "本步骤对象", value: s.target }],
                },
              ]
            : u.details,
        })),
      ),
  );
}
export function fromRoute(route: State["routes"][number]): TestContent {
  return contentSchema.parse({
    kind: "qa-test-content",
    schemaVersion: 1,
    id: route.id,
    name: route.name,
    groups: [
      {
        id: "route",
        title: route.name,
        units: [
          {
            id: route.id,
            title: route.name,
            steps: route.items,
            details: route.items.flatMap((i) => i.details || []),
          },
        ],
      },
    ],
  });
}
function example(kind: "build" | "scene"): TestContent {
  const build = kind === "build";
  return contentSchema.parse({
    kind: "qa-test-content",
    schemaVersion: 1,
    id: "example-" + kind,
    name: build ? "构建验证 · 示例" : "场景交互 · 示例",
    groups: (build ? ["Web 手机", "Web 桌面"] : ["主菜单", "背包"]).map(
      (group, gi) => ({
        id: "g" + gi,
        title: group,
        units: (build
          ? ["发布组合", "调试组合"]
          : ["进入并返回", "状态恢复"]
        ).map((title, ui) => ({
          id: `u${gi}${ui}`,
          title,
          summary: build
            ? `调试 ${ui ? "开" : "关"} · MD5 ${ui ? "关" : "开"}`
            : "进入 → 操作 → 返回",
          stages: build
            ? ["应用配置", "构建", "检查输出"]
            : ["准备场景", "交互", "核对状态"],
          details: build
            ? [
                {
                  title: "公共配置",
                  fields: [
                    { label: "调试模式", value: ui ? "开" : "关" },
                    { label: "MD5 缓存", value: ui ? "关" : "开" },
                  ],
                },
                {
                  title: "专属配置",
                  fields: [
                    { label: "平台", value: group },
                    { label: "方向", value: gi ? "自适应" : "竖屏" },
                  ],
                },
              ]
            : [
                {
                  title: "交互流程",
                  fields: [
                    { label: "场景", value: group },
                    { label: "路径", value: "进入 → 操作 → 返回" },
                  ],
                },
                {
                  title: "检查条件",
                  fields: [{ label: "返回状态", value: "入口可再次操作" }],
                },
              ],
          steps: [
            {
              id: "prepare",
              title: build ? "核对配置" : "确认初始状态",
              action: build
                ? "按配置概览设置并重新打开。"
                : "进入目标场景，确认入口可用。",
              expected: build
                ? "公共与专属配置正确保留。"
                : "控件可见，初始状态正确。",
            },
            {
              id: "check",
              title: build ? "检查输出与运行" : "完成交互并返回",
              action: build
                ? "检查本次输出，打开产物。"
                : "按交互路径操作，返回后再次尝试。",
              expected: build
                ? "输出完整，基本场景可用。"
                : "返回后入口恢复可用。",
            },
          ],
        })),
      }),
    ),
  });
}
export function MountDialog({
  save,
  close,
}: {
  save: (content: TestContent, source: string) => Promise<boolean>;
  close: () => void;
}) {
  const [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  async function mount(content: TestContent, source: string) {
    setPending(true);
    try {
      if (await save(content, source)) close();
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  }
  async function importContent() {
    setError("");
    try {
      const file = await chooseFile();
      if (!file) return;
      const raw = JSON.parse(await file.text());
      const content =
        raw.kind === "qa-personal-route"
          ? fromRoute({
              ...routeFileSchema.parse(raw),
              id: crypto.randomUUID(),
            })
          : contentSchema.parse(raw);
      await mount(content, file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <Dialog title="导入人工测试链路" onClose={close}>
      <p className="hint">
        导入操作描述和预期结果，由 QA 逐项检查。自动化用例请从自动化入口载入。
      </p>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <fieldset disabled={pending} className="plain-fieldset">
        <button
          className="primary wide-button"
          onClick={() => void importContent()}
        >
          选择测试内容 / 个人链路 JSON
        </button>
        <details>
          <summary>体验人工检查示例</summary>
          <p className="hint">
            示例只演示操作描述和预期结果，不代表自动化能力。
          </p>
          <div className="toolbar">
            <button
              onClick={() => void mount(example("scene"), "用户选择的模拟示例")}
            >
              挂载场景示例
            </button>
            <button
              onClick={() =>
                download("test-content.example.json", example("scene"))
              }
            >
              下载格式示例
            </button>
          </div>
        </details>
      </fieldset>
    </Dialog>
  );
}
export { ContentEditor } from "./ContentEditor";
export function ContentPlan({
  mount,
  project,
  environment,
  selectProject,
  manual,
  simulate,
  edit,
  unmount,
  mode = "both",
  back,
}: {
  mount: Mount;
  project?: Project;
  environment?: Environment;
  selectProject: () => void;
  manual: (steps: Step[], version: string) => void;
  simulate: (content: TestContent, version: string) => void;
  edit: (target?: ContentEditTarget) => void;
  unmount: () => void;
  mode?: "manual" | "automation" | "both";
  back: () => void;
}) {
  const all = orderedContentGroups(mount.content).flatMap((g) => g.units);
  const available = all.filter((u) => u.steps.length);
  const [selected, setSelected] = useState(
      () => new Set(available.map((u) => u.id)),
    ),
    [detail, setDetail] = useState<ContentUnit | null>(null);
  const selectedIds = new Set(
    available.filter((u) => selected.has(u.id)).map((u) => u.id),
  );
  const groupUnits = (id: string): ContentUnit[] =>
    mount.content.groups
      .filter((g) => g.id === id)
      .flatMap((g) => [
        ...g.units,
        ...mount.content.groups
          .filter((child) => child.parentId === id)
          .flatMap((child) => groupUnits(child.id)),
      ]);
  function renderGroups(parent?: string): React.ReactNode {
    return mount.content.groups
      .filter((g) => g.parentId === parent)
      .map((g) => (
        <details className="unit-group" open key={g.id}>
          <summary>
            {g.title}
            <small>{groupUnits(g.id).length} 条链路</small>
          </summary>
          {g.units.map((u) => (
            <div className="unit-row" key={u.id}>
              <input
                aria-label={`选择 ${g.title} / ${u.title}`}
                type="checkbox"
                checked={selectedIds.has(u.id)}
                disabled={!u.steps.length}
                onChange={(e) => {
                  const next = new Set(selected);
                  e.target.checked ? next.add(u.id) : next.delete(u.id);
                  setSelected(next);
                }}
              />
              <button className="unit-title" onClick={() => setDetail(u)}>
                <strong>{u.title}</strong>
                <small>
                  {u.summary}
                  {!u.steps.length ? " · 尚无用例，请先编辑" : ""}
                </small>
              </button>
              <button className="quiet" onClick={() => setDetail(u)}>
                详情 ›
              </button>
            </div>
          ))}
          {renderGroups(g.id)}
        </details>
      ));
  }
  const count = selectedIds.size;
  return (
    <section>
      <button className="text-button" onClick={back}>
        ←{" "}
        {mode === "manual"
          ? "返回自己测试"
          : mode === "automation"
            ? "返回自动化测试"
            : "返回工作台"}
      </button>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {mode === "automation"
              ? "自动化测试 · 模拟"
              : mode === "manual"
                ? "自己测试"
                : "我的测试内容"}
          </p>
          <h1>{mount.name}</h1>
        </div>
        <div className="toolbar">
          <button
            onClick={() => {
              const unit = available.find((u) => selectedIds.has(u.id));
              edit(unit ? { unitId: unit.id } : undefined);
            }}
          >
            编辑用例
          </button>
          <details className="more-menu">
            <summary>更多</summary>
            <div>
              <button
                onClick={() => download("test-content.json", mount.content)}
              >
                导出内容
              </button>
              <button onClick={unmount}>移除此挂载</button>
            </div>
          </details>
        </div>
      </div>
      <div className="scope-bar">
        <span>已选择 {count} 条链路</span>
        <button
          className="quiet"
          onClick={() =>
            setSelected(
              count === available.length
                ? new Set()
                : new Set(available.map((u) => u.id)),
            )
          }
        >
          {count === available.length ? "取消全选" : "全选"}
        </button>
      </div>
      {!all.length && (
        <div className="empty">
          <p>从第一条链路开始组织测试。</p>
          <button className="primary" onClick={() => edit()}>
            新建分组、链路与用例
          </button>
        </div>
      )}
      {renderGroups()}
      <TestRunSetup
        key={JSON.stringify([
          project?.id,
          environment?.id,
          environment?.version,
        ])}
        project={project}
        environment={environment}
        selectProject={selectProject}
        count={count}
        mode={mode}
        resumeDraft={hasPendingContentDraft(mount) ? () => edit() : undefined}
        manual={(version) =>
          manual(contentSteps(mount.content, selectedIds), version)
        }
        simulate={(version) =>
          simulate(
            {
              ...structuredClone(mount.content),
              groups: mount.content.groups
                .map((g) => ({
                  ...g,
                  units: g.units.filter((u) => selectedIds.has(u.id)),
                }))
                .filter((g) =>
                  groupUnits(g.id).some((u) => selectedIds.has(u.id)),
                ),
            },
            version,
          )
        }
      />
      {detail && (
        <Dialog title={detail.title} wide onClose={() => setDetail(null)}>
          <ContentDetails details={detail.details} />
          <details open={!detail.details.length}>
            <summary>操作与预期</summary>
            {detail.steps.map((s) => (
              <div className="inset" key={s.id}>
                {s.group && <p className="eyebrow">{s.group}</p>}
                <div className="case-detail-heading">
                  <h3>{s.title}</h3>
                  <button
                    className="text-button"
                    aria-label={`编辑用例：${s.title}`}
                    onClick={() => {
                      setDetail(null);
                      edit({ unitId: detail.id, stepId: s.id });
                    }}
                  >
                    编辑此用例
                  </button>
                </div>
                <p>{s.action}</p>
                {s.target && <p className="hint">测试对象：{s.target}</p>}
                <small>预期：{s.expected}</small>
              </div>
            ))}
          </details>
        </Dialog>
      )}
    </section>
  );
}
export function SimulationView({
  run,
  runs,
  update,
  follow,
  openManual,
  back,
  backLabel,
  newRound,
}: {
  run: Simulation;
  runs: State["runs"];
  update: (run: Simulation) => Promise<boolean>;
  follow: (unitId: string) => void;
  openManual: (id: string) => void;
  back: () => void;
  backLabel?: string;
  newRound?: () => void;
}) {
  const [problems, setProblems] = useState(false),
    [detail, setDetail] = useState<string | null>(null);
  const ended = run.units.filter((u) =>
      ["passed", "failed"].includes(u.status),
    ).length,
    failed = run.units.filter((u) => u.status === "failed").length;
  const names = {
    queued: "待执行",
    running: "执行中",
    passed: "通过",
    failed: "失败",
  };
  const unit = run.units.find((u) => u.id === detail),
    definition = run.content.groups
      .flatMap((g) => g.units)
      .find((u) => u.id === detail),
    review = runs.findLast(
      (r) =>
        r.simulationSource?.runId === run.id &&
        r.simulationSource.unitId === detail,
    );
  return (
    <section>
      <button className="text-button" onClick={back}>
        ← {backLabel || "返回自动化测试"}
      </button>
      <div className="page-heading">
        <div>
          <p className="eyebrow">自动化进度 · 模拟</p>
          <h1>{run.title}</h1>
          <p>
            {run.project.name} · {run.environment.version}
          </p>
        </div>
        <div className="toolbar">
          {newRound && <button onClick={newRound}>开始新一轮</button>}
          {run.status !== "done" && (
            <button
              onClick={() =>
                void update({
                  ...run,
                  status: run.status === "running" ? "paused" : "running",
                })
              }
            >
              {run.status === "running" ? "暂停演示" : "继续演示"}
            </button>
          )}
        </div>
      </div>
      <div className="scope-bar">
        <span>
          {run.status === "done"
            ? "演示结束"
            : run.status === "paused"
              ? "已暂停"
              : "模拟执行中"}{" "}
          · {ended}/{run.units.length} 已结束 · {failed} 失败
        </span>
        <button className="quiet" onClick={() => setProblems(!problems)}>
          {problems ? "查看全部" : "只看失败"}
        </button>
      </div>
      <progress
        aria-label="模拟执行进度"
        max={run.units.length}
        value={ended}
      />
      {run.content.groups.map((g) => {
        const units = run.units.filter(
          (u) =>
            g.units.some((x) => x.id === u.id) &&
            (!problems || u.status === "failed"),
        );
        return (
          units.length > 0 && (
            <details className="unit-group" open key={g.id}>
              <summary>
                {g.title}
                <small>
                  {
                    units.filter((u) => ["passed", "failed"].includes(u.status))
                      .length
                  }
                  /{units.length} 已结束
                </small>
              </summary>
              {units.map((u) => (
                <div className={"unit-row " + u.status} key={u.id}>
                  <span className="result-mark">
                    {u.status === "passed"
                      ? "✓"
                      : u.status === "failed"
                        ? "×"
                        : u.status === "running"
                          ? "◉"
                          : "○"}
                  </span>
                  <button
                    className="unit-title"
                    onClick={() => setDetail(u.id)}
                  >
                    <strong>{u.title}</strong>
                    <small>{g.units.find((x) => x.id === u.id)?.summary}</small>
                  </button>
                  <span className={"status " + u.status}>
                    {u.status === "running"
                      ? run.progressBasis === "steps"
                        ? sequenceOf(g.units.find((x) => x.id === u.id)!)[
                            u.stage
                          ]?.title
                        : g.units.find((x) => x.id === u.id)?.stages[u.stage]
                      : names[u.status]}
                  </span>
                  <button className="quiet" onClick={() => setDetail(u.id)}>
                    {u.status === "failed" ? "查看问题" : "详情"}
                  </button>
                </div>
              ))}
            </details>
          )
        );
      })}
      {problems && !failed && <p className="empty">暂无失败项。</p>}
      {unit && definition && (
        <Dialog title={unit.title} onClose={() => setDetail(null)} wide>
          <p className="hint">模拟原记录 · 未调用任何工具</p>
          <h3 className={"status " + unit.status}>{names[unit.status]}</h3>
          {run.progressBasis === "steps" ? (
            <SequenceList
              unit={definition}
              stage={unit.stage}
              status={unit.status}
            />
          ) : (
            <>
              <p className="hint">旧版记录仅保存阶段进度，未记录逐步结果。</p>
              <ol className="phase-list">
                {definition.stages.map((s, i) => (
                  <li key={i}>
                    {s}
                    <span>
                      {i < unit.stage
                        ? i === definition.stages.length - 1 &&
                          unit.status === "failed"
                          ? "失败"
                          : "通过"
                        : i === unit.stage && unit.status === "running"
                          ? "执行中"
                          : "待执行"}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
          {unit.evidence && <p className="notice">{unit.evidence}</p>}
          <details>
            <summary>本轮内容快照</summary>
            <SequenceList unit={definition} />
            <ContentDetails details={definition.details} />
          </details>
          {review?.finishedAt && (
            <div className="notice">
              <strong>人工补查结论</strong>
              <p>{review.conclusion}</p>
              <small>自动化原结果保持不变。</small>
            </div>
          )}
          <footer className="dialog-actions">
            {review ? (
              <button onClick={() => openManual(review.id)}>
                继续查看人工补查
              </button>
            ) : (
              <button
                className="primary"
                disabled={unit.status === "queued" || unit.status === "running"}
                onClick={() => follow(unit.id)}
              >
                转为人工补查
              </button>
            )}
          </footer>
        </Dialog>
      )}
    </section>
  );
}
