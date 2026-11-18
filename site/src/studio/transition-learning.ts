import { EditorState, type Extension, RangeSet, RangeValue, StateField } from "@codemirror/state";
import { parseFountain } from "./fountain";
import { MAX_SOURCE } from "./source";
import { parsedSource } from "./syntax";

const phraseKey = (text: string) =>
  text
    .trim()
    .replace(/[ \t]+/g, " ")
    .normalize("NFC")
    .toUpperCase();
class TransitionHint extends RangeValue {
  constructor(readonly phrase: string) {
    super();
  }
}
function hint(text: string): TransitionHint | undefined {
  if (!text.trimStart().startsWith(">")) return;
  // This line-local index is only a candidate cache. Full current-source parsing
  // below verifies that the definition is public, rather than inside a comment.
  const parsed = parseFountain(text);
  const element = parsed.elements[0];
  if (element?.kind !== "transition" || parsed.warnings.length || !element.text.trim()) return;
  return new TransitionHint(phraseKey(element.text));
}
const transitionHints = StateField.define<RangeSet<TransitionHint>>({
  create(state) {
    const ranges = [];
    let from = 0;
    for (const text of state.doc.iterLines()) {
      const value = hint(text);
      if (value) ranges.push(value.range(from));
      from += text.length + 1;
    }
    return RangeSet.of(ranges);
  },
  update(value, tr) {
    if (!tr.docChanged) return value;
    let next = value.map(tr.changes);
    const regions: { from: number; to: number }[] = [];
    tr.changes.iterChangedRanges((_a, _b, from, to) => {
      const region = { from: tr.newDoc.lineAt(from).from, to: tr.newDoc.lineAt(to).to };
      const previous = regions.at(-1);
      if (previous && region.from <= previous.to + 1)
        previous.to = Math.max(previous.to, region.to);
      else regions.push(region);
    });
    for (const region of regions) {
      const additions = [];
      for (let line = tr.newDoc.lineAt(region.from); ; ) {
        const entry = hint(line.text);
        if (entry) additions.push(entry.range(line.from));
        if (line.to >= region.to) break;
        line = tr.newDoc.line(line.number + 1);
      }
      next = next.update({
        filterFrom: region.from,
        filterTo: region.to,
        filter: (from) => from < region.from || from > region.to,
        add: additions,
      });
    }
    return next;
  },
});

/** Learn from earlier explicit > transitions in this document only. Add the
 * standard marker as part of the same typing transaction, so undo is atomic and
 * every Fountain reader sees the same formatting. Loading/pasting a screenplay
 * never silently rewrites its existing paragraphs.
 */
export function learnTransitions(): Extension {
  return [
    transitionHints,
    EditorState.transactionFilter.of((tr) => {
      if (
        !tr.docChanged ||
        tr.startState.readOnly ||
        !(tr.isUserEvent("input.type") || tr.isUserEvent("input.paste")) ||
        tr.isUserEvent("input.type.compose") ||
        tr.newSelection.ranges.length !== 1 ||
        !tr.newSelection.main.empty
      )
        return tr;
      let multiline = false;
      tr.changes.iterChanges((_a, _b, _c, _d, inserted) => {
        if (inserted.lines > 1) multiline = true;
      });
      if (multiline || tr.newDoc.length + 2 > MAX_SOURCE) return tr;
      const line = tr.newDoc.lineAt(tr.newSelection.main.head);
      if (
        tr.newSelection.main.head !== line.to ||
        !line.text.trim() ||
        /^[.!@>#=~\\]/.test(line.text.trimStart())
      )
        return tr;
      if (
        (line.number > 1 && tr.newDoc.line(line.number - 1).text.trim()) ||
        (line.number < tr.newDoc.lines && tr.newDoc.line(line.number + 1).text.trim())
      )
        return tr;
      const phrase = phraseKey(line.text);
      let possible = false;
      const oldPosition = tr.changes.invertedDesc.mapPos(line.from);
      tr.startState.field(transitionHints).between(0, oldPosition, (from, _to, value) => {
        if (from < oldPosition && value.phrase === phrase) possible = true;
      });
      if (!possible) return tr;
      // Only an exact candidate pays for a current full parse. Ordinary keystrokes
      // use the small incremental index, not a scan of the whole screenplay.
      const parsed = parsedSource(tr.newDoc);
      if (
        parsed.warnings.some((warning) => warning.line <= line.number) ||
        parsed.elements[line.number - 1]?.kind !== "action"
      )
        return tr;
      const learned = parsed.elements.some(
        (element) =>
          element.line < line.number &&
          element.kind === "transition" &&
          phraseKey(element.text) === phrase &&
          tr.newDoc.line(element.line).text.trimStart().startsWith(">"),
      );
      if (!learned) return tr;
      const at = line.from + (line.text.match(/^[ \t]*/)?.[0].length ?? 0);
      return [tr, { changes: { from: at, insert: "> " }, sequential: true }];
    }),
  ];
}
