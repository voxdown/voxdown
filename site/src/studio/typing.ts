import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { isolateHistory } from "@codemirror/commands";
import {
  EditorSelection,
  EditorState,
  type Extension,
  MapMode,
  Prec,
  type StateCommand,
  StateEffect,
  StateField,
} from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { parsedSource } from "./syntax";

const noteClosers = StateEffect.define<number[]>({
  map: (positions, changes) => positions.map((pos) => changes.mapPos(pos, 1)),
});
const noteCloserState = StateField.define<number[]>({
  create: () => [],
  update(value, tr) {
    const next = value.flatMap((pos) => {
      const mapped = tr.changes.mapPos(pos, 1, MapMode.TrackDel);
      return mapped !== null && tr.newDoc.sliceString(mapped, mapped + 1) === "]" ? [mapped] : [];
    });
    for (const effect of tr.effects) if (effect.is(noteClosers)) next.push(...effect.value);
    const line = tr.newDoc.lineAt(tr.newSelection.main.head);
    return next.filter((pos) => pos >= line.from && pos <= line.to).slice(-100);
  },
});

/** Use the editor's tested pairing, selection wrapping, overtyping and IME behavior. */
export function smartPairs(onRefusal: () => void = () => {}): Extension {
  return [
    noteCloserState,
    Prec.highest(
      EditorView.inputHandler.of((view, from, to, text) => {
        if (
          view.compositionStarted ||
          view.state.readOnly ||
          from !== to ||
          text !== "]" ||
          !view.state.field(noteCloserState).includes(from)
        )
          return false;
        view.dispatch({ selection: { anchor: from + 1 }, userEvent: "select" });
        return true;
      }),
    ),
    Prec.highest(
      EditorView.inputHandler.of((view, from, to, text) => {
        if (view.compositionStarted || view.state.readOnly || (text !== "[" && text !== "("))
          return false;
        const parsed = parsedSource(view.state.doc);
        if (from !== to && parsed.omissions.some((span) => from < span.to && to > span.from)) {
          onRefusal();
          return true;
        }
        if (!parsed.omissions.some((span) => from > span.from && from < span.to)) return false;
        view.dispatch(
          view.state.update(view.state.replaceSelection(text), { userEvent: "input.type" }),
        );
        return true;
      }),
    ),
    closeBrackets(),
    keymap.of(closeBracketsKeymap),
    EditorState.languageData.of((state, pos) => {
      let backslashes = 0;
      for (let at = pos - 1; at >= 0 && state.sliceDoc(at, at + 1) === "\\"; at--) backslashes++;
      return [{ closeBrackets: { brackets: backslashes % 2 ? [] : ["(", "["] } }];
    }),
  ];
}

export type WritingMark = "bold" | "italic" | "underline" | "note";
const delimiters: Record<WritingMark, [string, string]> = {
  bold: ["**", "**"],
  italic: ["*", "*"],
  underline: ["_", "_"],
  note: ["[[", "]]"],
};

/** Keep the words selected; a second invocation removes the same surrounding marks. */
export function toggleWritingMark(mark: WritingMark): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    const parsed = parsedSource(state.doc);
    if (parsed.warnings.length) return false;
    if (
      state.selection.ranges.some((range) =>
        parsed.omissions.some((span) => {
          if (range.to <= span.from || range.from >= span.to) return false;
          const completeNote =
            mark === "note" &&
            span.kind === "note" &&
            ((range.from === span.from && range.to === span.to) ||
              (range.from === span.from + 2 && range.to === span.to - 2));
          return !completeNote;
        }),
      )
    )
      return false;
    if (
      mark !== "note" &&
      state.selection.ranges.some((range) => {
        const selected = state.sliceDoc(range.from, range.to).trim();
        const token = mark === "underline" ? "_" : "*";
        let first = 0;
        let last = selected.length;
        while (first < last && selected[first] === token) first++;
        while (last > first && selected[last - 1] === token) last--;
        const interior = selected.slice(first, last);
        return interior.includes(token);
      })
    )
      return false;
    if (
      mark === "note" &&
      !state.selection.ranges.every((range) => {
        if (
          [range.from, range.to].some((at) => {
            const split = state.sliceDoc(Math.max(0, at - 1), at + 1);
            return at > 0 && (split === "[[" || split === "]]");
          })
        )
          return false;
        const selected = state.sliceDoc(range.from, range.to);
        const outside =
          state.sliceDoc(Math.max(0, range.from - 2), range.from) === "[[" &&
          state.sliceDoc(range.to, range.to + 2) === "]]";
        const inside = selected.startsWith("[[") && selected.endsWith("]]");
        const words = inside ? selected.slice(2, -2) : selected;
        if (words.includes("[[") || words.includes("]]")) return false;
        let inNote = false;
        const prefix = state.sliceDoc(0, outside ? range.from - 2 : range.from);
        for (const match of prefix.matchAll(/\\[\s\S]|\[\[|\]\]/g)) {
          if (match[0] === "[[") inNote = true;
          if (match[0] === "]]") inNote = false;
        }
        return !inNote;
      })
    )
      return false;
    const [open, close] = delimiters[mark];
    const removedNotes = new Set<number>();
    const addedNotes: { from: number; to: number }[] = [];
    const changes = state.changeByRange((range) => {
      let { from, to } = range;
      if (!range.empty && mark !== "note") {
        const raw = state.sliceDoc(from, to);
        from += raw.length - raw.trimStart().length;
        to = Math.max(from, to - (raw.length - raw.trimEnd().length));
      }
      const selected = state.sliceDoc(from, to);
      const escaped = (position: number) => {
        let slashes = 0;
        for (let at = position - 1; at >= 0 && state.sliceDoc(at, at + 1) === "\\"; at--) slashes++;
        return slashes % 2 === 1;
      };
      const starRun = (position: number, direction: number) => {
        let count = 0;
        let at = position;
        while (at >= 0 && at < state.doc.length && state.sliceDoc(at, at + 1) === "*") {
          count++;
          at += direction;
        }
        return count;
      };
      const outside =
        from >= open.length &&
        !escaped(from - open.length) &&
        !escaped(to) &&
        state.sliceDoc(from - open.length, from) === open &&
        state.sliceDoc(to, to + close.length) === close &&
        (mark !== "italic" || (starRun(from - 1, -1) % 2 === 1 && starRun(to, 1) % 2 === 1));
      const inside =
        selected.length >= open.length + close.length &&
        !escaped(from) &&
        !escaped(to - close.length) &&
        selected.startsWith(open) &&
        selected.endsWith(close) &&
        !selected
          .slice(
            mark === "bold" || mark === "italic" ? starRun(from, 1) : open.length,
            -(mark === "bold" || mark === "italic" ? starRun(to - 1, -1) : close.length),
          )
          .includes(mark === "bold" || mark === "italic" ? "*" : close) &&
        (mark !== "italic" || (starRun(from, 1) % 2 === 1 && starRun(to - 1, -1) % 2 === 1));
      if (outside || inside) {
        const start = outside ? from - open.length : from;
        const end = outside ? to + close.length : to;
        const words = outside ? selected : selected.slice(open.length, -close.length);
        if (mark === "note") removedNotes.add(start);
        return {
          changes: { from: start, to: end, insert: words },
          range: EditorSelection.range(
            range.anchor <= range.head ? start : start + words.length,
            range.anchor <= range.head ? start + words.length : start,
          ),
        };
      }
      if (mark === "note") addedNotes.push({ from, to });
      return {
        changes: { from, to, insert: open + selected + close },
        effects: mark === "note" ? noteClosers.of([to + open.length, to + open.length + 1]) : [],
        range: EditorSelection.range(
          (range.anchor <= range.head ? from : to) + open.length,
          (range.anchor <= range.head ? to : from) + open.length,
        ),
      };
    });
    const transaction = state.update(changes, {
      scrollIntoView: true,
      userEvent: "input.format",
      annotations: isolateHistory.of("full"),
    });
    const candidate = parsedSource(transaction.newDoc);
    if (
      candidate.warnings.length ||
      candidate.omissions.length !== parsed.omissions.length - removedNotes.size + addedNotes.length
    )
      return false;
    const candidateSpans = new Set(
      candidate.omissions.map((span) => `${span.kind}:${span.from}:${span.to}`),
    );
    const hasSpan = (kind: string, from: number, to: number) =>
      candidateSpans.has(`${kind}:${from}:${to}`);
    if (
      parsed.omissions.some(
        (span) =>
          !removedNotes.has(span.from) &&
          !hasSpan(
            span.kind,
            transaction.changes.mapPos(span.from, 1),
            transaction.changes.mapPos(span.to, -1),
          ),
      )
    )
      return false;
    if (
      addedNotes.some(
        (span) =>
          !hasSpan(
            "note",
            transaction.changes.mapPos(span.from, -1),
            transaction.changes.mapPos(span.to, 1),
          ),
      )
    )
      return false;
    dispatch(transaction);
    return true;
  };
}
