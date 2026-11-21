import { describe, expect, it } from "vitest";
import { pasteVoiced, voiceAt, voicedParts } from "../src/composer/paste";

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
    expect(voicedParts("V:1\nc d|\n")).toBeNull();
  });
  it("gives each selected place its own voice's part (the reviewer's case)", () => {
    const places = [range(tune, "c' b a g|"), range(tune, "c B A G|")];
    const plan = pasteVoiced(tune, places, voicedParts(copy) ?? []);
    expect("changes" in plan && apply(tune, plan.changes)).toBe(
      "X:1\nT:Paste\nM:4/4\nL:1/4\n%%score (1 2)\nK:C\nV:1\nc d e f|g a b c'|c d e f|f e d c|]\nV:2\nC D E F|G A B c|C D E F|F E D C|]\n",
    );
  });
  it("pastes the caret's voice's part, or the music without V: lines", () => {
    const at = tune.indexOf("f e d c");
    const plan = pasteVoiced(tune, [{ from: at, to: at }], voicedParts(copy) ?? []);
    expect("changes" in plan && plan.changes[0]?.insert).toBe("c d e f|");
    expect("message" in plan && plan.message).toMatch(/^Pasted V:1's part/);
    const three = `${tune.replace("%%score (1 2)", "%%score (1 2 3)")}V:3\nz4|]\n`;
    const z = three.indexOf("z4");
    const plain = pasteVoiced(three, [{ from: z, to: z }], voicedParts(copy) ?? []);
    expect("changes" in plain && plain.changes[0]?.insert).toBe("c d e f|\nC D E F|");
    expect("message" in plain && plain.message).toMatch(/without its V: lines: V:3 isn't in it/);
  });
  it("refuses rather than corrupt the tune when the places don't match the voices", () => {
    const places = [range(tune, "c' b a g|"), range(tune, "f e d c|"), range(tune, "c B A G|")];
    const plan = pasteVoiced(tune, places, voicedParts(copy) ?? []);
    expect("refused" in plan && plan.refused).toMatch(/2 voices .* 3 places/);
  });
  it("knows the voice at a place, from V: lines and [V:]", () => {
    expect(voiceAt(tune, tune.indexOf("C D E F"))).toBe("2");
    const inline = "K:C\n[V:A] c d [V:B] e f\n";
    expect(voiceAt(inline, inline.indexOf("e"))).toBe("B");
    expect(voiceAt(inline, inline.indexOf("d"))).toBe("A");
  });
});
