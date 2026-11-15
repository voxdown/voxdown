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

  it("comments out the words around a comment already there, never inside it", () => {
    const source = "Night fell. <!-- rain? --> The harbour was quiet.\n\n@Ann “Fine day.”";
    const done = apply(source, 0, source.length);
    expect(done).toBe(
      "<!-- Night fell. --> <!-- rain? --> <!-- The harbour was quiet.\n\n@Ann “Fine day.” -->",
    );
    // Nothing left outside a comment but spaces.
    expect(done.replace(/<!--[\s\S]*?-->/g, "").trim()).toBe("");
  });

  it("takes in a whole comment a selection starts or ends inside", () => {
    const source = "One <!-- a note --> two.";
    expect(apply(source, 8, source.length)).toBe("One <!-- a note --> <!-- two. -->");
    expect(commentOut(source, 4, 10)).toBeUndefined();
  });

  it("spaces a stray --> in the words so it can't end their comment", () => {
    expect(apply("A --> B", 0, 7)).toBe("<!-- A -- > B -->");
  });
});
