import type { State } from "../../shared/model";

export function ContinueTests({
  state,
  mode,
  open,
  all,
}: {
  state: State;
  mode?: "manual" | "automation";
  open: (id: string, type: "manual" | "simulation") => void;
  all: () => void;
}) {
  const runs = [
    ...(mode === "automation"
      ? []
      : state.runs
          .filter(
            (r) => !r.finishedAt && r.project.id === state.selectedProjectId,
          )
          .map((r) => ({
            id: r.id,
            title: r.title,
            at: r.startedAt,
            version: r.environment.version,
            environment: r.environment.name,
            type: "manual" as const,
            progress: `${r.items.filter((i) => i.status !== "unchecked").length}/${r.items.length} 项已反馈`,
            action: "继续测试",
          }))),
    ...(mode === "manual"
      ? []
      : state.simulations
          .filter(
            (r) =>
              r.status !== "done" && r.project.id === state.selectedProjectId,
          )
          .map((r) => ({
            id: r.id,
            title: r.title,
            at: r.startedAt,
            version: r.environment.version,
            environment: r.environment.name,
            type: "simulation" as const,
            progress: r.status === "running" ? "模拟运行中" : "模拟已暂停",
            action: r.status === "running" ? "查看进度" : "继续查看",
          }))),
  ].sort((a, b) => b.at.localeCompare(a.at));
  if (!runs.length) return null;
  return (
    <section className="continue-tests" aria-label="继续未结束的测试">
      <div className="section-heading">
        <h2>
          继续测试 <small>{runs.length}</small>
        </h2>
        {runs.length > 3 && (
          <button className="text-button" onClick={all}>
            查看全部记录
          </button>
        )}
      </div>
      {runs.slice(0, 3).map((r) => (
        <button
          className="continue-row"
          key={r.id}
          onClick={() => open(r.id, r.type)}
        >
          <span className="badge">{r.type === "manual" ? "人工" : "模拟"}</span>
          <span className="continue-description">
            <strong>{r.title}</strong>
            <small>
              {r.version || "未填写版本"} · {r.environment} · {r.progress}
            </small>
            <small>
              开始于{" "}
              <time dateTime={r.at}>
                {new Date(r.at).toLocaleString("zh-CN", { hour12: false })}
              </time>
            </small>
          </span>
          <span className="continue-action">{r.action} →</span>
        </button>
      ))}
    </section>
  );
}
