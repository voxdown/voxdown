import { describe, expect, it } from "vitest";
import { commentOut } from "../src/writer/comment-out";

const apply = (source: string, from: number, to: number) => {
  const out = commentOut(source, from, to);
  return out ? source.slice(0, out.from) + out.insert + source.slice(out.to) : source;
};

describe("commenting words out", () => {
  it("wraps words in one comment", () => {
    expect(apply("Night fell. Then.", 0, 11)).toBe("<!-- Night fell. --> Then.");
  });

  it("keeps a comment already there inside the new one, its end spaced", () => {
    const source = "Night fell. <!-- rain? --> The harbour was quiet.\n\n@Ann “Fine day.”";
    const done = apply(source, 0, source.length);
    expect(done).toBe(
      "<!-- Night fell. <!-- rain? -- > The harbour was quiet.\n\n@Ann “Fine day.” -->",
    );
    // One comment, nothing left outside it.
    expect(done.match(/<!--[\s\S]*?-->/g)).toHaveLength(1);
    expect(done.replace(/<!--[\s\S]*?-->/g, "").trim()).toBe("");
  });

  it("takes in a whole comment a selection starts or ends inside", () => {
    const source = "One <!-- a note --> two.";
    expect(apply(source, 8, source.length)).toBe("One <!-- <!-- a note -- > two. -->");
    expect(commentOut(source, 4, 10)).toBeUndefined();
  });

  it("spaces a stray --> in the words so it can't end their comment", () => {
    expect(apply("A --> B", 0, 7)).toBe("<!-- A -- > B -->");
  });

  it("says when a quote after the words loses its speaker's name", () => {
    const source = "The sun rose. @Ann (softly) “Get up.”";
    expect(commentOut(source, 0, 27)?.unnamed).toBe("Ann");
    expect(commentOut(source, 0, 13)?.unnamed).toBeUndefined();
  });
});
