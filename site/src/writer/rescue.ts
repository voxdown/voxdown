/**
 * The words typed since a story's draft was last kept, written down at once as the page goes (in
 * localStorage, which a page can write as it closes, where IndexedDB may be too late), one for each
 * story; and the story each tab has open, so that a reload opens it again (in sessionStorage, which
 * is the tab's own). The Writer reads them back on its next visit.
 */
import type { Draft } from "./store";

const RESCUE = "vxd-writer-rescue";
const TAB = "vxd-writer-tab";

export type Rescued = Pick<Draft, "name" | "text" | "saved" | "changedAt" | "place"> & {
  id?: string;
};

export class Rescue {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">) {}

  /** Writes a story's last words down; too long for the storage, the kept draft will do. */
  write(id: string, words: Rescued): void {
    try {
      this.storage.setItem(`${RESCUE}:${id}`, JSON.stringify({ ...words, id }));
    } catch {
      // Too long for this storage: the draft from a moment ago is what comes back.
    }
  }

  /** A story's last words, or those written down before each story had its own, if its. */
  read(id: string): Rescued | null {
    const own = this.parse(`${RESCUE}:${id}`);
    if (own) return own;
    const before = this.parse(RESCUE);
    return before?.id === id ? before : null;
  }

  /** Lets a story's last words go: its draft has them now. */
  forget(id: string): void {
    try {
      this.storage.removeItem(`${RESCUE}:${id}`);
      if (this.parse(RESCUE)?.id === id) this.storage.removeItem(RESCUE);
    } catch {
      // Nothing kept.
    }
  }

  private parse(key: string): Rescued | null {
    try {
      return JSON.parse(this.storage.getItem(key) ?? "null") as Rescued | null;
    } catch {
      return null;
    }
  }
}

/** The story a tab has open, kept for its reloads; set with `id`. */
export function tabStory(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  id?: string,
): string | undefined {
  try {
    if (id) storage?.setItem(TAB, id);
    return storage?.getItem(TAB) ?? id;
  } catch {
    return id;
  }
}
