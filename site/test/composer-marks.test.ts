import { describe, expect, it } from "vitest";
import {
  type Change,
  decorate,
  doubledMarks,
  guardMarks,
  markSelection,
} from "../src/composer/commands";

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
    // Music and lyrics together, and an empty range, are not either.
    expect(markSelection(text, at("E F |\nw: la"), ".")).toBeNull();
    // Rests alone are music: nothing is typed over them, and the reason is given.
    const rests = markSelection(
      `${HEAD}z2 z2 |\n`,
      [{ from: HEAD.length, to: HEAD.length + 5 }],
      ".",
    );
    expect(rests?.changes).toEqual([]);
    expect(rests?.reason).toBe("Rests can't be staccato: select notes to mark them.");
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

  it("makes each pair of notes dotted-short with >, short-dotted with <", () => {
    const dotted = type("C D E F G |", "C D E F G", ">");
    expect(dotted.line).toBe("C>D E>F G |");
    expect(dotted.result?.mark).toBe("dotted-short");
    expect(dotted.result?.count).toBe(2);
    expect(type("C D E F |", "C D E F", "<").line).toBe("C<D E<F |");
  });
  it("never pairs across a bar line or a rest; chords count as one note", () => {
    expect(type("C D E | F G z A B |", "C D E | F G z A B", ">").line).toBe("C>D E | F>G z A>B |");
    expect(type("[CE] D !p!E F |", "[CE] D !p!E F", ">").line).toBe("[CE]>D !p!E>F |");
  });
  it("removes the sign when every pair has it, and turns the other one round", () => {
    const off = type("C>D E>F |", "C>D E>F", ">");
    // A sign whose gap is not remembered comes off with none, so beamed notes stay beamed.
    expect(off.line).toBe("CD EF |");
    expect(off.result?.removed).toBe(true);
    expect(type("C<D E F |", "C<D E F", ">").line).toBe("C>D E>F |");
  });
  it("puts the gap back exactly when the sign comes off", () => {
    /** > on, then > off with the gaps remembered as the editor remembers them. */
    const roundTrip = (music: string) => {
      const text = `${HEAD}${music}\n`;
      const from = HEAD.length;
      const to = from + music.lastIndexOf("|");
      const on = markSelection(text, [{ from, to }], ">");
      const marked = apply(text, on?.changes ?? []);
      // Where each sign landed: earlier changes shift later ones.
      const sorted = [...(on?.changes ?? [])].sort((a, b) => a.from - b.from);
      const memory = (on?.gaps ?? []).map((entry) => {
        let shift = 0;
        for (const change of sorted)
          if (change.from < entry.from) shift += change.insert.length - (change.to - change.from);
        return { pos: entry.from + shift, gap: entry.gap };
      });
      const off = markSelection(
        marked,
        [{ from, to: to + (marked.length - text.length) }],
        ">",
        undefined,
        (position) => memory.find((entry) => entry.pos === position)?.gap,
      );
      return {
        marked: marked.split("\n")[5],
        restored: apply(marked, off?.changes ?? []).split("\n")[5],
      };
    };
    expect(roundTrip("AB cd |")).toEqual({ marked: "A>B c>d |", restored: "AB cd |" });
    expect(roundTrip("CD EF |")).toEqual({ marked: "C>D E>F |", restored: "CD EF |" });
    expect(roundTrip("C  D E\tF |")).toEqual({ marked: "C>D E>F |", restored: "C  D E\tF |" });
    expect(roundTrip("C D E F |")).toEqual({ marked: "C>D E>F |", restored: "C D E F |" });
  });
  it("leaves one note alone", () => {
    const single = type("C D E F |", "D", ">");
    expect(single.result?.changes).toEqual([]);
    expect(single.result?.count).toBe(0);
  });

  it("skips ranges of rests alone in a two-voice region, and never types over them", () => {
    const text = `${HEAD}V:1\n!mp!G A B G | G A B G |\nV:2\nz4 | z4 |\n`;
    const one = text.indexOf("!mp!G");
    const two = text.indexOf("z4 | z4 |");
    const result = markSelection(
      text,
      [
        { from: one, to: one + "!mp!G A B G | G A B".length },
        { from: two, to: two + "z4 | z4 |".length },
      ],
      ".",
    );
    expect(result?.count).toBe(7);
    expect(
      apply(text, result?.changes ?? [])
        .split("\n")
        .slice(6, 9),
    ).toEqual(["!mp!.G .A .B .G | .G .A .B G |", "V:2", "z4 | z4 |"]);
    // A note and a rest, then >: one note has no partner, so nothing changes.
    const pair = markSelection(
      text,
      [
        { from: one + 4, to: one + 5 },
        { from: two, to: two + 2 },
      ],
      ">",
    );
    expect(pair?.changes).toEqual([]);
    // A slur leaves the rests out.
    const slur = markSelection(
      text,
      [
        { from: one + 4, to: one + "!mp!G A B G".length },
        { from: two, to: two + 2 },
      ],
      "(",
    );
    expect(apply(text, slur?.changes ?? []).split("\n")[6]).toBe("!mp!(G A B G) | G A B G |");
  });
  it("counts !staccato! and !roll! as the marks they spell", () => {
    expect(type("!staccato!C .D E |", "!staccato!C .D", ".").line).toBe("C D E |");
    expect(type("!staccato!C D E |", "!staccato!C D", ".").line).toBe("!staccato!C .D E |");
    expect(type("!roll!C ~D E |", "!roll!C ~D", "~").line).toBe("C D E |");
  });
});

describe("a note never gets a mark twice", () => {
  /** Types the mark over the whole music line, once and then again, through markSelection. */
  const twice = (music: string, mark = ".") => {
    let text = `${HEAD}${music}\n`;
    const lines: string[] = [];
    for (let time = 0; time < 2; time++) {
      const from = HEAD.length;
      const to = text.indexOf("\n", from);
      const result = markSelection(text, [{ from, to }], mark);
      text = apply(text, result?.changes ?? []);
      expect(doubledMarks(text)).toEqual([]);
      lines.push(text.slice(HEAD.length, text.indexOf("\n", HEAD.length)));
    }
    return lines;
  };
  it("sees a mark split from its note by a chord symbol, an annotation, a decoration or graces", () => {
    expect(twice('"Am".C D |')).toEqual(['"Am".C .D |', '"Am"C D |']);
    expect(twice('."Am"C D |')).toEqual(['."Am"C .D |', '"Am"C D |']);
    expect(twice('"^loud".C D |')).toEqual(['"^loud".C .D |', '"^loud"C D |']);
    expect(twice(".!p!C D |")).toEqual([".!p!C .D |", "!p!C D |"]);
    expect(twice(".{g}C D |")).toEqual([".{g}C .D |", "{g}C D |"]);
    expect(twice("(.C D) |")).toEqual(["(.C .D) |", "(C D) |"]);
  });
  it("counts !staccato! and . as one, and !roll! and ~ as one", () => {
    expect(twice("!staccato!C D |")).toEqual(["!staccato!C .D |", "C D |"]);
    expect(twice("!roll!C D |", "~")).toEqual(["!roll!C ~D |", "C D |"]);
  });
  it("sees a mark across a space or a line break", () => {
    expect(twice(". C D |")).toEqual([". C .D |", " C D |"]);
    const text = `${HEAD}C .\nD E |\n`;
    const from = HEAD.length;
    const result = markSelection(text, [{ from, to: text.length - 1 }], ".");
    expect(apply(text, result?.changes ?? [])).toBe(`${HEAD}.C .\nD .E |\n`);
  });
  it("adds to a mixed selection only where missing, then removes from all", () => {
    expect(twice(".C D .E F |")).toEqual([".C .D .E .F |", "C D E F |"]);
    expect(twice("~C D ~E F |", "~")).toEqual(["~C ~D ~E ~F |", "C D E F |"]);
  });
  it("leaves a selection that starts between the mark and its note marked once", () => {
    const text = `${HEAD}.C D |\n`;
    const from = HEAD.length + 1;
    const result = markSelection(text, [{ from, to: from + 3 }], ".");
    const out = apply(text, result?.changes ?? []);
    expect(out).toBe(`${HEAD}.C .D |\n`);
    expect(doubledMarks(out)).toEqual([]);
  });
  it("gives the decoration menu the same rule", () => {
    for (const music of ['"Am".C D |', "!staccato!C D |", ". C D |", ".!p!C D |"]) {
      const text = `${HEAD}${music}\n`;
      const from = HEAD.length;
      const out = apply(text, decorate(text, [{ from, to: text.length - 1 }], "staccato"));
      expect(doubledMarks(out)).toEqual([]);
      expect(out.match(/\.|!staccato!/g)).toHaveLength(2);
    }
    const rolls = `${HEAD}!roll!C D |\n`;
    expect(apply(rolls, decorate(rolls, [{ from: HEAD.length, to: rolls.length - 1 }], "~"))).toBe(
      `${HEAD}!roll!C ~D |\n`,
    );
  });
  it("guards any change set: a mark the note already has is never added", () => {
    const text = `${HEAD}"Am".C D |\n`;
    const note = text.indexOf("C", HEAD.length);
    const d = text.indexOf("D", HEAD.length);
    const kept = guardMarks(text, [
      { from: note, to: note, insert: "." },
      { from: d, to: d, insert: "!staccato!" },
    ]);
    expect(kept).toEqual([{ from: d, to: d, insert: "!staccato!" }]);
    expect(doubledMarks(`${HEAD}..C !staccato!.D |\n`).map((each) => each.mark)).toEqual([
      ".",
      ".",
    ]);
  });
});
