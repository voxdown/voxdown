/**
 * Names in words that the start of the editor needs before the caret explainer loads: what a
 * decoration, a meter and a key are called.
 */
import type { Key } from "./abc";

export const DECORATIONS: Record<string, string> = {
  trill: "trill",
  "trill(": "start of an extended trill",
  "trill)": "end of an extended trill",
  lowermordent: "lower mordent",
  uppermordent: "upper mordent",
  mordent: "mordent",
  pralltriller: "pralltriller (upper mordent)",
  roll: "roll (Irish ornament)",
  turn: "turn",
  turnx: "turn with a line through it",
  invertedturn: "inverted turn",
  arpeggio: "arpeggiated chord",
  ">": "accent",
  accent: "accent",
  emphasis: "accent",
  fermata: "fermata (pause)",
  invertedfermata: "inverted fermata",
  tenuto: "tenuto (held full length)",
  "0": "fingering 0",
  "1": "fingering 1",
  "2": "fingering 2",
  "3": "fingering 3",
  "4": "fingering 4",
  "5": "fingering 5",
  "+": "left-hand pizzicato",
  plus: "left-hand pizzicato",
  snap: "snap pizzicato",
  slide: "slide up into the note",
  wedge: "wedge (staccatissimo)",
  upbow: "up bow",
  downbow: "down bow",
  open: "open string or harmonic",
  thumb: "cello thumb",
  breath: "breath mark",
  pppp: "dynamic pppp, as soft as possible",
  ppp: "dynamic ppp, very very soft",
  pp: "dynamic pp, very soft",
  p: "dynamic p, soft",
  mp: "dynamic mp, moderately soft",
  mf: "dynamic mf, moderately loud",
  f: "dynamic f, loud",
  ff: "dynamic ff, very loud",
  fff: "dynamic fff, very very loud",
  ffff: "dynamic ffff, as loud as possible",
  sfz: "sforzando, a sudden accent",
  "crescendo(": "start of a crescendo",
  "<(": "start of a crescendo",
  "crescendo)": "end of a crescendo",
  "<)": "end of a crescendo",
  "diminuendo(": "start of a diminuendo",
  ">(": "start of a diminuendo",
  "diminuendo)": "end of a diminuendo",
  ">)": "end of a diminuendo",
  segno: "segno 𝄋: where D.S. goes back to",
  coda: "coda 𝄌: where al Coda goes on from",
  "D.S.": "D.S.: go back to 𝄋 and play to the end (or to Fine, if there is one)",
  "D.C.": "D.C.: go back to the start and play to the end (or to Fine, if there is one)",
  "D.C.alfine": "D.C. al Fine: go back to the start, play to Fine",
  "D.C.alcoda": "D.C. al Coda: go back to the start, play to To Coda, then jump to 𝄌",
  "D.S.alfine": "D.S. al Fine: go back to 𝄋, play to Fine",
  "D.S.alcoda": "D.S. al Coda: go back to 𝄋, play to To Coda, then jump to 𝄌",
  dacoda: "To Coda: on the way back after a D.C. or D.S., jump from here to 𝄌",
  dacapo: "Da Capo: go back to the start",
  fine: "Fine: where the piece ends after a D.C. or D.S.",
  shortphrase: "short phrase mark",
  mediumphrase: "medium phrase mark",
  longphrase: "long phrase mark",
  staccato: "staccato",
  editorial: "editorial accidental",
  courtesy: "courtesy accidental",
};

export function describeMeter(meter: string): string {
  const text = meter.trim();
  if (text === "C") return "common time, four quarter notes a bar";
  if (text === "C|") return "cut time, two half notes a bar";
  if (/^none$/i.test(text)) return "free time, no bar length";
  const match = /^([0-9+]+)\/([0-9]+)/.exec(text);
  if (!match) return text;
  const top = (match[1] as string).split("+").reduce((sum, part) => sum + Number(part), 0);
  const bottom = Number(match[2]);
  const names: Record<number, [string, string]> = {
    1: ["whole note", "whole notes"],
    2: ["half note", "half notes"],
    4: ["quarter note", "quarter notes"],
    8: ["eighth note", "eighth notes"],
    16: ["sixteenth note", "sixteenth notes"],
  };
  const [one, many] = names[bottom] ?? [`1/${bottom} note`, `1/${bottom} notes`];
  const compound = top % 3 === 0 && top > 3 && bottom >= 8;
  const feel = compound ? `, ${top / 3} dotted beats` : "";
  return `${top} ${top === 1 ? one : many} a bar${feel}`;
}

export function describeKey(key: Key): string {
  const count = Math.abs(key.fifths);
  const signature =
    key.fifths === 0
      ? "no sharps or flats"
      : `${count} ${key.fifths > 0 ? (count === 1 ? "sharp" : "sharps") : count === 1 ? "flat" : "flats"}`;
  return key.tonic ? `${key.name}, ${signature}` : "no key signature";
}
