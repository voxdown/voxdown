/**
 * What a MusicXML file sounds like, read straight from the XML (not through the importer), and
 * what Composer's player schedules for the ABC: for checking played pitches against the
 * original, so errors in import and export cannot cancel out in a round trip.
 */
import abcjs from "abcjs";
import {
  type XmlElement,
  child,
  children,
  numberOf,
  parseXml,
  textOf,
} from "../src/composer/musicxml/xml";

// biome-ignore lint/suspicious/noExplicitAny: abcjs's parse and audio have no published types.
type Any = any;

const SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const STEPS = "CDEFGAB";
const round = (whole: number) => Math.round(whole * 3840);

export type Sounding = {
  time: number;
  midi: number;
  part: number;
  staff: number;
  drawn: number | null;
};

/**
 * Every note's onset (in 3840ths of a whole) and sounding MIDI pitch, tied continuations left
 * out, grace notes and unpitched notes too. drawn is where the note sits on its staff, in abcjs's
 * terms (the bottom line is 2, a step a unit): the written pitch on its clef.
 */
export function soundingOf(xml: string): Sounding[] {
  const root = parseXml(xml);
  const notes: Sounding[] = [];
  children(root, "part").forEach((part, partIndex) => {
    let divisions = 1;
    let offset = 0;
    let transpose = { chromatic: 0, octave: 0 };
    const clefs = new Map<number, { sign: string; line: number; octave: number }>();
    // Ties started and not yet ended, by voice and sounding pitch.
    const open = new Set<string>();
    let bar = 1;
    for (const measure of children(part, "measure")) {
      let cursor = 0;
      let furthest = 0;
      let last = 0;
      for (const node of measure.children) {
        if (node.name === "attributes") {
          divisions = numberOf(node, "divisions") ?? divisions;
          const time = child(node, "time");
          if (time && numberOf(time, "beats") && numberOf(time, "beat-type"))
            bar = (numberOf(time, "beats") as number) / (numberOf(time, "beat-type") as number);
          const t = child(node, "transpose");
          if (t)
            transpose = {
              chromatic: numberOf(t, "chromatic") ?? 0,
              octave: numberOf(t, "octave-change") ?? 0,
            };
          for (const clef of children(node, "clef"))
            clefs.set(Number(clef.attrs.number ?? 1), {
              sign: textOf(clef, "sign") ?? "G",
              line: numberOf(clef, "line") ?? 2,
              octave: numberOf(clef, "clef-octave-change") ?? 0,
            });
        } else if (node.name === "backup")
          cursor = Math.max(0, cursor - (numberOf(node, "duration") ?? 0) / divisions / 4);
        else if (node.name === "forward") {
          cursor += (numberOf(node, "duration") ?? 0) / divisions / 4;
          furthest = Math.max(furthest, cursor);
        } else if (node.name === "note") {
          if (child(node, "grace")) continue;
          const chord = Boolean(child(node, "chord"));
          const start = chord ? last : cursor;
          const duration = (numberOf(node, "duration") ?? 0) / divisions / 4;
          if (!chord) {
            last = cursor;
            cursor += duration;
            furthest = Math.max(furthest, cursor);
          }
          const pitch = child(node, "pitch");
          if (!pitch) continue;
          const step = textOf(pitch, "step") ?? "C";
          const octave = numberOf(pitch, "octave") ?? 4;
          const alter = Math.round(numberOf(pitch, "alter") ?? 0);
          const tie = `${textOf(node, "voice") ?? "1"}:${step}${alter}${octave}`;
          const tiedIn =
            open.has(tie) && children(node, "tie").some((each) => each.attrs.type === "stop");
          open.delete(tie);
          if (children(node, "tie").some((each) => each.attrs.type === "start")) open.add(tie);
          if (tiedIn) continue;
          const staff = numberOf(node, "staff") ?? 1;
          const clef = clefs.get(staff) ?? { sign: "G", line: 2, octave: 0 };
          // Drawn: the written pitch; under an octave clef with no octave transposition, the
          // pitch is the one heard and sits an octave away on the staff.
          const diatonic =
            STEPS.indexOf(step) + 7 * (octave - 4) - (transpose.octave ? 0 : 7 * clef.octave);
          const drawn =
            clef.sign === "G"
              ? diatonic - 4 + 2 * clef.line
              : clef.sign === "F"
                ? diatonic + 4 + 2 * clef.line
                : clef.sign === "C"
                  ? diatonic + 2 * clef.line
                  : null;
          notes.push({
            time: round(offset + start),
            midi:
              12 * (octave + 1) +
              (SEMITONE[step] ?? 0) +
              alter +
              transpose.chromatic +
              12 * transpose.octave,
            part: partIndex,
            staff,
            drawn,
          });
        }
      }
      // An empty measure is a whole bar.
      offset += furthest || bar;
    }
  });
  return notes;
}

/** Every note Composer's player schedules for the first tune: onset and MIDI pitch. */
export function playedOf(abc: string): { time: number; midi: number; track: number }[] {
  const tune = abcjs.parseOnly(abc)[0] as Any;
  const audio = tune.setUpAudio({});
  const notes: { time: number; midi: number; track: number }[] = [];
  (audio.tracks as Any[][]).forEach((events, track) => {
    // A note's grace notes are played from its place and the note after them: the note is
    // counted at its grace notes' start.
    let graceStart: number | null = null;
    let lastChar = -1;
    let lastTime = 0;
    for (const event of events) {
      if (event.cmd !== "note" || event.duration <= 0) continue;
      if (event.style === "grace") {
        graceStart ??= event.start;
        continue;
      }
      if (typeof event.startChar !== "number") continue;
      // A chord's notes share one place.
      if (event.startChar !== lastChar) {
        lastChar = event.startChar;
        lastTime = graceStart ?? event.start;
        graceStart = null;
      }
      notes.push({ time: round(lastTime), midi: event.pitch, track });
    }
  });
  return notes;
}

/**
 * Compares two sets of sounding notes: the same pitches at the same times, within a 480th of a
 * whole (files with 256 or 768 divisions round tuplets to their ticks).
 */
export function sameNotes(
  actual: { time: number; midi: number }[],
  expected: { time: number; midi: number }[],
): boolean {
  const order = (list: { time: number; midi: number }[]) =>
    [...list].sort((a, b) => a.time - b.time || a.midi - b.midi);
  const a = order(actual);
  const b = order(expected);
  return (
    a.length === b.length &&
    a.every(
      (note, at) =>
        note.midi === (b[at] as { midi: number }).midi &&
        Math.abs(note.time - (b[at] as { time: number }).time) <= 8,
    )
  );
}

/** Where abcjs draws each voice's notes (verticalPos), voice by voice, rests left out. */
export function drawnOf(abc: string): number[][] {
  const tune = abcjs.parseOnly(abc)[0] as Any;
  const voices = new Map<string, number[]>();
  for (const line of tune.lines ?? [])
    (line.staff ?? []).forEach((staff: Any, staffIndex: number) =>
      (staff.voices ?? []).forEach((voice: Any[], voiceIndex: number) => {
        const key = `${staffIndex}.${voiceIndex}`;
        const list = voices.get(key) ?? [];
        for (const element of voice)
          if (element.el_type === "note" && !element.rest)
            for (const pitch of element.pitches ?? []) list.push(pitch.verticalPos);
        voices.set(key, list);
      }),
    );
  return [...voices.values()];
}

/** A list of [time, pitch] pairs sorted, for comparing as sets of sounding notes. */
export const sorted = (notes: { time: number; midi: number }[]) =>
  notes.map((note) => `${note.time}:${note.midi}`).sort();
export type { XmlElement };
