import { useDraft, DraftNotice } from "../components/useDraft";
import { routeDraft } from "./draftSchemas";
import type { Route, Step, Run } from "../../shared/model";
import { Dialog } from "../components/Dialog";

export function RouteDialog({
  routes,
  initialItems,
  initialSource,
  initialVersion,
  draftKey,
  start,
  close,
  saveRoute,
  importRoute,
  report,
}: {
  routes: Route[];
  initialItems: Step[];
  initialSource?: Run["source"];
  initialVersion: string;
  draftKey: string;
  start: (
    name: string,
    items: Step[],
    source?: Run["source"],
    version?: string,
  ) => Promise<boolean>;
  close: () => void;
  saveRoute: (route: Route) => Promise<boolean>;
  importRoute: () => Promise<Route | null>;
  report: (message: string) => void;
}) {
  const draft = useDraft(
    "route:" + draftKey,
    {
      name: initialItems.length
        ? initialSource?.name || "用例人工检查"
        : "新功能测试",
      items: initialItems,
      quick: "",
      fromCatalog: initialItems.length > 0,
      source: initialSource,
      version: initialVersion,
    },
    routeDraft,
  );
  const { name, items, quick, fromCatalog, source } = draft.draft;
  const setName = (name: string) => draft.setDraft((d) => ({ ...d, name }));
  const setItems = (items: Step[]) => draft.setDraft((d) => ({ ...d, items }));
  const setQuick = (quick: string) => draft.setDraft((d) => ({ ...d, quick }));
  const setFromCatalog = (fromCatalog: boolean) =>
    draft.setDraft((d) => ({ ...d, fromCatalog }));
  function add() {
    if (!quick.trim()) return;
    setItems([
      ...items,
      {
        id: crypto.randomUUID(),
        title: quick.trim(),
        action: "",
        expected: "",
      },
    ]);
    setQuick("");
  }
  return (
    <Dialog title="准备自己测" onClose={close} wide>
      <DraftNotice
        {...draft}
        discard={() => {
          draft.clearDraft();
          close();
        }}
      />
      <p className="hint">
        加载别人给的链路，也可以边测边补。开始后保存本轮副本，不改动来源。
      </p>
      <div className="toolbar">
        <label className="field grow">
          加载个人链路
          <select
            defaultValue=""
            onChange={(e) => {
              const route = routes.find((r) => r.id === e.target.value);
              if (route) {
                setName(route.name);
                setItems(structuredClone(route.items));
                setFromCatalog(false);
              }
            }}
          >
            <option value="">选择已保存链路</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} · {r.items.length} 项
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => {
            void importRoute().then((route) => {
              if (route) {
                setName(route.name);
                setItems(route.items);
                setFromCatalog(false);
              }
            });
          }}
        >
          导入链路
        </button>
      </div>
      <label className="field">
        本次测试名称
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <form
        className="quick-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          aria-label="新检查项"
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          placeholder="输入一个检查项，回车添加"
        />
        <button type="submit">＋ 添加</button>
      </form>
      <div className="route-editor">
        {items.map((item, index) => (
          <details key={item.id}>
            <summary>
              <span className="item-number">{index + 1}</span>
              {item.title}
            </summary>
            <div className="inset">
              <label className="field">
                名称
                <input
                  value={item.title}
                  onChange={(e) =>
                    setItems(
                      items.map((i) =>
                        i.id === item.id ? { ...i, title: e.target.value } : i,
                      ),
                    )
                  }
                />
              </label>
              <label className="field">
                操作
                <textarea
                  value={item.action}
                  onChange={(e) =>
                    setItems(
                      items.map((i) =>
                        i.id === item.id ? { ...i, action: e.target.value } : i,
                      ),
                    )
                  }
                />
              </label>
              <label className="field">
                预期
                <textarea
                  value={item.expected}
                  onChange={(e) =>
                    setItems(
                      items.map((i) =>
                        i.id === item.id
                          ? { ...i, expected: e.target.value }
                          : i,
                      ),
                    )
                  }
                />
              </label>
              <button
                onClick={() => setItems(items.filter((i) => i.id !== item.id))}
              >
                移除此项
              </button>
            </div>
          </details>
        ))}
      </div>
      {!items.length && (
        <p className="hint">也可以直接开始探索，过程中补检查项。</p>
      )}
      <label className="field">
        本次测试版本
        <input
          value={draft.draft.version ?? initialVersion}
          maxLength={50000}
          onChange={(event) =>
            draft.setDraft((previous) => ({
              ...previous,
              version: event.target.value,
            }))
          }
          placeholder="例如 0.0.2.1"
        />
      </label>
      <footer className="dialog-actions">
        <button
          disabled={
            !items.length || !name.trim() || items.some((i) => !i.title.trim())
          }
          onClick={() => {
            const route = { id: crypto.randomUUID(), name: name.trim(), items };
            void saveRoute(route).then((saved) => {
              if (saved) {
                draft.clearDraft(false);
                report("已保存为个人链路");
              }
            });
          }}
        >
          保存链路
        </button>
        <button
          disabled={
            !items.length || !name.trim() || items.some((i) => !i.title.trim())
          }
          onClick={() => {
            void window.qa
              .exportRoute({ id: crypto.randomUUID(), name, items })
              .then((path) => {
                if (path) report("链路已导出，仅包含检查项定义");
              })
              .catch((error) => report(String(error)));
          }}
        >
          导出链路
        </button>
        <button
          className="primary"
          disabled={!name.trim() || items.some((i) => !i.title.trim())}
          onClick={() => {
            void start(
              name.trim(),
              items,
              fromCatalog ? source : undefined,
              draft.draft.version ?? initialVersion,
            ).then((ok) => {
              if (ok) draft.clearDraft();
            });
          }}
        >
          开始自己测
        </button>
      </footer>
    </Dialog>
  );
}
