import { useState } from "react";
import type { Mount, TestContent } from "../../shared/content";
import type { State } from "../../shared/model";
import {
  RouteLibrary,
  RouteBreadcrumb,
  groupAncestors,
} from "./routes/RouteLibrary";
import { ContentEditor, hasPendingContentDraft } from "./ContentEditor";
import { SequenceList } from "./routes/RouteSequence";
import { useDraftRevision } from "../components/useDraft";
import { manualSources } from "./manualSources";
import { download } from "../browserBridge";
import {
  type CatalogEdit,
  contentChanges,
  metaDrafts,
  nodeDrafts,
} from "./routes/editorState";

export function ChainWorkspace({
  state,
  mountId,
  unitId,
  editing,
  resume,
  save,
  back,
  view,
  edit,
  prepare,
  importContent,
}: {
  state: State;
  mountId: string;
  unitId?: string;
  editing: boolean;
  resume?: boolean;
  save: (state: State) => Promise<boolean>;
  back: () => void;
  view: (id: string, unit?: string) => void;
  edit: (id: string, unit?: string, resume?: boolean) => void;
  prepare: (mount: Mount, ids: string[]) => void;
  importContent: () => void;
}) {
  useDraftRevision();
  const active = manualSources(state).find((mount) => mount.id === mountId);
  const [request, setRequest] = useState<{
    request: CatalogEdit;
    token: string;
  }>();
  const savedUnit =
    active?.content.groups
      .flatMap((group) => group.units)
      .find((unit) => unit.id === unitId) ||
    active?.content.groups.flatMap((group) => group.units)[0];
  function library(
    content: TestContent,
    selected: string,
    select: (id: string) => void,
    add?: (groupId?: string) => void,
    editCatalog?: (request: CatalogEdit) => void,
  ) {
    const changes = contentChanges(active?.content, content);
    const metas = metaDrafts(content);
    const unfinished = content.groups
      .flatMap((group) => group.units)
      .filter(
        (unit) =>
          nodeDrafts(content.id + ":" + unit.id, unit.outline).length > 0 ||
          metas.some((item) => item.id === unit.id),
      );
    return (
      <RouteLibrary
        scoped
        sources={[
          {
            id: active?.id || "new",
            name: content.name,
            content,
            loaded: true,
            dirty: changes.structure || changes.routes.length > 0,
            dirtyRoutes: changes.routes,
            unfinishedRoutes: unfinished.map((unit) => unit.id),
            unfinishedCount:
              unfinished.length +
              metas.filter((item) => item.kind !== "route").length,
          },
        ]}
        activeId={active?.id || "new"}
        selectedId={selected}
        readOnly={!editing}
        choose={(_, id) => select(id)}
        add={(_, group) => add?.(group)}
        edit={(_, value) => editCatalog?.(value)}
        create={() => {}}
        importContent={importContent}
        load={() => {}}
        multiple={false}
        checked={[]}
        check={() => {}}
      />
    );
  }
  async function persist(content: TestContent, selected?: string) {
    const id = active?.id || crypto.randomUUID();
    const mount: Mount = {
      id,
      name: content.name,
      content,
      sourceName: active?.sourceName || "界面创建",
    };
    const next = state.mounts.some((item) => item.id === id)
      ? state.mounts.map((item) =>
          item.id === id ? { ...item, name: content.name, content } : item,
        )
      : [...state.mounts, mount];
    if (await save({ ...state, mounts: next })) {
      view(id, selected);
      return true;
    }
    return false;
  }
  if (!active && mountId !== "new")
    return (
      <section className="entry-page">
        <button onClick={back}>返回自己测试</button>
        <p role="alert">未找到这份用例，已有记录未改动。</p>
      </section>
    );
  if (editing)
    return (
      <section className="chain-workspace" data-page="case-edit">
        <div className="workspace-nav">
          <button
            className="text-button"
            onClick={() => (active ? view(active.id, unitId) : back())}
          >
            ← {active ? "返回用例浏览" : "返回自己测试"}
          </button>
          <span>人工用例 · 编辑操作与预期</span>
        </div>
        <ContentEditor
          key={active?.id || "new"}
          mount={active}
          target={unitId ? { unitId } : undefined}
          resumeInitially={resume}
          library={library}
          save={persist}
          close={() => (active ? view(active.id, unitId) : back())}
          editRequest={request}
          onEditHandled={() => setRequest(undefined)}
        />
      </section>
    );
  const group = active!.content.groups.find((item) =>
    item.units.some((unit) => unit.id === savedUnit?.id),
  );
  const pending = hasPendingContentDraft(active!);
  return (
    <section className="chain-workspace" data-page="case-view">
      <div className="workspace-nav">
        <button className="text-button" onClick={back}>
          ← 返回自己测试
        </button>
        <span>用例浏览 · 已保存内容</span>
      </div>
      <div className="route-studio">
        {library(active!.content, savedUnit?.id || "", (id) =>
          view(active!.id, id),
        )}
        <div className="route-workspace">
          <RouteBreadcrumb
            parts={[
              active!.name,
              ...groupAncestors(active!.content, group?.id).map(
                (item) => item.title,
              ),
              ...(savedUnit ? [savedUnit.title] : []),
            ]}
          />
          <div className="page-heading">
            <div>
              <p className="eyebrow">人工用例</p>
              <h1>{savedUnit?.title || active!.name}</h1>
            </div>
            <div className="toolbar">
              <button onClick={() => edit(active!.id, savedUnit?.id)}>
                编辑用例
              </button>
              <button
                className="primary"
                onClick={() =>
                  prepare(active!, savedUnit ? [savedUnit.id] : [])
                }
              >
                开始测试
              </button>
              <details className="more-menu">
                <summary>更多</summary>
                <div>
                  <button
                    onClick={() =>
                      download("personal-test-content.json", active!.content)
                    }
                  >
                    导出已保存用例
                  </button>
                  <button onClick={importContent}>导入用例集</button>
                </div>
              </details>
            </div>
          </div>
          {pending && (
            <p className="case-draft-note" role="status">
              有未保存编辑{" "}
              <button
                className="text-button"
                onClick={() => edit(active!.id, savedUnit?.id, true)}
              >
                继续编辑草稿
              </button>
            </p>
          )}
          {savedUnit ? (
            <SequenceList unit={savedUnit} />
          ) : (
            <div className="empty">
              <p>还没有链路。</p>
              <button onClick={() => edit(active!.id)}>新增链路</button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
