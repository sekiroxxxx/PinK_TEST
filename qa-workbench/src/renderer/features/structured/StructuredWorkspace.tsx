import { useEffect, useMemo, useState, useRef, useId } from "react";
import { z } from "zod";
import type { Mount, TestContent } from "../../../shared/content";
import { Dialog } from "../../components/Dialog";
import {
  useDraft,
  useViewState,
  draftKeys,
  readDraft,
  replaceStoredDraft,
} from "../../components/useDraft";
import { download } from "../../browserBridge";
import { serialize, sha256, displayValue, type EditorData } from "./contract";
import {
  flatten,
  ensureEditorCompatibility,
  authoringTree,
  completeAuthoringConstants,
  AuthoringValidationError,
  type AuthoringIssue,
  type AuthoringAdapter,
  type EditNode,
  type EditField,
  type EditAction,
} from "./authoring";

import { structuredPreview } from "./preview";
import { SequenceDialog } from "../routes/RouteSequence";
import { automationModule } from "../automation/modules";
import { SchemaInput } from "./SchemaInput";
import { CaseCanvas } from "./CaseCanvas";
import {
  organizationSchema,
  emptyOrganization,
  reconcileOrganization,
  organize,
} from "./organization";
export { organize } from "./organization";
const fieldPositionSchema = z.object({
  node: z.string(),
  key: z.string(),
  association: z.string().optional(),
});
type FieldPosition = z.infer<typeof fieldPositionSchema>;
const draftSchema = z.object({
  document: z.record(z.string(), z.unknown()),
  organization: organizationSchema,
  selection: z.string(),
  labels: z.record(z.string(), z.string()).default({}),
  lastField: fieldPositionSchema.optional(),
});
type AuthoringDraft = z.infer<typeof draftSchema>;
const contentDraftSchema = draftSchema.omit({
  selection: true,
  lastField: true,
});
const positionSchema = draftSchema.pick({ selection: true, lastField: true });
function contentPart(value: AuthoringDraft) {
  return {
    document: value.document,
    labels: value.labels,
    organization: value.organization,
  };
}
function positionPart(value: AuthoringDraft) {
  return { selection: value.selection, lastField: value.lastField };
}
function useAuthoringDraft(key: string, initial: AuthoringDraft) {
  const content = useDraft(key, contentPart(initial), contentDraftSchema);
  const position = useViewState(key, positionPart(initial), positionSchema);
  const current = useRef<AuthoringDraft>({
    ...content.draft,
    ...position.draft,
  });
  current.current = { ...content.draft, ...position.draft };
  const rendered = current.current;
  return {
    ...content,
    draft: rendered,
    setDraft(next: React.SetStateAction<AuthoringDraft>) {
      const previous = current.current;
      const value = typeof next === "function" ? next(previous) : next;
      current.current = value;
      if (
        value.document !== previous.document ||
        value.labels !== previous.labels ||
        value.organization !== previous.organization
      )
        content.setDraft(contentPart(value));
      if (
        value.selection !== previous.selection ||
        JSON.stringify(value.lastField) !== JSON.stringify(previous.lastField)
      )
        position.setDraft(positionPart(value));
    },
    clearDraft(reset = true, expected = rendered) {
      content.clearDraft(reset, contentPart(expected));
      if (reset) position.setDraft(positionPart(initial));
    },
  };
}
export function StructuredWorkspace({
  mount,
  save,
  back,
  exitEditing,
  initialSelection,
  previewContent,
  sources,
}: {
  mount: Mount;
  save: (editor: EditorData) => Promise<boolean>;
  back: () => void;
  exitEditing?: () => void;
  initialSelection?: string;
  previewContent?: (
    document: Record<string, unknown>,
    labels: Record<string, string>,
  ) => TestContent;
  sources?: Mount[];
}) {
  const [adapter, setAdapter] = useState<AuthoringAdapter>();
  const [error, setError] = useState("");
  const [savedStatus, setSavedStatus] = useState("");
  useEffect(() => {
    let live = true;
    setAdapter(undefined);
    setError("");
    const module = automationModule(mount.editor!.moduleId);
    if (!module) {
      setError("未安装该内容的编辑模块，原文保留。");
      return;
    }
    void module
      .load({ sources, document: mount.editor!.document })
      .then(async ({ adapter: a }) => {
        await ensureEditorCompatibility(a, mount.editor!);
        if (live) setAdapter(a);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [mount.id, mount.editor!.descriptionHash, mount.editor!.documentHash]);
  return error ? (
    <section>
      <button onClick={back}>返回用例浏览</button>
      <p role="alert">{error}</p>
    </section>
  ) : adapter ? (
    <AuthorWorkspace
      key={mount.id + mount.editor!.documentHash}
      savedStatus={savedStatus}
      setSavedStatus={setSavedStatus}
      mount={mount}
      adapter={adapter}
      save={save}
      back={back}
      exitEditing={exitEditing}
      initialSelection={initialSelection}
      previewContent={previewContent}
    />
  ) : (
    <p>正在读取编辑规则…</p>
  );
}
function AuthorWorkspace({
  savedStatus,
  setSavedStatus,
  mount,
  adapter,
  save,
  back,
  exitEditing,
  initialSelection,
  previewContent,
}: {
  mount: Mount;
  adapter: AuthoringAdapter;
  savedStatus: string;
  setSavedStatus: (s: string) => void;
  save: (e: EditorData) => Promise<boolean>;
  back: () => void;
  exitEditing?: () => void;
  initialSelection?: string;
  previewContent?: (
    document: Record<string, unknown>,
    labels: Record<string, string>,
  ) => TestContent;
}) {
  const original = mount.editor!;
  const recovered = useMemo(() => {
    try {
      return { document: adapter.recover(original, mount.id), error: "" };
    } catch (e) {
      return {
        document: original.document,
        error: "旧草稿未能转换，原草稿仍保留：" + String(e),
      };
    }
  }, []);
  const draft = useAuthoringDraft(
    "authoring:" + mount.id + ":" + original.documentHash,
    {
      document: recovered.document,
      organization: original.organization || emptyOrganization,
      labels: original.labels || {},
      selection:
        initialSelection ||
        original.lastSelection ||
        adapter.tree(original.document)[0]?.id ||
        "",
    },
  );
  const {
    document: doc,
    organization: pendingOrganization,
    selection,
  } = draft.draft;
  const [protectedFolders] = useState(
    () => new Set(pendingOrganization.folders.map((folder) => folder.id)),
  );
  const [undo, setUndo] = useState<{
    value: AuthoringDraft;
    selected: string[];
    label: string;
    children?: [string, unknown][];
  }>();
  const [error, setError] = useState(recovered.error),
    [saving, setSaving] = useState(false),
    [status, setStatus] = useState("");
  const [validation, setValidation] = useState<AuthoringValidationError>();
  const [locateSignal, setLocateSignal] = useState(0);
  const [preview, setPreview] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const linkedPairs = useRef(new Map<string, HTMLDetailsElement>());
  const [fieldFocus, setFieldFocus] = useState<FieldPosition | undefined>(() =>
    !initialSelection || initialSelection === draft.draft.lastField?.node
      ? draft.draft.lastField
      : undefined,
  );
  const [action, setAction] = useState<EditAction>();
  const [selected, setSelected] = useState(
    new Set(
      (original.review?.definitionIds || [])
        .map(
          (id) =>
            flatten(adapter.tree(doc)).find(
              (n) => n.id === id || n.definitionId === id,
            )?.id,
        )
        .filter((id): id is string => !!id),
    ),
  );
  const base = useMemo(
    () => authoringTree(adapter, doc, draft.draft.labels),
    [doc, adapter, draft.draft.labels],
  );
  const organization = useMemo(
    () => reconcileOrganization(base, pendingOrganization),
    [base, pendingOrganization],
  );
  useEffect(() => {
    const target = initialSelection || fieldFocus?.node;
    if (target && flatten(base).some((n) => n.id === target))
      draft.setDraft((d) => ({ ...d, selection: target }));
  }, [initialSelection]);
  const tree = useMemo(
    () => organize(base, organization),
    [base, organization],
  );
  const all = flatten(tree);
  const current = all.find((n) => n.id === selection) || tree[0];
  const root =
    tree.find(
      (n) =>
        n.id === selection ||
        flatten(n.children || []).some((child) => child.id === selection),
    ) || tree[0];

  const folder = organization.folders.find((f) => f.id === current?.id);
  let actionOwner = current;
  while (
    actionOwner &&
    organization.folders.some((f) => f.id === actionOwner.id)
  ) {
    const parent = all.find((n) =>
      n.children?.some((c) => c.id === actionOwner.id),
    );
    if (!parent) break;
    actionOwner = parent;
  }
  const actions = folder
    ? actionOwner?.canHaveFolders
      ? actionOwner.actions?.filter((a) => a.creates)
      : []
    : current?.actions;
  const canCreateFolder = folder
    ? actionOwner?.canHaveFolders
    : current?.canHaveFolders;
  const canMoveToFolder =
    !!folder ||
    flatten(base).some(
      (parent) =>
        parent.canHaveFolders &&
        parent.children?.some((child) => child.id === current?.id),
    );
  const dirty =
    serialize(doc) !== serialize(original.document) ||
    serialize(draft.draft.labels || {}) !== serialize(original.labels || {}) ||
    serialize(pendingOrganization) !==
      serialize(original.organization || emptyOrganization);
  function updateDraft(next: React.SetStateAction<AuthoringDraft>) {
    setValidation(undefined);
    setUndo(undefined);
    setStatus("");
    setSavedStatus("");
    setError("");
    draft.setDraft(next);
  }
  function select(id: string, association?: string, key?: string) {
    setFieldFocus(
      association && key ? { node: id, association, key } : undefined,
    );
    draft.setDraft((d) => ({ ...d, selection: id }));
    setStatus("");
    setSavedStatus("");
  }
  async function command(
    action: string,
    key?: string,
    value?: unknown,
    targetNode?: string,
    position?: Omit<FieldPosition, "node">,
  ) {
    if (key === "ui-label") {
      updateDraft((d) => ({
        ...d,
        labels: { ...d.labels, [targetNode || current.id]: String(value) },
      }));
      return true;
    }
    try {
      const previousDraft = draft.draft;
      const result = await adapter.apply(doc, {
        node: targetNode || (folder ? actionOwner.id : current.id),
        action,
        key,
        value,
      });
      const newTree = adapter.tree(result.document);
      const remap = (id: string) =>
        Object.hasOwn(result.remap || {}, id) ? result.remap![id] : id;
      const placed: Record<string, string> = {};
      const targetId = targetNode || (folder ? actionOwner.id : current.id);
      const creationFolder =
        (!targetNode && folder?.id) || organization.parents[targetId];
      const creates =
        flatten(base)
          .find((node) => node.id === targetId)
          ?.actions?.find((item) => item.id === action)?.creates ||
        action === "copy";
      if (creationFolder && creates) {
        const beforeIds = new Set(
          flatten(base)
            .map((n) => remap(n.id))
            .filter(Boolean),
        );
        const visit = (nodes: EditNode[]) =>
          nodes.forEach((n) => {
            if (!beforeIds.has(n.id)) placed[n.id] = creationFolder;
            else visit(n.children || []);
          });
        visit(newTree);
      }
      setSelected(
        (s) => new Set([...s].map(remap).filter((id): id is string => !!id)),
      );
      const nextOrganization = reconcileOrganization(newTree, organization, {
        previous: base,
        remap: result.remap,
        protectedFolders,
      });
      nextOrganization.parents = { ...nextOrganization.parents, ...placed };
      setFieldFocus((field) =>
        field && remap(field.node)
          ? remap(field.node) === field.node
            ? field
            : { ...field, node: remap(field.node)! }
          : undefined,
      );
      updateDraft((d) => ({
        ...d,
        organization: nextOrganization,
        document: result.document,
        labels: {
          ...Object.fromEntries(
            Object.entries(d.labels || {})
              .map(([id, label]) => [remap(id), label])
              .filter(([id]) => !!id),
          ),
          ...result.labels,
        },
        selection:
          result.selection || remap(d.selection) || newTree[0]?.id || "",
        lastField: position
          ? { ...position, node: current.id }
          : d.lastField && remap(d.lastField.node)
            ? { ...d.lastField, node: remap(d.lastField.node)! }
            : undefined,
      }));
      setAction(undefined);
      setSavedStatus("");
      setError("");
      setStatus("");
      if (action === "remove")
        setUndo({
          value: previousDraft,
          selected: [...selected],
          label: "撤销移除",
        });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }
  function addFolder() {
    if (!canCreateFolder) return;
    const id = "folder:" + crypto.randomUUID();
    updateDraft((d) => ({
      ...d,
      selection: id,
      organization: {
        ...organization,
        folders: [
          ...organization.folders,
          { id, title: "新目录", parent: current?.id },
        ],
      },
    }));
  }
  function removeFolder() {
    if (!folder) return;
    setUndo({
      value: draft.draft,
      selected: [...selected],
      label: "撤销移除目录",
    });
    const parent = folder.parent;
    const parents = { ...organization.parents };
    delete parents[folder.id];
    for (const [key, value] of Object.entries(parents)) {
      if (value !== folder.id) continue;
      if (parent && organization.folders.some((item) => item.id === parent))
        parents[key] = parent;
      else delete parents[key];
    }
    draft.setDraft((value) => ({
      ...value,
      selection: parent || base[0]?.id || "",
      organization: {
        folders: organization.folders
          .filter((item) => item.id !== folder.id)
          .map((item) =>
            item.parent === folder.id ? { ...item, parent } : item,
          ),
        parents,
      },
    }));
    setError("");
    setStatus("已移除目录，其中的用例仍保留。");
  }
  function discardDraft() {
    setValidation(undefined);
    const prefixes = [
      `author-action:${mount.id}:${original.documentHash}:`,
      `structured:${mount.id}:${original.documentHash}`,
      `structured-field:${mount.id}:${original.documentHash}:`,
    ];
    const children = prefixes.flatMap((prefix) =>
      draftKeys(prefix).map(
        (key) => [key, readDraft(key)] as [string, unknown],
      ),
    );
    setUndo({
      value: draft.draft,
      selected: [...selected],
      children,
      label: "撤销放弃",
    });
    const errors = children
      .map(([key]) => replaceStoredDraft(key, null))
      .filter(Boolean);
    const savedTree = adapter.tree(original.document);
    const restored: AuthoringDraft = {
      document: structuredClone(original.document),
      organization: structuredClone(original.organization || emptyOrganization),
      labels: structuredClone(original.labels || {}),
      selection: original.lastSelection || savedTree[0]?.id || "",
    };
    draft.setDraft(restored);
    draft.clearDraft(false, restored);
    setSelected(
      new Set(
        (original.review?.definitionIds || []).flatMap((definitionId) => {
          const node = flatten(savedTree).find(
            (item) =>
              item.definitionId === definitionId || item.id === definitionId,
          );
          return node ? [node.id] : [];
        }),
      ),
    );
    setFieldFocus(undefined);
    setAction(undefined);
    setError(errors[0] || "");
    setSavedStatus("");
    setStatus("已恢复已保存版本。");
  }
  function undoDiscard() {
    setValidation(undefined);
    if (!undo) return;
    const errors = (undo.children || [])
      .map(([key, value]) => replaceStoredDraft(key, value))
      .filter(Boolean);
    draft.setDraft(undo.value);
    setSelected(new Set(undo.selected));
    setFieldFocus(undo.value.lastField);
    setUndo(undefined);
    setError(errors[0] || "");
    setStatus("");
  }
  async function persist(confirm = false) {
    setSaving(true);
    setError("");
    setValidation(undefined);
    try {
      const document = await completeAuthoringConstants(adapter, doc);
      await adapter.validate(document);
      const documentHash = await sha256(serialize(document));
      const validIds = new Set(
        flatten(base)
          .filter((n) => n.selectable)
          .map((n) => n.id),
      );
      const next: EditorData = {
        ...original,
        descriptionHash: adapter.hash,
        document,
        documentHash,
        lastSelection: current.id,
        labels: draft.draft.labels || {},
        organization,
        review: confirm
          ? {
              documentHash,
              definitionIds: [...selected]
                .filter((id) => validIds.has(id))
                .map(
                  (id) =>
                    flatten(base).find((n) => n.id === id)!.definitionId || id,
                ),
              reviewedAt: new Date().toISOString(),
            }
          : dirty || documentHash !== original.documentHash
            ? undefined
            : original.review,
      };
      if (await save(next)) {
        draft.clearDraft(false);
        setSavedStatus(
          confirm
            ? "已确认用例内容；未启动自动化。"
            : "已保存，文件合同校验通过；运行条件尚未核验。",
        );
        if (!confirm) exitEditing?.();
      } else setError("用例集未能保存，草稿仍保留，请重试。");
    } catch (e) {
      if (e instanceof AuthoringValidationError) {
        setValidation(e);
        locateIssue(e.issue);
      }
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }
  function locateIssue(issue: Pick<AuthoringIssue, "node" | "field">) {
    select(issue.node);
    setLocateSignal((value) => value + 1);
    if (issue.field) setFieldFocus({ node: issue.node, key: issue.field });
  }
  const ancestors = (node: EditNode): EditNode[] => {
    const parent = all.find((n) =>
      n.children?.some((child) => child.id === node.id),
    );
    return parent ? [...ancestors(parent), parent] : [];
  };
  useEffect(() => {
    if (fieldFocus?.node === selection) {
      const editor = heading.current?.closest(".structured-author");
      const pair = fieldFocus.association
        ? linkedPairs.current.get(fieldFocus.association)
        : undefined;
      const container = pair || editor;
      const cell =
        container &&
        [
          ...container.querySelectorAll<HTMLElement>("[data-author-field]"),
        ].find((element) => element.dataset.authorField === fieldFocus.key);
      if (cell) {
        let parent = cell.parentElement;
        while (parent && parent !== editor) {
          if (parent instanceof HTMLDetailsElement) parent.open = true;
          parent = parent.parentElement;
        }
        const field = cell.querySelector<HTMLElement>(
          "input:not(:disabled), select:not(:disabled), textarea:not(:disabled)",
        );
        field?.focus({ preventScroll: true });
        cell.scrollIntoView({ block: "center" });
        return;
      }
    }
    heading.current?.focus({ preventScroll: true });
  }, [selection, fieldFocus]);
  const fields = current?.associations?.length
    ? (current.fields || []).map((field) => ({
        ...field,
        section: "更多步骤参数",
        collapsed: true,
      }))
    : [...(current?.fields || [])];
  if (current?.nameable)
    fields.unshift({
      key: "ui-label",
      label: "显示名称",
      value: draft.draft.labels[current.id] || current.title,
      control: "text",
      help: "仅用于工作台展示，不改变执行标识。",
    });
  const children: EditNode[] = current?.children || [];
  const primaryActions =
    actions?.filter((item) => item.id !== "remove" && !item.secondary) || [];
  return (
    <section
      className={`structured-author automation-focused-editor${validation ? " has-validation" : ""}`}
      aria-label="自动化用例编辑"
      aria-busy={saving}
      inert={saving}
    >
      <div className="focused-editor-navigation">
        <button className="text-button" onClick={exitEditing || back}>
          ← 返回用例浏览
        </button>
        <span>{mount.name}</span>
      </div>
      <div className="canvas-page-heading">
        <h1>{mount.name}</h1>
        <span className="hint">编辑用例 · 保存后用于新测试</span>
      </div>
      <CaseCanvas
        scope={mount.id}
        nodes={base}
        selection={current?.id || ""}
        select={select}
        locateSignal={locateSignal}
        editable
        act={(node, item) => {
          select(node.id);
          if (item.options || item.schema || item.destructive) setAction(item);
          else void command(item.id, undefined, undefined, node.id);
        }}
        reorder={(from, to) => void command("move-after", undefined, to, from)}
        toolbar={<button onClick={() => setPreview(true)}>顺序预览</button>}
      >
        <nav className="focused-editor-path" aria-label="当前编辑位置">
          <ol>
            {current &&
              ancestors(current).map((node) => (
                <li key={node.id}>
                  <button
                    className="text-button"
                    onClick={() => select(node.id)}
                  >
                    {node.title}
                  </button>
                  <span aria-hidden="true">›</span>
                </li>
              ))}
            <li aria-current="page">{current?.title || mount.name}</li>
          </ol>
        </nav>
        <h2 ref={heading} tabIndex={-1}>
          {current?.title || mount.name}
        </h2>
        <div className="toolbar">
          {primaryActions.map((item) => (
            <button
              key={item.id}
              onClick={() =>
                item.options || item.schema
                  ? (setError(""), setAction(item))
                  : command(item.id)
              }
            >
              {item.label}
            </button>
          ))}
          <details className="more-menu">
            <summary aria-label="当前内容更多操作">更多</summary>
            <div>
              {actions
                ?.filter((item) => item.id === "remove" || item.secondary)
                .map((item) => (
                  <button
                    key={item.id}
                    onClick={() =>
                      item.destructive ? setAction(item) : command(item.id)
                    }
                  >
                    {item.label}
                  </button>
                ))}
              {canCreateFolder && (
                <button onClick={addFolder}>新建整理目录</button>
              )}
              {folder && (
                <button onClick={removeFolder}>移除目录（保留内容）</button>
              )}
              <button onClick={() => setPreview(true)}>预览草稿顺序</button>
              <button
                disabled={dirty || saving}
                onClick={async () => {
                  try {
                    await adapter.validate(original.document);
                    download(adapter.exportName, original.document);
                    setStatus("已导出原生用例文件。");
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                导出已保存用例
              </button>
            </div>
          </details>
        </div>
        {current?.note && (
          <p className="hint focused-editor-note">{current.note}</p>
        )}
        <div className="focused-editor-body" key={current?.id}>
          {!!current?.associations?.length && (
            <section className="linked-step-fields" aria-label="设置与预期">
              <h2>设置与预期</h2>
              <p className="hint">
                两边独立修改，分别写回原步骤。修改设置值不会自动修改预期。
              </p>
              {current.associations.map((association) => (
                <details
                  className="linked-step-pair"
                  key={association.id}
                  ref={(element) => {
                    if (element)
                      linkedPairs.current.set(association.id, element);
                    else linkedPairs.current.delete(association.id);
                  }}
                  open={current.associations!.length === 1}
                >
                  <summary>
                    <strong>{association.title}</strong>
                    <span>
                      {association.fields
                        .map(
                          ({ field }) =>
                            `${field.label}：${displayValue(field.value) ?? "未填写"}`,
                        )
                        .join(" · ")}
                    </span>
                  </summary>
                  <div
                    className="linked-step-inputs"
                    role="group"
                    aria-label={association.title}
                  >
                    {association.fields.map(({ nodeId, field, source }) => (
                      <div key={nodeId + field.key} data-linked-source={nodeId}>
                        <InlineField
                          field={field}
                          fields={association.fields.map((cell) => cell.field)}
                          change={(value) =>
                            void command("set", field.key, value, nodeId, {
                              key: field.key,
                              association: association.id,
                            })
                          }
                          reset={() =>
                            void command(
                              "reset",
                              field.key,
                              undefined,
                              nodeId,
                              {
                                key: field.key,
                                association: association.id,
                              },
                            )
                          }
                        />
                        <button
                          className="text-button"
                          onClick={() =>
                            select(nodeId, association.id, field.key)
                          }
                        >
                          {source}
                        </button>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </section>
          )}
          {folder && (
            <p className="hint">
              整理目录只用于归类；画布按用例文件中的执行层级和顺序展示。
            </p>
          )}
          {folder && (
            <label className="field">
              目录名称
              <input
                value={folder.title}
                onChange={(event) =>
                  updateDraft((value) => ({
                    ...value,
                    organization: {
                      ...value.organization,
                      folders: value.organization.folders.map((item) =>
                        item.id === folder.id
                          ? { ...item, title: event.target.value }
                          : item,
                      ),
                    },
                  }))
                }
              />
            </label>
          )}
          {!!organization.folders.length && current && canMoveToFolder && (
            <details className="author-location">
              <summary>整理目录（不改变执行顺序）</summary>
              <label className="field">
                整理到目录
                <select
                  value={
                    organization.parents[current.id] || folder?.parent || ""
                  }
                  onChange={(event) =>
                    updateDraft((value) => ({
                      ...value,
                      organization: {
                        ...organization,
                        parents: {
                          ...organization.parents,
                          [current.id]: event.target.value,
                        },
                      },
                    }))
                  }
                >
                  <option value="">默认位置</option>
                  {organization.folders
                    .filter(
                      (item) =>
                        item.id !== current.id &&
                        !flatten(current.children || []).some(
                          (node) => node.id === item.id,
                        ),
                    )
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {ancestors(all.find((node) => node.id === item.id)!)
                          .map((node) => node.title)
                          .concat(item.title)
                          .join(" / ")}
                      </option>
                    ))}
                </select>
              </label>
            </details>
          )}
          {[...new Set(fields.map((field) => field.section || "基本信息"))].map(
            (section) => (
              <details
                className="author-form-section"
                key={section}
                open={
                  !fields.find(
                    (field) => (field.section || "基本信息") === section,
                  )?.collapsed
                }
              >
                <summary>{section}</summary>
                {fields
                  .filter((field) => (field.section || "基本信息") === section)
                  .map((field) => (
                    <InlineField
                      key={field.key}
                      field={field}
                      fields={fields}
                      change={(value) =>
                        command("set", field.key, value, undefined, {
                          key: field.key,
                        })
                      }
                      reset={() =>
                        command("reset", field.key, undefined, undefined, {
                          key: field.key,
                        })
                      }
                    />
                  ))}
              </details>
            ),
          )}
          {!!current?.children?.length && (
            <section
              className="focused-editor-children"
              aria-label="当前内容的下级项"
            >
              {fields.length > 0 && <h2>下级内容</h2>}
              <div className="focused-editor-items">
                {children.map((node) => (
                  <button key={node.id} onClick={() => select(node.id)}>
                    <span>
                      <strong>
                        {node.title}
                        {organization.folders.some(
                          (item) => item.id === node.id,
                        )
                          ? " · 整理目录"
                          : ""}
                      </strong>
                      <small>
                        {node.children?.length
                          ? `${node.children.length} 项下级内容`
                          : node.fields?.length
                            ? `${node.fields.length} 项配置与说明`
                            : "尚无内容"}
                      </small>
                    </span>
                    <span className="focused-editor-item-action">
                      {node.selectable || node.fields?.length ? "编辑" : "进入"}{" "}
                      →
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {!fields.length && !current?.children?.length && !folder && (
            <p className="empty-selection">从上方添加第一项内容。</p>
          )}
        </div>
        <details className="focused-review">
          <summary>用例内容确认记录</summary>
          {current?.selectable && (
            <label className="schema-pick">
              <input
                type="checkbox"
                checked={selected.has(current.id)}
                onChange={() =>
                  setSelected((value) => {
                    const next = new Set(value);
                    next.has(current.id)
                      ? next.delete(current.id)
                      : next.add(current.id);
                    return next;
                  })
                }
              />
              将当前用例纳入内容确认
            </label>
          )}
          <footer className="schema-review">
            <span>{selected.size} 项已选 · 内容确认不代表执行通过</span>
            <button
              disabled={dirty || saving || !selected.size}
              onClick={() => void persist(true)}
            >
              确认已选内容
            </button>
          </footer>
        </details>
      </CaseCanvas>
      <section className="collection-save-bar" aria-label="用例集保存状态">
        <div className="collection-save-description">
          <span className="collection-save-scope">保存范围：{mount.name}</span>
          {(error || draft.storageError || status || savedStatus || dirty) && (
            <p
              role={error || draft.storageError ? "alert" : "status"}
              className={error || draft.storageError ? "error-text" : ""}
            >
              {error ||
                draft.storageError ||
                status ||
                savedStatus ||
                "有未保存修改，保存后用于新测试"}
            </p>
          )}
          {draft.storageDetail && (
            <details>
              <summary>错误详情</summary>
              <small>{draft.storageDetail}</small>
            </details>
          )}
          {validation && (
            <div className="author-validation-actions">
              <button
                className="text-button"
                onClick={() => locateIssue(validation.issue)}
              >
                定位出错步骤
              </button>
              {validation.issue.related?.map((related) => (
                <button
                  key={related.node}
                  className="text-button"
                  onClick={() =>
                    locateIssue({ node: related.node, field: "parameters" })
                  }
                >
                  查看 {related.label}
                </button>
              ))}
              <details>
                <summary>详细原因</summary>
                <p>{validation.detail}</p>
              </details>
            </div>
          )}
        </div>
        {undo && (
          <button className="text-button" onClick={undoDiscard}>
            {undo.label}
          </button>
        )}
        {dirty && (
          <button
            className="text-button"
            disabled={saving}
            onClick={discardDraft}
          >
            放弃草稿
          </button>
        )}
        <button
          className="primary"
          disabled={saving || !dirty}
          onClick={() => void persist()}
        >
          {saving ? "保存中…" : "保存并返回"}
        </button>
      </section>
      {preview && (
        <SequenceDialog
          units={
            previewContent
              ? previewContent(doc, draft.draft.labels).groups.flatMap(
                  (group) => group.units,
                )
              : structuredPreview(tree, mount.content.id, mount.name)
                  .groups.flatMap((group) => group.units)
                  .filter((unit) => unit.id === root?.id)
          }
          close={() => setPreview(false)}
        />
      )}
      {action && (
        <ActionDialog
          action={action}
          error={error}
          draftKey={`author-action:${mount.id}:${original.documentHash}:${current?.id}:${action.id}`}
          close={() => setAction(undefined)}
          submit={(value) => command(action.id, undefined, value)}
        />
      )}
    </section>
  );
}
export function InlineField({
  field: f,
  fields,
  change,
  reset,
}: {
  field: EditField;
  fields: EditField[];
  change: (v: unknown) => void;
  reset: () => void;
}) {
  const suggestionsId = useId();
  const reason =
    f.disabled ||
    (f.condition &&
    fields.find((x) => x.key === f.condition!.field)?.value !==
      f.condition.equals
      ? f.condition.message
      : undefined);
  const ref =
    f.value && typeof f.value === "object" && !Array.isArray(f.value)
      ? (f.value as Record<string, unknown>)
      : {};
  if (f.control === "schema" && f.schema)
    return (
      <div className="author-schema-field" data-author-field={f.key}>
        <SchemaInput
          schema={f.schema}
          value={f.value}
          label={f.label}
          change={change}
          labels={f.labels}
          references={f.references}
          disabled={!!reason}
        />
        {f.help && <p className="hint">{f.help}</p>}
      </div>
    );
  return (
    <div className="author-config-row" data-author-field={f.key}>
      <label>
        <span>{f.label}</span>
        {f.control === "readonly" ? (
          <output>{displayValue(f.value) ?? "未指定目标"}</output>
        ) : f.control === "toggle" ? (
          <select
            aria-label={f.label}
            disabled={!!reason}
            value={f.value === undefined ? "" : JSON.stringify(f.value)}
            onChange={(e) => {
              if (e.target.value !== "") change(JSON.parse(e.target.value));
            }}
          >
            <option value="" disabled>
              未指定目标
            </option>
            <option value="true">开启</option>
            <option value="false">关闭</option>
          </select>
        ) : f.control === "select" ? (
          <select
            aria-label={f.label}
            disabled={!!reason}
            value={JSON.stringify(f.value) ?? ""}
            onChange={(e) => change(JSON.parse(e.target.value))}
          >
            {!f.options?.some((o) => o.value === f.value) && (
              <option value={JSON.stringify(f.value) ?? ""} disabled>
                {f.value === undefined ? "未指定目标" : String(f.value)}
              </option>
            )}
            {f.options?.map((o) => (
              <option
                key={JSON.stringify(o.value)}
                value={JSON.stringify(o.value)}
                disabled={o.disabled}
              >
                {o.label}
              </option>
            ))}
          </select>
        ) : f.control === "textarea" || f.control === "lines" ? (
          <textarea
            rows={3}
            disabled={!!reason}
            value={
              f.control === "lines"
                ? Array.isArray(f.value)
                  ? f.value.join("\n")
                  : ""
                : String(f.value ?? "")
            }
            onChange={(e) =>
              change(
                f.control === "lines"
                  ? e.target.value.split("\n")
                  : e.target.value,
              )
            }
          />
        ) : f.control === "reference" ? (
          <input
            disabled={!!reason}
            aria-label={f.label}
            placeholder={ref.$scene ? "场景角色" : "本机材料引用名称"}
            value={String(ref.$material ?? ref.$scene ?? "")}
            onChange={(e) =>
              change(
                ref.$scene
                  ? { $scene: e.target.value }
                  : { $material: e.target.value },
              )
            }
          />
        ) : (
          <input
            type={f.control === "number" ? "number" : "text"}
            list={f.options?.length ? suggestionsId : undefined}
            disabled={!!reason}
            value={String(f.value ?? "")}
            placeholder="未指定目标"
            onChange={(e) =>
              change(
                f.control === "number"
                  ? e.target.value === ""
                    ? ""
                    : Number(e.target.value)
                  : e.target.value,
              )
            }
          />
        )}
        {f.control === "text" && !!f.options?.length && (
          <datalist id={suggestionsId}>
            {f.options.map((option) => (
              <option key={String(option.value)} value={String(option.value)}>
                {option.label}
              </option>
            ))}
          </datalist>
        )}
      </label>
      <div className="author-field-note">
        {reason || f.origin}
        {f.reset && (
          <button className="text-button" disabled={!!reason} onClick={reset}>
            恢复继承
          </button>
        )}
      </div>
      {f.help && <p className="hint">{f.help}</p>}
    </div>
  );
}
function ActionDialog({
  action,
  error,
  draftKey,
  close,
  submit,
}: {
  action: EditAction;
  error: string;
  draftKey: string;
  close: () => void;
  submit: (v?: unknown) => Promise<boolean>;
}) {
  const pending = useDraft(
    draftKey,
    action.initial ?? action.options?.find((o) => !o.disabled)?.value,
    z.unknown(),
  );
  const value = pending.draft,
    setValue = (value: unknown) => pending.setDraft(value);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={action.label.replace("＋ ", "")} onClose={close}>
      {action.help && <p>{action.help}</p>}
      {(error || pending.storageError) && (
        <p role="alert">{error || pending.storageError}</p>
      )}
      {action.schema && (
        <SchemaInput
          schema={action.schema}
          value={value}
          change={setValue}
          label="检查输入"
          labels={action.labels}
          references={action.references}
        />
      )}
      {action.destructive && (
        <p>移除后先保留为草稿，保存后影响新测试。历史记录不变。</p>
      )}
      {action.options && (
        <label className="field">
          选择
          <select
            value={String(value ?? "")}
            onChange={(e) =>
              setValue(
                action.options!.find((o) => String(o.value) === e.target.value)
                  ?.value,
              )
            }
          >
            {value === undefined && (
              <option value="">支持的项目均已添加</option>
            )}
            {action.options.map((o) => (
              <option
                key={String(o.value)}
                value={String(o.value)}
                disabled={o.disabled}
              >
                {o.label}
                {o.disabled ? " · 已添加" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <footer className="dialog-actions">
        <button onClick={close}>取消</button>
        <button
          className="primary"
          disabled={busy || (!!action.options && value === undefined)}
          onClick={async () => {
            setBusy(true);
            try {
              if (await submit(value)) pending.clearDraft(false);
            } finally {
              setBusy(false);
            }
          }}
        >
          {action.destructive ? "移除" : "添加"}
        </button>
      </footer>
    </Dialog>
  );
}
