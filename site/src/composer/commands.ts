import {
  type Fraction,
  type Key,
  type MusicToken,
  type NoteToken,
  accidentalText,
  accidentalValue,
  alterationOf,
  formatLength,
  frac,
  lineKind,
  midiOf,
  mul,
  octaveOf,
  parseLength,
  prefersFlats,
  spell,
  tokenizeMusic,
  transposeChordSymbol,
  writePitch,
} from "./abc";
import { selectedNotes } from "./selected";
import { type FileIndex, indexFile } from "./tunes";
import { type MusicEvent, tuneItems, walkTune } from "./walk";

export type Range = { from: number; to: number };
export type Change = { from: number; to: number; insert: string };

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
  /** The key the notes are written in afterwards (Transpose to key… moves K: too). */
  written: (key: Key) => Key = (key) => key,
): Change[] {
  const changes: Change[] = [];
  const octaveOnly = semitones % 12 === 0;
  const ranges = resolveRanges(text, selection, file);
  // The one rule: the tones selected, and the grace notes and chord symbol written before a note
  // selected whole.
  const picked = selectedNotes(text, selection, file);
  const tones = new Set(picked.flatMap((each) => each.tones.map((tone) => tone.from)));
  const attached = picked
    .filter((each) => each.whole)
    .map((each) => ({ from: each.span.from, to: each.event.from }));
  const isAttached = (at: number) => attached.some((range) => at >= range.from && at < range.to);
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
      const key = written(state.key);
      if (token.kind === "chord-symbol" && isAttached(token.from) && !octaveOnly) {
        const symbol = token.text.slice(1, -1);
        const moved = transposeChordSymbol(symbol, semitones, key);
        if (moved !== symbol)
          changes.push({ from: token.from + 1, to: token.to - 1, insert: moved });
        return;
      }
      if (token.kind !== "note") return;
      const selected = tones.has(token.from) || (token.inGrace && isAttached(token.from));
      const { alter } = alterationOf(token, state.key, state.bar);
      const octave = octaveOf(token.letter, token.octave);
      const place = (letter: string, octaveNumber: number) =>
        `${letter.toUpperCase()}${octaveNumber}`;
      if (!selected) {
        if (dirty.get(state.voice)) {
          const implied =
            bar.get(place(token.letter, octave)) ??
            key.accidentals[token.letter.toUpperCase()] ??
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
        : spell(midi, key, prefersFlats(key, midi));
      if (spelled.octave < 0 || spelled.octave > 9) return;
      const implied =
        bar.get(place(spelled.letter, spelled.octave)) ?? key.accidentals[spelled.letter] ?? 0;
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
  // The one rule: the events selected (a chord's length is the chord's, even for one tone).
  const starts = new Set(selectedNotes(text, ranges, file).map((each) => each.event.from));
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
        if (!starts.has(open.from)) return;
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
        if (starts.has(token.from))
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
  // The one rule (./selected): a note is selected when a range touches it or what is attached.
  return selectedNotes(text, ranges, file).map((picked) => picked.event);
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
/**
 * A selection's passages: its ranges, with the ranges of one voice joined where its music goes on
 * from one to the next (a voice written in V: blocks is one passage across them). Each passage
 * has its ranges in text order and its first and last selected notes.
 */
export function passagesOf(text: string, ranges: Range[], file = indexFile(text)) {
  type Passage = {
    voice: string;
    ranges: Range[];
    first: MusicEvent;
    last: MusicEvent;
    end: number;
  };
  // Each event's written start and end, voice by voice.
  const times = new Map<number, { start: number; end: number }>();
  for (const tune of file.tunes) {
    if (!ranges.some((range) => range.from < tune.to && range.to > tune.bodyFrom)) continue;
    const clocks = new Map<string, number>();
    for (const item of tuneItems(text, tune, file)) {
      if (item.type !== "event") continue;
      const start = clocks.get(item.voice) ?? 0;
      const end = start + item.duration.num / item.duration.den;
      times.set(item.from, { start, end });
      clocks.set(item.voice, end);
    }
  }
  const passages: Passage[] = [];
  for (const range of [...ranges].sort((a, b) => a.from - b.from)) {
    if (range.to <= range.from) continue;
    const events = eventsIn(text, [range], file);
    const first = events[0];
    const last = events[events.length - 1];
    if (!first || !last) continue;
    const voices = new Set(events.map((event) => event.voice));
    const voice = voices.size === 1 ? first.voice : "";
    const begins = times.get(first.from)?.start ?? -1;
    const joined = passages.find(
      (each) => voice && begins >= 0 && each.voice === voice && Math.abs(each.end - begins) < 1e-6,
    );
    if (joined) {
      joined.ranges.push(range);
      joined.last = last;
      joined.end = times.get(last.from)?.end ?? joined.end;
    } else
      passages.push({ voice, ranges: [range], first, last, end: times.get(last.from)?.end ?? -1 });
  }
  return passages;
}

export function toggleSlur(text: string, ranges: Range[], file = indexFile(text)): Change[] {
  const changes: Change[] = [];
  // One slur over each passage: a voice split across V: blocks opens at its first selected note
  // and closes at its last.
  for (const passage of passagesOf(text, ranges, file)) {
    const { first, last } = passage;
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
  // A note that has the mark already, in either spelling, is left as it is.
  const changes = eventsIn(text, ranges, file)
    .filter(
      (event) =>
        !text.startsWith(mark, event.from) &&
        !prefixMarks(text, event.from).some((each) => each.mark === markOf(mark)),
    )
    .map((event) => ({ from: event.from, to: event.from, insert: mark }));
  return guardMarks(text, changes, file);
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

/** A bar line at the caret, spaced like the music around it. */
export function barLine(text: string, position: number): Change {
  const before = text[position - 1] ?? "\n";
  const after = text[position] ?? "\n";
  const lead = /[\s|]/.test(before) ? "" : " ";
  const tail = /\s/.test(after) ? "" : " ";
  return { from: position, to: position, insert: `${lead}|${tail}` };
}

function merge(changes: Change[]): Change[] {
  return changes
    .sort((a, b) => a.from - b.from || a.to - b.to)
    .filter(
      (change, index, all) =>
        index === 0 || change.from >= (all[index - 1] as Change).to || change.from === change.to,
    );
}

/** What typing a mark onto selected music did: the edit, how many notes, added or removed. */
export type MarkResult = {
  changes: Change[];
  mark: "staccato" | "roll" | "slur" | "dotted-short" | "short-dotted";
  /** Notes marked, or for broken rhythm, pairs. */
  count: number;
  removed: boolean;
  /** Why nothing changed, when the selection is music but the mark cannot apply. */
  reason?: string;
  /** For broken rhythm put on: each sign's place (before the edit) and the gap it replaced. */
  gaps?: { from: number; gap: string }[];
};
/** The gap a broken-rhythm sign replaced, by the sign's place, when it is remembered. */
export type GapAt = (position: number) => string | undefined;

/**
 * Whether every range is music: non-empty, inside a tune's body, on music lines only, and with
 * at least one note or chord. Headers, lyrics, comments, directives and free text are not.
 */
export function isMusicSelection(text: string, ranges: Range[], file = indexFile(text)): boolean {
  return musicSelection(text, ranges, file) === "music";
}

/**
 * What a selection is, for typed marks: "music" when every range lies on music lines of a tune's
 * body and at least one range has a note or chord (ranges of rests alone are skipped); "rests"
 * when it is music but has only rests; null when any of it is not music (headers, lyrics,
 * comments, directives, free text), which is typed as usual.
 */
export function musicSelection(
  text: string,
  ranges: Range[],
  file = indexFile(text),
): "music" | "rests" | null {
  if (!ranges.length) return null;
  let notes = false;
  for (const range of ranges) {
    if (range.from >= range.to) return null;
    const tune = file.tunes.find((each) => range.from >= each.bodyFrom && range.to <= each.to);
    if (!tune) return null;
    let at = text.lastIndexOf("\n", range.from - 1) + 1;
    while (at < range.to) {
      const end = text.indexOf("\n", at) < 0 ? text.length : text.indexOf("\n", at);
      if (lineKind(text.slice(at, end), true) !== "music") return null;
      at = end + 1;
    }
    const events = eventsIn(text, [range], file);
    if (!events.length) return null;
    if (events.some((event) => !event.rest)) notes = true;
  }
  return notes ? "music" : "rests";
}

/**
 * The music in a selection: each range cut down to the music lines of a tune's body it covers
 * (consecutive music lines staying together), leaving out headers, fields, lyrics, comments and
 * directives. A selection that mixes notes with other lines is acted on through these.
 */
export function musicParts(text: string, ranges: Range[], file = indexFile(text)): Range[] {
  const parts: Range[] = [];
  for (const range of ranges) {
    if (range.from >= range.to) continue;
    for (const tune of file.tunes) {
      const from = Math.max(range.from, tune.bodyFrom);
      const to = Math.min(range.to, tune.to);
      if (from >= to) continue;
      let at = text.lastIndexOf("\n", from - 1) + 1;
      let part: Range | null = null;
      while (at < to) {
        const end = text.indexOf("\n", at) < 0 ? text.length : text.indexOf("\n", at);
        if (lineKind(text.slice(at, end), true) === "music") {
          const piece = { from: Math.max(at, from), to: Math.min(end, to) };
          if (piece.from < piece.to) {
            if (part) part.to = piece.to;
            else {
              part = { ...piece };
              parts.push(part);
            }
          }
        } else part = null;
        at = end + 1;
      }
    }
  }
  return parts;
}

/** The same mark written in full: !staccato! for ".", !roll! for "~". */
const FULL_MARK: Record<string, string> = { ".": "!staccato!", "~": "!roll!" };
/** A decoration as the mark it makes: "." and !staccato! are one, "~" and !roll! another. */
const markOf = (decoration: string) =>
  decoration === "!staccato!" ? "." : decoration === "!roll!" ? "~" : decoration;

/**
 * The decorations a note carries, as written before it: across other decorations, chord symbols,
 * annotations, grace groups, a slur's start, spaces, and onto the end of the line before (abcjs
 * gives a decoration to the next note however far it is), stopping at anything else.
 */
export function prefixMarks(text: string, eventFrom: number): (Range & { mark: string })[] {
  const found: (Range & { mark: string })[] = [];
  let end = eventFrom;
  for (;;) {
    const lineFrom = text.lastIndexOf("\n", end - 1) + 1;
    const tokens = tokenizeMusic(text.slice(lineFrom, end), lineFrom);
    let open = true;
    for (let at = tokens.length - 1; at >= 0; at--) {
      const token = tokens[at] as MusicToken;
      const prefix =
        token.kind === "decoration" ||
        token.kind === "annotation" ||
        token.kind === "chord-symbol" ||
        token.kind === "grace-open" ||
        token.kind === "grace-close" ||
        token.kind === "space" ||
        (token.kind === "note" && token.inGrace) ||
        (token.kind === "slur" && token.text === "(");
      if (!prefix) {
        open = false;
        break;
      }
      if (token.kind === "decoration")
        found.push({ from: token.from, to: token.to, mark: markOf(token.text) });
    }
    // Only spaces and marks back to the line's start: the line before may hold more of them.
    if (!open || lineFrom === 0) break;
    const previousFrom = text.lastIndexOf("\n", lineFrom - 2) + 1;
    if (lineKind(text.slice(previousFrom, lineFrom - 1), true) !== "music") break;
    end = lineFrom - 1;
  }
  return found;
}

/** The marks ("." or "~", or written in full) before an event, among its other decorations. */
function marksBefore(text: string, eventFrom: number, mark: string): Range[] {
  return prefixMarks(text, eventFrom).filter((each) => each.mark === markOf(mark));
}

/**
 * Notes anywhere in the file with the same mark twice ("." and !staccato! count as one): one pass
 * over each tune's music lines, the marks pending until the note they belong to.
 */
export function doubledMarks(
  text: string,
  file = indexFile(text),
): { from: number; mark: string }[] {
  const doubled: { from: number; mark: string }[] = [];
  for (const tune of file.tunes) {
    let pending: string[] = [];
    let at = tune.bodyFrom;
    while (at < tune.to) {
      const end = Math.min(
        tune.to,
        text.indexOf("\n", at) < 0 ? text.length : text.indexOf("\n", at),
      );
      const line = text.slice(at, end);
      if (lineKind(line, true) !== "music") pending = [];
      else
        for (const token of tokenizeMusic(line, at)) {
          if (token.kind === "decoration") pending.push(markOf(token.text));
          else if ((token.kind === "note" && !token.inGrace) || token.kind === "chord-open") {
            for (const mark of [".", "~"])
              if (pending.filter((each) => each === mark).length > 1)
                doubled.push({ from: token.from, mark });
            pending = [];
          } else if (
            !(
              token.kind === "annotation" ||
              token.kind === "chord-symbol" ||
              token.kind === "grace-open" ||
              token.kind === "grace-close" ||
              token.kind === "space" ||
              token.kind === "note" ||
              (token.kind === "slur" && token.text === "(")
            )
          )
            pending = [];
        }
      at = end + 1;
    }
  }
  return doubled;
}

/**
 * The guard on every change that adds marks: an insertion of a mark the note already has is
 * dropped, and after the change no note anywhere may have a staccato or roll twice that didn't
 * before (whatever path the change came by).
 */
export function guardMarks(text: string, changes: Change[], file = indexFile(text)): Change[] {
  const kept = changes.filter((change) => {
    const mark = markOf(change.insert);
    if (change.from !== change.to || (mark !== "." && mark !== "~")) return true;
    const event = eventsIn(text, [{ from: change.from, to: change.from }], file).find(
      (each) => each.from >= change.from,
    );
    const at = event ? event.from : change.from;
    return !prefixMarks(text, at).some((each) => each.mark === mark);
  });
  const apply = (list: Change[]) => {
    let out = text;
    for (const change of [...list].sort((a, b) => b.from - a.from))
      out = out.slice(0, change.from) + change.insert + out.slice(change.to);
    return out;
  };
  const key = (list: { from: number; mark: string }[]) => list.length;
  const before = key(doubledMarks(text, file));
  const after = apply(kept);
  if (key(doubledMarks(after)) <= before) return kept;
  // Still doubled somewhere: keep only the changes that add no mark.
  return kept.filter((change) => {
    const mark = markOf(change.insert);
    return mark !== "." && mark !== "~";
  });
}

/**
 * Typing ".", "~" or "(" over selected music: staccato or a roll on every selected note and
 * chord (rests and bar lines skipped), placed right before the note (before its accidental, or a
 * chord's "[", after other decorations and grace notes), or removed when every one has it
 * already; "(" wraps each range in a slur, or removes the slur already wrapping it. Null when the
 * selection is not music, so the character is typed as usual.
 */
export function markSelection(
  text: string,
  ranges: Range[],
  typed: string,
  file = indexFile(text),
  gapAt: GapAt = () => undefined,
): MarkResult | null {
  if (typed !== "." && typed !== "~" && typed !== "(" && typed !== ">" && typed !== "<")
    return null;
  let selected = ranges;
  let kind = musicSelection(text, selected, file);
  if (!kind) {
    // Notes with other lines among them (lyrics, a part, a comment): mark the notes and leave the
    // other lines as they are; never type over them. Without notes, it is just typing.
    const parts = musicParts(text, ranges, file);
    if (!parts.length || !eventsIn(text, parts, file).length) return null;
    kind = musicSelection(text, parts, file);
    if (!kind) return null;
    selected = parts;
  }
  const mark =
    typed === "."
      ? "staccato"
      : typed === "~"
        ? "roll"
        : typed === "("
          ? "slur"
          : typed === ">"
            ? "dotted-short"
            : "short-dotted";
  // Music, but only rests: nothing to mark, and nothing is typed over it either.
  if (kind === "rests")
    return {
      changes: [],
      mark,
      count: 0,
      removed: false,
      reason:
        mark === "staccato"
          ? "Rests can't be staccato: select notes to mark them."
          : mark === "roll"
            ? "Rests can't have a roll: select notes to mark them."
            : mark === "slur"
              ? "A slur joins notes, and this selection has only rests."
              : "Broken rhythm needs notes, and this selection has only rests.",
    };
  if (typed === ">" || typed === "<") return brokenRhythm(text, selected, typed, file, gapAt);
  const notes = eventsIn(text, selected, file).filter((event) => !event.rest);
  if (typed === "(") {
    // Ranges of rests alone are left out of the slur.
    const withNotes = selected.filter((range) =>
      eventsIn(text, [range], file).some((event) => !event.rest),
    );
    const changes = toggleSlur(text, withNotes, file);
    const removed = changes.some((change) => change.insert === "");
    return { changes, mark: "slur", count: notes.length, removed };
  }
  const existing = notes.map((event) => marksBefore(text, event.from, typed));
  const removed = existing.every((found) => found.length > 0);
  const changes = removed
    ? existing.flat().map((range) => ({ ...range, insert: "" }))
    : notes
        .filter((_, at) => (existing[at] ?? []).length === 0)
        .map((event) => ({ from: event.from, to: event.from, insert: typed }));
  return {
    changes: guardMarks(text, merge(changes), file),
    mark: typed === "." ? "staccato" : "roll",
    count: notes.length,
    removed,
  };
}

/**
 * The pairs of neighbouring notes in each range, for broken rhythm: notes (a chord counts as
 * one) taken two by two; a bar line, a rest or another voice starts afresh, and an odd note at
 * the end is left alone.
 */
export function notePairs(
  text: string,
  ranges: Range[],
  file = indexFile(text),
): [MusicEvent, MusicEvent][] {
  const pairs: [MusicEvent, MusicEvent][] = [];
  for (const range of ranges) {
    for (const tune of file.tunes) {
      if (range.from >= tune.to || range.to <= tune.bodyFrom) continue;
      const items = tuneItems(text, tune, file)
        .filter((item) => item.from < range.to && item.to > range.from)
        .sort((a, b) => a.from - b.from);
      let run: MusicEvent[] = [];
      const close = () => {
        for (let at = 0; at + 1 < run.length; at += 2)
          pairs.push([run[at] as MusicEvent, run[at + 1] as MusicEvent]);
        run = [];
      };
      for (const item of items) {
        if (item.type === "bar" || item.rest || (run[0] && run[0].voice !== item.voice)) close();
        if (item.type === "event" && !item.rest) run.push(item);
      }
      close();
    }
  }
  return pairs;
}

/** Where a pair's broken-rhythm sign goes: after the first note and any tie or slur end on it. */
function brokenGap(text: string, first: MusicEvent, second: MusicEvent) {
  let from = first.to;
  while (from < second.from && /[-)]/.test(text[from] as string)) from += 1;
  const gap = text.slice(from, second.from);
  const sign = /^\s*(>+|<+)\s*/.exec(gap);
  return {
    from,
    sign: sign?.[1] ?? "",
    to: from + (sign ? sign[0].length : (/^\s*/.exec(gap)?.[0].length ?? 0)),
  };
}

/** ">" or "<" over selected music: dotted-short (or short-dotted) pairs, or off when all have it. */
function brokenRhythm(
  text: string,
  ranges: Range[],
  typed: ">" | "<",
  file: FileIndex,
  gapAt: GapAt,
): MarkResult {
  const pairs = notePairs(text, ranges, file).map(([first, second]) => ({
    first,
    second,
    gap: brokenGap(text, first, second),
  }));
  const removed = pairs.length > 0 && pairs.every((pair) => pair.gap.sign === typed);
  const changing = pairs.filter((pair) => removed || pair.gap.sign !== typed);
  const changes = changing.map((pair) => ({
    from: pair.gap.from,
    to: pair.gap.to,
    // Taken off, the gap that was there comes back exactly (none when it is not known, so
    // beamed notes stay beamed); put on, the sign joins the two notes.
    insert: removed ? (gapAt(pair.gap.from) ?? "") : typed,
  }));
  // The gap a new sign replaces is remembered; a sign turned round keeps the one it had.
  const gaps = removed
    ? []
    : changing
        .filter((pair) => !pair.gap.sign)
        .map((pair) => ({ from: pair.gap.from, gap: text.slice(pair.gap.from, pair.gap.to) }));
  return {
    changes: merge(changes),
    mark: typed === ">" ? "dotted-short" : "short-dotted",
    count: pairs.length,
    removed,
    gaps,
  };
}
