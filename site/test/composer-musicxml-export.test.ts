import { readFileSync } from "node:fs";
import abcjs from "abcjs";
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../src/composer/examples";
import { exportMusicXml, harmonyXml, typeOf } from "../src/composer/musicxml/export";
import { importMusicXml } from "../src/composer/musicxml/import";
import { type XmlElement, parseXml } from "../src/composer/musicxml/xml";
import { MORE } from "./musicxml-cases";
import { musicOf } from "./musicxml-music";

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
  degree: ["degree-value", "degree-alter", "degree-type"],
  transpose: ["diatonic", "chromatic", "octave-change", "double"],
  forward: ["duration", "footnote", "level", "voice", "staff"],
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
    expect(harmonyXml("Gadd9")).toContain(
      "<kind>major</kind><degree><degree-value>9</degree-value><degree-alter>0</degree-alter><degree-type>add</degree-type></degree>",
    );
    expect(harmonyXml("C7b9")).toContain(
      "<kind>dominant</kind><degree><degree-value>9</degree-value><degree-alter>-1</degree-alter><degree-type>add</degree-type></degree>",
    );
    expect(harmonyXml("Gsus%")).toContain('<kind text="sus%">other</kind>');
  });
  it("writes valid MusicXML 4.0 partwise, its elements in the schema's order", () => {
    const texts = [
      ...EXAMPLES.map((example) => example.text),
      ...MORE.map(([, text]) => text),
      // Octave clefs, an octave-transposing voice, chord degrees and jumps with their sounds.
      'X:1\nT:Octaves\nM:2/4\nL:1/4\n%%score {1 2} 3\nV:1 name="Guitar" clef=treble-8\nV:2 clef=bass-8\nV:3 name="Piccolo" transpose=12\nK:C\nV:1\n!segno!"C7b9"c x | !D.S.alfine!c2 |]\nV:2\nC, x | C,2 |]\nV:3\n"G7sus4"c d | !fine!e2 |]\n',
    ];
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
    expect(voices).toContain("<backup>");
  });
  it("sends the piano fixture out as one part of two staves, and back in as a grand staff", async () => {
    const xml = readFileSync(
      new URL("./fixtures/musicxml/grand-staff-dorico.musicxml", import.meta.url),
      "utf8",
    );
    const { text } = await importMusicXml([xml]);
    expect(text).toContain("%%score {(1 2) 3}");
    const out = parseXml(exportMusicXml(abcjs.parseOnly(text)[0] as never));
    // As MuseScore reads it: one part (the piano), two staves, each note on its staff.
    const list = out.children.find((each) => each.name === "part-list") as XmlElement;
    expect(list.children.filter((each) => each.name === "score-part")).toHaveLength(1);
    expect(list.children.filter((each) => each.name === "part-group")).toHaveLength(0);
    const part = out.children.find((each) => each.name === "part") as XmlElement;
    const attributes = (part.children[0] as XmlElement).children.find(
      (each) => each.name === "attributes",
    ) as XmlElement;
    expect(attributes.children.find((each) => each.name === "staves")?.text).toBe("2");
    const staves = new Set<string>();
    for (const measure of part.children)
      for (const note of measure.children.filter((each) => each.name === "note"))
        staves.add(note.children.find((each) => each.name === "staff")?.text ?? "none");
    expect([...staves].sort()).toEqual(["1", "2"]);
    // And back in: the same grand staff, the same music.
    const { text: again } = await importMusicXml([
      exportMusicXml(abcjs.parseOnly(text)[0] as never),
    ]);
    expect(again.match(/%%score .*/)?.[0]).toBe(text.match(/%%score .*/)?.[0]);
    expect(musicOf(abcjs.parseOnly(again)[0] as never).voices).toEqual(
      musicOf(abcjs.parseOnly(text)[0] as never).voices,
    );
  });
  it("writes a grand staff as one part of two staves, as MuseScore reads a piano", () => {
    // %%score {(1 2) 3}: a piano, named once, with two voices in the right hand.
    const { xml } = roundTrip((MORE[0] as [string, string])[1]);
    const root = parseXml(xml);
    const list = root.children.find((each) => each.name === "part-list") as XmlElement;
    expect(list.children.map((each) => each.name)).toEqual(["score-part"]);
    const parts = root.children.filter((each) => each.name === "part");
    expect(parts).toHaveLength(1);
    const measure = (parts[0] as XmlElement).children[0] as XmlElement;
    const attributes = measure.children.find((each) => each.name === "attributes") as XmlElement;
    expect(attributes.children.find((each) => each.name === "staves")?.text).toBe("2");
    expect(
      attributes.children.filter((each) => each.name === "clef").map((each) => each.attrs.number),
    ).toEqual(["1", "2"]);
    const notes = measure.children.filter((each) => each.name === "note");
    const staffOf = (note: XmlElement) => note.children.find((each) => each.name === "staff")?.text;
    const voiceOf = (note: XmlElement) => note.children.find((each) => each.name === "voice")?.text;
    expect(notes.map((note) => `${voiceOf(note)}/${staffOf(note)}`)).toEqual([
      "1/1",
      "1/1",
      "1/1",
      "2/1",
      "3/2",
    ]);
    expect(measure.children.filter((each) => each.name === "backup")).toHaveLength(2);
    // Brackets and braces between different instruments stay part groups.
    const { xml: band } = roundTrip(
      'X:1\nT:Band\nM:4/4\nL:1/4\n%%score [1 {2 3}]\nV:1 name="Flute"\nV:2 name="Violin"\nV:3 name="Cello" clef=bass\nK:C\nV:1\nC4|]\nV:2\nC4|]\nV:3\nC,4|]\n',
    );
    expect(band).toContain(
      '<part-group number="1" type="start"><group-symbol>bracket</group-symbol></part-group>\n<score-part id="P1">',
    );
    expect(band).toContain(
      '<part-group number="2" type="start"><group-symbol>brace</group-symbol></part-group>\n<score-part id="P2">',
    );
    expect(band).toContain(
      '<score-part id="P3"><part-name>Cello</part-name></score-part>\n<part-group number="2" type="stop"/>\n<part-group number="1" type="stop"/>',
    );
  });
});
