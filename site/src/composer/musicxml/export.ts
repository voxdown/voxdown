/**
 * ABC → MusicXML 4.0 partwise, built from abcjs's parsed tune (the same parse the score uses).
 * Each staff becomes a part; the voices on a staff are its <voice>s, separated by <backup>;
 * braces in %%score become part groups. Element order follows the MusicXML 4.0 schema.
 */
import { type Fraction, add, frac, mul, parseKey, value } from "../abc";
import { escapeXml } from "./xml";

// biome-ignore lint/suspicious/noExplicitAny: abcjs's parsed tune has no published types.
type Any = any;

const STEPS = "CDEFGAB";
const TYPES: [number, string][] = [
  [8, "maxima"],
  [4, "long"],
  [2, "breve"],
  [1, "whole"],
  [1 / 2, "half"],
  [1 / 4, "quarter"],
  [1 / 8, "eighth"],
  [1 / 16, "16th"],
  [1 / 32, "32nd"],
  [1 / 64, "64th"],
  [1 / 128, "128th"],
];
/** A written length as a note type and dots: 3/8 is a dotted quarter. */
export function typeOf(written: number): { type: string; dots: number } | null {
  for (let dots = 0; dots <= 3; dots++) {
    const base = written / (2 - 2 ** -dots);
    const found = TYPES.find(([length]) => Math.abs(length - base) < 1e-9);
    if (found) return { type: found[1], dots };
  }
  return null;
}

/** A float (abcjs keeps lengths as numbers) as an exact fraction. */
function toFraction(number: number): Fraction {
  for (let den = 1; den <= 3840; den++) {
    const num = Math.round(number * den);
    if (Math.abs(num / den - number) < 1e-9) return frac(num, den);
  }
  return frac(Math.round(number * 3840), 3840);
}
const lcm = (a: number, b: number) => {
  const gcd = (x: number, y: number): number => (y ? gcd(y, x % y) : x);
  return (a / gcd(a, b)) * b;
};

const ALTER: Record<string, number> = { sharp: 1, flat: -1, natural: 0, dblsharp: 2, dblflat: -2 };
const ACCIDENTAL_NAME: Record<string, string> = {
  sharp: "sharp",
  flat: "flat",
  natural: "natural",
  dblsharp: "double-sharp",
  dblflat: "flat-flat",
};

/** abcjs's clef names: the sign and its usual line. */
const CLEF_SIGNS: Record<string, [string, number]> = {
  treble: ["G", 2],
  bass: ["F", 4],
  baritone: ["F", 3],
  alto: ["C", 3],
  tenor: ["C", 4],
  soprano: ["C", 1],
  mezzosoprano: ["C", 2],
};
/** The octave abcjs plays a clef in: treble-8 sounds an octave below where it is drawn. */
export const clefOctave = (clef: Any) => {
  const match = /([-+])8$/.exec(String(clef?.type ?? ""));
  return match ? (match[1] === "-" ? -1 : 1) : 0;
};

const MODES: Record<string, string> = {
  m: "minor",
  min: "minor",
  minor: "minor",
  dor: "dorian",
  phr: "phrygian",
  lyd: "lydian",
  mix: "mixolydian",
  aeo: "aeolian",
  loc: "locrian",
  ion: "major",
  maj: "major",
};
function keyXml(key: Any): string {
  const mode =
    MODES[
      String(key?.mode ?? "")
        .toLowerCase()
        .slice(0, 3)
    ] ?? (key?.mode === "m" ? "minor" : "major");
  const root = key?.root && key.root !== "none" ? `${key.root}${key.acc ?? ""}` : "C";
  const fifths =
    key?.root === "none" || key?.root === "HP" ? 0 : parseKey(`${root}${key?.mode ?? ""}`).fifths;
  return `<key><fifths>${fifths}</fifths><mode>${mode}</mode></key>`;
}
function timeXml(meter: Any): string {
  if (!meter) return "";
  if (meter.type === "common_time")
    return '<time symbol="common"><beats>4</beats><beat-type>4</beat-type></time>';
  if (meter.type === "cut_time")
    return '<time symbol="cut"><beats>2</beats><beat-type>2</beat-type></time>';
  const value0 = meter.value?.[0];
  if (!value0) return '<time print-object="no"><senza-misura/></time>';
  return `<time><beats>${escapeXml(String(value0.num))}</beats><beat-type>${escapeXml(String(value0.den))}</beat-type></time>`;
}
function clefXml(clef: Any, number?: number | null): string {
  const type = String(clef?.type ?? "treble").replace(/[-+]8$/, "");
  const open = `<clef${number ? ` number="${number}"` : ""}>`;
  if (type === "perc") return `${open}<sign>percussion</sign></clef>`;
  if (type === "none") return `${open}<sign>none</sign></clef>`;
  const [sign, usual] = CLEF_SIGNS[type] ?? CLEF_SIGNS.treble ?? ["G", 2];
  // abcjs keeps the clef's line as clefPos, two steps a line (bass3 is clefPos 6).
  const line = typeof clef?.clefPos === "number" ? Math.round(clef.clefPos / 2) : usual;
  const octave = clefOctave(clef);
  return `${open}<sign>${sign}</sign><line>${line}</line>${octave ? `<clef-octave-change>${octave}</clef-octave-change>` : ""}</clef>`;
}
const DIATONIC = [0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6];
/** A voice's transpose= (semitones abcjs plays it away from how it is written) as <transpose>. */
function transposeXml(semitones: number): string {
  if (!semitones) return "";
  const octave = Math.trunc(semitones / 12);
  const chromatic = semitones - 12 * octave;
  const diatonic = Math.sign(chromatic) * (DIATONIC[Math.abs(chromatic)] ?? 0);
  return `<transpose><diatonic>${diatonic}</diatonic><chromatic>${chromatic}</chromatic>${octave ? `<octave-change>${octave}</octave-change>` : ""}</transpose>`;
}

/* Chord symbols: "Am7", "G/B", "A7b9", "G7sus4", "C6/9" → harmony with its kind and degrees. */
const KIND_BY_TEXT: [string, string][] = [
  ["m(maj7)", "major-minor"],
  ["maj13", "major-13th"],
  ["maj11", "major-11th"],
  ["maj9", "major-ninth"],
  ["maj7", "major-seventh"],
  ["m7b5", "half-diminished"],
  ["dim7", "diminished-seventh"],
  ["aug7", "augmented-seventh"],
  ["m13", "minor-13th"],
  ["m11", "minor-11th"],
  ["m9", "minor-ninth"],
  ["m7", "minor-seventh"],
  ["m6", "minor-sixth"],
  ["sus2", "suspended-second"],
  ["sus4", "suspended-fourth"],
  ["sus", "suspended-fourth"],
  ["dim", "diminished"],
  ["aug", "augmented"],
  ["13", "dominant-13th"],
  ["11", "dominant-11th"],
  ["9", "dominant-ninth"],
  ["7", "dominant"],
  ["6", "major-sixth"],
  ["5", "power"],
  ["m", "minor"],
  ["", "major"],
];
/** The degrees each kind already has, so an altered one is an alter and a new one an add. */
const KIND_DEGREES: Record<string, number[]> = {
  "dominant-ninth": [9],
  "major-ninth": [9],
  "minor-ninth": [9],
  "dominant-11th": [9, 11],
  "major-11th": [9, 11],
  "minor-11th": [9, 11],
  "dominant-13th": [9, 11, 13],
  "major-13th": [9, 11, 13],
  "minor-13th": [9, 11, 13],
};
const degreeXml = (value: number, alter: number, type: string) =>
  `<degree><degree-value>${value}</degree-value><degree-alter>${alter}</degree-alter><degree-type>${type}</degree-type></degree>`;
/** A chord's quality as a MusicXML kind and degrees, or null when it is not one. */
function kindOf(quality: string): { kind: string; degrees: string } | null {
  const special = /^(m?)6\/9$/.exec(quality) ?? /^7(sus[24]?)$/.exec(quality);
  if (special) {
    if (quality.endsWith("/9"))
      return {
        kind: special[1] ? "minor-sixth" : "major-sixth",
        degrees: degreeXml(9, 0, "add"),
      };
    return {
      kind: special[1] === "sus2" ? "suspended-second" : "suspended-fourth",
      degrees: degreeXml(7, 0, "add"),
    };
  }
  for (const [text, kind] of KIND_BY_TEXT) {
    if (!quality.startsWith(text)) continue;
    const rest = quality.slice(text.length);
    const tokens = rest.match(/add[#b]*\d+|no\d+|[#b]+\d+/g) ?? [];
    if (tokens.join("") !== rest) continue;
    const degrees = tokens.map((token) => {
      const value = Number(/\d+/.exec(token)?.[0]);
      if (token.startsWith("no")) return degreeXml(value, 0, "subtract");
      const alter = [...token.replace(/^add/, "")].reduce(
        (sum, char) => sum + (char === "#" ? 1 : char === "b" ? -1 : 0),
        0,
      );
      const has = value === 5 || value === 3 || (KIND_DEGREES[kind] ?? []).includes(value);
      return degreeXml(value, alter, token.startsWith("add") || !has ? "add" : "alter");
    });
    return { kind, degrees: degrees.join("") };
  }
  return null;
}
export function harmonyXml(symbol: string, staff?: number | null): string | null {
  const staffXml = staff ? `<staff>${staff}</staff>` : "";
  if (/^N\.?C\.?$/i.test(symbol.trim()))
    return `<harmony><root><root-step>C</root-step></root><kind text="N.C.">none</kind>${staffXml}</harmony>`;
  const match = /^([A-G])([#b♯♭]*)(.*?)(?:\/([A-G])([#b♯♭]*))?$/.exec(symbol.trim());
  if (!match) return null;
  const alter = (text: string) =>
    [...text].reduce((sum, char) => sum + (/[#♯]/.test(char) ? 1 : -1), 0);
  const rest = match[3] ?? "";
  const known = kindOf(rest);
  const kind = known
    ? `<kind>${known.kind}</kind>`
    : `<kind text="${escapeXml(rest)}">other</kind>`;
  const rootAlter = alter(match[2] ?? "");
  const bass = match[4]
    ? `<bass><bass-step>${match[4]}</bass-step>${alter(match[5] ?? "") ? `<bass-alter>${alter(match[5] ?? "")}</bass-alter>` : ""}</bass>`
    : "";
  return `<harmony><root><root-step>${match[1]}</root-step>${rootAlter ? `<root-alter>${rootAlter}</root-alter>` : ""}</root>${kind}${bass}${known?.degrees ?? ""}${staffXml}</harmony>`;
}

/* Decorations. */
const ARTICULATION: Record<string, string> = {
  staccato: "<staccato/>",
  accent: "<accent/>",
  emphasis: "<accent/>",
  ">": "<accent/>",
  tenuto: "<tenuto/>",
  marcato: "<strong-accent/>",
  umarcato: "<strong-accent/>",
  wedge: "<staccatissimo/>",
  breath: "<breath-mark/>",
  shortphrase: "<caesura/>",
};
const ORNAMENT: Record<string, string> = {
  trill: "<trill-mark/>",
  lowermordent: "<mordent/>",
  mordent: "<mordent/>",
  uppermordent: "<inverted-mordent/>",
  pralltriller: "<inverted-mordent/>",
  turn: "<turn/>",
  invertedturn: "<inverted-turn/>",
  turnx: "<delayed-turn/>",
  invertedturnx: "<delayed-inverted-turn/>",
  roll: "<other-ornament>roll</other-ornament>",
  irishroll: "<other-ornament>roll</other-ornament>",
  trem1: '<tremolo type="single">1</tremolo>',
  trem2: '<tremolo type="single">2</tremolo>',
  trem3: '<tremolo type="single">3</tremolo>',
  trem4: '<tremolo type="single">4</tremolo>',
};
const TECHNICAL: Record<string, string> = {
  upbow: "<up-bow/>",
  downbow: "<down-bow/>",
  open: "<open-string/>",
  snap: "<snap-pizzicato/>",
  thumb: "<thumb-position/>",
  "+": "<stopped/>",
  plus: "<stopped/>",
};
const DYNAMIC = new Set(["pppp", "ppp", "pp", "p", "mp", "mf", "f", "ff", "fff", "ffff", "sfz"]);
const WEDGE: Record<string, string> = {
  "crescendo(": "crescendo",
  "<(": "crescendo",
  "diminuendo(": "diminuendo",
  ">(": "diminuendo",
  "crescendo)": "stop",
  "<)": "stop",
  "diminuendo)": "stop",
  ">)": "stop",
};
/** What playback does at a jump mark, as MusicXML's <sound>. */
const JUMP_SOUND: Record<string, string> = {
  segno: '<sound segno="segno"/>',
  coda: '<sound coda="coda"/>',
  "D.C.": '<sound dacapo="yes"/>',
  dacapo: '<sound dacapo="yes"/>',
  "D.C.alfine": '<sound dacapo="yes"/>',
  "D.C.alcoda": '<sound dacapo="yes"/>',
  "D.S.": '<sound dalsegno="segno"/>',
  "D.S.alfine": '<sound dalsegno="segno"/>',
  "D.S.alcoda": '<sound dalsegno="segno"/>',
  fine: '<sound fine="yes"/>',
  dacoda: '<sound tocoda="coda"/>',
};
const DIRECTION_WORDS: Record<string, string> = {
  "D.C.": "D.C.",
  "D.S.": "D.S.",
  dacapo: "D.C.",
  fine: "Fine",
  "D.C.alfine": "D.C. al Fine",
  "D.C.alcoda": "D.C. al Coda",
  "D.S.alfine": "D.S. al Fine",
  "D.S.alcoda": "D.S. al Coda",
  dacoda: "Da Coda",
};

type Note = Any;
type Measure = {
  elements: Note[];
  /** The bar closing it, and the one opening it. */
  right: Any | null;
  left: Any | null;
  newSystem: boolean;
  /** A key, meter or clef that changes before its notes. */
  changes: Any[];
};

/** A voice's elements, across every line, cut into measures at its bar lines. */
function measuresOf(lines: Any[], staff: number, voice: number): Measure[] {
  const measures: Measure[] = [];
  const fresh = (): Measure & { line: number } => ({
    elements: [],
    right: null,
    left: null,
    newSystem: false,
    changes: [],
    line: -1,
  });
  let current = fresh();
  const hasNotes = () => current.elements.some((each) => each.el_type === "note");
  // A key, meter or clef that changes at the start of a line is on that line's staff in abcjs.
  const seen: Record<string, string> = {};
  lines.forEach((line: Any, lineIndex: number) => {
    const onStaff = line.staff?.[staff];
    for (const [field, type] of [
      ["meter", "meter"],
      ["key", "key"],
      ["clef", "clef"],
    ] as const) {
      const value = onStaff?.[field];
      if (!value) continue;
      const text = JSON.stringify({
        ...value,
        el_type: undefined,
        startChar: undefined,
        endChar: undefined,
      });
      if (lineIndex > 0 && seen[field] !== undefined && seen[field] !== text) {
        const element = { ...value, el_type: type };
        if (hasNotes()) current.elements.push(element);
        else current.changes.push(element);
      }
      seen[field] = text;
    }
    for (const element of onStaff?.voices?.[voice] ?? []) {
      if (element.el_type === "bar") {
        if (!hasNotes()) {
          // A bar line before any note opens the measure (|: at the start of a line).
          current.left = element;
          continue;
        }
        current.right = element;
        measures.push(current);
        current = fresh();
        // A repeat start or an ending begins the next measure too.
        if (/left_repeat|dbl_repeat/.test(element.type) || element.startEnding)
          current.left = element;
        continue;
      }
      if (["key", "meter", "clef"].includes(element.el_type)) {
        if (hasNotes()) current.elements.push(element);
        else current.changes.push(element);
        continue;
      }
      if (element.el_type === "note") {
        if (current.line < 0) current.line = lineIndex;
        current.elements.push(element);
      }
    }
  });
  if (hasNotes()) measures.push(current);
  // A measure that starts on a later line than the one before it starts a system.
  measures.forEach((measure, index) => {
    const previous = measures[index - 1] as (Measure & { line: number }) | undefined;
    measure.newSystem = Boolean(
      previous && (measure as Measure & { line: number }).line > previous.line,
    );
  });
  return measures;
}

type Context = {
  divisions: number;
  /** The staff number in a part of several staves, else null. */
  staff: number | null;
  /** The octave abcjs plays the current clef in (treble-8: −1). */
  octave: number;
  /** Accidentals of the key, by upper-case letter. */
  key: Record<string, number>;
  bar: Map<number, number>;
  verses: Map<number, boolean>;
  beam: boolean;
  triplet: { p: number; q: number; left: number } | null;
  slurNumbers: Map<number, number>;
};

function keyAccidentals(key: Any): Record<string, number> {
  const alters: Record<string, number> = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  for (const accidental of key?.accidentals ?? [])
    alters[String(accidental.note).toUpperCase()] = ALTER[accidental.acc] ?? 0;
  return alters;
}

/** One pitch: step, alter (from its accidental, the bar, then the key) and octave. */
function pitchOf(pitch: Any, context: Context): { step: string; alter: number; octave: number } {
  const place = pitch.pitch as number;
  const step = STEPS[((place % 7) + 7) % 7] as string;
  // Under an octave clef abcjs plays the note an octave from where it is drawn: MusicXML's
  // pitch is the one heard, with the clef's octave change.
  const octave = 4 + Math.floor(place / 7) + context.octave;
  let alter: number;
  if (pitch.accidental && pitch.accidental in ALTER) {
    alter = ALTER[pitch.accidental] as number;
    context.bar.set(place, alter);
  } else alter = context.bar.get(place) ?? context.key[step] ?? 0;
  return { step, alter, octave };
}

const durationXml = (length: Fraction, divisions: number) =>
  `<duration>${Math.round(value(length) * 4 * divisions)}</duration>`;

/** Writes one measure of one voice; returns its XML and its length. */
function voiceMeasure(
  measure: Measure,
  voiceNumber: number,
  context: Context,
  directions: { placement: string; xml: string }[],
): { xml: string; length: Fraction } {
  const out: string[] = [];
  let length = frac(0);
  const staffXml = context.staff ? `<staff>${context.staff}</staff>` : "";
  for (const element of [...measure.changes, ...measure.elements]) {
    if (element.el_type !== "note") {
      if (element.el_type === "key") {
        context.key = keyAccidentals(element);
        out.push(`<attributes>${keyXml(element)}</attributes>`);
      } else if (element.el_type === "meter")
        out.push(`<attributes>${timeXml(element)}</attributes>`);
      else if (element.el_type === "clef") {
        context.octave = clefOctave(element);
        out.push(`<attributes>${clefXml(element, context.staff)}</attributes>`);
      }
      continue;
    }
    // Directions before the note: dynamics, wedges, words, chord symbols.
    const decorations: string[] = element.decoration ?? [];
    const placementOf = (name: string) => (DYNAMIC.has(name) || WEDGE[name] ? "below" : "above");
    for (const name of decorations) {
      let type = "";
      if (DYNAMIC.has(name)) type = `<dynamics><${name}/></dynamics>`;
      else if (WEDGE[name]) type = `<wedge type="${WEDGE[name]}"/>`;
      else if (name === "segno") type = "<segno/>";
      else if (name === "coda") type = "<coda/>";
      else if (DIRECTION_WORDS[name])
        type = `<words>${escapeXml(DIRECTION_WORDS[name] as string)}</words>`;
      if (type)
        directions.push({
          placement: placementOf(name),
          xml: `<direction placement="${placementOf(name)}"><direction-type>${type}</direction-type><voice>${voiceNumber}</voice>${staffXml}${JUMP_SOUND[name] ?? ""}</direction>`,
        });
    }
    // abcjs joins several chord symbols (or annotations) on one note with line breaks.
    const chords = (element.chord ?? []).flatMap((chord: Any) =>
      String(chord.name ?? "")
        .split("\n")
        .filter(Boolean)
        .map((name) => ({ ...chord, name })),
    );
    for (const chord of chords) {
      const name = String(chord.name ?? "");
      if (chord.position === "default" || !chord.position) {
        const harmony = harmonyXml(name, context.staff);
        if (harmony) out.push(harmony);
        else
          out.push(
            `<direction placement="above"><direction-type><words>${escapeXml(name)}</words></direction-type><voice>${voiceNumber}</voice>${staffXml}</direction>`,
          );
      } else {
        const placement = chord.position === "below" ? "below" : "above";
        out.push(
          `<direction placement="${placement}"><direction-type><words>${escapeXml(name)}</words></direction-type><voice>${voiceNumber}</voice>${staffXml}</direction>`,
        );
      }
    }
    for (const direction of directions.splice(0)) out.push(direction.xml);
    // Tuplets: abcjs marks the first note (p, q/p, r) and the last.
    if (element.startTriplet) {
      const p = element.startTriplet as number;
      const q = Math.round(p * (element.tripletMultiplier ?? 1));
      context.triplet = { p, q, left: element.tripletR ?? p };
    }
    const triplet = context.triplet;
    const written = toFraction(element.duration ?? 0);
    const actual = triplet ? mul(written, frac(triplet.q, triplet.p)) : written;
    const rest = element.rest;
    // Grace notes first.
    for (const grace of element.gracenotes ?? []) {
      const pitch = pitchOf(grace, context);
      const typed = typeOf(grace.duration ?? 0.125);
      out.push(
        `<note><grace${grace.acciaccatura ? ' slash="yes"' : ""}/><pitch><step>${pitch.step}</step>${pitch.alter ? `<alter>${pitch.alter}</alter>` : ""}<octave>${pitch.octave}</octave></pitch><voice>${voiceNumber}</voice><type>${typed?.type ?? "eighth"}</type>${"<dot/>".repeat(typed?.dots ?? 0)}${grace.accidental ? `<accidental>${ACCIDENTAL_NAME[grace.accidental] ?? "natural"}</accidental>` : ""}${staffXml}</note>`,
      );
    }
    if (rest && rest.type === "spacer") continue;
    if (rest && rest.type === "invisible") {
      out.push(
        `<forward>${durationXml(actual, context.divisions)}<voice>${voiceNumber}</voice>${staffXml}</forward>`,
      );
      length = add(length, actual);
      continue;
    }
    const typed = typeOf(value(written));
    const multi = rest?.type === "multimeasure";
    const timeModification = triplet
      ? `<time-modification><actual-notes>${triplet.p}</actual-notes><normal-notes>${triplet.q}</normal-notes></time-modification>`
      : "";
    // Beams, from abcjs's start and end of each group.
    const beamable = !rest && value(written) < 0.25 - 1e-9;
    let beam = "";
    if (beamable) {
      if (element.startBeam && !element.endBeam) {
        beam = '<beam number="1">begin</beam>';
        context.beam = true;
      } else if (element.endBeam && context.beam) {
        beam = '<beam number="1">end</beam>';
        context.beam = false;
      } else if (context.beam) beam = '<beam number="1">continue</beam>';
    } else context.beam = false;
    const pitches: Any[] = rest ? [null] : (element.pitches ?? []);
    pitches.forEach((pitchElement: Any, index: number) => {
      const parts: string[] = ["<note>"];
      if (index > 0) parts.push("<chord/>");
      let accidental = "";
      // Only a bar rest written Z is a full-measure rest; z4 stays a whole-note rest.
      if (rest) parts.push(multi ? '<rest measure="yes"/>' : "<rest/>");
      else {
        const pitch = pitchOf(pitchElement, context);
        parts.push(
          `<pitch><step>${pitch.step}</step>${pitch.alter ? `<alter>${pitch.alter}</alter>` : ""}<octave>${pitch.octave}</octave></pitch>`,
        );
        if (pitchElement.accidental)
          accidental = `<accidental>${ACCIDENTAL_NAME[pitchElement.accidental] ?? "natural"}</accidental>`;
      }
      parts.push(durationXml(actual, context.divisions));
      if (!rest && pitchElement.endTie) parts.push('<tie type="stop"/>');
      if (!rest && pitchElement.startTie) parts.push('<tie type="start"/>');
      parts.push(`<voice>${voiceNumber}</voice>`);
      if (typed && !multi) parts.push(`<type>${typed.type}</type>${"<dot/>".repeat(typed.dots)}`);
      parts.push(accidental);
      parts.push(timeModification);
      parts.push(staffXml);
      if (index === 0) parts.push(beam);
      // Notations: ties, slurs, tuplets, ornaments, technical, articulations, fermata.
      const notations: string[] = [];
      if (!rest && pitchElement.endTie) notations.push('<tied type="stop"/>');
      if (!rest && pitchElement.startTie) notations.push('<tied type="start"/>');
      if (index === 0) {
        const slurs = (element.pitches ?? []).flatMap((each: Any) => [
          ...(each.endSlur ?? []).map((label: number) => ({ type: "stop", label })),
          ...(each.startSlur ?? []).map((slur: Any) => ({ type: "start", label: slur.label })),
        ]);
        for (const slur of slurs) {
          if (slur.type === "start")
            context.slurNumbers.set(slur.label, context.slurNumbers.size + 1);
          const number = context.slurNumbers.get(slur.label) ?? 1;
          notations.push(`<slur type="${slur.type}" number="${Math.min(16, number)}"/>`);
          if (slur.type === "stop") context.slurNumbers.delete(slur.label);
        }
        if (triplet && element.startTriplet) notations.push('<tuplet type="start" bracket="yes"/>');
        if (triplet && triplet.left === 1) notations.push('<tuplet type="stop"/>');
        const ornaments = decorations.map((name) => ORNAMENT[name]).filter(Boolean);
        if (ornaments.length) notations.push(`<ornaments>${ornaments.join("")}</ornaments>`);
        const technical = decorations.map((name) => TECHNICAL[name]).filter(Boolean);
        if (technical.length) notations.push(`<technical>${technical.join("")}</technical>`);
        const articulations = decorations.map((name) => ARTICULATION[name]).filter(Boolean);
        if (articulations.length)
          notations.push(`<articulations>${articulations.join("")}</articulations>`);
        if (decorations.includes("fermata")) notations.push('<fermata type="upright"/>');
        if (decorations.includes("invertedfermata")) notations.push('<fermata type="inverted"/>');
        if (decorations.includes("arpeggio")) notations.push("<arpeggiate/>");
      }
      if (notations.length) parts.push(`<notations>${notations.join("")}</notations>`);
      // Lyrics, verse by verse, on the first note of a chord.
      if (index === 0 && !rest)
        (element.lyric ?? []).forEach((lyric: Any, verse: number) => {
          if (!lyric) return;
          const continuing = context.verses.get(verse) ?? false;
          const divider = lyric.divider ?? " ";
          const syllable = String(lyric.syllable ?? "");
          if (!syllable) {
            context.verses.set(verse, divider === "-");
            return;
          }
          const syllabic = continuing
            ? divider === "-"
              ? "middle"
              : "end"
            : divider === "-"
              ? "begin"
              : "single";
          context.verses.set(verse, divider === "-");
          // An elision is written with ~ in ABC; abcjs keeps it in the syllable as a space.
          const texts = syllable.split(/[ ~]/);
          const textXml = texts.map((text) => `<text>${escapeXml(text)}</text>`).join("<elision/>");
          parts.push(
            `<lyric number="${verse + 1}"><syllabic>${syllabic}</syllabic>${textXml}${divider === "_" ? "<extend/>" : ""}</lyric>`,
          );
        });
      parts.push("</note>");
      out.push(parts.join(""));
    });
    if (element.endTriplet || (triplet && triplet.left <= 1)) context.triplet = null;
    else if (triplet) triplet.left -= 1;
    length = add(length, actual);
  }
  return { xml: out.join(""), length };
}

function barlineXml(
  location: "left" | "right",
  bar: Any | null,
  endingStop: string | null,
): string {
  if (!bar && !endingStop) return "";
  const type: string = bar?.type ?? "bar_thin";
  let style = "";
  let repeat = "";
  if (location === "right") {
    if (type === "bar_thin_thin") style = "light-light";
    else if (type === "bar_thin_thick" || type === "bar_right_repeat" || type === "bar_dbl_repeat")
      style = "light-heavy";
    else if (type === "bar_thick_thin") style = "heavy-light";
    if (type === "bar_right_repeat" || type === "bar_dbl_repeat")
      repeat = '<repeat direction="backward"/>';
  } else {
    if (type === "bar_left_repeat" || type === "bar_dbl_repeat") {
      style = "heavy-light";
      repeat = '<repeat direction="forward"/>';
    } else if (type === "bar_thick_thin") style = "heavy-light";
  }
  let ending = "";
  if (location === "left" && bar?.startEnding)
    ending = `<ending number="${escapeXml(String(bar.startEnding))}" type="start"/>`;
  if (location === "right" && endingStop)
    ending = `<ending number="${escapeXml(endingStop)}" type="stop"/>`;
  if (!style && !repeat && !ending) return "";
  return `<barline location="${location}">${style ? `<bar-style>${style}</bar-style>` : ""}${ending}${repeat}</barline>`;
}

/** The tempo as a metronome mark and a sound. */
function tempoXml(tempo: Any): string {
  const beat = Number(tempo?.duration?.[0] ?? 0.25);
  const bpm = Number(tempo?.bpm ?? 0);
  if (!bpm) return "";
  const typed = typeOf(beat);
  const unit = typed
    ? `<beat-unit>${typed.type}</beat-unit>${"<beat-unit-dot/>".repeat(typed.dots)}`
    : "<beat-unit>quarter</beat-unit>";
  const quarters = Math.round(bpm * beat * 4 * 100) / 100;
  return `<direction placement="above"><direction-type><metronome>${unit}<per-minute>${bpm}</per-minute></metronome></direction-type><sound tempo="${quarters}"/></direction>`;
}

/** The name abcjs gives a staff (its first voice's name=), or "". */
const staffName = (staff: Any) =>
  String(Array.isArray(staff?.title) ? (staff.title.find(Boolean) ?? "") : "");

/**
 * The parts a tune's staves make: one part per staff, except that a brace over the staves of one
 * instrument (one name, or a name and unnamed staves) is one part of several staves, as a piano
 * is in MusicXML.
 */
function partsOf(staves: Any[]): number[][] {
  const parts: number[][] = [];
  for (let index = 0; index < staves.length; index++) {
    if (staves[index]?.brace === "start") {
      let end = index;
      while (end < staves.length - 1 && staves[end]?.brace !== "end") end++;
      const names = new Set(
        staves
          .slice(index, end + 1)
          .map(staffName)
          .filter(Boolean),
      );
      if (end > index && names.size <= 1) {
        parts.push(Array.from({ length: end - index + 1 }, (_, at) => index + at));
        index = end;
        continue;
      }
    }
    parts.push([index]);
  }
  return parts;
}

/** One tune (abcjs's parse of it) as a MusicXML 4.0 partwise document. */
export function exportMusicXml(
  tune: Any,
  options: { software?: string; date?: string } = {},
): string {
  const lines: Any[] = (tune.lines ?? []).filter((line: Any) => line.staff);
  const first = lines[0];
  const staves: Any[] = first?.staff ?? [];
  const meta = tune.metaText ?? {};
  // Every length in the tune, to choose divisions that write them all as whole numbers.
  let divisions = 1;
  for (const line of lines)
    for (const staff of line.staff ?? [])
      for (const voice of staff.voices ?? []) {
        let multiplier = 1;
        let left = 0;
        for (const element of voice) {
          if (element.el_type !== "note") continue;
          if (element.startTriplet) {
            multiplier = element.tripletMultiplier ?? 1;
            left = element.tripletR ?? element.startTriplet;
          }
          const lengths = [Number(element.duration ?? 0) * (left > 0 ? multiplier : 1)];
          for (const grace of element.gracenotes ?? []) lengths.push(Number(grace.duration ?? 0));
          for (const length of lengths) {
            const quarters = toFraction(length * 4);
            divisions = lcm(divisions, quarters.den);
          }
          if (left > 0) left -= 1;
        }
      }
  divisions = Math.min(divisions, 3840);
  const title = String(meta.title ?? "Untitled");
  const composers = String(meta.composer ?? "")
    .split("\n")
    .map((each) => each.trim())
    .filter(Boolean);
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="4.0">',
    `<work><work-title>${escapeXml(title)}</work-title></work>`,
    "<identification>",
  ];
  for (const composer of composers) {
    const words = /^Words:\s*(.+)$/i.exec(composer);
    out.push(
      words
        ? `<creator type="lyricist">${escapeXml(words[1] as string)}</creator>`
        : `<creator type="composer">${escapeXml(composer)}</creator>`,
    );
  }
  out.push(
    `<encoding><software>${escapeXml(options.software ?? "VoxDown Composer")}</software>${options.date ? `<encoding-date>${options.date}</encoding-date>` : ""}</encoding>`,
    "</identification>",
    "<part-list>",
  );
  const parts = partsOf(staves);
  const partIds = parts.map((_, index) => `P${index + 1}`);
  const partOfStaff = (staff: number) => parts.findIndex((part) => part.includes(staff));
  // Brackets, and braces over different instruments, as part groups (a bracket is group 1, a
  // brace group 2, so a brace can sit inside a bracket).
  type Group = { symbol: string; number: number; from: number; to: number };
  const groups: Group[] = [];
  for (const [symbol, flag, number] of [
    ["bracket", "bracket", 1],
    ["brace", "brace", 2],
  ] as const) {
    let from = -1;
    staves.forEach((staff, index) => {
      if (staff[flag] === "start") from = index;
      if (staff[flag] === "end" && from >= 0) {
        const first = partOfStaff(from);
        const last = partOfStaff(index);
        if (last > first) groups.push({ symbol, number, from: first, to: last });
        from = -1;
      }
    });
  }
  parts.forEach((part, index) => {
    for (const group of groups.filter((each) => each.from === index))
      out.push(
        `<part-group number="${group.number}" type="start"><group-symbol>${group.symbol}</group-symbol></part-group>`,
      );
    const name = part.map((staff) => staffName(staves[staff])).find(Boolean) ?? "";
    out.push(
      `<score-part id="${partIds[index]}"><part-name>${escapeXml(name)}</part-name></score-part>`,
    );
    for (const group of groups.filter((each) => each.to === index).reverse())
      out.push(`<part-group number="${group.number}" type="stop"/>`);
  });
  out.push("</part-list>");
  const meterLength = (() => {
    const meter = staves[0]?.meter;
    if (meter?.type === "common_time") return 1;
    if (meter?.type === "cut_time") return 1;
    const first = meter?.value?.[0];
    return first ? Number(first.num) / Number(first.den) : 0;
  })();
  parts.forEach((part, partIndex) => {
    out.push(`<part id="${partIds[partIndex]}">`);
    const several = part.length > 1;
    // Every voice of every staff in the part, numbered through the part.
    const voices: { staff: number; measures: Measure[]; context: Context }[] = [];
    for (const [position, staffIndex] of part.entries()) {
      const staff = staves[staffIndex];
      const voiceCount = Math.max(
        1,
        ...lines.map((line) => line.staff?.[staffIndex]?.voices?.length ?? 0),
      );
      for (let voice = 0; voice < voiceCount; voice++)
        voices.push({
          staff: position + 1,
          measures: measuresOf(lines, staffIndex, voice),
          context: {
            divisions,
            staff: several ? position + 1 : null,
            octave: clefOctave(staff?.clef),
            key: keyAccidentals(staff?.key),
            bar: new Map(),
            verses: new Map(),
            beam: false,
            triplet: null,
            slurNumbers: new Map(),
          },
        });
    }
    const firstStaff = staves[part[0] as number];
    // A voice's transpose= (abcjs ignores it under an octave clef).
    const transpose = clefOctave(firstStaff?.clef) ? 0 : Number(firstStaff?.clef?.transpose ?? 0);
    const measureCount = Math.max(...voices.map((voice) => voice.measures.length));
    let ending: string | null = null;
    let number = 0;
    for (let index = 0; index < measureCount; index++) {
      const main =
        voices[0]?.measures[index] ?? voices.find((each) => each.measures[index])?.measures[index];
      const body: string[] = [];
      let written = frac(0);
      let longest = 0;
      const directions: { placement: string; xml: string }[] = [];
      for (const [at, voice] of voices.entries()) {
        const measure = voice.measures[index];
        voice.context.bar = new Map();
        if (!measure) continue;
        if (at > 0 && value(written) > 0)
          body.push(`<backup>${durationXml(written, divisions)}</backup>`);
        const result = voiceMeasure(measure, at + 1, voice.context, directions);
        body.push(result.xml);
        written = result.length;
        longest = Math.max(longest, value(result.length));
      }
      // A short first measure is a pickup: measure 0, implicit.
      const implicit = index === 0 && meterLength > 0 && longest < meterLength - 1e-9;
      if (!implicit) number += 1;
      out.push(`<measure number="${number}"${implicit ? ' implicit="yes"' : ""}>`);
      if (index > 0 && main?.newSystem) out.push('<print new-system="yes"/>');
      if (index === 0) {
        const clefs = part
          .map((staff, position) =>
            staves[staff]?.clef ? clefXml(staves[staff].clef, several ? position + 1 : null) : "",
          )
          .join("");
        out.push(
          `<attributes><divisions>${divisions}</divisions>${keyXml(firstStaff?.key)}${timeXml(firstStaff?.meter)}${several ? `<staves>${part.length}</staves>` : ""}${clefs}${transposeXml(transpose)}</attributes>`,
        );
        if (partIndex === 0 && meta.tempo) out.push(tempoXml(meta.tempo));
      }
      const multi = main?.elements.find((element: Any) => element.rest?.type === "multimeasure");
      if (multi && Number(multi.rest.text) > 1)
        out.push(
          `<attributes><measure-style><multiple-rest>${Number(multi.rest.text)}</multiple-rest></measure-style></attributes>`,
        );
      out.push(barlineXml("left", main?.left ?? null, null));
      if (main?.left?.startEnding) ending = String(main.left.startEnding);
      out.push(body.join(""));
      // An ending closes at a repeat or a bar that ends it.
      let endingStop: string | null = null;
      if (
        ending &&
        main?.right &&
        (main.right.endEnding || /right_repeat|dbl_repeat/.test(main.right.type))
      ) {
        endingStop = ending;
        ending = null;
      }
      out.push(barlineXml("right", main?.right ?? null, endingStop));
      out.push("</measure>");
      // A multi-bar rest stands for several measures: write the rest of them as bar rests.
      if (multi && Number(multi.rest.text) > 1)
        for (let more = 1; more < Number(multi.rest.text); more++) {
          number += 1;
          const bar = durationXml(frac(Math.round(meterLength * 3840), 3840), divisions);
          const rests = part.map(
            (_, position) =>
              `<note><rest measure="yes"/>${bar}<voice>${voices.findIndex((voice) => voice.staff === position + 1) + 1}</voice>${several ? `<staff>${position + 1}</staff>` : ""}</note>`,
          );
          out.push(
            `<measure number="${number}">${rests.join(`<backup>${bar}</backup>`)}</measure>`,
          );
        }
    }
    out.push("</part>");
  });
  out.push("</score-partwise>");
  return `${out.join("\n")}\n`;
}
