import { useId } from "react";
import type { Run } from "../../shared/model";
import { Dialog } from "../components/Dialog";
import { DraftNotice, useDraft } from "../components/useDraft";
import { itemDraft } from "./draftSchemas";
import { ManualCheckFields } from "./ManualCheckFields";

export function ItemEditDialog({
  run,
  itemId,
  update,
  close,
}: {
  run: Run;
  itemId: string;
  update: (run: Run) => Promise<boolean>;
  close: () => void;
}) {
  const formId = useId();
  const item = run.items.find((item) => item.id === itemId)!;
  const draft = useDraft(
    "edit-item:" + run.id + ":" + itemId,
    { title: item.title, action: item.action, expected: item.expected },
    itemDraft,
  );
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = { ...draft.draft, title: draft.draft.title.trim() };
    if (!value.title) return;
    const changed =
      value.title !== item.title ||
      value.action !== item.action ||
      value.expected !== item.expected;
    if (!changed) {
      draft.clearDraft();
      close();
      return;
    }
    const edited = {
      ...item,
      ...value,
      definitionHistory: [
        ...(item.definitionHistory ?? []),
        {
          at: new Date().toISOString(),
          title: item.title,
          action: item.action,
          expected: item.expected,
        },
      ],
    };
    if (
      await update({
        ...run,
        items: run.items.map((i) => (i.id === itemId ? edited : i)),
      })
    ) {
      draft.clearDraft();
      close();
    }
  }
  return (
    <Dialog
      title="编辑本轮检查项"
      onClose={close}
      footer={
        <>
          <button type="button" onClick={close}>
            关闭
          </button>
          <button className="primary" type="submit" form={formId}>
            保存检查项
          </button>
        </>
      }
    >
      {(draft.hasDraft || draft.storageError) && (
        <DraftNotice
          {...draft}
          discard={() => {
            draft.clearDraft();
            close();
          }}
        />
      )}
      <p className="hint">仅修改本轮检查内容，保留已有反馈。</p>
      <form id={formId} onSubmit={submit}>
        <ManualCheckFields
          maxTitleLength={2000}
          value={draft.draft}
          change={(field, value) =>
            draft.setDraft((d) => ({ ...d, [field]: value }))
          }
        />
        {!!item.definitionHistory?.length && (
          <details>
            <summary>此前的检查内容 {item.definitionHistory.length} 版</summary>
            {item.definitionHistory.map((old, index) => (
              <div className="case-step" key={index}>
                <small>{new Date(old.at).toLocaleString()}</small>
                <p>{old.title}</p>
                <p>操作：{old.action || "未填写"}</p>
                <p>预期：{old.expected || "未填写"}</p>
              </div>
            ))}
          </details>
        )}
      </form>
    </Dialog>
  );
}
