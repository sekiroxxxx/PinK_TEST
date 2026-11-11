import { useState } from "react";
import { z } from "zod";
import type { CatalogDocument } from "../../../shared/model";
import { Dialog } from "../../components/Dialog";
import { useDraft, DraftNotice } from "../../components/useDraft";

export function RawCatalogDialog({
  initial,
  draftKey,
  apply,
  close,
}: {
  initial: string;
  draftKey: string;
  apply: (value: CatalogDocument) => Promise<boolean>;
  close: () => void;
}) {
  const draft = useDraft(
    "raw-catalog:" + draftKey,
    initial,
    z.string().max(32 * 1024 * 1024),
  );
  const [error, setError] = useState("");
  return (
    <Dialog title="编辑完整用例原文" onClose={close} wide>
      <DraftNotice
        {...draft}
        discard={() => {
          draft.clearDraft();
          close();
        }}
      />
      <p className="hint">
        保留完整原文及扩展字段。normalize
        只用于展示，不回写展开值。公共界面说明不属于本文件。
      </p>
      <textarea
        className="json-editor"
        rows={20}
        aria-label="用例原始 JSON"
        value={draft.draft}
        spellCheck={false}
        onChange={(e) => draft.setDraft(e.target.value)}
      />
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <footer className="dialog-actions">
        <button
          className="primary"
          onClick={() => {
            try {
              const value = JSON.parse(draft.draft);
              void apply(value).then((ok) => {
                if (ok) {
                  draft.clearDraft();
                  close();
                }
              });
            } catch (error) {
              setError(String(error));
            }
          }}
        >
          共享合同校验并应用
        </button>
      </footer>
    </Dialog>
  );
}
