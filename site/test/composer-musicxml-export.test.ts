import abcjs from "abcjs";
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../src/composer/examples";
import { exportMusicXml, harmonyXml, typeOf } from "../src/composer/musicxml/export";
import { type XmlElement, parseXml } from "../src/composer/musicxml/xml";
import { MORE } from "./musicxml-cases";

/**
 * Element order in MusicXML 4.0 (from the XSD's sequences), for the elements export writes:
 * each child must come no earlier than the one before it.
 */
const ORDER: Record<string, string[]> = {
  "score-partwise": [
    "work",
    "movement-number",
    "movement-title",
    "identification",
    "defaults",
    "credit",
    "part-list",
    "part",
  ],
  work: ["work-number", "work-title", "opus"],
  identification: ["creator", "rights", "encoding", "source", "relation", "miscellaneous"],
  encoding: ["encoding-date", "encoder", "software", "encoding-description", "supports"],
  "score-part": [
    "identification",
    "part-link",
    "part-name",
    "part-name-display",
    "part-abbreviation",
  ],
  attributes: [
    "footnote",
    "level",
    "divisions",
    "key",
    "time",
    "staves",
    "part-symbol",
    "instruments",
    "clef",
    "staff-details",
    "transpose",
    "for-part",
    "directive",
    "measure-style",
  ],
  key: ["cancel", "fifths", "mode", "key-octave"],
  time: ["beats", "beat-type", "interchangeable", "senza-misura"],
  clef: ["sign", "line", "clef-octave-change"],
  note: [
    "grace",
    "cue",
    "chord",
    "pitch",
    "unpitched",
    "rest",
    "duration",
    "tie",
    "instrument",
    "footnote",
    "level",
    "voice",
    "type",
    "dot",
    "accidental",
    "time-modification",
    "stem",
    "notehead",
    "notehead-text",
    "staff",
    "beam",
    "notations",
    "lyric",
    "play",
    "listen",
  ],
  pitch: ["step", "alter", "octave"],
  "time-modification": ["actual-notes", "normal-notes", "normal-type", "normal-dot"],
  barline: [
    "bar-style",
    "footnote",
    "level",
    "wavy-line",
    "segno",
    "coda",
    "fermata",
    "ending",
    "repeat",
  ],
  direction: [
    "direction-type",
    "offset",
    "footnote",
    "level",
    "voice",
    "staff",
    "sound",
    "listening",
  ],
  harmony: [
    "root",
    "numeral",
    "function",
    "kind",
    "inversion",
    "bass",
    "degree",
    "frame",
    "offset",
    "footnote",
    "level",
    "staff",
  ],
  root: ["root-step", "root-alter"],
  bass: ["bass-separator", "bass-step", "bass-alter"],
  metronome: ["beat-unit", "beat-unit-dot", "beat-unit-tied", "per-minute"],
  lyric: [
    "syllabic",
    "text",
    "elision",
    "extend",
    "laughing",
    "humming",
    "end-line",
    "end-paragraph",
    "footnote",
    "level",
  ],
  measure: [],
};
/** Children whose order may repeat in a pattern (a lyric's syllables, a measure's music). */
// part-list is part-group*, score-part, then part-group or score-part in any order; encoding's
// children are a choice in any order.
const FREE = new Set([
  "measure",
  "notations",
  "direction-type",
  "articulations",
  "ornaments",
  "technical",
  "lyric",
  "dynamics",
  "part",
  "part-list",
  "encoding",
]);

function checkOrder(element: XmlElement, problems: string[], path = element.name) {
  const order = ORDER[element.name];
  if (order && !FREE.has(element.name)) {
    let last = -1;
    for (const child of element.children) {
      const at = order.indexOf(child.name);
      if (at < 0) problems.push(`${path}: <${child.name}> is not allowed`);
      else if (at < last) problems.push(`${path}: <${child.name}> comes too late`);
      else last = at;
    }
  }
  for (const child of element.children) checkOrder(child, problems, `${path}/${child.name}`);
}

function roundTrip(text: string) {
  const before = abcjs.parseOnly(text)[0] as never;
  const xml = exportMusicXml(before);
  return { xml, before };
}

describe("MusicXML export", () => {
  it("writes note types and dots", () => {
    expect(typeOf(0.375)).toEqual({ type: "quarter", dots: 1 });
    expect(typeOf(0.4375)).toEqual({ type: "quarter", dots: 2 });
    expect(typeOf(1)).toEqual({ type: "whole", dots: 0 });
    expect(typeOf(0.3)).toBeNull();
  });
  it("writes chord symbols as harmony", () => {
    expect(harmonyXml("Am7")).toBe(
      "<harmony><root><root-step>A</root-step></root><kind>minor-seventh</kind></harmony>",
    );
    expect(harmonyXml("F#m7b5/C")).toContain(
      "<root-alter>1</root-alter></root><kind>half-diminished</kind><bass><bass-step>C</bass-step></bass>",
    );
    expect(harmonyXml("Gadd9")).toContain('<kind text="add9">other</kind>');
  });
  it("writes valid MusicXML 4.0 partwise, its elements in the schema's order", () => {
    const texts = [...EXAMPLES.map((example) => example.text), ...MORE.map(([, text]) => text)];
    for (const text of texts) {
      const { xml } = roundTrip(text);
      const root = parseXml(xml);
      expect(root.name).toBe("score-partwise");
      expect(root.attrs.version).toBe("4.0");
      const problems: string[] = [];
      checkOrder(root, problems);
      expect(problems).toEqual([]);
    }
  });
  it("keeps the title, composer, lyricist, tempo, parts and the brace", () => {
    const frere = EXAMPLES.find((example) => example.id === "frere") ?? EXAMPLES[3];
    const { xml } = roundTrip((frere as { text: string }).text);
    expect(xml).toContain("<work-title>Frère Jacques</work-title>");
    expect(xml).toContain('<creator type="composer">Traditional</creator>');
    expect(xml).toContain("<per-minute>104</per-minute>");
    expect(xml).toContain('<score-part id="P1"><part-name>First</part-name></score-part>');
    const { xml: voices } = roundTrip((MORE[0] as [string, string])[1]);
    expect(voices).toContain(
      '<part-group number="1" type="start"><group-symbol>brace</group-symbol></part-group>',
    );
    expect(voices).toContain("<backup>");
  });
});
