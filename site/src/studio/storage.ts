/** Studio-only recovery. Draft ids belong to editing sessions; snapshots are immutable copies. */
export type StudioDraft = { id: string; name: string; source: string; updated: number };
export type StudioDraftMetadata = Omit<StudioDraft, "source"> & { characters: number };
export type StudioSnapshot = {
  id: string;
  name: string;
  source: string;
  created: number;
  draftId?: string;
};
export type StudioSnapshotMetadata = Omit<StudioSnapshot, "source"> & { characters: number };
export type DraftCursor = { updated: number; id: string };
export type SnapshotCursor = { created: number; id: string };
export type RecoveryPage<T, C> = { items: T[]; next?: C };
const DB = "voxdown-studio";
const VERSION = 2;
const DEFAULT_LIMIT = 50;
let database: Promise<IDBDatabase> | undefined;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function identity(value: unknown): value is Record<string, unknown> & { id: string; name: string } {
  return (
    record(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.name === "string"
  );
}
function timestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 8.64e15;
}
function validDraft(value: unknown): value is StudioDraft {
  return identity(value) && typeof value.source === "string" && timestamp(value.updated);
}
function validSnapshot(value: unknown): value is StudioSnapshot {
  return (
    identity(value) &&
    typeof value.source === "string" &&
    timestamp(value.created) &&
    (value.draftId === undefined || typeof value.draftId === "string")
  );
}
function validMetadata(value: unknown): value is StudioDraftMetadata | StudioSnapshotMetadata {
  return (
    identity(value) && Number.isSafeInteger(value.characters) && (value.characters as number) >= 0
  );
}
function validDraftMetadata(value: unknown): value is StudioDraftMetadata {
  return validMetadata(value) && "updated" in value && timestamp(value.updated);
}
function validSnapshotMetadata(value: unknown): value is StudioSnapshotMetadata {
  return (
    validMetadata(value) &&
    "created" in value &&
    timestamp(value.created) &&
    (!("draftId" in value) || value.draftId === undefined || typeof value.draftId === "string")
  );
}
function invalidRecord(kind: string): Error {
  return new Error(
    `This saved ${kind} contains invalid recovery data and cannot be opened. Its original record has been preserved; other saved work is still available.`,
  );
}

function db(): Promise<IDBDatabase> {
  if (database) return database;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(DB, VERSION);
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };
    const timeout = setTimeout(
      () => fail(new Error("Browser recovery did not respond. Try reopening Studio.")),
      5000,
    );
    request.onupgradeneeded = () => {
      if (settled) {
        request.transaction?.abort();
        return;
      }
      const connection = request.result;
      const upgrade = request.transaction;
      if (!upgrade) return;
      const drafts = connection.objectStoreNames.contains("drafts")
        ? upgrade.objectStore("drafts")
        : connection.createObjectStore("drafts", { keyPath: "id" });
      const metadata = connection.createObjectStore("draft-metadata", { keyPath: "id" });
      metadata.createIndex("updated", ["updated", "id"]);
      connection.createObjectStore("snapshots", { keyPath: "id" });
      connection
        .createObjectStore("snapshot-metadata", { keyPath: "id" })
        .createIndex("created", ["created", "id"]);
      // One-time v1 migration. Subsequent listings never scan or hydrate source documents.
      const cursor = drafts.openCursor();
      cursor.onsuccess = () => {
        if (!cursor.result) return;
        const draft: unknown = cursor.result.value;
        // A damaged record must not prevent recovery of unrelated valid drafts.
        // Leave the raw record untouched, but keep it out of the usable metadata index.
        if (validDraft(draft)) {
          const { id, name, source, updated } = draft;
          metadata.put({ id, name, updated, characters: source.length });
        }
        cursor.result.continue();
      };
    };
    request.onsuccess = () => {
      const connection = request.result;
      if (settled) {
        connection.close();
        return;
      }
      settled = true;
      clearTimeout(timeout);
      const invalidate = () => {
        connection.close();
        if (database === opening) database = undefined;
      };
      connection.onversionchange = invalidate;
      connection.onclose = invalidate;
      resolve(connection);
    };
    request.onerror = () => fail(request.error ?? new Error("Browser recovery could not open."));
    request.onblocked = () => fail(new Error("Close older Studio tabs to enable recovery."));
  });
  database = opening;
  void opening.catch(() => {
    if (database === opening) database = undefined;
  });
  return opening;
}

async function transaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction, result: (value: T) => void) => void,
): Promise<T> {
  const connection = await db();
  return new Promise<T>((resolve, reject) => {
    const tx = connection.transaction(stores, mode);
    let value: T;
    const timeout = setTimeout(() => {
      try {
        tx.abort();
      } catch {}
      reject(
        new Error(
          "Browser recovery did not confirm this operation in time. Download your source before replacing it, then retry recovery.",
        ),
      );
    }, 5000);
    tx.oncomplete = () => {
      clearTimeout(timeout);
      resolve(value);
    };
    tx.onerror = () => {
      clearTimeout(timeout);
      reject(tx.error ?? new Error("Browser recovery failed."));
    };
    tx.onabort = () => {
      clearTimeout(timeout);
      reject(tx.error ?? new Error("Browser recovery was interrupted."));
    };
    try {
      work(tx, (result) => {
        value = result;
      });
    } catch (error) {
      clearTimeout(timeout);
      tx.abort();
      reject(error);
    }
  });
}

export async function keepDraft(draft: StudioDraft): Promise<void> {
  if (!validDraft(draft)) throw invalidRecord("draft");
  const { id, name, source, updated } = draft;
  const details = { id, name, updated };
  await transaction<void>(["drafts", "draft-metadata"], "readwrite", (tx) => {
    tx.objectStore("drafts").put({ ...details, source });
    tx.objectStore("draft-metadata").put({ ...details, characters: source.length });
  });
}

async function get<T>(store: string, id: string): Promise<T | undefined> {
  return transaction<T | undefined>([store], "readonly", (tx, result) => {
    const request = tx.objectStore(store).get(id);
    request.onsuccess = () => result(request.result as T | undefined);
  });
}
export async function getDraft(id: string): Promise<StudioDraft | undefined> {
  const draft = await get<unknown>("drafts", id);
  if (draft === undefined) return undefined;
  if (!validDraft(draft) || draft.id !== id) throw invalidRecord("draft");
  return draft;
}
export async function getSnapshot(id: string): Promise<StudioSnapshot | undefined> {
  const snapshot = await get<unknown>("snapshots", id);
  if (snapshot === undefined) return undefined;
  if (!validSnapshot(snapshot) || snapshot.id !== id) throw invalidRecord("snapshot");
  return snapshot;
}

async function remove(store: string, metadata: string, id: string): Promise<void> {
  await transaction<void>([store, metadata], "readwrite", (tx) => {
    tx.objectStore(store).delete(id);
    tx.objectStore(metadata).delete(id);
  });
}
/** Explicit deletion only: Studio never silently prunes old work. Missing ids are harmless. */
export function deleteDraft(id: string): Promise<void> {
  return remove("drafts", "draft-metadata", id);
}
export function deleteSnapshot(id: string): Promise<void> {
  return remove("snapshots", "snapshot-metadata", id);
}

async function list<T>(
  store: string,
  index: string,
  valid: (value: unknown) => value is T,
  limit = DEFAULT_LIMIT,
  before?: [number, string],
): Promise<{ items: T[]; more: boolean }> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Choose a recovery page size between 1 and 100.");
  return transaction([store], "readonly", (tx, result) => {
    const items: T[] = [];
    const cursor = tx
      .objectStore(store)
      .index(index)
      .openCursor(before ? IDBKeyRange.upperBound(before, true) : undefined, "prev");
    cursor.onsuccess = () => {
      if (!cursor.result || items.length === limit) {
        result({ items, more: Boolean(cursor.result) });
        return;
      }
      if (valid(cursor.result.value)) items.push(cursor.result.value);
      cursor.result.continue();
    };
  });
}

/** Newest first. Equal timestamps use ids as a stable tie-breaker. Pages are live, not frozen. */
export async function listDrafts(
  options: { limit?: number; before?: DraftCursor | undefined } = {},
): Promise<RecoveryPage<StudioDraftMetadata, DraftCursor>> {
  const { items, more } = await list<StudioDraftMetadata>(
    "draft-metadata",
    "updated",
    validDraftMetadata,
    options.limit,
    options.before && [options.before.updated, options.before.id],
  );
  const last = items.at(-1);
  return { items, ...(more && last ? { next: { updated: last.updated, id: last.id } } : {}) };
}
export async function listSnapshots(
  options: { limit?: number; before?: SnapshotCursor | undefined } = {},
): Promise<RecoveryPage<StudioSnapshotMetadata, SnapshotCursor>> {
  const { items, more } = await list<StudioSnapshotMetadata>(
    "snapshot-metadata",
    "created",
    validSnapshotMetadata,
    options.limit,
    options.before && [options.before.created, options.before.id],
  );
  const last = items.at(-1);
  return { items, ...(more && last ? { next: { created: last.created, id: last.id } } : {}) };
}

/** Snapshot ids are always new; no API can overwrite an existing snapshot. */
export async function createSnapshot(
  input: Pick<StudioSnapshot, "name" | "source" | "draftId">,
): Promise<StudioSnapshot> {
  const snapshot: StudioSnapshot = { ...input, id: crypto.randomUUID(), created: Date.now() };
  if (!validSnapshot(snapshot)) throw invalidRecord("snapshot");
  const { source, id, name, created, draftId } = snapshot;
  const details = { id, name, created, ...(draftId === undefined ? {} : { draftId }) };
  await transaction<void>(["snapshots", "snapshot-metadata"], "readwrite", (tx) => {
    tx.objectStore("snapshots").add(snapshot);
    tx.objectStore("snapshot-metadata").add({ ...details, characters: source.length });
  });
  return snapshot;
}

/** Compatibility helper. Hydrates at most the newest 50 drafts; use metadata pages for a UI. */
export async function recentDrafts(): Promise<StudioDraft[]> {
  const { items } = await listDrafts();
  return transaction<StudioDraft[]>(["drafts"], "readonly", (tx, result) => {
    const drafts: StudioDraft[] = [];
    result(drafts);
    for (const item of items) {
      const request = tx.objectStore("drafts").get(item.id);
      request.onsuccess = () => {
        if (validDraft(request.result) && request.result.id === item.id)
          drafts.push(request.result);
      };
    }
  });
}
