/**
 * What the Writer keeps in this browser (IndexedDB), and nowhere else:
 *
 * - each story's draft, as typed, a moment after each change, so a closed tab, a crash or another
 *   story opened loses nothing (`documents`, the open one named by `drafts/current`);
 * - earlier versions of each story: as it was opened, when it was saved, and every few minutes
 *   while it is written, fewer the older they are (`versions`);
 * - the files opened lately, to open again where the browser lets a page keep a file (`recent`).
 */

export type Draft = {
  /** The story's own key, for as long as the browser keeps it. */
  id: string;
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

export type Version = {
  key?: number;
  /** The story it is a version of. */
  doc: string;
  at: number;
  text: string;
  /** Why it was kept: "Opened", "Saved", "While writing", "Before tidying" … */
  why: string;
};

export type Recent = { name: string; handle: FileSystemFileHandle; openedAt: number };

const DATABASE = "voxdown-writer";
const DRAFTS = "drafts";
const DOCUMENTS = "documents";
const VERSIONS = "versions";
const RECENT = "recent";
const CURRENT = "current";
/** How many files Open recent lists, how many stories' drafts are kept, versions of each. */
const KEEP = 8;
const KEEP_DRAFTS = 30;
const KEEP_VERSIONS = 120;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Versions kept as a story is written, as against those kept before a change the Writer made. */
const ROUTINE = new Set(["Saved", "While writing"]);

let opened: Promise<IDBDatabase> | undefined;

function database(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const upgrade = request.transaction as IDBTransaction;
      if (event.oldVersion < 1) {
        db.createObjectStore(DRAFTS);
        db.createObjectStore(RECENT, { autoIncrement: true });
      }
      if (event.oldVersion < 2) {
        db.createObjectStore(DOCUMENTS, { keyPath: "id" });
        db.createObjectStore(VERSIONS, { autoIncrement: true, keyPath: "key" }).createIndex(
          "doc",
          "doc",
        );
        // The one draft of before becomes the first story kept.
        const drafts = upgrade.objectStore(DRAFTS);
        const old = drafts.get(CURRENT);
        old.onsuccess = () => {
          const draft = old.result as (Omit<Draft, "id"> & { id?: string }) | undefined;
          if (!draft || typeof draft.text !== "string" || draft.id) return;
          const id = newId();
          upgrade.objectStore(DOCUMENTS).put({ ...draft, id });
          drafts.put({ id }, CURRENT);
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opened;
}

export function newId(): string {
  return (
    crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function store(name: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return (await database()).transaction(name, mode).objectStore(name);
}

/** The story open when the Writer was last used, if any. Undefined too where nothing is kept. */
export async function loadDraft(): Promise<Draft | undefined> {
  try {
    const pointer = (await done((await store(DRAFTS, "readonly")).get(CURRENT))) as
      | { id?: string }
      | undefined;
    if (!pointer?.id) return undefined;
    return (await done((await store(DOCUMENTS, "readonly")).get(pointer.id))) as Draft | undefined;
  } catch {
    return undefined;
  }
}

/** Keeps a story's draft, as the open one. False where the browser refused (a private window). */
export async function keepDraft(draft: Draft): Promise<boolean> {
  try {
    const db = await database();
    const transaction = db.transaction([DOCUMENTS, DRAFTS], "readwrite");
    transaction.objectStore(DOCUMENTS).put(draft);
    transaction.objectStore(DRAFTS).put({ id: draft.id }, CURRENT);
    await finished(transaction);
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

/** A story saved after another was opened: its kept draft learns it, the open story is kept open. */
export async function markSaved(id: string, content: string, modified: number): Promise<void> {
  try {
    const draft = (await done((await store(DOCUMENTS, "readonly")).get(id))) as Draft | undefined;
    if (!draft) return;
    await done(
      (await store(DOCUMENTS, "readwrite")).put({
        ...draft,
        saved: content,
        savedAt: Date.now(),
        modified,
      } satisfies Draft),
    );
  } catch {
    // Nothing kept to tell.
  }
}

/**
 * Every story's draft, the latest change first. Beyond the limit, the oldest are let go, but only
 * those saved to their file: a draft with changes never saved stays until the writer lets it go.
 */
export async function listDrafts(): Promise<Draft[]> {
  try {
    const all = (await done((await store(DOCUMENTS, "readonly")).getAll())) as Draft[];
    all.sort((a, b) => b.changedAt - a.changedAt);
    const unsaved = (draft: Draft) =>
      draft.text.replace(/\r\n?/g, "\n") !== draft.saved.replace(/\r\n?/g, "\n");
    const kept: Draft[] = [];
    for (const draft of all) {
      if (kept.length < KEEP_DRAFTS || unsaved(draft)) kept.push(draft);
      else await forgetDraft(draft.id);
    }
    return kept;
  } catch {
    return [];
  }
}

/** Lets a story's draft and its versions go. */
export async function forgetDraft(id: string): Promise<void> {
  try {
    const keys = await done((await store(VERSIONS, "readonly")).index("doc").getAllKeys(id));
    const db = await database();
    const transaction = db.transaction([DOCUMENTS, VERSIONS], "readwrite");
    transaction.objectStore(DOCUMENTS).delete(id);
    for (const key of keys) transaction.objectStore(VERSIONS).delete(key);
    await finished(transaction);
  } catch {
    // Nothing kept.
  }
}

/** The kept story whose file this is, if any. */
export async function draftForFile(handle: FileSystemFileHandle): Promise<Draft | undefined> {
  for (const draft of await listDrafts()) {
    try {
      if (draft.handle && (await draft.handle.isSameEntry(handle))) return draft;
    } catch {
      // A file that is gone is no longer this one.
    }
  }
  return undefined;
}

/**
 * The versions worth keeping, the latest first: every one from the last hour; for the last day,
 * the latest of each hour, and every one kept before a change the Writer made (opening, going
 * back, tidying, reading the file again); then the latest of each day for a month, and of each
 * week beyond. At most `KEEP_VERSIONS`.
 */
export function thinVersions<V extends Pick<Version, "at" | "why">>(
  versions: readonly V[],
  now: number,
): V[] {
  const seen = new Set<string>();
  const kept: V[] = [];
  for (const version of [...versions].sort((a, b) => b.at - a.at)) {
    const age = now - version.at;
    const bucket =
      age < HOUR
        ? undefined
        : age < DAY
          ? ROUTINE.has(version.why)
            ? `hour ${Math.floor(version.at / HOUR)}`
            : undefined
          : age < 30 * DAY
            ? `day ${Math.floor(version.at / DAY)}`
            : `week ${Math.floor(version.at / (7 * DAY))}`;
    if (bucket !== undefined) {
      if (seen.has(bucket)) continue;
      seen.add(bucket);
    }
    kept.push(version);
    if (kept.length >= KEEP_VERSIONS) break;
  }
  return kept;
}

/** Keeps a version of a story, unless it is the same as the last one kept; fewer older ones. */
export async function keepVersion(version: Version): Promise<void> {
  try {
    const earlier = await versionsOf(version.doc);
    if (earlier[0]?.text === version.text) return;
    const kept = new Set(thinVersions([version, ...earlier], Date.now()));
    const writer = await store(VERSIONS, "readwrite");
    writer.add({ doc: version.doc, at: version.at, text: version.text, why: version.why });
    for (const old of earlier) if (!kept.has(old) && old.key !== undefined) writer.delete(old.key);
  } catch {
    // Without IndexedDB there are no versions; the draft is all there is.
  }
}

/** A story's versions, the latest first. */
export async function versionsOf(doc: string): Promise<Version[]> {
  try {
    const index = (await store(VERSIONS, "readonly")).index("doc");
    const all = (await done(index.getAll(doc))) as Version[];
    return all.sort((a, b) => b.at - a.at);
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

/** The files opened lately, newest first. */
export async function recentFiles(): Promise<Recent[]> {
  try {
    const all = (await done((await store(RECENT, "readonly")).getAll())) as Recent[];
    return all.sort((a, b) => b.openedAt - a.openedAt).slice(0, KEEP);
  } catch {
    return [];
  }
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
