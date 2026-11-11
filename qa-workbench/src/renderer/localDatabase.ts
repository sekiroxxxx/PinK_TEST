const databaseName = "qa-workbench-local-v2";
export const localStores = {
  state: "state",
  attachments: "attachments",
  drafts: "drafts",
} as const;
let opening: Promise<IDBDatabase> | undefined;

export class PersistenceError extends Error {
  readonly detail: string;
  constructor(operation: string, cause: unknown, value?: unknown) {
    super(`${operation}未完成，原记录和当前输入仍保留。`, { cause });
    let size = "规模无法计算";
    try {
      const text = JSON.stringify(value);
      if (text !== undefined)
        size = `待写入 UTF-8：${new TextEncoder().encode(text).byteLength} 字节；字符数：${text.length}`;
    } catch {
      /* The serialization failure is reported separately. */
    }
    this.detail = `${operation}；${cause instanceof Error ? cause.name + ": " + cause.message : String(cause)}；${size}`;
    console.error("本机存储诊断", this.detail);
  }
}

export function openLocalDatabase(): Promise<IDBDatabase> {
  if (!opening) {
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      let blocked = false;
      request.onupgradeneeded = () => {
        for (const name of Object.values(localStores))
          request.result.createObjectStore(name);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        blocked = true;
        reject(new Error("存储被旧窗口占用，请关闭旧窗口后重试。"));
      };
      request.onsuccess = () => {
        const database = request.result;
        if (blocked) {
          database.close();
          return;
        }
        database.onversionchange = () => {
          database.close();
          opening = undefined;
        };
        resolve(database);
      };
    }).catch((error) => {
      opening = undefined;
      throw error;
    });
  }
  return opening;
}

export async function localTransaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  operation: string,
  action: (
    transaction: IDBTransaction,
    result: (value: T) => void,
    fail: (error: unknown) => void,
  ) => void,
  payload?: unknown,
): Promise<T> {
  try {
    const database = await openLocalDatabase();
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(stores, mode);
      let value: T, failure: unknown;
      const fail = (error: unknown) => {
        failure = error;
        transaction.abort();
      };
      transaction.oncomplete = () => resolve(value);
      transaction.onabort = () => reject(failure || transaction.error);
      transaction.onerror = () => {
        failure ||= transaction.error;
      };
      try {
        action(
          transaction,
          (next) => {
            value = next;
          },
          fail,
        );
      } catch (error) {
        fail(error);
      }
    });
  } catch (error) {
    if (error instanceof PersistenceError) throw error;
    throw new PersistenceError(operation, error, payload);
  }
}
