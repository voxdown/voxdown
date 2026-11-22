import { describe, expect, it } from "vitest";
import { frac } from "../src/composer/abc";
import { checkBars } from "../src/composer/barcheck";
import {
  barsChanged,
  cutPlan,
  duplicate,
  inOneVoice,
  lengthsInStep,
  noteStartsBar,
  onlyAttachments,
} from "../src/composer/barwise";
import { type Change, scaleLengths, toggleTies } from "../src/composer/commands";
import { planPaste } from "../src/composer/paste";
import { describePicked, selectedNotes } from "../src/composer/selected";
import { indexFile } from "../src/composer/tunes";

/* Round 9 (selection hardening): the written rules, conformed to. */

export const apply = (text: string, changes: Change[]) =>
  [...changes]
    .sort((a, b) => b.from - a.from || b.to - a.to)
    .reduce(
      (out, change) => out.slice(0, change.from) + change.insert + out.slice(change.to),
      text,
    );
export const tune = (body: string, meter = "4/4", unit = "1/8", head = "") =>
  `X:1\nT:t\nM:${meter}\nL:${unit}\n${head}K:C\n${body}\n`;
export const body = (text: string) => text.slice(text.indexOf("K:C\n") + 4);
const cut = (text: string, ranges: { from: number; to: number }[]) => {
  const plan = cutPlan(text, ranges);
  if (!plan || "refused" in plan) throw new Error(plan ? plan.refused : "no plan");
  return { out: apply(text, plan.changes), said: plan.said.join(" ") };
};
const at = (text: string, part: string, nth = 0) => {
  let from = text.indexOf(part);
  for (let n = 0; n < nth; n++) from = text.indexOf(part, from + 1);
  return { from, to: from + part.length };
};

describe("bars measured by the meter in force there (item 1)", () => {
  const text = tune("GAB c2d|[M:9/8]GAB cde dBG|[M:6/8]c3 d3|]", "6/8");
  it("a [M:9/8] bar keeps its 9/8: rests, and no false over-full", () => {
    const { out, said } = cut(text, [at(text, "GAB", 1)]);
    expect(body(out)).toBe("GAB c2d|[M:9/8]z3 cde dBG|[M:6/8]c3 d3|]\n");
    expect(said).not.toMatch(/over-full/);
  });
  it("and an [L:] in force", () => {
    const text16 = tune("c4 d4|[L:1/16]E2F2G2 A4B2|]");
    expect(body(cut(text16, [at(text16, "E2F2")]).out)).toContain("[L:1/16]z4G2 A4B2|]");
  });
});

describe("spacer voices don't hold time back, and lose their bars too (item 2)", () => {
  it("a whole bar in every sounding voice goes in the spacer voices as well", () => {
    const text =
      "X:1\nT:Moon\nM:4/4\nL:1/8\n%%score {1 (2 3 4)}\nK:E\nV:1\nG,2CE G,2CE | B8 | c8 |\nV:2\nx8 | x8 | x8 |\nV:3\n[C,,C,]8 | [B,,,B,,]8 | A,8 |\nV:4\nx8 | x8 | x8 |\n";
    const { out } = cut(text, [
      { from: text.indexOf("G,2CE"), to: text.indexOf(" | B8") },
      at(text, "[C,,C,]8"),
    ]);
    expect(out).toContain(
      "V:1\nB8 | c8 |\nV:2\nx8 | x8 |\nV:3\n[B,,,B,,]8 | A,8 |\nV:4\nx8 | x8 |\n",
    );
  });
});

describe("a whole tuplet whose real length can't be drawn keeps its bracket (item 16)", () => {
  it("(3:2:4GAB c deleted: (3:2:4zzz z", () => {
    const text = tune("(3:2:4GAB c e2 d z2|]");
    expect(
      body(cut(text, [{ from: text.indexOf("(3:2:4"), to: text.indexOf(" c ") + 2 }]).out),
    ).toBe("(3:2:4zzz z e2 d z2|]\n");
  });
});

describe("½× on beamed notes (item 6)", () => {
  it("only the note halved gives up time: CDEF G4 halving C", () => {
    const text = tune("CDEF G4 | A8 |]");
    const range = [{ from: text.indexOf("CDEF"), to: text.indexOf("CDEF") + 1 }];
    const plan = lengthsInStep(
      text,
      indexFile(text),
      scaleLengths(text, range, frac(1, 2)),
      0.5,
      "Halve",
    );
    if (!plan || "refused" in plan) throw new Error("no plan");
    const out = apply(text, plan.changes);
    expect(body(out)).toBe("C/ z/DEF G4 | A8 |]\n");
    expect(checkBars(out, indexFile(out).tunes[0] as never, indexFile(out))).toEqual([]);
  });
});

describe("typing and step entry write in one voice, all ranges together (items 7, 8)", () => {
  const two = tune("V:1\nC2 D2 E2 F2|]\nV:2\nC,4 E,4|]", "4/4", "1/8", "%%score (1 2)\n");
  it("a range in each of two voices is refused", () => {
    expect(inOneVoice(two, [at(two, "C2 D2 E2 F2"), at(two, "C,4 E,4")])).toBe(false);
    expect(inOneVoice(two, [at(two, "C2 D2"), at(two, "E2 F2")])).toBe(true);
  });
});

describe("Alt+T on a chord tied inside (item 17)", () => {
  it("[C-E-]2 toggles the ties off, never a second tie", () => {
    const text = tune("[C-E-]2 [CE]2 z4|]");
    const from = text.indexOf("[C-E-]2");
    const tie = toggleTies(text, [{ from, to: from + 7 }]);
    expect(body(apply(text, tie.changes))).toBe("[CE]2 [CE]2 z4|]\n");
  });
});

describe("spacers are never counted (item 19)", () => {
  it("x4 selected with notes: only the notes", () => {
    const text = tune("C2 D2 x4|]");
    const picked = selectedNotes(
      text,
      [{ from: text.indexOf("C2"), to: text.indexOf("|]") }],
      indexFile(text),
    );
    expect(describePicked(picked, text).text).toBe("2 notes");
  });
});

describe("a paste on a bar's first note behind a tuplet, slur or grace goes in before the bar (item 3)", () => {
  const moon =
    'X:1\nT:Moon\nM:4/4\nL:1/8\n%%score {1 (2 3 4)}\nK:E\nV:1\n(3"^Adagio"!pp!G,CE (3G,CE (3G,CE (3G,CE | B8 |\nV:2\nx8 | x8 |\nV:3\n[C,,C,]8 | [B,,,B,,]8 |\nV:4\nx8 | x8 |\n';
  it("Moonlight's bar 1: the copy goes in before it, every voice in step, its marks kept", () => {
    const from = moon.indexOf("G,CE");
    const plan = planPaste(moon, [{ from, to: from + 2 }], 0, "B8 |", null);
    if (!plan || "refused" in plan) throw new Error(plan ? plan.refused : "no plan");
    const out = apply(moon, plan.changes);
    expect(out).toContain('V:1\nB8 | (3"^Adagio"!pp!G,CE (3G,CE');
    expect(out).toMatch(/V:2\nx8 \| ?x8 \| x8 \|/);
    expect(out).toMatch(/V:3\nz8 \| ?\[C,,C,\]8/);
  });
  for (const lead of ["(", "{g}", "(3"])
    it(`a bar opening with ${lead}`, () => {
      const text = tune(`C2 D2 E2 F2 | ${lead}G2 A2 B2 c2${lead === "(" ? ")" : ""} | d8 |]`);
      const from = text.indexOf("G2");
      expect(noteStartsBar(text, indexFile(text), { from, to: from + 2 })).toBe(
        text.indexOf(`| ${lead}G2`) + 2,
      );
    });
});

describe("multi-bar rests (items 4 and 13)", () => {
  const pasted = (text: string, part: string, clip: string) => {
    const from = text.indexOf(part);
    const plan = planPaste(text, [{ from, to: from + part.length }], 0, clip, null);
    if (!plan || "refused" in plan) throw new Error(plan ? plan.refused : "no plan");
    return body(apply(text, plan.changes));
  };
  it("a copied Z2 on a bar's first note goes in as its two bars, the note kept", () => {
    expect(pasted(tune("C2 D2 E2 F2 | G8 | A8 |]"), "G8", "Z2")).toBe(
      "C2 D2 E2 F2 | z8 | z8 | G8 | A8 |]\n",
    );
  });
  it("on a note mid-bar, after its bar", () => {
    expect(pasted(tune("C2 D2 E2 F2 | G8 |]"), "D2", "Z|")).toMatch(
      /^C2 D2 E2 F2 \|\s*z8 ?\|\s*G8 \|\]/,
    );
  });
  it("a paste over Z2 writes over its first bar, the second left a bar of rest", () => {
    expect(pasted(tune("C8 | Z2 | D8 |]"), "Z2", "E2")).toBe("C8 | E2 z2 z4 | z8 | D8 |]\n");
  });
});

describe("an ending written apart from its bar line (item 9)", () => {
  it("|[1 refuses a paste across it, as |1 does", () => {
    for (const bar of ["|[1", "|1"]) {
      const text = tune(`C8 |: D8 | E8 ${bar} F8 :|[2 G8 || A8 |]`);
      const from = text.indexOf("E8");
      expect(planPaste(text, [{ from, to: from + 2 }], 0, "A16", null)).toMatchObject({
        refused: expect.stringMatching(/repeat sign or an ending/),
      });
    }
  });
});

describe("a paste written by the beat, even inside one bar (item 10)", () => {
  const over = (text: string, part: string, clip: string) => {
    const from = text.indexOf(part);
    const plan = planPaste(text, [{ from, to: from + part.length }], 0, clip, null);
    if (!plan || "refused" in plan) throw new Error(plan ? plan.refused : "no plan");
    return body(apply(text, plan.changes));
  };
  it("a 5/8 note is a half tied to an eighth", () => {
    expect(over(tune("C2 D2 E2 F2 | G8 |]"), "C2", "A5")).toMatch(/^A4- A z F2 \| G8 \|\]/);
  });
  it("a half from beat 2 of 4/4 is two quarters, tied", () => {
    expect(over(tune("C2 D2 E2 F2 | G8 |]"), "D2", "A4")).toBe("C2 A2- A2 F2 | G8 |]\n");
  });
  it("what keeps to the beat stays as written (a dotted quarter from beat 1)", () => {
    expect(over(tune("C2 D2 E2 F2 | G8 |]"), "C2", "A3")).toMatch(/^A3 z D? ?E2 F2|^A3 z E2 F2/);
  });
});

describe("Duplicate (items 5, 11, 15, and the partial-bar rule)", () => {
  const dup = (text: string, ranges: { from: number; to: number }[]) => {
    const plan = duplicate(text, ranges);
    if ("refused" in plan) throw new Error(plan.refused);
    return { out: apply(text, plan.changes), said: plan.said.join(" ") };
  };
  it("two voices duplicated over a third: the third gets its rests once", () => {
    const text =
      "X:1\nT:t\nM:4/4\nL:1/4\n%%score 1 2 3\nK:C\nV:1\nC4 | D4 |]\nV:2\nE4 | F4 |]\nV:3\nx4 | x4 |]\n";
    const { out } = dup(text, [at(text, "C4"), at(text, "E4")]);
    expect(out).toContain("V:3\nx4 | x4 | x4 |]");
    const file = indexFile(out);
    expect(checkBars(out, file.tunes[0] as never, file)).toEqual([]);
  });
  it("a whole repeat with its endings is duplicated whole", () => {
    const text = tune("|: D8 | E8 |[1 F8 :|[2 G8 |]");
    const { out } = dup(text, [{ from: text.indexOf("D8"), to: text.indexOf("G8") + 2 }]);
    expect(body(out)).toBe("|: D8 | E8 |[1 F8 :|[2 G8 |: D8 | E8 |[1 F8 :|[2 G8 |]\n");
  });
  it("its chord symbol and slur come with it, as Copy takes them", () => {
    const text = tune('"D"(d2 f2) a4|"G"g8|]');
    expect(body(dup(text, [{ from: text.indexOf('"D"'), to: text.indexOf("f2)") + 3 }]).out)).toBe(
      '"D"(d2 f2) "D"(d2 f2) a4|"G"g8|]\n',
    );
  });
  it("part of a bar goes in after it, the bar over-full, said", () => {
    const text = tune("C2 D2 E2 F2 | G8 |]");
    const { out } = dup(text, [at(text, "D2")]);
    expect(body(out)).toBe("C2 D2 D2 E2 F2 | G8 |]\n");
    expect(barsChanged(text, out, text.indexOf("D2"))).toBe(
      "Bar 1 now has 10 eighths, 8 expected (M:4/4). F8 goes to it.",
    );
  });
});

describe("slurs follow Delete as hairpins do (item 14)", () => {
  const text = tune("(c2 d2 e2 f2)|(g2 a2 b2 c'2)|]");
  it("all its notes gone (made rests): the slur goes too", () => {
    expect(body(cut(text, [at(text, "c2 d2 e2 f2")]).out)).not.toMatch(/\(z|z8\)/);
  });
  it("an end lost moves to the nearest note left inside it", () => {
    expect(body(cut(text, [at(text, "c2 d2")]).out)).toBe("z4 (e2 f2)|(g2 a2 b2 c'2)|]\n");
    expect(body(cut(text, [at(text, "e2 f2")]).out)).toBe("(c2 d2) z4|(g2 a2 b2 c'2)|]\n");
  });
});

describe("selecting only an attachment (rule)", () => {
  const text = 'X:1\nK:C\n{g}a2 "C"b2 !f!c2|]\n';
  it("a grace group, a chord symbol or a mark alone: Delete takes only that", () => {
    expect(onlyAttachments(text, [at(text, "{g}")])).toBe(true);
    expect(onlyAttachments(text, [at(text, '"C"')])).toBe(true);
    expect(onlyAttachments(text, [at(text, "!f!")])).toBe(true);
    expect(onlyAttachments(text, [at(text, "{g}a")])).toBe(false);
  });
});

describe("fields left by whole bars cut (rule)", () => {
  const text = tune("A2 B2 c2 d2 | [L:1/4] B c d e | [M:2/4] f g | [M:3/4] a b c' |]");
  it("go on to the next bar, or go when nothing follows", () => {
    expect(body(cut(text, [at(text, "a b c'")]).out)).toBe(
      "A2 B2 c2 d2 | [L:1/4] B c d e | [M:2/4] f g |]\n",
    );
    expect(body(cut(text, [at(text, "B c d e")]).out)).toContain("[L:1/4] [M:2/4] f g |");
  });
});
