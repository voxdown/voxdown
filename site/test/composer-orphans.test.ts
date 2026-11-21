import { describe, expect, it } from "vitest";
import { checkBars } from "../src/composer/barcheck";
import { indexFile } from "../src/composer/tunes";

describe("a blank line ends the tune", () => {
  it("ends the tune where abcjs does and notes the music below", () => {
    const text = "X:1\nT:Air\nM:4/4\nL:1/4\nK:C\n\nCDEF|GABc|\n";
    const file = indexFile(text);
    const tune = file.tunes[0];
    expect(tune?.to).toBe(text.indexOf("\n\n") + 1);
    expect(file.orphans).toHaveLength(1);
    const [orphan] = file.orphans;
    expect(text.slice(orphan?.from, orphan?.to)).toBe("CDEF|GABc|");
    expect(orphan?.tune?.title).toBe("Air");
    expect(text.slice(orphan?.blank?.from, orphan?.blank?.to)).toBe("\n");
    // The bar check reads only the tune.
    expect(checkBars(text, tune as never, file)).toEqual([]);
  });

  it("keeps blank lines between tunes and prose quiet", () => {
    const text =
      "%%abc-include x\nA collection of airs\n\nX:1\nK:C\nCDEF|\n\n\nThis tune is old.\n\nX:2\nK:G\nGABc|\n";
    const file = indexFile(text);
    expect(file.tunes).toHaveLength(2);
    expect(file.orphans).toEqual([]);
  });

  it("notes music before the first X: and after the last tune", () => {
    const text = "CDEF|\n\nX:1\nK:C\nCDEF|\n\n% a comment\nGABc|\nw: la la la la\n";
    const file = indexFile(text);
    expect(file.orphans).toHaveLength(2);
    expect(file.orphans[0]?.tune).toBeNull();
    expect(file.orphans[1]?.blank).toBeNull();
    expect(text.slice(file.orphans[1]?.from, file.orphans[1]?.to)).toBe("GABc|\nw: la la la la");
  });
});
