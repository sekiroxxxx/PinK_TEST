import { useEffect, useState, type ReactNode } from "react";
import { z } from "zod";
import { useViewState } from "./useDraft";

export type OutlineNode = {
  id: string;
  title: string;
  children?: OutlineNode[];
  badge?: string;
};
export function ContentOutline({
  nodes,
  selected,
  select,
  tools,
  scope,
}: {
  nodes: OutlineNode[];
  selected: string;
  select: (id: string) => void;
  tools?: ReactNode;
  scope?: string;
}) {
  const initialClosed = () => {
    const ids = new Set<string>();
    const visit = (items: OutlineNode[], depth = 0) =>
      items.forEach((n) => {
        if (n.children?.length && (scope || depth > 0)) ids.add(n.id);
        visit(n.children || [], depth + 1);
      });
    visit(nodes);
    return [...ids];
  };
  const expansion = useViewState(
    "outline-collapse:" + (scope || "default"),
    initialClosed(),
    z.array(z.string()),
  );
  const [closed, setClosed] = useState(
    () => new Set(scope ? expansion.draft : initialClosed()),
  );
  useEffect(() => {
    if (scope) expansion.setDraft([...closed]);
  }, [closed]);
  useEffect(() => {
    const path: string[] = [];
    const find = (items: OutlineNode[]): boolean =>
      items.some((n) => {
        if (n.id === selected) return true;
        if (find(n.children || [])) {
          path.push(n.id);
          return true;
        }
        return false;
      });
    find(nodes);
    setClosed((s) => {
      const next = new Set(s);
      path.forEach((id) => next.delete(id));
      return next;
    });
  }, [selected]);
  const [query, setQuery] = useState("");
  const contains = (node: OutlineNode): boolean =>
    node.title.toLowerCase().includes(query.toLowerCase()) ||
    !!node.children?.some(contains);
  const render = (items: OutlineNode[], depth = 0): ReactNode =>
    items.filter(contains).map((n) => (
      <li key={n.id}>
        <div
          className={"outline-row " + (selected === n.id ? "active" : "")}
          style={{ paddingLeft: depth * 14 }}
        >
          {n.children?.length ? (
            <button
              className="outline-toggle"
              aria-label={`${closed.has(n.id) ? "展开" : "收起"}${n.title}`}
              aria-expanded={!closed.has(n.id)}
              onClick={() =>
                setClosed((s) => {
                  const next = new Set(s);
                  next.has(n.id) ? next.delete(n.id) : next.add(n.id);
                  return next;
                })
              }
            >
              {closed.has(n.id) ? "▸" : "▾"}
            </button>
          ) : (
            <span className="outline-spacer" />
          )}
          <button
            aria-current={selected === n.id ? "page" : undefined}
            onClick={() => select(n.id)}
          >
            <span>{n.title || "未命名"}</span>
            {n.badge && <small>{n.badge}</small>}
          </button>
        </div>
        {!!n.children?.length && (!closed.has(n.id) || !!query) && (
          <ul>{render(n.children, depth + 1)}</ul>
        )}
      </li>
    ));
  return (
    <aside className="content-outline" aria-label="内容目录">
      <div className="author-tools">{tools}</div>
      <input
        aria-label="查找目录与用例"
        placeholder="查找目录与用例"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <nav aria-label="用例目录">
        <ul>{render(nodes)}</ul>
      </nav>
    </aside>
  );
}
