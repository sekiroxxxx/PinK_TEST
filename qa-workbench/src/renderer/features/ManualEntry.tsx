import { z } from "zod";
import type { ReactNode } from "react";
import type { Mount } from "../../shared/content";
import type { State } from "../../shared/model";
import { readDraft, useDraft, useDraftRevision } from "../components/useDraft";
import { manualSources } from "./manualSources";
import { groupAncestors } from "./routes/RouteLibrary";
import { sequenceOf } from "./routes/RouteSequence";

export function ManualEntry({
  state,
  back,
  view,
  edit,
  start,
  blank,
  importContent,
  continuation,
}: {
  state: State;
  back: () => void;
  view: (id: string, unit?: string) => void;
  edit: (id: string, unit?: string) => void;
  start: (mount: Mount, ids: string[]) => void;
  blank: () => void;
  importContent: () => void;
  continuation?: ReactNode;
}) {
  useDraftRevision();
  const sources = manualSources(state);
  const filter = useDraft("manual-entry-filter", "", z.string());
  const expansion = useDraft(
    "manual-entry-expanded",
    {} as Record<string, boolean>,
    z.record(z.string(), z.boolean()),
  );
  const hasDraft = readDraft("content:new") != null;
  return (
    <section className="entry-page">
      <button className="text-button" onClick={back}>
        ← 返回工作台
      </button>
      <div className="page-heading">
        <div>
          <p className="eyebrow">自己测试</p>
          <h1>带着一条链路，或直接开始</h1>
          <p>用例由你维护，测试中随时补充检查项。</p>
        </div>
        <button className="primary" onClick={blank}>
          空白开始
        </button>
      </div>
      {continuation}
      <div className="entry-toolbar">
        <input
          aria-label="查找人工链路"
          placeholder="查找链路或用例集"
          value={filter.draft}
          onChange={(event) => filter.setDraft(event.target.value)}
        />
        <div className="toolbar">
          <button onClick={() => edit("new")}>
            {hasDraft ? "继续新建草稿" : "新建链路"}
          </button>
          <button onClick={importContent}>导入链路</button>
        </div>
      </div>
      {sources
        .filter((mount) =>
          [
            mount.name,
            ...mount.content.groups.flatMap((group) =>
              group.units.map((unit) => unit.title),
            ),
          ]
            .join(" ")
            .toLowerCase()
            .includes(filter.draft.toLowerCase()),
        )
        .map((mount, index) => {
          const units = mount.content.groups
            .flatMap((group) =>
              group.units.map((unit) => ({
                unit,
                path: groupAncestors(mount.content, group.id)
                  .map((item) => item.title)
                  .join(" / "),
              })),
            )
            .filter(
              ({ unit }) =>
                !filter.draft ||
                mount.name.toLowerCase().includes(filter.draft.toLowerCase()) ||
                unit.title.toLowerCase().includes(filter.draft.toLowerCase()),
            );
          return (
            <details
              className="entry-collection"
              key={mount.id}
              open={
                !!filter.draft || (expansion.draft[mount.id] ?? index === 0)
              }
              onToggle={(event) => {
                const opened = event.currentTarget.open;
                if (opened !== (expansion.draft[mount.id] ?? index === 0))
                  expansion.setDraft((value) => ({
                    ...value,
                    [mount.id]: opened,
                  }));
              }}
            >
              <summary>
                <strong>{mount.name}</strong>
                <small>{units.length} 条链路</small>
              </summary>
              {units.map(({ unit, path }) => (
                <div className="entry-route" key={unit.id}>
                  <button
                    className="entry-route-title"
                    onClick={() => view(mount.id, unit.id)}
                  >
                    <strong>{unit.title}</strong>
                    <small>
                      {path} · {sequenceOf(unit).length} 个检查项
                    </small>
                  </button>
                  <div className="toolbar">
                    <button
                      className="quiet"
                      onClick={() => view(mount.id, unit.id)}
                    >
                      查看用例
                    </button>
                    <button onClick={() => start(mount, [unit.id])}>
                      开始测试
                    </button>
                  </div>
                </div>
              ))}
              {!units.length && (
                <div className="empty">
                  <p>这个用例集还没有链路。</p>
                  <button onClick={() => edit(mount.id)}>编写第一条链路</button>
                </div>
              )}
            </details>
          );
        })}
      {!sources.length && (
        <div className="empty">
          <h2>从一次检查开始</h2>
          <p>可以空白开始，也可以先写一条自己的链路。</p>
        </div>
      )}
    </section>
  );
}
