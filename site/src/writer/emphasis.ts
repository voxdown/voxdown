/**
 * Emphasis as it is written (§11): `*words*` and `_words_` in italics, `**words**` and `__words__`
 * in bold, their signs faint; and Ctrl+I and Ctrl+B to put the signs in or take them out. Read one
 * line at a time, only where the page shows, so a long book costs no more than a short one.
 */
import {
  ChangeSet,
  type ChangeSpec,
  EditorSelection,
  type EditorState,
  type Extension,
  type SelectionRange,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

/** A stretch of emphasis in a line: where it starts and ends, signs included, and how wide they are. */
export type Emphasis = { from: number; to: number; sign: number; strong: boolean };

// Bold first, so that `**words**` isn't read as italics twice. A sign after a backslash is text;
// `_` within a word (a name such as `@Big_Bad_Wolf`, an address) is no emphasis.
const STRONG =
  /(?<!\\)(?:\*\*(?=[^\s*])(.+?)(?<=[^\s\\*])\*\*|(?<![\w_])__(?=[^\s_])(.+?)(?<=[^\s\\_])__(?![\w_]))/gu;
const EM =
  /(?<![\\*])\*(?=[^\s*])(.+?)(?<=[^\s\\*])\*(?!\*)|(?<![\\\w_])_(?=[^\s_])(.+?)(?<=[^\s\\_])_(?![\w_])/gu;

export function emphasisIn(line: string): Emphasis[] {
  const found: Emphasis[] = [];
  let rest = line;
  for (const match of line.matchAll(STRONG)) {
    found.push({ from: match.index, to: match.index + match[0].length, sign: 2, strong: true });
    // The bold signs are read no further: blanked out, the italics in between are still found.
    const end = match.index + match[0].length;
    rest = `${rest.slice(0, match.index)}\0\0${rest.slice(match.index + 2, end - 2)}\0\0${rest.slice(end)}`;
  }
  for (const match of rest.matchAll(EM))
    found.push({ from: match.index, to: match.index + match[0].length, sign: 1, strong: false });
  return found.sort((a, b) => a.from - b.from);
}

const em = Decoration.mark({ class: "vxd-em" });
const strong = Decoration.mark({ class: "vxd-strong" });
const sign = Decoration.mark({ class: "vxd-em-sign" });

/**
 * Where the front matter ends, read from the text itself: drawing happens while the page updates,
 * when nothing else may be asked of it. A front matter never closed is read as none.
 */
export function frontMatterEnd(state: EditorState): number {
  const doc = state.doc;
  if (doc.lines < 2 || doc.line(1).text.trimEnd() !== "---") return 0;
  for (let number = 2; number <= Math.min(doc.lines, 2000); number++) {
    const text = doc.line(number).text.trimEnd();
    if (text === "---" || text === "...") return doc.line(number).to;
  }
  return 0;
}

function draw(view: EditorView): DecorationSet {
  const { state } = view;
  const start = frontMatterEnd(state);
  const marks = [];
  for (const { from, to } of view.visibleRanges) {
    let at = Math.max(from, start);
    while (at <= to) {
      const line = state.doc.lineAt(at);
      if (/[*_]/.test(line.text)) {
        for (const found of emphasisIn(line.text)) {
          const a = line.from + found.from;
          const b = line.from + found.to;
          marks.push(
            sign.range(a, a + found.sign),
            (found.strong ? strong : em).range(a + found.sign, b - found.sign),
            sign.range(b - found.sign, b),
          );
        }
      }
      at = line.to + 1;
    }
  }
  return Decoration.set(marks, true);
}

/** Emphasis drawn, after the front matter. */
export function emphasis(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = draw(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) this.decorations = draw(update.view);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

/** Quote marks that open, each with the one that closes it. */
const PAIRS: Record<string, string> = { "“": "”", "‘": "’", "«": "»", "„": "“", '"': '"' };

/**
 * The words in `from`–`to` that emphasis can go around, as the format reads it (§11): after a
 * heading's `#` and a speaker's name and direction, inside the quote marks of a whole quote, and
 * without a sound, an instruction or a note at either end. Signs around `@Ann “Hi.”` are lost to
 * both the book and the script; inside the quote marks, both keep them. Undefined where there are
 * no words: a scene break, a page turn, a group's fence.
 */
export function wordsIn(
  state: EditorState,
  from: number,
  to: number,
): { from: number; to: number } | undefined {
  const line = state.doc.lineAt(from);
  if (/^\s*:::/.test(line.text)) return undefined;
  let text = state.sliceDoc(from, to);
  let start = from;
  const cut = (pattern: RegExp, atStart: boolean) => {
    const found = pattern.exec(text);
    if (!found || found[0].length === 0) return false;
    if (atStart) {
      start += found[0].length;
      text = text.slice(found[0].length);
    } else text = text.slice(0, text.length - found[0].length);
    return true;
  };
  if (from === line.from) cut(/^\s*#{1,6}[ \t]+/u, true);
  const leading = [
    /^\s+/u,
    /^@[\p{L}\p{N}_'’-]*\s*(?:\([^()\n]*\)\s*)?/u,
    /^\[[^\]\n]*\]/u,
    /^\{[^}\n]*\}/u,
    /^%%.*?%%/u,
  ];
  const trailing = [/\s+$/u, /\[[^\]\n]*\]$/u, /\{[^}\n]*\}$/u, /%%.*?%%$/u];
  // Cut where one passage ends and the next begins, a quote's own mark can be left at an edge:
  // a closing one first (`” said Alice`), an opening one last. It stays outside the signs.
  leading.push(/^[”»](?=\s|$)/u, /^’(?=\s)/u);
  // And the next speaker's name and direction, where the narration before them was cut.
  trailing.push(/[“«„]$/u, /@[\p{L}\p{N}_'’-]*\s*(?:\([^()\n]*\)\s*)?$/u);
  while (leading.some((pattern) => cut(pattern, true)));
  while (trailing.some((pattern) => cut(pattern, false)));
  // A quote's words up to where its passage was cut: its opening mark outside the signs too.
  const opener = PAIRS[text[0] ?? ""];
  if (opener && !text.slice(1).includes(opener) && /\p{L}/u.test(text.slice(1))) cut(/^./u, true);
  const last = text.at(-1) ?? "";
  if (/[”»]/.test(last) && !/[“«„]/.test(text)) cut(/.$/u, false);
  // A whole quote: its words, inside its marks. Not two quotes with words between them.
  const close = PAIRS[text[0] ?? ""];
  if (close && text.length > 2 && text.endsWith(close)) {
    const inside = text.slice(1, -1);
    const apostrophe = close === "’" ? /’(?=\p{L})/gu : /$^/u;
    if (!inside.includes(text[0] as string) && !inside.replace(apostrophe, "").includes(close)) {
      start += 1;
      text = inside;
    }
  }
  if (!/[\p{L}\p{N}]/u.test(text)) return undefined;
  return { from: start, to: start + text.length };
}

/**
 * Italics (`*`) or bold (`**`) put around the selection, or the word at the cursor, or taken away
 * where they are already; with no word at the cursor, the signs go in with the cursor between.
 * Emphasis is read a line at a time (§11): over several lines, each line's words get their own
 * signs, and taken away when every line has them; lines with no words are left alone.
 */
export function toggleEmphasis(
  strongly: boolean,
  /** Why the signs can't go around `from`–`to` (inside a mark), if they can't. */
  refuse?: (state: EditorState, from: number, to: number) => string | undefined,
  /** Says why nothing was done. */
  tell?: (message: string) => void,
  /** Where one passage ends and the next begins within `from`–`to`: each gets its own signs. */
  edges?: (state: EditorState, from: number, to: number) => number[],
) {
  return (view: EditorView): boolean => {
    const { state } = view;
    if (state.readOnly) return true;
    const width = strongly ? 2 : 1;
    const signs = strongly ? ["**", "__"] : ["*", "_"];
    // How many of a sign's characters run right before `at` (back) or right after it.
    const run = (at: number, back: boolean, char: string) => {
      let count = 0;
      while (count < 3) {
        const from = back ? at - count - 1 : at + count;
        if (from < 0 || state.sliceDoc(from, from + 1) !== char) break;
        count++;
      }
      return count;
    };
    // Bold has two signs or more on each side, italics one or three.
    const has = (count: number) => (strongly ? count >= 2 : count % 2 === 1);
    /**
     * The signs already around `from`–`to`: just outside the words, selected with them, or
     * selected on one side only (`for him* `, as a drag picks it up). Their changes to take
     * them away.
     */
    const signsAround = (from: number, to: number): ChangeSpec[] | undefined => {
      let a = from;
      let b = to;
      while (a < b && /[*_]/.test(state.sliceDoc(a, a + 1))) a++;
      while (b > a && /[*_]/.test(state.sliceDoc(b - 1, b))) b--;
      if (a === b) return undefined;
      for (const written of signs) {
        const char = written[0] as string;
        if (has(run(a, true, char)) && has(run(b, false, char)))
          return [
            { from: a - width, to: a },
            { from: b, to: b + width },
          ];
      }
      return undefined;
    };
    /** Emphasis in the line holding `at`, in the document's places: of this kind, or any. */
    const emphasisAround = (at: number) => {
      const line = state.doc.lineAt(at);
      if (!/[*_]/.test(line.text)) return [];
      return emphasisIn(line.text).map((found) => ({
        from: line.from + found.from,
        to: line.from + found.to,
        strong: found.strong,
      }));
    };
    const kindAround = (at: number) =>
      emphasisAround(at).filter((found) => found.strong === strongly);
    /** A stretch of one line, cut where a passage ends, each part narrowed to its words. */
    const words = (from: number, to: number, exact: boolean) => {
      const cuts = (edges?.(state, from, to) ?? []).filter((cut) => cut > from && cut < to);
      const stops = [from, ...cuts.sort((x, y) => x - y), to];
      const out: { from: number; to: number }[] = [];
      for (let at = 0; at + 1 < stops.length; at++) {
        const found = wordsIn(state, stops[at] as number, stops[at + 1] as number);
        if (found) out.push(found);
      }
      return out.length || !exact ? out : [{ from, to }];
    };
    /** Where the signs go for a range: its word, its words, or each of its lines' words. */
    const piecesOf = (range: SelectionRange): { from: number; to: number }[] => {
      if (range.empty) {
        const word = state.wordAt(range.from);
        return [word ? { from: word.from, to: word.to } : { from: range.from, to: range.to }];
      }
      const first = state.doc.lineAt(range.from);
      const last = state.doc.lineAt(range.to);
      if (first.number === last.number) return words(range.from, range.to, true);
      const pieces = [];
      for (let number = first.number; number <= last.number; number++) {
        const line = state.doc.line(number);
        pieces.push(...words(Math.max(line.from, range.from), Math.min(line.to, range.to), false));
      }
      return pieces;
    };
    const pieces = state.selection.ranges.map(piecesOf);
    for (const piece of pieces.flat()) {
      const why = refuse?.(state, piece.from, piece.to);
      if (why) {
        tell?.(why);
        return true;
      }
    }
    if (pieces.every((each) => each.length === 0)) {
      tell?.("There are no words here for italics or bold.");
      return true;
    }
    /**
     * The signs put around a piece: over emphasis of the same kind that it runs into, one pair
     * around the whole (`*Already partly* emphasised`, never signs within signs); inside one,
     * that emphasis taken away.
     */
    const wrap = (piece: { from: number; to: number }): ChangeSpec[] => {
      const written = signs[0] as string;
      let from = piece.from;
      let to = piece.to;
      // A stretch of the other kind that the piece starts or ends inside is taken in whole: signs
      // never cross (`**bold *start** more*`); one inside, or around it, nests as it should.
      for (const other of emphasisAround(piece.from)) {
        if (other.strong === strongly) continue;
        if (other.from < from && from < other.to && other.to < to) from = other.from;
        if (from < other.from && other.from < to && to < other.to) to = other.to;
      }
      const inner: ChangeSpec[] = [];
      for (const found of kindAround(piece.from)) {
        if (found.to <= from || found.from >= to) continue;
        if (found.from <= from && to <= found.to)
          return [
            { from: found.from, to: found.from + width },
            { from: found.to - width, to: found.to },
          ];
        from = Math.min(from, found.from);
        to = Math.max(to, found.to);
        inner.push(
          { from: found.from, to: found.from + width },
          { from: found.to - width, to: found.to },
        );
      }
      // Signs already at the new ends stay; those within go.
      const kept = inner.filter(
        (change) =>
          (change as { from: number }).from !== from && (change as { to: number }).to !== to,
      );
      const opens = inner.some((change) => (change as { from: number }).from === from);
      const closes = inner.some((change) => (change as { to: number }).to === to);
      return [
        ...(opens ? [] : [{ from, insert: written }]),
        ...kept,
        ...(closes ? [] : [{ from: to, insert: written }]),
      ];
    };
    let index = 0;
    view.dispatch(
      state.changeByRange((range) => {
        const mine = pieces[index++] ?? [];
        // The word at the cursor: as it always was.
        if (range.empty) {
          const { from, to } = mine[0] ?? { from: range.from, to: range.to };
          const written = signs[0] as string;
          const there = signsAround(from, to);
          if (!there && from === to)
            return {
              changes: { from, insert: written + written },
              range: EditorSelection.cursor(from + width),
            };
          const set = ChangeSet.of(there ?? wrap({ from, to }), state.doc.length);
          return {
            changes: set,
            range: EditorSelection.cursor(set.mapPos(range.head, range.head <= from ? 1 : -1)),
          };
        }
        // Taken away if every piece has them, else put around those that don't.
        const found = mine.map((piece) => signsAround(piece.from, piece.to));
        const removing = found.every(Boolean);
        const changes: ChangeSpec[] = removing
          ? found.flatMap((there) => there ?? [])
          : mine.flatMap((piece, at) => (found[at] ? [] : wrap(piece)));
        const set = ChangeSet.of(changes, state.doc.length);
        // The words stay selected: on one line exactly the words the signs went around (so the
        // same keys take them away again), over several the whole, signs and all.
        const only = mine.length === 1 ? mine[0] : undefined;
        const oneLine = state.doc.lineAt(range.from).number === state.doc.lineAt(range.to).number;
        if (only && oneLine) {
          const from = set.mapPos(only.from, 1);
          const to = set.mapPos(only.to, -1);
          return {
            changes: set,
            range:
              range.anchor <= range.head
                ? EditorSelection.range(from, to)
                : EditorSelection.range(to, from),
          };
        }
        const forward = range.anchor <= range.head;
        return {
          changes: set,
          range: EditorSelection.range(
            set.mapPos(range.anchor, forward ? -1 : 1),
            set.mapPos(range.head, forward ? 1 : -1),
          ),
        };
      }),
      { userEvent: "input.format" },
    );
    return true;
  };
}

/** Text without its emphasis signs: `*very*` is `very`, for a spreadsheet or a speech engine. */
export function plainText(text: string): string {
  const signs = new Set<number>();
  for (const found of emphasisIn(text))
    for (let i = 0; i < found.sign; i++) {
      signs.add(found.from + i);
      signs.add(found.to - 1 - i);
    }
  // Places count UTF-16 units, as the text's own indices do.
  return text
    .split("")
    .filter((_, index) => !signs.has(index))
    .join("");
}
