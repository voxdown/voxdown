import { describe, expect, it } from "vitest";
import { frac } from "../src/composer/abc";
import { duplicate } from "../src/composer/barwise";
import { type Change, scaleLengths, toggleSlur, transpose } from "../src/composer/commands";
import { insertChordSymbol, insertRepeat, insertTriplet } from "../src/composer/inserts";
import { describePicked, selectedNotes } from "../src/composer/selected";

const HEAD = "X:1\nT:Rule\nM:4/4\nL:1/8\nK:C\n";
const apply = (text: string, given: Change[] | { refused: string }) => {
  if ("refused" in given) throw new Error(given.refused);
  return applied(text, given);
};
const applied = (text: string, changes: Change[]) =>
  [...changes]
    .sort((a, b) => b.from - a.from)
    .reduce(
      (out, change) => out.slice(0, change.from) + change.insert + out.slice(change.to),
      text,
    );
/** The notes selected when `part` (the `nth` occurrence in the music) is selected. */
function pick(music: string, part: string, nth = 0) {
  const text = `${HEAD}${music}\n`;
  let from = text.indexOf(part, HEAD.length);
  for (let n = 0; n < nth; n++) from = text.indexOf(part, from + 1);
  const range = { from, to: from + part.length };
  const picked = selectedNotes(text, [range]);
  return {
    text,
    range,
    picked,
    notes: picked.map((each) => text.slice(each.event.from, each.event.to)),
    tones: picked.map((each) => each.tones.map((tone) => tone.text).join("")),
  };
}

describe("the one rule: which notes a text selection selects", () => {
  it("takes a note when any part of it is selected: a letter, its accidental, octave or length", () => {
    expect(pick("F/G/ A2 |", "F").notes).toEqual(["F/"]);
    expect(pick("F/G/ A2 |", "/", 0).notes).toEqual(["F/"]);
    expect(pick("(3G,DF A2 |", "G").notes).toEqual(["G,"]);
    expect(pick("=G6 A2 |", "G").notes).toEqual(["=G6"]);
    expect(pick("[C,,C,]8 |", "8").notes).toEqual(["[C,,C,]8"]);
  });
  it("takes a note when what is attached to it is selected", () => {
    expect(pick("!trill!F G |", "trill").notes).toEqual(["F"]);
    expect(pick('"Am"F G |', "Am").notes).toEqual(["F"]);
    expect(pick("{g}F G |", "g").notes).toEqual(["F"]);
    expect(pick("d>e f2 e |", ">").notes).toEqual(["d"]);
    expect(pick("F- F G |", "-").notes).toEqual(["F"]);
    // The reviewer's case: lit 4, said 3. Now all four, everywhere.
    expect(pick("d>e f2 e |", ">e f2 e").notes).toEqual(["d", "e", "f2", "e"]);
  });
  it("takes only the tones selected inside a chord's brackets", () => {
    const one = pick("[C,,C,]8 |", "C,,");
    expect(one.notes).toEqual(["[C,,C,]8"]);
    expect(one.picked[0]?.whole).toBe(false);
    expect(one.tones).toEqual(["C,,"]);
    expect(describePicked(one.picked).text).toBe("1 chord tone");
    const all = pick("[C,,C,]8 |", "C,,C,");
    expect(all.picked[0]?.whole).toBe(true);
    expect(describePicked(all.picked).text).toBe("1 note");
  });
  it("reads a caret as the note it is in, or the one just before", () => {
    const text = `${HEAD}C D |\n`;
    const at = (position: number) =>
      selectedNotes(text, [{ from: position, to: position }]).map((each) =>
        text.slice(each.event.from, each.event.to),
      );
    expect(at(HEAD.length)).toEqual(["C"]);
    expect(at(HEAD.length + 1)).toEqual(["C"]);
    expect(at(HEAD.length + 2)).toEqual(["D"]);
  });
  it("is what transpose and lengths act on", () => {
    // A double-clicked F (no length selected) moves up; G stays.
    const f = pick("F/G/ A2 |", "F");
    expect(apply(f.text, transpose(f.text, [f.range], 2))).toBe(`${HEAD}G/G/ A2 |\n`);
    // One chord tone: only it moves; the chord's length stays one length for all.
    const tone = pick("[C,,C,]8 |", "C,,");
    expect(apply(tone.text, transpose(tone.text, [tone.range], 12))).toBe(`${HEAD}[C,C,]8 |\n`);
    // The trill's text selected: the note is transposed, the decoration kept.
    const trill = pick("!trill!F G |", "trill");
    expect(apply(trill.text, transpose(trill.text, [trill.range], 1))).toBe(
      `${HEAD}!trill!^F G |\n`,
    );
    // A chord symbol moves with its note; the grace notes before it too.
    const symbol = pick('"Am"{g}F G |', "F");
    expect(apply(symbol.text, transpose(symbol.text, [symbol.range], 2))).toBe(
      `${HEAD}"Bm"{a}G G |\n`,
    );
    const length = pick("=G6 A2 |", "G");
    expect(apply(length.text, scaleLengths(length.text, [length.range], frac(1, 2)))).toBe(
      `${HEAD}=G3 A2 |\n`,
    );
  });
  it("counts notes and chord tones in words", () => {
    const both = pick("C [EG]2 |", "C [E");
    expect(describePicked(both.picked).text).toBe("2 notes");
    const mixed = selectedNotes(`${HEAD}C [EG]2 |\n`, [
      { from: HEAD.length, to: HEAD.length + 1 },
      { from: HEAD.length + 3, to: HEAD.length + 4 },
    ]);
    expect(describePicked(mixed).text).toBe("1 note and 1 chord tone");
  });
});

describe("Insert over a selection goes by its notes", () => {
  const over = (music: string, part: string) => {
    const text = `${HEAD}${music}\n`;
    const from = text.indexOf(part, HEAD.length);
    return { text, ranges: [{ from, to: from + part.length }] };
  };
  it("puts a triplet's (3 before the first selected note, before its decorations", () => {
    const { text, ranges } = over("C !trill!d e f g |", "!trill!d e f");
    expect(apply(text, insertTriplet(text, ranges) ?? [])).toBe(`${HEAD}C (3!trill!d e f g |\n`);
  });
  it("attaches a chord symbol to the first selected note", () => {
    const { text, ranges } = over("C d e f |", "d e");
    expect(apply(text, [insertChordSymbol(text, ranges) as Change])).toBe(`${HEAD}C ""d e f |\n`);
  });
  it("wraps a repeat round the notes, making the bar lines there repeat signs", () => {
    const bars = over("C D | E F G A | B c |]", "E F G A");
    expect(apply(bars.text, insertRepeat(bars.text, bars.ranges) ?? [])).toBe(
      `${HEAD}C D |: E F G A :| B c |]\n`,
    );
    // Round 4: a repeat goes round whole bars, at their bar lines (or the line's ends).
    const plain = over("C D E F G A |]", "D E");
    expect(apply(plain.text, insertRepeat(plain.text, plain.ranges) ?? [])).toBe(
      `${HEAD}|: C D E F G A :|]\n`,
    );
    const end = over("C D | E F |]", "E F");
    expect(apply(end.text, insertRepeat(end.text, end.ranges) ?? [])).toBe(
      `${HEAD}C D |: E F :|]\n`,
    );
  });
});

describe("a voice written in V: blocks is one passage", () => {
  const blocks =
    "X:1\nM:4/4\nL:1/4\nK:C\nV:1\nV:2\nV:1\nc d e f|\nV:2\nC D E F|\nV:1\ng a b c'|\nV:2\nG A B c|\n";
  const both = [
    { from: blocks.indexOf("c d e f|"), to: blocks.indexOf("c d e f|") + 8 },
    { from: blocks.indexOf("g a b c'|"), to: blocks.indexOf("g a b c'|") + 9 },
  ];
  it("duplicates the passage once, after its end, in the voice's last block", () => {
    expect(apply(blocks, duplicate(blocks, both))).toBe(
      "X:1\nM:4/4\nL:1/4\nK:C\nV:1\nV:2\nV:1\nc d e f|\nV:2\nC D E F|\nV:1\ng a b c'|c d e f| g a b c'|\nV:2\nG A B c|\n",
    );
  });
  it("puts one slur over it, from its first note to its last", () => {
    expect(apply(blocks, toggleSlur(blocks, both))).toBe(
      "X:1\nM:4/4\nL:1/4\nK:C\nV:1\nV:2\nV:1\n(c d e f|\nV:2\nC D E F|\nV:1\ng a b c')|\nV:2\nG A B c|\n",
    );
  });
  it("keeps ranges in different places, or voices, apart", () => {
    const apart = [
      { from: blocks.indexOf("c d"), to: blocks.indexOf("c d") + 3 },
      { from: blocks.indexOf("b c'"), to: blocks.indexOf("b c'") + 4 },
    ];
    expect(apply(blocks, toggleSlur(blocks, apart))).toContain("(c d) e f|");
    expect(apply(blocks, toggleSlur(blocks, apart))).toContain("g a (b c')|");
  });
});

describe("Duplicate copies the selected notes, not the raw text (round 3)", () => {
  const head = "X:1\nM:4/4\nL:1/8\nK:C\n";
  it("a chord tone selected duplicates its whole chord", () => {
    const text = `${head}[CEG]2 A2 B4|\n`;
    const at = text.indexOf("E");
    expect(apply(text, duplicate(text, [{ from: at, to: at + 1 }]))).toBe(
      `${head}[CEG]2 [CEG]2 A2 B4|\n`,
    );
  });
  it("a note selected through its decoration duplicates with it, and its broken rhythm", () => {
    const text = `${head}B>!trill!c2 d4|\n`;
    const at = text.indexOf(">");
    expect(apply(text, duplicate(text, [{ from: at, to: at + 4 }]))).toBe(
      `${head}B>!trill!c2 B>!trill!c2 d4|\n`,
    );
  });
  it("a triplet's first notes take its sign", () => {
    const text = `${head}(3abc d4|\n`;
    const from = text.indexOf("abc");
    expect(apply(text, duplicate(text, [{ from, to: from + 3 }]))).toBe(`${head}(3abc (3abc d4|\n`);
  });
  it("whole bars are duplicated as bars, after the bar line", () => {
    const text = `${head}c2 d2 e2 f2|g2 a2 b2 c'2|]\n`;
    const from = text.indexOf("g2");
    expect(apply(text, duplicate(text, [{ from, to: from + 11 }]))).toBe(
      `${head}c2 d2 e2 f2|g2 a2 b2 c'2|g2 a2 b2 c'2|]\n`,
    );
  });
});

describe("Insert over a voice selected across V: blocks is one passage (round 3)", () => {
  const blocks =
    "X:1\nM:4/4\nL:1/4\nK:C\nV:1\nV:2\nV:1\nc d e f|\nV:2\nC D E F|\nV:1\ng a b c'|\nV:2\nG A B c|\n";
  const across = [
    { from: blocks.indexOf("e f"), to: blocks.indexOf("e f") + 3 },
    { from: blocks.indexOf("g a"), to: blocks.indexOf("g a") + 1 },
  ];
  it("a triplet across a bar line is refused (round 4: 3 notes in one bar)", () => {
    const result = insertTriplet(blocks, across);
    expect(result && "refused" in result && result.refused).toMatch(/one bar/);
  });
  it("one repeat, around the whole passage", () => {
    const whole = [
      { from: blocks.indexOf("c d e f"), to: blocks.indexOf("c d e f") + 7 },
      { from: blocks.indexOf("g a b c'"), to: blocks.indexOf("g a b c'") + 8 },
    ];
    const out = apply(blocks, insertRepeat(blocks, whole) ?? []);
    expect(out).toContain("V:1\n|: c d e f|\n");
    expect(out).toContain("V:1\ng a b c':|\n");
  });
});

describe("Duplicate keeps tuplets, slurs, ties and bar-line marks whole (round 4)", () => {
  const head = "X:1\nM:4/4\nL:1/8\nK:C\n";
  it("after the tuplet the last note is in, not inside it", () => {
    const text = `${head}(3cde (3fga b2 c'2 |\n`;
    const from = text.indexOf("e (3f");
    expect(apply(text, duplicate(text, [{ from, to: from + 5 }]))).toBe(
      `${head}(3cde (3fga e f b2 c'2 |\n`,
    );
  });
  it("half a slur isn't copied", () => {
    const text = `${head}a2 b2 c'2 c'2 | (d'4 e'4) |\n`;
    const from = text.indexOf("c'2 |");
    const out = apply(text, duplicate(text, [{ from, to: text.indexOf("d'4") + 3 }]));
    expect(out.split("(").length).toBe(2);
    expect(out.split(")").length).toBe(2);
  });
  it("a bar ending in a D.S. is a whole bar: duplicated as a bar, the D.S. after both", () => {
    const text = `${head}A2 B2 c2 d2 | e2 f2 g2 a2 !D.S.! | b8 |]\n`;
    const from = text.indexOf("e2");
    expect(apply(text, duplicate(text, [{ from, to: from + 11 }]))).toBe(
      `${head}A2 B2 c2 d2 | e2 f2 g2 a2 | e2 f2 g2 a2 !D.S.! | b8 |]\n`,
    );
  });
  it("a tie on the last note stays on the copy when the note is the same", () => {
    const text = `${head}A2 c2- c4 |\n`;
    const from = text.indexOf("c2-");
    expect(apply(text, duplicate(text, [{ from, to: from + 3 }]))).toBe(`${head}A2 c2- c2- c4 |\n`);
  });
  it("the original's tie goes when the copy starts on another note", () => {
    const text = `${head}A2 c2- c4 |\n`;
    const from = text.indexOf("A2");
    expect(apply(text, duplicate(text, [{ from, to: text.indexOf("c2-") + 3 }]))).toBe(
      `${head}A2 c2 A2 c2- c4 |\n`,
    );
  });
});

describe("Insert › Repeat and Triplet keep bars and tuplets whole (round 4)", () => {
  const head = "X:1\nM:4/4\nL:1/8\nK:C\n";
  const text = `${head}(3cde (3fga b2 c'2 | d'8 |]\n`;
  const of = (part: string) => [{ from: text.indexOf(part), to: text.indexOf(part) + part.length }];
  it("a repeat over e…a goes to the bar lines around, not inside a triplet", () => {
    expect(apply(text, insertRepeat(text, of("e (3fga")) ?? [])).toBe(
      `${head}|: (3cde (3fga b2 c'2 :| d'8 |]\n`,
    );
  });
  it("a repeat merges with the bar lines there", () => {
    const two = `${head}a8 :| b8 | c'8 |]\n`;
    const range = [{ from: two.indexOf("b8"), to: two.indexOf("b8") + 2 }];
    expect(apply(two, insertRepeat(two, range) ?? [])).toBe(`${head}a8 :: b8 :| c'8 |]\n`);
  });
  it("a triplet needs exactly 3 notes, in one bar, none in a tuplet", () => {
    const inside = insertTriplet(text, of("fga"));
    expect(inside && "refused" in inside && inside.refused).toMatch(/already in a tuplet/);
    const plain = `${head}a b c d4 e2 f2 |\n`;
    const four = insertTriplet(plain, [{ from: plain.indexOf("a"), to: plain.indexOf("d4") + 2 }]);
    expect(four && "refused" in four && four.refused).toMatch(/exactly 3 notes.*4 are selected/);
    const three = [{ from: plain.indexOf("a b c"), to: plain.indexOf("a b c") + 5 }];
    expect(apply(plain, insertTriplet(plain, three) ?? [])).toBe(`${head}(3a b c d4 e2 f2 |\n`);
    const across = `${head}a b c d e f g a | b c d e f g a b |\n`;
    const crossing = [{ from: across.indexOf("g a |"), to: across.indexOf("| b") + 3 }];
    const refused = insertTriplet(across, crossing);
    expect(refused && "refused" in refused && refused.refused).toMatch(/cross a bar line/);
  });
});
