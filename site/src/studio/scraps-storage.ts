import type { Scrap } from "../writer/scraps";

/** Separate from Writer, and one atomic record per Studio browser draft. */
export const STUDIO_SCRAPS_PREFIX = "vxd-studio-scraps:";
export const MAX_SCRAPS = 500;
export const MAX_SCRAP_CHARS = 500_000;
export type ScrapBook = { version: 1; scraps: Scrap[]; deleted: Scrap[] };
export type ScrapsKeeper = Pick<Storage, "getItem" | "setItem">;

function validScrap(value: unknown): value is Scrap {
  if (!value || typeof value !== "object") return false;
  const scrap = value as Partial<Scrap>;
  return (
    typeof scrap.id === "string" &&
    scrap.id.length > 0 &&
    scrap.id.length <= 200 &&
    typeof scrap.text === "string" &&
    scrap.text.length <= MAX_SCRAP_CHARS &&
    !scrap.text.includes("\0") &&
    typeof scrap.note === "string" &&
    scrap.note.length <= 2_000 &&
    typeof scrap.from === "string" &&
    scrap.from.length <= 2_000 &&
    typeof scrap.at === "number" &&
    Number.isFinite(scrap.at) &&
    Math.abs(scrap.at) <= 8.64e15 &&
    (scrap.used === undefined ||
      (typeof scrap.used === "number" &&
        Number.isFinite(scrap.used) &&
        Math.abs(scrap.used) <= 8.64e15))
  );
}

export function validateScraps(scraps: unknown): asserts scraps is Scrap[] {
  if (!Array.isArray(scraps) || scraps.length > MAX_SCRAPS || !scraps.every(validScrap))
    throw new Error("These scraps contain unsupported data or exceed the 500-scrap limit.");
  if (new Set(scraps.map((scrap) => scrap.id)).size !== scraps.length)
    throw new Error("These scraps contain duplicate identifiers.");
  if (
    scraps.reduce((total, scrap) => total + scrap.text.length + scrap.note.length, 0) >
    MAX_SCRAP_CHARS
  )
    throw new Error(
      "This collection exceeds 500,000 characters. Export some scraps before adding more.",
    );
}

export function readScrapBook(keeper: ScrapsKeeper, draft: string) {
  const raw = keeper.getItem(STUDIO_SCRAPS_PREFIX + draft);
  const value: unknown = raw === null ? { version: 1, scraps: [], deleted: [] } : JSON.parse(raw);
  if (
    !value ||
    typeof value !== "object" ||
    !("version" in value) ||
    value.version !== 1 ||
    !("scraps" in value) ||
    !("deleted" in value)
  )
    throw new Error("The saved scraps could not be read.");
  validateScraps(value.scraps);
  validateScraps(value.deleted);
  return { raw, book: value as ScrapBook };
}

/** Refuse stale-tab writes; never replace unreadable or externally changed data. */
export function writeScrapBook(
  keeper: ScrapsKeeper,
  draft: string,
  baseline: string | null,
  book: ScrapBook,
): string {
  validateScraps(book.scraps);
  validateScraps(book.deleted);
  const key = STUDIO_SCRAPS_PREFIX + draft;
  if (keeper.getItem(key) !== baseline)
    throw new Error(
      "Scraps changed in another tab. Reopen Scraps to load them; your unfinished note stays here.",
    );
  const raw = JSON.stringify(book);
  keeper.setItem(key, raw);
  return raw;
}
