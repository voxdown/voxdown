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
};

/** Where scraps are kept, or a stand-in for a test. */
export type Keeper = Pick<Storage, "getItem" | "setItem">;

const KEY = "vxd-writer-scraps";
/** Each story's file name, and what its scraps were when last saved beside it. */
const NAMES = "vxd-writer-scraps-names";
const SAVED = "vxd-writer-scraps-saved";

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
 * changed since they last were; or saved as they are.
 */
export function scrapsStanding(
  keeper: Keeper,
  story: string,
  scraps: readonly Scrap[],
): "none" | "browser" | "changed" | "saved" {
  if (!scraps.length) return "none";
  const saved = read<string>(keeper, SAVED)[story];
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
