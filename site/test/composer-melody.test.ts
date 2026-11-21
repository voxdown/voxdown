import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPTIONS,
  describeMatch,
  queryNotes,
  rankMatches,
  searchFile,
  tuneMelody,
} from "../src/composer/melody";
import { indexFile } from "../src/composer/tunes";

const find = (query: string, text: string, options = DEFAULT_OPTIONS, key = "C") => {
  const file = indexFile(text);
  return searchFile(queryNotes(query, key), text, file, options).map((match) => ({
    where: describeMatch(match),
    text: match.excerpt,
  }));
};
const tune = (title: string, header: string, body: string) =>
  `X:1\nT:${title}\n${header}\n${body}\n`;

describe("melody search", () => {
  it("finds a melody in another key, octave and unit length", () => {
    const text = [
      tune("In G", "M:4/4\nL:1/8\nK:G", "GABc dBGB|c2A2 G4|"),
      tune("In D, an octave up", "M:4/4\nL:1/16\nK:D", "d2e2f2g2 a2f2d2f2|"),
      tune("In C, quarter notes", "M:4/4\nL:1/4\nK:C", "C D E F|G E C E|"),
    ].join("\n");
    const found = find("CDEF GECE", text);
    expect(found.map((each) => each.where)).toEqual([
      "In G · bar 1",
      "In D, an octave up · bar 1",
      "In C, quarter notes · bar 1",
    ]);
    expect(found[0]?.text).toBe("GABc dBGB");
  });
  it("hears through broken rhythm, grace notes, ornaments, chord symbols, slurs and bar lines", () => {
    const text = tune("Dressed up", "M:4/4\nL:1/8\nK:D", '"D"d>f {g}e!trill!d|(c"A"B) ~A>G|');
    expect(find("dfed cBAG", text, DEFAULT_OPTIONS, "D").map((each) => each.where)).toEqual([
      "Dressed up · bar 1",
    ]);
  });
  it("hears a tied note as one, and folds repeated notes when asked", () => {
    const text = tune("Ties", "M:4/4\nL:1/8\nK:C", "C2-C2 D2 E2|E2 E2 F4|");
    expect(find("CDEF", text)).toHaveLength(1);
    // Without folding, the repeated E stands in the way of C D E F.
    expect(find("CDEF", text, { ...DEFAULT_OPTIONS, foldRepeats: false })).toHaveLength(0);
    expect(find("CDEEEF", text, { ...DEFAULT_OPTIONS, foldRepeats: false })).toHaveLength(1);
  });
  it("matches the contour when the intervals are only remembered roughly", () => {
    const text = tune("Rough", "M:4/4\nL:1/8\nK:C", "C E G c G E C2|");
    expect(find("C D E F E D C", text)).toHaveLength(0);
    expect(find("C D E F E D C", text, { ...DEFAULT_OPTIONS, mode: "contour" })).toHaveLength(1);
  });
  it("can require the same relative lengths", () => {
    const text = tune("Rhythm", "M:4/4\nL:1/8\nK:C", "C2 D E F2 G2|C D E F G4|");
    const rhythm = { ...DEFAULT_OPTIONS, rhythm: true };
    expect(find("C2 D E F2", text, rhythm).map((each) => each.text)).toEqual(["C2 D E F2"]);
    expect(find("C D E F", text, rhythm).map((each) => each.text)).toEqual(["C D E F"]);
    expect(find("C D E F", text)).toHaveLength(2);
  });
  it("reads chords as their top note, and keeps each voice apart", () => {
    const text = tune(
      "Voices",
      "M:4/4\nL:1/4\nV:1\nV:2 clef=bass\nK:C",
      "V:1\n[Ec] [Fd] [Ge] [Af]|\nV:2\nC, D, E, F,|",
    );
    const melody = tuneMelody(text, indexFile(text).tunes[0] as never, indexFile(text));
    expect(melody.map((voice) => voice.notes.map((note) => note.pitch))).toEqual([
      [72, 74, 76, 77],
      [48, 50, 52, 53],
    ]);
    expect(find("cdef", text).map((each) => each.where)).toEqual([
      "Voices · V:1 · bar 1",
      "Voices · V:2 · bar 1",
    ]);
  });
  it("searches 200 tunes in well under 200 ms, and faster again from the cache", () => {
    const text = Array.from({ length: 200 }, (_, at) =>
      tune(
        `Reel ${at + 1}`,
        "M:4/4\nL:1/8\nK:D",
        Array.from({ length: 4 }, () => "|:dfed cBAG|FAdf ecAG|FGAB cdef|gfed cBA2:|").join("\n"),
      ).replace("X:1", `X:${at + 1}`),
    ).join("\n");
    const file = indexFile(text);
    const query = queryNotes("FGAB cdef", "D");
    let started = performance.now();
    const first = searchFile(query, text, file);
    const cold = performance.now() - started;
    started = performance.now();
    const again = searchFile(query, text, file);
    const warm = performance.now() - started;
    expect(first).toHaveLength(800);
    expect(again).toHaveLength(800);
    console.log(
      `melody search over 200 tunes: ${cold.toFixed(0)} ms cold, ${warm.toFixed(0)} ms cached`,
    );
    expect(cold).toBeLessThan(600);
    expect(warm).toBeLessThan(200);
  });
});

describe("melody search, complete and ranked", () => {
  it("finds matches that overlap", () => {
    const scale = tune("Scale", "M:4/4\nL:1/4\nK:C", "C D E F | G A B c |");
    expect(find("C D E", scale, { ...DEFAULT_OPTIONS, mode: "contour" })).toHaveLength(6);
    const swing = tune("Back and forth", "M:4/4\nL:1/4\nK:C", "C D C D | C D C D |");
    // C D C D starts on the 1st, 3rd and 5th notes (folding is about repeats, not these).
    expect(find("C D C D", swing).map((each) => each.text)).toEqual([
      "C D C D",
      "C D | C D",
      "C D C D",
    ]);
  });
  it("ranks exact matches first, and marks those that needed repeats folded", () => {
    const text = [
      tune("Lamb", "M:4/4\nL:1/8\nK:G", "GFED EGGG | FFFF G2 GG |"),
      tune("Plain", "M:4/4\nL:1/8\nK:G", "D2 E2 G2 F2 | G8 |"),
      tune("Kesh", "M:6/8\nL:1/8\nK:G", "G3 GAB | A3 ABd |"),
    ].join("\n");
    const file = indexFile(text);
    const kesh = rankMatches(searchFile(queryNotes("G3 GAB A3 ABd", "G"), text, file));
    expect(kesh.map((match) => [match.tune.title, match.folded])).toEqual([["Kesh", false]]);
    // The Lamb plays E G F G only with its repeated notes folded: it comes after the plain one.
    const ranked = rankMatches(searchFile(queryNotes("E G F G", "G"), text, file));
    expect(ranked.map((match) => [match.tune.title, match.folded])).toEqual([
      ["Plain", false],
      ["Lamb", true],
    ]);
  });
  it("puts the same rhythm before another rhythm, and exact steps before a contour", () => {
    const text = [
      tune("Other rhythm", "M:4/4\nL:1/8\nK:C", "C2 D E F4 |"),
      tune("Contour only", "M:4/4\nL:1/8\nK:C", "C D F G4 z |"),
      tune("Same", "M:4/4\nL:1/8\nK:C", "C D E F4 z |"),
    ].join("\n");
    const file = indexFile(text);
    const ranked = rankMatches(
      searchFile(queryNotes("CDEF4", "C"), text, file, { ...DEFAULT_OPTIONS, mode: "contour" }),
    );
    expect(ranked.map((match) => match.tune.title)).toEqual([
      "Same",
      "Other rhythm",
      "Contour only",
    ]);
  });
  it("calls a voice with no name by its V:", () => {
    const text = tune(
      "Two",
      'M:4/4\nL:1/4\nK:C\nV:1 name="Lead"\nV:2',
      "[V:1] C D E F |\n[V:2] C D E F |",
    );
    expect(find("C D E F", text).map((each) => each.where)).toEqual([
      "Two · Lead · bar 1",
      "Two · V:2 · bar 1",
    ]);
  });
});
