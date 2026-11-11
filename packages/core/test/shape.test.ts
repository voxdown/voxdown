import { describe, expect, it } from "vitest";
import { findShape, parse, quotesOf, shapeStory, titleCased } from "../src";

/** A book as a web page's text pastes it: Project Gutenberg's lines, a title page, contents. */
const PASTED = `---
voxdown: 1.1
cast:
---

# Untitled

*** START OF THE PROJECT GUTENBERG EBOOK 2701 ***
MOBY-DICK;

or, THE WHALE.

By Herman Melville

CONTENTS

ETYMOLOGY.

CHAPTER 1. Loomings.

CHAPTER 2. The Carpet-Bag.

CHAPTER 3. Midnight, Forecastle.

ETYMOLOGY.

(Supplied by a Late Consumptive Usher to a Grammar School.)

CHAPTER 1. Loomings.

Call me Ishmael. Some years ago—never mind how long precisely—I thought I would sail about.

CHAPTER 2. The Carpet-Bag.

“Landlord,” said I, “what sort of a chap is he?”

CHAPTER 3. Midnight, Forecastle.

1ST NANTUCKET SAILOR. Oh, boys, don’t be sentimental; it’s bad for the digestion!

STUBB. Avast there, my hearties, take a tonic.

1ST NANTUCKET SAILOR. Hurrah for the sea!

STARBUCK (aside). Not so loud, now.

The whale was gone.*** END OF THE PROJECT GUTENBERG EBOOK 2701 ***

Section 1. General Terms of Use and Redistributing Project Gutenberg™ electronic works
`;

describe("a book pasted as plain text", () => {
  const story = parse(PASTED);
  const shape = findShape(story);

  it("has its chapters found, its list of contents told from them", () => {
    expect(shape.chapters.map((chapter) => chapter.text)).toEqual([
      "ETYMOLOGY.",
      "CHAPTER 1. Loomings.",
      "CHAPTER 2. The Carpet-Bag.",
      "CHAPTER 3. Midnight, Forecastle.",
    ]);
    // CONTENTS and the four entries under it.
    expect(shape.contents).toHaveLength(5);
  });

  it("has its title and author from its title page, and Project Gutenberg's notices found", () => {
    expect(shape.title).toBe("Moby-Dick; or, The Whale");
    expect(shape.author).toBe("Herman Melville");
    expect(shape.notices).toHaveLength(2);
    expect(shape.lines.map((line) => line.handle)).toEqual([
      "NantucketSailor1",
      "Stubb",
      "NantucketSailor1",
      "Starbuck",
    ]);
  });

  it("is made a story as chosen, the story's own words untouched", () => {
    const made = shapeStory(story, shape, {
      chapters: true,
      contents: true,
      notices: true,
      details: true,
      lines: true,
    });
    expect(made).toContain("title: Moby-Dick; or, The Whale");
    expect(made).toContain("author: Herman Melville");
    expect(made).toContain("# Moby-Dick; or, The Whale");
    expect(made).toContain("{book only} CHAPTER 1. Loomings.");
    expect(made).toContain("\n# CHAPTER 1. Loomings.\n");
    expect(made).toContain("@NantucketSailor1 Oh, boys");
    expect(made).toContain("@Starbuck (aside) Not so loud, now.");
    expect(made).toContain('NantucketSailor1: "1st Nantucket Sailor"');
    expect(made).not.toContain("PROJECT GUTENBERG");
    expect(made).not.toContain("By Herman Melville");
    expect(made).toContain("The whale was gone.");
    // Read as VoxDown: the chapters are headings, the sailor says his lines, and the quote in
    // chapter 2 still waits for its speaker as it did.
    const read = parse(made);
    expect(read.blocks.filter((block) => block.kind === "heading")).toHaveLength(5);
    expect(read.warnings).toEqual([]);
    expect(quotesOf(read).filter((quote) => quote.narrated)).toHaveLength(2);
  });

  it("makes only what is chosen", () => {
    const made = shapeStory(story, shape, { chapters: true });
    expect(made).toContain("\n# CHAPTER 2. The Carpet-Bag.\n");
    expect(made).toContain("*** START OF THE PROJECT GUTENBERG EBOOK 2701 ***");
    expect(made).toContain("STUBB. Avast");
  });
});

describe("chapters found in other books", () => {
  it("join a chapter's number to its name on the next line, under the parts above them", () => {
    const story = parse(
      "PART ONE\n\nCHAPTER I.\n\nA Scandal in Bohemia\n\nTo Sherlock Holmes she is always the woman.\n\nCHAPTER II.\n\nThe Red-Headed League\n\nI had called upon my friend.\n",
    );
    const shape = findShape(story);
    expect(shape.chapters.map((chapter) => [chapter.level, chapter.text])).toEqual([
      [1, "PART ONE"],
      [2, "CHAPTER I. A Scandal in Bohemia"],
      [2, "CHAPTER II. The Red-Headed League"],
    ]);
    const made = shapeStory(story, shape, { chapters: true });
    expect(made).toContain("## CHAPTER I. A Scandal in Bohemia\n\nTo Sherlock Holmes");
  });

  it("find a title at the head of its chapter's first paragraph, as a web page's text has it", () => {
    const story = parse(
      "CHAPTER 1. Loomings.\n\nCHAPTER 2. The Carpet-Bag.\n\nCHAPTER 3. The Spouter-Inn.\n\nCHAPTER 1. Loomings.\nCall me Ishmael.\n\nThere now is your insular city.\n\nCHAPTER 2. The Carpet-Bag.\nI stuffed a shirt or two into my old carpet-bag.\n\nBOOK I. (Folio), CHAPTER I. (Sperm Whale).—This whale, well known to the French as the Cachalot.\n\nBOOK II. (Octavo), CHAPTER I. (Grampus).—Though this fish, whose loud sonorous breathing.\n\nBOOK III. (Duodecimo).—These include the smaller whales of all.\n",
    );
    const shape = findShape(story);
    expect(shape.contents).toHaveLength(3);
    expect(shape.chapters.map((chapter) => chapter.text)).toEqual([
      "CHAPTER 1. Loomings.",
      "CHAPTER 2. The Carpet-Bag.",
    ]);
    // A whale's book and chapter, in a list of whales, are no one's lines.
    expect(shape.lines).toEqual([]);
    const made = shapeStory(story, shape, { chapters: true });
    expect(made).toContain("# CHAPTER 1. Loomings.\n\nCall me Ishmael.");
    expect(made).toContain("# CHAPTER 2. The Carpet-Bag.\n\nI stuffed a shirt");
  });

  it("leave a book's own headings, and a line no one says twice, as they are", () => {
    const story = parse(
      "# One\n\nWARNING: keep out of the water.\n\nIt was quiet.\n\nCHAPTER 2.\n\nMR. JONES came in. He sat down.\n",
    );
    const shape = findShape(story);
    expect(shape.lines).toEqual([]);
    expect(shape.chapters.map((chapter) => chapter.text)).toEqual(["CHAPTER 2."]);
  });

  it("read a title page set out as headings, as a web page's is pasted", () => {
    const story = parse(
      "# Untitled\n\n*** START OF THE PROJECT GUTENBERG EBOOK 2701 ***\n\n# MOBY-DICK; or, THE WHALE.\n\n## By Herman Melville\n\nCONTENTS\n\nCHAPTER 1. Loomings.\n\nCHAPTER 2. The Carpet-Bag.\n\n## CHAPTER 1. Loomings.\n\nCall me Ishmael.\n",
    );
    const shape = findShape(story);
    expect([shape.title, shape.author]).toEqual(["Moby-Dick; or, The Whale", "Herman Melville"]);
    const made = shapeStory(story, shape, { details: true, notices: true });
    expect(made).toContain("title: Moby-Dick; or, The Whale");
    expect(made).toContain("# Moby-Dick; or, The Whale\n\nCONTENTS");
    expect(made).not.toContain("By Herman Melville");
  });

  it("write a title in capitals as a reader would", () => {
    expect(titleCased("MOBY-DICK; or, THE WHALE")).toBe("Moby-Dick; or, The Whale");
    expect(titleCased("THE WIND IN THE WILLOWS")).toBe("The Wind in the Willows");
    expect(titleCased("Already Written")).toBe("Already Written");
  });
});
