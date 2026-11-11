/**
 * What saving decides, apart from the page: saves one at a time, and whether a file may be
 * written over as it is on disk, written blind, or must be asked about first. The Writer asks the
 * questions and writes; these say when.
 */

/** The same text, whatever its line breaks. */
export const sameText = (a: string, b: string): boolean =>
  a === b || a.replace(/\r\n?/g, "\n") === b.replace(/\r\n?/g, "\n");

/**
 * Saves one at a time: a save started while another is under way waits for it, so two never
 * write the same file at once and the later always lands last; one that fails doesn't stop the
 * next.
 */
export class SaveQueue {
  private last: Promise<unknown> = Promise.resolve();

  run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.last.then(work, work);
    this.last = next.catch(() => undefined);
    return next;
  }
}

/** The file on disk, as far as the page can read it. */
export type OnDisk = { text: string; modified: number } | undefined;

/** What the file on disk says about writing over it. */
export type DiskCheck =
  /** As the Writer last read or wrote it (or changed only in its date): write. */
  | { kind: "write" }
  /** It couldn't be read: writing would be blind. */
  | { kind: "unread" }
  /** Changed elsewhere since: theirs, to ask about. */
  | { kind: "changed"; disk: { text: string; modified: number } };

/**
 * Whether the story's own file may be written over: `known` is the file as the Writer last read
 * or wrote it (its date then, and its text). A file the Writer has never read (a new one from
 * Save as) is written.
 */
export function checkDisk(
  disk: OnDisk,
  known: { modified: number | undefined; saved: string },
): DiskCheck {
  if (known.modified === undefined) return { kind: "write" };
  if (!disk) return { kind: "unread" };
  if (disk.modified === known.modified || sameText(disk.text, known.saved))
    return { kind: "write" };
  return { kind: "changed", disk };
}

/** Why saving by itself waits, if it does: said once for each change on disk. */
export type AutosaveCheck =
  | { kind: "write" }
  | { kind: "wait"; reason: "off" | "not-owner" | "nothing" | "no-file" }
  | { kind: "ask"; reason: "permission" }
  | { kind: "stop"; check: Exclude<DiskCheck, { kind: "write" }> };

/** Whether saving by itself may write now, and if not, why. Never asks; never writes blind. */
export function autosaveCheck(state: {
  on: boolean;
  owner: boolean;
  hasFile: boolean;
  unsaved: boolean;
  mayWriteNow: boolean;
  disk: DiskCheck;
}): AutosaveCheck {
  if (!state.on) return { kind: "wait", reason: "off" };
  if (!state.owner) return { kind: "wait", reason: "not-owner" };
  if (!state.hasFile) return { kind: "wait", reason: "no-file" };
  if (!state.unsaved) return { kind: "wait", reason: "nothing" };
  if (!state.mayWriteNow) return { kind: "ask", reason: "permission" };
  if (state.disk.kind !== "write") return { kind: "stop", check: state.disk };
  return { kind: "write" };
}
