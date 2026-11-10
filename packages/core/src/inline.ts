/**
 * Lexing the lines of a paragraph into tokens, in two passes:
 *
 * 1. Marks, directions, sounds, instructions, links, images, escapes and notes are found on each
 *    line. Quotation marks are only collected.
 * 2. Quotation marks are resolved into openings, closings and plain text (§5.5). This pass carries
 *    its state from line to line, because a quote may run over several lines of a paragraph.
 *
 * Who says what is decided later, in `speech.ts`.
 */
import type { NoteSpan } from "./blocks";
import {
  CLOSERS,
  QUOTE_MARKS,
  cleanText,
  codePointAt,
  codePointBefore,
  holdsAt,
  isEscapable,
  isLetter,
  isLetterOrDigit,
  isSpace,
  removeEscapes,
} from "./chars";
import type { Range } from "./source";
import type { Warn } from "./warnings";

/** Text as heard. `plain` text is exactly its source; escapes and links are not. */
export type TextToken = { type: "text"; value: string; range: Range; plain: boolean };
export type MarkToken = {
  type: "mark";
  name: string;
  direction: string | null;
  range: Range;
  nameRange: Range;
  directionRange?: Range;
};
export type DirectionToken = { type: "direction"; direction: string | null; range: Range };
export type VocalToken = { type: "vocal"; description: string; range: Range };
export type SoundToken = { type: "sound"; description: string; range: Range };
export type InstructionToken = {
  type: "instruction";
  name: string;
  value: string | null;
  raw: string;
  range: Range;
};
export type NoteToken = { type: "note"; text: string; range: Range };
export type ImageToken = { type: "image"; alt: string; src: string; range: Range };
export type OpenToken = { type: "open"; char: string; range: Range };
export type CloseToken = { type: "close"; char: string; range: Range };
export type QuoteToken = OpenToken | CloseToken;

export type Token =
  | TextToken
  | MarkToken
  | DirectionToken
  | VocalToken
  | SoundToken
  | InstructionToken
  | NoteToken
  | ImageToken
  | QuoteToken;

/** A quotation mark before it is known whether it opens, closes or is just a character. */
type QuoteChar = { type: "quote"; char: string; range: Range };
type Atom = Exclude<Token, QuoteToken> | QuoteChar;

export type LexedLine = { range: Range; tokens: Token[] };

/** The instructions that say who hears or sees a paragraph (§9.3). */
export const VISIBILITY_NAMES: ReadonlySet<string> = new Set(["book only", "audio only", "hidden"]);
const KNOWN_INSTRUCTIONS: ReadonlySet<string> = new Set(["page", "pause", ...VISIBILITY_NAMES]);

/** Lexes the lines of one paragraph or heading. */
export function lexLines(
  source: string,
  lines: readonly Range[],
  notes: readonly NoteSpan[],
  warn: Warn,
): LexedLine[] {
  const quotes: QuoteState = { open: null };
  return lines.map((range) => ({
    range,
    tokens: resolveQuotes(lexAtoms(source, range, notes, warn), quotes, warn),
  }));
}

/** Lexes one line without resolving its quotation marks, for group lines (§7). */
export function lexLine(
  source: string,
  range: Range,
  notes: readonly NoteSpan[],
  warn: Warn,
): Array<Exclude<Token, QuoteToken>> {
  return lexAtoms(source, range, notes, warn).map((atom) =>
    atom.type === "quote" ? plainText(atom) : atom,
  );
}

export function isBlankText(token: Token): boolean {
  return token.type === "text" && token.plain && token.value.trim() === "";
}

// Pass 1: atoms

function lexAtoms(source: string, line: Range, notes: readonly NoteSpan[], warn: Warn): Atom[] {
  const atoms: Atom[] = [];
  let at = line.from;
  for (const note of notesWithin(notes, line)) {
    lexSegment(source, at, note.from, atoms, warn);
    atoms.push({ type: "note", text: note.text, range: { from: note.from, to: note.to } });
    at = note.to;
  }
  lexSegment(source, at, line.to, atoms, warn);
  return atoms;
}

function notesWithin(notes: readonly NoteSpan[], line: Range): NoteSpan[] {
  let low = 0;
  let high = notes.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((notes[middle]?.from ?? 0) < line.from) low = middle + 1;
    else high = middle;
  }
  const within: NoteSpan[] = [];
  for (let i = low; i < notes.length; i++) {
    const note = notes[i];
    if (!note || note.to > line.to) break;
    within.push(note);
  }
  return within;
}

/** Lexes `from`..`to`, a stretch of a line with no notes in it. */
function lexSegment(source: string, from: number, to: number, atoms: Atom[], warn: Warn): void {
  let textFrom = from;
  let i = from;
  while (i < to) {
    const atom = lexAtom(source, i, to, warn);
    if (!atom) {
      i++;
      continue;
    }
    if (atom.range.from > textFrom) atoms.push(sourceText(source, textFrom, atom.range.from));
    atoms.push(atom);
    i = atom.range.to;
    textFrom = i;
  }
  if (to > textFrom) atoms.push(sourceText(source, textFrom, to));
}

function lexAtom(source: string, i: number, to: number, warn: Warn): Atom | null {
  const char = source[i];
  switch (char) {
    case "\\":
      return i + 1 < to && isEscapable(source[i + 1])
        ? { type: "text", value: source[i + 1] ?? "", range: { from: i, to: i + 2 }, plain: false }
        : null;
    case "@":
      return lexAt(source, i, to);
    case "!":
      return source[i + 1] === "[" ? lexImage(source, i, to) : null;
    case "[":
      return lexBracket(source, i, to, warn);
    case "{":
      return lexInstruction(source, i, to, warn);
    default:
      return char !== undefined && QUOTE_MARKS.has(char)
        ? { type: "quote", char, range: { from: i, to: i + 1 } }
        : null;
  }
}

/**
 * `@` is a mark when it is not preceded by a letter or digit (a letter of a script written without
 * spaces doesn't count) and is followed by a name, `(` or `[` (§5.2): a character mark, a
 * direction (§6.2) or a sound for whoever is speaking (§8.2).
 */
function lexAt(source: string, at: number, to: number): Atom | null {
  if (holdsAt(codePointBefore(source, at))) return null;
  const next = source[at + 1];
  if (next === "(") {
    const close = matchParen(source, at + 1, to);
    if (close < 0) return null;
    const direction = cleanText(source.slice(at + 2, close)) || null;
    return { type: "direction", direction, range: { from: at, to: close + 1 } };
  }
  if (next === "[") {
    const close = findUnescaped(source, at + 2, to, "]");
    // A bracket followed directly by "(" is a Markdown link, after an @ too (§8.3).
    if (close >= 0 && source[close + 1] === "(" && matchParen(source, close + 1, to) >= 0) {
      return null;
    }
    const description = close < 0 ? "" : cleanText(source.slice(at + 2, close));
    if (!description) return null;
    return { type: "vocal", description, range: { from: at, to: close + 1 } };
  }
  const nameEnd = scanName(source, at + 1, to);
  if (nameEnd === at + 1) return null;
  const nameRange = { from: at + 1, to: nameEnd };
  const name = source.slice(nameRange.from, nameRange.to);
  let paren = nameEnd;
  while (paren < to && isSpace(source[paren])) paren++;
  const close = paren < to && source[paren] === "(" ? matchParen(source, paren, to) : -1;
  if (close < 0) {
    return { type: "mark", name, direction: null, range: { from: at, to: nameEnd }, nameRange };
  }
  return {
    type: "mark",
    name,
    direction: cleanText(source.slice(paren + 1, close)) || null,
    range: { from: at, to: close + 1 },
    nameRange,
    directionRange: { from: paren, to: close + 1 },
  };
}

/**
 * A name starts with a letter and continues with letters, digits, `-` and `_`, and apostrophes
 * between two letters (§5.2). Returns the index after it, or `from` when there is none.
 */
function scanName(source: string, from: number, to: number): number {
  const first = codePointAt(source, from);
  if (from >= to || !first || !/^\p{L}$/u.test(first)) return from;
  let i = from + first.length;
  while (i < to) {
    const char = codePointAt(source, i) ?? "";
    if (/^[\p{L}\p{M}\p{N}_-]$/u.test(char)) {
      i += char.length;
    } else if (
      (char === "'" || char === "’") &&
      isLetter(codePointBefore(source, i)) &&
      i + 1 < to &&
      isLetter(codePointAt(source, i + 1))
    ) {
      i++;
    } else {
      break;
    }
  }
  return i;
}

/** `![description](file)`, shown in the book and not heard (§8.3). */
function lexImage(source: string, at: number, to: number): Atom | null {
  const close = findUnescaped(source, at + 2, to, "]");
  if (close < 0 || close + 1 >= to || source[close + 1] !== "(") return null;
  const end = matchParen(source, close + 1, to);
  if (end < 0) return null;
  return {
    type: "image",
    alt: source.slice(at + 2, close),
    src: source.slice(close + 2, end).trim(),
    range: { from: at, to: end + 1 },
  };
}

/** `[a sound]` (§8.1), or a Markdown link, `[text](address)`, whose text is read (§8.3). */
function lexBracket(source: string, at: number, to: number, warn: Warn): Atom | null {
  const close = findUnescaped(source, at + 1, to, "]");
  if (close < 0) return null;
  const inner = source.slice(at + 1, close);
  if (close + 1 < to && source[close + 1] === "(") {
    const end = matchParen(source, close + 1, to);
    const target = end < 0 ? "" : source.slice(close + 2, end).trim();
    if (end < 0 || !looksLikeAddress(target)) {
      warn(
        "sound-looks-like-link",
        `A sound followed directly by “(” reads as a Markdown link. If “[${inner}]” is a sound, put a space after it.`,
        { from: at, to: close + 2 },
      );
    }
    if (end >= 0) {
      return {
        type: "text",
        value: removeEscapes(inner),
        range: { from: at, to: end + 1 },
        plain: false,
      };
    }
  }
  const description = cleanText(inner);
  if (!description) return null;
  return { type: "sound", description, range: { from: at, to: close + 1 } };
}

/** Whether a link's target looks like an address rather than words, such as `(softly)`. */
function looksLikeAddress(target: string): boolean {
  return target !== "" && !/\s/.test(target) && /[./:#?=@]/.test(target);
}

/** `{name}` or `{name value}` (§9). Anything else in braces stays text. */
function lexInstruction(source: string, at: number, to: number, warn: Warn): Atom | null {
  const close = findUnescaped(source, at + 1, to, "}");
  if (close < 0) return null;
  const parsed = parseInstruction(cleanText(source.slice(at + 1, close)));
  if (!parsed) return null;
  const { name, value } = parsed;
  const range = { from: at, to: close + 1 };
  if (!KNOWN_INSTRUCTIONS.has(name) && !name.includes(":")) {
    warn(
      "unknown-instruction",
      `“{${name}}” is not an instruction this spec knows. A tool's own instructions start with its name and a colon, such as {recorder:take 3}.`,
      range,
    );
  }
  if (name === "pause" && value !== null && !/^\d+(?:\.\d+)? ?(?:s|ms)$/.test(value)) {
    warn(
      "pause-value",
      "A pause is written in seconds or milliseconds, such as {pause 2s} or {pause 500ms}.",
      range,
    );
  }
  return { type: "instruction", name, value, raw: source.slice(at, close + 1), range };
}

/** A name, which starts with a letter, then optionally a space and a value. */
function parseInstruction(content: string): { name: string; value: string | null } | null {
  if (VISIBILITY_NAMES.has(content)) return { name: content, value: null };
  const match = /^(\p{L}\S*)(?: (.+))?$/u.exec(content);
  return match?.[1] ? { name: match[1], value: match[2] ?? null } : null;
}

/** The index of the `)` that closes the `(` at `open`, or -1. Escaped parentheses don't count. */
function matchParen(source: string, open: number, to: number): number {
  let depth = 0;
  for (let i = open; i < to; i++) {
    const char = source[i];
    if (char === "\\" && isEscapable(source[i + 1])) i++;
    else if (char === "(") depth++;
    else if (char === ")" && --depth === 0) return i;
  }
  return -1;
}

function findUnescaped(source: string, from: number, to: number, target: string): number {
  for (let i = from; i < to; i++) {
    if (source[i] === "\\" && isEscapable(source[i + 1])) i++;
    else if (source[i] === target) return i;
  }
  return -1;
}

function sourceText(source: string, from: number, to: number): TextToken {
  return { type: "text", value: source.slice(from, to), range: { from, to }, plain: true };
}

function plainText(atom: QuoteChar | QuoteToken): TextToken {
  return { type: "text", value: atom.char, range: atom.range, plain: true };
}

// Pass 2: quotation marks

type QuoteState = { open: string | null };

const APOSTROPHE_LIKE = new Set(["'", "‘", '"']);

/**
 * Decides what each quotation mark does (§5.5):
 *
 * - inside a quote, the first matching closing mark closes it, except a `’` or `'` followed by
 *   a letter or digit (`don’t`);
 * - a mark with nothing after it on its line opens nothing;
 * - when no quote is open, a `'`, `‘` or `"` straight after a letter or digit is not a quote
 *   (`rock'n'roll`, `6" nail`);
 * - a straight `'` opens a quote only if a closing `'` follows on the same line.
 */
function resolveQuotes(atoms: readonly Atom[], state: QuoteState, warn: Warn): Token[] {
  const tokens: Token[] = [];
  atoms.forEach((atom, index) => {
    if (atom.type !== "quote") {
      tokens.push(atom);
      return;
    }
    const { char } = atom;
    if (state.open !== null) {
      if (closes(state.open, atoms, index)) {
        tokens.push({ type: "close", char, range: atom.range });
        state.open = null;
      } else {
        tokens.push(plainText(atom));
      }
      return;
    }
    if (!CLOSERS.has(char)) {
      tokens.push(plainText(atom));
      return;
    }
    const afterLetter = isLetterOrDigit(lastChar(tokens[tokens.length - 1]));
    if (nothingAfter(atoms, index)) {
      tokens.push(plainText(atom));
      if (!(afterLetter && (char === "'" || char === "‘"))) {
        warn(
          "stray-quote",
          "This quotation mark has nothing after it on its line, so it opens nothing.",
          atom.range,
        );
      }
      return;
    }
    if (
      (afterLetter && APOSTROPHE_LIKE.has(char)) ||
      (char === "'" && !hasStraightCloser(atoms, index))
    ) {
      tokens.push(plainText(atom));
      return;
    }
    tokens.push({ type: "open", char, range: atom.range });
    state.open = char;
  });
  return tokens;
}

function closes(opener: string, atoms: readonly Atom[], index: number): boolean {
  const atom = atoms[index];
  if (atom?.type !== "quote" || !CLOSERS.get(opener)?.includes(atom.char)) return false;
  const apostrophe = atom.char === "’" || atom.char === "'";
  return !(apostrophe && isLetterOrDigit(firstChar(atoms[index + 1])));
}

function hasStraightCloser(atoms: readonly Atom[], index: number): boolean {
  for (let i = index + 1; i < atoms.length; i++) {
    const atom = atoms[i];
    if (atom?.type === "quote" && atom.char === "'" && closes("'", atoms, i)) return true;
  }
  return false;
}

function nothingAfter(atoms: readonly Atom[], index: number): boolean {
  for (let i = index + 1; i < atoms.length; i++) {
    const atom = atoms[i];
    if (atom?.type !== "text" || !atom.plain || atom.value.trim() !== "") return false;
  }
  return true;
}

function lastChar(token: Token | undefined): string | undefined {
  return token?.type === "text" ? codePointBefore(token.value, token.value.length) : undefined;
}

function firstChar(atom: Atom | undefined): string | undefined {
  return atom?.type === "text" ? codePointAt(atom.value, 0) : undefined;
}
