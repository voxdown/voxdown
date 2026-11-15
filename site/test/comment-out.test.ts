import { describe, expect, it } from "vitest";
import { commentBack, commentOut, speakersChanged } from "../src/writer/comment-out";

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

  it("says whose words change speaker: a name, or half a quote, commented out", () => {
    const source = "The sun rose. @Ann (softly) “Get up.”";
    const out = commentOut(source, 0, 27);
    if (!out) throw new Error("not commented out");
    expect(speakersChanged(source, out)).toEqual([
      { words: "Get up.", was: "Ann", now: "Narrator" },
    ]);
    const quote = "@King “Whoever brings back the dragon,” said the King.";
    const half = commentOut(quote, 0, quote.indexOf("back the") + 8);
    if (!half) throw new Error("not commented out");
    expect(speakersChanged(quote, half).map((each) => [each.was, each.now])).toEqual([
      ["King", "Narrator"],
    ]);
    const plain = commentOut(source, 0, 13);
    if (!plain) throw new Error("not commented out");
    expect(speakersChanged(source, plain)).toEqual([]);
  });

  it("reads a group's lines with the group: a name taken out gives its words to the group's", () => {
    const source = "::: @Wanda reading the letter\n@Bob “I refuse,” he wrote.\n:::\n";
    const out = commentOut(source, source.indexOf("@Bob"), source.indexOf("@Bob") + 5);
    if (!out) throw new Error("not commented out");
    expect(speakersChanged(source, out, { from: 0, to: source.length })).toEqual([
      { words: "I refuse, he wrote.", was: "Bob", now: "Wanda" },
    ]);
  });

  it("puts a comment back: a cursor in it, its words as they were", () => {
    const source = "One <!-- two <!-- note -- > three --> four.";
    const back = commentBack(source, 10, 10);
    expect(back && source.slice(0, back.from) + back.insert + source.slice(back.to)).toBe(
      "One two <!-- note --> three four.",
    );
    expect(commentBack(source, 2, 2)).toBeUndefined();
    expect(commentBack(source, 4, 4)).toBeUndefined();
  });
});
