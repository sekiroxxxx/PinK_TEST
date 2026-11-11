import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  memoEntriesSchema,
  memoEntrySchema,
  memoSchema,
  type MemoEntry,
} from "../../shared/memo";
import { Dialog } from "../components/Dialog";
import { useDraft } from "../components/useDraft";

const memoDraftSchema = z.union([
  z
    .string()
    .max(50000)
    .transform((value) => {
      const items = memoSchema.parse(value);
      return { items, selected: items[0]?.id || "" };
    }),
  z.object({
    items: memoEntriesSchema,
    selected: z.string(),
    removed: z
      .object({ item: memoEntrySchema, index: z.number().int().nonnegative() })
      .optional(),
  }),
]);
type MemoDraft = {
  items: MemoEntry[];
  selected: string;
  removed?: { item: MemoEntry; index: number };
};

export function Memo({
  value,
  close,
  save,
}: {
  value: MemoEntry[];
  close: () => void;
  save: (value: MemoEntry[]) => Promise<boolean>;
}) {
  const local = useDraft<MemoDraft>(
    "memo",
    { items: value, selected: value[0]?.id || "" },
    memoDraftSchema,
  );
  const entry =
    local.draft.items.find((item) => item.id === local.draft.selected) ||
    local.draft.items[0];
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(local.draft.items) !== JSON.stringify(value);
  useEffect(() => {
    if (!dirty && !saving && local.hasDraft) local.clearDraft(false);
  }, [dirty, saving, local.hasDraft]);
  useEffect(() => {
    if (saving || error) return;
    if (!dirty) {
      if (closing) close();
      return;
    }
    const timer = setTimeout(
      () => {
        setSaving(true);
        void save(local.draft.items)
          .then((ok) => {
            if (!ok) {
              setError(
                "未能保存备忘录，输入仍已保留。可以重试或关闭后继续编辑。",
              );
              setClosing(false);
            }
          })
          .catch(() => {
            setError(
              "未能保存备忘录，输入仍已保留。可以重试或关闭后继续编辑。",
            );
            setClosing(false);
          })
          .finally(() => setSaving(false));
      },
      closing ? 0 : 350,
    );
    return () => clearTimeout(timer);
  }, [dirty, local.draft.items, value, saving, closing, error, save, close]);
  function requestClose() {
    if (error || (!dirty && !saving)) close();
    else setClosing(true);
  }
  const editor = useRef<HTMLTextAreaElement>(null);
  const focusNew = useRef(false);
  useEffect(() => {
    if (focusNew.current && editor.current) {
      editor.current.focus();
      focusNew.current = false;
    }
  }, [entry?.id]);
  function addEntry() {
    const item = { id: crypto.randomUUID(), text: "" };
    focusNew.current = true;
    local.setDraft((previous) => ({
      ...previous,
      items: [...previous.items, item],
      selected: item.id,
    }));
  }
  function removeEntry() {
    if (!entry) return;
    local.setDraft((previous) => {
      const index = previous.items.findIndex((item) => item.id === entry.id);
      const items = previous.items.filter((item) => item.id !== entry.id);
      return {
        items,
        selected: items[Math.min(index, items.length - 1)]?.id || "",
        removed: { item: entry, index },
      };
    });
  }
  function undoRemoval() {
    local.setDraft((previous) => {
      if (!previous.removed) return previous;
      const items = [...previous.items];
      items.splice(previous.removed.index, 0, previous.removed.item);
      return { items, selected: previous.removed.item.id };
    });
  }
  return (
    <Dialog
      title="备忘录"
      wide
      onClose={requestClose}
      footer={
        <>
          {(error || local.storageError || saving) && (
            <span
              className="memo-save-status"
              role={error || local.storageError ? "alert" : "status"}
            >
              {error || local.storageError || "正在保存…"}
            </span>
          )}
          {(error || local.storageError) && (
            <button
              onClick={() => {
                if (!dirty) local.clearDraft(false);
                setError("");
              }}
            >
              重试保存
            </button>
          )}
          <button onClick={requestClose}>关闭</button>
        </>
      }
    >
      <div className="memo-heading">
        <p className="hint">随手记录，与项目和测试记录独立。</p>
        <button onClick={addEntry}>＋ 新增条目</button>
      </div>
      {local.draft.removed && (
        <div className="memo-undo" role="status">
          已删除一条备忘。
          <button className="text-button" onClick={undoRemoval}>
            撤销移除
          </button>
        </div>
      )}
      <div className="memo-entries">
        <nav aria-label="备忘条目">
          <p className="eyebrow">{local.draft.items.length} 条记录</p>
          {local.draft.items.map((item, index) => (
            <button
              key={item.id}
              className={item.id === entry?.id ? "active" : ""}
              aria-pressed={item.id === entry?.id}
              onClick={() =>
                local.setDraft((previous) => ({
                  ...previous,
                  selected: item.id,
                }))
              }
            >
              <small>{index + 1}</small>
              <span>{item.text.trim().split(/\r?\n/)[0] || "空白条目"}</span>
            </button>
          ))}
        </nav>
        {entry ? (
          <section className="memo-editor">
            <label className="field">
              备忘内容
              <textarea
                ref={editor}
                key={entry.id}
                rows={12}
                maxLength={50000}
                value={entry.text}
                onChange={(event) =>
                  local.setDraft((previous) => ({
                    ...previous,
                    items: previous.items.map((item) =>
                      item.id === entry.id
                        ? { ...item, text: event.target.value }
                        : item,
                    ),
                  }))
                }
                placeholder="随手记下提醒、想法和待办…"
              />
            </label>
            <button className="text-button" onClick={removeEntry}>
              删除本条
            </button>
          </section>
        ) : (
          <div className="empty-selection">
            新增一条备忘，记下接下来要做的事。
          </div>
        )}
      </div>
    </Dialog>
  );
}
