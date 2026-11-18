import { type Range, StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { type FountainDocument, parseFountain } from "./fountain";

import { fountainRuns } from "./inline";
import { characterName } from "./insights";

/** Stable colours survive reordering scenes and character cue extensions. */
export function speakerHue(cue: string): number {
  const name = characterName(
    fountainRuns(cue)
      .map((run) => run.text)
      .join(""),
  ).toUpperCase();
  let hash = 0;
  for (const char of name) hash = (Math.imul(hash, 31) + (char.codePointAt(0) ?? 0)) | 0;
  return ((hash % 360) + 360) % 360;
}

export const presentScreenplay = StateEffect.define<FountainDocument>();
const immediateLimit = 16_384;

function decorations(parsed: FountainDocument, margins: boolean, offset = 0): Range<Decoration>[] {
  const ranges: Range<Decoration>[] = [];
  let hue = 275;
  for (const element of parsed.elements) {
    const from = element.from + offset;
    if (from < 0) continue;
    if (element.kind === "character") hue = speakerHue(element.text);
    const speech = ["character", "dialogue", "parenthetical"].includes(element.kind);
    ranges.push(
      Decoration.line({
        attributes: speech ? { style: `--studio-speaker-hue: ${hue}` } : {},
        class: `syntax-${element.kind}${margins ? ` f-${element.kind}` : ""}${speech ? " studio-speech" : ""}${speech && margins ? " speech-margins" : ""}`,
      }).range(from),
    );
  }
  for (const span of parsed.omissions) {
    if (span.from + offset >= 0 && span.to > span.from)
      ranges.push(
        Decoration.mark({ class: "studio-comment" }).range(span.from + offset, span.to + offset),
      );
  }
  return ranges;
}

// Reclassify only the edited paragraph while the authoritative worker catches up.
// A bounded scan keeps an unfinished, book-length paragraph off the typing path.
function paragraph(
  doc: Text,
  start: number,
  end: number,
): { from: number; to: number } | undefined {
  let first = doc.lineAt(start);
  let last = doc.lineAt(end);
  let budget = 64;
  while (first.number > 1 && doc.line(first.number - 1).text.trim()) {
    if (--budget <= 0) return;
    first = doc.line(first.number - 1);
  }
  while (last.number < doc.lines && doc.line(last.number + 1).text.trim()) {
    if (--budget <= 0) return;
    last = doc.line(last.number + 1);
  }
  if (last.to - first.from > immediateLimit) return;
  return { from: first.from, to: last.to };
}

export function screenplayPresentation(margins: () => boolean) {
  return StateField.define<DecorationSet>({
    create(state) {
      return state.doc.length <= immediateLimit
        ? Decoration.set(decorations(parseFountain(state.doc.toString()), margins()), true)
        : Decoration.none;
    },
    update(value, tr) {
      for (const effect of tr.effects)
        if (effect.is(presentScreenplay))
          return Decoration.set(decorations(effect.value, margins()), true);
      if (!tr.docChanged) return value;
      const mapped = value.map(tr.changes);
      if (tr.newDoc.length <= immediateLimit)
        return Decoration.set(decorations(parseFountain(tr.newDoc.toString()), margins()), true);
      let start = tr.newDoc.length;
      let end = 0;
      tr.changes.iterChangedRanges((_a, _b, from, to) => {
        start = Math.min(start, from);
        end = Math.max(end, to);
      });
      const region = paragraph(tr.newDoc, start, end);
      if (!region) return mapped;
      let privateText = false;
      mapped.between(region.from, region.to, (_from, _to, decoration) => {
        if (decoration.spec.class === "studio-comment") privateText = true;
      });
      const fragment = tr.newDoc.sliceString(region.from, region.to);
      // Never infer syntax from a partial private span. The worker resolves these.
      if (privateText || /\[\[|\]\]|\/\*|\*\//.test(fragment)) return mapped;
      const prefix = region.from ? "!.\n\n" : "";
      const parsed = parseFountain(prefix + fragment);
      const additions = decorations(parsed, margins(), region.from - prefix.length).filter(
        (range) => range.from >= region.from,
      );
      return mapped.update({
        filterFrom: region.from,
        filterTo: region.to,
        filter: (from) => from < region.from || from > region.to,
        add: additions,
        sort: true,
      });
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}
