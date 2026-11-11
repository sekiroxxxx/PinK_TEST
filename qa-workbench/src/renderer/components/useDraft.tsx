import {
  useRef,
  useState,
  useContext,
  useSyncExternalStore,
  type SetStateAction,
} from "react";
import { z } from "zod";
import { createPortal } from "react-dom";
import { DialogDraftSlot } from "./Dialog";
import {
  draftFailure,
  draftRevision,
  readStoredDraft,
  storedDraftKeys,
  subscribeDrafts,
  writeStoredDraft,
} from "../draftStore";

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object")
    return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length !== right.length
  )
    return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a).filter((key) => a[key] !== undefined);
  return (
    keys.length ===
      Object.keys(b).filter((key) => b[key] !== undefined).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]))
  );
}
export function useDraftRevision() {
  return useSyncExternalStore(subscribeDrafts, draftRevision);
}
export function draftKeys(prefix: string) {
  return storedDraftKeys(prefix);
}
export function readDraft(key: string): unknown {
  return readStoredDraft(key);
}
export function replaceStoredDraft(key: string, value: unknown) {
  return writeStoredDraft(key, value);
}

// Submitted records, content drafts and view positions have separate lifecycles.
export function useDraft<T>(
  key: string,
  initial: T,
  schema: z.ZodType<T>,
  content: (value: T) => unknown = (value) => value,
  options: { critical?: boolean } = {},
) {
  useDraftRevision();
  const critical = options.critical !== false;
  const baseline = useRef(initial);
  const same = (value: T) =>
    sameValue(content(value), content(baseline.current));
  const [entry, setEntry] = useState(() => {
    try {
      const candidate = readDraft(key);
      if (candidate === null || candidate === undefined)
        return { value: initial, present: false, error: "" };
      const parsed = schema.safeParse(candidate);
      if (parsed.success)
        return {
          value: parsed.data,
          present: true,
          error: "",
        };
      return {
        value: initial,
        present: false,
        error: "旧草稿格式不可读取，未作为正式记录。可主动丢弃后重新填写。",
      };
    } catch {
      return {
        value: initial,
        present: false,
        error: "本机草稿存储暂不可用，当前窗口内仍会保留输入。",
      };
    }
  });
  const current = useRef(entry.value);
  function removeStored() {
    return writeStoredDraft(key, null, critical);
  }
  const setDraft = (next: SetStateAction<T>) => {
    const value =
      typeof next === "function"
        ? (next as (previous: T) => T)(current.current)
        : next;
    current.current = value;
    if (same(value)) {
      const error = removeStored();
      setEntry({ value, present: false, error });
      return;
    }
    const error = writeStoredDraft(key, value, critical);
    setEntry({ value, present: true, error });
  };
  const clearDraft = (reset = true, expected = entry.value) => {
    if (!reset) baseline.current = expected;
    if (!sameValue(content(current.current), content(expected))) {
      setEntry({ value: current.current, present: true, error: "" });
      return;
    }
    const error = removeStored();
    const value = reset ? baseline.current : current.current;
    current.current = value;
    setEntry({ value, present: false, error });
  };
  const failure = draftFailure(key);
  return {
    draft: entry.value,
    setDraft,
    clearDraft,
    hasDraft: entry.present,
    hasChanges: !same(entry.value),
    storageError: critical ? failure?.message || entry.error : "",
    storageDetail: critical ? failure?.detail : undefined,
  };
}

export function useViewState<T>(key: string, initial: T, schema: z.ZodType<T>) {
  return useDraft("view:" + key, initial, schema, (value) => value, {
    critical: false,
  });
}

export function DraftNotice({
  hasDraft,
  hasChanges = hasDraft,
  storageError,
  storageDetail,
  discard,
  savedHint,
  discardLabel = "放弃本次修改",
}: {
  hasDraft: boolean;
  hasChanges?: boolean;
  storageError: string;
  storageDetail?: string;
  discard?: () => void;
  savedHint?: string;
  discardLabel?: string;
}) {
  const slot = useContext(DialogDraftSlot);
  const dirty = hasDraft && hasChanges;
  if (!storageError && !dirty) return null;
  const notice = (
    <div className="draft-notice" role={storageError ? "alert" : "status"}>
      <span>
        {storageError || "有未保存修改"}
        {savedHint && `，${savedHint}`}
      </span>
      {storageDetail && (
        <details>
          <summary>错误详情</summary>
          <small>{storageDetail}</small>
        </details>
      )}
      {discard && (dirty || storageError) && (
        <details className="more-menu">
          <summary aria-label="未保存修改的更多操作">更多</summary>
          <div>
            <button type="button" onClick={discard}>
              {discardLabel}
            </button>
          </div>
        </details>
      )}
    </div>
  );
  return slot ? createPortal(notice, slot) : notice;
}
