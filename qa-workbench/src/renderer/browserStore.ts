import { emptyState, validateState, type State } from "../shared/model";
import { mountSchema } from "../shared/content";
import { localStores, localTransaction } from "./localDatabase";

export const legacyBrowserKey = "qa-workbench-browser-v1";
const stateKey = "current";
export type BrowserEnvelope = { state: State; files: Record<string, string> };

function officialBaseline(): State {
  const next = emptyState();
  const raw = localStorage.getItem(legacyBrowserKey);
  if (!raw) return next;
  const previous = JSON.parse(raw) as { state?: { mounts?: unknown[] } };
  next.mounts = (previous.state?.mounts || []).flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const candidate = value as { sourceName?: string; editor?: unknown };
    if (
      !candidate.editor ||
      !["内置用例", "共享合同原生用例"].includes(candidate.sourceName || "")
    )
      return [];
    return [mountSchema.parse(value)];
  });
  return next;
}

export function initializeBrowserStore() {
  return localTransaction<State>(
    [localStores.state],
    "readwrite",
    "读取浏览器记录",
    (transaction, result, fail) => {
      const store = transaction.objectStore(localStores.state);
      const request = store.get(stateKey);
      request.onsuccess = () => {
        try {
          if (request.result !== undefined) {
            result(validateState(request.result));
            return;
          }
          const state = officialBaseline();
          store.add(state, stateKey);
          result(state);
        } catch (error) {
          fail(error);
        }
      };
    },
  );
}

export function readBrowserState() {
  return localTransaction<State>(
    [localStores.state],
    "readonly",
    "读取浏览器记录",
    (transaction, result, fail) => {
      const request = transaction.objectStore(localStores.state).get(stateKey);
      request.onsuccess = () => {
        try {
          result(validateState(request.result));
        } catch (error) {
          fail(error);
        }
      };
    },
  );
}

export function saveBrowserState(
  candidate: State,
  expected: number,
  files?: Record<string, string>,
) {
  const state = validateState(candidate);
  return localTransaction<State>(
    files ? [localStores.state, localStores.attachments] : [localStores.state],
    "readwrite",
    "保存浏览器记录",
    (transaction, result, fail) => {
      const store = transaction.objectStore(localStores.state);
      const request = store.get(stateKey);
      request.onsuccess = () => {
        try {
          const current = validateState(request.result);
          if (current.revision !== expected)
            throw new Error("记录已被其他窗口更新，请刷新后重试。");
          state.revision = expected + 1;
          store.put(state, stateKey);
          if (files) {
            const attachments = transaction.objectStore(
              localStores.attachments,
            );
            attachments.clear();
            for (const [id, data] of Object.entries(files))
              attachments.put(data, id);
          }
          result(state);
        } catch (error) {
          fail(error);
        }
      };
    },
    files ? { state, files } : state,
  );
}

export function readBrowserEnvelope() {
  return localTransaction<BrowserEnvelope>(
    [localStores.state, localStores.attachments],
    "readonly",
    "读取浏览器记录与附件",
    (transaction, result, fail) => {
      const value: BrowserEnvelope = { state: emptyState(), files: {} };
      const state = transaction.objectStore(localStores.state).get(stateKey);
      state.onsuccess = () => {
        try {
          value.state = validateState(state.result);
        } catch (error) {
          fail(error);
        }
      };
      const files = transaction
        .objectStore(localStores.attachments)
        .openCursor();
      files.onsuccess = () => {
        const cursor = files.result;
        if (cursor) {
          value.files[String(cursor.key)] = cursor.value as string;
          cursor.continue();
        }
      };
      result(value);
    },
  );
}

export function saveBrowserAttachment(id: string, data: string) {
  return localTransaction<void>(
    [localStores.attachments],
    "readwrite",
    "保存附件",
    (transaction) => {
      transaction.objectStore(localStores.attachments).put(data, id);
    },
    data,
  );
}

export function readBrowserAttachment(id: string) {
  return localTransaction<string | undefined>(
    [localStores.attachments],
    "readonly",
    "读取附件",
    (transaction, result) => {
      const request = transaction.objectStore(localStores.attachments).get(id);
      request.onsuccess = () => result(request.result as string | undefined);
    },
  );
}
