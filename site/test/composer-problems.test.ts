import abcjs from "abcjs";
import { describe, expect, it } from "vitest";
import { checkSlurs, nearestDecoration, plainWarnings } from "../src/composer/problems";
import { parseWarnings } from "../src/composer/score";
import { indexFile } from "../src/composer/tunes";

const HEAD = "X:1\nM:4/4\nL:1/4\nK:C\n";
/** abcjs's own warnings for a line of music, placed in the text, then read in plain words. */
function read(music: string) {
  const text = `${HEAD}${music}\n`;
  const tune = abcjs.parseOnly(text)[0] as never as { warnings?: string[] };
  const placed = parseWarnings(tune.warnings ?? [], text, (char) => char);
  return { text, problems: plainWarnings(placed, text) };
}

describe("problems in plain words", () => {
  it("an unclosed decoration", () => {
    const { text, problems } = read("!fermat A B|");
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toBe("!fermat… is missing its closing !.");
    expect(text.slice(problems[0]?.from, problems[0]?.to)).toBe("!fermat");
    expect(problems[0]?.detail).toBeUndefined();
  });

  it("an unknown decoration, with a guess", () => {
    const { text, problems } = read("!fermatta!A B|");
    expect(problems[0]?.message).toBe(
      "!fermatta! isn't a decoration abcjs knows (did you mean !fermata!?).",
    );
    expect(text.slice(problems[0]?.from, problems[0]?.to)).toBe("!fermatta!");
    expect(read("!foo!A B|").problems[0]?.message).toBe("!foo! isn't a decoration abcjs knows.");
    expect(nearestDecoration("tril")).toBe("trill");
  });

  it("an unclosed chord", () => {
    const { text, problems } = read("[CEG A B|");
    expect(problems[0]?.message).toBe("This chord [CEG is missing its closing ].");
    expect(text.slice(problems[0]?.from, problems[0]?.to)).toBe("[CEG");
  });

  it("an unclosed chord symbol", () => {
    const { problems } = read('"Am A B|');
    expect(problems[0]?.message).toBe('The chord symbol "Am is missing its closing ".');
  });

  it("unclosed grace notes", () => {
    const { problems } = read("A3 {g A|");
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toBe("The grace notes {g are missing their closing }.");
  });

  it("a stray character", () => {
    const { text, problems } = read("A B $ C|");
    expect(problems[0]?.message).toBe("“$” isn't ABC music here; abcjs skips it.");
    expect(text.slice(problems[0]?.from, problems[0]?.to)).toBe("$");
  });

  it("keeps abcjs's words under ours when nothing fits", () => {
    const problems = plainWarnings([{ from: 0, to: 1, message: "Something new" }], "abc");
    expect(problems[0]?.message).toBe("abcjs couldn't read this part of the line.");
    expect(problems[0]?.detail).toBe("abcjs: Something new");
  });

  it("slurs that never close, or close nothing", () => {
    const text = `${HEAD}(A B C| D) E) F|\n`;
    const file = indexFile(text);
    const found = checkSlurs(text, file.tunes[0] as never, file);
    expect(found.map((each) => each.message)).toEqual([
      "This ) closes no slur: there is no ( before it in this voice.",
    ]);
    const open = `${HEAD}(A B C| D E F|\n`;
    const openFile = indexFile(open);
    expect(checkSlurs(open, openFile.tunes[0] as never, openFile)[0]?.message).toBe(
      "This slur ( has no closing ): add one after its last note.",
    );
  });
});
