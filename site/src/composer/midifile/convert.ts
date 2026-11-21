/**
 * A MIDI file as notation: notes quantised to a grid, sorted into voices, spelled for a key and
 * cut into bars and beats, written out as MusicXML for Composer's MusicXML importer to turn into
 * ABC (so both imports share one writer: units, line breaks, lyrics, ties, tuplets and voices).
 *
 * The rules (also in the plan's Sprint D section):
 * - Time is counted in slots of 1/96 of a whole note, so 32nds (3) and triplet eighths (8) and
 *   sixteenths (4) are all whole numbers.
 * - The grid: eighths, sixteenths or 32nds, the coarsest that holds the notes' starts: at most 1
 *   in 100 more than a quarter step (and half a slot) away from it. A beat (a quarter) is written
 *   in triplets when two or more notes start inside it and they sit on thirds at least twice as
 *   closely as on the straight grid; compound and /8 meters stay straight unless triplets are
 *   asked for. Swing, with one note inside each beat, stays straight eighths.
 * - Voices: each track, or each channel of a format 0 file (or of a track that mixes them), is a
 *   part. Notes that start and end together are a chord. A chord goes to the first voice of its
 *   part that is free when it starts (a small legato overlap is trimmed), else a new voice; at most
 *   four, after which the longest-held voice's note is cut short.
 * - Drums (channel 10) are left out unless asked for, then written on a percussion staff in the
 *   usual places (kick in the bottom space, snare in the third, hi-hat and cymbals above).
 * - Key: the file's key signature, else estimated with the Krumhansl–Kessler profiles. Meter: the
 *   file's time signature, else 4/4. Both said in the report when guessed.
 * - Notation: a note is split at bar lines, and at a beat when it starts off the beat and runs
 *   over it, with ties; notes shorter than a beat are beamed by beat; each triplet beat is one
 *   tuplet.
 */
import { escapeXml } from "../musicxml/xml";
import type { Smf } from "./smf";

export type Grid = "auto" | "8" | "16" | "32" | "triplets" | "mixed";
export type MidiOptions = { grid: Grid; drums: "omit" | "staff" };
export const DEFAULT_MIDI_OPTIONS: MidiOptions = { grid: "auto", drums: "omit" };
export const GRID_NAMES: Record<Grid, string> = {
  auto: "Chosen from the music",
  "8": "Eighths",
  "16": "Sixteenths",
  "32": "32nds",
  triplets: "Eighth-note triplets throughout",
  mixed: "Sixteenths, with triplets where they fit",
};

const WHOLE = 96;
const QUARTER = 24;
const MAX_VOICES = 4;

/* The grid. */

export type Plan = {
  /** Straight step, in slots. */
  step: number;
  /** Triplet step, in slots, for triplet beats. */
  triplet: number;
  /** Every beat in triplets. */
  all: boolean;
  /** Quarter beats written in triplets (absolute quarter index). */
  beats: Set<number>;
  /** How it was chosen, for the report. */
  label: string;
};

const off = (x: number, step: number) => Math.abs(x - Math.round(x / step) * step);
const STEP_NAMES: Record<number, string> = { 12: "eighths", 6: "sixteenths", 3: "32nds" };

/** Chooses the grid for note starts (in slots, unrounded). */
export function chooseGrid(starts: number[], grid: Grid, compound: boolean): Plan {
  const fixed: Record<string, number> = { "8": 12, "16": 6, "32": 3, mixed: 6 };
  if (grid === "triplets")
    return {
      step: 8,
      triplet: 8,
      all: true,
      beats: new Set(),
      label: "eighth-note triplets throughout (as chosen)",
    };
  let step = fixed[grid] ?? 0;
  if (!step) {
    // The straight grid from the notes that aren't on thirds of a beat.
    const straight = starts.filter((x) => !(off(x, 8) <= 1 && off(x, 6) >= 1.5));
    // A grid fits when at most 1 in 100 notes starts more than a quarter step off it (none, in
    // a short piece): one real sixteenth needs sixteenths, a player's unevenness doesn't.
    const fits = (s: number) =>
      straight.filter((x) => off(x, s) > s / 4 + 0.5).length <= Math.floor(straight.length / 100);
    step = [12, 6, 3].find(fits) ?? 3;
  }
  const triplet = step === 3 ? 4 : 8;
  const beats = new Set<number>();
  const detect = grid === "mixed" || (grid === "auto" && !compound);
  if (detect) {
    const byBeat = new Map<number, number[]>();
    for (const x of starts) {
      const beat = Math.floor((x + 1) / QUARTER);
      const list = byBeat.get(beat) ?? [];
      list.push(x);
      byBeat.set(beat, list);
    }
    for (const [beat, list] of byBeat) {
      // Two notes or more starting inside the beat: one alone is a swung or dotted pair.
      if (list.filter((x) => off(x, QUARTER) > 1).length < 2) continue;
      const straightOff = list.reduce((sum, x) => sum + off(x, step), 0);
      const tripletOff = list.reduce((sum, x) => sum + off(x, triplet), 0);
      if (tripletOff * 2 < straightOff && tripletOff / list.length <= 1.5) beats.add(beat);
    }
  }
  const name = STEP_NAMES[step] ?? "sixteenths";
  const label =
    grid === "auto"
      ? `${name}${beats.size ? `, with ${triplet === 4 ? "sixteenth" : "eighth"}-note triplets in ${beats.size} ${beats.size === 1 ? "beat" : "beats"}` : ""} (chosen from the timing)`
      : `${name}${beats.size ? `, with triplets in ${beats.size} ${beats.size === 1 ? "beat" : "beats"}` : ""} (as chosen)`;
  return { step, triplet, all: false, beats, label };
}

const isTriplet = (plan: Plan, beat: number) => plan.all || plan.beats.has(beat);
/** A time (slots, unrounded) on the grid: thirds in a triplet beat, else the straight step. */
export function snap(x: number, plan: Plan): number {
  const beat = Math.floor((x + 1) / QUARTER);
  const step = isTriplet(plan, beat) ? plan.triplet : plan.step;
  return Math.round(x / step) * step;
}

/* Key. */

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
function correlation(a: number[], b: number[]): number {
  const mean = (list: number[]) => list.reduce((sum, x) => sum + x, 0) / list.length;
  const ma = mean(a);
  const mb = mean(b);
  let top = 0;
  let da = 0;
  let db = 0;
  a.forEach((x, i) => {
    const y = b[i] as number;
    top += (x - ma) * (y - mb);
    da += (x - ma) ** 2;
    db += (y - mb) ** 2;
  });
  return da && db ? top / Math.sqrt(da * db) : 0;
}
/** Fifths for a major tonic's pitch class, in −6…5. */
const fifthsOf = (pc: number) => {
  const fifths = (pc * 7) % 12;
  return fifths > 5 ? fifths - 12 : fifths;
};
/** The key whose profile best matches how long each pitch class sounds. */
export function estimateKey(weights: number[], finalBass = -1): { fifths: number; minor: boolean } {
  let best = { fifths: 0, minor: false, score: Number.NEGATIVE_INFINITY };
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = weights.map((_, i) => weights[(i + tonic) % 12] as number);
    // A nudge toward the key whose tonic is the last bass note: most music ends at home.
    const home = tonic === finalBass ? 0.1 : 0;
    const major = correlation(rotated, MAJOR_PROFILE) + home;
    const minor = correlation(rotated, MINOR_PROFILE) + home;
    if (major > best.score) best = { fifths: fifthsOf(tonic), minor: false, score: major };
    if (minor > best.score)
      best = { fifths: fifthsOf((tonic + 3) % 12), minor: true, score: minor };
  }
  return { fifths: best.fifths, minor: best.minor };
}

/* Spelling. */

const LETTERS = "CDEFGAB";
const LETTER_SEMITONE = [0, 2, 4, 5, 7, 9, 11];
const SHARPS = "FCGDAEB";
export const keyLabel = (fifths: number, minor: boolean) => {
  const majorPc = (((fifths * 7) % 12) + 12) % 12;
  const tonicPc = minor ? (majorPc + 9) % 12 : majorPc;
  const tonic = spellerFor(fifths, minor)(tonicPc + 60);
  const name = `${tonic.step}${tonic.alter > 0 ? "♯" : tonic.alter < 0 ? "♭" : ""}`;
  return `${name} ${minor ? "minor" : "major"}`;
};
/** Spells MIDI pitches for a key: its own notes, then naturals, then sharps in sharp keys and
 * flats in flat keys (in C: E♭ and B♭, F♯, C♯ and G♯); a minor key's leading note is raised. */
export function spellerFor(fifths: number, minor: boolean) {
  const alters = [0, 0, 0, 0, 0, 0, 0];
  for (const letter of fifths > 0
    ? SHARPS.slice(0, fifths)
    : [...SHARPS].reverse().slice(0, -fifths).join(""))
    alters[LETTERS.indexOf(letter)] = fifths > 0 ? 1 : -1;
  const table = new Map<number, { step: string; alter: number }>();
  LETTERS.split("").forEach((letter, i) => {
    table.set(((((LETTER_SEMITONE[i] as number) + (alters[i] as number)) % 12) + 12) % 12, {
      step: letter,
      alter: alters[i] as number,
    });
  });
  if (minor) {
    // The leading note: the letter below the tonic, raised to a semitone below it.
    const majorPc = (((fifths * 7) % 12) + 12) % 12;
    const tonicPc = (majorPc + 9) % 12;
    const tonicLetter = (table.get(tonicPc) as { step: string }).step;
    const below = LETTERS[(LETTERS.indexOf(tonicLetter) + 6) % 7] as string;
    const pc = (tonicPc + 11) % 12;
    if (!table.has(pc)) {
      const natural = LETTER_SEMITONE[LETTERS.indexOf(below)] as number;
      table.set(pc, { step: below, alter: ((pc - natural + 18) % 12) - 6 });
    }
  }
  for (let pc = 0; pc < 12; pc++) {
    if (table.has(pc)) continue;
    const natural = LETTER_SEMITONE.indexOf(pc);
    if (natural >= 0) {
      table.set(pc, { step: LETTERS[natural] as string, alter: 0 });
      continue;
    }
    const flat = fifths < 0 || (fifths === 0 && (pc === 3 || pc === 10));
    const letter = flat
      ? LETTER_SEMITONE.indexOf((pc + 1) % 12)
      : LETTER_SEMITONE.indexOf((pc + 11) % 12);
    table.set(pc, { step: LETTERS[letter] as string, alter: flat ? -1 : 1 });
  }
  return (midi: number) => {
    const spelled = table.get(((midi % 12) + 12) % 12) as { step: string; alter: number };
    const octave = Math.floor((midi - spelled.alter) / 12) - 1;
    return { ...spelled, octave };
  };
}

/* General MIDI programs, for naming parts with no track name. */
const GM = (
  "Acoustic Grand Piano|Bright Piano|Electric Grand Piano|Honky-tonk Piano|Electric Piano 1|Electric Piano 2|Harpsichord|Clavinet|" +
  "Celesta|Glockenspiel|Music Box|Vibraphone|Marimba|Xylophone|Tubular Bells|Dulcimer|" +
  "Drawbar Organ|Percussive Organ|Rock Organ|Church Organ|Reed Organ|Accordion|Harmonica|Bandoneon|" +
  "Nylon Guitar|Steel Guitar|Jazz Guitar|Clean Electric Guitar|Muted Guitar|Overdriven Guitar|Distortion Guitar|Guitar Harmonics|" +
  "Acoustic Bass|Fingered Bass|Picked Bass|Fretless Bass|Slap Bass 1|Slap Bass 2|Synth Bass 1|Synth Bass 2|" +
  "Violin|Viola|Cello|Contrabass|Tremolo Strings|Pizzicato Strings|Harp|Timpani|" +
  "Strings|Slow Strings|Synth Strings 1|Synth Strings 2|Choir Aahs|Voice Oohs|Synth Voice|Orchestra Hit|" +
  "Trumpet|Trombone|Tuba|Muted Trumpet|French Horn|Brass Section|Synth Brass 1|Synth Brass 2|" +
  "Soprano Sax|Alto Sax|Tenor Sax|Baritone Sax|Oboe|English Horn|Bassoon|Clarinet|" +
  "Piccolo|Flute|Recorder|Pan Flute|Blown Bottle|Shakuhachi|Whistle|Ocarina|" +
  "Square Lead|Sawtooth Lead|Calliope Lead|Chiff Lead|Charang Lead|Voice Lead|Fifths Lead|Bass and Lead|" +
  "New Age Pad|Warm Pad|Polysynth Pad|Choir Pad|Bowed Pad|Metallic Pad|Halo Pad|Sweep Pad|" +
  "Rain|Soundtrack|Crystal|Atmosphere|Brightness|Goblins|Echoes|Sci-fi|" +
  "Sitar|Banjo|Shamisen|Koto|Kalimba|Bagpipe|Fiddle|Shanai|" +
  "Tinkle Bell|Agogo|Steel Drums|Woodblock|Taiko Drum|Melodic Tom|Synth Drum|Reverse Cymbal|" +
  "Guitar Fret Noise|Breath Noise|Seashore|Bird Tweet|Telephone Ring|Helicopter|Applause|Gunshot"
).split("|");
export const programName = (program: number) => GM[program] ?? `Program ${program + 1}`;

/** Where General MIDI drums are drawn on a percussion staff (as treble pitches): the kick in
 * the bottom space, the snare in the third space, toms between, cymbals and hi-hat above. */
const DRUM_PLACE: Record<number, number> = {
  35: 65,
  36: 65,
  37: 72,
  38: 72,
  40: 72,
  39: 72,
  41: 69,
  43: 69,
  45: 74,
  47: 74,
  48: 76,
  50: 76,
  42: 79,
  44: 62,
  46: 79,
  49: 81,
  52: 81,
  55: 81,
  57: 81,
  51: 77,
  53: 77,
  59: 77,
};

/* Parts, voices and notes. */

type Note = { start: number; end: number; pitch: number };
type Chord = { start: number; end: number; pitches: number[] };
type Part = {
  name: string;
  drums: boolean;
  notes: Note[];
  voices: Chord[][];
  track: number;
  channel: number;
};

/** One piece of a chord or rest as written: start and length in slots. */
type Piece = { start: number; length: number; tuplet: boolean };

const NOTATABLE = [144, 96, 72, 48, 36, 24, 18, 12, 9, 6, 3];
const TYPE_OF: Record<number, string> = {
  96: "whole",
  48: "half",
  24: "quarter",
  12: "eighth",
  6: "16th",
  3: "32nd",
  1.5: "64th",
};
function typeOf(written: number): { type: string; dots: number } | null {
  if (TYPE_OF[written]) return { type: TYPE_OF[written] as string, dots: 0 };
  if (TYPE_OF[written / 1.5]) return { type: TYPE_OF[written / 1.5] as string, dots: 1 };
  return null;
}

/** Cuts [start, end) inside a bar into notatable pieces: at the edges of triplet beats, and at a
 * beat when a piece starts off the beat and would run over it. */
function cut(start: number, end: number, barStart: number, beat: number, plan: Plan): Piece[] {
  const pieces: Piece[] = [];
  let at = start;
  while (at < end) {
    const quarter = Math.floor(at / QUARTER);
    if (isTriplet(plan, quarter)) {
      const beatEnd = (quarter + 1) * QUARTER;
      const stop = Math.min(end, beatEnd);
      if (at === quarter * QUARTER && stop === beatEnd) {
        pieces.push({ start: at, length: QUARTER, tuplet: false });
        at = stop;
        continue;
      }
      const left = stop - at;
      const length = [16, 8, 4].find((each) => each <= left && left % 4 === 0) ?? left;
      pieces.push({ start: at, length, tuplet: [16, 8, 4].includes(length) });
      at += length;
      continue;
    }
    // Straight: up to the next triplet beat.
    let stop = end;
    for (let q = quarter + 1; q * QUARTER < end; q++)
      if (isTriplet(plan, q)) {
        stop = q * QUARTER;
        break;
      }
    const offset = (at - barStart) % beat;
    const nextBeat = at + (offset ? beat - offset : 0);
    const room = offset && nextBeat < stop ? nextBeat - at : stop - at;
    const length = NOTATABLE.find((each) => each <= room) ?? room;
    pieces.push({ start: at, length, tuplet: false });
    at += length;
  }
  return pieces;
}

/** Sorts a part's notes into voices of chords. */
function voicesOf(notes: Note[], counts: { cut: number; trimmed: number }): Chord[][] {
  const voices: Chord[][] = [];
  const byStart = new Map<number, Note[]>();
  for (const note of notes) {
    const list = byStart.get(note.start) ?? [];
    list.push(note);
    byStart.set(note.start, list);
  }
  for (const [start, group] of [...byStart].sort((a, b) => a[0] - b[0])) {
    // Notes that end together are one chord; the highest chord first.
    const chords = new Map<number, Chord>();
    for (const note of group) {
      const chord = chords.get(note.end) ?? { start, end: note.end, pitches: [] };
      if (!chord.pitches.includes(note.pitch)) chord.pitches.push(note.pitch);
      chords.set(note.end, chord);
    }
    const ordered = [...chords.values()].sort(
      (a, b) => Math.max(...b.pitches) - Math.max(...a.pitches),
    );
    for (const chord of ordered) {
      chord.pitches.sort((a, b) => a - b);
      const lastOf = (voice: Chord[]) => voice[voice.length - 1] as Chord;
      let voice = voices.find((each) => lastOf(each).end <= start);
      if (!voice) {
        // A legato overlap: the note before lets go when this one starts.
        voice = voices.find((each) => {
          const last = lastOf(each);
          return last.start < start && last.end - start <= Math.min(6, (last.end - last.start) / 2);
        });
        if (voice) {
          lastOf(voice).end = start;
          counts.trimmed += 1;
        }
      }
      if (!voice && voices.length < MAX_VOICES) {
        voice = [];
        voices.push(voice);
      }
      if (!voice) {
        // No voice free: the one whose note is held longest past this start lets go.
        voice = voices.reduce((a, b) => (lastOf(a).end >= lastOf(b).end ? a : b));
        const last = lastOf(voice);
        if (last.start < start) last.end = start;
        else {
          for (const pitch of chord.pitches)
            if (!last.pitches.includes(pitch)) last.pitches.push(pitch);
          last.pitches.sort((a, b) => a - b);
          counts.cut += 1;
          continue;
        }
        counts.cut += 1;
      }
      voice.push(chord);
    }
  }
  return voices;
}

/* Bars. */

type Bar = {
  start: number;
  length: number;
  num: number;
  den: number;
  fifths: number;
  minor: boolean;
  tempo?: number;
};

export type Converted = {
  xml: string;
  title: string;
  parts: number;
  voices: number;
  bars: number;
  plan: Plan;
  hasDrums: boolean;
  notes: string[];
  dropped: { label: string; count: number }[];
};

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;
const hasNotes = (smf: Smf) => smf.tracks.some((track) => track.notes.length);

/** Converts a read MIDI file into MusicXML and what the report should say. */
export function midiToMusicXml(smf: Smf, fileTitle: string, options: MidiOptions): Converted {
  if (!hasNotes(smf)) throw new Error("This MIDI file has no notes in it.");
  const notes: string[] = [];
  const dropped: { label: string; count: number }[] = [];
  const toSlots = (tick: number) => (tick * QUARTER) / smf.division;

  // Meter and its kind, for the grid.
  const firstMeter = smf.meters.find((meter) => WHOLE % meter.den === 0 && meter.num > 0);
  const compound = Boolean(firstMeter && firstMeter.den >= 8);
  // Parts: by track, and by channel within a track (format 0 has one track).
  const drumTracks = new Set<string>();
  let drumNotes = 0;
  const raw: { track: number; channel: number; notes: Smf["tracks"][number]["notes"] }[] = [];
  smf.tracks.forEach((track, index) => {
    const channels = [...new Set(track.notes.map((note) => note.channel))].sort((a, b) => a - b);
    for (const channel of channels) {
      const list = track.notes.filter((note) => note.channel === channel);
      if (channel === 9) {
        drumNotes += list.length;
        drumTracks.add(track.name || `track ${index + 1}`);
        if (options.drums === "omit") continue;
      }
      raw.push({ track: index, channel, notes: list });
    }
  });
  if (!raw.length)
    throw new Error(
      "This MIDI file has only drums in it. Import it again with drums kept as a percussion staff.",
    );

  const starts = raw.flatMap((part) => part.notes.map((note) => toSlots(note.tick)));
  const plan = chooseGrid(starts, options.grid, compound);

  const counts = { cut: 0, trimmed: 0, short: 0 };
  const names = new Map<string, number>();
  const parts: Part[] = raw.map((each) => {
    const track = smf.tracks[each.track] as Smf["tracks"][number];
    const program =
      track.programs.find((p) => p.channel === each.channel)?.program ??
      smf.tracks.flatMap((t) => t.programs).find((p) => p.channel === each.channel)?.program;
    const channelsInTrack = new Set(track.notes.map((note) => note.channel)).size;
    // A track's name names its part when the track is one part (a format 0 file's one track
    // names the piece); else the General MIDI program, else the channel.
    const own = smf.format !== 0 && channelsInTrack === 1 ? track.name : "";
    let name =
      own ||
      (each.channel === 9
        ? "Drums"
        : program !== undefined
          ? programName(program)
          : track.name && smf.format !== 0
            ? `${track.name} (channel ${each.channel + 1})`
            : `Channel ${each.channel + 1}`);
    const seen = names.get(name) ?? 0;
    names.set(name, seen + 1);
    if (seen) name = `${name} ${seen + 1}`;
    const quantised: Note[] = each.notes.map((note) => {
      const start = snap(toSlots(note.tick), plan);
      let end = snap(toSlots(note.end), plan);
      if (end <= start) {
        const beat = Math.floor((start + 1) / QUARTER);
        end = start + (isTriplet(plan, beat) ? plan.triplet : plan.step);
        counts.short += 1;
      }
      return {
        start,
        end,
        pitch: each.channel === 9 ? (DRUM_PLACE[note.pitch] ?? 71) : note.pitch,
      };
    });
    return {
      name,
      drums: each.channel === 9,
      notes: quantised,
      voices: [],
      track: each.track,
      channel: each.channel,
    };
  });
  for (const part of parts) part.voices = voicesOf(part.notes, counts);
  const end = Math.max(...parts.flatMap((part) => part.voices.flat().map((chord) => chord.end)));

  // Key: the file's, else estimated.
  let key = smf.keys[0]
    ? { fifths: Math.max(-7, Math.min(7, smf.keys[0].fifths)), minor: smf.keys[0].minor }
    : null;
  if (!key) {
    const weights = new Array(12).fill(0) as number[];
    for (const part of parts)
      if (!part.drums)
        for (const note of part.notes)
          weights[note.pitch % 12] = (weights[note.pitch % 12] as number) + (note.end - note.start);
    const pitched = parts.filter((part) => !part.drums).flatMap((part) => part.notes);
    const lastStart = Math.max(...pitched.map((note) => note.start));
    const finalBass = Math.min(
      ...pitched.filter((note) => note.start === lastStart).map((note) => note.pitch),
    );
    key = estimateKey(weights, finalBass % 12);
    notes.push(
      `The file has no key signature: the key was estimated as ${keyLabel(key.fifths, key.minor)} from how long each note sounds (Krumhansl–Kessler profiles, leaning toward the last bass note).`,
    );
  }
  if (!firstMeter) notes.push("The file has no time signature: written in 4/4.");

  // Bars: each meter from the bar where it takes effect.
  const bars: Bar[] = [];
  let meter = firstMeter ? { num: firstMeter.num, den: firstMeter.den } : { num: 4, den: 4 };
  let current = key;
  let at = 0;
  const meterAt = smf.meters
    .map((each) => ({ ...each, slot: toSlots(each.tick) }))
    .filter((each) => WHOLE % each.den === 0 && each.num > 0);
  const keyAt = smf.keys.map((each) => ({ ...each, slot: toSlots(each.tick) }));
  const tempoAt = smf.tempos.map((each) => ({ ...each, slot: toSlots(each.tick) }));
  while (at < end || !bars.length) {
    for (const change of meterAt)
      if (change.slot <= at + 1) meter = { num: change.num, den: change.den };
    for (const change of keyAt)
      if (change.slot <= at + 1)
        current = { fifths: Math.max(-7, Math.min(7, change.fifths)), minor: change.minor };
    const length = Math.max(3, (meter.num * WHOLE) / meter.den);
    bars.push({
      start: at,
      length,
      num: meter.num,
      den: meter.den,
      fifths: current.fifths,
      minor: current.minor,
    });
    at += length;
    if (bars.length > 100_000) throw new Error("This MIDI file is too long to write out.");
  }
  // Tempo: the first change in each bar.
  for (const change of tempoAt) {
    const bar =
      bars.find((each) => change.slot < each.start + each.length - 1e-6) ?? bars[bars.length - 1];
    if (bar && bar.tempo === undefined)
      bar.tempo = Math.round((60_000_000 / change.perQuarter) * 100) / 100;
  }
  if (!tempoAt.length) {
    (bars[0] as Bar).tempo = 120;
    notes.push("The file gives no tempo: MIDI's default, 120 beats a minute, is written.");
  } else if (tempoAt.length > 1) {
    const changes = new Set(tempoAt.map((each) => each.perQuarter)).size;
    if (changes > 1)
      notes.push(
        `${plural(tempoAt.length - 1, "tempo change")} written as Q: where ${tempoAt.length - 1 === 1 ? "it falls" : "they fall"} (the first in a bar).`,
      );
  }

  // Lyrics: onto the part whose first voice starts notes where the syllables are.
  const lyricEvents = smf.tracks.flatMap((track) => track.lyrics).sort((a, b) => a.tick - b.tick);
  const lyrics = new Map<string, Map<number, { text: string; syllabic: string }>>();
  if (lyricEvents.length) {
    const karaoke = lyricEvents.some((each) => /\s$/.test(each.text));
    const slots = lyricEvents.map((each) => snap(toSlots(each.tick), plan));
    let best: Part | null = null;
    let hits = -1;
    for (const part of parts) {
      if (part.drums) continue;
      const starts = new Set((part.voices[0] ?? []).map((chord) => chord.start));
      const count = slots.filter((slot) => starts.has(slot)).length;
      if (count > hits) {
        best = part;
        hits = count;
      }
    }
    const target = new Map<number, { text: string; syllabic: string }>();
    let continued = false;
    let missed = 0;
    lyricEvents.forEach((each, index) => {
      const raw = each.text.replace(/[\r\n\\/]/g, "");
      const text = raw.trim().replace(/-$/, "").trim();
      if (!text) return;
      const continues = /-\s*$/.test(raw) || (karaoke && !/\s$/.test(raw));
      const syllabic = continued ? (continues ? "middle" : "end") : continues ? "begin" : "single";
      continued = continues;
      const slot = slots[index] as number;
      if (target.has(slot) || !best?.voices[0]?.some((chord) => chord.start === slot)) {
        missed += 1;
        return;
      }
      target.set(slot, { text, syllabic });
    });
    if (best) {
      lyrics.set(best.name, target);
      notes.push(
        `${plural(target.size, "lyric syllable")} from the file ${target.size === 1 ? "is" : "are"} under ${best.name}.`,
      );
    }
    if (missed)
      dropped.push({ label: "lyric syllables with no note starting under them", count: missed });
  }

  // The report's account of tracks and voices.
  const voiceCount = parts.reduce((sum, part) => sum + part.voices.length, 0);
  const tracksWithNotes = smf.tracks.filter((track) => track.notes.length).length;
  notes.unshift(
    smf.format === 0
      ? `A format 0 MIDI file (one track): each of its ${plural(raw.length, "channel")} became a part.`
      : `A format ${smf.format} MIDI file: ${plural(tracksWithNotes, "track")} with notes became ${plural(parts.length, "part")}.`,
    `Notes were placed on a grid of ${plan.label}.`,
  );
  if (voiceCount > parts.length)
    notes.push(
      `Notes that overlap in a part were sorted into voices (${voiceCount} in all): notes that start and end together are a chord, and a chord goes to the first voice free when it starts.`,
    );
  if (drumNotes)
    notes.push(
      options.drums === "omit"
        ? `Drums (channel 10, ${plural(drumNotes, "note")}) were left out: Composer has no drum sounds. Import again with drums on a percussion staff to keep them.`
        : "Drums (channel 10) are written on a percussion staff where drum parts put them (kick low, snare in the middle, hi-hat and cymbals above); Composer plays them as pitched notes.",
    );
  if (counts.short)
    notes.push(
      `${plural(counts.short, "note")} shorter than the grid ${counts.short === 1 ? "was" : "were"} given one step of it.`,
    );
  if (counts.trimmed)
    notes.push(
      `${plural(counts.trimmed, "note")} overlapping the next by a little ${counts.trimmed === 1 ? "was" : "were"} shortened to meet it.`,
    );
  if (counts.cut)
    dropped.push({
      label: "notes cut short (more than four voices sounding at once)",
      count: counts.cut,
    });
  const c = smf.counts;
  const add = (count: number, label: string) => {
    if (count) dropped.push({ label, count });
  };
  add(c.pedals, "sustain pedal changes");
  add(c.controllers, "controller changes (volume, pan, expression and others)");
  add(c.pitchBends, "pitch bends");
  add(c.aftertouch, "aftertouch messages");
  add(c.programs, "program changes (the first one names a part with no track name)");
  add(c.sysex, "SysEx messages");
  add(c.markers, "markers and cue points");
  add(c.unclosed, "notes never released (ended with their track)");
  notes.push("Loudness (note velocities) is not written.");

  // MusicXML.
  const title =
    (smf.format === 1 && !smf.tracks[0]?.notes.length && smf.tracks[0]?.name) ||
    (smf.format === 0 && smf.tracks[0]?.name) ||
    fileTitle;
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<score-partwise version="4.0">',
    `<work><work-title>${escapeXml(title)}</work-title></work>`,
    "<part-list>",
  ];
  parts.forEach((part, index) => {
    out.push(
      `<score-part id="P${index + 1}"><part-name>${escapeXml(part.name)}</part-name></score-part>`,
    );
  });
  out.push("</part-list>");
  parts.forEach((part, index) => {
    out.push(`<part id="P${index + 1}">`);
    const pitches = part.notes.map((note) => note.pitch);
    const average = pitches.reduce((sum, p) => sum + p, 0) / Math.max(1, pitches.length);
    const clef = part.drums
      ? "<clef><sign>percussion</sign></clef>"
      : average < 60
        ? "<clef><sign>F</sign><line>4</line></clef>"
        : "<clef><sign>G</sign><line>2</line></clef>";
    const partLyrics = lyrics.get(part.name);
    const cursors = part.voices.map(() => 0);
    let previous: Bar | null = null;
    bars.forEach((bar, number) => {
      out.push(`<measure number="${number + 1}">`);
      const attributes: string[] = [];
      if (!previous) attributes.push("<divisions>24</divisions>");
      // A key is written again only when its signature changes (C major to A minor isn't one).
      if (!previous || previous.fifths !== bar.fifths)
        attributes.push(
          `<key><fifths>${bar.fifths}</fifths><mode>${bar.minor ? "minor" : "major"}</mode></key>`,
        );
      if (!previous || previous.num !== bar.num || previous.den !== bar.den)
        attributes.push(`<time><beats>${bar.num}</beats><beat-type>${bar.den}</beat-type></time>`);
      if (!previous) attributes.push(clef);
      if (attributes.length) out.push(`<attributes>${attributes.join("")}</attributes>`);
      if (bar.tempo !== undefined && index === 0) out.push(`<sound tempo="${bar.tempo}"/>`);
      const spell = spellerFor(bar.fifths, bar.minor);
      const beat =
        bar.den >= 8 && bar.num % 3 === 0 && bar.num > 3 ? (3 * WHOLE) / bar.den : WHOLE / bar.den;
      const barEnd = bar.start + bar.length;
      part.voices.forEach((voice, v) => {
        if (v > 0) out.push(`<backup><duration>${bar.length}</duration></backup>`);
        // The voice's chords and gaps in this bar.
        type Span = {
          start: number;
          end: number;
          chord: Chord | null;
          tieIn: boolean;
          tieOut: boolean;
        };
        const spans: Span[] = [];
        let k = cursors[v] as number;
        while (k < voice.length && (voice[k] as Chord).end <= bar.start) k++;
        cursors[v] = k;
        let at = bar.start;
        for (let j = k; j < voice.length && (voice[j] as Chord).start < barEnd; j++) {
          const chord = voice[j] as Chord;
          const from = Math.max(chord.start, bar.start);
          if (from > at)
            spans.push({ start: at, end: from, chord: null, tieIn: false, tieOut: false });
          const to = Math.min(chord.end, barEnd);
          spans.push({
            start: from,
            end: to,
            chord,
            tieIn: chord.start < bar.start,
            tieOut: chord.end > barEnd,
          });
          at = to;
        }
        if (at < barEnd)
          spans.push({ start: at, end: barEnd, chord: null, tieIn: false, tieOut: false });
        const hidden = v > 0;
        if (spans.length === 1 && !spans[0]?.chord) {
          out.push(
            `<note${hidden ? ' print-object="no"' : ""}><rest measure="yes"/><duration>${bar.length}</duration><voice>${v + 1}</voice></note>`,
          );
          return;
        }
        // Pieces, then beams by beat and one tuplet per triplet beat.
        type Written = {
          piece: Piece;
          span: Span;
          first: boolean;
          last: boolean;
          beam?: string;
          tuplet?: string;
        };
        const written: Written[] = [];
        for (const span of spans) {
          const pieces = cut(span.start, span.end, bar.start, beat, plan);
          pieces.forEach((piece, i) =>
            written.push({ piece, span, first: i === 0, last: i === pieces.length - 1 }),
          );
        }
        const beamable = (w: Written) =>
          w.span.chord !== null && (w.piece.tuplet ? w.piece.length * 1.5 : w.piece.length) <= 18;
        const window = (w: Written) =>
          w.piece.tuplet
            ? `t${Math.floor(w.piece.start / QUARTER)}`
            : `b${Math.floor((w.piece.start - bar.start) / beat)}`;
        for (let i = 0; i < written.length; ) {
          let j = i;
          if (beamable(written[i] as Written))
            while (
              j + 1 < written.length &&
              beamable(written[j + 1] as Written) &&
              window(written[j + 1] as Written) === window(written[i] as Written)
            )
              j++;
          if (j > i)
            for (let m = i; m <= j; m++)
              (written[m] as Written).beam = m === i ? "begin" : m === j ? "end" : "continue";
          i = j + 1;
        }
        for (let i = 0; i < written.length; ) {
          const w = written[i] as Written;
          if (!w.piece.tuplet) {
            i++;
            continue;
          }
          let j = i;
          const quarter = Math.floor(w.piece.start / QUARTER);
          while (
            j + 1 < written.length &&
            (written[j + 1] as Written).piece.tuplet &&
            Math.floor((written[j + 1] as Written).piece.start / QUARTER) === quarter
          )
            j++;
          w.tuplet = "start";
          (written[j] as Written).tuplet = j === i ? "start-stop" : "stop";
          i = j + 1;
        }
        for (const w of written) {
          const length = w.piece.length;
          const shape = typeOf(w.piece.tuplet ? length * 1.5 : length);
          const tieStop = w.span.chord !== null && (!w.first || w.span.tieIn);
          const tieStart = w.span.chord !== null && (!w.last || w.span.tieOut);
          const pitchesHere = w.span.chord ? w.span.chord.pitches : [null];
          pitchesHere.forEach((pitch, n) => {
            const parts: string[] = [
              `<note${hidden && pitch === null ? ' print-object="no"' : ""}>`,
            ];
            if (n > 0) parts.push("<chord/>");
            if (pitch === null) parts.push("<rest/>");
            else {
              const s = spell(pitch);
              parts.push(
                `<pitch><step>${s.step}</step>${s.alter ? `<alter>${s.alter}</alter>` : ""}<octave>${s.octave}</octave></pitch>`,
              );
            }
            parts.push(`<duration>${length}</duration>`);
            if (tieStop) parts.push('<tie type="stop"/>');
            if (tieStart) parts.push('<tie type="start"/>');
            parts.push(`<voice>${v + 1}</voice>`);
            if (shape) parts.push(`<type>${shape.type}</type>${shape.dots ? "<dot/>" : ""}`);
            if (w.piece.tuplet)
              parts.push(
                "<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>",
              );
            if (w.beam && n === 0) parts.push(`<beam number="1">${w.beam}</beam>`);
            const notations: string[] = [];
            if (tieStop) notations.push('<tied type="stop"/>');
            if (tieStart) notations.push('<tied type="start"/>');
            if (n === 0 && w.tuplet) {
              if (w.tuplet.startsWith("start"))
                notations.push('<tuplet type="start" bracket="no"/>');
              if (w.tuplet.endsWith("stop")) notations.push('<tuplet type="stop"/>');
            }
            if (notations.length) parts.push(`<notations>${notations.join("")}</notations>`);
            const lyric =
              v === 0 && n === 0 && w.first && !w.span.tieIn && w.span.chord
                ? partLyrics?.get(w.span.chord.start)
                : undefined;
            if (lyric)
              parts.push(
                `<lyric number="1"><syllabic>${lyric.syllabic}</syllabic><text>${escapeXml(lyric.text)}</text></lyric>`,
              );
            parts.push("</note>");
            out.push(parts.join(""));
          });
        }
      });
      out.push("</measure>");
      previous = bar;
    });
    out.push("</part>");
  });
  out.push("</score-partwise>");
  return {
    xml: out.join("\n"),
    title,
    parts: parts.length,
    voices: voiceCount,
    bars: bars.length,
    plan,
    hasDrums: drumNotes > 0,
    notes,
    dropped,
  };
}
