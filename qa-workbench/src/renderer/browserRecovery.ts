const databaseName = "qa-workbench-browser-recovery";
const storeName = "snapshots";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error("恢复前副本存储被其他窗口占用，请关闭旧窗口后重试。"));
    };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
  });
}

export async function saveBrowserRecovery(
  current: string,
  legacy: string | null,
) {
  let database: IDBDatabase | undefined;
  try {
    database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database!.transaction(storeName, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      const store = transaction.objectStore(storeName);
      store.put(current, "before-restore");
      if (legacy !== null) store.put(legacy, "legacy-before-restore");
    });
  } catch {
    throw new Error(
      "未能保存恢复前副本，原记录未替换。请先导出个人备份后重试。",
    );
  } finally {
    database?.close();
  }
}

export async function readBrowserRecovery(): Promise<string | undefined> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).get("before-restore");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}
