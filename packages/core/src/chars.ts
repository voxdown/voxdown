import { characterReference } from "./entities";
/**
 * Character classes the format depends on: letters and digits in any script, quotation marks
 * (§5.5) and backslash escapes (§11).
 */

const LETTER = /^[\p{L}\p{M}]$/u;
const LETTER_OR_DIGIT = /^[\p{L}\p{M}\p{N}]$/u;
const ANY_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

export function isLetter(char: string | undefined): boolean {
  return char !== undefined && LETTER.test(char);
}

export function isLetterOrDigit(char: string | undefined): boolean {
  return char !== undefined && LETTER_OR_DIGIT.test(char);
}

/** Scripts written without spaces between words: Chinese, Japanese, Thai, Lao, Khmer, Burmese. */
const UNSPACED =
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]$/u;

/**
 * A letter or digit that keeps a following `@` from being a mark (§5.2): any, except a letter of
 * a script written without spaces, where a mark follows the word it belongs to directly.
 */
export function holdsAt(char: string | undefined): boolean {
  return isLetterOrDigit(char) && !(char !== undefined && UNSPACED.test(char));
}

/** Whether a stretch has anything to say: speech with no letters or digits is not spoken (§12.1). */
export function hasLetterOrDigit(text: string): boolean {
  return ANY_LETTER_OR_DIGIT.test(text);
}

export function isSpace(char: string | undefined): boolean {
  return char === " " || char === "\t";
}

/** The whole code point starting at `index`, so letters outside the BMP count as letters. */
export function codePointAt(text: string, index: number): string | undefined {
  const code = text.codePointAt(index);
  return code === undefined ? undefined : String.fromCodePoint(code);
}

/** The whole code point ending just before `index`. */
export function codePointBefore(text: string, index: number): string | undefined {
  if (index <= 0) return undefined;
  const low = text.charCodeAt(index - 1);
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) {
    const high = text.charCodeAt(index - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(index - 2, index);
  }
  return text[index - 1];
}

/** Each opening quotation mark and the marks that close it (§5.5). */
export const CLOSERS: ReadonlyMap<string, string> = new Map([
  ["“", "”"],
  ["‘", "’"],
  ['"', '"'],
  ["'", "'"],
  ["„", "“”"],
  ["‚", "‘’"],
  ["«", "»"],
  ["»", "«»"],
  ["‹", "›"],
  ["「", "」"],
  ["『", "』"],
]);

/** Every opening and closing quotation mark. */
export const QUOTE_MARKS: ReadonlySet<string> = new Set("“”‘’\"'„‚«»‹›「」『』");

const ASCII_PUNCTUATION = /^[!-/:-@[-`{-~]$/;
const ESCAPE = /\\([!-/:-@[-`{-~“”‘’„‚«»‹›「」『』])/g;

/** A backslash makes ASCII punctuation or a quotation mark literal (§11). */
export function isEscapable(char: string | undefined): boolean {
  return char !== undefined && (ASCII_PUNCTUATION.test(char) || QUOTE_MARKS.has(char));
}

/**
 * Removes the backslash from every escape, and puts each character reference's character in its
 * place (§11), in one pass: `\\&amp;` is `&amp;`.
 */
export function removeEscapes(text: string): string {
  if (!text.includes("&")) return text.replace(ESCAPE, "$1");
  return text.replace(REFERENCE_OR_ESCAPE, (whole, escaped: string | undefined, offset: number) => {
    if (escaped !== undefined) return escaped;
    return characterReference(text, offset)?.char ?? whole;
  });
}

const REFERENCE_OR_ESCAPE =
  /\\([!-/:-@[-`{-~“”‘’„‚«»‹›「」『』])|&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{0,31});/g;

/** Unescaped, with every run of white space, line breaks included, made one space. */
export function cleanText(text: string): string {
  return removeEscapes(text).replace(/\s+/g, " ").trim();
}
