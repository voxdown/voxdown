import { describe, expect, it } from "vitest";
import { barIsFull, nearestOctave } from "../src/composer/helpers";
import { indexFile } from "../src/composer/tunes";

const HEAD = "X:1\nT:Helpers\nM:4/4\nL:1/4\nK:C\n";
/** The helper's answer with the caret at the end of `body` (or at "|" if marked). */
function at(body: string) {
  const text = `${HEAD}${body.replace("‸", "")}\n`;
  const caret = body.includes("‸") ? HEAD.length + body.indexOf("‸") : HEAD.length + body.length;
  return { text, caret, file: indexFile(text) };
}

describe("bar line on Space when the bar is full", () => {
  const full = (body: string) => {
    const { text, caret, file } = at(body);
    return barIsFull(text, caret, file);
  };
  it("fires only when the bar is exactly full", () => {
    expect(full("C D E F")).toBe(true);
    expect(full("C D E")).toBe(false);
    expect(full("C D E F G")).toBe(false);
    expect(full("C D E F | G A B c")).toBe(true);
    expect(full("C D E F | G A B")).toBe(false);
  });
  it("counts L:, tuplets, broken rhythm, ties and inline M:/L: changes", () => {
    expect(full("L:1/8\nCDEF GABc")).toBe(true);
    expect(full("(3CDE F")).toBe(false);
    expect(full("(3CDE F G")).toBe(true);
    expect(full("C>D E2")).toBe(true);
    expect(full("C D E F-")).toBe(true);
    expect(full("[M:3/4] C D E")).toBe(true);
    expect(full("[L:1/8] C2 D2 E2 F2")).toBe(true);
  });
  it("never fires in a pickup, inside marks, mid-line or outside music", () => {
    expect(full("C | D E F G")).toBe(true);
    expect(full("C")).toBe(false);
    expect(full('C D E "F')).toBe(false);
    expect(full("C D E F !trill")).toBe(false);
    expect(full("C D E F‸ G |")).toBe(false);
    expect(full("C D E F % note")).toBe(false);
    expect(full("C D E F\nw: la la la la")).toBe(false);
  });
  it("follows the voice it is in", () => {
    expect(full("V:1\nC D E F |\nV:2\nC, D, E,")).toBe(false);
    expect(full("V:1\nC D E\nV:2\nC, D, E, F,")).toBe(true);
  });
});

describe("automatic octave", () => {
  const octave = (body: string, typed: string) => {
    const { text, caret, file } = at(body);
    return nearestOctave(text, caret, typed, file);
  };
  /** Types a phrase letter by letter with the helper, as the editor would. */
  const phrase = (start: string, letters: string) => {
    let body = start;
    for (const letter of letters) body += `${octave(body, letter) ?? letter} `;
    return body.trim();
  };
  it("takes the octave nearest the note before, whatever the case typed", () => {
    expect(octave("B ", "c")).toBe("c");
    expect(octave("B ", "C")).toBe("c");
    expect(octave("c ", "b")).toBe("B");
    expect(octave("c ", "B")).toBe("B");
    expect(octave("a ", "d")).toBe("d'");
    expect(octave("a ", "e")).toBe("e");
    expect(octave("C ", "f")).toBe("F");
    expect(octave("g' ", "c")).toBe("c''");
  });
  it("keeps a phrase in one octave band, and repeated notes in theirs", () => {
    expect(phrase("d ", "fedcBAG")).toBe("d f e d c B A G");
    expect(phrase("d ", "fedcbag")).toBe("d f e d c B A G");
    expect(phrase("G ", "GGGG")).toBe("G G G G G");
    expect(phrase("c' ", "cc")).toBe("c' c' c'");
  });
  it("lets ' and , typed after a note move it, and follows from there", () => {
    expect(octave("c' ", "d")).toBe("d'");
    expect(octave("C, ", "D")).toBe("D,");
  });
  it("stays within the clef's range, taking the other side at its edges", () => {
    // Treble: G, to c'''. Below G, the nearest A would leave it, so the A above.
    expect(octave("C, ", "a")).toBe("A,");
    expect(octave("c''' ", "e")).toBe("e''");
    // Bass: C,, to e'.
    expect(octave("V:1 clef=bass\nC,, ", "a")).toBe("A,,");
    expect(octave("V:1 clef=bass\nE, ", "c")).toBe("C,");
  });
  it("leaves the first note alone, skips rests and grace notes, and follows the voice", () => {
    expect(octave("", "c")).toBeNull();
    expect(octave("c z ", "b")).toBe("B");
    expect(octave("c {g'}", "d")).toBe("d");
    expect(octave("V:1\nc d |\nV:2 clef=bass\nC,, D,, |\nV:1\nc ", "e")).toBe("e");
    expect(octave("V:1\nc d |\nV:2 clef=bass\nC,, D,, ", "e")).toBe("E,,");
  });
  it("only in music", () => {
    expect(octave('C "', "c")).toBeNull();
    expect(octave("C !", "c")).toBeNull();
    expect(octave("C [K:", "C")).toBeNull();
    expect(octave("C D\nw: ", "a")).toBeNull();
  });
});
