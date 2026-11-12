import { describe, expect, it } from "vitest";
import { chapterLevel, findShape, parse, quotesOf, shapeStory, titleCased } from "../src";

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
    // Under the title's heading, a level down: the title is no chapter.
    expect(made).toContain("\n## CHAPTER 1. Loomings.\n");
    expect(chapterLevel(parse(made))).toBe(2);
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
    expect(made).toContain("\n## CHAPTER 2. The Carpet-Bag.\n");
    expect(made).toContain("*** START OF THE PROJECT GUTENBERG EBOOK 2701 ***");
    expect(made).toContain("STUBB. Avast");
  });
});

describe("a book's title", () => {
  const front = "---\nvoxdown: 1.2\nlanguage: en\ncast:\n---\n\n";
  const book =
    "The Ghost of Galilee\n\nChapter 1: The Challenge in the Courtyard\n\nThe late October sun cast long shadows.\n\nChapter 2: The Labyrinth of Parchment\n\nJulian began his search in the vaults of the present.\n";
  const all = { chapters: true, details: true };

  it("is found alone on its line above the first chapter, and made the heading at the top", () => {
    for (const text of [book, `${front}${book}`, `${front}# Untitled\n\n${book}`]) {
      const story = parse(text);
      const shape = findShape(story);
      expect(shape.title).toBe("The Ghost of Galilee");
      const made = shapeStory(story, shape, all);
      expect(made).toContain("title: The Ghost of Galilee\n");
      expect(made).toContain(
        "\n# The Ghost of Galilee\n\n## Chapter 1: The Challenge in the Courtyard\n\nThe late",
      );
      expect(made).not.toContain("Untitled");
      expect(made.match(/^# /gm)).toHaveLength(1);
      expect(chapterLevel(parse(made))).toBe(2);
    }
  });

  it("is the heading at the top, pasted over a new story's title, its chapters under it", () => {
    const story = parse(`${front}# ${book}`);
    const shape = findShape(story);
    expect([shape.title, shape.heading?.text]).toEqual([
      "The Ghost of Galilee",
      "The Ghost of Galilee",
    ]);
    const made = shapeStory(story, shape, all);
    expect(made).toContain("title: The Ghost of Galilee\n");
    expect(made).toContain("# The Ghost of Galilee\n\n## Chapter 1: The Challenge");
    // Chapters only: the heading stays the title, the chapters under it all the same.
    expect(shapeStory(story, shape, { chapters: true })).toContain("\n## Chapter 2: The Labyrinth");
  });

  it("left as a line of the story when not chosen, the chapters then the top headings", () => {
    const story = parse(book);
    const made = shapeStory(story, findShape(story), { chapters: true });
    expect(made).toContain("The Ghost of Galilee\n\n# Chapter 1: The Challenge");
    expect(chapterLevel(parse(made))).toBe(1);
  });

  it("is no sentence, nor one of two lines, nor a line of the story already a chapter", () => {
    for (const opening of [
      "It was a dark night.",
      "“Come in,” she said",
      "For my mother,",
      "The Ghost of Galilee\n\nA novel in six chapters, as told by Julian to his students.",
    ]) {
      const shape = findShape(parse(`${opening}\n\n${book.slice(book.indexOf("Chapter 1"))}`));
      expect(shape.title).toBeUndefined();
      expect(shape.titlePage).toEqual([]);
    }
  });

  it("leaves a new story's Untitled out of the title on a title page", () => {
    const story = parse(
      `${front}# Untitled\n\nThe Ghost\n\nof Galilee\n\nBy J. Doe\n\n${book.slice(book.indexOf("Chapter 1"))}`,
    );
    const shape = findShape(story);
    expect([shape.title, shape.author]).toEqual(["The Ghost of Galilee", "J. Doe"]);
    const made = shapeStory(story, shape, all);
    expect(made).toContain("\n# The Ghost of Galilee\n\n## Chapter 1:");
    expect(made).toContain("author: J. Doe");
    expect(made).not.toContain("By J. Doe");
  });

  it("is no `#` heading with the story's words under it: that is a chapter", () => {
    const story = parse("# One\n\nIt was quiet.\n\nCHAPTER 2.\n\nIt was loud.\n");
    const shape = findShape(story);
    expect(shape.heading).toBeUndefined();
    expect(shapeStory(story, shape, all)).toContain("\n# CHAPTER 2.\n");
  });
});

describe("where a story divides into chapters", () => {
  const levels = (text: string) => chapterLevel(parse(text));

  it("is the highest heading level used at least twice", () => {
    expect(levels("# One\n\nA.\n\n# Two\n\nB.\n")).toBe(1);
    expect(levels("# The Book\n\n## One\n\nA.\n\n## Two\n\nB.\n")).toBe(2);
    expect(levels("# Part One\n\n## One\n\n## Two\n\n# Part Two\n\n## Three\n")).toBe(1);
    expect(levels("# The Book\n\n## One\n\nA.\n\n### A scene\n\n### Another\n")).toBe(3);
  });

  it("is nowhere when no level is used twice: the story is one chapter", () => {
    expect(levels("# The Book\n\nA.\n")).toBeUndefined();
    expect(levels("# The Book\n\n## One\n\nA.\n")).toBeUndefined();
    expect(levels("Just words.\n")).toBeUndefined();
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

  it("leave the front matter whole, an ebook's Project Gutenberg header straight after it", () => {
    // As the Writer reads Project Gutenberg's EPUB in: its front matter, then the header.
    const story = parse(
      '---\nvoxdown: 1.1\ntitle: "Moby Dick; Or, The Whale"\nauthor: Herman Melville\nlanguage: en\ncast:\n---\n## The Project Gutenberg eBook of Moby Dick; Or, The Whale\n\nThis eBook is for the use of anyone anywhere.\n\n\\*\\*\\* START OF THE PROJECT GUTENBERG EBOOK MOBY DICK; OR, THE WHALE \\*\\*\\*\n\n# MOBY-DICK; or, THE WHALE.\n\n## CHAPTER 1. Loomings.\n\nCall me Ishmael.\n\n\\*\\*\\* END OF THE PROJECT GUTENBERG EBOOK MOBY DICK; OR, THE WHALE \\*\\*\\*\n\nThe licence.\n',
    );
    const shape = findShape(story);
    for (const choice of [{ notices: true }, { notices: true, details: true, chapters: true }]) {
      const made = shapeStory(story, shape, choice);
      const read = parse(made);
      expect(read.meta.language).toBe("en");
      expect(read.frontMatter?.range.from).toBe(0);
      // The front matter's last line still its own, and nothing of it in the story's text.
      expect(made).toMatch(/\ncast:\n---\n/);
      expect(made.indexOf("voxdown: 1.1")).toBe(made.lastIndexOf("voxdown: 1.1"));
      expect(made).not.toContain("Project Gutenberg");
      expect(made).toContain("Call me Ishmael.");
    }
  });

  it("write a title in capitals as a reader would", () => {
    expect(titleCased("MOBY-DICK; or, THE WHALE")).toBe("Moby-Dick; or, The Whale");
    expect(titleCased("THE WIND IN THE WILLOWS")).toBe("The Wind in the Willows");
    expect(titleCased("Already Written")).toBe("Already Written");
  });
});
