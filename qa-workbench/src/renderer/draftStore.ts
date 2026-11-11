import {
  localStores,
  localTransaction,
  PersistenceError,
} from "./localDatabase";

type DraftRow = { revision: number; value: unknown };
const values = new Map<string, unknown>();
const versions = new Map<string, number>();
const generations = new Map<string, number>();
const queues = new Map<string, Promise<void>>();
const pending = new Map<string, boolean>();
const failures = new Map<
  string,
  { error: PersistenceError; critical: boolean }
>();
const listeners = new Set<() => void>();
let revision = 0;
let initialization: Promise<void> | undefined;
function changed() {
  revision++;
  listeners.forEach((listener) => listener());
}
export const draftRevision = () => revision;
export function subscribeDrafts(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function initializeDraftStore() {
  initialization ||= localTransaction<void>(
    [localStores.drafts],
    "readonly",
    "读取草稿",
    (transaction) => {
      const request = transaction.objectStore(localStores.drafts).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const row = cursor.value as DraftRow;
        versions.set(String(cursor.key), row.revision);
        if (row.value != null) values.set(String(cursor.key), row.value);
        cursor.continue();
      };
    },
  ).then(() => {
    changed();
  });
  return initialization;
}
export function readStoredDraft(key: string) {
  return values.get(key) ?? null;
}
export function storedDraftKeys(prefix: string) {
  return [...values.keys()].filter((key) => key.startsWith(prefix));
}
export function draftFailure(key: string) {
  return failures.get(key)?.error;
}
export function hasPendingContent() {
  return (
    [...pending.values()].some(Boolean) ||
    [...failures.values()].some((failure) => failure.critical)
  );
}

export function writeStoredDraft(
  key: string,
  value: unknown,
  critical = true,
): string {
  if (
    value == null &&
    !values.has(key) &&
    !versions.has(key) &&
    !queues.has(key)
  )
    return "";
  if (value == null) values.delete(key);
  else values.set(key, value);
  const generation = (generations.get(key) || 0) + 1;
  generations.set(key, generation);
  let snapshot: unknown;
  try {
    snapshot = structuredClone(value ?? null);
  } catch (cause) {
    const error = new PersistenceError("保存草稿", cause, value);
    failures.set(key, { error, critical });
    changed();
    return error.message;
  }
  pending.set(key, critical);
  failures.delete(key);
  const previous = queues.get(key) || Promise.resolve();
  const next = previous
    .then(async () => {
      if (snapshot != null && generations.get(key) !== generation) return;
      const updated = await localTransaction<number>(
        [localStores.drafts],
        "readwrite",
        value == null ? "清除草稿" : "保存草稿",
        (transaction, result, fail) => {
          const store = transaction.objectStore(localStores.drafts);
          const request = store.get(key);
          request.onsuccess = () => {
            const current =
              (request.result as DraftRow | undefined)?.revision || 0;
            if (current !== (versions.get(key) || 0)) {
              fail(
                new Error(
                  "草稿已在其他窗口更新，当前输入仍保留，请刷新后处理。",
                ),
              );
              return;
            }
            try {
              store.put(
                { revision: current + 1, value: snapshot } satisfies DraftRow,
                key,
              );
              result(current + 1);
            } catch (error) {
              fail(error);
            }
          };
        },
        snapshot,
      );
      versions.set(key, updated);
      if (generations.get(key) === generation) {
        pending.delete(key);
        failures.delete(key);
      }
    })
    .catch((cause) => {
      if (generations.get(key) === generation) {
        pending.delete(key);
        failures.set(key, {
          error:
            cause instanceof PersistenceError
              ? cause
              : new PersistenceError("保存草稿", cause, snapshot),
          critical,
        });
      }
    })
    .finally(() => {
      if (queues.get(key) === next) queues.delete(key);
      changed();
    });
  queues.set(key, next);
  changed();
  return "";
}

window.addEventListener("beforeunload", (event) => {
  if (hasPendingContent()) {
    event.preventDefault();
    event.returnValue = "";
  }
});
