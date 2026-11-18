/** Each editing session owns a new draft id. Recovery opens a copy; tabs never overwrite peers. */
export type StudioDraft = { id: string; name: string; source: string; updated: number };
const DB = "voxdown-studio";
let database: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts", { keyPath: "id" });
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        database = undefined;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      database = undefined;
      reject(request.error);
    };
    request.onblocked = () => {
      database = undefined;
      reject(new Error("Close older Studio tabs to enable recovery."));
    };
  });
  return database;
}
export async function keepDraft(draft: StudioDraft): Promise<void> {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction("drafts", "readwrite");
    tx.objectStore("drafts").put(draft);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Recovery write was interrupted."));
  });
}
export async function recentDrafts(): Promise<StudioDraft[]> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction("drafts", "readonly").objectStore("drafts").getAll();
    request.onsuccess = () =>
      resolve((request.result as StudioDraft[]).sort((a, b) => b.updated - a.updated));
    request.onerror = () => reject(request.error);
  });
}
