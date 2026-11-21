/**
 * MusicXML → ABC. Our own converter: a score-partwise (or timewise, turned partwise first) is
 * read into voices of timed events, then written as ABC text with a report of everything that
 * was left out. Pure: no DOM; the caller reads the bytes (and unzips an .mxl).
 *
 * Choices (see the plan's MusicXML section): transposing parts are written at sounding (concert)
 * pitch; each MusicXML voice of a part becomes an ABC voice; lyrics are aligned with | per bar;
 * lines follow <print new-system>, else four bars.
 */
import {
  type Fraction,
  accidentalText,
  add,
  formatLength,
  frac,
  meterLength,
  mul,
  value,
  writePitch,
} from "../abc";
import { type XmlElement, child, children, numberOf, parseXml, textOf } from "./xml";

export type ImportReport = {
  title: string;
  tunes: number;
  parts: number;
  bars: number;
  /** Things left out, with how many. */
  dropped: { label: string; count: number }[];
  /** Choices made on the way ("Clarinet in B♭ is written at sounding pitch"). */
  notes: string[];
};
export type ImportResult = { text: string; report: ImportReport };

export class MusicXmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MusicXmlError";
  }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const fracOf = (num: number, den: number): Fraction => (den ? frac(Math.round(num), den) : frac(0));
const sub = (a: Fraction, b: Fraction) => add(a, frac(-b.num, b.den));
const less = (a: Fraction, b: Fraction) => value(a) < value(b) - 1e-9;
const same = (a: Fraction, b: Fraction) => Math.abs(value(a) - value(b)) < 1e-9;

/* What gets counted as left out, under a readable name. */
class Dropped {
  private counts = new Map<string, number>();
  add(label: string, count = 1) {
    this.counts.set(label, (this.counts.get(label) ?? 0) + count);
  }
  list() {
    return [...this.counts].map(([label, count]) => ({ label, count }));
  }
}

const DROP_LABELS: Record<string, string> = {
  fingering: "fingerings",
  pedal: "pedal marks",
  "octave-shift": "octave lines (8va)",
  bracket: "brackets and lines",
  dashes: "dash lines",
  "string-mute": "mute marks",
  harmonic: "harmonics",
  "hammer-on": "hammer-ons",
  "pull-off": "pull-offs",
  bend: "bends",
  tap: "taps",
  pluck: "pluck marks",
  fret: "fret numbers",
  string: "string numbers",
  glissando: "glissandos",
  slide: "slides",
  "wavy-line": "trill lines",
  "accidental-mark": "ornament accidentals",
  "other-notation": "other notations",
  image: "images",
  "principal-voice": "principal-voice marks",
  percussion: "percussion pictograms",
  "staff-divide": "staff dividers",
  harp: "harp pedals",
  scordatura: "scordatura",
  eyeglasses: "eyeglasses",
  "accordion-registration": "accordion registrations",
  swing: "swing settings",
  "beat-repeat": "beat repeats",
  "measure-repeat": "measure repeats",
  slash: "slash notation",
  "pedal-tuning": "harp pedals",
};

/* Pitch arithmetic. */
const STEPS = "CDEFGAB";
const STEP_SEMITONE = [0, 2, 4, 5, 7, 9, 11];
const SHARP_ORDER = "FCGDAEB";
function keyAlters(fifths: number): Record<string, number> {
  const alters: Record<string, number> = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  if (fifths > 0) for (const letter of SHARP_ORDER.slice(0, fifths)) alters[letter] = 1;
  if (fifths < 0)
    for (const letter of [...SHARP_ORDER].reverse().slice(0, -fifths)) alters[letter] = -1;
  return alters;
}
const MAJOR = ["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"];
const MINOR = [
  "Abm",
  "Ebm",
  "Bbm",
  "Fm",
  "Cm",
  "Gm",
  "Dm",
  "Am",
  "Em",
  "Bm",
  "F#m",
  "C#m",
  "G#m",
  "D#m",
  "A#m",
];
const MODE_FROM_MAJOR: Record<string, number> = {
  dorian: 2,
  phrygian: 4,
  lydian: -1,
  mixolydian: 1,
  aeolian: 3,
  locrian: 5,
};
const MODE_ABBREV: Record<string, string> = {
  dorian: "Dor",
  phrygian: "Phr",
  lydian: "Lyd",
  mixolydian: "Mix",
  aeolian: "Aeo",
  locrian: "Loc",
};
/** The ABC K: value for MusicXML fifths and mode. */
export function keyName(fifths: number, mode = "major"): string {
  const index = Math.max(-7, Math.min(7, fifths)) + 7;
  if (mode === "minor") return MINOR[index] as string;
  const shift = MODE_FROM_MAJOR[mode];
  if (shift === undefined) return MAJOR[index] as string;
  // The mode's tonic: the major key's tonic moved round the circle of fifths.
  const tonicIndex = Math.max(-7, Math.min(7, fifths + shift)) + 7;
  return `${(MAJOR[tonicIndex] as string).replace(/m$/, "")}${MODE_ABBREV[mode]}`;
}

type Pitch = { step: string; alter: number; octave: number };

/** A pitch moved by a transposition (diatonic steps and chromatic semitones). */
function transposePitch(pitch: Pitch, diatonic: number, chromatic: number): Pitch {
  const index = STEPS.indexOf(pitch.step) + 7 * pitch.octave + diatonic;
  const step = STEPS[((index % 7) + 7) % 7] as string;
  const octave = Math.floor(index / 7);
  const midi = (p: Pitch) =>
    12 * (p.octave + 1) + (STEP_SEMITONE[STEPS.indexOf(p.step)] as number) + p.alter;
  const target = midi(pitch) + chromatic;
  const natural = midi({ step, octave, alter: 0 });
  return { step, octave, alter: target - natural };
}

/* The events of one voice. */
type Lyric = { texts: string[]; syllabic: string; extend: boolean };
type Event = {
  time: Fraction;
  duration: Fraction;
  /** As written (a tuplet's notes are written longer than they sound). */
  written: Fraction;
  rest: boolean;
  invisible: boolean;
  measureRest: boolean;
  pitches: Pitch[];
  ties: boolean[];
  grace: { pitches: Pitch[]; slash: boolean; written: Fraction }[];
  slurStart: number;
  slurStop: number;
  tuplet: { p: number; q: number; start: boolean; stop: boolean } | null;
  before: string[];
  after: string[];
  lyrics: Map<string, Lyric>;
  beam: string | undefined;
  staff: number;
};

type Attachment = {
  time: Fraction;
  text: string;
  staff: number;
  voice: string | null;
  order: number;
};

type Measure = {
  number: string;
  implicit: boolean;
  length: Fraction;
  newSystem: boolean;
  leftBar: string;
  rightBar: string;
  ending: string | null;
  key: { fifths: number; mode: string } | null;
  time: string | null;
  clefs: Map<number, string>;
  multiRest: number;
  tempo: string | null;
};

type Voice = {
  id: string;
  part: number;
  number: string;
  staff: number;
  name: string;
  /** Events per measure index. */
  measures: Map<number, Event[]>;
};

type Part = {
  id: string;
  name: string;
  staves: number;
  measures: Measure[];
  voices: Map<string, Voice>;
  attachments: Map<number, Attachment[]>;
  firstClefs: Map<number, string>;
  firstKey: { fifths: number; mode: string };
  transpose: { diatonic: number; chromatic: number } | null;
  percussion: boolean;
};

function clefName(clef: XmlElement): string {
  const sign = textOf(clef, "sign") ?? "G";
  const line = numberOf(clef, "line");
  const octave = numberOf(clef, "clef-octave-change") ?? 0;
  const suffix = octave === -1 ? "-8" : octave === 1 ? "+8" : "";
  if (sign === "G") return `treble${suffix}`;
  if (sign === "F") return line === 3 ? "baritone" : `bass${suffix}`;
  if (sign === "C")
    return line === 4 ? "tenor" : line === 1 ? "soprano" : line === 2 ? "mezzosoprano" : "alto";
  if (sign === "percussion") return "perc";
  if (sign === "TAB") return "treble";
  return "treble";
}

function timeName(time: XmlElement): string | null {
  if (child(time, "senza-misura")) return "none";
  const symbol = time.attrs.symbol;
  const beats = textOf(time, "beats");
  const type = textOf(time, "beat-type");
  if (symbol === "common" && beats === "4" && type === "4") return "C";
  if (symbol === "cut" && beats === "2" && type === "2") return "C|";
  return beats && type ? `${beats}/${type}` : null;
}

const KINDS: Record<string, string> = {
  major: "",
  minor: "m",
  augmented: "aug",
  diminished: "dim",
  dominant: "7",
  "major-seventh": "maj7",
  "minor-seventh": "m7",
  "diminished-seventh": "dim7",
  "augmented-seventh": "aug7",
  "half-diminished": "m7b5",
  "major-minor": "m(maj7)",
  "major-sixth": "6",
  "minor-sixth": "m6",
  "dominant-ninth": "9",
  "major-ninth": "maj9",
  "minor-ninth": "m9",
  "dominant-11th": "11",
  "major-11th": "maj11",
  "minor-11th": "m11",
  "dominant-13th": "13",
  "major-13th": "maj13",
  "minor-13th": "m13",
  "suspended-second": "sus2",
  "suspended-fourth": "sus4",
  power: "5",
  pedal: "",
  none: "N.C.",
};
const alterText = (alter: number) =>
  alter > 0 ? "#".repeat(alter) : alter < 0 ? "b".repeat(-alter) : "";

/** "Am7", "G/B", "F#m7b5": a MusicXML harmony as a chord symbol. */
export function chordSymbol(harmony: XmlElement): string | null {
  const root = child(harmony, "root");
  const kindElement = child(harmony, "kind");
  const kind = kindElement?.text ?? "major";
  if (kind === "none") return "N.C.";
  if (!root) return null;
  const step = textOf(root, "root-step") ?? "C";
  const alter = numberOf(root, "root-alter") ?? 0;
  let name = `${step}${alterText(alter)}`;
  const known = KINDS[kind];
  name += known ?? kindElement?.attrs.text ?? "";
  for (const degree of children(harmony, "degree")) {
    const number = textOf(degree, "degree-value") ?? "";
    const degreeAlter = numberOf(degree, "degree-alter") ?? 0;
    const type = textOf(degree, "degree-type") ?? "add";
    if (type === "add") name += `add${alterText(degreeAlter)}${number}`;
    else if (type === "alter") name += `${alterText(degreeAlter)}${number}`;
    else if (type === "subtract") name += `no${number}`;
  }
  const bass = child(harmony, "bass");
  if (bass)
    name += `/${textOf(bass, "bass-step") ?? ""}${alterText(numberOf(bass, "bass-alter") ?? 0)}`;
  return name;
}

const DYNAMICS = new Set(["pppp", "ppp", "pp", "p", "mp", "mf", "f", "ff", "fff", "ffff", "sfz"]);
/** The nearest ABC dynamic for a MusicXML one; null when there is none. */
function dynamicMark(name: string, dropped: Dropped): string | null {
  if (DYNAMICS.has(name)) return `!${name}!`;
  if (["sf", "sfp", "sfpp", "fz", "rfz", "rf", "sffz", "sfzp"].includes(name)) {
    dropped.add(`dynamics written as !sfz! (${name})`);
    return "!sfz!";
  }
  if (name === "pf" || name === "fp") {
    dropped.add(`dynamics written as !${name[0]}! (${name})`);
    return `!${name[0]}!`;
  }
  dropped.add("other dynamics");
  return null;
}

function wordsMark(text: string): string | null {
  const plain = text.trim().replace(/\s+/g, " ");
  if (/^D\.?\s*C\.?$/i.test(plain)) return "!D.C.!";
  if (/^D\.?\s*S\.?$/i.test(plain)) return "!D.S.!";
  if (/^D\.?\s*C\.?\s*al\s*Fine$/i.test(plain)) return "!D.C.alfine!";
  if (/^D\.?\s*C\.?\s*al\s*Coda$/i.test(plain)) return "!D.C.alcoda!";
  if (/^D\.?\s*S\.?\s*al\s*Fine$/i.test(plain)) return "!D.S.alfine!";
  if (/^D\.?\s*S\.?\s*al\s*Coda$/i.test(plain)) return "!D.S.alcoda!";
  if (/^Fine$/i.test(plain)) return "!fine!";
  return null;
}
/** A quoted annotation, with characters ABC would misread kept out. */
const annotation = (text: string, below: boolean) =>
  `"${below ? "_" : "^"}${text.replace(/"/g, "'").replace(/\s+/g, " ").trim()}"`;

/** Turns a score-timewise document into the partwise shape. */
function partwise(root: XmlElement): XmlElement {
  if (root.name !== "score-timewise") return root;
  const parts = new Map<string, XmlElement>();
  const order: string[] = [];
  for (const measure of children(root, "measure"))
    for (const part of children(measure, "part")) {
      const id = part.attrs.id ?? "P1";
      if (!parts.has(id)) {
        parts.set(id, { name: "part", attrs: { id }, children: [], text: "" });
        order.push(id);
      }
      (parts.get(id) as XmlElement).children.push({
        name: "measure",
        attrs: { ...measure.attrs },
        children: part.children,
        text: "",
      });
    }
  return {
    name: "score-partwise",
    attrs: root.attrs,
    children: [
      ...root.children.filter((each) => each.name !== "measure"),
      ...order.map((id) => parts.get(id) as XmlElement),
    ],
    text: "",
  };
}

const LAYOUT = new Set(["defaults", "credit"]);

/** Reads one part's measures into voices of timed events, with its structure and markings. */
async function readPart(
  partElement: XmlElement,
  id: string,
  name: string,
  partIndex: number,
  dropped: Dropped,
  progress: () => Promise<void>,
): Promise<Part> {
  const part: Part = {
    id,
    name,
    staves: 1,
    measures: [],
    voices: new Map(),
    attachments: new Map(),
    firstClefs: new Map(),
    firstKey: { fifths: 0, mode: "major" },
    transpose: null,
    percussion: false,
  };
  let divisions = 1;
  let order = 0;
  const lastNote = new Map<string, Event>();
  const pendingGrace = new Map<string, Event["grace"]>();
  const openTuplet = new Map<string, { p: number; q: number } | null>();
  const measureElements = children(partElement, "measure");
  for (let index = 0; index < measureElements.length; index++) {
    const element = measureElements[index] as XmlElement;
    if (index % 25 === 0) await progress();
    const measure: Measure = {
      number: element.attrs.number ?? String(index + 1),
      implicit: element.attrs.implicit === "yes",
      length: frac(0),
      newSystem: false,
      leftBar: "",
      rightBar: "|",
      ending: null,
      key: null,
      time: null,
      clefs: new Map(),
      multiRest: 0,
      tempo: null,
    };
    part.measures.push(measure);
    const attachments: Attachment[] = [];
    part.attachments.set(index, attachments);
    let cursor = frac(0);
    let furthest = frac(0);
    const attach = (text: string, element: XmlElement, at: Fraction) => {
      const staff = numberOf(element, "staff") ?? 1;
      const voice = textOf(element, "voice") ?? null;
      attachments.push({ time: at, text, staff, voice, order: order++ });
    };
    for (const node of element.children) {
      switch (node.name) {
        case "attributes": {
          divisions = numberOf(node, "divisions") ?? divisions;
          const staves = numberOf(node, "staves");
          if (staves) part.staves = staves;
          const key = child(node, "key");
          if (key && child(key, "fifths")) {
            const value = {
              fifths: numberOf(key, "fifths") ?? 0,
              mode: textOf(key, "mode") ?? "major",
            };
            if (index === 0 && !measure.key) part.firstKey = value;
            measure.key = value;
          }
          const time = child(node, "time");
          if (time) measure.time = timeName(time);
          for (const clef of children(node, "clef")) {
            const number = Number(clef.attrs.number ?? 1);
            const value = clefName(clef);
            if (value === "perc") part.percussion = true;
            if (!part.firstClefs.has(number)) part.firstClefs.set(number, value);
            else measure.clefs.set(number, value);
          }
          const transpose = child(node, "transpose");
          if (transpose && !part.transpose)
            part.transpose = {
              diatonic:
                (numberOf(transpose, "diatonic") ?? 0) +
                7 * (numberOf(transpose, "octave-change") ?? 0),
              chromatic:
                (numberOf(transpose, "chromatic") ?? 0) +
                12 * (numberOf(transpose, "octave-change") ?? 0),
            };
          const style = child(node, "measure-style");
          const multiple = numberOf(style, "multiple-rest");
          if (multiple && multiple > 1) measure.multiRest = multiple;
          for (const each of node.children)
            if (
              ![
                "divisions",
                "key",
                "time",
                "staves",
                "clef",
                "transpose",
                "measure-style",
                "instruments",
                "part-symbol",
                "footnote",
                "level",
              ].includes(each.name)
            )
              dropped.add(DROP_LABELS[each.name] ?? `${each.name} settings`);
          break;
        }
        case "backup":
          cursor = sub(cursor, fracOf(numberOf(node, "duration") ?? 0, divisions * 4));
          if (less(cursor, frac(0))) cursor = frac(0);
          break;
        case "forward":
          cursor = add(cursor, fracOf(numberOf(node, "duration") ?? 0, divisions * 4));
          if (less(furthest, cursor)) furthest = cursor;
          break;
        case "print":
          if (node.attrs["new-system"] === "yes" || node.attrs["new-page"] === "yes")
            measure.newSystem = true;
          if (
            child(node, "system-layout") ||
            child(node, "page-layout") ||
            child(node, "staff-layout")
          )
            dropped.add("page layout");
          break;
        case "barline": {
          const location = node.attrs.location ?? "right";
          const style = textOf(node, "bar-style");
          const repeat = child(node, "repeat");
          const ending = child(node, "ending");
          let bar = location === "left" ? "" : "|";
          if (style === "light-light") bar = "||";
          else if (style === "light-heavy") bar = "|]";
          else if (style === "heavy-light") bar = "[|";
          else if (style === "heavy-heavy") bar = "[|]";
          else if (style === "none") bar = location === "left" ? "" : "[|]";
          if (repeat?.attrs.direction === "forward") bar = "|:";
          if (repeat?.attrs.direction === "backward") bar = ":|";
          if (location === "left") measure.leftBar = bar;
          else measure.rightBar = bar;
          if (ending && ending.attrs.type === "start" && location === "left")
            measure.ending = (ending.attrs.number ?? "1").replace(/\s+/g, "");
          if (child(node, "segno")) attach("!segno!", node, cursor);
          if (child(node, "coda")) attach("!coda!", node, cursor);
          if (child(node, "fermata")) dropped.add("fermatas on bar lines");
          break;
        }
        case "direction": {
          const offset = fracOf(numberOf(node, "offset") ?? 0, divisions * 4);
          const at = add(cursor, offset);
          const below = node.attrs.placement === "below";
          for (const type of children(node, "direction-type"))
            for (const item of type.children) {
              if (item.name === "dynamics") {
                for (const mark of item.children) {
                  const text = dynamicMark(mark.name, dropped);
                  if (text) attach(text, node, at);
                }
              } else if (item.name === "wedge") {
                const kind = item.attrs.type;
                if (kind === "crescendo") attach("!<(!", node, at);
                else if (kind === "diminuendo") attach("!>(!", node, at);
                else if (kind === "stop") attach("!wedge-stop!", node, at);
              } else if (item.name === "words") {
                const text = item.text;
                if (!text) continue;
                attach(wordsMark(text) ?? annotation(text, below), node, at);
              } else if (item.name === "rehearsal") {
                if (item.text) attach(annotation(item.text, false), node, at);
              } else if (item.name === "segno") attach("!segno!", node, at);
              else if (item.name === "coda") attach("!coda!", node, at);
              else if (item.name === "metronome") {
                const unit = textOf(item, "beat-unit") ?? "quarter";
                const dotted = Boolean(child(item, "beat-unit-dot"));
                const perMinute = numberOf(item, "per-minute");
                const base = UNIT_LENGTH[unit] ?? frac(1, 4);
                const length = dotted ? mul(base, frac(3, 2)) : base;
                if (perMinute) {
                  const tempo = `${length.num}/${length.den}=${Math.round(perMinute)}`;
                  if (!measure.tempo) measure.tempo = tempo;
                }
              } else dropped.add(DROP_LABELS[item.name] ?? `${item.name} marks`);
            }
          const sound = child(node, "sound");
          if (sound?.attrs.tempo && !measure.tempo)
            measure.tempo = `1/4=${Math.round(Number(sound.attrs.tempo))}`;
          break;
        }
        case "harmony": {
          const offset = fracOf(numberOf(node, "offset") ?? 0, divisions * 4);
          const symbol = chordSymbol(node);
          if (symbol) attach(`"${symbol}"`, node, add(cursor, offset));
          if (child(node, "frame")) dropped.add("chord diagrams");
          break;
        }
        case "note": {
          const voiceId = textOf(node, "voice") ?? "1";
          const staff = numberOf(node, "staff") ?? 1;
          const isChord = Boolean(child(node, "chord"));
          const grace = child(node, "grace");
          const duration = fracOf(numberOf(node, "duration") ?? 0, divisions * 4);
          const pitchElement = child(node, "pitch") ?? child(node, "unpitched");
          const rest = child(node, "rest");
          let pitch: Pitch | null = null;
          if (pitchElement?.name === "pitch")
            pitch = {
              step: textOf(pitchElement, "step") ?? "C",
              alter: Math.round(numberOf(pitchElement, "alter") ?? 0),
              octave: numberOf(pitchElement, "octave") ?? 4,
            };
          else if (pitchElement) {
            pitch = {
              step: textOf(pitchElement, "display-step") ?? "C",
              alter: 0,
              octave: numberOf(pitchElement, "display-octave") ?? 4,
            };
            dropped.add("unpitched notes written at their display pitch");
          }
          if (pitch && part.transpose)
            pitch = transposePitch(pitch, part.transpose.diatonic, part.transpose.chromatic);
          const typeName = textOf(node, "type");
          const dots = children(node, "dot").length;
          const modification = child(node, "time-modification");
          const actual = numberOf(modification, "actual-notes") ?? 1;
          const normal = numberOf(modification, "normal-notes") ?? 1;
          if (Math.abs((numberOf(pitchElement, "alter") ?? 0) % 1) > 0)
            dropped.add("microtones (rounded)");
          if (grace) {
            const typed = UNIT_LENGTH[typeName ?? "eighth"] ?? frac(1, 8);
            const list = pendingGrace.get(voiceId) ?? [];
            if (pitch) {
              if (isChord && list.length)
                (list[list.length - 1] as Event["grace"][number]).pitches.push(pitch);
              else
                list.push({
                  pitches: [pitch],
                  slash: grace.attrs.slash === "yes",
                  written: dotted(typed, dots),
                });
            }
            pendingGrace.set(voiceId, list);
            countNoteDrops(node, dropped, true);
            break;
          }
          let voice = part.voices.get(voiceId);
          if (!voice) {
            voice = { id: "", part: partIndex, number: voiceId, staff, name, measures: new Map() };
            part.voices.set(voiceId, voice);
          }
          const events = voice.measures.get(index) ?? [];
          voice.measures.set(index, events);
          if (isChord) {
            const previous = lastNote.get(voiceId);
            if (previous && pitch) {
              previous.pitches.push(pitch);
              previous.ties.push(children(node, "tie").some((tie) => tie.attrs.type === "start"));
              readNotations(node, previous, dropped, true);
              readLyrics(node, previous);
            }
            break;
          }
          const start = cursor;
          const written = mul(duration, frac(actual, normal));
          const event: Event = {
            time: start,
            duration,
            written,
            rest: Boolean(rest),
            invisible: node.attrs["print-object"] === "no" && Boolean(rest),
            measureRest: rest?.attrs.measure === "yes",
            pitches: pitch && !rest ? [pitch] : [],
            ties: [children(node, "tie").some((tie) => tie.attrs.type === "start")],
            grace: pendingGrace.get(voiceId) ?? [],
            slurStart: 0,
            slurStop: 0,
            tuplet: null,
            before: [],
            after: [],
            lyrics: new Map(),
            beam: children(node, "beam").find((beam) => (beam.attrs.number ?? "1") === "1")?.text,
            staff,
          };
          pendingGrace.delete(voiceId);
          if (actual !== normal) {
            const tuplets = children(child(node, "notations"), "tuplet");
            const startsHere = tuplets.some((tuplet) => tuplet.attrs.type === "start");
            const stopsHere = tuplets.some((tuplet) => tuplet.attrs.type === "stop");
            const open = openTuplet.get(voiceId);
            event.tuplet = { p: actual, q: normal, start: startsHere || !open, stop: stopsHere };
            openTuplet.set(voiceId, stopsHere ? null : { p: actual, q: normal });
          } else openTuplet.set(voiceId, null);
          readNotations(node, event, dropped, false);
          readLyrics(node, event);
          countNoteDrops(node, dropped, false);
          events.push(event);
          lastNote.set(voiceId, event);
          cursor = add(cursor, duration);
          if (less(furthest, cursor)) furthest = cursor;
          break;
        }
        case "figured-bass":
          dropped.add("figured bass");
          break;
        case "sound":
          if (node.attrs.tempo && !measure.tempo)
            measure.tempo = `1/4=${Math.round(Number(node.attrs.tempo))}`;
          break;
        default:
          if (!["bookmark", "link", "grouping", "listening"].includes(node.name))
            dropped.add(DROP_LABELS[node.name] ?? `${node.name} elements`);
      }
    }
    measure.length = furthest;
  }
  return part;
}

const UNIT_LENGTH: Record<string, Fraction> = {
  maxima: frac(8),
  long: frac(4),
  breve: frac(2),
  whole: frac(1),
  half: frac(1, 2),
  quarter: frac(1, 4),
  eighth: frac(1, 8),
  "16th": frac(1, 16),
  "32nd": frac(1, 32),
  "64th": frac(1, 64),
  "128th": frac(1, 128),
};
function dotted(length: Fraction, dots: number): Fraction {
  let total = length;
  let part = length;
  for (let index = 0; index < dots; index++) {
    part = mul(part, frac(1, 2));
    total = add(total, part);
  }
  return total;
}

function countNoteDrops(note: XmlElement, dropped: Dropped, grace: boolean) {
  if (child(note, "cue")) dropped.add("cue notes");
  if (grace && children(note, "lyric").length) dropped.add("lyrics on grace notes");
  const notehead = textOf(note, "notehead");
  if (notehead && notehead !== "normal") dropped.add("notehead shapes");
}

const ARTICULATIONS: Record<string, string> = {
  staccato: ".",
  accent: "!>!",
  tenuto: "!tenuto!",
  "strong-accent": "!marcato!",
  staccatissimo: "!wedge!",
  spiccato: "!wedge!",
  "breath-mark": "!breath!",
  caesura: "!shortphrase!",
  "detached-legato": "!tenuto!.",
};
const ORNAMENTS: Record<string, string> = {
  "trill-mark": "!trill!",
  mordent: "!lowermordent!",
  "inverted-mordent": "!uppermordent!",
  turn: "!turn!",
  "inverted-turn": "!invertedturn!",
  "delayed-turn": "!turnx!",
  "delayed-inverted-turn": "!invertedturnx!",
  shake: "!pralltriller!",
};
const TECHNICAL: Record<string, string> = {
  "up-bow": "!upbow!",
  "down-bow": "!downbow!",
  "open-string": "!open!",
  "snap-pizzicato": "!snap!",
  thumb: "!thumb!",
  stopped: "!+!",
};

function readNotations(note: XmlElement, event: Event, dropped: Dropped, chordMember: boolean) {
  for (const notations of children(note, "notations"))
    for (const item of notations.children) {
      switch (item.name) {
        case "slur":
          if (chordMember) break;
          if (item.attrs.type === "start") event.slurStart++;
          else if (item.attrs.type === "stop") event.slurStop++;
          break;
        case "tied":
        case "tuplet":
          break;
        case "articulations":
          for (const mark of item.children) {
            const text = ARTICULATIONS[mark.name];
            if (text) {
              if (!event.before.includes(text)) event.before.push(text);
            } else
              dropped.add(
                mark.name === "other-articulation" ? "other articulations" : `${mark.name} marks`,
              );
          }
          break;
        case "ornaments":
          for (const mark of item.children) {
            if (mark.name === "other-ornament" && /roll/i.test(mark.text)) event.before.push("~");
            else if (mark.name === "tremolo") {
              const marks = Number(mark.text) || 1;
              if (mark.attrs.type === "single" || !mark.attrs.type)
                event.before.push(`!trem${Math.min(4, marks)}!`);
              else dropped.add("two-note tremolos");
            } else if (ORNAMENTS[mark.name]) {
              const text = ORNAMENTS[mark.name] as string;
              if (!event.before.includes(text)) event.before.push(text);
            } else if (mark.name !== "accidental-mark")
              dropped.add(DROP_LABELS[mark.name] ?? `${mark.name} ornaments`);
            else dropped.add(DROP_LABELS[mark.name] as string);
          }
          break;
        case "technical":
          for (const mark of item.children) {
            const text = TECHNICAL[mark.name];
            if (text) event.before.push(text);
            else dropped.add(DROP_LABELS[mark.name] ?? `${mark.name} marks`);
          }
          break;
        case "fermata":
          if (!event.before.some((mark) => mark.includes("fermata")))
            event.before.push(item.attrs.type === "inverted" ? "!invertedfermata!" : "!fermata!");
          break;
        case "dynamics":
          for (const mark of item.children) {
            const text = dynamicMark(mark.name, dropped);
            if (text) event.before.push(text);
          }
          break;
        case "arpeggiate":
          if (!event.before.includes("!arpeggio!")) event.before.push("!arpeggio!");
          break;
        default:
          dropped.add(DROP_LABELS[item.name] ?? `${item.name} notations`);
      }
    }
}

function readLyrics(note: XmlElement, event: Event) {
  for (const lyric of children(note, "lyric")) {
    const verse = lyric.attrs.number ?? "1";
    if (event.lyrics.has(verse)) continue;
    const texts = children(lyric, "text").map((text) => text.text);
    const syllabics = children(lyric, "syllabic").map((each) => each.text);
    event.lyrics.set(verse, {
      texts,
      // With an elision, the last syllable decides whether a hyphen follows.
      syllabic: syllabics[syllabics.length - 1] ?? "single",
      extend: Boolean(child(lyric, "extend")),
    });
  }
}

/** The bar line between two measures, from the first's right and the second's left. */
function joinBars(right: string, left: string): string {
  if (!left) return right;
  if (left === "|:") return right === ":|" ? "::" : "|:";
  return right === "|" || right === "" ? left : right;
}

/** Which unit length suits the music: the most common short note value. */
function chooseUnit(parts: Part[]): Fraction {
  const counts = new Map<string, number>();
  for (const part of parts)
    for (const voice of part.voices.values())
      for (const events of voice.measures.values())
        for (const event of events) {
          if (event.rest || event.invisible) continue;
          // The note value as a power of two at or below the written length.
          let unit = 1;
          while (unit / 2 >= value(event.written) - 1e-9 && unit > 1 / 64) unit /= 2;
          while (unit > value(event.written) + 1e-9) unit /= 2;
          if (unit > 0.25) continue;
          const key = String(unit);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
  let best = 0.125;
  let most = 0;
  for (const [key, count] of counts)
    if (count > most) {
      most = count;
      best = Number(key);
    }
  return frac(1, Math.round(1 / best));
}

/** Escapes text for a w: line. */
const lyricText = (text: string) => text.replace(/([-_*~|\\])/g, "\\$1").replace(/\s+/g, "~");

type Tune = { text: string; title: string; parts: number; bars: number };

/** Converts one score (partwise or timewise) into one ABC tune. */
async function convertScore(
  root: XmlElement,
  number: number,
  dropped: Dropped,
  notes: string[],
  progress: (done: number, total: number) => void,
): Promise<Tune> {
  const score = partwise(root);
  const work = child(score, "work");
  const title =
    textOf(work, "work-title") ??
    textOf(score, "movement-title") ??
    children(score, "credit")
      .flatMap((credit) => children(credit, "credit-words"))
      .find((words) => words.text)?.text ??
    "Untitled";
  const movement = textOf(score, "movement-title");
  const identification = child(score, "identification");
  const creators = children(identification, "creator");
  const composer = creators.find((each) => each.attrs.type === "composer")?.text;
  const lyricist = creators.find((each) => each.attrs.type === "lyricist")?.text;
  const arranger = creators.find((each) => each.attrs.type === "arranger")?.text;
  for (const name of children(score, "credit")) if (name) dropped.add("page layout");
  if (child(score, "defaults")) dropped.add("page layout");
  const partList = child(score, "part-list");
  const names = new Map<string, string>();
  for (const scorePart of children(partList, "score-part"))
    names.set(scorePart.attrs.id ?? "", textOf(scorePart, "part-name") ?? "");
  const partElements = children(score, "part");
  if (!partElements.length)
    throw new MusicXmlError("This MusicXML file has no parts with music in them.");
  const totalMeasures = partElements.reduce(
    (sum, part) => sum + children(part, "measure").length,
    0,
  );
  let done = 0;
  const parts: Part[] = [];
  for (const [index, element] of partElements.entries()) {
    const id = element.attrs.id ?? `P${index + 1}`;
    parts.push(
      await readPart(element, id, names.get(id) ?? "", index, dropped, async () => {
        progress(done, totalMeasures);
        await tick();
      }),
    );
    done += children(element, "measure").length;
  }
  progress(totalMeasures, totalMeasures);
  for (const each of LAYOUT) if (child(score, each)) dropped.add("page layout");
  const unit = chooseUnit(parts);
  const measureCount = Math.max(...parts.map((part) => part.measures.length));
  const first = parts[0] as Part;
  const firstMeasure = first.measures[0];
  const meter = firstMeasure?.time ?? "none";
  const tempo = parts.map((part) => part.measures[0]?.tempo).find(Boolean);

  // Voices: every MusicXML voice of every part, ordered by part, staff and number.
  const voices: Voice[] = [];
  for (const part of parts) {
    const list = [...part.voices.values()].sort(
      (a, b) => a.staff - b.staff || Number(a.number) - Number(b.number),
    );
    if (!list.length) {
      // A part with no notes at all still gets its voice, of rests.
      const empty: Voice = {
        id: "",
        part: parts.indexOf(part),
        number: "1",
        staff: 1,
        name: part.name,
        measures: new Map(),
      };
      part.voices.set("1", empty);
      list.push(empty);
    }
    for (const voice of list) voices.push(voice);
  }
  const usedIds = new Set<string>();
  voices.forEach((voice, index) => {
    voice.id = String(index + 1);
    usedIds.add(voice.id);
  });
  if (parts.some((part) => part.transpose && (part.transpose.chromatic || part.transpose.diatonic)))
    notes.push(
      `Transposing parts (${parts
        .filter((part) => part.transpose && (part.transpose.chromatic || part.transpose.diatonic))
        .map((part) => part.name || part.id)
        .join(", ")}) are written at sounding pitch, as in a concert score.`,
    );

  // Header.
  const lines: string[] = [`X:${number}`, `T:${title}`];
  if (movement && movement !== title) lines.push(`T:${movement}`);
  if (composer) lines.push(`C:${composer}`);
  if (lyricist) lines.push(`C:Words: ${lyricist}`);
  if (arranger) lines.push(`Z:Arranged by ${arranger}`);
  lines.push(`M:${meter}`);
  lines.push(`L:${unit.num}/${unit.den}`);
  if (tempo) lines.push(`Q:${tempo}`);
  // %%score: each part's staves; a staff with several voices in ( ), a grand staff in { }.
  const groups = parts.map((part) => {
    const partVoices = voices.filter((voice) => voice.part === parts.indexOf(part));
    const staves = [...new Set(partVoices.map((voice) => voice.staff))].sort((a, b) => a - b);
    const staffText = staves.map((staff) => {
      const ids = partVoices.filter((voice) => voice.staff === staff).map((voice) => voice.id);
      return ids.length > 1 ? `(${ids.join(" ")})` : (ids[0] as string);
    });
    return staves.length > 1 ? `{${staffText.join(" ")}}` : staffText.join(" ");
  });
  if (voices.length > 1) lines.push(`%%score ${groups.join(" ").trim()}`);
  /** The key as it sounds: a transposing part's written key moved, in its simplest spelling. */
  const concertFifths = (part: Part, fifths: number) => {
    if (!part.transpose?.chromatic) return fifths;
    let moved = (((fifths + part.transpose.chromatic * 7) % 12) + 12) % 12;
    if (moved > 6) moved -= 12;
    return moved;
  };
  const keyOf = (part: Part, key: { fifths: number; mode: string }) =>
    keyName(concertFifths(part, key.fifths), key.mode);
  for (const voice of voices) {
    const part = parts[voice.part] as Part;
    const clef = part.firstClefs.get(voice.staff) ?? "treble";
    const isFirst = voices.find((each) => each.part === voice.part) === voice;
    const nameText = isFirst && part.name ? ` name="${part.name.replace(/"/g, "'")}"` : "";
    if (voices.length > 1 || clef !== "treble" || part.name)
      lines.push(`V:${voice.id}${nameText} clef=${clef}`);
  }
  lines.push(`K:${keyOf(first, first.firstKey)}`);

  // Multi-measure rests are kept as Zn only where every part rests together.
  const multiAt = new Map<number, number>();
  for (let index = 0; index < measureCount; index++) {
    const counts = parts.map((part) => part.measures[index]?.multiRest ?? 0);
    if (counts.every((count) => count > 1 && count === counts[0]))
      multiAt.set(index, counts[0] as number);
  }

  // Systems: <print new-system>, else four bars (a pickup rides with the first line).
  const anyNewSystem = parts.some((part) =>
    part.measures.some((measure, index) => index > 0 && measure.newSystem),
  );
  const systems: number[][] = [];
  let line: number[] = [];
  let inLine = 0;
  for (let index = 0; index < measureCount; index++) {
    const measure = first.measures[index];
    if (line.length && anyNewSystem && measure?.newSystem) {
      systems.push(line);
      line = [];
      inLine = 0;
    }
    line.push(index);
    const span = multiAt.get(index) ?? 1;
    if (!(index === 0 && firstMeasure?.implicit)) inLine += 1;
    if (span > 1) index += span - 1;
    if (!anyNewSystem && inLine >= 4) {
      systems.push(line);
      line = [];
      inLine = 0;
    }
  }
  if (line.length) systems.push(line);

  // Body: per system, every voice's bars, then its lyrics.
  const keyState = new Map<string, Record<string, number>>();
  const wedgeOpen = new Map<string, string>();
  /** Marks after a voice's last note in a bar wait for its next note. */
  const carried = new Map<string, string[]>();
  let barsWritten = 0;
  for (const system of systems) {
    for (const voice of voices) {
      const part = parts[voice.part] as Part;
      const music: string[] = [];
      const verses = new Map<string, string[]>();
      const extended = new Map<string, boolean>();
      for (const [position, index] of system.entries()) {
        const measure = part.measures[index];
        if (!measure) continue;
        let alters = keyState.get(voice.id) ?? keyAlters(concertFifths(part, part.firstKey.fifths));
        let prefix = "";
        if (index > 0 && measure.key) {
          alters = keyAlters(concertFifths(part, measure.key.fifths));
          prefix += `[K:${keyOf(part, measure.key)}] `;
        } else if (index === 0 && keyOf(part, part.firstKey) !== keyOf(first, first.firstKey))
          // A part in another key than the first states it at its start.
          prefix += `[K:${keyOf(part, part.firstKey)}] `;
        keyState.set(voice.id, alters);
        if (index > 0 && measure.time) prefix += `[M:${measure.time}] `;
        const clef = measure.clefs.get(voice.staff);
        if (clef) prefix += `[K:clef=${clef}] `;
        if (index > 0 && measure.tempo && voice === voices[0]) prefix += `[Q:${measure.tempo}] `;
        // The bar line before this measure: the previous measure's right, this one's left.
        const previous = part.measures[index - 1];
        let barBefore = "";
        if (position === 0) barBefore = measure.leftBar === "|:" ? "|:" : measure.leftBar;
        else barBefore = joinBars(previous?.rightBar ?? "|", measure.leftBar);
        // An ending: after the bar line, or alone at the start of a line.
        if (measure.ending) barBefore = `${barBefore}[${measure.ending}`;
        const span = multiAt.get(index);
        const bar = span
          ? `Z${span}`
          : writeMeasure(voice, part, index, measure, unit, alters, wedgeOpen, carried, dropped);
        music.push(`${barBefore}${barBefore ? " " : ""}${prefix}${bar}`);
        if (voice === voices[0] && !measure.implicit) barsWritten += span ?? 1;
        // Lyrics, verse by verse, aligned with | per bar.
        const events = (voice.measures.get(index) ?? []).filter(
          (event) => !event.rest && !event.invisible,
        );
        const versesHere = new Set<string>();
        for (const event of events) for (const verse of event.lyrics.keys()) versesHere.add(verse);
        for (const verse of versesHere)
          if (!verses.has(verse))
            verses.set(
              verse,
              music.slice(0, -1).map(() => "|"),
            );
        for (const [verse, words] of verses) {
          const tokens: string[] = [];
          for (const event of events) {
            const lyric = event.lyrics.get(verse);
            if (lyric?.texts.length) {
              const text = lyric.texts.map(lyricText).join("~");
              tokens.push(
                `${text}${lyric.syllabic === "begin" || lyric.syllabic === "middle" ? "-" : " "}`,
              );
              extended.set(verse, lyric.extend);
            } else tokens.push(extended.get(verse) ? "_ " : "* ");
          }
          while (tokens.length && tokens[tokens.length - 1] === "* ") tokens.pop();
          words.push(`${tokens.join("").replace(/\s+$/, "")} |`);
        }
      }
      const lastIndex = system[system.length - 1] as number;
      const last = part.measures[lastIndex];
      const next = part.measures[lastIndex + 1 + ((multiAt.get(lastIndex) ?? 1) - 1)];
      let end = last?.rightBar ?? "|";
      // A repeat starting on the next line is written there.
      if (!next) end = end === "|" ? "|]" : end;
      lines.push(`V:${voice.id}`);
      lines.push(`${music.join(" ")} ${end}`.replace(/\s+/g, " ").trim());
      for (const [, words] of [...verses].sort((a, b) => Number(a[0]) - Number(b[0]))) {
        const text = words.join(" ").replace(/\s+/g, " ").trim();
        if (text.replace(/[|\s]/g, "")) lines.push(`w:${text.replace(/(\s*\|)+\s*$/, "")}`);
      }
    }
  }
  // A single voice without a name needs no V: lines in the body.
  let text = `${lines.join("\n")}\n`;
  if (voices.length === 1 && !lines.some((each) => /^V:1 /.test(each)))
    text = text.replace(/^V:1\n/gm, "");
  return { text, title, parts: parts.length, bars: barsWritten };
}

/** Writes one voice's events in one measure as ABC. */
function writeMeasure(
  voice: Voice,
  part: Part,
  index: number,
  measure: Measure,
  unit: Fraction,
  alters: Record<string, number>,
  wedgeOpen: Map<string, string>,
  carried: Map<string, string[]>,
  dropped: Dropped,
): string {
  const events = [...(voice.measures.get(index) ?? [])].sort(
    (a, b) => value(a.time) - value(b.time),
  );
  // Directions and chord symbols for this voice: its own, or its staff's when no voice is given.
  const firstOnStaff = [...part.voices.values()]
    .filter((each) => each.staff === voice.staff)
    .sort((a, b) => Number(a.number) - Number(b.number))[0];
  const attachments = (part.attachments.get(index) ?? [])
    .filter((each) =>
      each.voice !== null && part.voices.has(each.voice)
        ? each.voice === voice.number
        : each.staff === voice.staff && firstOnStaff === voice,
    )
    .sort((a, b) => value(a.time) - value(b.time) || a.order - b.order);
  const bar = new Map<string, number>();
  const tokens: string[] = [];
  let lastNoteToken = -1;
  let cursor = frac(0);
  let pending: string[] = carried.get(voice.id) ?? [];
  carried.delete(voice.id);
  const length = (duration: Fraction) =>
    formatLength(frac(duration.num * unit.den, duration.den * unit.num));
  const pitchText = (pitch: Pitch) => {
    const place = `${pitch.step}${pitch.octave}`;
    const implied = bar.get(place) ?? alters[pitch.step] ?? 0;
    let accidental = "";
    if (pitch.alter !== implied) {
      accidental = accidentalText(pitch.alter);
      bar.set(place, pitch.alter);
    }
    return `${accidental}${writePitch(pitch.step, pitch.octave)}`;
  };
  const takeAttachments = (until: Fraction | null) => {
    while (
      attachments.length &&
      (until === null || !less(until, (attachments[0] as Attachment).time))
    ) {
      const item = attachments.shift() as Attachment;
      let text = item.text;
      if (text === "!<(!" || text === "!>(!") wedgeOpen.set(voice.id, text);
      if (text === "!wedge-stop!") {
        const open = wedgeOpen.get(voice.id);
        wedgeOpen.delete(voice.id);
        text = open === "!>(!" ? "!>)!" : open ? "!<)!" : "";
      }
      if (text) pending.push(text);
    }
  };
  let previousBeam: string | undefined;
  let previousWasNote = false;
  for (let at = 0; at < events.length; at++) {
    const event = events[at] as Event;
    if (less(cursor, event.time)) {
      // A gap in this voice: an invisible rest keeps the bar whole.
      takeAttachments(event.time);
      tokens.push(` ${pending.join("")}x${length(sub(event.time, cursor))}`);
      pending = [];
      cursor = event.time;
      previousWasNote = false;
    } else if (less(event.time, cursor)) dropped.add("overlapping notes in one voice");
    takeAttachments(event.time);
    let text = pending.join("") + event.before.join("");
    pending = [];
    if (event.tuplet?.start) {
      // The notes this tuplet covers: up to its stop, or as many as it says.
      let count = 0;
      for (let next = at; next < events.length; next++) {
        const each = events[next] as Event;
        if (!each.tuplet) break;
        count++;
        if (each.tuplet.stop) break;
      }
      const { p, q } = event.tuplet;
      text = `${p === 3 && q === 2 && count === 3 ? "(3" : `(${p}:${q}:${count}`}${text}`;
    }
    text = "(".repeat(event.slurStart) + text;
    if (event.grace.length) {
      const slash = event.grace[0]?.slash ? "/" : "";
      const graceNotes = event.grace
        .map((grace) => {
          const pitches = grace.pitches.map(pitchText);
          const notes = pitches.length > 1 ? `[${pitches.join("")}]` : (pitches[0] as string);
          return `${notes}${length(grace.written)}`;
        })
        .join("");
      text += `{${slash}${graceNotes}}`;
    }
    const written = length(event.written);
    if (event.rest) {
      const whole =
        event.measureRest && events.length === 1 && !measure.implicit && measure.length.num > 0;
      text += event.invisible ? `x${written}` : whole ? "Z" : `z${written}`;
    } else if (event.pitches.length > 1) {
      text += `[${event.pitches.map(pitchText).join("")}]${written}`;
    } else text += `${pitchText(event.pitches[0] as Pitch)}${written}`;
    // A tie only where the next note in the voice continues the pitch.
    if (!event.rest && event.ties.some(Boolean)) {
      const nextEvent = events[at + 1] ?? (voice.measures.get(index + 1) ?? [])[0];
      const continues =
        nextEvent &&
        !nextEvent.rest &&
        event.pitches.some((pitch) =>
          nextEvent.pitches.some(
            (other) =>
              other.step === pitch.step &&
              other.octave === pitch.octave &&
              other.alter === pitch.alter,
          ),
        );
      if (continues) text += "-";
      else dropped.add("ties to notes that change pitch");
    }
    text += ")".repeat(event.slurStop);
    // Beamed notes touch; a space ends a beam group (and separates everything else).
    const joined =
      previousWasNote &&
      !event.rest &&
      (previousBeam === "begin" || previousBeam === "continue") &&
      (event.beam === "continue" || event.beam === "end");
    tokens.push(`${joined ? "" : " "}${text}`);
    lastNoteToken = tokens.length - 1;
    previousBeam = event.rest ? undefined : event.beam;
    previousWasNote = !event.rest;
    cursor = add(cursor, event.duration);
  }
  if (less(cursor, measure.length)) {
    takeAttachments(null);
    tokens.push(` ${pending.join("")}x${length(sub(measure.length, cursor))}`);
    pending = [];
  }
  takeAttachments(null);
  // Marks after the last note (a D.C. at the end of a bar) go on that note; in a bar with no
  // notes they wait for the voice's next one.
  if (pending.length && lastNoteToken >= 0) {
    const token = tokens[lastNoteToken] as string;
    const space = token.startsWith(" ") ? " " : "";
    tokens[lastNoteToken] = `${space}${pending.join("")}${token.trimStart()}`;
  } else if (pending.length) carried.set(voice.id, pending);
  const out = tokens.join("").trim();
  return out || `x${length(measure.length.num ? measure.length : frac(1))}`;
}

/**
 * Converts MusicXML text (partwise or timewise, 3.x or 4.0) into an ABC file: one tune per
 * document. Throws a MusicXmlError with a plain message when the file cannot be read.
 */
export async function importMusicXml(
  documents: string[],
  progress: (done: number, total: number) => void = () => {},
): Promise<ImportResult> {
  const dropped = new Dropped();
  const notes: string[] = [];
  const tunes: Tune[] = [];
  for (const [index, source] of documents.entries()) {
    let root: XmlElement;
    try {
      root = parseXml(source);
    } catch (error) {
      throw new MusicXmlError(
        `This file is not well-formed XML, so it cannot be read: ${error instanceof Error ? error.message : String(error)}.`,
      );
    }
    if (root.name === "opus")
      throw new MusicXmlError(
        "This is a MusicXML opus: it only lists other files. Open each movement's own file instead.",
      );
    if (root.name !== "score-partwise" && root.name !== "score-timewise")
      throw new MusicXmlError(
        `This XML file is not a MusicXML score (its root is <${root.name}>).`,
      );
    const version = root.attrs.version;
    if (version && Number(version) > 4.1) notes.push(`MusicXML ${version} was read as 4.0.`);
    tunes.push(await convertScore(root, index + 1, dropped, notes, progress));
  }
  const text = tunes.map((tune) => tune.text).join("\n");
  return {
    text,
    report: {
      title: tunes[0]?.title ?? "Untitled",
      tunes: tunes.length,
      parts: Math.max(0, ...tunes.map((tune) => tune.parts)),
      bars: tunes.reduce((sum, tune) => sum + tune.bars, 0),
      dropped: dropped.list(),
      notes,
    },
  };
}

/** "Imported 'Title': 3 parts, 64 bars. Left out: 12 fingerings, page layout." */
export function describeReport(report: ImportReport): string {
  const parts = `${report.parts} ${report.parts === 1 ? "part" : "parts"}`;
  const bars = `${report.bars} ${report.bars === 1 ? "bar" : "bars"}`;
  const tunes = report.tunes > 1 ? `${report.tunes} tunes, ` : "";
  const left = report.dropped.length
    ? ` Left out: ${report.dropped
        .slice(0, 4)
        .map((item) => (item.label === "page layout" ? item.label : `${item.count} ${item.label}`))
        .join(", ")}${report.dropped.length > 4 ? ", and more" : ""}.`
    : " Nothing was left out.";
  return `Imported “${report.title}”: ${tunes}${parts}, ${bars}.${left}`;
}
