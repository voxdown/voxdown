/**
 * A span of the source text as UTF-16 offsets into the original string: `from` is inclusive and
 * `to` exclusive, as in `String.prototype.slice`. Every range in the model is one of these, so an
 * editor can highlight it or write a change back at exactly that place.
 */
export type Range = { from: number; to: number };

/** One physical line of the file. Its range covers the text without the line ending. */
export type SourceLine = Range;

/** The original text, split into lines once, with a way back from offsets to lines and columns. */
export class SourceText {
  readonly lines: readonly SourceLine[];

  constructor(readonly text: string) {
    this.lines = splitLines(text);
  }

  slice(range: Range): string {
    return this.text.slice(range.from, range.to);
  }

  /** The 1-based line and column of an offset. Columns count UTF-16 code units. */
  position(offset: number): { line: number; column: number } {
    let low = 0;
    let high = this.lines.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((this.lines[middle]?.from ?? 0) <= offset) low = middle;
      else high = middle - 1;
    }
    return { line: low + 1, column: offset - (this.lines[low]?.from ?? 0) + 1 };
  }
}

/** Splits on LF and CRLF. A file ending in a line break ends with an empty line. */
function splitLines(text: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "\n") continue;
    lines.push({ from, to: i > from && text[i - 1] === "\r" ? i - 1 : i });
    from = i + 1;
  }
  lines.push({ from, to: text.length });
  return lines;
}
