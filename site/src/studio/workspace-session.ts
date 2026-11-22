/** View state only. Screenplay text remains exclusively in Studio's recovery database. */
export type WorkspacePosition = {
  anchor: number;
  head: number;
  scrollTop: number;
  documentLength: number;
  viewportAnchor?: number;
  viewportOffset?: number;
};
type StoredPosition = WorkspacePosition & { id: string; updated: number };
type PositionStorage = Pick<Storage, "getItem" | "setItem">;
const KEY = "studio-workspace-positions-v1";
const LIMIT = 80;
const MAX_BYTES = 32_000;

function valid(value: unknown): value is StoredPosition {
  if (!value || typeof value !== "object") return false;
  const row = value as StoredPosition;
  return (
    typeof row.id === "string" &&
    row.id.length > 0 &&
    row.id.length <= 200 &&
    Number.isSafeInteger(row.anchor) &&
    row.anchor >= 0 &&
    Number.isSafeInteger(row.head) &&
    row.head >= 0 &&
    Number.isSafeInteger(row.documentLength) &&
    row.documentLength >= 0 &&
    row.anchor <= row.documentLength &&
    row.head <= row.documentLength &&
    Number.isFinite(row.scrollTop) &&
    row.scrollTop >= 0 &&
    row.scrollTop <= 1e9 &&
    (row.viewportAnchor === undefined ||
      (Number.isSafeInteger(row.viewportAnchor) &&
        row.viewportAnchor >= 0 &&
        row.viewportAnchor <= row.documentLength)) &&
    (row.viewportOffset === undefined ||
      (Number.isFinite(row.viewportOffset) && Math.abs(row.viewportOffset) <= 1e9)) &&
    Number.isFinite(row.updated) &&
    row.updated >= 0
  );
}

/** Best effort: denied or full browser storage must never interrupt editing or recovery. */
export function createWorkspaceSession(storage?: PositionStorage) {
  let target = storage;
  if (!target) {
    try {
      target = globalThis.localStorage;
    } catch {
      /* Private browser policies can deny access. */
    }
  }
  const memory = new Map<string, StoredPosition>();
  function read() {
    try {
      const raw = target?.getItem(KEY);
      if (!raw || raw.length > MAX_BYTES) return;
      const rows: unknown = JSON.parse(raw);
      if (!Array.isArray(rows) || rows.length > LIMIT) return;
      for (const row of rows) {
        if (!valid(row)) continue;
        const previous = memory.get(row.id);
        if (!previous || previous.updated < row.updated)
          memory.set(row.id, {
            id: row.id,
            anchor: row.anchor,
            head: row.head,
            scrollTop: row.scrollTop,
            documentLength: row.documentLength,
            updated: row.updated,
            ...(row.viewportAnchor === undefined ? {} : { viewportAnchor: row.viewportAnchor }),
            ...(row.viewportOffset === undefined ? {} : { viewportOffset: row.viewportOffset }),
          });
      }
    } catch {
      /* Invalid view preferences do not affect stored drafts. */
    }
  }
  function trim() {
    const rows = [...memory.values()].sort((a, b) => b.updated - a.updated).slice(0, LIMIT);
    memory.clear();
    for (const row of rows) memory.set(row.id, row);
    return rows;
  }
  return {
    save(id: string, position: WorkspacePosition): boolean {
      const row = {
        id,
        anchor: position.anchor,
        head: position.head,
        scrollTop: position.scrollTop,
        documentLength: position.documentLength,
        updated: Date.now(),
        ...(position.viewportAnchor === undefined
          ? {}
          : { viewportAnchor: position.viewportAnchor }),
        ...(position.viewportOffset === undefined
          ? {}
          : { viewportOffset: position.viewportOffset }),
      };
      if (!valid(row)) return false;
      read();
      memory.set(id, row);
      // Equal millisecond timestamps still keep the active draft ahead of older entries.
      const rows = [row, ...trim().filter((entry) => entry.id !== id)].slice(0, LIMIT);
      memory.clear();
      for (const entry of rows) memory.set(entry.id, entry);
      try {
        target?.setItem(KEY, JSON.stringify(rows));
        return Boolean(target);
      } catch {
        return false;
      }
    },
    restore(id: string, documentLength: number): WorkspacePosition | undefined {
      if (!Number.isSafeInteger(documentLength) || documentLength < 0) return undefined;
      read();
      trim();
      const row = memory.get(id);
      if (!row) return undefined;
      return {
        anchor: Math.min(row.anchor, documentLength),
        head: Math.min(row.head, documentLength),
        // A changed source length invalidates its old pixel offset, but the caret remains useful.
        scrollTop: row.documentLength === documentLength ? row.scrollTop : 0,
        documentLength,
        ...(row.documentLength === documentLength &&
        row.viewportAnchor !== undefined &&
        row.viewportOffset !== undefined
          ? { viewportAnchor: row.viewportAnchor, viewportOffset: row.viewportOffset }
          : {}),
      };
    },
  };
}
