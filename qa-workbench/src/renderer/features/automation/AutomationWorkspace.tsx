import { useEffect, useState, type ReactNode } from "react";
import { z } from "zod";
import type { State, ModuleDescriptor } from "../../../shared/model";
import type { Mount, TestContent } from "../../../shared/content";
import { Dialog } from "../../components/Dialog";
import {
  readDraft,
  useViewState,
  useDraftRevision,
} from "../../components/useDraft";
import { hasHostAccess, chooseFile, download } from "../../browserBridge";
import { CaseCanvas } from "../structured/CaseCanvas";
import {
  StructuredWorkspace,
  organize,
} from "../structured/StructuredWorkspace";
import {
  flatten,
  ensureEditorCompatibility,
  authoringTree,
  type EditNode,
  type EditField,
} from "../structured/authoring";
import { displayValue, type EditorData } from "../structured/contract";
import {
  automationModules,
  automationModule,
  automationContent,
  type AutomationModule,
} from "./modules";
import "./automation.css";
import { ReadParameters } from "../structured/SchemaInput";
import { AutomationCaseManager, sourceLabel } from "./AutomationCaseManager";

type LoadedModule = Awaited<ReturnType<AutomationModule["load"]>>;
type Props = {
  state: State;
  modules: ModuleDescriptor[];
  screen: "entry" | "view" | "edit";
  mountId?: string;
  nodeId?: string;
  resume?: boolean;
  save: (state: State, onError?: (error: unknown) => void) => Promise<boolean>;
  back: () => void;
  view: (id: string, node?: string) => void;
  edit: (id: string, node?: string, resume?: boolean) => void;
  prepare: (mount: Mount, content: TestContent, ids: string[]) => void;
  records: (sourceId?: string) => void;
  continuation?: ReactNode;
};
export function AutomationWorkspace(props: Props) {
  const { state, screen, save, back, view, edit, prepare, records } = props;
  const sources = state.mounts.filter((mount) => !!mount.editor);
  const focus = useViewState(
    "automation-library-focus",
    sources[0]?.id || "",
    z.string(),
  );
  const active = sources.find((mount) => mount.id === props.mountId);
  const [connecting, setConnecting] = useState(false);
  const [managing, setManaging] = useState<string | null>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function mount(
    module: AutomationModule,
    action: "catalog" | "new" | "import" | "copy" | "compose",
    original?: Mount,
  ) {
    setBusy(true);
    setError("");
    try {
      const file = action === "import" ? await chooseFile() : undefined;
      if (action === "import" && !file) return;
      const loaded = await module.load({ sources });
      let editor: EditorData;
      if (file)
        editor = await loaded.importDocument(JSON.parse(await file.text()));
      else if (action === "new") editor = await loaded.empty();
      else if (action === "compose") {
        if (!loaded.newComposition)
          throw new Error("此工具尚未提供组合用例能力。");
        editor = await loaded.newComposition(original);
      } else if (action === "copy") {
        if (!original?.editor || original.editor.moduleId !== module.id)
          throw new Error("所选用例不属于当前工具，请重新选择。");
        editor = {
          ...(await loaded.importDocument(
            structuredClone(original.editor.document),
          )),
          organization: structuredClone(original.editor.organization),
          labels: structuredClone(original.editor.labels),
        };
      } else editor = await loaded.catalog();
      const id = crypto.randomUUID();
      const baseName =
        file?.name.replace(/\.json$/i, "") ||
        ((action === "copy" || action === "compose") && original
          ? original.name + (action === "compose" ? " · 组合链路" : " · 副本")
          : action === "compose"
            ? "我的组合链路"
            : action === "new"
              ? "我的自动化用例"
              : module.name + " · 内置用例");
      let name = baseName;
      for (
        let suffix = 2;
        sources.some((source) => source.name === name);
        suffix++
      )
        name = baseName + " " + suffix;
      const next: Mount = {
        id,
        name,
        editor,
        content: automationContent(loaded, editor, id, name),
        sourceName:
          file?.name ||
          (action === "compose" ? "组合链路" : undefined) ||
          (action === "copy" && original
            ? "复制自：" + original.name
            : action === "new"
              ? "新建用例集"
              : "内置用例"),
      };
      let saveError = "";
      const saved = await save(
        { ...state, mounts: [...state.mounts, next] },
        (error) => {
          saveError = error instanceof Error ? error.message : String(error);
        },
      );
      if (!saved)
        throw new Error(
          `${action === "copy" ? `复制「${original!.name}」` : `保存「${name}」`}未完成。${saveError || "请稍后重试。"} 已有用例和草稿未改动。`,
        );
      if (saved) {
        focus.setDraft(id);
        setConnecting(false);
        setManaging(undefined);
        if (action === "new" || action === "copy" || action === "compose")
          edit(id);
        else if (screen !== "entry") back();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function start(source: Mount) {
    setBusy(true);
    setError("");
    try {
      const module = automationModule(source.editor!.moduleId);
      if (!module) throw new Error("当前未安装此链路的接入模块");
      const loaded = await module.load({
        sources,
        document: source.editor!.document,
      });
      prepare(
        source,
        automationContent(
          loaded,
          source.editor!,
          source.content.id,
          source.name,
        ),
        [],
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const connections = (
    <div className="automation-modules">
      {automationModules.map((module) => (
        <section className="automation-module" key={module.id}>
          <h2>{module.name}</h2>
          <div className="toolbar">
            <button
              className="primary"
              disabled={busy}
              onClick={() => void mount(module, "catalog")}
            >
              添加内置用例
            </button>
            <button
              disabled={busy}
              onClick={() => void mount(module, "import")}
            >
              导入用例文件
            </button>
          </div>
          <details className="connection-options">
            <summary>查看工具说明</summary>
            <p>{module.description}</p>
            <p>内置用例随工作台提供，不会自动同步工具目录中的最新用例。</p>
            <p>添加后可查看、编辑和准备测试；不会自动开始执行。</p>
          </details>
        </section>
      ))}
    </div>
  );
  return (
    <section
      className="chain-workspace automation-workspace"
      data-page={screen === "entry" ? "automation-entry" : "case-" + screen}
    >
      {screen === "entry" ? (
        <>
          <button className="text-button" onClick={back}>
            ← 返回工作台
          </button>
          <div className="page-heading">
            <div>
              <p className="eyebrow">自动化测试</p>
              <h1>选择本次要运行的链路</h1>
              <p>先确认范围和目标，再由独立工具执行。</p>
            </div>
            <div className="toolbar">
              <button
                onClick={() => {
                  setError("");
                  setManaging(null);
                }}
              >
                用例管理
              </button>
              <button onClick={() => setConnecting(true)}>
                接入自动化链路
              </button>
            </div>
          </div>
          <p className="entry-runtime-note">
            {!hasHostAccess
              ? "本机服务未连接，当前只能模拟进度。"
              : "支持真实配置检查、真实构建和模拟进度；开始前确认运行方式与计划。"}
          </p>
          {props.continuation}
          <div className="automation-entry-list">
            {sources.map((source) => (
              <article
                key={source.id}
                className={
                  "automation-entry-row " +
                  (focus.draft === source.id ? "recent-source" : "")
                }
              >
                <div>
                  <p className="eyebrow">
                    {automationModule(source.editor!.moduleId)?.name ||
                      "接入模块不可用"}
                  </p>
                  <h2>{source.name}</h2>
                  <p className="hint">
                    {sourceLabel(source)}
                    {" · "}
                    {hasHostAccess &&
                    props.modules.some(
                      (module) =>
                        module.id === source.editor!.moduleId &&
                        module.capabilities.preview &&
                        module.capabilities.start,
                    )
                      ? "真实执行 / 模拟"
                      : "当前仅模拟"}
                  </p>
                </div>
                <div className="toolbar">
                  <button
                    className="quiet"
                    onClick={() => {
                      focus.setDraft(source.id);
                      view(source.id);
                    }}
                  >
                    查看用例
                  </button>
                  <button className="quiet" onClick={() => records(source.id)}>
                    运行记录
                  </button>
                  <button
                    className="primary"
                    disabled={
                      busy || !automationModule(source.editor!.moduleId)
                    }
                    onClick={() => {
                      focus.setDraft(source.id);
                      void start(source);
                    }}
                  >
                    开始测试
                  </button>
                </div>
              </article>
            ))}
          </div>
          {!sources.length && (
            <div className="empty">
              <h2>还没有接入自动化链路</h2>
              <p>载入工具提供的用例后，可查看、编辑并准备测试。</p>
              <button className="primary" onClick={() => setConnecting(true)}>
                接入第一条链路
              </button>
            </div>
          )}
          <button
            className="text-button entry-records-link"
            onClick={() => records()}
          >
            查看已有执行记录与报告 →
          </button>
        </>
      ) : (
        <>
          {screen !== "edit" && (
            <div className="workspace-nav">
              <button className="text-button" onClick={back}>
                ← 返回自动化入口
              </button>
              <span>用例浏览 · 已保存内容</span>
            </div>
          )}
          {active ? (
            <ConnectedCases
              key={active.id}
              {...props}
              mount={active}
              sources={sources}
              manage={() => {
                setError("");
                setManaging(active.editor!.moduleId);
              }}
            />
          ) : (
            <p role="alert">
              用例来源不存在，请返回自动化入口重新选择。原记录没有改动。
            </p>
          )}
        </>
      )}
      {error && !connecting && managing === undefined && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {connecting && (
        <Dialog
          title="接入自动化链路"
          onClose={() => setConnecting(false)}
          wide
        >
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          {connections}
        </Dialog>
      )}
      {managing !== undefined && (
        <AutomationCaseManager
          modules={automationModules.filter(
            (module) => managing === null || module.id === managing,
          )}
          sources={sources}
          busy={busy}
          error={error}
          close={() => setManaging(undefined)}
          create={(module) => void mount(module, "new")}
          copy={(module, source) => void mount(module, "copy", source)}
          compose={(module, source) => void mount(module, "compose", source)}
          view={(source) => {
            focus.setDraft(source.id);
            setManaging(undefined);
            view(source.id);
          }}
        />
      )}
    </section>
  );
}
function ConnectedCases(
  props: Props & { mount: Mount; sources: Mount[]; manage: () => void },
) {
  useDraftRevision();
  const module = automationModule(props.mount.editor!.moduleId);
  const [loaded, setLoaded] = useState<LoadedModule>(),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setLoaded(undefined);
    setError("");
    if (!module) {
      setError("此用例的接入模块当前不可用，原文件与草稿仍保留。");
      return;
    }
    void module
      .load({ sources: props.sources, document: props.mount.editor!.document })
      .then(async (value) => {
        await ensureEditorCompatibility(value.adapter, props.mount.editor!);
        if (live) setLoaded(value);
      })
      .catch((error) => {
        if (live) setError(String(error));
      });
    return () => {
      live = false;
    };
  }, [
    props.mount.editor!.moduleId,
    props.mount.editor!.descriptionHash,
    props.mount.editor!.documentHash,
  ]);
  if (error || !loaded)
    return (
      <p role={error ? "alert" : "status"}>
        {error || "正在读取用例与编辑规则…"}
      </p>
    );
  return <CaseBrowser {...props} module={module!} loaded={loaded} />;
}
function CaseBrowser({
  mount,
  sources,
  state,
  module,
  loaded,
  screen,
  nodeId,
  resume,
  edit,
  view,
  manage,
  save,
  prepare,
}: Props & {
  mount: Mount;
  sources: Mount[];
  manage: () => void;
  module: AutomationModule;
  loaded: LoadedModule;
}) {
  const editor = mount.editor!;
  const definitionTree = authoringTree(
    loaded.adapter,
    editor.document,
    editor.labels,
  );
  const tree = organize(
    definitionTree,
    editor.organization || { folders: [], parents: {} },
  );
  const all = flatten(tree);
  const focus = useViewState(
    "automation-case-focus:" + mount.id,
    tree[0]?.id || "",
    z.string(),
  );
  const current =
    all.find((node) => node.id === (nodeId || focus.draft)) || tree[0];
  const content = automationContent(
    loaded,
    editor,
    mount.content.id,
    mount.name,
  );
  const units = content.groups.flatMap((group) => group.units);
  const [error, setError] = useState("");
  const pending = readDraft(
    "authoring:" + mount.id + ":" + editor.documentHash,
  ) as { document?: unknown; organization?: unknown; labels?: unknown } | null;
  let legacyDraft = false;
  try {
    legacyDraft =
      JSON.stringify(loaded.adapter.recover(editor, mount.id)) !==
      JSON.stringify(editor.document);
  } catch {
    legacyDraft = true;
  }
  const dirty =
    legacyDraft ||
    (!!pending &&
      (JSON.stringify(pending.document) !== JSON.stringify(editor.document) ||
        JSON.stringify(pending.labels || {}) !==
          JSON.stringify(editor.labels || {}) ||
        JSON.stringify(pending.organization) !==
          JSON.stringify(editor.organization || { folders: [], parents: {} })));
  function ancestors(node: EditNode, nodes = all): EditNode[] {
    const parent = nodes.find((item) =>
      item.children?.some((child) => child.id === node.id),
    );
    return parent ? [...ancestors(parent, nodes), parent] : [];
  }
  function runnableIds(node: EditNode) {
    const ids = new Set(flatten([node]).map((item) => item.id));
    return units.filter((unit) => ids.has(unit.id)).map((unit) => unit.id);
  }
  function select(id: string) {
    focus.setDraft(id);
    view(mount.id, id);
  }
  async function saveEditor(value: EditorData) {
    const nextContent = automationContent(
      loaded,
      value,
      mount.content.id,
      mount.name,
    );
    const saved = await save({
      ...state,
      mounts: state.mounts.map((item) =>
        item.id === mount.id
          ? { ...item, editor: value, content: nextContent }
          : item,
      ),
    });
    if (saved && value.lastSelection) focus.setDraft(value.lastSelection);
    return saved;
  }
  if (screen === "edit")
    return (
      <StructuredWorkspace
        mount={mount}
        sources={sources}
        save={saveEditor}
        back={() => view(mount.id)}
        exitEditing={() => view(mount.id)}
        initialSelection={resume ? undefined : current?.id}
        previewContent={(doc, labels) =>
          automationContent(
            loaded,
            { document: doc, labels },
            mount.content.id,
            mount.name,
          )
        }
      />
    );
  const directIds = current ? runnableIds(current) : [];
  const owningRoute =
    current && !directIds.length
      ? ancestors(current, flatten(definitionTree))
          .reverse()
          .find((node) => node.selectable && runnableIds(node).length)
      : undefined;
  const preparationIds = owningRoute ? runnableIds(owningRoute) : directIds;
  return (
    <section className="automation-canvas-browser">
      <div className="canvas-page-heading">
        <div className="canvas-browser-tools">
          <label className="field">
            <select
              aria-label="用例集"
              value={mount.id}
              onChange={(event) => view(event.target.value)}
            >
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
          </label>
          <button className="text-button" onClick={manage}>
            管理用例
          </button>
        </div>
        <div className="toolbar">
          <button onClick={() => edit(mount.id, current?.id)}>编辑用例</button>
          <button
            className="primary"
            disabled={!preparationIds.length}
            title={
              !preparationIds.length
                ? "请在画布中选择可测试的链路或组合"
                : undefined
            }
            onClick={() => prepare(mount, content, preparationIds)}
          >
            {owningRoute ? "测试所属链路" : "开始测试"}
          </button>
          <details className="more-menu">
            <summary>更多</summary>
            <div>
              <button
                onClick={async () => {
                  try {
                    await loaded.adapter.validate(editor.document);
                    download(loaded.adapter.exportName, editor.document);
                  } catch (error) {
                    setError(String(error));
                  }
                }}
              >
                导出已保存用例
              </button>
            </div>
          </details>
        </div>
      </div>
      {dirty && (
        <p className="case-draft-note" role="status">
          有未保存编辑{" "}
          <button
            className="text-button"
            onClick={() => edit(mount.id, undefined, true)}
          >
            继续编辑草稿
          </button>
        </p>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <CaseCanvas
        scope={mount.id}
        nodes={definitionTree}
        selection={current?.id || ""}
        select={select}
      >
        <p className="eyebrow">已保存内容 · 只读</p>
        <nav className="focused-editor-path" aria-label="当前查看位置">
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
            <li aria-current="location">{current?.title}</li>
          </ol>
        </nav>
        <h2>{current?.title || mount.name}</h2>
        {current?.note && <p className="hint">{current.note}</p>}
        {!!current?.fields?.length && <ReadFields fields={current.fields} />}
        {!!current?.children?.length && (
          <section
            className="focused-editor-children"
            aria-label="下级内容定位"
          >
            <h2>包含内容</h2>
            <div className="focused-editor-items">
              {current.children.map((node) => (
                <button key={node.id} onClick={() => select(node.id)}>
                  {node.title}
                </button>
              ))}
            </div>
          </section>
        )}
        {current && !current.fields?.length && !current.children?.length && (
          <p className="hint">这里还没有用例。点击“编辑用例”添加内容。</p>
        )}
      </CaseCanvas>
    </section>
  );
}

function ReadFields({ fields }: { fields: EditField[] }) {
  fields = fields.filter(
    (field) => !["title", "label", "text:title"].includes(field.key),
  );
  const sections = [
    ...new Set(fields.map((field) => field.section || "用例说明")),
  ];
  const value = (field: EditField) =>
    field.display ??
    field.options?.find((option) => option.value === field.value)?.label ??
    (typeof field.value === "boolean"
      ? field.value
        ? "开启"
        : "关闭"
      : (displayValue(field.value) ?? "未指定"));
  return (
    <div className="automation-read-fields">
      {sections.map((section) => {
        const items = fields.filter(
          (field) => (field.section || "用例说明") === section,
        );
        return (
          <details key={section} open={section === "用例说明"}>
            <summary>
              <strong>{section}</strong>
              <small>{items.length} 项</small>
            </summary>
            <dl>
              {items.map((field) => (
                <div key={field.key}>
                  <dt>{field.label}</dt>
                  <dd>
                    {field.control === "schema" ? (
                      <ReadParameters
                        value={field.value}
                        labels={field.labels}
                      />
                    ) : (
                      value(field)
                    )}
                    {field.origin && <small>{field.origin}</small>}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        );
      })}
    </div>
  );
}
