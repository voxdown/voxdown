import { describe, expect, it } from "vitest";
import { frac } from "../src/composer/abc";
import { beatOf, readingAt, stepText } from "../src/composer/stepentry";
import { indexFile } from "../src/composer/tunes";

/** What step entry writes for each step at the end of a tune, one after another. */
function steps(header: string, music: string, played: (number[] | "rest")[], length = frac(1, 8)) {
  const text = `X:1\nT:Steps\n${header}\n${music}`;
  const file = indexFile(text);
  const reading = readingAt(text, file, text.length);
  if (!reading) throw new Error("no reading");
  return played.map((pitches) => stepText(pitches, length, reading)).join(" ");
}

describe("step entry", () => {
  it("spells for keys with sharps and with flats", () => {
    // D major: F♯ and C♯ need nothing; F natural does, and a sharp key spells A♯.
    expect(steps("M:4/4\nL:1/8\nK:D", "", [[62], [66], [73], [65], [70]])).toBe("D F c =F ^A");
    // F major: B♭ needs nothing, B natural does; E♭ is spelled flat.
    expect(steps("M:4/4\nL:1/8\nK:F", "", [[70], [71], [63], [65]])).toBe("B =B _E F");
    // C major: F♯, C♯, G♯, but E♭ and B♭.
    expect(steps("M:4/4\nL:1/8\nK:C", "", [[66], [61], [68], [63], [70]])).toBe("^F ^C ^G _E _B");
  });
  it("keeps to the accidentals already in the bar, and to a new bar's", () => {
    // After ^F in the bar, F♯ needs no mark, and F natural needs one.
    expect(steps("M:4/4\nL:1/8\nK:C", "^F", [[66], [65]])).toBe("F =F");
    expect(steps("M:4/4\nL:1/8\nK:C", "^F |", [[66]])).toBe("^F");
  });
  it("writes chords, rests and lengths in the tune's unit", () => {
    expect(steps("M:4/4\nL:1/8\nK:G", "", [[67, 71, 62]])).toBe("[DGB]");
    expect(steps("M:4/4\nL:1/8\nK:G", "", ["rest"])).toBe("z");
    expect(steps("M:4/4\nL:1/4\nK:G", "", [[67]], frac(1, 8))).toBe("G/");
    expect(steps("M:4/4\nL:1/8\nK:G", "", [[67]], frac(3, 8))).toBe("G3");
    expect(steps("M:4/4\nL:1/16\nK:G", "", [[67]], frac(1))).toBe("G16");
  });
  it("writes octaves for the voice's clef, octave clefs and transpose= included", () => {
    // Middle C (60) in a treble voice is C; in treble-8 it is written an octave up, c.
    expect(steps("M:4/4\nL:1/8\nK:C", "", [[60]])).toBe("C");
    expect(steps("M:4/4\nL:1/8\nV:1 clef=treble-8\nK:C", "V:1\n", [[60], [48]])).toBe("c C");
    expect(steps("M:4/4\nL:1/8\nV:1 clef=bass\nK:C", "V:1\n", [[48], [43]])).toBe("C, G,,");
    expect(steps("M:4/4\nL:1/8\nV:1 clef=treble transpose=-12\nK:C", "V:1\n", [[40]])).toBe("E,");
    expect(steps("M:4/4\nL:1/8\nK:C clef=bass-8", "", [[36]])).toBe("C,");
  });
  it("reads the voice the caret is in", () => {
    const text = "X:1\nT:Two\nM:4/4\nL:1/8\nV:1\nV:2 clef=treble-8\nK:C\nV:1\nC D E F|\nV:2\nC D";
    const reading = readingAt(text, indexFile(text), text.length);
    expect(reading?.voice).toBe("2");
    expect(reading?.shift).toBe(-12);
  });
  it("knows the beat: a dotted quarter in 6/8", () => {
    expect(beatOf("4/4")).toBe(0.25);
    expect(beatOf("6/8")).toBe(0.375);
    expect(beatOf("C|")).toBe(0.5);
  });
});
