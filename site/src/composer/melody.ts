/**
 * Melody search: find a run of notes anywhere it is played, whatever the key, octave or unit
 * length. Each voice of each tune is read once into a sequence of sounding notes (one per note or
 * chord, its top note; a tied note is one note; grace notes, rests, decorations, chord symbols,
 * slurs and bar lines left out) and cached by the tune's text, so a search across a large file
 * reads only what changed.
 *
 * Matching compares the steps between notes, not the notes: in semitones (exact intervals) or
 * as up, down or same (contour). Repeated notes can be folded into one, as a variation that
 * plays a note twice still has the melody. Rhythm can be ignored, or required as the same
 * relative lengths.
 */
import {
  type NoteToken,
  alterationOf,
  defaultUnit,
  frac,
  midiOf,
  octaveOf,
  parseKey,
  parseUnit,
  value,
} from "./abc";
import { selectedNotes } from "./selected";
import { lengthText, pitchText } from "./stepentry";
import { type FileIndex, type TuneInfo, indexFile, tuneAt, tuneLabel } from "./tunes";
import { tuneItems, walkTune } from "./walk";

/** A sounding note in a voice: its pitch, length (whole notes), place in the text and bar. */
export type MelodyNote = {
  pitch: number;
  length: number;
  from: number;
  to: number;
  bar: number;
  /** The note's own text spans (a tied note has several). */
  spans: { from: number; to: number }[];
};
export type VoiceMelody = { voice: string; name: string; notes: MelodyNote[] };

export type MelodyOptions = {
  /** Exact intervals, or only up, down and same. */
  mode: "intervals" | "contour";
  /** Ignore rhythm, or require the same relative lengths. */
  rhythm: boolean;
  /** A note played twice in a row counts once. */
  foldRepeats: boolean;
};
export const DEFAULT_OPTIONS: MelodyOptions = {
  mode: "intervals",
  rhythm: false,
  foldRepeats: true,
};

/** Each voice of a tune as sounding notes. */
export function tuneMelody(text: string, tune: TuneInfo, file: FileIndex | null): VoiceMelody[] {
  // Pitches of every note token, from the key and the bar's accidentals as they stand.
  const pitchAt = new Map<number, number>();
  const tiedAfter = new Set<number>();
  let lastNote: NoteToken | null = null;
  walkTune(text, tune, file, (token, state) => {
    if (token.kind === "note") {
      const { alter } = alterationOf(token, state.key, state.bar);
      pitchAt.set(token.from, midiOf(token.letter, octaveOf(token.letter, token.octave), alter));
      if (!token.inGrace) lastNote = token;
    } else if (token.kind === "tie" && lastNote) tiedAfter.add(lastNote.from);
    else if (token.kind !== "space" && token.kind !== "chord-close") lastNote = null;
  });
  const voices = new Map<string, VoiceMelody>();
  const bars = new Map<string, { count: number; music: boolean }>();
  const open = new Map<string, MelodyNote & { tied: boolean }>();
  for (const item of tuneItems(text, tune, file)) {
    const voice =
      voices.get(item.voice) ??
      ({
        voice: item.voice,
        name: tune.voices.find((each) => each.id === item.voice)?.name ?? "",
        notes: [],
      } satisfies VoiceMelody);
    voices.set(item.voice, voice);
    const counter = bars.get(item.voice) ?? { count: 1, music: false };
    bars.set(item.voice, counter);
    if (item.type === "bar") {
      if (counter.music) counter.count += 1;
      counter.music = false;
      continue;
    }
    counter.music = true;
    if (item.rest) continue;
    // A chord sounds as its top note.
    let top = item.notes[0] as NoteToken;
    for (const note of item.notes)
      if ((pitchAt.get(note.from) ?? 0) > (pitchAt.get(top.from) ?? 0)) top = note;
    const pitch = pitchAt.get(top.from) ?? 60;
    const length = value(item.duration);
    const tied = item.notes.some((note) => tiedAfter.has(note.from));
    const previous = open.get(item.voice);
    if (previous?.tied && previous.pitch === pitch) {
      previous.length += length;
      previous.to = item.to;
      previous.spans.push({ from: item.from, to: item.to });
      previous.tied = tied;
      continue;
    }
    const note = {
      pitch,
      length,
      from: item.from,
      to: item.to,
      bar: counter.count,
      spans: [{ from: item.from, to: item.to }],
      tied,
    };
    voice.notes.push(note);
    open.set(item.voice, note);
  }
  for (const voice of voices.values())
    voice.notes = voice.notes.map((note) => {
      const { tied: _tied, ...rest } = note as MelodyNote & { tied?: boolean };
      return rest;
    });
  return [...voices.values()].filter((voice) => voice.notes.length);
}

/** A melody given as ABC notes ("dfed cBAG"), read in a key and unit length. */
export function queryNotes(
  abc: string,
  key = "C",
  unit = "1/8",
): { pitch: number; length: number }[] {
  const body = abc.replace(/[\r\n]+/g, " ").trim();
  if (!body) return [];
  const text = `X:1\nL:${unit}\nK:${key}\n${body}\n`;
  const file = indexFile(text);
  const tune = file.tunes[0];
  if (!tune) return [];
  return (tuneMelody(text, tune, file)[0]?.notes ?? []).map(({ pitch, length }) => ({
    pitch,
    length,
  }));
}

/* The sequences compared. */

type Note = { pitch: number; length: number };
function folded<T extends Note>(
  notes: T[],
  fold: boolean,
): { note: T; length: number; last: number }[] {
  const out: { note: T; length: number; last: number }[] = [];
  notes.forEach((note, index) => {
    const previous = out[out.length - 1];
    if (fold && previous && previous.note.pitch === note.pitch) {
      previous.length += note.length;
      previous.last = index;
    } else out.push({ note, length: note.length, last: index });
  });
  return out;
}
const step = (from: number, to: number, mode: MelodyOptions["mode"]) =>
  mode === "contour" ? Math.sign(to - from) : to - from;

export type MelodyMatch = {
  tune: TuneInfo;
  voice: string;
  voiceName: string;
  bar: number;
  from: number;
  to: number;
  /** The matched notes' text spans, merged where they touch on a line. */
  ranges: { from: number; to: number }[];
  /** The matched notes as they stand in the text. */
  excerpt: string;
  /** How closely it matches, for ranking: the same steps in semitones, the same relative
   * lengths, and whether repeated notes had to be folded (on either side) to match. */
  exact: boolean;
  sameRhythm: boolean;
  folded: boolean;
};

/** Where a melody is played in a set of voices. */
export function findIn(
  query: Note[],
  tune: TuneInfo,
  voices: VoiceMelody[],
  text: string,
  options: MelodyOptions = DEFAULT_OPTIONS,
): MelodyMatch[] {
  const wanted = folded(query, options.foldRepeats);
  if (wanted.length < 2) return [];
  const steps = wanted
    .slice(1)
    .map((each, at) => step((wanted[at] as typeof each).note.pitch, each.note.pitch, options.mode));
  const ratios = wanted.map((each) => each.length / (wanted[0] as typeof each).length);
  const exactSteps = wanted
    .slice(1)
    .map((each, at) => each.note.pitch - (wanted[at] as typeof each).note.pitch);
  const matches: MelodyMatch[] = [];
  for (const voice of voices) {
    const seq = folded(voice.notes, options.foldRepeats);
    for (let at = 0; at + wanted.length <= seq.length; at++) {
      let same = true;
      for (let k = 0; k < steps.length && same; k++)
        same =
          step(
            (seq[at + k] as (typeof seq)[number]).note.pitch,
            (seq[at + k + 1] as (typeof seq)[number]).note.pitch,
            options.mode,
          ) === steps[k];
      if (same && options.rhythm) {
        const base = (seq[at] as (typeof seq)[number]).length;
        for (let k = 1; k < wanted.length && same; k++)
          same =
            Math.abs((seq[at + k] as (typeof seq)[number]).length / base - (ratios[k] as number)) <
            1e-6;
      }
      if (!same) continue;
      const window = seq.slice(at, at + wanted.length);
      const exact = window.every(
        (each, k) =>
          k === 0 ||
          each.note.pitch - (window[k - 1] as typeof each).note.pitch === exactSteps[k - 1],
      );
      const base = (window[0] as (typeof window)[number]).length;
      const sameRhythm = window.every(
        (each, k) => Math.abs(each.length / base - (ratios[k] as number)) < 1e-6,
      );
      const first = (seq[at] as (typeof seq)[number]).note;
      const lastIndex = (seq[at + wanted.length - 1] as (typeof seq)[number]).last;
      const firstIndex = voice.notes.indexOf(first);
      const notes = voice.notes.slice(firstIndex, lastIndex + 1);
      const ranges: { from: number; to: number }[] = [];
      for (const span of notes.flatMap((note) => note.spans)) {
        const previous = ranges[ranges.length - 1];
        if (previous && !text.slice(previous.to, span.from).includes("\n")) previous.to = span.to;
        else ranges.push({ ...span });
      }
      matches.push({
        tune,
        voice: voice.voice,
        voiceName: voice.name,
        bar: first.bar,
        from: first.from,
        to: (notes[notes.length - 1] as MelodyNote).to,
        ranges,
        excerpt: ranges.map((range) => text.slice(range.from, range.to)).join(" … "),
        exact,
        sameRhythm,
        // Folded: the notes it spans, or the query's, aren't one to one.
        folded: notes.length !== query.length,
      });
      // Matches may overlap: the next one can start on the following note.
    }
  }
  return matches;
}

/* The index: each tune read once, kept while its text is the same. */

const cache = new Map<string, VoiceMelody[]>();
/** A tune's voices as notes, from the cache when its text (and the file header) is unchanged. */
export function melodyOf(text: string, tune: TuneInfo, file: FileIndex): VoiceMelody[] {
  const header = file.header ? text.slice(file.header.from, file.header.to) : "";
  const key = `${header}\u0000${text.slice(tune.from, tune.to)}`;
  let found = cache.get(key);
  if (!found) {
    // Read the tune on its own (with the file header) so positions are its own, then shift them.
    const own = `${header ? `${header.replace(/\n*$/, "")}\n\n` : ""}${text.slice(tune.from, tune.to)}`;
    const ownFile = indexFile(own);
    const ownTune = ownFile.tunes[0];
    found = ownTune ? tuneMelody(own, ownTune, ownFile) : [];
    const shift = own.length - (tune.to - tune.from);
    found = found.map((voice) => ({
      ...voice,
      notes: voice.notes.map((note) => ({
        ...note,
        from: note.from - shift,
        to: note.to - shift,
        spans: note.spans.map((span) => ({ from: span.from - shift, to: span.to - shift })),
      })),
    }));
    if (cache.size > 2000) cache.clear();
    cache.set(key, found);
  }
  // Positions in this text.
  return found.map((voice) => ({
    ...voice,
    notes: voice.notes.map((note) => ({
      ...note,
      from: note.from + tune.from,
      to: note.to + tune.from,
      spans: note.spans.map((span) => ({ from: span.from + tune.from, to: span.to + tune.from })),
    })),
  }));
}

/** Every match in a file's tunes (or one tune). */
export function searchFile(
  query: Note[],
  text: string,
  file: FileIndex,
  options: MelodyOptions = DEFAULT_OPTIONS,
  only?: TuneInfo,
): MelodyMatch[] {
  const tunes = only ? [only] : file.tunes;
  return tunes.flatMap((tune) => findIn(query, tune, melodyOf(text, tune, file), text, options));
}

/** Closest first: exact intervals, then the same rhythm, then those with no repeats folded;
 * otherwise in the order they come. */
export function rankMatches<T extends MelodyMatch>(matches: T[]): T[] {
  const score = (match: MelodyMatch) =>
    (match.exact ? 0 : 4) + (match.sameRhythm ? 0 : 2) + (match.folded ? 1 : 0);
  return matches
    .map((match, index) => ({ match, index }))
    .sort((a, b) => score(a.match) - score(b.match) || a.index - b.index)
    .map((each) => each.match);
}

/** "Tune title, voice, bar 5"; a voice with no name is called by its V: ("V:2"). */
export function describeMatch(match: MelodyMatch): string {
  const voice = match.voiceName || (match.tune.voices.length > 1 ? `V:${match.voice}` : "");
  return `${tuneLabel(match.tune)}${voice ? ` · ${voice}` : ""} · bar ${match.bar}`;
}

/**
 * The melody a selection plays, as a query for the search: the selected notes' sounding pitches
 * and lengths in one voice (the voice of the main range's first note, else the selection's highest
 * voice), written in the tune's key and unit with the accidentals they need. Not the selection's
 * text: that may hold two voices, lean on an accidental earlier in the bar, or follow a key change.
 */
export function queryFromSelection(
  text: string,
  file: FileIndex,
  ranges: { from: number; to: number }[],
  main = 0,
): { query: string; key: string; unit: string } | null {
  const picked = selectedNotes(text, ranges, file).filter((each) => !each.event.rest);
  const first = (
    selectedNotes(text, [ranges[main] ?? { from: 0, to: 0 }], file).find(
      (each) => !each.event.rest,
    ) ?? picked[0]
  )?.event;
  if (!first) return null;
  const tune = tuneAt(file, first.from);
  if (!tune) return null;
  const voices = melodyOf(text, tune, file);
  const chosen = (voice: VoiceMelody) =>
    voice.notes.filter((note) =>
      note.spans.some((span) =>
        picked.some(
          (each) =>
            each.event.voice === voice.voice &&
            span.from < each.event.to &&
            span.to > each.event.from,
        ),
      ),
    );
  const mean = (notes: MelodyNote[]) =>
    notes.reduce((sum, note) => sum + note.pitch, 0) / Math.max(1, notes.length);
  const mainVoice = voices.find((voice) => voice.voice === first.voice);
  const highest = voices
    .map((voice) => ({ voice, notes: chosen(voice) }))
    .filter((each) => each.notes.length)
    .sort((a, b) => mean(b.notes) - mean(a.notes))[0];
  const notes = mainVoice && chosen(mainVoice).length ? chosen(mainVoice) : (highest?.notes ?? []);
  if (!notes.length) return null;
  const key = tune.key.split(/\s+/)[0] || "C";
  const unit = tune.unit || "1/8";
  const unitLength = parseUnit(unit) ?? defaultUnit(tune.meter);
  // One bar for the whole query (the search reads it as one): an accidental holds to its end.
  const reading = {
    key: parseKey(key),
    bar: new Map<string, number>(),
    unit: unitLength,
    meter: "",
    voice: "1",
    shift: 0,
  };
  const query = notes
    .map(
      (note) =>
        `${pitchText(note.pitch, reading)}${lengthText(frac(Math.round(note.length * 384), 384), unitLength)}`,
    )
    .join(" ");
  return { query, key, unit };
}
