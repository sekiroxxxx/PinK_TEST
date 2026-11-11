import { useEffect, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import {
  contentSchema,
  contentStepSchema,
  detailSchema,
  type TestContent,
  type Mount,
  type ContentUnit,
} from "../../shared/content";
import {
  routeNodeSchema,
  flattenRoute,
  copyNode,
  type RouteNode,
} from "../../shared/routeTree";
import { Dialog } from "../components/Dialog";
import {
  useDraft,
  DraftNotice,
  useDraftRevision,
} from "../components/useDraft";
import { download } from "../browserBridge";
import {
  defaultActions,
  editorDraftSchema,
  nodesOf,
  pendingDraft,
  contentChanges,
  metaDrafts,
  nodeDrafts,
  metaFormSchema,
  type CatalogEdit,
} from "./routes/editorState";
import { RouteCanvas, hasNodeDraft } from "./routes/RouteCanvas";
import { groupAncestors, RouteBreadcrumb } from "./routes/RouteLibrary";

const text = z.string().max(50000);
const visualSchema = z.object({
  ...contentSchema.shape,
  name: text,
  groups: z.array(
    z.object({
      ...contentSchema.shape.groups.element.shape,
      title: text,
      units: z.array(
        z.object({
          id: z.string(),
          title: text,
          summary: text.default(""),
          details: detailSchema.default([]),
          stages: z.array(text).default(["准备", "检查", "整理"]),
          steps: z.array(contentStepSchema.extend({ title: text })),
          outline: z.array(routeNodeSchema).optional(),
        }),
      ),
    }),
  ),
});
export type ContentEditTarget = { unitId: string; stepId?: string };
export function hasPendingContentDraft(mount: Mount) {
  return (
    pendingDraft(mount.id, mount.content) ||
    mount.content.groups.some((g) =>
      g.units.some((u) => hasNodeDraft(mount.content.id + ":" + u.id)),
    )
  );
}
type Meta = CatalogEdit;
export function ContentEditor({
  mount,
  target,
  save,
  close,
  library,
  runSetup,
  editRequest,
  onEditHandled,
  resumeInitially = false,
}: {
  mount?: Mount;
  target?: ContentEditTarget;
  editRequest?: { request: CatalogEdit; token: string };
  onEditHandled?: () => void;
  resumeInitially?: boolean;
  save: (content: TestContent, selected?: string) => Promise<boolean>;
  close: () => void;
  library?: (
    content: TestContent,
    selected: string,
    select: (id: string) => void,
    add: (groupId?: string) => void,
    edit: (request: CatalogEdit) => void,
  ) => ReactNode;
  runSetup?: (unitId: string, dirty: boolean, resume: () => void) => ReactNode;
}) {
  useDraftRevision();
  const [initial] = useState<TestContent>(
    () =>
      mount?.content || {
        kind: "qa-test-content",
        schemaVersion: 1,
        id: crypto.randomUUID(),
        name: "新用例集",
        groups: [
          {
            id: crypto.randomUUID(),
            title: "未分组",
            units: [
              {
                id: crypto.randomUUID(),
                title: "新链路",
                summary: "",
                details: [],
                stages: ["准备", "检查", "整理"],
                steps: [],
                outline: [],
              },
            ],
          },
        ],
      },
  );
  const scope = mount?.id || "new";
  const draft = useDraft(
    "content:" + scope,
    { text: JSON.stringify(initial, null, 2) },
    editorDraftSchema,
  );
  let content = initial,
    invalid = false;
  try {
    content = visualSchema.parse(JSON.parse(draft.draft.text));
    for (const group of content.groups) {
      const visited = new Set([group.id]);
      let parent = group.parentId;
      while (parent) {
        const owner = content.groups.find((g) => g.id === parent);
        if (!owner || visited.has(parent)) throw new Error("目录结构无效");
        visited.add(parent);
        parent = owner.parentId;
      }
    }
  } catch {
    invalid = true;
  }
  const [selected, setSelected] = useState(
    target?.unitId ||
      draft.draft.selection?.unit ||
      content.groups.flatMap((g) => g.units)[0]?.id ||
      "",
  );
  const [meta, setMeta] = useState<Meta | null>(() =>
      !mount && !draft.hasDraft
        ? {
            kind: "route",
            id: content.groups[0]?.units[0]?.id,
            group: content.groups[0]?.id,
            creating: true,
          }
        : null,
    ),
    [previewRaw, setRaw] = useState(!!draft.draft.advanced),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [resumeSignal, setResumeSignal] = useState(0);
  useEffect(() => {
    if (!mount && !draft.hasDraft && !draft.storageError)
      draft.setDraft((value) => value);
  }, []);
  useEffect(() => {
    if (target?.unitId) setSelected(target.unitId);
  }, [target?.unitId]);
  useEffect(() => {
    if (!editRequest) return;
    editCatalog(editRequest.request);
    onEditHandled?.();
  }, [editRequest?.token]);
  const [removed, setRemoved] = useState<{
    unit: ContentUnit;
    group: string;
    index: number;
  } | null>(null);
  const owner = content.groups.find((g) =>
      g.units.some((u) => u.id === selected),
    ),
    unit = owner?.units.find((u) => u.id === selected);
  const changed =
    !mount ||
    mount.id.startsWith("legacy-draft:") ||
    invalid ||
    JSON.stringify(content) !==
      JSON.stringify(visualSchema.parse(mount?.content || initial));
  const changes = contentChanges(mount?.content, content);
  const unfinishedRoutes = content.groups
    .flatMap((g) => g.units)
    .filter((u) => hasNodeDraft(content.id + ":" + u.id));
  const unfinishedMeta = metaDrafts(content);
  const unfinished =
    unfinishedRoutes.reduce(
      (count, route) =>
        count + nodeDrafts(content.id + ":" + route.id, nodesOf(route)).length,
      0,
    ) + unfinishedMeta.length;
  const actions = [
    ...defaultActions.filter(
      (a) => !content.actionDescriptions?.some((x) => x.id === a.id),
    ),
    ...(content.actionDescriptions || []),
  ];
  function change(edit: (next: TestContent) => void) {
    const next = structuredClone(content);
    edit(next);
    draft.setDraft((d) => ({ ...d, text: JSON.stringify(next, null, 2) }));
    setError("");
    setSaved(false);
  }
  function select(unitId: string) {
    setSelected(unitId);
    draft.setDraft((d) => ({
      ...d,
      selection: {
        group:
          content.groups.find((g) => g.units.some((u) => u.id === unitId))
            ?.id || "",
        unit: unitId,
      },
    }));
  }
  function updateNodes(nodes: RouteNode[]) {
    change((c) => {
      const u = c.groups
        .flatMap((g) => g.units)
        .find((u) => u.id === selected)!;
      u.outline = nodes;
      u.steps = flattenRoute(nodes).map((s) => ({
        id: s.id,
        title: s.title,
        action: s.action,
        expected: s.expected,
        group: s.path.join(" / "),
        target: s.target,
      }));
    });
  }
  async function submit() {
    setSaving(true);
    setError("");
    try {
      const result = contentSchema.parse(JSON.parse(draft.draft.text));
      if (await save(result, selected)) {
        draft.clearDraft(false);
        setSaved(true);
      } else setError("用例集未能保存，草稿仍保留，请重试。");
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? "请补全名称，并检查分组、顺序和动作描述。"
          : String(e),
      );
    } finally {
      setSaving(false);
    }
  }
  function saveMeta(title: string, parent: string) {
    if (!meta) return;
    const id = meta.id || crypto.randomUUID();
    change((c) => {
      if (meta.kind === "collection") c.name = title;
      else if (meta.kind === "group") {
        const group = c.groups.find((g) => g.id === id);
        if (group) {
          group.title = title;
          group.parentId = parent || undefined;
        } else
          c.groups.push({
            id,
            title,
            parentId: parent || undefined,
            units: [],
          });
      } else {
        let destination = c.groups.find((g) => g.id === parent);
        if (!destination) {
          destination = c.groups.find(
            (g) => g.title === "未分组" && !g.parentId,
          );
        }
        if (!destination) {
          destination = { id: crypto.randomUUID(), title: "未分组", units: [] };
          c.groups.push(destination);
        }
        const previous = c.groups.find((g) => g.units.some((u) => u.id === id));
        if (previous) {
          const u = previous.units.find((u) => u.id === id)!;
          u.title = title;
          if (meta.creating && !mount) c.name = title;
          if (previous.id !== destination.id) {
            previous.units = previous.units.filter((u) => u.id !== id);
            destination.units.push(u);
          }
        } else
          destination.units.push({
            id,
            title,
            summary: "",
            details: [],
            stages: ["准备", "检查", "整理"],
            steps: [],
            outline: [],
          });
      }
    });
    if (meta.kind === "route") select(id);
    setMeta(null);
  }
  function editCatalog(request: CatalogEdit) {
    if (invalid) {
      setError("原文草稿尚未通过校验，请先修正；现有输入已保留。");
      return;
    }
    if (!request.action) {
      if (request.kind === "route" && request.id) select(request.id);
      setMeta(request);
      return;
    }
    const group = content.groups.find((g) =>
      g.units.some((u) => u.id === request.id),
    );
    const route = group?.units.find((u) => u.id === request.id);
    if (!group || !route) return;
    if (request.action === "copy") {
      const copy = structuredClone(route);
      copy.id = crypto.randomUUID();
      copy.title += " · 副本";
      copy.outline = nodesOf(route).map(copyNode);
      copy.steps = flattenRoute(copy.outline);
      change((c) => {
        const units = c.groups.find((g) => g.id === group.id)!.units;
        units.splice(units.findIndex((u) => u.id === route.id) + 1, 0, copy);
      });
      select(copy.id);
      setMeta({ kind: "route", id: copy.id, group: group.id });
    } else if (request.action === "remove") {
      setRemoved({
        unit: route,
        group: group.id,
        index: group.units.indexOf(route),
      });
      change((c) => {
        const g = c.groups.find((g) => g.id === group.id)!;
        g.units = g.units.filter((u) => u.id !== route.id);
      });
      if (selected === route.id) setSelected("");
    } else
      change((c) => {
        const units = c.groups.find((g) => g.id === group.id)!.units;
        const index = units.findIndex((u) => u.id === route.id);
        const to = index + (request.action === "up" ? -1 : 1);
        if (to >= 0 && to < units.length)
          [units[index], units[to]] = [units[to], units[index]];
      });
  }
  function resumeDraft() {
    const route =
      unfinishedRoutes.find((u) => u.id === selected) || unfinishedRoutes[0];
    if (route) {
      select(route.id);
      setResumeSignal((n) => n + 1);
    } else if (unfinishedMeta[0]) editCatalog(unfinishedMeta[0]);
  }
  useEffect(() => {
    if (resumeInitially) resumeDraft();
  }, [resumeInitially]);
  const saveBar = (
    <section className="collection-save-bar" aria-label="用例集保存状态">
      <div className="collection-save-description">
        <span className="collection-save-scope">
          保存范围：{content.name || "未命名用例集"}
        </span>
        {(error || draft.storageError || saving || changed || saved) && (
          <p
            role={error || draft.storageError ? "alert" : "status"}
            className={error || draft.storageError ? "error-text" : ""}
          >
            {error ||
              draft.storageError ||
              (saving
                ? "正在保存用例集…"
                : changed
                  ? `用例集待保存${changes.routes.length ? `，涉及 ${changes.routes.length} 条链路` : "，目录或名称有修改"}。保存后用于新测试。`
                  : saved
                    ? "用例集已保存"
                    : "")}
          </p>
        )}
        {!!unfinished && (
          <div className="collection-unfinished">
            <span>{unfinished} 处未完成编辑，尚未更新到用例集</span>
            <button className="text-button" onClick={resumeDraft}>
              继续编辑
            </button>
          </div>
        )}
      </div>
      <button
        className="primary"
        disabled={saving || !changed}
        onClick={() => void submit()}
      >
        {saving ? "保存中…" : "保存并返回"}
      </button>
    </section>
  );
  function renderLibrary(parent?: string): React.ReactNode {
    return content.groups
      .filter((g) => g.parentId === parent)
      .map((g) => (
        <div className="route-library-group" key={g.id}>
          <div className="route-library-label">
            <span>{g.title}</span>
            <button
              className="quiet"
              aria-label={"编辑分组：" + g.title}
              onClick={() => setMeta({ kind: "group", id: g.id })}
            >
              •••
            </button>
          </div>
          {g.units.map((u) => (
            <button
              key={u.id}
              className={
                "route-library-item " + (selected === u.id ? "active" : "")
              }
              onClick={() => select(u.id)}
            >
              <strong>{u.title}</strong>
              <small>
                {u.outline ? flattenRoute(u.outline).length : u.steps.length}{" "}
                个步骤
              </small>
            </button>
          ))}
          {renderLibrary(g.id)}
        </div>
      ));
  }
  return (
    <section className="chain-editor" aria-label="链路编辑工作区">
      <fieldset
        className="plain-fieldset route-editor-fields"
        disabled={saving}
      >
        {!library && (
          <label className="field">
            内容名称
            <input
              value={content.name}
              disabled={invalid}
              onChange={(e) =>
                change((c) => {
                  c.name = e.target.value;
                })
              }
            />
          </label>
        )}
        {invalid || previewRaw ? (
          <>
            <label className="field">
              {invalid ? "旧草稿原文保留，请修正后返回可视化" : "内容原文"}
              <textarea
                className="json-editor"
                value={draft.draft.text}
                onChange={(e) =>
                  draft.setDraft((d) => ({ ...d, text: e.target.value }))
                }
              />
            </label>
            {saveBar}
          </>
        ) : (
          <div className="route-studio">
            {library ? (
              library(
                content,
                selected,
                select,
                (groupId = "") =>
                  editCatalog({
                    kind: "route",
                    group: groupId,
                    explicitLocation: true,
                  }),
                editCatalog,
              )
            ) : (
              <aside className="route-library" aria-label="我的链路">
                <div className="route-library-tools">
                  <strong>我的链路</strong>
                  <button
                    className="quiet"
                    aria-label="新建链路"
                    onClick={() => setMeta({ kind: "route", group: owner?.id })}
                  >
                    ＋
                  </button>
                </div>
                {renderLibrary()}
                <button
                  className="text-button"
                  onClick={() => setMeta({ kind: "group" })}
                >
                  ＋ 整理分组
                </button>
              </aside>
            )}
            <div className="route-workspace">
              {unit ? (
                <>
                  <div className="route-workspace-heading">
                    <div>
                      <RouteBreadcrumb
                        parts={[
                          content.name,
                          ...groupAncestors(content, owner?.id).map(
                            (g) => g.title,
                          ),
                          unit.title,
                        ]}
                      />
                      <h1>{unit.title}</h1>
                      {unit.summary && <p className="hint">{unit.summary}</p>}
                    </div>
                    <details className="more-menu">
                      <summary aria-label="链路更多操作">•••</summary>
                      <div>
                        <button
                          onClick={() =>
                            editCatalog({
                              kind: "route",
                              id: unit.id,
                              group: owner!.id,
                            })
                          }
                        >
                          名称与归属
                        </button>
                        <button
                          onClick={() =>
                            editCatalog({
                              kind: "route",
                              id: unit.id,
                              action: "copy",
                            })
                          }
                        >
                          复制链路
                        </button>
                        <button
                          disabled={owner!.units[0]?.id === unit.id}
                          onClick={() =>
                            editCatalog({
                              kind: "route",
                              id: unit.id,
                              action: "up",
                            })
                          }
                        >
                          上移链路
                        </button>
                        <button
                          disabled={owner!.units.at(-1)?.id === unit.id}
                          onClick={() =>
                            editCatalog({
                              kind: "route",
                              id: unit.id,
                              action: "down",
                            })
                          }
                        >
                          下移链路
                        </button>
                        <button
                          onClick={() =>
                            editCatalog({
                              kind: "route",
                              id: unit.id,
                              action: "remove",
                            })
                          }
                        >
                          移除链路
                        </button>
                      </div>
                    </details>
                  </div>
                  <RouteCanvas
                    key={unit.id}
                    scope={content.id + ":" + unit.id}
                    title={unit.title}
                    path={[
                      content.name,
                      ...groupAncestors(content, owner?.id).map((g) => g.title),
                      unit.title,
                    ]}
                    showDraftNotice={false}
                    resumeSignal={resumeSignal}
                    nodes={nodesOf(unit)}
                    actions={actions}
                    change={updateNodes}
                    initialStep={
                      target?.unitId === unit.id ? target.stepId : undefined
                    }
                  />
                  {!!unit.details.length && (
                    <details>
                      <summary>已有配置说明</summary>
                      {unit.details.map((d, i) => (
                        <section className="inset" key={i}>
                          <h3>{d.title}</h3>
                          {d.fields.map((f, j) => (
                            <p key={j}>
                              {f.label}：{f.value}
                            </p>
                          ))}
                        </section>
                      ))}
                    </details>
                  )}
                  {runSetup?.(
                    unit.id,
                    changed || hasNodeDraft(content.id + ":" + unit.id),
                    () => {
                      if (unfinished) resumeDraft();
                      document
                        .querySelector(".route-canvas")
                        ?.scrollIntoView({ block: "start" });
                    },
                  )}
                </>
              ) : (
                <div className="empty">
                  <h3>选择或新建一条链路</h3>
                  <button
                    className="primary"
                    onClick={() => setMeta({ kind: "route" })}
                  >
                    新建链路
                  </button>
                </div>
              )}
              {removed && (
                <p className="notice">
                  链路已移除{" "}
                  <button
                    className="text-button"
                    onClick={() => {
                      change((c) => {
                        const g = c.groups.find((g) => g.id === removed.group);
                        if (g) g.units.splice(removed.index, 0, removed.unit);
                      });
                      select(removed.unit.id);
                      setRemoved(null);
                    }}
                  >
                    撤销
                  </button>
                </p>
              )}
              {saveBar}
            </div>
          </div>
        )}
        <footer className="editor-file-actions">
          <details className="more-menu author-next">
            <summary>更多</summary>
            <div>
              <button
                onClick={() => {
                  setRaw(!previewRaw);
                  draft.setDraft((d) => ({ ...d, advanced: !previewRaw }));
                }}
              >
                {previewRaw ? "返回可视化" : "编辑原文"}
              </button>
              <button
                onClick={() => {
                  try {
                    download(
                      "test-content.json",
                      contentSchema.parse(JSON.parse(draft.draft.text)),
                    );
                  } catch {
                    setError("请补全内容后再导出。");
                  }
                }}
              >
                导出内容
              </button>
            </div>
          </details>
        </footer>
      </fieldset>
      {meta && (
        <MetaDialog
          key={meta.kind + (meta.id || "new")}
          meta={meta}
          content={content}
          close={() => setMeta(null)}
          save={saveMeta}
        />
      )}
    </section>
  );
}
function MetaDialog({
  meta,
  content,
  save,
  close,
}: {
  meta: Meta;
  content: TestContent;
  save: (title: string, parent: string) => void;
  close: () => void;
}) {
  const group =
    meta.kind === "group"
      ? content.groups.find((g) => g.id === meta.id)
      : undefined;
  const unit =
    meta.kind === "route"
      ? content.groups.flatMap((g) => g.units).find((u) => u.id === meta.id)
      : undefined;
  const d = useDraft(
    "route-meta:" + content.id + ":" + meta.kind + ":" + (meta.id || "new"),
    {
      title:
        meta.kind === "collection" || meta.creating
          ? content.name
          : group?.title || unit?.title || "",
      parent: group?.parentId || meta.group || "",
      creating: meta.creating,
    },
    metaFormSchema,
  );
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    // An explicit directory action changes the destination, not the recovered name.
    if (meta.explicitLocation && d.draft.parent !== (meta.group || ""))
      d.setDraft((previous) => ({ ...previous, parent: meta.group || "" }));
    form.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, []);
  function descendant(id: string): boolean {
    if (id === meta.id) return true;
    const g = content.groups.find((g) => g.id === id);
    return !!g?.parentId && descendant(g.parentId);
  }
  return (
    <Dialog
      title={
        meta.creating
          ? "新建用例集"
          : (meta.id ? "编辑" : "新建") +
            (meta.kind === "collection"
              ? "用例集"
              : meta.kind === "group"
                ? "目录分组"
                : "链路")
      }
      onClose={close}
    >
      <form
        ref={form}
        onSubmit={(e) => {
          e.preventDefault();
          if (!d.draft.title.trim()) return;
          save(d.draft.title.trim(), d.draft.parent);
          d.clearDraft();
        }}
      >
        <DraftNotice
          {...d}
          savedHint={
            meta.id && !meta.creating
              ? "更新后纳入用例集草稿"
              : "创建后纳入用例集草稿"
          }
          discard={() => d.clearDraft()}
          discardLabel="丢弃本次名称与归属编辑"
        />
        <p className="hint">
          {meta.id && !meta.creating ? "所在位置" : "创建位置"}：
          {[
            content.name,
            ...groupAncestors(content, d.draft.parent).map((g) => g.title),
            ...(!d.draft.parent && meta.kind === "route" ? ["未分组"] : []),
          ].join(" / ")}
        </p>
        <label className="field">
          {meta.creating ? "用例集与首条链路名称" : "名称"}
          <input
            autoFocus
            required
            value={d.draft.title}
            onChange={(e) => d.setDraft({ ...d.draft, title: e.target.value })}
          />
        </label>
        {meta.kind !== "collection" && (
          <label className="field">
            放入
            <select
              value={d.draft.parent}
              onChange={(e) =>
                d.setDraft({ ...d.draft, parent: e.target.value })
              }
            >
              <option value="">
                {meta.kind === "group" ? "最外层" : "未分组"}
              </option>
              {content.groups
                .filter((g) => meta.kind !== "group" || !descendant(g.id))
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {groupAncestors(content, g.id)
                      .map((parent) => parent.title)
                      .join(" / ")}
                  </option>
                ))}
            </select>
          </label>
        )}
        <footer className="dialog-actions">
          <button type="button" onClick={close}>
            关闭
          </button>
          <button className="primary" type="submit">
            {meta.id && !meta.creating ? "更新" : "创建"}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
