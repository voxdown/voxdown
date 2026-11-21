import { describe, expect, it } from "vitest";
import {
  bracketOver,
  copyWithBars,
  cutKeepingBars,
  pasteKeepingBars,
  replaceKeepingBars,
} from "../src/composer/barwise";
import type { Change } from "../src/composer/commands";

const apply = (text: string, changes: Change[] | null) => {
  if (!changes) return null;
  let out = text;
  for (const change of [...changes].sort((a, b) => b.from - a.from))
    out = out.slice(0, change.from) + change.insert + out.slice(change.to);
  return out;
};
const head = "X:1\nT:t\nM:4/4\nL:1/4\nK:C\n";
const tune = `${head}c d e f|g a b c'|c' b a g|f e d c|]\n`;
const at = (text: string, part: string, from = 0) => text.indexOf(part, from);
const span = (text: string, part: string) => ({
  from: at(text, part),
  to: at(text, part) + part.length,
});

describe("typing over selected music keeps its bar lines", () => {
  it("Backspace over two bars' notes leaves the bar line between", () => {
    const range = span(tune, "e f|g a");
    expect(apply(tune, replaceKeepingBars(tune, [range], ""))).toBe(
      `${head}c d | b c'|c' b a g|f e d c|]\n`,
    );
  });
  it("typing z4 over bar 1 and bar 2 writes it once, the bar lines kept apart", () => {
    const range = span(tune, "c d e f|g a b c'");
    expect(apply(tune, replaceKeepingBars(tune, [range], "z4"))).toBe(
      `${head}z4| |c' b a g|f e d c|]\n`,
    );
  });
  it("repeats, final bars and endings stay", () => {
    const text = `${head}|: c d e f :|[1 g a b c' :|[2 g2 c2|]\n`;
    const range = { from: at(text, "d"), to: at(text, "g2") + 2 };
    const out = apply(text, replaceKeepingBars(text, [range], "")) as string;
    expect(out).toContain(":|[1");
    expect(out).toContain(":|[2");
    expect(out).toContain("|]");
  });
  it("a selection without a bar line inside is left to the editor", () => {
    expect(replaceKeepingBars(tune, [span(tune, "d e")], "")).toBeNull();
  });
  it("a bar line selected alone deletes as text", () => {
    const bar = at(tune, "|g");
    expect(replaceKeepingBars(tune, [{ from: bar, to: bar + 1 }], "")).toBeNull();
  });
  it("a header in the selection is left to the editor", () => {
    expect(replaceKeepingBars(tune, [{ from: 0, to: tune.length }], "")).toBeNull();
  });
});

describe("cut takes whole bars out with one bar line", () => {
  it("bar 2 goes with the bar line after it", () => {
    expect(apply(tune, cutKeepingBars(tune, [span(tune, "g a b c'")]))).toBe(
      `${head}c d e f|c' b a g|f e d c|]\n`,
    );
  });
  it("the last bar goes with the plain bar line before it, the final bar kept", () => {
    expect(apply(tune, cutKeepingBars(tune, [span(tune, "f e d c")]))).toBe(
      `${head}c d e f|g a b c'|c' b a g|]\n`,
    );
  });
  it("bars 2 and 3 go as one run: no empty bar is left", () => {
    expect(apply(tune, cutKeepingBars(tune, [span(tune, "g a b c'|c' b a g")]))).toBe(
      `${head}c d e f|f e d c|]\n`,
    );
  });
  it("part of a bar loses only its notes", () => {
    expect(apply(tune, cutKeepingBars(tune, [span(tune, "e f|g a")]))).toBe(
      `${head}c d | b c'|c' b a g|f e d c|]\n`,
    );
  });
  it("whole bars in two voices", () => {
    const two = `${head}V:1\nc d e f|g a b c'|]\nV:2\nC D E F|G A B c|]\n`;
    const out = apply(two, cutKeepingBars(two, [span(two, "c d e f"), span(two, "C D E F")]));
    expect(out).toBe(`${head}V:1\ng a b c'|]\nV:2\nG A B c|]\n`);
  });
  it("a line left empty goes with its line break", () => {
    const lines = `${head}c d e f|\ng a b c'|]\n`;
    expect(apply(lines, cutKeepingBars(lines, [span(lines, "c d e f")]))).toBe(
      `${head}g a b c'|]\n`,
    );
  });
});

describe("copy of whole bars takes their bar line", () => {
  it("a whole bar copies with its closing bar line", () => {
    expect(copyWithBars(tune, span(tune, "g a b c'"))).toBe("g a b c'|");
  });
  it("part of a bar copies as written", () => {
    expect(copyWithBars(tune, span(tune, "g a"))).toBe("g a");
  });
  it("a copy already ending in its bar line is left as it is", () => {
    expect(copyWithBars(tune, span(tune, "g a b c'|"))).toBe("g a b c'|");
  });
});

describe("paste fits the bars around it", () => {
  it("whole bars pasted over a whole bar don't double its bar line", () => {
    const out = apply(tune, pasteKeepingBars(tune, [span(tune, "g a b c'")], "e e e e|"));
    expect(out).toBe(`${head}c d e f|e e e e|c' b a g|f e d c|]\n`);
  });
  it("whole bars pasted at the start of a bar add a bar", () => {
    const caret = at(tune, "g a");
    expect(pasteKeepingBars(tune, [{ from: caret, to: caret }], "e e e e|")).toBeNull();
  });
  it("notes pasted over a selection with a bar line keep it", () => {
    const out = apply(tune, pasteKeepingBars(tune, [span(tune, "e f|g a")], "B B"));
    expect(out).toBe(`${head}c d B B| b c'|c' b a g|f e d c|]\n`);
  });
});

describe('", [ and { typed over selected music act on its notes (round 3)', () => {
  const eighths = `X:1\nT:t\nM:4/4\nL:1/8\nK:C\nc2 d2 e2 f2|g a b c'|]\n`;
  it('" writes an empty chord symbol before the first note, the caret inside', () => {
    const result = bracketOver(eighths, [span(eighths, "d2 e2")], '"');
    expect(result && "changes" in result && apply(eighths, result.changes)).toContain(
      'c2 ""d2 e2 f2|',
    );
    expect(result && "caret" in result && result.caret).toBe(at(eighths, "d2") + 1);
  });
  it("[ makes one chord with the first note's length, spaces gone", () => {
    const result = bracketOver(eighths, [span(eighths, "c2 d2 e2")], "[");
    expect(result && "changes" in result && apply(eighths, result.changes)).toContain(
      "\n[cde]2 f2|",
    );
  });
  it("[ across a bar line is refused, saying why", () => {
    const result = bracketOver(eighths, [span(eighths, "f2|g")], "[");
    expect(result && "refused" in result && result.refused).toMatch(/one bar of one voice/);
  });
  it("{ makes grace notes of notes without lengths, in one bar", () => {
    const result = bracketOver(eighths, [span(eighths, "g a b")], "{");
    expect(result && "changes" in result && apply(eighths, result.changes)).toContain(
      "|{g a b} c'|",
    );
    const long = bracketOver(eighths, [span(eighths, "c2 d2")], "{");
    expect(long && "refused" in long && long.refused).toMatch(/no lengths of their own/);
  });
  it("outside music it is typed as usual", () => {
    expect(bracketOver(eighths, [span(eighths, "T:t")], "[")).toBeNull();
  });
});
