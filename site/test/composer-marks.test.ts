import { describe, expect, it } from "vitest";
import { type Change, markSelection } from "../src/composer/commands";

const HEAD = "X:1\nT:Marks\nM:4/4\nL:1/4\nK:C\n";
const apply = (text: string, changes: Change[]) =>
  [...changes]
    .sort((a, b) => b.from - a.from)
    .reduce(
      (out, change) => out.slice(0, change.from) + change.insert + out.slice(change.to),
      text,
    );
/** Types a mark over `selected` (the first occurrence in the music) and returns the music line. */
function type(music: string, selected: string, mark: string) {
  const text = `${HEAD}${music}\nw: la la la\n`;
  const from = text.indexOf(selected, HEAD.length);
  const result = markSelection(text, [{ from, to: from + selected.length }], mark);
  return { result, line: result ? (apply(text, result.changes).split("\n")[5] as string) : null };
}

describe("typing a mark onto selected notes", () => {
  it("puts staccato on each note, before accidentals and chords", () => {
    const { result, line } = type("C ^D [CEG] _B |", "C ^D [CEG] _B", ".");
    expect(line).toBe(".C .^D .[CEG] ._B |");
    expect(result?.mark).toBe("staccato");
    expect(result?.count).toBe(4);
    expect(result?.removed).toBe(false);
  });
  it("goes after other decorations and grace notes, and skips rests and bar lines", () => {
    expect(type('!f!C {g}D z "Am"E | F', '!f!C {g}D z "Am"E | F', ".").line).toBe(
      '!f!.C {g}.D z "Am".E | .F',
    );
  });
  it("adds only where missing, and removes when every note has it", () => {
    expect(type(".C D .E F |", ".C D .E F", ".").line).toBe(".C .D .E .F |");
    const off = type(".C !p!.D .[CE] z |", ".C !p!.D .[CE] z", ".");
    expect(off.line).toBe("C !p!D [CE] z |");
    expect(off.result?.removed).toBe(true);
  });
  it("does the same for the roll", () => {
    expect(type("C D E F |", "D E", "~").line).toBe("C ~D ~E F |");
    expect(type("C ~D ~E F |", "~D ~E", "~").line).toBe("C D E F |");
  });
  it("wraps the selection in a slur, and unwraps it", () => {
    expect(type("C D E F |", "C D E", "(").line).toBe("(C D E) F |");
    const off = type("(C D E) F |", "C D E", "(");
    expect(off.line).toBe("C D E F |");
    expect(off.result?.removed).toBe(true);
  });
  it("leaves everything that is not music to typing", () => {
    const text = `${HEAD}C D E F |\nw: la la la\n% a comment\n`;
    const at = (what: string) => {
      const from = text.indexOf(what);
      return [{ from, to: from + what.length }];
    };
    expect(markSelection(text, at("T:Marks"), ".")).toBeNull();
    expect(markSelection(text, at("la la"), ".")).toBeNull();
    expect(markSelection(text, at("a comment"), ".")).toBeNull();
    // Music and lyrics together, rests alone, and an empty range are not either.
    expect(markSelection(text, at("E F |\nw: la"), ".")).toBeNull();
    expect(
      markSelection(`${HEAD}z2 z2 |\n`, [{ from: HEAD.length, to: HEAD.length + 5 }], "."),
    ).toBeNull();
    expect(markSelection(text, [{ from: HEAD.length, to: HEAD.length }], ".")).toBeNull();
    // Other characters are always typed.
    expect(markSelection(text, at("C D"), "x")).toBeNull();
  });
  it("marks each range of a two-voice region", () => {
    const text = `${HEAD}V:1\nC D E F |\nV:2\nC, D, E, F, |\n`;
    const one = text.indexOf("C D E F");
    const two = text.indexOf("C, D, E, F,");
    const result = markSelection(
      text,
      [
        { from: one, to: one + 3 },
        { from: two, to: two + 5 },
      ],
      ".",
    );
    expect(
      apply(text, result?.changes ?? [])
        .split("\n")
        .slice(6),
    ).toEqual([".C .D E F |", "V:2", ".C, .D, E, F, |", ""]);
  });
});
