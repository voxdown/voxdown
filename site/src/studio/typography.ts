import type { ScreenplayLayout } from "./layout";

const combiningMark = /\p{Mark}/u;
const formatControl = /\p{Cf}/u;
const DIAGNOSTIC_LIMIT = 8;

/** Check only printable runs: private/omitted source never enters this diagnostic.
 * Glyph presence alone does not establish reliable mark/control positioning. */
export function printedTypographyProblem(layout: ScreenplayLayout): string | undefined {
  const found = new Set<number>();
  let more = false;
  scan: for (const page of layout.pages) {
    for (const line of page.lines) {
      for (const run of line.runs) {
        for (const character of run.text) {
          if (!combiningMark.test(character) && !formatControl.test(character)) continue;
          const code = character.codePointAt(0) as number;
          if (found.has(code)) continue;
          if (found.size === DIAGNOSTIC_LIMIT) {
            more = true;
            break scan;
          }
          found.add(code);
        }
      }
    }
  }
  if (!found.size) return;
  const codes = [...found].map(
    (code) =>
      `U+${code.toString(16).toUpperCase().padStart(4, "0")} (${combiningMark.test(String.fromCodePoint(code)) ? "combining mark" : "formatting character"})`,
  );
  return `PDF export cannot reliably position these Unicode characters (${codes.join(", ")}${more ? ", …" : ""}). Preview spacing may also differ. Use supported precomposed letters where available and review formatting characters, or keep this text in Fountain or a Studio backup. Your source has not been changed.`;
}
