import { useEffect, useId, useRef, type ReactNode } from "react";
import { z } from "zod";
import type { ContentUnit, TestContent } from "../../../shared/content";
import { useDraft } from "../../components/useDraft";
import { sequenceOf } from "./RouteSequence";
import type { CatalogEdit } from "./editorState";
import "./library.css";

export function groupAncestors(content: TestContent, groupId?: string) {
  const path: TestContent["groups"] = [];
  const visited = new Set<string>();
  let group = content.groups.find((g) => g.id === groupId);
  while (group && !visited.has(group.id)) {
    visited.add(group.id);
    path.unshift(group);
    group = content.groups.find((g) => g.id === group!.parentId);
  }
  return path;
}

export function RouteBreadcrumb({ parts }: { parts: string[] }) {
  return (
    <nav className="route-breadcrumb" aria-label="当前位置">
      <ol>
        {parts.map((part, index) => (
          <li
            key={index}
            aria-current={index === parts.length - 1 ? "page" : undefined}
          >
            {index > 0 && <span aria-hidden="true">›</span>}
            <span>{part || "未命名"}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export type LibrarySource = {
  id: string;
  name: string;
  content: TestContent;
  // Adapter previews wrap their roots in a synthetic group, not a user directory.
  described?: boolean;
  loaded?: boolean;
  note?: string;
  dirty?: boolean;
  dirtyRoutes?: string[];
  unfinishedRoutes?: string[];
  unfinishedCount?: number;
};

function CatalogMenu({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  return (
    <>
      <button
        type="button"
        className="catalog-menu-trigger"
        aria-label={label}
        title={label}
        popoverTarget={id}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          if (menu.current) {
            menu.current.style.top =
              Math.max(8, Math.min(box.bottom + 4, window.innerHeight - 260)) +
              "px";
            menu.current.style.left =
              Math.max(8, Math.min(box.left, window.innerWidth - 216)) + "px";
          }
        }}
      >
        ⋯
      </button>
      <div
        id={id}
        popover="auto"
        ref={menu}
        className="catalog-menu"
        aria-label={label}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button"))
            menu.current?.hidePopover();
        }}
      >
        {children}
      </div>
    </>
  );
}

function NodeIcon({ kind }: { kind: "collection" | "group" | "route" }) {
  return (
    <svg
      className="catalog-icon"
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      {kind === "collection" ? (
        <>
          <rect x="3" y="4" width="14" height="13" rx="2" />
          <path d="M7 2h6M3 8h14" />
        </>
      ) : kind === "group" ? (
        <path d="M2 6V4h6l2 2h8v10H2Z" />
      ) : (
        <>
          <path d="M7 5h10M7 10h10M7 15h10M2 5h2M2 10h2M2 15h2" />
        </>
      )}
    </svg>
  );
}

export function RouteLibrary({
  sources,
  activeId,
  selectedId,
  choose,
  add,
  edit,
  create,
  hasNewDraft = false,
  load,
  importContent,
  multiple,
  checked,
  check,
  readOnly = false,
  scoped = false,
}: {
  sources: LibrarySource[];
  activeId: string;
  selectedId: string;
  choose: (sourceId: string, unitId: string) => void;
  add: (sourceId: string, groupId?: string) => void;
  edit?: (sourceId: string, request: CatalogEdit) => void;
  create: () => void;
  hasNewDraft?: boolean;
  load: (sourceId: string) => void;
  importContent: () => void;
  multiple: boolean;
  checked: string[];
  check: (unitId: string, value: boolean) => void;
  readOnly?: boolean;
  scoped?: boolean;
}) {
  const view = useDraft(
    "route-library-expanded",
    {} as Record<string, boolean>,
    z.record(z.string(), z.boolean()),
  );
  const scope = useId();
  const keyOf = (sourceId: string, groupId?: string) =>
    JSON.stringify([sourceId, groupId || ""]);
  const active = sources.find((s) => s.id === activeId);
  const owner = active?.content.groups.find((g) =>
    g.units.some((u) => u.id === selectedId),
  );
  const ancestors = active ? groupAncestors(active.content, owner?.id) : [];
  const selection = JSON.stringify([activeId, selectedId]);
  const previous = useRef("");
  useEffect(() => {
    if (selection !== previous.current) {
      const initial = !previous.current;
      previous.current = selection;
      view.setDraft((d) => ({
        ...d,
        [keyOf(activeId)]: initial ? (d[keyOf(activeId)] ?? true) : true,
        ...Object.fromEntries(
          ancestors.map((g) => [
            keyOf(activeId, g.id),
            initial ? (d[keyOf(activeId, g.id)] ?? true) : true,
          ]),
        ),
      }));
    }
  }, [selection]);
  function isOpen(sourceId: string, groupId?: string) {
    return (
      view.draft[keyOf(sourceId, groupId)] ??
      (sourceId === activeId &&
        (!groupId || ancestors.some((g) => g.id === groupId)))
    );
  }
  function toggle(source: LibrarySource, groupId?: string) {
    const next = !isOpen(source.id, groupId);
    view.setDraft((d) => ({ ...d, [keyOf(source.id, groupId)]: next }));
    if (next && source.described && !source.loaded) load(source.id);
  }
  function addHere(source: LibrarySource, groupId?: string) {
    view.setDraft((d) => ({
      ...d,
      [keyOf(source.id)]: true,
      ...Object.fromEntries(
        groupAncestors(source.content, groupId).map((g) => [
          keyOf(source.id, g.id),
          true,
        ]),
      ),
    }));
    add(source.id, groupId);
  }
  function routes(source: LibrarySource, units: ContentUnit[], path: string[]) {
    return units.map((unit) => {
      const current = source.id === activeId && unit.id === selectedId;
      const count = sequenceOf(unit).length;
      const dirty = source.dirtyRoutes?.includes(unit.id);
      const unfinished = source.unfinishedRoutes?.includes(unit.id);
      return (
        <li
          key={unit.id}
          className={"catalog-route-row" + (current ? " is-current" : "")}
        >
          {multiple && source.id === activeId && (
            <input
              type="checkbox"
              aria-label={"纳入测试：" + [...path, unit.title].join(" / ")}
              checked={checked.includes(unit.id)}
              onChange={(e) => check(unit.id, e.target.checked)}
            />
          )}
          <button
            className={"catalog-route " + (current ? "active" : "")}
            aria-current={current ? "page" : undefined}
            title={[...path, unit.title].join(" / ")}
            onClick={() => choose(source.id, unit.id)}
          >
            <NodeIcon kind="route" />
            <span className="catalog-name">{unit.title || "未命名链路"}</span>
            <small className={dirty || unfinished ? "catalog-draft-state" : ""}>
              {dirty
                ? "待保存"
                : unfinished
                  ? "未完成"
                  : count
                    ? count + " 步"
                    : source.described
                      ? "查看"
                      : "待编写"}
            </small>
          </button>
          {!source.described && edit && !readOnly && (
            <CatalogMenu
              label={"链路操作：" + [...path, unit.title].join(" / ")}
            >
              <button
                onClick={() =>
                  edit(source.id, {
                    kind: "route",
                    id: unit.id,
                    group: source.content.groups.find((g) =>
                      g.units.some((u) => u.id === unit.id),
                    )?.id,
                  })
                }
              >
                名称与归属
              </button>
              <button
                onClick={() =>
                  edit(source.id, {
                    kind: "route",
                    id: unit.id,
                    action: "copy",
                  })
                }
              >
                复制并编辑
              </button>
              <button
                disabled={units[0]?.id === unit.id}
                onClick={() =>
                  edit(source.id, { kind: "route", id: unit.id, action: "up" })
                }
              >
                上移链路
              </button>
              <button
                disabled={units.at(-1)?.id === unit.id}
                onClick={() =>
                  edit(source.id, {
                    kind: "route",
                    id: unit.id,
                    action: "down",
                  })
                }
              >
                下移链路
              </button>
              <button
                className="catalog-destructive"
                onClick={() =>
                  edit(source.id, {
                    kind: "route",
                    id: unit.id,
                    action: "remove",
                  })
                }
              >
                移除链路
              </button>
            </CatalogMenu>
          )}
        </li>
      );
    });
  }
  function groups(
    source: LibrarySource,
    parent?: string,
    path = [source.name],
  ): React.ReactNode {
    return source.content.groups
      .filter((g) => g.parentId === parent)
      .map((group) => {
        const opened = isOpen(source.id, group.id);
        const fullPath = [...path, group.title];
        const controls = scope + encodeURIComponent(keyOf(source.id, group.id));
        const descendants = source.content.groups
          .filter((g) =>
            groupAncestors(source.content, g.id).some((p) => p.id === group.id),
          )
          .flatMap((g) => g.units.map((u) => u.id));
        const dirty = descendants.some((id) =>
          source.dirtyRoutes?.includes(id),
        );
        const unfinished = descendants.some((id) =>
          source.unfinishedRoutes?.includes(id),
        );
        return (
          <li key={group.id}>
            <div className="catalog-folder-row">
              <button
                className="catalog-folder"
                aria-expanded={opened}
                aria-controls={controls}
                aria-label={`${opened ? "折叠" : "展开"}分组：${fullPath.join(" / ")}`}
                title={fullPath.join(" / ")}
                onClick={() => toggle(source, group.id)}
              >
                <span className="catalog-chevron" aria-hidden="true">
                  {opened ? "⌄" : "›"}
                </span>
                <NodeIcon kind="group" />
                <span className="catalog-name">
                  {group.title || "未命名分组"}
                </span>
                {!opened && (dirty || unfinished) && (
                  <small className="catalog-draft-state">
                    {dirty ? "待保存" : "未完成"}
                  </small>
                )}
              </button>
              {!source.described && !readOnly && (
                <CatalogMenu label={"目录分组操作：" + fullPath.join(" / ")}>
                  <button onClick={() => addHere(source, group.id)}>
                    新建链路
                  </button>
                  <button
                    onClick={() =>
                      edit?.(source.id, {
                        kind: "group",
                        group: group.id,
                        explicitLocation: true,
                      })
                    }
                  >
                    新建子分组
                  </button>
                  <button
                    onClick={() =>
                      edit?.(source.id, { kind: "group", id: group.id })
                    }
                  >
                    名称与归属
                  </button>
                </CatalogMenu>
              )}
            </div>
            {opened && (
              <ul className="catalog-children" id={controls}>
                {routes(source, group.units, fullPath)}
                {groups(source, group.id, fullPath)}
                {!group.units.length &&
                  !source.content.groups.some(
                    (g) => g.parentId === group.id,
                  ) && <li className="catalog-empty">暂无链路</li>}
              </ul>
            )}
          </li>
        );
      });
  }
  return (
    <aside className="route-library route-catalog" aria-label="测试目录">
      <div className="route-library-tools">
        <strong>{scoped ? "本用例集的链路" : "测试目录"}</strong>
      </div>
      <nav aria-label="用例集、分组与链路">
        <ul className="catalog-sources">
          {sources.map((source) => {
            const opened = isOpen(source.id),
              controls = scope + encodeURIComponent(keyOf(source.id));
            return (
              <li className="catalog-source" key={source.id}>
                <div
                  className={
                    "catalog-source-row" +
                    (source.id === activeId ? " is-current" : "")
                  }
                >
                  <button
                    className="catalog-folder catalog-collection"
                    aria-expanded={opened}
                    aria-controls={controls}
                    aria-label={`${opened ? "折叠" : "展开"}用例集：${source.name}`}
                    title={source.name}
                    onClick={() => toggle(source)}
                  >
                    <span className="catalog-chevron" aria-hidden="true">
                      {opened ? "⌄" : "›"}
                    </span>
                    <NodeIcon kind="collection" />
                    <span className="catalog-name">
                      {source.name || "未命名用例集"}
                    </span>
                  </button>
                  {!source.described && !readOnly && (
                    <CatalogMenu label={"用例集操作：" + source.name}>
                      <button onClick={() => addHere(source)}>新建链路</button>
                      <button
                        onClick={() =>
                          edit?.(source.id, {
                            kind: "group",
                            group: "",
                            explicitLocation: true,
                          })
                        }
                      >
                        新建目录分组
                      </button>
                      <button
                        onClick={() =>
                          edit?.(source.id, {
                            kind: "collection",
                            id: source.content.id,
                          })
                        }
                      >
                        修改用例集名称
                      </button>
                    </CatalogMenu>
                  )}
                </div>
                {!!(source.note || source.dirty || source.unfinishedCount) && (
                  <div className="catalog-note">
                    <span
                      className={
                        source.dirty || source.unfinishedCount
                          ? "catalog-draft-state"
                          : ""
                      }
                    >
                      {[
                        source.note,
                        source.dirty ? "待保存" : "",
                        source.unfinishedCount ? "有未完成编辑" : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {source.id === "new" && source.id !== activeId && (
                      <button
                        className="text-button"
                        onClick={() => choose(source.id, "")}
                      >
                        继续编辑
                      </button>
                    )}
                  </div>
                )}
                {opened && (
                  <ul className="catalog-children" id={controls}>
                    {source.described ? (
                      source.loaded ? (
                        routes(
                          source,
                          source.content.groups.flatMap((g) => g.units),
                          [source.name],
                        )
                      ) : (
                        <li>
                          <button
                            className="text-button"
                            onClick={() => load(source.id)}
                          >
                            打开用例集
                          </button>
                        </li>
                      )
                    ) : (
                      groups(source)
                    )}
                    {!source.described && !source.content.groups.length && (
                      <li className="catalog-empty">暂无分组或链路</li>
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
      {!scoped && (
        <div className="catalog-footer">
          <button
            className="text-button"
            onClick={create}
            title={
              hasNewDraft
                ? "继续尚未保存的新用例集"
                : "创建新的用例集及第一条链路"
            }
          >
            {hasNewDraft ? "继续新建草稿" : "＋ 新建用例集"}
          </button>
          <button className="text-button" onClick={importContent}>
            导入已有用例集
          </button>
        </div>
      )}
    </aside>
  );
}
