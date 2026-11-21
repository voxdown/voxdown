import { describe, expect, it } from "vitest";
import {
  formatLength,
  frac,
  meterLength,
  parseKey,
  parseLength,
  spell,
  tokenizeMusic,
  transposeChordSymbol,
} from "../src/composer/abc";
import { checkBars } from "../src/composer/barcheck";
import {
  type Change,
  decorate,
  decorationMark,
  duplicate,
  removeDots,
  scaleLengths,
  toggleSlur,
  toggleTies,
  transpose,
} from "../src/composer/commands";
import { explainAt } from "../src/composer/explain";
import { indexFile } from "../src/composer/tunes";

const apply = (text: string, changes: Change[]) => {
  let out = text;
  for (const change of [...changes].sort((a, b) => b.from - a.from))
    out = out.slice(0, change.from) + change.insert + out.slice(change.to);
  return out;
};
const tune = (body: string, header = "M:4/4\nL:1/8\nK:G") => `X:1\nT:Test\n${header}\n${body}\n`;
const rangeOf = (text: string, part: string) => {
  const from = text.indexOf(part);
  return [{ from, to: from + part.length }];
};
const explain = (text: string, marker: string, offset = 0) =>
  explainAt(text, indexFile(text), text.indexOf(marker) + offset);
const bars = (text: string) => {
  const file = indexFile(text);
  return checkBars(text, file.tunes[0] as never, file);
};

describe("ABC tokens", () => {
  it("reads notes, lengths, chords, bars, decorations and inline fields with exact offsets", () => {
    const line = '|:"Am"!p!^c\'2 [CEG]3/2 (3abc z/ {g}A>B [K:D] y |1 G4 :|';
    const tokens = tokenizeMusic(line, 100).filter((token) => token.kind !== "space");
    expect(tokens.map((token) => [token.kind, token.text])).toEqual([
      ["bar", "|:"],
      ["chord-symbol", '"Am"'],
      ["decoration", "!p!"],
      ["note", "^c'2"],
      ["chord-open", "["],
      ["note", "C"],
      ["note", "E"],
      ["note", "G"],
      ["chord-close", "]3/2"],
      ["tuplet", "(3"],
      ["note", "a"],
      ["note", "b"],
      ["note", "c"],
      ["rest", "z/"],
      ["grace-open", "{"],
      ["note", "g"],
      ["grace-close", "}"],
      ["note", "A"],
      ["broken", ">"],
      ["note", "B"],
      ["inline-field", "[K:D]"],
      ["spacer", "y"],
      ["bar", "|1"],
      ["note", "G4"],
      ["bar", ":|"],
    ]);
    for (const token of tokens)
      expect(line.slice(token.from - 100, token.to - 100)).toBe(token.text);
  });
  it("parses and writes lengths the way ABC is written", () => {
    expect(parseLength("")).toEqual(frac(1));
    expect(parseLength("/")).toEqual(frac(1, 2));
    expect(parseLength("//")).toEqual(frac(1, 4));
    expect(parseLength("3/2")).toEqual(frac(3, 2));
    expect(parseLength("/4")).toEqual(frac(1, 4));
    expect(formatLength(frac(1, 2))).toBe("/");
    expect(formatLength(frac(1, 4))).toBe("/4");
    expect(formatLength(frac(3, 2))).toBe("3/2");
    expect(formatLength(frac(2))).toBe("2");
    expect(meterLength("6/8")).toEqual(frac(3, 4));
    expect(meterLength("C|")).toEqual(frac(1, 2));
    expect(meterLength("2+3/8")).toEqual(frac(5, 8));
    expect(meterLength("none")).toBeNull();
  });
  it("knows keys and modes", () => {
    expect(parseKey("D").accidentals).toMatchObject({ F: 1, C: 1, G: 0 });
    expect(parseKey("Ador").fifths).toBe(1);
    expect(parseKey("Edor").accidentals.F).toBe(1);
    expect(parseKey("Bb").accidentals).toMatchObject({ B: -1, E: -1 });
    expect(parseKey("Gm").name).toBe("G minor");
    expect(parseKey("D exp ^f ^c").accidentals).toMatchObject({ F: 1, C: 1, G: 0 });
    expect(spell(61, parseKey("D"))).toMatchObject({ letter: "C", alter: 1 });
    expect(spell(70, parseKey("F"))).toMatchObject({ letter: "B", alter: -1 });
    expect(transposeChordSymbol("D/F#", 2, parseKey("A"))).toBe("E/G#");
  });
});

describe("explaining the caret", () => {
  it("names pitch, octave and length", () => {
    const text = tune("^c'2 B G", "M:4/4\nL:1/16\nK:C");
    expect(explain(text, "^c'")?.text).toBe("C♯, two octaves above middle C, an eighth note.");
  });
  it("takes accidentals from the key and the bar", () => {
    const text = tune("F ^G G | g", "M:4/4\nL:1/8\nK:D");
    expect(explain(text, "F ")?.text).toBe(
      "F♯ (sharp from the key), just above middle C, an eighth note.",
    );
    expect(explain(text, "G |")?.text).toContain("G♯ (carried from earlier in the bar)");
    expect(explain(text, "g")?.text).toBe("G, an octave above middle C, an eighth note.");
    expect(explain(text, "F ")?.midi).toEqual([66]);
  });
  it("helps with a field that has no value yet", () => {
    const text = "X:1\nM:\nK:C\nC|\n";
    expect(explainAt(text, indexFile(text), text.indexOf("M:") + 2)?.text).toMatch(
      /write it after M:/,
    );
  });
  it("explains fields, bars, decorations and tuplets", () => {
    const text = tune("|: !trill!A (3Bcd :|");
    expect(explain(text, "K:G")?.text).toContain("G major, 1 sharp");
    expect(explain(text, "M:4/4")?.text).toContain("4 quarter notes a bar");
    expect(explain(text, "|:")?.text).toBe("Start of a repeat.");
    expect(explain(text, "!trill!", 1)?.text).toBe("Decoration: trill.");
    expect(explain(text, "(3")?.text).toBe("triplet: three notes in the time of two.");
    expect(explain(text, ":|")?.text).toContain("End of a repeat");
  });
});

describe("lengths as played", () => {
  it("explains broken rhythm and tuplets", () => {
    const text = tune("f>g (3abc d2 |", "M:4/4\nL:1/8\nK:C");
    expect(explain(text, "f>")?.text).toContain("a dotted eighth note (broken rhythm)");
    expect(explain(text, "g ")?.text).toContain("a sixteenth note (broken rhythm)");
    expect(explain(text, "a")?.text).toContain("an eighth note in a tuplet");
    expect(explain(text, "d2")?.text).toContain("a quarter note.");
  });
});

describe("bar check", () => {
  it("accepts correct bars, a pickup and a short last bar", () => {
    expect(bars(tune("D | G2 AB c2 BA | G4 z4 | G6 |]"))).toEqual([]);
  });
  it("flags long and short bars in the middle of a tune", () => {
    const issues = bars(tune("G2 AB c2 BA | G4 z4 c | G4 | D8 |"));
    expect(issues.map((issue) => issue.kind)).toEqual(["long", "short"]);
    expect(issues[0]?.message).toBe("This bar has 9 eighths; M:4/4 holds 8 eighths.");
  });
  it("counts tuplets, broken rhythm, chords and grace notes", () => {
    expect(bars(tune("(3GAB c2 A>B {g}c2 | [GBd]4 [GB]2 z2 |", "M:4/4\nL:1/8\nK:G"))).toEqual([]);
    expect(bars(tune("G>A B2 (3cBA G2 | x8 |", "M:4/4\nL:1/8\nK:G"))).toEqual([]);
  });
  it("follows L: and M: changes and multi-bar rests", () => {
    expect(bars(tune("G2 A2 | Z2 | [M:3/4] G3 A3 | [L:1/4] G A B |", "M:2/4\nL:1/8\nK:G"))).toEqual(
      [],
    );
  });
  it("checks each voice on its own", () => {
    const text = "X:1\nM:3/4\nL:1/4\nK:C\nV:1\nC D E | F G A |\nV:2\nC2 D | E3 D |\n";
    const issues = bars(text);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.voice).toBe("2");
    expect(issues[0]?.kind).toBe("long");
  });
  it("allows short bars beside repeats and endings", () => {
    expect(bars(tune("|: G2 AB c2 BA | G6 :|[2 G4 z2 |]"))).toEqual([]);
  });
});

describe("transposing", () => {
  it("moves notes by a semitone in the key's spelling", () => {
    const text = tune("G A B c |", "M:4/4\nL:1/4\nK:G");
    expect(apply(text, transpose(text, rangeOf(text, "G A B c"), 2))).toContain("A B ^c d |");
    const flat = tune("F G A B |", "M:4/4\nL:1/4\nK:F");
    expect(apply(flat, transpose(flat, rangeOf(flat, "F G A B"), -2))).toContain("_E F G _A |");
  });
  it("re-spells a later note in the bar that a new accidental would change", () => {
    const text = tune("F2 F2 F2 F2 |", "M:4/4\nL:1/8\nK:C");
    const from = text.indexOf("F2");
    const out = apply(text, transpose(text, [{ from, to: from + 2 }], 1));
    expect(out).toContain("^F2 =F2 F2 F2 |");
  });
  it("transposes by octave, keeping accidentals and chords", () => {
    const text = tune('"G"^F [CEG] c\'|', "M:4/4\nL:1/4\nK:C");
    const out = apply(text, transpose(text, rangeOf(text, '"G"^F [CEG] c\''), 12));
    expect(out).toContain("\"G\"^f [ceg] c''|");
  });
  it("transposes chord symbols with the notes", () => {
    const text = tune('"D7"A2 "G"G2 |', "M:4/4\nL:1/4\nK:G");
    expect(apply(text, transpose(text, rangeOf(text, '"D7"A2 "G"G2'), 2))).toContain(
      '"E7"B2 "A"A2 |',
    );
  });
  it("applies to several ranges at once, as one change set", () => {
    const text = "X:1\nM:4/4\nL:1/4\nK:C\nV:1\nC D E F |\nV:2\nC, D, E, F, |\n";
    const ranges = [...rangeOf(text, "C D E F"), ...rangeOf(text, "C, D, E, F,")];
    expect(apply(text, transpose(text, ranges, 12))).toContain("V:1\nc d e f |\nV:2\nC D E F |");
  });
});

describe("length commands", () => {
  it("doubles, halves and dots notes, rests and chords", () => {
    const text = tune("A B/ c2 z [CE]2 [D2F2] |");
    const range = rangeOf(text, "A B/ c2 z [CE]2 [D2F2]");
    expect(apply(text, scaleLengths(text, range, frac(2)))).toContain("A2 B c4 z2 [CE]4 [D4F4] |");
    expect(apply(text, scaleLengths(text, range, frac(1, 2)))).toContain("A/ B/4 c z/ [CE] [DF] |");
    expect(apply(text, scaleLengths(text, range, frac(3, 2)))).toContain(
      "A3/2 B3/4 c3 z3/2 [CE]3 [D3F3] |",
    );
    const dotted = tune("A3/2 B3 c2 |");
    expect(apply(dotted, removeDots(dotted, rangeOf(dotted, "A3/2 B3 c2")))).toContain("A B2 c2 |");
  });
  it("works on the note at the caret", () => {
    const text = tune("A B c |");
    const at = text.indexOf("B");
    expect(apply(text, scaleLengths(text, [{ from: at, to: at }], frac(2)))).toContain("A B2 c |");
  });
  it("toggles slurs and decorations", () => {
    const text = tune("A B c d |");
    const range = rangeOf(text, "A B c");
    const slurred = apply(text, toggleSlur(text, range));
    expect(slurred).toContain("(A B c) d |");
    expect(apply(slurred, toggleSlur(slurred, rangeOf(slurred, "A B c")))).toContain("A B c d |");
    expect(apply(text, decorate(text, range, "."))).toContain(".A .B .c d |");
    expect(apply(text, decorate(text, range, "fermata"))).toContain(
      "!fermata!A !fermata!B !fermata!c d",
    );
  });
  it("writes dynamics as !name!, never as a bare letter that would be a note", () => {
    const text = tune("E2 G2 |");
    const at = text.indexOf("E2");
    for (const name of ["p", "f", "mp", "mf", "ff", "pp"]) {
      expect(apply(text, decorate(text, [{ from: at, to: at }], name))).toContain(
        `!${name}!E2 G2 |`,
      );
      expect(decorationMark(name)).toBe(`!${name}!`);
    }
    expect(decorationMark(".")).toBe(".");
    expect(decorationMark("~")).toBe("~");
  });
  it("ties only notes of the same pitch", () => {
    const text = tune("B2 c d e2 f2 | f2 f2 B2 B2 |");
    // A selection of different pitches: nothing to tie, and a reason why.
    const mixed = toggleTies(text, rangeOf(text, "B2 c d"));
    expect(mixed.changes).toEqual([]);
    expect(mixed.reason).toMatch(/different pitch/);
    // ...unless its last note meets the same pitch after it.
    const last = toggleTies(text, rangeOf(text, "e2 f2"));
    expect(apply(text, last.changes)).toContain("e2 f2- | f2 f2");
    // Equal neighbours in a selection are tied, and tied again toggles them off.
    const pairs = apply(text, toggleTies(text, rangeOf(text, "f2 f2 B2 B2")).changes);
    expect(pairs).toContain("| f2- f2 B2- B2 |");
    expect(apply(pairs, toggleTies(pairs, rangeOf(pairs, "f2- f2 B2- B2")).changes)).toContain(
      "| f2 f2 B2 B2 |",
    );
    // At the caret: the next note decides; an accidental from the key counts.
    const at = text.indexOf("B2 c");
    expect(toggleTies(text, [{ from: at, to: at }]).changes).toEqual([]);
    const keyed = tune("F ^F | F2 |", "M:4/4\nL:1/4\nK:D");
    const first = keyed.indexOf("F ^F");
    expect(apply(keyed, toggleTies(keyed, [{ from: first, to: first }]).changes)).toContain(
      "F- ^F |",
    );
  });
  it("duplicates a selection or the bar at the caret", () => {
    const text = tune("A B c d | e f g a |");
    const at = text.indexOf("f");
    expect(apply(text, duplicate(text, [{ from: at, to: at }]))).toContain(
      "A B c d | e f g a | e f g a |",
    );
  });
});
