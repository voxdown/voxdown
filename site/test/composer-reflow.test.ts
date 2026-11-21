import abcjs from "abcjs";
import { describe, expect, it } from "vitest";
import { keepSignatures } from "../src/composer/reflow";

/* biome-ignore lint/suspicious/noExplicitAny: abcjs objects. */
type Any = any;

const sig = (accidentals: Any[] | undefined) =>
  (accidentals ?? [])
    .filter((each: Any) => each.acc !== "natural")
    .map((each: Any) => `${each.acc === "sharp" ? "#" : "b"}${each.note.toLowerCase()}`)
    .join("");

/** Each drawn line, per staff: the key and clef it starts with, and the changes inside it. */
function lines(source: string, lineBreaks?: number[][]) {
  const tune = (abcjs as Any).parseOnly(source, lineBreaks ? { lineBreaks } : {})[0];
  keepSignatures(tune);
  return tune.lines
    .filter((line: Any) => line.staff)
    .map((line: Any) =>
      line.staff.map((staff: Any) => ({
        key: sig(staff.key.accidentals),
        clef: staff.clef.type,
        inside: staff.voices.map((voice: Any[]) =>
          voice
            .filter((element) => element.el_type === "key" || element.el_type === "clef")
            .map((element) =>
              element.el_type === "key" ? `K${sig(element.accidentals)}` : `clef=${element.type}`,
            )
            .join(" "),
        ),
      })),
    );
}
const keysOf = (drawn: Any[][]) => drawn.map((line) => line.map((staff: Any) => staff.key));
const insideOf = (drawn: Any[][]) => drawn.map((line) => line.map((staff: Any) => staff.inside));

describe("key signatures and clefs survive the score's reflow", () => {
  const head = "X:1\nT:t\nM:6/8\nL:1/8\n";
  it("C to G mid-line, then two more source lines, drawn two bars a line", () => {
    const source = `${head}K:C\nEFG BGE | [K:G] DEF AFD |\nEFG Bde |\ncde dBG |]\n`;
    const drawn = lines(source, [[1]]);
    expect(keysOf(drawn)).toEqual([[""], ["#f"]]);
    // The change is drawn once, where it is written; nothing repeats it at the source's joins.
    expect(insideOf(drawn)).toEqual([[["K#f"]], [[""]]]);
  });
  it("E minor to G (the same signature) draws nothing", () => {
    for (const source of [
      `${head}K:Em\nEFG BGE | [K:G] DEF AFD |\nEFG Bde |\ncde dBG |]\n`,
      `${head}K:Em\nEFG BGE |\nK:G\nDEF AFD |\nEFG Bde |\ncde dBG |]\n`,
    ]) {
      const drawn = lines(source, [[1]]);
      expect(keysOf(drawn)).toEqual([["#f"], ["#f"]]);
      expect(insideOf(drawn)).toEqual([[[""]], [[""]]]);
    }
  });
  it("D to F, a change at a line start of the source, drawn across a break", () => {
    const source = `${head}K:D\nDEF ABc | [K:F] FGA Bcd |\nfed cBA |\nFGA Bcd |]\n`;
    const drawn = lines(source, [[0, 2]]);
    expect(keysOf(drawn)).toEqual([["#f#c"], ["#f#c"], ["bb"]]);
    expect(insideOf(drawn)).toEqual([[[""]], [["Kbb"]], [[""]]]);
  });
  it("a key change that falls at the start of a drawn line", () => {
    const source = `${head}K:C\nEFG BGE | [K:G] DEF AFD |\nEFG Bde |\ncde dBG |]\n`;
    const drawn = lines(source, [[0, 2]]);
    expect(keysOf(drawn)).toEqual([[""], [""], ["#f"]]);
    expect(insideOf(drawn)).toEqual([[[""]], [["K#f"]], [[""]]]);
  });
  it("two voices, each keeping one change", () => {
    const source = `${head}K:C\nV:1\nEFG BGE | [K:G] DEF AFD |\nV:2\nC3 E3 | [K:G] D3 F3 |\nV:1\nEFG Bde | cde dBG |]\nV:2\nC3 E3 | D3 G3 |]\n`;
    const drawn = lines(source, [[1]]);
    expect(keysOf(drawn)).toEqual([
      ["", ""],
      ["#f", "#f"],
    ]);
    expect(insideOf(drawn)).toEqual([
      [["K#f"], ["K#f"]],
      [[""], [""]],
    ]);
  });
  it("an inline [K:] with a clef: later lines start in the new clef, the clef drawn once", () => {
    const source =
      "X:1\nT:t\nM:4/4\nL:1/8\nK:C\nCDEF GABc | [K:G clef=bass] C,D,E,F, G,A,B,C |\nC,D,E,F, G,A,B,C | C,D,E,F, G,A,B,C |]\n";
    const drawn = lines(source, [[0, 2]]);
    expect(drawn.map((line: Any[]) => line[0].clef)).toEqual(["treble", "treble", "bass"]);
    expect(keysOf(drawn)).toEqual([[""], [""], ["#f"]]);
    expect(insideOf(drawn)).toEqual([[[""]], [["clef=bass K#f"]], [[""]]]);
  });
  it("[M:], [L:] and [Q:] are drawn once, where they are written", () => {
    const source =
      "X:1\nT:t\nM:4/4\nL:1/8\nK:C\nCDEF GABc | [M:3/4][L:1/4][Q:1/4=90] C D E |\nC D E |\nC D E |]\n";
    const tune = (abcjs as Any).parseOnly(source, { lineBreaks: [[1]] })[0];
    keepSignatures(tune);
    const kinds = tune.lines
      .filter((line: Any) => line.staff)
      .map((line: Any) =>
        line.staff[0].voices[0]
          .filter((element: Any) => ["meter", "tempo"].includes(element.el_type))
          .map((element: Any) => element.el_type)
          .join(" "),
      );
    expect(kinds).toEqual(["meter tempo", ""]);
    // The meter isn't repeated at a reflowed line's start either.
    expect(tune.lines.filter((line: Any) => line.staff)[1].staff[0].meter).toBeUndefined();
  });
  it("leaves an unreflowed tune as written, a K: line's change included", () => {
    const source = `${head}K:D\nDEF ABc |\nK:F clef=bass\nFGA Bcd |]\n`;
    const drawn = lines(source);
    expect(keysOf(drawn)).toEqual([["#f#c"], ["bb"]]);
    expect(drawn.map((line: Any[]) => line[0].clef)).toEqual(["treble", "bass"]);
  });
});
