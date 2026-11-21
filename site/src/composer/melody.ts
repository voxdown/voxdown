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
import { type NoteToken, alterationOf, midiOf, octaveOf, value } from "./abc";
import { type FileIndex, type TuneInfo, indexFile, tuneLabel } from "./tunes";
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
      });
      // The next match starts after this one.
      at += wanted.length - 2;
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

/** "Tune title, voice, bar 5". */
export function describeMatch(match: MelodyMatch): string {
  return `${tuneLabel(match.tune)}${match.voiceName ? ` · ${match.voiceName}` : ""} · bar ${match.bar}`;
}
