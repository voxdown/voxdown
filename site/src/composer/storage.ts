/** Composer's recovery: one draft per editing session (tab), kept in this browser only. */
import type { SourceFile } from "./source";

export type Draft = {
  id: string;
  name: string;
  text: string;
  updated: number;
  /** How the file was written, so a recovered draft saves the same way. */
  source: Omit<SourceFile, "normalized">;
  /** The file it was opened from or saved to (a kept handle), and a hash of those bytes. */
  link?: { fileId: string; name: string; hash: string } | undefined;
};
export type DraftSummary = {
  id: string;
  name: string;
  updated: number;
  characters: number;
  title: string;
};
export type RecentFile = { id: string; name: string; opened: number; handle: FileSystemFileHandle };

const DB = "voxdown-composer";
const VERSION = 1;
let database: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Browser storage did not respond.")), 4000);
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB, VERSION);
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("drafts"))
        db.createObjectStore("drafts", { keyPath: "id" });
      if (!db.objectStoreNames.contains("files")) db.createObjectStore("files", { keyPath: "id" });
    };
    request.onsuccess = () => {
      clearTimeout(timeout);
      resolve(request.result);
    };
    request.onerror = () => {
      clearTimeout(timeout);
      reject(request.error ?? new Error("Browser storage is unavailable."));
    };
  });
  database.catch(() => {
    database = null;
  });
  return database;
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = work(transaction.objectStore(store));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error ?? request.error);
        transaction.onabort = () =>
          reject(transaction.error ?? new Error("Storage write was cancelled."));
      }),
  );
}

function titleOf(text: string): string {
  return /^T:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? "";
}

export const keepDraft = (draft: Draft) =>
  run("drafts", "readwrite", (store) => store.put(draft)).then(() => undefined);
export const getDraft = (id: string) =>
  run<Draft | undefined>("drafts", "readonly", (store) => store.get(id));
export const deleteDraft = (id: string) =>
  run("drafts", "readwrite", (store) => store.delete(id)).then(() => undefined);
/** The id of every draft (only the keys), so all of them can be read one at a time. */
export const draftIds = () =>
  run<IDBValidKey[]>("drafts", "readonly", (store) => store.getAllKeys()).then((keys) =>
    keys.filter((key): key is string => typeof key === "string"),
  );

export async function listDrafts(limit = 20): Promise<DraftSummary[]> {
  const all = await run<Draft[]>("drafts", "readonly", (store) => store.getAll());
  return all
    .filter((draft) => draft && typeof draft.id === "string" && typeof draft.text === "string")
    .sort((a, b) => b.updated - a.updated)
    .slice(0, limit)
    .map((draft) => ({
      id: draft.id,
      name: draft.name,
      updated: draft.updated,
      characters: draft.text.length,
      title: titleOf(draft.text),
    }));
}

export async function rememberFile(name: string, handle: FileSystemFileHandle): Promise<string> {
  const all = await run<RecentFile[]>("files", "readonly", (store) => store.getAll());
  for (const file of all) {
    try {
      if (await file.handle.isSameEntry(handle))
        await run("files", "readwrite", (store) => store.delete(file.id));
    } catch {
      /* A stale handle is simply replaced. */
    }
  }
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await run("files", "readwrite", (store) => store.put({ id, name, opened: Date.now(), handle }));
  const kept = (await run<RecentFile[]>("files", "readonly", (store) => store.getAll())).sort(
    (a, b) => b.opened - a.opened,
  );
  for (const old of kept.slice(8)) await run("files", "readwrite", (store) => store.delete(old.id));
  return id;
}

/** SHA-256 of bytes, to tell later whether a file changed since it was saved. */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function recentFiles(): Promise<RecentFile[]> {
  return (await run<RecentFile[]>("files", "readonly", (store) => store.getAll())).sort(
    (a, b) => b.opened - a.opened,
  );
}
export const forgetFile = (id: string) =>
  run("files", "readwrite", (store) => store.delete(id)).then(() => undefined);

/* This tab's draft identity: survives a reload, never shared with another tab. */
const SESSION_KEY = "voxdown-composer-draft";
export function newDraftId(): string {
  return `${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(2)).join("").slice(0, 10)}`;
}
export function sessionDraftId(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}
export function setSessionDraftId(id: string | null) {
  try {
    if (id) sessionStorage.setItem(SESSION_KEY, id);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* Without session storage a reload starts fresh; drafts remain under Recover. */
  }
}

/**
 * Holds a draft for this tab. A duplicated tab copies session storage; the lock tells the copy
 * that the draft is taken, so it starts its own.
 */
export async function claimDraft(id: string): Promise<boolean> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) return true;
  return new Promise<boolean>((resolve) => {
    void locks
      .request(`voxdown-composer-draft:${id}`, { ifAvailable: true }, (lock) => {
        resolve(Boolean(lock));
        // Hold until the tab closes.
        return lock ? new Promise<void>(() => {}) : undefined;
      })
      .catch(() => resolve(true));
  });
}
