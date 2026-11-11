import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Dialog } from "../../components/Dialog";
import { useDraft, useDraftRevision } from "../../components/useDraft";
import {
  type RouteNode,
  type ActionDescription,
  findNode,
  flattenRoute,
  routeGroups,
  copyNode,
  inheritedTarget,
} from "../../../shared/routeTree";
import { SequenceDialog } from "./RouteSequence";
import { RouteNodeEditor } from "./RouteNodeEditor";
import { nodeFocusSchema, nodeDrafts, hasNodeDraft } from "./editorState";
export { hasNodeDraft } from "./editorState";

const focusSchema = nodeFocusSchema;
export function RouteCanvas({
  scope,
  nodes,
  actions,
  change,
  initialStep,
  resumeSignal = 0,
  title = "当前链路",
  path = [],
  showDraftNotice = true,
}: {
  scope: string;
  nodes: RouteNode[];
  actions: ActionDescription[];
  change: (nodes: RouteNode[]) => void;
  initialStep?: string;
  resumeSignal?: number;
  title?: string;
  path?: string[];
  showDraftNotice?: boolean;
}) {
  useDraftRevision();
  const canvas = useRef<HTMLElement>(null);
  const lastUpdated = useRef("");
  const [updated, setUpdated] = useState("");
  const unfinished = nodeDrafts(scope, nodes);
  const focus = useDraft(
    "route-focus:" + scope,
    { kind: "step" as const, parent: "" },
    focusSchema,
  );
  const [editing, setEditing] = useState<z.infer<typeof focusSchema> | null>(
    () => {
      const found = initialStep && findNode(nodes, initialStep);
      return found
        ? { id: found.node.id, kind: found.node.kind, parent: found.parent }
        : null;
    },
  );
  useEffect(() => {
    if (resumeSignal && unfinished.length)
      setEditing(
        unfinished.find(
          (item) =>
            item.id === focus.draft.id &&
            item.kind === focus.draft.kind &&
            item.parent === focus.draft.parent,
        ) || unfinished[0],
      );
  }, [resumeSignal]);
  const [moving, setMoving] = useState(""),
    [preview, setPreview] = useState(false);
  const expansion = useDraft(
    "route-collapse:" + scope,
    [] as string[],
    z.array(z.string()),
  );
  const collapsed = expansion.draft,
    setCollapsed = expansion.setDraft;
  const [removed, setRemoved] = useState<{
    node: RouteNode;
    parent: string;
    index: number;
  } | null>(null);
  function open(kind: "step" | "group", parent = "", id?: string) {
    lastUpdated.current = "";
    const next = { kind, parent, id };
    focus.setDraft(next);
    setEditing(next);
  }
  function editTree(edit: (nodes: RouteNode[]) => void) {
    const next = structuredClone(nodes);
    edit(next);
    change(next);
  }
  function listOf(nodes: RouteNode[], parent: string) {
    const group = parent ? findNode(nodes, parent)?.node : null;
    return group?.kind === "group" ? group.children : nodes;
  }
  function save(node: RouteNode, parent: string) {
    editTree((tree) => {
      const found = findNode(tree, node.id);
      if (found) found.siblings[found.index] = node;
      else listOf(tree, parent).push(node);
    });
    setCollapsed((ids) => ids.filter((id) => id !== parent));
    lastUpdated.current = node.id;
    setUpdated(node.id);
  }
  function row(
    node: RouteNode,
    index: number,
    parent: string,
    order: number[],
  ): React.ReactNode {
    const numbering = [...order, index + 1],
      group = node.kind === "group",
      closed = collapsed.includes(node.id);
    return (
      <div
        className={
          "route-tree-node " +
          (group ? "route-tree-group" : "route-tree-step") +
          (updated === node.id ? " was-updated" : "")
        }
        key={node.id}
      >
        <div className="route-tree-row">
          <span className="route-index">{numbering.join(".")}</span>
          <button
            className="route-tree-title"
            data-route-node={node.id}
            onClick={() =>
              group
                ? setCollapsed((ids) =>
                    closed
                      ? ids.filter((id) => id !== node.id)
                      : [...ids, node.id],
                  )
                : open("step", parent, node.id)
            }
            aria-expanded={group ? !closed : undefined}
          >
            <strong>
              {group ? (closed ? "› " : "⌄ ") : ""}
              {node.title}
            </strong>
            {unfinished.some((draft) => draft.id === node.id) && (
              <span className="route-node-draft">有未完成编辑</span>
            )}
            {(group || node.action !== node.title) && (
              <small>
                {group
                  ? `${flattenRoute(node.children).length} 个步骤${node.target ? " · 对象：" + node.target : ""}`
                  : node.action}
              </small>
            )}
          </button>
          <details
            className="more-menu"
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("button"))
                event.currentTarget.open = false;
            }}
          >
            <summary aria-label={node.title + "的更多操作"}>•••</summary>
            <div>
              <button onClick={() => open(node.kind, parent, node.id)}>
                编辑{group ? "步骤分组" : "步骤"}
              </button>
              <button
                onClick={() => {
                  const next = copyNode(node);
                  if (
                    group ||
                    (next.kind === "step" && next.titleMode !== "auto")
                  )
                    next.title += " · 副本";
                  editTree((tree) => {
                    const found = findNode(tree, node.id)!;
                    found.siblings.splice(found.index + 1, 0, next);
                  });
                  open(next.kind, parent, next.id);
                }}
              >
                复制并编辑
              </button>
              <button onClick={() => setMoving(node.id)}>移动到…</button>
              <button
                disabled={index === 0}
                onClick={() =>
                  editTree((tree) => {
                    const f = findNode(tree, node.id)!;
                    [f.siblings[index - 1], f.siblings[index]] = [
                      f.siblings[index],
                      f.siblings[index - 1],
                    ];
                  })
                }
              >
                上移
              </button>
              <button
                onClick={() =>
                  editTree((tree) => {
                    const f = findNode(tree, node.id)!;
                    if (index + 1 < f.siblings.length)
                      [f.siblings[index + 1], f.siblings[index]] = [
                        f.siblings[index],
                        f.siblings[index + 1],
                      ];
                  })
                }
              >
                下移
              </button>
              <button
                onClick={() => {
                  editTree((tree) => {
                    const f = findNode(tree, node.id)!;
                    setRemoved({ node: f.node, parent, index: f.index });
                    f.siblings.splice(f.index, 1);
                  });
                }}
              >
                移除
              </button>
            </div>
          </details>
        </div>
        {group && !closed && (
          <div className="route-tree-children">
            {node.children.map((n, i) => row(n, i, node.id, numbering))}
            {add(node.id)}
          </div>
        )}
      </div>
    );
  }
  function add(parent: string) {
    return (
      <details
        className="more-menu route-add"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button"))
            event.currentTarget.open = false;
        }}
      >
        <summary>＋ 添加{parent ? "内容" : ""}</summary>
        <div>
          <button onClick={() => open("step", parent)}>添加步骤</button>
          <button onClick={() => open("group", parent)}>添加步骤分组</button>
        </div>
      </details>
    );
  }
  return (
    <section className="route-canvas" ref={canvas}>
      <div className="route-canvas-tools">
        <span>按顺序执行 {flattenRoute(nodes).length} 个步骤</span>
        <div className="toolbar">
          {!!routeGroups(nodes).length && (
            <button
              className="quiet"
              onClick={() =>
                setCollapsed(
                  collapsed.length ? [] : routeGroups(nodes).map((g) => g.id),
                )
              }
            >
              {collapsed.length ? "展开全部" : "折叠全部"}
            </button>
          )}
          <button
            className="quiet"
            disabled={!nodes.length}
            onClick={() => setPreview(true)}
          >
            预览顺序
          </button>
          {add("")}
        </div>
      </div>
      {showDraftNotice && hasNodeDraft(scope) && !editing && (
        <div className="route-draft-hint">
          有未完成编辑，更新后纳入用例集草稿。
          <button
            className="text-button"
            onClick={() =>
              setEditing(
                unfinished.find(
                  (item) =>
                    item.id === focus.draft.id &&
                    item.kind === focus.draft.kind,
                ) || unfinished[0],
              )
            }
          >
            继续编辑
          </button>
        </div>
      )}
      {!nodes.length && (
        <div className="empty">
          <h3>从第一步开始</h3>
          <p>按需分组，按实际测试顺序添加操作和检查。</p>
          <button onClick={() => open("step")}>添加步骤</button>
        </div>
      )}
      {nodes.map((node, i) => row(node, i, "", []))}
      {!!nodes.length && <p className="route-end">链路结束</p>}
      {removed && (
        <p className="notice">
          已移除内容{" "}
          <button
            className="text-button"
            onClick={() => {
              editTree((tree) => {
                const list = listOf(tree, removed.parent);
                list.splice(
                  Math.min(removed.index, list.length),
                  0,
                  removed.node,
                );
              });
              setRemoved(null);
            }}
          >
            撤销
          </button>
        </p>
      )}
      {editing && (
        <RouteNodeEditor
          key={editing.id || editing.kind + editing.parent}
          scope={scope}
          node={editing.id ? findNode(nodes, editing.id)?.node : undefined}
          kind={editing.kind}
          parent={editing.parent}
          nodes={nodes}
          actions={actions}
          path={path}
          save={save}
          close={() => {
            const id = lastUpdated.current || editing.id;
            setEditing(null);
            requestAnimationFrame(() => {
              const buttons =
                canvas.current?.querySelectorAll<HTMLButtonElement>(
                  ".route-tree-title",
                );
              const button =
                buttons && [...buttons].find((b) => b.dataset.routeNode === id);
              const target =
                button ||
                canvas.current?.querySelector<HTMLElement>(
                  ".route-add summary",
                );
              target?.focus({ preventScroll: true });
              target?.scrollIntoView({ block: "nearest" });
            });
          }}
        />
      )}
      {moving && findNode(nodes, moving) && (
        <MoveNode
          key={moving}
          nodes={nodes}
          id={moving}
          close={() => setMoving("")}
          move={(parent, before) => {
            editTree((tree) => {
              const f = findNode(tree, moving)!;
              f.siblings.splice(f.index, 1);
              const list = listOf(tree, parent);
              list.splice(
                before ? list.findIndex((n) => n.id === before) : list.length,
                0,
                f.node,
              );
            });
            setCollapsed((ids) => ids.filter((id) => id !== parent));
            setMoving("");
          }}
        />
      )}
      {preview && (
        <SequenceDialog
          units={[
            {
              id: scope,
              title,
              summary: "",
              details: [],
              stages: ["模拟"],
              outline: nodes,
              steps: [],
            },
          ]}
          close={() => setPreview(false)}
        />
      )}
    </section>
  );
}
function MoveNode({
  nodes,
  id,
  close,
  move,
}: {
  nodes: RouteNode[];
  id: string;
  close: () => void;
  move: (parent: string, before: string) => void;
}) {
  const found = findNode(nodes, id)!;
  const [parent, setParent] = useState(found.parent),
    [before, setBefore] = useState(found.siblings[found.index + 1]?.id || "");
  const excluded = new Set(
    found.node.kind === "group"
      ? [id, ...routeGroups(found.node.children).map((g) => g.id)]
      : [],
  );
  const group = parent ? findNode(nodes, parent)?.node : null;
  const siblings = (group?.kind === "group" ? group.children : nodes).filter(
    (n) => n.id !== id,
  );
  const previous = inheritedTarget(nodes, id) || "",
    next = found.node.target || inheritedTarget(nodes, parent) || "";
  return (
    <Dialog title="移动内容" onClose={close}>
      <p>{found.node.title}</p>
      <label className="field">
        移动到
        <select
          value={parent}
          onChange={(e) => {
            setParent(e.target.value);
            setBefore("");
          }}
        >
          {[{ id: "", title: "链路最外层" }, ...routeGroups(nodes)]
            .filter((g) => !excluded.has(g.id))
            .map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
        </select>
      </label>
      <label className="field">
        插入位置
        <select value={before} onChange={(e) => setBefore(e.target.value)}>
          {siblings.map((n, i) => (
            <option key={n.id} value={n.id}>
              {i === 0 ? "放在最前" : "插入"} ·「{n.title}」之前
            </option>
          ))}
          <option value="">放在末尾</option>
        </select>
      </label>
      <div className="route-context" role="status">
        <strong>测试对象{previous === next ? "保持不变" : "将变化"}</strong>
        <p>
          {previous || "当前测试工程"}
          {previous !== next ? " → " + (next || "当前测试工程") : ""}
        </p>
        <small>
          {found.node.target
            ? "已单独指定对象，移动后保持不变。"
            : "沿用目标分组的对象，内部单独指定的对象保持不变。"}
        </small>
      </div>
      <footer className="dialog-actions">
        <button className="primary" onClick={() => move(parent, before)}>
          移动
        </button>
      </footer>
    </Dialog>
  );
}
