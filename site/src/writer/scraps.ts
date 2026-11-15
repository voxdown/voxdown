/**
 * Scraps: passages set aside from a story, to bring back later. Kept in this browser with the
 * story (localStorage, by the story's id), and in a file beside it, `owl.scraps.md`, found by its
 * name as subtitles are beside a film. The file is Markdown any viewer shows as the passages in
 * order: each scrap after an HTML comment that holds what the Writer needs to read it back.
 *
 *     # Scraps for The Owl
 *
 *     <!-- scrap id="k3j2a" at="2026-11-14T13:02:00.000Z" from="One" note="For the ending?" -->
 *     The owl said nothing at all.
 */

export type Scrap = {
  id: string;
  text: string;
  /** A line of the writer's about it. */
  note: string;
  /** When it was set aside, and the chapter or scene it came from. */
  at: number;
  from: string;
  /** When it was last put back into the story, if it was. */
  used?: number;
  /** Cut as whole paragraphs: put back as paragraphs of its own. */
  whole?: boolean;
};

/** Where scraps are kept, or a stand-in for a test. */
export type Keeper = Pick<Storage, "getItem" | "setItem">;

const KEY = "vxd-writer-scraps";
/** Each story's file name, and what its scraps were when last saved beside it. */
const NAMES = "vxd-writer-scraps-names";
const SAVED = "vxd-writer-scraps-saved";
/** Scraps deleted, each story's latest, to bring back after a reload too. */
const DELETED = "vxd-writer-scraps-deleted";
/** How many deleted scraps a story keeps, and for how long. */
const DELETED_KEPT = 50;
const DELETED_DAYS = 30;

function read<T>(keeper: Keeper, key: string): Record<string, T> {
  try {
    return (JSON.parse(keeper.getItem(key) ?? "{}") as Record<string, T>) ?? {};
  } catch {
    return {};
  }
}

function write(keeper: Keeper, key: string, value: unknown): void {
  try {
    keeper.setItem(key, JSON.stringify(value));
  } catch {
    // Short of room: the scraps themselves are what matter.
  }
}

/** What a heap of scraps is, to know whether it changed: their ids, words and notes, in order. */
export function scrapsSignature(scraps: readonly Scrap[]): string {
  let hash = 0;
  for (const char of JSON.stringify(scraps.map((scrap) => [scrap.id, scrap.text, scrap.note])))
    hash = (Math.imul(hash, 31) + (char.codePointAt(0) ?? 0)) | 0;
  return `${scraps.length}:${hash >>> 0}`;
}

/** The story's scraps were just saved beside it, as they are. */
export function markScrapsSaved(keeper: Keeper, story: string, scraps: readonly Scrap[]): void {
  write(keeper, SAVED, { ...read<string>(keeper, SAVED), [story]: scrapsSignature(scraps) });
}

/**
 * Where the story's scraps stand: none; in this browser only, never saved beside the story; or
 * changed since they last were (all of them deleted, too); or saved as they are.
 */
export function scrapsStanding(
  keeper: Keeper,
  story: string,
  scraps: readonly Scrap[],
): "none" | "browser" | "changed" | "saved" {
  const saved = read<string>(keeper, SAVED)[story];
  // None now: none at all, or the ones saved beside the story all deleted since.
  if (!scraps.length) return saved && saved !== scrapsSignature([]) ? "changed" : "none";
  if (!saved) return "browser";
  return saved === scrapsSignature(scraps) ? "saved" : "changed";
}

/**
 * Scraps kept here under another story with the same file name: a file opened again where the
 * browser can't tell it is the same one (Firefox, Safari), or opened afresh. The latest heap.
 */
export function scrapsByName(
  keeper: Keeper,
  name: string,
  except: string,
): { story: string; scraps: Scrap[] } | undefined {
  const names = read<string>(keeper, NAMES);
  const kept = all(keeper);
  let found: { story: string; scraps: Scrap[]; at: number } | undefined;
  for (const [story, named] of Object.entries(names)) {
    if (story === except || named !== name || !kept[story]?.length) continue;
    const scraps = kept[story] as Scrap[];
    const at = Math.max(...scraps.map((scrap) => scrap.used ?? scrap.at));
    if (!found || at > found.at) found = { story, scraps, at };
  }
  return found && { story: found.story, scraps: found.scraps };
}

function all(keeper: Keeper): Record<string, Scrap[]> {
  try {
    return (JSON.parse(keeper.getItem(KEY) ?? "{}") as Record<string, Scrap[]>) ?? {};
  } catch {
    return {};
  }
}

/** A story's scraps, in the writer's order. */
export function scrapsOf(keeper: Keeper, story: string): Scrap[] {
  return all(keeper)[story] ?? [];
}

/** Keeps a story's scraps; whether the browser kept them (it may be short of room). */
export function keepScraps(
  keeper: Keeper,
  story: string,
  scraps: readonly Scrap[],
  /** The story's file name, to find its scraps again by it. */
  name?: string,
): boolean {
  if (name) write(keeper, NAMES, { ...read<string>(keeper, NAMES), [story]: name });
  const kept = all(keeper);
  if (scraps.length) kept[story] = [...scraps];
  else delete kept[story];
  try {
    keeper.setItem(KEY, JSON.stringify(kept));
    return true;
  } catch {
    return false;
  }
}

export function newScrapId(): string {
  return Math.random().toString(36).slice(2, 9);
}

/**
 * Scraps from a file added to the ones kept: those already here stay as they are, the rest join
 * at the end in the file's order. Nothing is lost by starting a new heap before opening an old one.
 */
export function mergeScraps(
  kept: readonly Scrap[],
  found: readonly Scrap[],
): { scraps: Scrap[]; added: number } {
  const ids = new Set(kept.map((scrap) => scrap.id));
  const texts = new Set(kept.map((scrap) => scrap.text.trim()));
  const added = found.filter((scrap) => !ids.has(scrap.id) && !texts.has(scrap.text.trim()));
  return { scraps: [...kept, ...added], added: added.length };
}

/** A scrap deleted, and when. */
export type Deleted = Scrap & { deleted: number };

/** A story's deleted scraps, the latest first, as long as they are kept. */
export function deletedScraps(keeper: Keeper, story: string, now = Date.now()): Deleted[] {
  const since = now - DELETED_DAYS * 86_400_000;
  return (read<Deleted[]>(keeper, DELETED)[story] ?? []).filter((each) => each.deleted >= since);
}

/** A scrap deleted: kept among the story's deleted ones, to bring back; whether it could be. */
export function keepDeleted(
  keeper: Keeper,
  story: string,
  scrap: Scrap,
  now = Date.now(),
): boolean {
  const all = read<Deleted[]>(keeper, DELETED);
  const kept = deletedScraps(keeper, story, now).filter((each) => each.id !== scrap.id);
  all[story] = [{ ...scrap, deleted: now }, ...kept].slice(0, DELETED_KEPT);
  try {
    keeper.setItem(DELETED, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

/** A deleted scrap, as it was set aside (its deletion's date taken off), or undefined. */
export function findDeleted(keeper: Keeper, story: string, id: string): Scrap | undefined {
  const found = (read<Deleted[]>(keeper, DELETED)[story] ?? []).find((each) => each.id === id);
  if (!found) return undefined;
  const { deleted: _, ...scrap } = found;
  return scrap;
}

/** A deleted scrap let go of: back among the scraps, kept there first. */
export function forgetDeleted(keeper: Keeper, story: string, id: string): void {
  const all = read<Deleted[]>(keeper, DELETED);
  all[story] = (all[story] ?? []).filter((each) => each.id !== id);
  write(keeper, DELETED, all);
}

/**
 * The scraps here joined with their file as it is now, changed outside the Writer since it was
 * last written (`written`), losing nothing. A scrap added there joins. A scrap changed on one
 * side only is as that side has it, its words and its note each on their own. Where both sides
 * changed its words, the version there joins as a scrap of its own beside this one, noted as from
 * the file; where both changed only its note, the notes are joined. One deleted here stays
 * deleted; one deleted there stays here. How many came from the file is said.
 */
export function joinScraps(
  here: readonly Scrap[],
  there: readonly Scrap[],
  written: readonly Scrap[],
  newId: () => string = newScrapId,
): { scraps: Scrap[]; fromThere: number } {
  const then = new Map(written.map((scrap) => [scrap.id, scrap]));
  const now = new Map(there.map((scrap) => [scrap.id, scrap]));
  let fromThere = 0;
  const scraps: Scrap[] = [];
  for (const scrap of here) {
    const was = then.get(scrap.id);
    const outside = now.get(scrap.id);
    if (!outside) {
      scraps.push(scrap);
      continue;
    }
    // Not known how it was (the file not written here, or before this browser kept that): where
    // they differ, both kept, the file's beside this one.
    if (!was) {
      if (outside.text === scrap.text) {
        const note =
          outside.note && outside.note !== scrap.note
            ? scrap.note
              ? `${scrap.note} / from the file: ${outside.note}`
              : outside.note
            : scrap.note;
        if (note !== scrap.note) fromThere++;
        scraps.push({ ...scrap, note });
      } else {
        scraps.push(scrap, {
          ...outside,
          id: newId(),
          note: outside.note ? `${outside.note} (from the file)` : "From the file",
        });
        fromThere++;
      }
      continue;
    }
    // Each field: as the side that changed it has it; changed on both sides, a conflict.
    const field = (name: "text" | "note") => {
      const mine = scrap[name] !== was[name];
      const theirs = outside[name] !== was[name];
      if (theirs && !mine) return { value: outside[name], taken: true, clash: false };
      return {
        value: scrap[name],
        taken: false,
        clash: mine && theirs && scrap[name] !== outside[name],
      };
    };
    const text = field("text");
    const note = field("note");
    // Only the note changed on both sides: one scrap, both notes.
    if (note.clash && !text.clash) {
      scraps.push({
        ...scrap,
        text: text.value,
        // Both notes, or the one left where the other side emptied its own.
        note: !outside.note
          ? scrap.note
          : !scrap.note
            ? outside.note
            : `${scrap.note} / from the file: ${outside.note}`,
      });
      fromThere++;
      continue;
    }
    if (text.clash) {
      // Both kept: this one as it is here, the file's beside it.
      scraps.push(scrap, {
        ...outside,
        id: newId(),
        note: outside.note ? `${outside.note} (from the file)` : "From the file",
      });
      fromThere++;
      continue;
    }
    if (text.taken || note.taken) fromThere++;
    scraps.push({ ...scrap, text: text.value, note: note.value });
  }
  const ids = new Set(scraps.map((scrap) => scrap.id));
  const texts = new Set(scraps.map((scrap) => scrap.text.trim()));
  for (const scrap of there)
    if (!ids.has(scrap.id) && !then.has(scrap.id) && !texts.has(scrap.text.trim())) {
      scraps.push(scrap);
      fromThere++;
    }
  return { scraps, fromThere };
}

/** The scraps a search finds: in their words or their notes, whatever the case and the accents. */
export function searchScraps(scraps: readonly Scrap[], words: string): Scrap[] {
  const plain = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const wanted = plain(words).split(/\s+/).filter(Boolean);
  if (!wanted.length) return [...scraps];
  return scraps.filter((scrap) => {
    const text = plain(`${scrap.text} ${scrap.note} ${scrap.from}`);
    return wanted.every((word) => text.includes(word));
  });
}

/** The file beside a story: `owl.vxd` → `owl.scraps.md`. */
export function scrapsFileName(storyName: string): string {
  return `${storyName.replace(/\.(vxd|md|markdown|txt|fountain)$/i, "")}.scraps.md`;
}

const attribute = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, " ")
    .replace(/-->/g, "--&gt;");
const unattribute = (value: string) =>
  value
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

/** A line that starts a scrap in the file. */
const HEAD = /^<!-- scrap((?:\s+[a-z]+="[^"]*")*)\s*-->\s*$/;

/** The scraps as the file beside the story. */
export function scrapsFile(scraps: readonly Scrap[], title: string): string {
  const parts = [`# Scraps for ${title}`, ""];
  for (const scrap of scraps) {
    const fields: Array<[string, string]> = [
      ["id", scrap.id],
      ["at", new Date(scrap.at).toISOString()],
      ...(scrap.from ? [["from", scrap.from] as [string, string]] : []),
      ...(scrap.note ? [["note", scrap.note] as [string, string]] : []),
      ...(scrap.used ? [["used", new Date(scrap.used).toISOString()] as [string, string]] : []),
    ];
    parts.push(
      `<!-- scrap ${fields.map(([name, value]) => `${name}="${attribute(value)}"`).join(" ")} -->`,
      // A line of the scrap's own that would read as the start of another is set apart.
      scrap.text
        .replace(/\s+$/, "")
        .replace(/^(<!-- scrap)/gm, "\\$1"),
      "",
    );
  }
  return `${parts.join("\n").replace(/\n+$/, "")}\n`;
}

/** The scraps in a file beside a story; none if it holds none. */
export function readScrapsFile(text: string): Scrap[] {
  const scraps: Scrap[] = [];
  let current: Scrap | undefined;
  let lines: string[] = [];
  const end = () => {
    if (!current) return;
    const body = lines
      .join("\n")
      .replace(/^\n+|\s+$/g, "")
      .replace(/^\\(<!-- scrap)/gm, "$1");
    if (body) scraps.push({ ...current, text: body });
  };
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const head = HEAD.exec(line);
    if (!head) {
      if (current) lines.push(line);
      continue;
    }
    end();
    const fields = Object.fromEntries(
      [...(head[1] ?? "").matchAll(/([a-z]+)="([^"]*)"/g)].map((found) => [
        found[1],
        unattribute(found[2] ?? ""),
      ]),
    );
    const at = Date.parse(fields.at ?? "");
    const used = Date.parse(fields.used ?? "");
    current = {
      id: fields.id || newScrapId(),
      text: "",
      note: fields.note ?? "",
      at: Number.isFinite(at) ? at : Date.now(),
      from: fields.from ?? "",
      ...(Number.isFinite(used) ? { used } : {}),
    };
    lines = [];
  }
  end();
  return scraps;
}

/**
 * A scrap as it goes back in at `from`–`to` in `source`: within a line, a space where it meets
 * words on either side; a passage of paragraphs, a scrap cut as whole paragraphs at a
 * paragraph's start or end, or one put on a blank line, its own paragraphs, a blank line around
 * them. Its text, and where the cursor goes after it.
 */
export function scrapPlaced(
  source: string,
  from: number,
  to: number,
  scrap: string,
  whole = false,
): { text: string; cursor: number; back: number; ahead: number } {
  const words = scrap.trim();
  const lineStart = source.lastIndexOf("\n", from - 1) + 1;
  const toEnd = source.indexOf("\n", to);
  const lineEnd = toEnd < 0 ? source.length : toEnd;
  const before = source.slice(lineStart, from);
  const after = source.slice(to, lineEnd);
  const atStart = !before.trim();
  const atEnd = !after.trim();
  const nextEnd = source.indexOf("\n", lineEnd + 1);
  const next = toEnd < 0 ? "" : source.slice(lineEnd + 1, nextEnd < 0 ? source.length : nextEnd);
  const previous =
    lineStart === 0 ? "" : source.slice(source.lastIndexOf("\n", lineStart - 2) + 1, lineStart - 1);
  const put = (text: string, cursor: number, back = 0, ahead = 0) => ({
    text,
    cursor,
    back,
    ahead,
  });
  if (atStart && atEnd) {
    // On a blank line: a blank line before it (never two), and before the words after it.
    const lead =
      lineStart === 0 || source.slice(Math.max(0, lineStart - 2), lineStart) === "\n\n" ? "" : "\n";
    const tail = next.trim() ? "\n" : "";
    return put(`${lead}${words}${tail}`, lead.length + words.length);
  }
  if (words.includes("\n\n") || whole) {
    // A paragraph of its own: before the paragraph it meets, after it, or splitting it, the
    // spaces where it splits taken away.
    if (atStart && !previous.trim()) return put(`${words}\n\n`, words.length);
    if (atEnd && !next.trim()) return put(`\n\n${words}`, 2 + words.length);
    if (atStart) return put(`\n${words}\n\n`, 1 + words.length);
    if (atEnd)
      return put(`\n\n${words}\n`, 2 + words.length, before.length - before.trimEnd().length);
    return put(
      `\n\n${words}\n\n`,
      2 + words.length,
      before.length - before.trimEnd().length,
      after.length - after.trimStart().length,
    );
  }
  const space = (char: string | undefined) =>
    char !== undefined && /[\p{L}\p{N}.,;:!?…”’"')\]*]/u.test(char);
  const lead = space(before.at(-1)) ? " " : "";
  const tail = after && /^[\p{L}\p{N}“"‘(@*\[{]/u.test(after) ? " " : "";
  return put(`${lead}${words}${tail}`, lead.length + words.length);
}

/** A selection ending at a line's start (a triple-click, Shift+↓): ending where that line before does. */
function endOf(source: string, from: number, to: number): number {
  return to > from && source[to - 1] === "\n" ? to - 1 : to;
}

/** Whether `from`–`to` in `source` is whole paragraphs: from a paragraph's start to one's end. */
export function wholeParagraphs(source: string, from: number, selectedTo: number): boolean {
  const to = endOf(source, from, selectedTo);
  const lineStart = source.lastIndexOf("\n", from - 1) + 1;
  const toEnd = source.indexOf("\n", to);
  const lineEnd = toEnd < 0 ? source.length : toEnd;
  if (source.slice(lineStart, from).trim() || source.slice(to, lineEnd).trim()) return false;
  if (!source.slice(from, to).trim()) return false;
  const before =
    lineStart === 0 ? "" : source.slice(source.lastIndexOf("\n", lineStart - 2) + 1, lineStart - 1);
  const nextEnd = source.indexOf("\n", lineEnd + 1);
  const after = toEnd < 0 ? "" : source.slice(lineEnd + 1, nextEnd < 0 ? source.length : nextEnd);
  return !before.trim() && !after.trim();
}

/**
 * What cutting `from`–`to` in `source` takes out: whole paragraphs with a blank line beside them,
 * so those around meet as paragraphs do; words within a line with the space beside them, so a
 * sentence cut from between two others leaves one space, and one cut from a line's end none.
 */
export function cutRange(
  source: string,
  from: number,
  selectedTo: number,
): { from: number; to: number } {
  if (wholeParagraphs(source, from, selectedTo)) {
    const to = endOf(source, from, selectedTo);
    const start = source.lastIndexOf("\n", from - 1) + 1;
    const toEnd = source.indexOf("\n", to);
    const end = toEnd < 0 ? source.length : toEnd;
    if (source.slice(end, end + 2) === "\n\n") return { from: start, to: end + 2 };
    if (start >= 2 && source.slice(start - 2, start) === "\n\n")
      return { from: start - 2, to: end };
    return { from: start, to: end };
  }
  const to = selectedTo;
  const before = source.slice(Math.max(0, from - 1), from);
  const after = source.slice(to, to + 1);
  if (/[ \t]/.test(after) && (before === "" || /[ \t\n]/.test(before))) return { from, to: to + 1 };
  if (after === "" || after === "\n") {
    const lineStart = source.lastIndexOf("\n", from - 1) + 1;
    const spaces = /[ \t]*$/.exec(source.slice(lineStart, from))?.[0].length ?? 0;
    return { from: from - spaces, to };
  }
  return { from, to };
}
