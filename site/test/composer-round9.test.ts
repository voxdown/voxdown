import { describe, expect, it } from "vitest";
import { cutPlan } from "../src/composer/barwise";
import type { Change } from "../src/composer/commands";

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
