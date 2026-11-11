/**
 * What the Writer keeps in this browser (IndexedDB), and nowhere else: the story being written, as
 * typed, a moment after each change, so a closed tab or a crash loses nothing; and the files opened
 * lately, to open again where the browser lets a page keep a file (Chrome and Edge).
 */

export type Draft = {
  name: string;
  /** The story as typed, with the line breaks it is saved with. */
  text: string;
  /** The story as last opened or saved: the draft has changes to save while it differs. */
  saved: string;
  /** The file it is saved to, where the browser lets the page keep one. */
  handle?: FileSystemFileHandle;
  /** When the text last changed, and when it was last saved or opened. */
  changedAt: number;
  savedAt?: number;
  /** When the file was last changed on disk, as the Writer last read or wrote it. */
  modified?: number;
  /** Where the writer was: the cursor, and the line at the top of the page. */
  place?: { cursor: number; top: number };
};

export type Recent = { name: string; handle: FileSystemFileHandle; openedAt: number };

const DATABASE = "voxdown-writer";
const DRAFTS = "drafts";
const RECENT = "recent";
const CURRENT = "current";
/** How many files Open recent lists. */
const KEEP = 8;

let opened: Promise<IDBDatabase> | undefined;

function database(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(DRAFTS);
      request.result.createObjectStore(RECENT, { autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opened;
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function store(name: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return (await database()).transaction(name, mode).objectStore(name);
}

/** The draft from the last visit, if any. Undefined too where the browser keeps nothing. */
export async function loadDraft(): Promise<Draft | undefined> {
  try {
    return (await done((await store(DRAFTS, "readonly")).get(CURRENT))) as Draft | undefined;
  } catch {
    return undefined;
  }
}

/** Keeps the draft. False where the browser refused (a private window, a full disk). */
export async function keepDraft(draft: Draft): Promise<boolean> {
  try {
    await done((await store(DRAFTS, "readwrite")).put(draft, CURRENT));
    return true;
  } catch {
    // A file handle the browser can't store: keep the draft without it.
    if (draft.handle) {
      const { handle: _handle, ...rest } = draft;
      return keepDraft(rest);
    }
    return false;
  }
}

/** The files opened lately, newest first. */
export async function recentFiles(): Promise<Recent[]> {
  try {
    const all = (await done((await store(RECENT, "readonly")).getAll())) as Recent[];
    return all.sort((a, b) => b.openedAt - a.openedAt).slice(0, KEEP);
  } catch {
    return [];
  }
}

/** Every file on the list with its key. */
async function entries(): Promise<Array<{ key: IDBValidKey; value: Recent }>> {
  const recent = await store(RECENT, "readonly");
  const [keys, values] = await Promise.all([done(recent.getAllKeys()), done(recent.getAll())]);
  return (values as Recent[]).flatMap((value, index) => {
    const key = keys[index];
    return key === undefined ? [] : [{ key, value }];
  });
}

/** Keys of the entries for this file. Compared first: a transaction closes while it waits. */
async function sameFile(
  all: Array<{ key: IDBValidKey; value: Recent }>,
  handle: FileSystemFileHandle,
): Promise<IDBValidKey[]> {
  const same: IDBValidKey[] = [];
  for (const { key, value } of all) {
    try {
      if (await value.handle.isSameEntry(handle)) same.push(key);
    } catch {
      // A file that is gone is no longer this one.
    }
  }
  return same;
}

/** Puts a file at the top of Open recent, once. */
export async function rememberFile(name: string, handle: FileSystemFileHandle): Promise<void> {
  try {
    const all = await entries();
    const same = new Set(await sameFile(all, handle));
    const older = all
      .filter(({ key }) => !same.has(key))
      .sort((a, b) => b.value.openedAt - a.value.openedAt)
      .slice(KEEP - 1);
    const writer = await store(RECENT, "readwrite");
    for (const key of [...same, ...older.map(({ key }) => key)]) writer.delete(key);
    await done(writer.add({ name, handle, openedAt: Date.now() } satisfies Recent));
  } catch {
    // Without IndexedDB, or a handle it can't keep: no recent list.
  }
}

/** Takes a file off Open recent, when it can no longer be opened. */
export async function forgetFile(handle: FileSystemFileHandle): Promise<void> {
  try {
    const same = await sameFile(await entries(), handle);
    const writer = await store(RECENT, "readwrite");
    for (const key of same) writer.delete(key);
  } catch {
    // Nothing kept, nothing to forget.
  }
}
