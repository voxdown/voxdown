import { describe, expect, it } from "vitest";
import { pasteVoiced, planPaste, sourceAt, voiceAt, voicedParts } from "../src/composer/paste";
import { indexFile } from "../src/composer/tunes";

const tune =
  "X:1\nT:Paste\nM:4/4\nL:1/4\n%%score (1 2)\nK:C\nV:1\nc d e f|g a b c'|c' b a g|f e d c|]\nV:2\nC D E F|G A B c|c B A G|F E D C|]\n";
const copy = "V:1\nc d e f|\nV:2\nC D E F|\n";
const apply = (text: string, changes: { from: number; to: number; insert: string }[]) =>
  [...changes]
    .sort((a, b) => b.from - a.from)
    .reduce(
      (out, change) => out.slice(0, change.from) + change.insert + out.slice(change.to),
      text,
    );
const range = (text: string, part: string, nth = 0) => {
  let from = text.indexOf(part);
  for (let n = 0; n < nth; n++) from = text.indexOf(part, from + 1);
  return { from, to: from + part.length };
};

describe("pasting a copy of several voices", () => {
  it("reads the copy's parts, and nothing else as one", () => {
    expect(voicedParts(copy)).toEqual([
      { voice: "1", text: "c d e f|" },
      { voice: "2", text: "C D E F|" },
    ]);
    expect(voicedParts("c d e f|")).toBeNull();
    expect(voicedParts("V:1\nc d|\n")).toEqual([{ voice: "1", text: "c d|" }]);
  });
  it("gives each selected place its own voice's part (the reviewer's case)", () => {
    const places = [range(tune, "c' b a g|"), range(tune, "c B A G|")];
    const plan = pasteVoiced(tune, places, voicedParts(copy) ?? []);
    expect("changes" in plan && apply(tune, plan.changes)).toBe(
      "X:1\nT:Paste\nM:4/4\nL:1/4\n%%score (1 2)\nK:C\nV:1\nc d e f|g a b c'|c d e f|f e d c|]\nV:2\nC D E F|G A B c|C D E F|F E D C|]\n",
    );
  });
  it("pastes the caret's voice's part, or one part into a voice the copy hasn't", () => {
    const at = tune.indexOf("f e d c");
    const plan = pasteVoiced(tune, [{ from: at, to: at }], voicedParts(copy) ?? []);
    expect("changes" in plan && plan.changes[0]?.insert).toBe("c d e f|");
    expect("message" in plan && plan.message).toMatch(/^Pasted V:1's part/);
    const three = `${tune.replace("%%score (1 2)", "%%score (1 2 3)")}V:3\nz4|]\n`;
    const z = three.indexOf("z4");
    const plain = pasteVoiced(three, [{ from: z, to: z }], voicedParts(copy) ?? []);
    expect("changes" in plain && plain.changes[0]?.insert).toBe("c d e f|");
    expect("message" in plain && plain.message).toBe("Pasted V:1's part; the copy also had V:2.");
  });
  it("a voice selected in two places, with one part, takes it in the first, said so", () => {
    const places = [range(tune, "c' b a g|"), range(tune, "f e d c|"), range(tune, "c B A G|")];
    const plan = pasteVoiced(tune, places, voicedParts(copy) ?? []);
    expect("message" in plan && plan.message).toMatch(/V:1 into the first of its 2 places/);
  });
  it("refuses when the places are in voices the copy doesn't have, and the counts differ", () => {
    const three = `${tune.replace("%%score (1 2)", "%%score (1 2 3)")}V:3\nz4|z4|]\n`;
    const places = [range(three, "z4"), range(three, "z4", 1), range(three, "f e d c")];
    const plan = pasteVoiced(three, places, voicedParts(copy) ?? []);
    expect("refused" in plan && plan.refused).toMatch(/V:1 and V:2 .* 3 places/);
  });
  it("knows the voice at a place, from V: lines and [V:]", () => {
    expect(voiceAt(tune, tune.indexOf("C D E F"))).toBe("2");
    const inline = "K:C\n[V:A] c d [V:B] e f\n";
    expect(voiceAt(inline, inline.indexOf("e"))).toBe("B");
    expect(voiceAt(inline, inline.indexOf("d"))).toBe("A");
  });
});

/* Round 3. */
const interleaved =
  "X:1\nT:Blocks\nM:4/4\nL:1/4\n%%score (1 2)\nK:C\nV:1\nc d e f|g a b c'|\nV:2\nC D E F|G A B c|\nV:1\nc' b a g|e f g a|]\nV:2\nc B A G|E F G A|]\n";
const four = "V:1\ng a b c'\nV:2\nG A B c\nV:1\ne f g a\nV:2\nE F G A\n";

describe("pasting a copy of voices from several V: blocks (round 3)", () => {
  it("a voice's parts are joined, in order, at a caret in that voice", () => {
    const at = interleaved.indexOf("c d e f");
    const plan = pasteVoiced(interleaved, [{ from: at, to: at }], voicedParts(four) ?? []);
    expect("changes" in plan && plan.changes[0]?.insert).toBe("g a b c' e f g a");
  });
  it("over a place in each voice, each takes all of its voice's music", () => {
    const places = [range(interleaved, "c d e f"), range(interleaved, "C D E F")];
    const plan = pasteVoiced(interleaved, places, voicedParts(four) ?? []);
    expect("changes" in plan && plan.changes.map((change) => change.insert)).toEqual([
      "g a b c' e f g a",
      "G A B c E F G A",
    ]);
  });
  it("over two places per voice, piece by piece", () => {
    const places = [
      range(interleaved, "g a b c'"),
      range(interleaved, "G A B c"),
      range(interleaved, "e f g a"),
      range(interleaved, "E F G A"),
    ];
    const plan = pasteVoiced(interleaved, places, voicedParts(four) ?? []);
    expect("changes" in plan && plan.changes.map((change) => [change.from, change.insert])).toEqual(
      [
        [places[0]?.from, "g a b c'"],
        [places[2]?.from, "e f g a"],
        [places[1]?.from, "G A B c"],
        [places[3]?.from, "E F G A"],
      ],
    );
  });
  it("is refused at a caret in the header, never joined onto its line", () => {
    const at = interleaved.indexOf("M:4/4");
    const plan = pasteVoiced(interleaved, [{ from: at, to: at }], voicedParts(four) ?? []);
    expect("refused" in plan && plan.refused).toMatch(/click in a voice's music/);
  });
  it("is refused into a tune without voices, unless the copy has one voice", () => {
    const single = "X:1\nT:One\nM:4/4\nL:1/4\nK:C\nc d e f|]\n";
    const at = single.indexOf("c d");
    const plan = pasteVoiced(single, [{ from: at, to: at }], voicedParts(four) ?? []);
    expect("refused" in plan && plan.refused).toMatch(/this tune one voice/);
    const one = pasteVoiced(single, [{ from: at, to: at }], voicedParts("V:1\ne e e e\n") ?? []);
    expect("changes" in one && one.changes[0]?.insert).toBe("e e e e");
  });
  it("a tune's voice is read in that tune only, not from the tune before", () => {
    const two = `${interleaved}\nX:2\nT:One\nK:C\nc d e f|]\n`;
    const at = two.indexOf("c d e f|]");
    const plan = pasteVoiced(two, [{ from: at, to: at }], voicedParts(four) ?? []);
    expect("refused" in plan).toBe(true);
  });
});

describe("plain music over places in several voices (round 3)", () => {
  const places = [range(tune, "c' b a g"), range(tune, "c B A G")];
  it("goes into the main place only, said so", () => {
    const plan = planPaste(tune, places, 1, "e e e e", null);
    expect(plan && "changes" in plan && plan.changes).toEqual([
      { ...places[1], insert: "e e e e" },
    ]);
    expect(plan && "message" in plan && plan.message).toMatch(/main selection only \(V:2\)/);
  });
  it("a copy with one V: line is that voice's music", () => {
    const plan = planPaste(tune, places, 1, "V:1\ne e e e\n", null);
    expect(plan && "changes" in plan && plan.changes).toEqual([
      { ...places[0], insert: "e e e e" },
    ]);
  });
  it("pasted over notes in one voice of two, it overwrites them, a rest for the time left (round 6)", () => {
    const plan = planPaste(tune, [places[0] as { from: number; to: number }], 0, "e e", null);
    expect(plan && "changes" in plan && plan.changes).toEqual([{ ...places[0], insert: "e e z2" }]);
    expect(plan && "message" in plan && plan.message).toMatch(
      /Pasted over the selection from its first note in V:1; rests fill the selection left; the other voices are as they were/,
    );
  });
  it("pasted at a caret in one voice of two, the other gets rests as long (round 6)", () => {
    const at = tune.indexOf("c' b a g");
    const plan = planPaste(tune, [{ from: at, to: at }], 0, "e e e e|", null);
    if (!plan || "refused" in plan) throw new Error("no plan");
    const out = apply(tune, plan.changes);
    expect(out).toContain("V:1\nc d e f|g a b c'|e e e e|c' b a g|");
    expect(out).toContain("V:2\nC D E F|G A B c|z4|c B A G|");
    expect(plan.message).toMatch(/rests in V:2 keep it in step/);
  });
  it("a two-voice copy on one note of a staff holding both: both, in step (round 6)", () => {
    const duet =
      "X:1\nT:Duet\nM:2/4\nL:1/8\n%%score (1 2)\nK:D\n[V:1] d2 fd | ed cB |]\n[V:2] F2 AF | GF ED |]\n";
    const at = duet.indexOf("ed cB");
    const plan = planPaste(duet, [{ from: at, to: at }], 0, "V:1\na2 a2|\nV:2\nA2 A2|\n", null);
    if (!plan || "refused" in plan) throw new Error("no plan");
    const out = apply(duet, plan.changes);
    expect(out).toContain("[V:1] d2 fd | a2 a2|ed cB |]");
    expect(out).toContain("[V:2] F2 AF | A2 A2|GF ED |]");
  });
});

describe("paste between tunes keeps the music sounding the same (round 3)", () => {
  const from =
    "X:1\nT:From\nM:4/4\nL:1/8\nK:D\nf2 g2 a2 c'2|]\n\nX:2\nT:To\nM:4/4\nL:1/4\nK:C\nC D E F|]\n";
  it("rewrites lengths for the unit and accidentals for the key, said so", () => {
    const source = sourceAt(from, indexFile(from), from.indexOf("f2"));
    const at = from.indexOf("C D");
    const plan = planPaste(from, [{ from: at, to: at }], 0, "f2 g2 a2 c'2|", source);
    expect(plan && "changes" in plan && plan.changes[0]?.insert).toBe("^f g a ^c'|");
    expect(plan && "message" in plan && plan.message).toBe(
      "Pasted from L:1/8, K:D: lengths and accidentals rewritten.",
    );
  });
  it("a chord keeps one length, and a bar's accidental carries", () => {
    const source = sourceAt(from, indexFile(from), from.indexOf("f2"));
    const at = from.indexOf("C D");
    const plan = planPaste(from, [{ from: at, to: at }], 0, "[DF]4 F2 =F2|", source);
    expect(plan && "changes" in plan && plan.changes[0]?.insert).toBe("[D^F]2 F =F|");
  });
  it("music copied from outside Composer is pasted as it is", () => {
    const at = from.indexOf("C D");
    expect(planPaste(from, [{ from: at, to: at }], 0, "f2 g2", null)).toBeNull();
  });
});

describe("a copy of voices' whole bars pasted over whole bars (round 3)", () => {
  it("doesn't double the bar lines", () => {
    const places = [range(tune, "c' b a g"), range(tune, "c B A G")];
    const plan = planPaste(tune, places, 0, copy, null);
    expect(plan && "changes" in plan && apply(tune, plan.changes)).toBe(
      "X:1\nT:Paste\nM:4/4\nL:1/4\n%%score (1 2)\nK:C\nV:1\nc d e f|g a b c'|c d e f|f e d c|]\nV:2\nC D E F|G A B c|C D E F|F E D C|]\n",
    );
  });
});
