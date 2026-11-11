import { useState } from "react";
import { Dialog } from "../../components/Dialog";
import { type ContentUnit } from "../../../shared/content";
import { flattenRoute, type RouteNode } from "../../../shared/routeTree";

// Every view uses the saved outline; legacy flat steps remain readable.
export function sequenceOf(unit: ContentUnit) {
  return unit.outline
    ? flattenRoute(unit.outline).map((s) => ({
        ...s,
        group: s.path.join(" / "),
      }))
    : unit.steps.map((s, i) => ({
        ...s,
        order: String(i + 1),
        group: s.group || "",
        target: s.target || "",
      }));
}
export function SequenceList({
  unit,
  stage,
  status,
}: {
  unit: ContentUnit;
  stage?: number;
  status?: string;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const steps = sequenceOf(unit);
  const nodes: RouteNode[] =
    unit.outline || unit.steps.map((step) => ({ ...step, kind: "step" }));
  function render(items: RouteNode[], target = "") {
    return (
      <ol className="sequence-tree">
        {items.map((node) => {
          const context = node.target || target;
          const index = steps.findIndex((step) => step.id === node.id);
          const children =
            node.kind === "group" ? flattenRoute(node.children) : [];
          const label =
            stage === undefined || node.kind === "group"
              ? ""
              : status === "passed" ||
                  (index < stage &&
                    !(status === "failed" && index === steps.length - 1))
                ? "已演示"
                : status === "failed" && index === steps.length - 1
                  ? "模拟异常"
                  : index === stage && status === "running"
                    ? "演示中"
                    : "待演示";
          return (
            <li key={node.id}>
              <details
                open={expanded[node.id] || false}
                onToggle={(event) => {
                  const open = event.currentTarget.open;
                  setExpanded((value) =>
                    value[node.id] === open
                      ? value
                      : { ...value, [node.id]: open },
                  );
                }}
              >
                <summary>
                  {node.kind === "step" && (
                    <span className="sequence-order">{index + 1}</span>
                  )}
                  <span className="sequence-node-name">{node.title}</span>
                  {(node.kind === "group" || label) && (
                    <small>
                      {node.kind === "group"
                        ? `${children.length} 个步骤`
                        : label}
                    </small>
                  )}
                </summary>
                {node.kind === "group" ? (
                  <>
                    {context && (
                      <p className="hint sequence-context">对象：{context}</p>
                    )}
                    {render(node.children, context)}
                  </>
                ) : (
                  <div className="sequence-step-detail">
                    {!unit.outline && steps[index]?.group && (
                      <p className="hint">分组：{steps[index].group}</p>
                    )}
                    {context && <p className="hint">对象：{context}</p>}
                    {node.action && <p>{node.action}</p>}
                    {node.expected && (
                      <p className="hint">预期：{node.expected}</p>
                    )}
                  </div>
                )}
              </details>
            </li>
          );
        })}
      </ol>
    );
  }
  return render(nodes);
}
export function SequenceDialog({
  units,
  close,
}: {
  units: ContentUnit[];
  close: () => void;
}) {
  return (
    <Dialog title="执行顺序预览" wide onClose={close}>
      <p className="hint">
        逐级展开查看；步骤编号为实际执行顺序，收起内容不会改变顺序。
      </p>
      {units.map((u) => (
        <details className="sequence-unit" key={u.id} open={units.length === 1}>
          <summary>
            <strong>{u.title}</strong>
            <span>{u.steps.length} 个步骤</span>
          </summary>
          <SequenceList unit={u} />
        </details>
      ))}
    </Dialog>
  );
}
