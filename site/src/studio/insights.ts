import type { FountainDocument, FountainKind } from "./fountain";
import { fountainRuns } from "./inline";

export interface ScreenplayStatistics {
  /** All printable screenplay words, including headings, cues, and directions. */
  words: number;
  scenes: number;
  dialogueWords: number;
  characters: number;
  /** Dialogue and lyrics only; excludes pauses, action, and simultaneous delivery. */
  estimatedSpokenSeconds: number;
  wordsPerMinute: number;
}

export interface CharacterInsight {
  name: string;
  /** Number of character cues, including cues with no dialogue. */
  blocks: number;
  words: number;
  /** One-based source line of each cue. */
  lines: number[];
  dialogueLines: number[];
  dualBlocks: number;
}

export interface PrivateNoteInsight {
  kind: "note" | "boneyard";
  from: number;
  to: number;
  line: number;
  endLine: number;
  /** Exact source including delimiters; never interpreted as HTML. */
  source: string;
  text: string;
}

export interface DiagnosticInsight {
  severity: "warning";
  message: string;
  line: number;
  from: number;
  to: number;
}

export interface ScreenplayInsights {
  statistics: ScreenplayStatistics;
  characters: CharacterInsight[];
  notes: PrivateNoteInsight[];
  diagnostics: DiagnosticInsight[];
}

const nonPrinting = new Set<FountainKind>([
  "title",
  "section",
  "synopsis",
  "note",
  "boneyard",
  "blank",
  "page-break",
]);

/** Deterministic Unicode word tokens. Apostrophes/hyphens within a token count as
 * one word. Unspaced writing systems are approximate, not language segmentation.
 */
export function countWords(text: string): number {
  let count = 0;
  for (const _ of text.matchAll(
    /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:['’‐-][\p{L}\p{N}][\p{L}\p{N}\p{M}]*)*/gu,
  ))
    count++;
  return count;
}

function plainText(text: string): string {
  return fountainRuns(text)
    .map((run) => run.text)
    .join("");
}

function characterName(cue: string): string {
  // Extensions are performance directions, not separate cast members.
  let end = cue.length;
  while (end > 0 && /\s/u.test(cue.charAt(end - 1))) end--;
  while (cue.charAt(end - 1) === ")") {
    let opening = end - 2;
    while (opening >= 0 && cue.charAt(opening) !== "(" && cue.charAt(opening) !== ")") opening--;
    if (opening < 0 || cue.charAt(opening) !== "(") break;
    end = opening;
    while (end > 0 && /\s/u.test(cue.charAt(end - 1))) end--;
  }
  return cue.slice(0, end).trim().replace(/\s+/gu, " ").normalize("NFC");
}

/** The source and parser result must belong to the same document revision.
 * Work and output are bounded by source length and parser element count. Private
 * ranges come exclusively from the parser; incomplete comments stay printable
 * and are reported as diagnostics, matching preview/export behavior.
 */
export function screenplayInsights(
  document: FountainDocument,
  source: string,
  options: { wordsPerMinute?: number } = {},
): ScreenplayInsights {
  const requestedRate = options.wordsPerMinute ?? 150;
  const wordsPerMinute = Number.isFinite(requestedRate)
    ? Math.max(1, Math.min(1_000, requestedRate))
    : 150;
  let words = 0;
  let dialogueWords = 0;
  let scenes = 0;
  let activeCharacter: CharacterInsight | undefined;
  const cast = new Map<string, CharacterInsight>();
  for (const element of document.elements) {
    if (element.kind === "scene") scenes++;
    const elementWords = nonPrinting.has(element.kind) ? 0 : countWords(plainText(element.text));
    words += elementWords;
    if (element.kind === "character") {
      const name = characterName(plainText(element.text));
      const key = name.toUpperCase();
      activeCharacter = cast.get(key);
      if (!activeCharacter && name) {
        activeCharacter = {
          name,
          blocks: 0,
          words: 0,
          lines: [],
          dialogueLines: [],
          dualBlocks: 0,
        };
        cast.set(key, activeCharacter);
      }
      if (activeCharacter) {
        activeCharacter.blocks++;
        activeCharacter.lines.push(element.line);
        if (element.dual) activeCharacter.dualBlocks++;
      }
    } else if (element.kind === "dialogue" || element.kind === "lyric") {
      dialogueWords += elementWords;
      if (activeCharacter) {
        activeCharacter.words += elementWords;
        activeCharacter.dialogueLines.push(element.line);
      }
    } else if (
      element.kind !== "parenthetical" &&
      element.kind !== "note" &&
      element.kind !== "boneyard"
    ) {
      activeCharacter = undefined;
    }
  }

  let firstLine = 0;
  let lastLine = 0;
  const notes: PrivateNoteInsight[] = [];
  // Both omission ranges and elements are source ordered. Monotonic cursors keep
  // the index linear even with thousands of inline notes on a single line.
  for (const omission of document.omissions) {
    while ((document.elements[firstLine + 1]?.from ?? Number.POSITIVE_INFINITY) <= omission.from)
      firstLine++;
    lastLine = Math.max(lastLine, firstLine);
    while ((document.elements[lastLine + 1]?.from ?? Number.POSITIVE_INFINITY) < omission.to)
      lastLine++;
    const exactSource = source.slice(omission.from, omission.to);
    notes.push({
      ...omission,
      line: document.elements[firstLine]?.line ?? 1,
      endLine: document.elements[lastLine]?.line ?? 1,
      source: exactSource,
      text: exactSource.slice(2, -2),
    });
  }

  const diagnostics: DiagnosticInsight[] = document.warnings.map((warning) => {
    const element = document.elements[warning.line - 1];
    return {
      severity: "warning",
      message: warning.message,
      line: warning.line,
      from: element?.from ?? 0,
      to: element?.to ?? 0,
    };
  });
  return {
    statistics: {
      words,
      scenes,
      dialogueWords,
      characters: cast.size,
      estimatedSpokenSeconds: (dialogueWords / wordsPerMinute) * 60,
      wordsPerMinute,
    },
    characters: [...cast.values()],
    notes,
    diagnostics,
  };
}

export interface InsightSearchResult<T> {
  items: T[];
  total: number;
}

function search<T>(
  items: readonly T[],
  query: string,
  text: (item: T) => string,
  limit: number,
  offset: number,
): InsightSearchResult<T> {
  const needle = query.trim().normalize("NFC").toLowerCase();
  const maximum = Number.isFinite(limit) ? Math.max(0, Math.min(500, Math.floor(limit))) : 100;
  const start = Number.isSafeInteger(offset) ? Math.max(0, offset) : 0;
  const matches: T[] = [];
  let total = 0;
  for (const item of items) {
    if (needle && !text(item).normalize("NFC").toLowerCase().includes(needle)) continue;
    total++;
    if (total > start && matches.length < maximum) matches.push(item);
  }
  return { items: matches, total };
}

export function searchCharacters(
  items: readonly CharacterInsight[],
  query: string,
  limit = 100,
  offset = 0,
) {
  return search(items, query, (item) => item.name, limit, offset);
}

export function searchPrivateNotes(
  items: readonly PrivateNoteInsight[],
  query: string,
  limit = 100,
  offset = 0,
) {
  return search(items, query, (item) => item.text, limit, offset);
}

export function searchDiagnostics(
  items: readonly DiagnosticInsight[],
  query: string,
  limit = 100,
  offset = 0,
) {
  return search(items, query, (item) => item.message, limit, offset);
}
