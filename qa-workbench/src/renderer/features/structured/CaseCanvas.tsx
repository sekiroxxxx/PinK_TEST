import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { z } from "zod";
import { useViewState } from "../../components/useDraft";
import { flatten, type EditAction, type EditNode } from "./authoring";
import "./case-canvas.css";

type Box = {
  node: EditNode;
  x: number;
  y: number;
  w: number;
  h: number;
  parent: string;
  index: number;
  top: boolean;
};
type Edge = { from: Box; to: Box; horizontal: boolean };

// Layout is a projection of the module's tree. It never creates an execution
// document or replaces the adapter's ordering and dependency rules.
function arrange(nodes: EditNode[], expanded: Set<string>, columns: number) {
  const boxes: Box[] = [],
    edges: Edge[] = [];
  const gap = 40,
    margin = 36;
  const ordered = (node: EditNode): boolean =>
    !!node.selectable ||
    (node.selectable !== false &&
      !!node.actions?.some((action) => action.id === "up")) ||
    !!node.children?.some(ordered);
  function measure(node: EditNode): { w: number; h: number } {
    if (!expanded.has(node.id) || !node.children?.length)
      return { w: 256, h: 132 };
    const sizes = node.children.map(measure);
    return {
      w: Math.max(256, ...sizes.map((size) => size.w)) + 36,
      h:
        72 +
        sizes.reduce((sum, size) => sum + size.h, 0) +
        Math.max(0, sizes.length - 1) * gap +
        24,
    };
  }
  function place(
    node: EditNode,
    x: number,
    y: number,
    parent: string,
    index: number,
    top: boolean,
  ): Box {
    const size = measure(node);
    const box = { node, x, y, ...size, parent, index, top };
    boxes.push(box);
    if (expanded.has(node.id) && node.children?.length) {
      let childY = y + 72;
      let previous: Box | undefined;
      node.children.forEach((child, i) => {
        const childSize = measure(child);
        const next = place(
          child,
          x + (size.w - childSize.w) / 2,
          childY,
          node.id,
          i,
          false,
        );
        edges.push(
          ...(previous && ordered(previous.node) && ordered(next.node)
            ? [{ from: previous, to: next, horizontal: false }]
            : []),
        );
        previous = next;
        childY += childSize.h + gap;
      });
    }
    return box;
  }
  const rows: {
    node: EditNode;
    size: { w: number; h: number };
    index: number;
  }[][] = [];
  const available = columns * 292 + (columns - 1) * gap;
  let row: (typeof rows)[number] = [],
    width = 0;
  nodes.forEach((node, index) => {
    const size = measure(node);
    if (row.length && width + gap + size.w > available) {
      rows.push(row);
      row = [];
      width = 0;
    }
    row.push({ node, size, index });
    width += size.w + (row.length > 1 ? gap : 0);
  });
  if (row.length) rows.push(row);
  let y = margin;
  const topBoxes: Box[] = [];
  rows.forEach((items) => {
    let x = margin;
    items.forEach(({ node, size, index }) => {
      topBoxes.push(place(node, x, y, "", index, true));
      x += size.w + gap;
    });
    y += Math.max(...items.map(({ size }) => size.h)) + 56;
  });
  topBoxes.forEach((box, i) => {
    if (i && ordered(topBoxes[i - 1].node) && ordered(box.node))
      edges.push({ from: topBoxes[i - 1], to: box, horizontal: true });
  });
  return {
    boxes,
    edges,
    width: Math.max(440, ...boxes.map((box) => box.x + box.w + margin)),
    height: Math.max(320, y - 56 + margin),
  };
}

function summary(node: EditNode) {
  if (node.children?.length) {
    const count = flatten([node]).filter((child) => child.selectable).length;
    return `${node.children.length} 项内容${count ? ` · ${count} 个可测试用例` : ""}`;
  }
  const brief = (
    value: unknown,
    labels: Record<string, string> = {},
  ): string => {
    if (typeof value === "boolean") return value ? "开启" : "关闭";
    if (Array.isArray(value))
      return value.map((item) => brief(item, labels)).join("、");
    if (value && typeof value === "object")
      return Object.entries(value)
        .slice(0, 3)
        .map(([key, item]) => `${labels[key] || key} ${brief(item, labels)}`)
        .join(" · ");
    return labels[String(value)] || String(value ?? "未填写");
  };
  const fields = (node.fields || []).filter(
    (field) =>
      !["id", "title", "label", "caseId", "text:title"].includes(field.key) &&
      field.value !== undefined,
  );
  fields.sort((a, b) => {
    const rank = (field: typeof a) =>
      (field.reset ? 0 : 2) +
      (["toggle", "select", "schema"].includes(field.control) ? 0 : 1);
    return rank(a) - rank(b);
  });
  return (
    fields
      .slice(0, 3)
      .map((field) => {
        const value =
          field.display ??
          field.options?.find((option) => option.value === field.value)
            ?.label ??
          (typeof field.value === "boolean"
            ? field.value
              ? "开启"
              : "关闭"
            : brief(field.value, field.labels));
        return `${field.label}：${value ?? "未填写"}`;
      })
      .join(" · ") ||
    node.note ||
    "选中查看内容"
  );
}

export function CaseCanvas({
  scope,
  nodes,
  selection,
  select,
  children,
  editable = false,
  act,
  reorder,
  toolbar,
  locateSignal = 0,
}: {
  scope: string;
  nodes: EditNode[];
  selection: string;
  select: (id: string) => void;
  children: ReactNode;
  editable?: boolean;
  act?: (node: EditNode, action: EditAction) => void;
  reorder?: (from: string, to: string) => void;
  toolbar?: ReactNode;
  locateSignal?: number;
}) {
  const all = useMemo(() => flatten(nodes), [nodes]);
  const category =
    nodes.find((node) =>
      flatten([node]).some((item) => item.id === selection),
    ) || nodes[0];
  const parents = useMemo(
    () =>
      new Map(
        all.flatMap((node) =>
          (node.children || []).map((child) => [child.id, node.id] as const),
        ),
      ),
    [all],
  );
  const expansion = useViewState(
    "case-canvas-open:" + scope,
    [] as string[],
    z.array(z.string()),
  );
  const [zoom, setZoom] = useState(1);
  const [columns, setColumns] = useState(3);
  const overviewLayout = useRef(false);
  const [connection, setConnection] = useState("");
  const [notice, setNotice] = useState("");
  const viewport = useRef<HTMLDivElement>(null);
  const lastLocated = useRef("");
  const lastLocateSignal = useRef(locateSignal);
  const lastCategory = useRef("");
  const dragged = useRef("");
  const pan = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const marker = useId().replaceAll(":", "");
  const expanded = useMemo(() => {
    const result = new Set(expansion.draft);
    let parent = parents.get(selection);
    while (parent) {
      result.add(parent);
      parent = parents.get(parent);
    }
    return result;
  }, [expansion.draft, selection, parents]);
  useEffect(() => {
    setConnection("");
    setNotice("");
  }, [nodes, category?.id]);
  function sortable(node: EditNode) {
    return (
      node.selectable !== false &&
      !!node.actions?.some((action) => action.id === "up")
    );
  }
  function sameOrderGroup(from: string, to: string) {
    const a = all.find((node) => node.id === from),
      b = all.find((node) => node.id === to);
    return (
      !!a &&
      !!b &&
      sortable(a) &&
      sortable(b) &&
      (a.orderGroup || parents.get(a.id)) ===
        (b.orderGroup || parents.get(b.id))
    );
  }
  const scene = useMemo(
    () =>
      arrange(
        category?.children || (category ? [category] : []),
        expanded,
        columns,
      ),
    [category, expanded, columns],
  );
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const resize = () => {
      if (overviewLayout.current) return;
      setColumns(
        Math.max(1, Math.min(4, Math.floor((element.clientWidth - 40) / 300))),
      );
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom((value) =>
        Math.max(0.35, Math.min(1.5, value + (event.deltaY < 0 ? 0.1 : -0.1))),
      );
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener("wheel", wheel);
    };
  }, []);
  useEffect(() => {
    const element = viewport.current,
      box = scene.boxes.find((item) => item.node.id === selection);
    if (!element) return;
    if (lastCategory.current !== category?.id) {
      element.scrollTo(0, 0);
      lastCategory.current = category?.id || "";
    }
    const changed =
      lastLocated.current !== selection ||
      lastLocateSignal.current !== locateSignal;
    lastLocated.current = selection;
    lastLocateSignal.current = locateSignal;
    if (!box) return;
    if (
      changed ||
      box.x * zoom < element.scrollLeft ||
      (box.x + box.w) * zoom > element.scrollLeft + element.clientWidth ||
      box.y * zoom < element.scrollTop ||
      (box.y + Math.min(box.h, 180)) * zoom >
        element.scrollTop + element.clientHeight
    )
      element.scrollTo({
        left: Math.max(
          0,
          box.x * zoom - (element.clientWidth - box.w * zoom) / 2,
        ),
        top: Math.max(
          0,
          box.y * zoom -
            (element.clientHeight - Math.min(box.h * zoom, 180)) / 2,
        ),
      });
  }, [selection, category?.id, scene, zoom, locateSignal]);
  function toggle(node: EditNode) {
    const next = new Set(expansion.draft);
    if (expanded.has(node.id)) {
      next.delete(node.id);
      if (flatten(node.children || []).some((item) => item.id === selection))
        select(node.id);
    } else next.add(node.id);
    expansion.setDraft([...next]);
  }
  function moveAfter(from: string, to: string) {
    if (!reorder || from === to) return;
    if (!sameOrderGroup(from, to)) {
      setNotice("当前只能在高亮的同组节点之间调整顺序，请选择高亮卡片。");
      return;
    }
    reorder(from, to);
    setConnection("");
    setNotice("");
  }
  function connect(from: string, to: string) {
    moveAfter(to, from);
  }
  return (
    <div
      className="case-canvas-workspace"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setConnection("");
          setNotice("");
        }
      }}
    >
      <section className="case-canvas-board" aria-label="用例链路画布">
        <div className="case-canvas-toolbar">
          <nav aria-label="画布内容分类">
            {nodes.map((node) => (
              <button
                key={node.id}
                className={category?.id === node.id ? "active" : ""}
                aria-pressed={category?.id === node.id}
                onClick={() => select(node.id)}
              >
                {node.title}
              </button>
            ))}
          </nav>
          <div className="toolbar">
            {toolbar}
            <button
              onClick={() => {
                expansion.setDraft([]);
                if (category) select(category.id);
              }}
            >
              收起分组
            </button>
          </div>
        </div>
        {(connection || notice) && (
          <div className="case-canvas-connection" role="status">
            {notice ||
              (connection &&
                `点击高亮卡片，把它接到「${all.find((node) => node.id === connection)?.title}」后面`)}
            <button
              className="text-button"
              onClick={() => {
                setConnection("");
                setNotice("");
              }}
            >
              取消
            </button>
          </div>
        )}
        <div
          className="case-canvas-viewport"
          ref={viewport}
          tabIndex={0}
          aria-label="画布，可拖动空白平移，Ctrl 加滚轮缩放"
          onPointerDown={(event) => {
            if (
              event.button !== 0 ||
              (event.target as HTMLElement).closest("button, article")
            )
              return;
            pan.current = {
              x: event.clientX,
              y: event.clientY,
              left: event.currentTarget.scrollLeft,
              top: event.currentTarget.scrollTop,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (pan.current) {
              event.currentTarget.scrollLeft =
                pan.current.left + pan.current.x - event.clientX;
              event.currentTarget.scrollTop =
                pan.current.top + pan.current.y - event.clientY;
            }
          }}
          onPointerUp={() => {
            pan.current = null;
          }}
          onPointerCancel={() => {
            pan.current = null;
          }}
        >
          <div
            style={{ width: scene.width * zoom, height: scene.height * zoom }}
          >
            <div
              className="case-canvas-world"
              style={{
                width: scene.width,
                height: scene.height,
                transform: `scale(${zoom})`,
              }}
            >
              <svg
                className="case-canvas-lines"
                width={scene.width}
                height={scene.height}
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id={marker}
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" />
                  </marker>
                </defs>
                {scene.edges.map(({ from: a, to: b, horizontal }) => {
                  const sameRow = horizontal && a.y === b.y;
                  const ax = sameRow ? a.x + a.w : a.x + a.w / 2,
                    ay = sameRow ? a.y + 36 : a.y + a.h;
                  const bx = sameRow ? b.x : b.x + b.w / 2,
                    by = sameRow ? b.y + 36 : b.y;
                  const wraps = horizontal && !sameRow;
                  const d = wraps
                    ? `M${a.x + a.w},${a.y + 36} H${scene.width - 14} V${b.y - 20} H${bx} V${by}`
                    : sameRow
                      ? `M${ax},${ay} C${ax + 20},${ay} ${bx - 20},${by} ${bx},${by}`
                      : `M${ax},${ay} C${ax},${ay + 20} ${bx},${by - 20} ${bx},${by}`;
                  return (
                    <path
                      key={a.node.id + b.node.id}
                      d={d}
                      markerEnd={`url(#${marker})`}
                    />
                  );
                })}
              </svg>
              {scene.boxes.map((box) => {
                const node = box.node,
                  group = !!node.children?.length,
                  open = group && expanded.has(node.id);
                const canReorder = !!reorder && sortable(node);
                const target =
                  !!connection &&
                  connection !== node.id &&
                  sameOrderGroup(connection, node.id);
                const hasTargets = all.some(
                  (item) =>
                    item.id !== node.id && sameOrderGroup(node.id, item.id),
                );
                const copy = node.actions?.find(
                  (action) => action.id === "copy",
                );
                return (
                  <article
                    key={node.id}
                    className={`case-graph-node ${open ? "is-open" : ""} ${group ? "is-group" : ""} ${selection === node.id ? "is-selected" : ""} ${target ? "is-connect-target" : ""} ${connection === node.id ? "is-connect-source" : ""}`}
                    style={{
                      left: box.x,
                      top: box.y,
                      width: box.w,
                      height: box.h,
                    }}
                    aria-label={node.title}
                    data-canvas-node={node.id}
                    onClickCapture={(event) => {
                      if (!connection) return;
                      event.preventDefault();
                      event.stopPropagation();
                      if (connection === node.id) {
                        setConnection("");
                        setNotice("");
                      } else connect(connection, node.id);
                    }}
                    onDragOver={(event) => {
                      if (canReorder && dragged.current) event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (canReorder) moveAfter(dragged.current, node.id);
                      dragged.current = "";
                    }}
                  >
                    <div className="case-graph-node-head">
                      {canReorder && (
                        <button
                          className="case-graph-grip"
                          draggable
                          aria-label={`拖动排序 ${node.title}`}
                          title="拖到同组节点后面"
                          onDragStart={(event) => {
                            dragged.current = node.id;
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", node.id);
                          }}
                          onDragEnd={() => {
                            dragged.current = "";
                          }}
                        >
                          ⠿
                        </button>
                      )}
                      <span className="case-graph-index">
                        {String(box.index + 1).padStart(2, "0")}
                      </span>
                      <button
                        className="case-graph-title"
                        aria-pressed={selection === node.id}
                        onClick={() => {
                          select(node.id);
                        }}
                      >
                        <strong>{node.title}</strong>
                        <small>
                          {open
                            ? `${node.children!.length} 项内容`
                            : node.badge ||
                              (node.selectable
                                ? "可测试用例"
                                : group
                                  ? "分组"
                                  : node.fields?.length
                                    ? "配置 / 操作"
                                    : "空分组")}
                        </small>
                      </button>
                      {group && (
                        <button
                          className="case-graph-fold"
                          aria-label={`${open ? "折叠" : "展开"} ${node.title}`}
                          aria-expanded={open}
                          onClick={() => toggle(node)}
                        >
                          {open ? "−" : "＋"}
                        </button>
                      )}
                    </div>
                    {!open && (
                      <button
                        className="case-graph-summary"
                        onClick={() => select(node.id)}
                      >
                        {summary(node)}
                      </button>
                    )}
                    {!open && editable && copy && (
                      <button
                        className="case-graph-copy"
                        aria-label={`${copy.label} ${node.title}`}
                        onClick={() => act?.(node, copy)}
                      >
                        复制
                      </button>
                    )}
                    {canReorder && (
                      <button
                        className={`case-graph-port ${connection === node.id ? "connecting" : ""}`}
                        aria-label={
                          target
                            ? `将 ${node.title} 接到起点之后`
                            : `从 ${node.title} 连接下一项`
                        }
                        disabled={!hasTargets}
                        title={
                          hasTargets
                            ? "连接下一项，调整同组顺序"
                            : "同组暂无可排序目标"
                        }
                        onClick={() =>
                          setConnection(connection === node.id ? "" : node.id)
                        }
                      />
                    )}
                  </article>
                );
              })}
            </div>
          </div>
          {!scene.boxes.length && (
            <div className="case-canvas-empty">
              在右侧添加内容，开始设计链路。
            </div>
          )}
        </div>
        <div className="case-canvas-controls">
          <div>
            <button
              aria-label="缩小画布"
              onClick={() => setZoom((value) => Math.max(0.35, value - 0.1))}
            >
              −
            </button>
            <button
              onClick={() => {
                overviewLayout.current = false;
                setColumns(
                  Math.max(
                    1,
                    Math.min(
                      4,
                      Math.floor(
                        ((viewport.current?.clientWidth || 800) - 40) / 300,
                      ),
                    ),
                  ),
                );
                setZoom(1);
              }}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              aria-label="放大画布"
              onClick={() => setZoom((value) => Math.min(1.5, value + 0.1))}
            >
              ＋
            </button>
            <button
              onClick={() => {
                const overview = arrange(
                  category?.children || (category ? [category] : []),
                  expanded,
                  3,
                );
                overviewLayout.current = true;
                setColumns(3);
                setZoom(
                  Math.max(
                    0.35,
                    Math.min(
                      1,
                      (viewport.current?.clientWidth || 800) / overview.width,
                      (viewport.current?.clientHeight || 600) / overview.height,
                    ),
                  ),
                );
                viewport.current?.scrollTo(0, 0);
              }}
            >
              总览
            </button>
          </div>
          <span>拖动空白平移 · 选中后在右侧{editable ? "编辑" : "查看"}</span>
        </div>
      </section>
      <aside
        className="case-canvas-inspector"
        aria-label={editable ? "选中节点的编辑内容" : "选中节点的用例详情"}
      >
        {children}
      </aside>
    </div>
  );
}
