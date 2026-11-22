import { describe, expect, it } from "vitest";
import {
  cutPlan,
  duplicate,
  fillPlaceholder,
  newVoice,
  nextPlaceholder,
} from "../src/composer/barwise";
import { transpose } from "../src/composer/commands";
import { planPaste } from "../src/composer/paste";
import { interval, movedKey, toKey } from "../src/composer/transpose-key";
import { indexFile } from "../src/composer/tunes";
import { apply } from "./composer-played";

const head = (key = "C", unit = "1/4") => `X:1\nT:t\nM:4/4\nL:${unit}\nK:${key}\n`;
const of = (text: string, part: string, nth = 0) => {
  let at = text.indexOf(part);
  for (let n = 0; n < nth; n++) at = text.indexOf(part, at + 1);
  return { from: at, to: at + part.length };
};
const cut = (text: string, ranges: { from: number; to: number }[]) => {
  const plan = cutPlan(text, ranges);
  if (!plan || "refused" in plan) throw new Error(plan ? plan.refused : "no plan");
  return { out: apply(text, plan.changes), plan };
};

describe("transposing spells for the key (round 6, finding 10)", () => {
  it("in F, A up a semitone is B♭, written _B under no key accidental, and its chord Bb", () => {
    const text = `${head("F")}"A"A2 c2 |\n`;
    const out = apply(text, transpose(text, [of(text, '"A"A2')], 1));
    expect(out).toContain('"Bb"B2 c2 |');
    const c = `${head("C")}"A"A2 c2 |\n`;
    expect(apply(c, transpose(c, [of(c, '"A"A2')], 1))).toContain('"Bb"_B2 c2 |');
  });
  it("Transpose to key: the whole tune and its K: fields, the nearer way, spelled for the new key", () => {
    expect(interval("C", "F")).toBe(5);
    expect(interval("C", "Bb")).toBe(-2);
    expect(movedKey("A", 1)).toBe("Bb");
    expect(movedKey("Em", 1)).toBe("Fm");
    const tune = `${head("C")}"C"C E G c | [K:G] G B d g |]\n`;
    const result = toKey(tune, [{ from: tune.indexOf("C E"), to: tune.indexOf("C E") }], "F");
    if ("refused" in result) throw new Error(result.refused);
    const out = apply(tune, result.changes);
    expect(out).toContain("K:F\n");
    expect(out).toContain('"F"F A c f | [K:C] c e g c\' |]');
    expect(result.said).toBe("The tune to F: 5 semitones up.");
  });
  it("a selection only moves its notes, the key signature as it was", () => {
    const tune = `${head("C")}C E G c | G B d g |]\n`;
    const result = toKey(tune, [of(tune, "C E G c")], "D");
    if ("refused" in result) throw new Error(result.refused);
    expect(apply(tune, result.changes)).toBe(`${head("C")}D ^F A d | G B d g |]\n`);
  });
});

const verses = `${head("C")}C D E F | G A B c |\nw: one two three four five six sev-en\nw: un deux trois quatre cinq six sept huit\n`;

describe("every verse follows edits (round 6, finding 2)", () => {
  it("Delete of a bar takes its syllables out of both verses", () => {
    const { out } = cut(verses, [of(verses, "C D E F")]);
    expect(out).toContain("w: five six sev-en\nw: cinq six sept huit\n");
  });
  it("Backspace over part of a bar (rests) takes those notes' syllables out of both", () => {
    const { out } = cut(verses, [of(verses, "D E")]);
    expect(out).toContain(
      "C z2 F | G A B c |\nw: one four five six sev-en\nw: un quatre cinq six sept huit\n",
    );
  });
  it("Duplicate brings each verse's own syllables", () => {
    const plan = duplicate(verses, [of(verses, "G A")]);
    if ("refused" in plan) throw new Error(plan.refused);
    const out = apply(verses, plan.changes);
    expect(out).toContain("w: one two three four five six five six sev-en");
    expect(out).toContain("w: un deux trois quatre cinq six cinq six sept huit");
  });
  it("a paste puts * in each verse where its notes have none", () => {
    const at = verses.indexOf("G A");
    const plan = planPaste(verses, [{ from: at, to: at }], 0, "c c c c|", null);
    if (!plan || "refused" in plan) throw new Error("no plan");
    const out = apply(verses, plan.changes);
    expect(out).toContain("w: one two three four * * * * five");
    expect(out).toContain("w: un deux trois quatre * * * * cinq");
  });
});

describe("the blank line between tunes stays (round 6, finding 6)", () => {
  it("cutting a tune's last-line repeat leaves the next tune apart", () => {
    const two = `${head("C")}C D E F |\n|: G A B c :|\n\nX:2\nT:u\nK:C\nc d e f |]\n`;
    const { out, plan } = cut(two, [of(two, "G A B c")]);
    expect(out).toBe(`${head("C")}C D E F |\n\nX:2\nT:u\nK:C\nc d e f |]\n`);
    expect(plan.caret).toBeLessThan(out.indexOf("X:2"));
  });
  it("Ctrl+A then Delete leaves no line of only :| or |]", () => {
    const tune = `${head("C")}|: C D E F :|\nG A B c |]\n`;
    const { out } = cut(tune, [{ from: tune.indexOf("C D"), to: tune.indexOf("B c") + 3 }]);
    expect(out.split("\n").filter((line) => /^\s*[:|\]]+\s*$/.test(line))).toEqual([]);
  });
});

describe("a second voice's rests are placeholders, typed over bar by bar (round 6, finding 9)", () => {
  const tune = "X:1\nT:t\nM:4/4\nL:1/8\n%%score 1\nK:C\nV:1\nc2 d2 e2 f2|g8|]\n";
  const made = newVoice(tune, tune.indexOf("c2"));
  if (!made) throw new Error("no voice");
  const text = apply(tune, made.changes);
  // The voice goes at the tune's end; %%score's " 2" comes before it.
  const start = tune.length + 2;
  const rests = made.rests.map((offset) => start + offset);
  it("one rest a bar, the first selected", () => {
    expect(rests.map((at) => text.slice(at, at + 2))).toEqual(["z8", "z8"]);
    expect(text.slice(start + made.offset, start + made.offset + made.first)).toBe("z8");
  });
  it("a note typed before a bar's placeholder shrinks it; the bar full, it goes", () => {
    const first = rests[0] as number;
    let typed = `${text.slice(0, first)}c2${text.slice(first)}`;
    let places = rests.map((at) => (at >= first ? at + 2 : at));
    let shrink = fillPlaceholder(typed, indexFile(typed), first + 2, places);
    typed = apply(typed, shrink);
    expect(typed).toContain("V:2 clef=bass\nc2z6 | z8 |");
    typed = `${typed.slice(0, first + 2)} d6${typed.slice(first + 2)}`;
    places = places.map((at) => (at > first ? at + 3 : at));
    shrink = fillPlaceholder(typed, indexFile(typed), first + 5, places);
    typed = apply(typed, shrink);
    expect(typed).toContain("V:2 clef=bass\nc2 d6 | z8 |");
    // At the full bar's end, typing goes on into the next bar's placeholder.
    const next = nextPlaceholder(typed, first + 5, [typed.indexOf("z8", first)]);
    expect(next).toBe(typed.indexOf("z8", first));
  });
});

describe("accessibility and layout (round 6, findings 11 and 12)", () => {
  it("a selection of rests is 3 rests", async () => {
    const { describePicked, selectedNotes } = await import("../src/composer/selected");
    const text = `${head()}C z z z |]\n`;
    expect(describePicked(selectedNotes(text, [of(text, "z z z")])).text).toBe("3 rests");
  });
  it("Duplicate of a whole line adds a new line, its verse with it", () => {
    const text = `${head()}C D E F |\nw: one two three four\nG A B c |]\n`;
    const plan = duplicate(text, [of(text, "C D E F")]);
    if ("refused" in plan) throw new Error(plan.refused);
    expect(apply(text, plan.changes)).toBe(
      `${head()}C D E F |\nw: one two three four\nC D E F |\nw: one two three four\nG A B c |]\n`,
    );
  });
  it("the status calls jumps by their names", async () => {
    const { placeMark } = await import("../src/composer/marks");
    const text = `${head()}C D E F |]\n`;
    expect(placeMark(text, [of(text, "C D E F")], "D.C.alfine")).toMatchObject({
      said: "D.C. al Fine at the end of the selection.",
    });
    expect(placeMark(text, [of(text, "C D E F")], "fine")).toMatchObject({
      said: "Fine at the end of the selection.",
    });
  });
  it("a paste's seams get single spaces", () => {
    const text = `${head()}C D E F | G A B c |]\n`;
    const range = of(text, "G A");
    const plan = planPaste(text, [range], 0, " e f ", null);
    if (!plan || "refused" in plan) throw new Error("no plan");
    expect(apply(text, plan.changes)).toContain("| e f B c |]");
  });
});
