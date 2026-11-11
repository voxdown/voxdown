/**
 * Heights the editor guesses for what it hasn't drawn, as the story will be drawn.
 *
 * CodeMirror draws only the lines near the screen and guesses the height of the rest: a whole line
 * for each line, more where a long one wraps. But the blank line between two paragraphs is drawn
 * short here (`.vxd-blank`, a paragraph's gap rather than an empty line), and a book has thousands
 * of them: Moby-Dick was guessed at 726,000 pixels, and is 555,000. The scrollbar is laid out by the
 * guess, so dragging its thumb to the foot of the track reached three quarters of the book, the
 * rest arriving as each part was drawn and found shorter.
 *
 * So the guess is the story's own: its share of blank lines at the height a blank line is drawn,
 * the rest of the lines as CodeMirror guesses them. CodeMirror has no setting for this; its guesses
 * come from one object on each view (`viewState.heightOracle`), whose two methods are given here.
 * If a later CodeMirror has no such object, nothing is changed and its own guesses stand.
 */
import type { EditorState, Text } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

type Oracle = {
  doc: Text;
  lineHeight: number;
  lineLength: number;
  lineWrapping: boolean;
  heightForGap(from: number, to: number): number;
  heightForLine(length: number): number;
};

/** The share of a text's lines that are blank. */
export function blankShare(doc: Text): number {
  if (doc.lines < 2) return 0;
  let blank = 0;
  for (const iter = doc.iterLines(); !iter.next().done; ) if (!iter.value.trim()) blank++;
  return blank / doc.lines;
}

/**
 * How tall CodeMirror's guess should make `from`–`to`: its blank lines at `blank` pixels, its
 * other lines as CodeMirror guesses them (a line each, and more for each line's length past half
 * a wrapped line).
 */
export function gapHeight(
  oracle: Pick<Oracle, "doc" | "lineHeight" | "lineLength" | "lineWrapping">,
  from: number,
  to: number,
  share: number,
  blank: number,
): number {
  const lines = oracle.doc.lineAt(to).number - oracle.doc.lineAt(from).number + 1;
  const blanks = Math.round(lines * share);
  const text = Math.max(0, lines - blanks);
  let rows = text;
  if (oracle.lineWrapping)
    rows += Math.max(
      0,
      Math.ceil((to - from - text * oracle.lineLength * 0.5) / Math.max(1, oracle.lineLength)),
    );
  return blanks * blank + rows * oracle.lineHeight;
}

const oracleOf = (view: EditorView): Oracle | undefined => {
  const oracle = (view as unknown as { viewState?: { heightOracle?: Oracle } }).viewState
    ?.heightOracle;
  return oracle &&
    typeof oracle.heightForGap === "function" &&
    typeof oracle.heightForLine === "function" &&
    typeof oracle.doc?.lineAt === "function"
    ? oracle
    : undefined;
};

/** Some of a story's paragraphs, from over the whole of it: its own prose, to measure. */
export function proseOf(doc: Text, most = 12_000): string {
  const pieces: string[] = [];
  let length = 0;
  const step = Math.max(1, Math.floor(doc.lines / 60));
  for (let number = 1; number <= doc.lines && length < most; number += step) {
    const text = doc.line(number).text;
    if (text.length < 120) continue;
    pieces.push(text);
    length += text.length;
  }
  return pieces.join(" ").slice(0, most);
}

let canvas: HTMLCanvasElement | undefined;
const measuring = () => {
  canvas ??= document.createElement("canvas");
  return canvas.getContext("2d") ?? undefined;
};

/** What the screen shows of how the story is drawn: a blank line's height, and a row's length. */
type Drawn = { blankRatio?: number; rowChars?: number };

/** Measured from the lines on screen. */
export function measureDrawn(
  lines: readonly { text: number; height: number }[],
  line: number,
): Drawn & { chars?: number; rows?: number } {
  const out: Drawn & { chars?: number; rows?: number } = {};
  const blanks = lines.filter((each) => each.text === 0);
  if (blanks.length) out.blankRatio = Math.min(...blanks.map((each) => each.height)) / line;
  // Paragraphs over three rows or more: their characters over their rows, the last row half full.
  let chars = 0;
  let rows = 0;
  for (const each of lines) {
    const count = Math.round(each.height / line);
    if (count < 3) continue;
    chars += each.text;
    rows += count - 0.5;
  }
  if (rows >= 6) {
    out.rowChars = chars / rows;
    out.chars = chars;
    out.rows = rows;
  }
  return out;
}

/** The guesses, for each view, kept true to the story as it is drawn. */
class StoryHeights {
  private share = 0;
  /** A blank line's height as a share of a line's: the stylesheet's 0.75 to 1.65, until measured. */
  private blankRatio = 0.75 / 1.65;
  /**
   * Characters in a row, as the story's paragraphs wrap: CodeMirror reckons it from one short
   * line on screen (`MOBY-DICK;` in capitals, say), which can be a sixth too few.
   */
  private rowChars: number | undefined;
  /** Guesses made again from scratch for this view, at most a few times. */
  private remade = 0;
  /** Every paragraph measured so far, together: one screen of verse or short lines moves it little. */
  private seen = { chars: 0, rows: 0 };
  private counted: Text | undefined;
  private recount: ReturnType<typeof setTimeout> | undefined;
  private patched: Oracle | undefined;

  constructor(readonly view: EditorView) {
    this.count(view.state);
    this.patch();
    this.measureSoon();
    // The story's typeface may arrive after the page: measured again once it has.
    void view.dom.ownerDocument.fonts?.ready.then(() => this.measureSoon());
  }

  update(update: ViewUpdate) {
    // A new oracle when the view has a new state (another story opened).
    if (oracleOf(this.view) !== this.patched) {
      this.patch();
      this.remade = 0;
      this.seen = { chars: 0, rows: 0 };
    }
    if (update.docChanged) {
      // Counted again a moment after a change, never in the keystroke itself.
      clearTimeout(this.recount);
      this.recount = setTimeout(() => this.count(this.view.state), 1500);
    }
    if (update.viewportChanged || update.geometryChanged) this.measureSoon();
  }

  destroy() {
    clearTimeout(this.recount);
  }

  private count(state: EditorState) {
    if (this.counted === state.doc) return;
    this.counted = state.doc;
    this.share = blankShare(state.doc);
  }

  private patch() {
    const oracle = oracleOf(this.view);
    this.patched = oracle;
    if (!oracle) return;
    const own = {
      heightForGap: oracle.heightForGap.bind(oracle),
      heightForLine: oracle.heightForLine.bind(oracle),
    };
    const shaped = () => ({ ...oracle, lineLength: this.rowChars ?? oracle.lineLength });
    oracle.heightForGap = (from, to) =>
      this.share > 0 || this.rowChars
        ? gapHeight(shaped(), from, to, this.share, this.blankRatio * oracle.lineHeight)
        : own.heightForGap(from, to);
    oracle.heightForLine = (length) => {
      if (length === 0) return this.blankRatio * oracle.lineHeight;
      if (!this.rowChars || !oracle.lineWrapping) return own.heightForLine(length);
      const row = this.rowChars;
      return (
        (1 + Math.max(0, Math.ceil((length - row) / Math.max(1, row - 5)))) * oracle.lineHeight
      );
    };
  }

  /** How the story is drawn now, from the lines on screen; the guesses made again if it differs. */
  private measureSoon() {
    this.view.requestMeasure({
      key: this,
      read: (view) => {
        const line = view.defaultLineHeight;
        if (!line) return undefined;
        const lines = [...view.contentDOM.querySelectorAll<HTMLElement>(".cm-content > .cm-line")]
          // Plain prose: a line with a picture or a widget in it says little of how text wraps.
          .filter((element) => !element.querySelector("img, .cm-widgetBuffer + *:not(span)"))
          .map((element) => ({
            text: element.textContent?.length ?? 0,
            height: element.getBoundingClientRect().height,
          }));
        const drawn = measureDrawn(lines, line);
        // No paragraphs on screen to count (a title page, a list of contents): its own prose,
        // measured in its typeface across the line, a row holding about 95% of what fits.
        if (!drawn.rowChars && !this.rowChars) {
          const sample = proseOf(view.state.doc);
          const first = view.contentDOM.querySelector<HTMLElement>(".cm-line");
          const context = first && sample ? measuring() : undefined;
          if (first && context) {
            const style = getComputedStyle(first);
            const width =
              first.clientWidth -
              (Number.parseFloat(style.paddingLeft) || 0) -
              (Number.parseFloat(style.paddingRight) || 0);
            context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
            const each = context.measureText(sample).width / sample.length;
            if (each > 0 && width > 0) drawn.rowChars = (width / each) * 0.95;
          }
        }
        return drawn;
      },
      write: (drawn) => {
        if (!drawn) return;
        if (drawn.blankRatio && drawn.blankRatio > 0.1 && drawn.blankRatio < 1.5)
          this.blankRatio = drawn.blankRatio;
        if (drawn.chars && drawn.rows) {
          this.seen.chars += drawn.chars;
          this.seen.rows += drawn.rows;
        }
        const now = this.seen.rows ? this.seen.chars / this.seen.rows : drawn.rowChars;
        const was = this.rowChars;
        if (!now || (was && Math.abs(now - was) / was < 0.05)) return;
        this.rowChars = now;
        // The whole story guessed again with the rows as drawn: CodeMirror does so when the line
        // height it measures differs from the one it has. A few times at most for a view.
        const oracle = oracleOf(this.view) as
          | (Oracle & { heightSamples?: Record<string, boolean> })
          | undefined;
        if (!oracle || this.remade >= 3) return;
        this.remade++;
        oracle.heightSamples = {};
        oracle.lineHeight += 1;
        this.view.requestMeasure();
      },
    });
  }
}

export const storyHeights = ViewPlugin.fromClass(StoryHeights);
