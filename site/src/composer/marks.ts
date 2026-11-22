/**
 * Where a mark from the decoration menu goes over a selection, as a musician expects (MuseScore
 * and Dorico do the same), by kind (loaded with the menu):
 * - a dynamic (p, mf, sfz…): on the first selected note of each voice; the same again takes it
 *   off, another replaces it;
 * - a hairpin (crescendo, diminuendo): `!<(!` on the first note and `!<)!` on the last, per
 *   voice; again over the same notes takes both off;
 * - a jump or place (segno, coda, D.C., D.S., Fine, To Coda): once, in the top voice: segno and
 *   coda at the start, the others at the end; again takes it off;
 * - a fermata: on the last note of each voice;
 * - articulations and ornaments (staccato, accent, trill, roll…): on every note, and off again
 *   when every note has one; never two on a note.
 */
import { type Change, type Range, decorationMark, guardMarks, prefixMarks } from "./commands";
import { type Picked, selectedNotes } from "./selected";
import { type FileIndex, indexFile } from "./tunes";

export type MarkPlan = { changes: Change[]; said: string } | { refused: string };

const DYNAMIC = /^(p{1,4}|f{1,4}|mp|mf|sfz?|sffz|fp|rfz)$/;
const HAIRPIN = new Set(["crescendo", "diminuendo"]);
const START = new Set(["segno", "coda"]);
const END = /^(D\.C\.|D\.S\.|fine|dacoda|dacapo)/;

/** The mark as written before a note, in every spelling it can have. */
const spellings = (name: string): string[] => {
  const full = `!${name}!`;
  if (name === "." || name === "staccato") return [".", "!staccato!"];
  if (name === "~" || name === "roll") return ["~", "!roll!"];
  return [full];
};
const has = (text: string, at: number, names: string[]) =>
  prefixMarks(text, at).filter((mark) => names.includes(mark.mark));

/** The selected notes by voice, in text order, the top voice (the tune's first) first. */
function byVoice(text: string, ranges: Range[], file: FileIndex): Picked[][] {
  const selected = ranges.filter((range) => range.to > range.from);
  const picked = selectedNotes(text, selected.length ? selected : ranges, file).filter(
    (each) => !each.event.rest,
  );
  const voices = new Map<string, Picked[]>();
  for (const each of picked) {
    const list = voices.get(each.event.voice) ?? [];
    list.push(each);
    voices.set(each.event.voice, list);
  }
  const tune = file.tunes.find(
    (each) => picked[0] && picked[0].event.from >= each.from && picked[0].event.from <= each.to,
  );
  const order = tune?.voices.map((voice) => voice.id) ?? [];
  return [...voices.entries()]
    .sort(([a], [b]) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999))
    .map(([, list]) => list);
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function placeMark(
  text: string,
  ranges: Range[],
  name: string,
  file: FileIndex = indexFile(text),
): MarkPlan {
  const voices = byVoice(text, ranges, file);
  if (!voices.length) return { refused: "Put the caret on a note, or select notes, to mark them." };
  const label = name === "." ? "Staccato" : name === "~" ? "Roll" : name;
  const changes: Change[] = [];
  const several = voices.length > 1;
  const where = (what: string) => (several ? `${what} of each voice` : what);
  if (DYNAMIC.test(name)) {
    let off = 0;
    for (const list of voices) {
      const first = list[0] as Picked;
      const there = prefixMarks(text, first.event.from).filter((mark) =>
        DYNAMIC.test(mark.mark.replace(/!/g, "")),
      );
      for (const mark of there) changes.push({ ...mark, insert: "" });
      if (there.some((mark) => mark.mark === `!${name}!`)) off += 1;
      else
        changes.push({
          from: first.event.from,
          to: first.event.from,
          insert: decorationMark(name),
        });
    }
    return {
      changes,
      said:
        off === voices.length
          ? `${name} taken off ${where("the first note")}.`
          : `${name} on ${where("the first note")}.`,
    };
  }
  if (HAIRPIN.has(name)) {
    const [open, close] = name === "crescendo" ? ["!<(!", "!<)!"] : ["!>(!", "!>)!"];
    const opens = name === "crescendo" ? ["!<(!", "!crescendo(!"] : ["!>(!", "!diminuendo(!"];
    const closes = name === "crescendo" ? ["!<)!", "!crescendo)!"] : ["!>)!", "!diminuendo)!"];
    if (voices.every((list) => list.length < 2))
      return { refused: `A ${name} goes over a stretch of notes: select them, then choose it.` };
    const lengths: number[] = [];
    let removed = 0;
    for (const list of voices) {
      if (list.length < 2) continue;
      const first = list[0] as Picked;
      const last = list[list.length - 1] as Picked;
      const started = has(text, first.event.from, opens);
      const ended = has(text, last.event.from, closes);
      if (started.length && ended.length) {
        for (const mark of [...started, ...ended]) changes.push({ ...mark, insert: "" });
        removed += 1;
      } else {
        changes.push({ from: first.event.from, to: first.event.from, insert: open });
        changes.push({ from: last.event.from, to: last.event.from, insert: close });
      }
      lengths.push(list.length);
    }
    const word = name === "crescendo" ? "Crescendo" : "Diminuendo";
    return {
      changes,
      said:
        removed === lengths.length
          ? `${word} taken off.`
          : `${word} over ${count(lengths[0] ?? 0, "note")}${several ? " in each voice" : ""}.`,
    };
  }
  if (START.has(name) || END.test(name)) {
    // Once, in the top voice: at the start for a segno or coda, at the end for the rest.
    const top = voices[0] as Picked[];
    const target = (START.has(name) ? top[0] : top[top.length - 1]) as Picked;
    const there = has(text, target.event.from, spellings(name));
    if (there.length) {
      for (const mark of there) changes.push({ ...mark, insert: "" });
      return { changes, said: `${label} taken off.` };
    }
    changes.push({ from: target.event.from, to: target.event.from, insert: decorationMark(name) });
    return {
      changes,
      said: `${label} ${START.has(name) ? "at the start" : "at the end"} of the selection${several ? ", in the top voice" : ""}.`,
    };
  }
  if (name === "fermata") {
    let off = 0;
    for (const list of voices) {
      const last = list[list.length - 1] as Picked;
      const there = has(text, last.event.from, ["!fermata!", "H"]);
      if (there.length) {
        for (const mark of there) changes.push({ ...mark, insert: "" });
        off += 1;
      } else changes.push({ from: last.event.from, to: last.event.from, insert: "!fermata!" });
    }
    return {
      changes,
      said:
        off === voices.length
          ? `Fermata taken off ${where("the last note")}.`
          : `Fermata on ${where("the last note")}.`,
    };
  }
  // Articulations and ornaments: every note, off again when every one has it.
  const notes = voices.flat();
  const forms = spellings(name);
  const marked = notes.map((each) => has(text, each.event.from, forms));
  if (marked.every((list) => list.length)) {
    for (const list of marked) for (const mark of list) changes.push({ ...mark, insert: "" });
    return { changes, said: `${label} taken off ${count(notes.length, "note")}.` };
  }
  const mark = decorationMark(name);
  notes.forEach((each, at) => {
    if (!(marked[at] as Range[]).length)
      changes.push({ from: each.event.from, to: each.event.from, insert: mark });
  });
  return {
    changes: guardMarks(text, changes, file),
    said: `${label} on ${count(notes.length, "note")}.`,
  };
}
