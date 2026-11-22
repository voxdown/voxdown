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
    expect(problems[0]?.message).toBe("!fermat… is missing its closing\u00a0!.");
    expect(text.slice(problems[0]?.from, problems[0]?.to)).toBe("!fermat");
    expect(problems[0]?.detail).toBeUndefined();
  });

  it("one cause, one problem: an unclosed quote takes in the letters abcjs skips after it", () => {
    const { text, problems } = read('"unclosed chord A B | (3abc d |');
    expect(problems.map((problem) => problem.message)).toEqual([
      'The chord symbol "unclosed is missing its closing\u00a0".',
    ]);
    expect(text.slice(problems[0]?.from, problems[0]?.to)).toBe('"unclosed');
    expect(problems[0]?.detail).toBe(
      "Until it is closed, abcjs skips what follows on this line (“h”, “o”, “r”).",
    );
    // An unclosed ! the same way, and a stray letter on another line still counts.
    const bang = read("!trill hello A B|\nC D h E|");
    expect(bang.problems.map((problem) => problem.message)).toEqual([
      "!trill… is missing its closing\u00a0!.",
      "“h” isn't ABC music here; abcjs skips it.",
    ]);
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

  it("an unclosed decoration read on to the next one", () => {
    const { text, problems } = read("!fermat A | !fermatta!B C|");
    expect(problems.map((problem) => problem.message)).toEqual([
      "!fermat… is missing its closing\u00a0!.",
      "!fermatta! isn't a decoration abcjs knows (did you mean !fermata!?).",
    ]);
    expect(text.slice(problems[1]?.from, problems[1]?.to)).toBe("!fermatta!");
  });

  it("an unclosed chord", () => {
    const { text, problems } = read("[CEG A B|");
    expect(problems[0]?.message).toBe("This chord [CEG is missing its closing\u00a0].");
    expect(text.slice(problems[0]?.from, problems[0]?.to)).toBe("[CEG");
  });

  it("an unclosed chord symbol", () => {
    const { problems } = read('"Am A B|');
    expect(problems[0]?.message).toBe('The chord symbol "Am is missing its closing\u00a0".');
  });

  it("unclosed grace notes", () => {
    const { problems } = read("A3 {g A|");
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toBe("The grace notes {g are missing their closing\u00a0}.");
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
      "This slur ( has no closing\u00a0): add one after its last note.",
    );
  });
});
