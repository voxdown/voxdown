import abcjs from "abcjs";
import { describe, expect, it } from "vitest";
import { checkLyrics, syllablePlaces } from "../src/composer/lyriccheck";
import { indexFile } from "../src/composer/tunes";

/** How many notes abcjs gives a w: line, read from its own parse. */
function abcjsUses(words: string): number {
  const tune = abcjs.parseOnly(`X:1\nK:C\n${"C ".repeat(30)}\nw:${words}\n`)[0] as never as {
    lines: { staff: { voices: { el_type: string; lyric?: unknown }[][] }[] }[];
  };
  const notes = (tune.lines[0]?.staff[0]?.voices[0] ?? []).filter(
    (element) => element.el_type === "note",
  );
  let last = -1;
  notes.forEach((note, index) => {
    if (note.lyric) last = index;
  });
  return last + 1;
}

describe("lyrics past their notes", () => {
  it("counts syllables the way abcjs places them", () => {
    for (const words of [
      "a b c",
      "syl-la-ble",
      "a--b",
      "a - b",
      "time__ of",
      "a * b",
      "a~b c",
      "a\\-b c",
      "go- ing",
    ]) {
      const places = syllablePlaces(words) ?? [];
      expect((places[places.length - 1] ?? -1) + 1, words).toBe(abcjsUses(words));
    }
    expect(syllablePlaces("a b | c")).toBeNull();
  });

  it("says how many syllables have no notes", () => {
    const text = "X:1\nK:C\nCDE|F2 G|\nw: Twin-kle twin-kle lit-tle star\n";
    const file = indexFile(text);
    const [issue] = checkLyrics(text, file.tunes[0] as never);
    expect(issue?.extra).toBe(2);
    expect(issue?.message).toMatch(/^2 syllables have no notes/);
    expect(text.slice(issue?.from, issue?.to)).toMatch(/^w:/);
  });

  it("is quiet when the words fit, verse by verse and voice by voice", () => {
    const text =
      "X:1\nM:4/4\nK:C\nV:1\nCDEF|\nw: one two three four\nw: and an-oth-er\nV:2\nC4|\nw: low\n";
    const file = indexFile(text);
    expect(checkLyrics(text, file.tunes[0] as never)).toEqual([]);
  });
});
