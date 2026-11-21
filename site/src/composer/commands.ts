import {
  type Fraction,
  type NoteToken,
  accidentalText,
  accidentalValue,
  alterationOf,
  formatLength,
  frac,
  midiOf,
  mul,
  octaveOf,
  parseLength,
  spell,
  transposeChordSymbol,
  writePitch,
} from "./abc";
import { type FileIndex, indexFile } from "./tunes";
import { type MusicEvent, tuneItems, walkTune } from "./walk";

export type Range = { from: number; to: number };
export type Change = { from: number; to: number; insert: string };

const within = (ranges: Range[], from: number, to: number) =>
  ranges.some((range) => from >= range.from && to <= range.to && to > from);
const touches = (ranges: Range[], from: number, to: number) =>
  ranges.some((range) => from < range.to && to > range.from);

/** An empty range (a caret) stands for the note, chord or rest it is in or just after. */
export function resolveRanges(text: string, ranges: Range[], file = indexFile(text)): Range[] {
  return ranges.map((range) => {
    if (range.from !== range.to) return range;
    const tune = file.tunes.find((each) => range.from >= each.bodyFrom && range.from <= each.to);
    if (!tune) return range;
    let found: MusicEvent | undefined;
    for (const item of tuneItems(text, tune, file)) {
      if (item.type !== "event") continue;
      if (item.from <= range.from && range.from < item.to) {
        found = item;
        break;
      }
      if (item.to === range.from) found = item;
    }
    return found ? { from: found.from, to: found.to } : range;
  });
}

function tunesTouched(file: FileIndex, ranges: Range[]) {
  return file.tunes.filter((tune) =>
    ranges.some((range) => range.from < tune.to && range.to > tune.bodyFrom),
  );
}

function noteText(note: NoteToken, letter: string, octave: number, accidental: string): string {
  const pitch = writePitch(letter, octave);
  // Inside a grace group or chord the case still carries the octave, so the same rule applies.
  return `${accidental}${pitch}${note.length}`;
}

/**
 * Transposes every note inside `ranges` by `semitones`, spelling new notes for the key in force
 * (its own scale first, then naturals, then the key's sharps or flats). Notes after a changed one
 * in the same bar are re-spelled only when a written accidental would otherwise change them.
 */
export function transpose(
  text: string,
  selection: Range[],
  semitones: number,
  file = indexFile(text),
): Change[] {
  const changes: Change[] = [];
  const octaveOnly = semitones % 12 === 0;
  const ranges = resolveRanges(text, selection, file);
  for (const tune of tunesTouched(file, ranges)) {
    const output = new Map<string, Map<string, number>>();
    const dirty = new Map<string, boolean>();
    walkTune(text, tune, file, (token, state) => {
      let bar = output.get(state.voice);
      if (!bar) {
        bar = new Map();
        output.set(state.voice, bar);
      }
      if (token.kind === "bar") {
        output.set(state.voice, new Map());
        dirty.set(state.voice, false);
        return;
      }
      if (token.kind === "chord-symbol" && within(ranges, token.from, token.to) && !octaveOnly) {
        const symbol = token.text.slice(1, -1);
        const moved = transposeChordSymbol(symbol, semitones, state.key);
        if (moved !== symbol)
          changes.push({ from: token.from + 1, to: token.to - 1, insert: moved });
        return;
      }
      if (token.kind !== "note") return;
      const selected = within(ranges, token.from, token.to);
      const { alter } = alterationOf(token, state.key, state.bar);
      const octave = octaveOf(token.letter, token.octave);
      const place = (letter: string, octaveNumber: number) =>
        `${letter.toUpperCase()}${octaveNumber}`;
      if (!selected) {
        if (dirty.get(state.voice)) {
          const implied =
            bar.get(place(token.letter, octave)) ??
            state.key.accidentals[token.letter.toUpperCase()] ??
            0;
          if (implied !== alter) {
            const accidental = accidentalText(alter);
            changes.push({
              from: token.from,
              to: token.from + token.accidental.length,
              insert: accidental,
            });
            bar.set(place(token.letter, octave), alter);
            return;
          }
        }
        if (token.accidental)
          bar.set(place(token.letter, octave), accidentalValue(token.accidental));
        return;
      }
      const midi = midiOf(token.letter, octave, alter) + semitones;
      const spelled = octaveOnly
        ? { letter: token.letter.toUpperCase(), alter, octave: octave + semitones / 12 }
        : spell(midi, state.key, state.key.flats || (state.key.fifths === 0 && semitones < 0));
      if (spelled.octave < 0 || spelled.octave > 9) return;
      const implied =
        bar.get(place(spelled.letter, spelled.octave)) ??
        state.key.accidentals[spelled.letter] ??
        0;
      let accidental = "";
      if (implied !== spelled.alter) {
        accidental = accidentalText(spelled.alter);
        bar.set(place(spelled.letter, spelled.octave), spelled.alter);
      } else if (token.accidental && octaveOnly) accidental = token.accidental;
      const replacement = noteText(token, spelled.letter, spelled.octave, accidental);
      if (replacement !== token.text)
        changes.push({ from: token.from, to: token.to, insert: replacement });
      dirty.set(state.voice, true);
    });
  }
  return merge(changes);
}

/** The length tokens a selection owns: notes and rests, or a chord's outer length. */
function lengthTargets(text: string, ranges: Range[], file: FileIndex) {
  const targets: { from: number; to: number; length: string }[] = [];
  for (const tune of tunesTouched(file, ranges)) {
    let chord: { from: number; notes: NoteToken[] } | null = null;
    let grace = false;
    walkTune(text, tune, file, (token) => {
      if (token.kind === "grace-open") grace = true;
      if (token.kind === "grace-close") grace = false;
      if (grace) return;
      if (token.kind === "chord-open") chord = { from: token.from, notes: [] };
      else if (token.kind === "note" && chord) chord.notes.push(token);
      else if (token.kind === "chord-close" && chord) {
        const open = chord as { from: number; notes: NoteToken[] };
        chord = null;
        if (!touches(ranges, open.from, token.to)) return;
        if (token.length || !open.notes.some((note) => note.length))
          targets.push({
            from: token.lengthFrom ?? token.to,
            to: token.to,
            length: token.length ?? "",
          });
        else
          for (const note of open.notes)
            targets.push({ from: note.lengthFrom, to: note.to, length: note.length });
      } else if (
        (token.kind === "note" || (token.kind === "rest" && /[zx]/.test(token.letter))) &&
        !chord
      ) {
        if (touches(ranges, token.from, token.to))
          targets.push({ from: token.lengthFrom, to: token.to, length: token.length });
      }
    });
  }
  return targets;
}

/** Multiplies each selected length: ×2 doubles, ×½ halves, ×3/2 adds a dot. */
export function scaleLengths(
  text: string,
  ranges: Range[],
  factor: Fraction,
  file = indexFile(text),
): Change[] {
  const changes: Change[] = [];
  for (const target of lengthTargets(text, resolveRanges(text, ranges, file), file)) {
    const next = formatLength(mul(parseLength(target.length), factor));
    if (next !== target.length) changes.push({ from: target.from, to: target.to, insert: next });
  }
  return merge(changes);
}

/** Removes one dot where a length has one (3/2 → 1, 3 → 2, 3/4 → 1/2); others stay. */
export function removeDots(text: string, ranges: Range[], file = indexFile(text)): Change[] {
  const changes: Change[] = [];
  for (const target of lengthTargets(text, resolveRanges(text, ranges, file), file)) {
    const length = parseLength(target.length);
    if (length.num % 3 !== 0) continue;
    const next = formatLength(mul(length, frac(2, 3)));
    if (next !== target.length) changes.push({ from: target.from, to: target.to, insert: next });
  }
  return merge(changes);
}

/** The notes, chords and rests a selection covers (or the one at the caret). */
export function eventsIn(text: string, ranges: Range[], file = indexFile(text)): MusicEvent[] {
  const events: MusicEvent[] = [];
  for (const tune of file.tunes) {
    if (!ranges.some((range) => range.from <= tune.to && range.to >= tune.bodyFrom)) continue;
    for (const item of tuneItems(text, tune, file))
      if (
        item.type === "event" &&
        ranges.some((range) =>
          range.from === range.to
            ? range.from >= item.from && range.from <= item.to
            : item.from < range.to && item.to > range.from,
        )
      )
        events.push(item);
  }
  return events;
}

/** Ties each selected note to the next (or removes the ties when all have one). */
/** Every note's sounding MIDI pitch in the tunes a selection touches, keyed by its offset. */
function pitchesOf(text: string, ranges: Range[], file: FileIndex): Map<number, number> {
  const pitches = new Map<number, number>();
  for (const tune of file.tunes) {
    if (!ranges.some((range) => range.from <= tune.to && range.to >= tune.bodyFrom)) continue;
    walkTune(text, tune, file, (token, state) => {
      if (token.kind !== "note") return;
      const { alter } = alterationOf(token, state.key, state.bar);
      pitches.set(token.from, midiOf(token.letter, octaveOf(token.letter, token.octave), alter));
    });
  }
  return pitches;
}

export type TieResult = { changes: Change[]; reason?: string };

/**
 * Ties notes to the next note of the same pitch in their voice. In a selection, each note tied
 * to an equal neighbour (or untied, when all already are); with none, the last selected note (or
 * the note at the caret) to the note after it, when that note has the same pitch.
 */
export function toggleTies(text: string, ranges: Range[], file = indexFile(text)): TieResult {
  const pitches = pitchesOf(text, ranges, file);
  const all: MusicEvent[] = [];
  for (const tune of file.tunes)
    if (ranges.some((range) => range.from <= tune.to && range.to >= tune.bodyFrom))
      for (const item of tuneItems(text, tune, file)) if (item.type === "event") all.push(item);
  const set = (event: MusicEvent) =>
    new Set(
      event.notes.map((note) => pitches.get(note.from)).filter((pitch) => pitch !== undefined),
    );
  const same = (a: MusicEvent, b: MusicEvent) => {
    if (a.rest || b.rest) return false;
    const right = set(b);
    return [...set(a)].some((pitch) => right.has(pitch));
  };
  // Within one voice, text order is time order.
  const next = (event: MusicEvent) =>
    all.find((each) => each.voice === event.voice && each.from >= event.to);
  const tied = (event: MusicEvent) => text[event.to] === "-";
  const toggle = (targets: MusicEvent[]): Change[] => {
    const allTied = targets.every(tied);
    return targets
      .filter((event) => (allTied ? tied(event) : !tied(event)))
      .map((event) =>
        allTied
          ? { from: event.to, to: event.to + 1, insert: "" }
          : { from: event.to, to: event.to, insert: "-" },
      );
  };
  const selected = eventsIn(text, ranges, file).filter((event) => !event.rest);
  const caret = ranges.every((range) => range.from === range.to);
  if (!selected.length)
    return { changes: [], reason: "Put the caret on a note, or select notes, to tie them." };
  if (!caret) {
    const pairs = selected.filter((event) => {
      const following = next(event);
      return (
        following && selected.some((each) => each.from === following.from) && same(event, following)
      );
    });
    if (pairs.length) return { changes: toggle(pairs) };
  }
  const last = selected[selected.length - 1] as MusicEvent;
  if (tied(last)) return { changes: toggle([last]) };
  const following = next(last);
  if (!following || following.rest)
    return {
      changes: [],
      reason:
        "A tie joins a note to the next one of the same pitch, and there is no note after this one.",
    };
  if (!same(last, following))
    return {
      changes: [],
      reason:
        "A tie joins a note to the next one of the same pitch; the next note here has a different pitch. Use a slur for different notes.",
    };
  return { changes: toggle([last]) };
}

/** Wraps each selection in a slur, or removes the slur that already wraps it. */
export function toggleSlur(text: string, ranges: Range[], file = indexFile(text)): Change[] {
  const changes: Change[] = [];
  for (const range of ranges) {
    const events = eventsIn(text, [range], file);
    if (events.length === 0) continue;
    const first = events[0] as MusicEvent;
    const last = events[events.length - 1] as MusicEvent;
    if (text[first.from - 1] === "(" && text[last.to] === ")")
      changes.push(
        { from: first.from - 1, to: first.from, insert: "" },
        { from: last.to, to: last.to + 1, insert: "" },
      );
    else if (text[first.from] === "(" && text[last.to - 1] === ")")
      changes.push(
        { from: first.from, to: first.from + 1, insert: "" },
        { from: last.to - 1, to: last.to, insert: "" },
      );
    else
      changes.push(
        { from: first.from, to: first.from, insert: "(" },
        { from: trimEnd(text, last.to), to: trimEnd(text, last.to), insert: ")" },
      );
  }
  return merge(changes);
}

function trimEnd(text: string, to: number): number {
  let end = to;
  while (end > 0 && /\s/.test(text[end - 1] as string)) end -= 1;
  return end;
}

/** Adds a decoration before each selected note (or the note at the caret). */
/** Shorthands written bare; every named decoration, p and f included, is written !name!. */
const BARE_DECORATIONS = new Set([".", "~"]);
export function decorationMark(name: string): string {
  return BARE_DECORATIONS.has(name) ? name : `!${name}!`;
}

export function decorate(
  text: string,
  ranges: Range[],
  decoration: string,
  file = indexFile(text),
): Change[] {
  const mark = decorationMark(decoration);
  return eventsIn(text, ranges, file)
    .filter(
      (event) =>
        text.slice(Math.max(0, event.from - mark.length), event.from) !== mark &&
        !text.startsWith(mark, event.from),
    )
    .map((event) => ({ from: event.from, to: event.from, insert: mark }));
}

/** Text of the bar around a position: from after the previous bar line to after the next. */
export function barAround(text: string, position: number): Range {
  const lineFrom = text.lastIndexOf("\n", position - 1) + 1;
  let lineTo = text.indexOf("\n", position);
  if (lineTo < 0) lineTo = text.length;
  const line = text.slice(lineFrom, lineTo);
  const bars = [...line.matchAll(/:*\|+[\]:0-9]*|\[\|/g)].map((match) => ({
    from: lineFrom + (match.index ?? 0),
    to: lineFrom + (match.index ?? 0) + match[0].length,
  }));
  let from = lineFrom;
  let to = lineTo;
  for (const bar of bars) {
    if (bar.to <= position) from = bar.to;
    else if (bar.from >= position || bar.to > position) {
      to = bar.to;
      break;
    }
  }
  while (from < to && text[from] === " ") from += 1;
  return { from, to };
}

/** Puts a copy of the selection (or the bar at the caret) right after it. */
export function duplicate(text: string, ranges: Range[]): Change[] {
  return ranges.map((range) => {
    const target = range.from === range.to ? barAround(text, range.from) : range;
    const body = text.slice(target.from, target.to);
    const glue = /\s$/.test(body) ? "" : " ";
    return { from: target.to, to: target.to, insert: `${glue}${body}` };
  });
}

/** A bar line at the caret, spaced like the music around it. */
export function barLine(text: string, position: number): Change {
  const before = text[position - 1] ?? "\n";
  const after = text[position] ?? "\n";
  const lead = /[\s|]/.test(before) ? "" : " ";
  const tail = /\s/.test(after) ? "" : " ";
  return { from: position, to: position, insert: `${lead}|${tail}` };
}

export function newTuneTemplate(number: number, title = "Untitled tune"): string {
  return `X:${number}\nT:${title}\nM:4/4\nL:1/8\nQ:1/4=100\nK:C\n`;
}

function merge(changes: Change[]): Change[] {
  return changes
    .sort((a, b) => a.from - b.from || a.to - b.to)
    .filter(
      (change, index, all) =>
        index === 0 || change.from >= (all[index - 1] as Change).to || change.from === change.to,
    );
}
