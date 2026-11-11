// @vitest-environment happy-dom
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorMarks } from "@voxdown/editor";
import { describe, expect, it, vi } from "vitest";
import { applyChanges, bookText, lines, parse, setSpeaker } from "voxdown";
import { countsOf } from "../src/writer/counts";
import { changesOnly, diffLines, diffWords, withWords } from "../src/writer/diff";
import { emphasisIn, frontMatterEnd, plainText, toggleEmphasis } from "../src/writer/emphasis";
import { asStory, decode } from "../src/writer/files";
import { Hearing, type Voice, pauseSeconds, toHear, voicesFor } from "../src/writer/hear";
import { rankScenes } from "../src/writer/outline";
import { afterParagraph, moveParagraph } from "../src/writer/paragraphs";
import { nearestName, problems } from "../src/writer/problems";
import { railAt, railPoints, railScenes, railY } from "../src/writer/rail";
import { Rescue, tabStory } from "../src/writer/rescue";
import { SaveQueue, autosaveCheck, checkDisk, sameText } from "../src/writer/saving";
import { moveSection } from "../src/writer/sections";
import { sidesHtml, sidesOf, sidesText } from "../src/writer/sides";
import { withoutSpareMarks } from "../src/writer/spare-marks";
import { thinVersions } from "../src/writer/store";
import {
  composed,
  dialogueTag,
  giveQuote,
  nextNarratedQuote,
  quotesIn,
  speechAt,
  speechOfMark,
} from "../src/writer/stretch";
import { fileNameFor, glimpse, listening, proseWords, wordCount } from "../src/writer/words";

describe("the scene rail's layout", () => {
  it("places scenes in proportion to the text, apart where there is room", () => {
    const points = railPoints([0, 500, 510, 900], 1000, 400);
    const ys = points.map((point) => point.y);
    // In order, within the rail, and each scene at least a label's room from the next.
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(12);
    expect(Math.max(...ys)).toBeLessThanOrEqual(388);
    const scenes = ys.slice(1, -1);
    for (let i = 1; i < scenes.length; i++) {
      expect((scenes[i] ?? 0) - (scenes[i - 1] ?? 0)).toBeGreaterThanOrEqual(22);
    }
    // A place in the text and its height on the rail go both ways.
    for (const at of [0, 250, 700, 1000]) expect(railAt(points, railY(points, at))).toBeCloseTo(at);
  });

  it("keeps scenes in order and on the rail when there are more than fit", () => {
    const starts = Array.from({ length: 90 }, (_, i) => i * 100);
    const ys = railPoints(starts, 9000, 300).map((point) => point.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(Math.max(...ys)).toBeLessThanOrEqual(288);
  });

  it("names headings by their words, and scene breaks by their number", () => {
    const story = parse("# The Start\n\nOnce.\n\n* * *\n\nThen.\n\n## {hidden} The End\n\nDone.");
    const breakAt = story.blocks.find((block) => block.kind === "break")?.range.from ?? -1;
    const scenes = railScenes(story, new Map([[breakAt, 2]]));
    expect(scenes.map(({ name, chapter }) => [name, chapter])).toEqual([
      ["The Start", true],
      ["Scene 2", false],
      ["The End", false],
    ]);
  });
});

describe("moving a paragraph", () => {
  const editor = (doc: string, cursor: number) =>
    new EditorView({
      state: EditorState.create({ doc, selection: EditorSelection.cursor(cursor) }),
      parent: document.body,
    });

  it("moves the paragraph past the next one and back, the cursor with it", () => {
    const view = editor("One.\n\nTwo.\nStill two.\n\nThree.", 8);
    moveParagraph(view, 1, null);
    expect(view.state.doc.toString()).toBe("One.\n\nThree.\n\nTwo.\nStill two.");
    expect(
      view.state.sliceDoc(view.state.selection.main.head, view.state.selection.main.head + 2),
    ).toBe("o.");
    moveParagraph(view, -1, null);
    expect(view.state.doc.toString()).toBe("One.\n\nTwo.\nStill two.\n\nThree.");
    view.destroy();
  });

  it("never moves anything above the front matter, nor the front matter itself", () => {
    const text = "---\ntitle: T\n---\n\nFirst.\n\nSecond.";
    const end = parse(text).frontMatter?.range.to ?? null;
    const view = editor(text, text.indexOf("First"));
    moveParagraph(view, -1, end);
    expect(view.state.doc.toString()).toBe(text);
    const top = editor(text, 2);
    moveParagraph(top, 1, end);
    expect(top.state.doc.toString()).toBe(text);
    view.destroy();
    top.destroy();
  });

  it("changes nothing in a story that is only to read", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "One.\n\nTwo.",
        selection: EditorSelection.cursor(0),
        extensions: EditorState.readOnly.of(true),
      }),
      parent: document.body,
    });
    expect(moveParagraph(view, 1, null)).toBe(true);
    expect(view.state.doc.toString()).toBe("One.\n\nTwo.");
    view.destroy();
  });
});

describe("the passage under the pointer", () => {
  const story = parse("@Ann “Hello,” said Ann. @Bob “Hi.”\n\n# A heading");

  it("is the speech or narration there, and the one a name gives its words to", () => {
    expect(speechAt(story, story.source.indexOf("Hello"))?.speaker).toBe("Ann");
    expect(speechAt(story, story.source.indexOf("said"))?.speaker).toBe("Narrator");
    expect(speechAt(story, story.source.indexOf("Hi"))?.speaker).toBe("Bob");
    expect(speechOfMark(story, story.source.indexOf("@Bob"))?.text).toBe("Hi.");
    // A heading is the narrator's, but not a passage to give away.
    expect(speechAt(story, story.source.indexOf("heading"))).toBeUndefined();
  });
});

describe("what to put right", () => {
  const lineOf = (text: string) => (at: number) => text.slice(0, at).split("\n").length;

  it("offers to add a name the story uses to the cast", () => {
    const text = "---\ncast:\n  Ann:\n---\n@Ann “Hi.” @Bob “Hello.”";
    const found = problems(parse(text), editorMarks(text), lineOf(text));
    expect(found.find((problem) => problem.code === "unknown-character")?.cast).toBe("Bob");
  });

  it("offers the cast's name for one mistyped, before adding it to the cast", () => {
    const text = "---\ncast:\n  Wanda:\n  Ann:\n---\n@Wnada “Hi.” @Zed “Hello.”";
    const found = problems(parse(text), editorMarks(text), lineOf(text)).filter(
      (problem) => problem.code === "unknown-character",
    );
    expect(found[0]?.fix).toMatchObject({ insert: "Wanda", label: "Change to @Wanda" });
    expect(found[0]?.cast).toBe("Wnada");
    expect(found[1]?.fix).toBeUndefined();
    expect(nearestName("Anne", ["Ann", "Anna"])).toBeUndefined();
    expect(nearestName("Percivel", ["Percival", "Gerald"])).toBe("Percival");
  });

  it("closes a sound left open where its line ends, CRLF or not", () => {
    for (const end of ["\n", "\r\n"]) {
      const text = `The door [creaks${end}and opens.`;
      const open = problems(parse(text), editorMarks(text), lineOf(text)).find(
        (problem) => problem.code === "open-bracket",
      );
      expect(open?.fix).toEqual({
        from: text.indexOf(end),
        to: text.indexOf(end),
        insert: "]",
        label: "Close it at the end of the line",
      });
    }
  });

  it("lists the editor's own slips with their fixes, in the story's order", () => {
    const text = "@ Wanda “Hi.”\n\n@Ann “Unclosed.";
    const found = problems(parse(text), editorMarks(text), lineOf(text));
    expect(found.map((problem) => problem.code)).toEqual(["loose-at", "unclosed-quote"]);
    expect(found[0]?.fix?.label).toBe("Change to @Wanda");
    expect(found[1]?.line).toBe(3);
  });
});

describe("emphasis", () => {
  const shown = (line: string) =>
    emphasisIn(line).map(({ from, to, strong }) => [line.slice(from, to), strong]);

  it("finds italics and bold as written, and nothing in names, addresses or escapes", () => {
    expect(shown("A *quiet* word and **loud** ones, _too_.")).toEqual([
      ["*quiet*", false],
      ["**loud**", true],
      ["_too_", false],
    ]);
    expect(shown("**bold *and italic* inside**")).toEqual([
      ["**bold *and italic* inside**", true],
      ["*and italic*", false],
    ]);
    expect(shown("@Big_Bad_Wolf at a_b_c, \\*not* this, 2 * 3 * 4, and * this *.")).toEqual([]);
  });

  it("takes the signs away for plain text", () => {
    expect(plainText("A *quiet* word and **loud** ones, 2 * 3.")).toBe(
      "A quiet word and loud ones, 2 * 3.",
    );
  });

  it("knows where the front matter ends without asking the story", () => {
    const state = (doc: string) => EditorState.create({ doc });
    expect(frontMatterEnd(state("---\ntitle: *Not emphasis*\n---\n\n*Yes.*"))).toBe(29);
    expect(frontMatterEnd(state("No front matter.\n---\n"))).toBe(0);
    expect(frontMatterEnd(state("---\nnever closed"))).toBe(0);
  });

  const editor = (doc: string, anchor: number, head = anchor) =>
    new EditorView({
      state: EditorState.create({ doc, selection: EditorSelection.single(anchor, head) }),
      parent: document.body,
    });

  it("puts the signs around the word at the cursor, and takes them away again", () => {
    const view = editor("Say it now.", 5);
    toggleEmphasis(false)(view);
    expect(view.state.doc.toString()).toBe("Say *it* now.");
    expect(view.state.selection.main.head).toBe(6);
    toggleEmphasis(true)(view);
    expect(view.state.doc.toString()).toBe("Say ***it*** now.");
    toggleEmphasis(false)(view);
    expect(view.state.doc.toString()).toBe("Say **it** now.");
    toggleEmphasis(true)(view);
    expect(view.state.doc.toString()).toBe("Say it now.");
    view.destroy();
  });

  it("wraps a selection, unwraps one selected with its signs, and opens a pair on nothing", () => {
    const view = editor("Very loud words.", 5, 15);
    toggleEmphasis(true)(view);
    expect(view.state.doc.toString()).toBe("Very **loud words**.");
    const { from, to } = view.state.selection.main;
    expect(view.state.sliceDoc(from, to)).toBe("loud words");
    view.dispatch({ selection: EditorSelection.single(5, 19) });
    toggleEmphasis(true)(view);
    expect(view.state.doc.toString()).toBe("Very loud words.");
    const empty = editor("Then ", 5);
    toggleEmphasis(false)(empty);
    expect(empty.state.doc.toString()).toBe("Then **");
    expect(empty.state.selection.main.head).toBe(6);
    view.destroy();
    empty.destroy();
  });
});

describe("a line of its own after the paragraph", () => {
  const put = (
    doc: string,
    cursor: number,
    line: string,
    select?: string,
    front: number | null = null,
  ) => {
    const state = EditorState.create({ doc, selection: EditorSelection.cursor(cursor) });
    const next = state.update(afterParagraph(state, front, line, select)).state;
    const { from, to } = next.selection.main;
    return { text: next.doc.toString(), selected: next.sliceDoc(from, to), at: from };
  };

  it("goes between two paragraphs with one blank line either side, the cursor after it", () => {
    const done = put("One, still one.\n\nTwo.", 3, "* * *");
    expect(done.text).toBe("One, still one.\n\n* * *\n\nTwo.");
    expect(done.text.slice(done.at)).toBe("Two.");
  });

  it("at the end, opens a new paragraph to go on writing, without piling up blank lines", () => {
    const done = put("One.\n\n\n", 1, "* * *");
    expect(done.text).toBe("One.\n\n* * *\n\n");
    expect(done.at).toBe(done.text.length);
  });

  it("selects a heading's words to type over, and never goes into the front matter", () => {
    const doc = "---\ntitle: T\n---\n\nFirst.";
    const done = put(doc, 5, "# A new chapter", "A new chapter", doc.indexOf("---\n\n") + 3);
    expect(done.text).toBe("---\ntitle: T\n---\n\n# A new chapter\n\nFirst.");
    expect(done.selected).toBe("A new chapter");
  });

  it("keeps a gap wider than one blank line as it was", () => {
    expect(put("A\n\n\n\nB", 0, "* * *").text).toBe("A\n\n* * *\n\n\n\nB");
  });
});

describe("comparing two versions", () => {
  it("finds the lines taken away and put in, whatever lies between", () => {
    const before = "A\nB\nC\nD\nE";
    const after = "A\nC\nD\nX\nE\nF";
    const lines = diffLines(before, after);
    expect(lines.filter((line) => line.kind !== "new").map((line) => line.text)).toEqual(
      before.split("\n"),
    );
    expect(lines.filter((line) => line.kind !== "gone").map((line) => line.text)).toEqual(
      after.split("\n"),
    );
    expect(lines.filter((line) => line.kind !== "same")).toEqual([
      { kind: "gone", text: "B" },
      { kind: "new", text: "X" },
      { kind: "new", text: "F" },
    ]);
  });

  it("reads CRLF and LF alike, and shows a long book's one change with what surrounds it", () => {
    const book = Array.from({ length: 5000 }, (_, i) => `Line ${i}.`);
    const changed = [...book];
    changed[2500] = "Line 2500, changed.";
    const shown = changesOnly(diffLines(book.join("\r\n"), changed.join("\n")));
    expect(shown.map((line) => line.kind)).toEqual([
      "skip",
      "same",
      "same",
      "gone",
      "new",
      "same",
      "same",
      "skip",
    ]);
    expect(shown[0]).toEqual({ kind: "skip", count: 2498 });
  });
});

describe("comparing words", () => {
  it("shows a line changed as one line, its words gone and new", () => {
    const rows = withWords(
      changesOnly(
        diffLines("One.\nThe old grey cat sat.\nTwo.", "One.\nThe young grey cat sat.\nTwo."),
      ),
    );
    expect(rows).toEqual([
      { kind: "same", text: "One." },
      {
        kind: "changed",
        parts: [
          { kind: "same", text: "The " },
          { kind: "gone", text: "old" },
          { kind: "new", text: "young" },
          { kind: "same", text: " grey cat sat." },
        ],
      },
      { kind: "same", text: "Two." },
    ]);
    expect(diffWords("a b", "a b")).toEqual([{ kind: "same", text: "a b" }]);
  });

  it("takes a name changed all through a long book line for line", () => {
    const book = Array.from({ length: 4000 }, (_, i) => `Holmes said ${i}.`);
    const rows = withWords(
      diffLines(book.join("\n"), book.map((line) => line.replace("Holmes", "Sherlock")).join("\n")),
    );
    expect(rows).toHaveLength(4000);
    expect(rows.every((row) => row.kind === "changed")).toBe(true);
  });
});

describe("the versions kept", () => {
  const HOUR = 3_600_000;
  const now = 400 * 24 * HOUR;
  it("keeps every recent one, then fewer the older they are, and those before a change", () => {
    const versions = [
      // Every ten minutes for three days.
      ...Array.from({ length: 3 * 24 * 6 }, (_, i) => ({
        at: now - i * 10 * 60_000,
        why: "Saved",
      })),
      { at: now - 5 * HOUR - 1, why: "Before going back" },
      { at: now - 200 * 24 * HOUR, why: "Opened" },
    ];
    const kept = thinVersions(versions, now);
    const ages = kept.map((version) => (now - version.at) / HOUR);
    expect(ages.filter((age) => age < 1)).toHaveLength(6);
    const day = kept.filter((version) => now - version.at >= HOUR && now - version.at < 24 * HOUR);
    expect(day.filter((version) => version.why === "Saved").length).toBeLessThanOrEqual(24);
    expect(kept.some((version) => version.why === "Before going back")).toBe(true);
    expect(ages.filter((age) => age >= 24 && age < 72).length).toBeLessThanOrEqual(3);
    expect(kept.at(-1)?.why).toBe("Opened");
    expect(ages).toEqual([...ages].sort((a, b) => a - b));
  });

  it("never lets saving often push out older versions, or those kept before a change", () => {
    const versions = [
      // Saved every 25 seconds for 55 minutes.
      ...Array.from({ length: 132 }, (_, i) => ({ at: now - i * 25_000, why: "Saved" })),
      { at: now - 3 * HOUR, why: "Before tidying" },
      { at: now - 30 * 24 * HOUR + HOUR, why: "Opened" },
      ...Array.from({ length: 20 }, (_, i) => ({ at: now - (2 + i) * 24 * HOUR, why: "Saved" })),
    ];
    const kept = thinVersions(versions, now);
    expect(kept.some((version) => version.why === "Before tidying")).toBe(true);
    expect(kept.some((version) => version.why === "Opened")).toBe(true);
    expect(kept.filter((version) => now - version.at >= 24 * HOUR).length).toBe(21);
    // The last ten minutes, twenty of them; then one every five minutes.
    const hour = kept.filter((version) => version.why === "Saved" && now - version.at < HOUR);
    expect(hour.length).toBeLessThanOrEqual(20 + 10);
  });

  it("lets the oldest go once they are too many characters together", () => {
    const big = "x".repeat(10_000_000);
    const versions = Array.from({ length: 8 }, (_, i) => ({
      at: now - i * 2 * 24 * HOUR,
      why: "Saved",
      text: big,
    }));
    expect(thinVersions(versions, now)).toHaveLength(5);
  });
});

describe("words", () => {
  it("counts words with their apostrophes and hyphens, in any script", () => {
    expect(wordCount("It’s a well-known fact, n'est-ce pas? Ünïcode 42 ok")).toBe(9);
  });

  it("counts a story's words as its book has them, marks and front matter left out", () => {
    const story =
      "---\ntitle: A long title here\ncast:\n  Ann:\n---\n# The Start\n\n@Ann (softly) “Hush now,” [an owl hoots] she said. %% a note %% {pause 1s}";
    expect(proseWords(story)).toBe(6);
  });

  it("counts every example's words as its book does", async () => {
    const { existsSync, readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    // Run from the repository or from the site.
    const folder = [join(process.cwd(), "examples"), join(process.cwd(), "..", "examples")].find(
      (path) => existsSync(path),
    ) as string;
    for (const name of readdirSync(folder).filter((file) => file.endsWith(".vxd"))) {
      const text = readFileSync(join(folder, name), "utf8");
      const book = wordCount(bookText(parse(text)));
      expect(proseWords(text), name).toBe(book);
    }
  });

  it("makes a file name from a title, as written, without the signs a file can't have", () => {
    expect(fileNameFor("The Night Ferry")).toBe("The Night Ferry");
    expect(fileNameFor("What? A/B: “Yes” *now*")).toBe("What A B “Yes” now");
    expect(fileNameFor("...")).toBe("Untitled");
  });

  it("says how long they take to hear, never 60 minutes past an hour", () => {
    expect(listening(10)).toBe("4 s to hear");
    expect(listening(1500)).toBe("10 min to hear");
    expect(listening(150 * 119.7)).toBe("2 h 0 min to hear");
    expect(listening(150 * 75)).toBe("1 h 15 min to hear");
  });

  it("knows a kept story by its title and first words, marks left out", () => {
    const story =
      '---\ntitle: "The Owl"\ncast:\n  Ann:\n---\n\n# One\n\n@Ann (softly) “Hush,” [an owl hoots] she said. %% a note %% {pause 1s} Then *quiet*.';
    expect(glimpse(story)).toEqual({
      title: "The Owl",
      words: "One “Hush,” she said. Then quiet.",
    });
    expect(glimpse("No front matter here.").title).toBeUndefined();
    expect(glimpse("word ".repeat(40)).words).toMatch(/^word( word)*…$/);
  });
});

describe("saving", () => {
  const known = { modified: 10, saved: "One.\nTwo.\n" };

  it("writes over a file as it was read, its date or line breaks changed or not", () => {
    expect(checkDisk({ text: "One.\r\nTwo.\r\n", modified: 99 }, known)).toEqual({ kind: "write" });
    expect(checkDisk({ text: "One.\nTwo.\n", modified: 10 }, known)).toEqual({ kind: "write" });
    // Other words with the same date: changed elsewhere all the same.
    const sameDate = { text: "Other words.", modified: 10 };
    expect(checkDisk(sameDate, known)).toEqual({ kind: "changed", disk: sameDate });
    expect(sameText("a\r\nb", "a\nb")).toBe(true);
  });

  it("asks before writing over changes made elsewhere, or a file it couldn't read", () => {
    const disk = { text: "One.\nTwo, from the laptop.\n", modified: 20 };
    expect(checkDisk(disk, known)).toEqual({ kind: "changed", disk });
    expect(checkDisk(undefined, known)).toEqual({ kind: "unread" });
    // A file never read here (a new one from Save as) is written.
    expect(checkDisk(undefined, { modified: undefined, saved: "" })).toEqual({ kind: "write" });
  });

  it("saves by itself only what it may, without asking, never blind", () => {
    const ready = {
      on: true,
      owner: true,
      hasFile: true,
      unsaved: true,
      mayWriteNow: true,
      disk: { kind: "write" } as const,
    };
    expect(autosaveCheck(ready)).toEqual({ kind: "write" });
    expect(autosaveCheck({ ...ready, on: false })).toMatchObject({ kind: "wait", reason: "off" });
    expect(autosaveCheck({ ...ready, owner: false })).toMatchObject({ reason: "not-owner" });
    expect(autosaveCheck({ ...ready, unsaved: false })).toMatchObject({ reason: "nothing" });
    expect(autosaveCheck({ ...ready, mayWriteNow: false })).toEqual({
      kind: "ask",
      reason: "permission",
    });
    expect(autosaveCheck({ ...ready, disk: { kind: "unread" } })).toMatchObject({ kind: "stop" });
  });

  it("saves one at a time, in order, a failure stopping none after it", async () => {
    const queue = new SaveQueue();
    const done: string[] = [];
    const slow =
      (name: string, ms: number, fail = false) =>
      () =>
        new Promise<string>((resolve, reject) =>
          setTimeout(() => {
            done.push(name);
            if (fail) reject(new Error(name));
            else resolve(name);
          }, ms),
        );
    const first = queue.run(slow("first", 30));
    const second = queue.run(slow("second", 1, true));
    const third = queue.run(slow("third", 1));
    await expect(first).resolves.toBe("first");
    await expect(second).rejects.toThrow("second");
    await expect(third).resolves.toBe("third");
    expect(done).toEqual(["first", "second", "third"]);
  });
});

describe("moving a scene or a chapter", () => {
  const story =
    "# One\n\nOpening.\n\n## A\n\nFirst.\n\n* * *\n\nSecond.\n\n# Two\n\n## C\n\nThird.";
  const at = (sign: string) => story.indexOf(sign);
  const chapters = [at("# One"), at("# Two")];
  const scenes = [at("## A"), at("* * *"), at("## C")];
  const move = (cursor: number, starts: number[], by: 1 | -1, walls: number[] = []) => {
    const state = EditorState.create({ doc: story, selection: EditorSelection.cursor(cursor) });
    const spec = moveSection(state, starts, by, walls);
    if (typeof spec === "string") return spec;
    const next = state.update(spec).state;
    return { text: next.doc.toString(), at: next.selection.main.head };
  };

  it("moves a scene past the next in its chapter, the blank lines kept, the cursor with it", () => {
    const done = move(at("First"), scenes, 1, chapters);
    expect(typeof done === "string" ? done : done.text).toBe(
      "# One\n\nOpening.\n\n* * *\n\nSecond.\n\n## A\n\nFirst.\n\n# Two\n\n## C\n\nThird.",
    );
    if (typeof done !== "string") expect(done.text.slice(done.at, done.at + 6)).toBe("First.");
  });

  it("never takes a scene past its chapter's heading, nor moves its opening words", () => {
    expect(move(at("First"), scenes, -1, chapters)).toBe("edge");
    expect(move(at("Second"), scenes, 1, chapters)).toBe("edge");
    expect(move(at("Opening"), scenes, 1, chapters)).toBe("outside");
  });

  it("moves the last chapter up, the end of the story going to the one now last", () => {
    const done = move(at("Third"), chapters, -1);
    expect(typeof done === "string" ? done : done.text).toBe(
      "# Two\n\n## C\n\nThird.\n\n# One\n\nOpening.\n\n## A\n\nFirst.\n\n* * *\n\nSecond.",
    );
    expect(move(at("Opening"), chapters, -1)).toBe("edge");
    expect(move(at("Third"), chapters, 1)).toBe("edge");
  });
});

describe("going to a chapter or scene", () => {
  const scenes = [
    { name: "Chapter 3" },
    { name: "Scene 30" },
    { name: "Chapter 30" },
    { name: "A visit" },
    { name: "Chapter 31" },
    { name: "A visit" },
  ];
  const within = ["", "Chapter 3", "", "Chapter 30", "", "Chapter 31"];
  const names = (typed: string) => rankScenes(scenes, within, typed);

  it("puts the name typed first, numbers matching whole", () => {
    expect(names("Chapter 30")[0]).toBe(2);
    expect(names("chapter 3")).toEqual([0, 1]);
    expect(names("30")).toEqual([1, 2, 3]);
  });

  it("tells scenes of one name apart by their chapter", () => {
    expect(names("visit")).toEqual([3, 5]);
    expect(names("visit 31")).toEqual([5]);
    expect(names("")).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe("sides", () => {
  const story = parse(
    "# The Inn\n\n@Ann “Hello, how are you today?” @Bob (gruffly) “Fine.” @Bob [coughs] @Ann “Good.”\n\n* * *\n\n@Bob “Later.”",
  );

  it("gives each character's lines scene by scene, with cues, how, and where they are", () => {
    const sides = sidesOf(story);
    const ann = sides.find((side) => side.name === "Ann");
    const bob = sides.find((side) => side.name === "Bob");
    expect(ann?.scenes.map((scene) => [scene.scene, scene.title])).toEqual([[1, "The Inn"]]);
    expect(ann?.scenes[0]?.lines.map((line) => [line.cue?.speaker ?? null, line.text])).toEqual([
      [null, "Hello, how are you today?"],
      ["Bob", "Good."],
    ]);
    const first = bob?.scenes[0]?.lines;
    expect(first?.[0]).toMatchObject({
      cue: { words: "Hello, how are you today?", speaker: "Ann" },
      direction: "gruffly",
      line: 3,
    });
    expect(first?.[1]).toMatchObject({ text: "coughs", vocal: true });
    // A new scene: no cue from the one before.
    expect(bob?.scenes[1]).toMatchObject({ scene: 2, title: "The Inn" });
    expect(bob?.scenes[1]?.lines[0]?.cue).toBeUndefined();
  });

  it("writes them as text, and as pages to print, one character to a page, escaped", () => {
    const text = sidesText(story);
    expect(text).toContain("-- Scene 1 · The Inn --");
    expect(text).toContain("Bob (gruffly): Fine.    [line 3]");
    const html = sidesHtml(parse("@Ann “<b>&</b>”"), "A & B");
    expect(html).toContain("&lt;b&gt;&amp;&lt;/b&gt;");
    expect(html).toContain("<title>A &amp; B: sides</title>");
    expect(html).toContain(".side + .side { break-before: page; }");
  });
});

describe("two edits as one", () => {
  it("makes the second in the text the first made, as one set of changes", () => {
    const source = "abc def";
    const first = [{ from: 0, to: 0, insert: "@X " }];
    const second = [{ from: 7, to: 10, insert: "DEF\nmore" }];
    expect(applyChanges(source, composed(source, first, second))).toBe(
      applyChanges(applyChanges(source, first), second),
    );
  });
});

describe("attributing quotes", () => {
  it("reads who a dialogue tag names, and nothing from a pronoun", () => {
    expect(dialogueTag("", " asked Mara.")).toBe("Mara");
    expect(dialogueTag("", ", Mara said softly.")).toBe("Mara");
    expect(dialogueTag("Then Tom whispered, ", "")).toBe("Tom");
    expect(dialogueTag("", " she said.")).toBeUndefined();
    expect(dialogueTag("", " The wind blew.")).toBeUndefined();
  });

  it("finds the next quote no one is marked to say, round to the first", () => {
    const story = parse("“One,” said Ann. @Bob “Two.”\n\nThe end. “Three?” asked Cy.");
    const first = nextNarratedQuote(story, -1);
    expect(first?.text).toBe("One,");
    expect(nextNarratedQuote(story, first?.from ?? 0)?.text).toBe("Three?");
    expect(nextNarratedQuote(story, story.source.length)?.text).toBe("One,");
  });
});

describe("words rescued as the page goes", () => {
  const memory = () => {
    const kept = new Map<string, string>();
    return {
      kept,
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    };
  };
  const words = { name: "a.vxd", text: "Last words.", saved: "", changedAt: 5 };

  it("keeps each story's own, and lets them go", () => {
    const storage = memory();
    const rescue = new Rescue(storage);
    rescue.write("a", words);
    rescue.write("b", { ...words, text: "Other." });
    expect(rescue.read("a")?.text).toBe("Last words.");
    expect(rescue.read("b")?.text).toBe("Other.");
    rescue.forget("a");
    expect(rescue.read("a")).toBeNull();
    expect(rescue.read("b")?.text).toBe("Other.");
  });

  it("reads the one written before each story had its own, for its story only", () => {
    const storage = memory();
    storage.setItem("vxd-writer-rescue", JSON.stringify({ ...words, id: "old" }));
    const rescue = new Rescue(storage);
    expect(rescue.read("old")?.text).toBe("Last words.");
    expect(rescue.read("new")).toBeNull();
    rescue.forget("old");
    expect(storage.kept.size).toBe(0);
  });

  it("survives a storage that refuses, and a tab remembers its story", () => {
    const full = {
      getItem: () => "{not json",
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {},
    };
    const rescue = new Rescue(full);
    // A storage that refuses says so, so that leaving can ask first.
    expect(rescue.write("a", words)).toBe(false);
    expect(new Rescue(memory()).write("a", words)).toBe(true);
    expect(rescue.read("a")).toBeNull();
    const session = memory();
    expect(tabStory(session)).toBeUndefined();
    expect(tabStory(session, "s1")).toBe("s1");
    expect(tabStory(session)).toBe("s1");
  });
});

describe("files in other encodings", () => {
  const bytes = (...values: number[]) => new Uint8Array(values).buffer;

  it("reads UTF-8 as it is, its byte order mark kept", () => {
    const utf8 = new TextEncoder().encode("\uFEFFCafé");
    expect(decode(utf8.buffer)).toEqual({ text: "\uFEFFCafé", encoding: "utf-8" });
  });

  it("reads Windows-1252 as what it is, never as broken UTF-8", () => {
    // "Café crème" in Windows-1252.
    const western = bytes(0x43, 0x61, 0x66, 0xe9, 0x20, 0x63, 0x72, 0xe8, 0x6d, 0x65);
    expect(decode(western)).toEqual({ text: "Café crème", encoding: "windows-1252" });
  });

  it("reads UTF-16 by its byte order mark", () => {
    expect(decode(bytes(0xff, 0xfe, 0x48, 0x00, 0x69, 0x00)).text).toBe("Hi");
    expect(decode(bytes(0xfe, 0xff, 0x00, 0x48, 0x00, 0x69)).encoding).toBe("utf-16be");
  });

  it("opens one that wasn't UTF-8 as a new story, never to be saved over the original by itself", () => {
    const handle = {} as FileSystemFileHandle;
    const opened = asStory("old.txt", "Café", handle, 5, "windows-1252");
    expect(opened).toEqual({
      name: "old.vxd",
      text: "Café",
      imported: true,
      encoding: "windows-1252",
    });
    expect(asStory("new.vxd", "Hi", handle, 5).handle).toBe(handle);
  });
});

describe("hearing it read aloud", () => {
  const voices = [
    { name: "Fr", lang: "fr-FR", default: false },
    { name: "Ann", lang: "en-GB", default: false },
    { name: "Usual", lang: "en-US", default: true },
    { name: "Bob", lang: "en-AU", default: false },
  ];

  it("gives the narrator the language's usual voice and each character another", () => {
    const chosen = voicesFor(["Narrator", "Ann", "Bob", "Cy"], voices, "en-GB", "Narrator");
    expect(voices[chosen.get("Narrator") ?? -1]?.name).toBe("Usual");
    expect(voices[chosen.get("Ann") ?? -1]?.name).toBe("Ann");
    expect(voices[chosen.get("Bob") ?? -1]?.name).toBe("Bob");
    expect(voices[chosen.get("Cy") ?? -1]?.name).toBe("Ann");
    expect(voicesFor(["Ann"], [], "en", "Narrator").size).toBe(0);
  });

  it("reads from the cursor to the end of its scene, pauses included", () => {
    const rows = lines(parse("@Ann “One.” {pause 2s}\n\n@Bob “Two.”\n\n* * *\n\n@Ann “Three.”"));
    const heard = toHear(rows, 1);
    expect(heard.map((row) => row.text)).toEqual(["One.", "2s", "Two."]);
    expect(toHear(rows, 3).map((row) => row.text)).toEqual(["Two."]);
    expect([pauseSeconds("2s"), pauseSeconds("500ms"), pauseSeconds("")]).toEqual([2, 0.5, 1]);
  });
});

describe("a reading stopped", () => {
  it("is never heard again, in a pause or a line, after another starts", async () => {
    const said: string[] = [];
    vi.stubGlobal(
      "SpeechSynthesisUtterance",
      class {
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        lang = "";
        voice: unknown = null;
        constructor(readonly text: string) {}
      },
    );
    const voice = {
      getVoices: () => [],
      speak: (utterance: { text: string; onend: (() => void) | null }) => {
        said.push(utterance.text);
        setTimeout(() => utterance.onend?.(), 5);
      },
      cancel: () => {},
    } as unknown as Voice;
    const hearing = new Hearing(() => voice);
    const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
    // Stopped in a pause: its next line never comes.
    const old = hearing.read(
      toHear(lines(parse("{pause 200ms}\n\n@Ann “OLD WORDS”")), 1),
      "en",
      "Narrator",
      () => {},
    );
    await wait(50);
    hearing.stop();
    const fresh = hearing.read(toHear(lines(parse("@Bob “NEW”")), 1), "en", "Narrator", () => {});
    await Promise.all([old, fresh]);
    await wait(300);
    expect(said).toEqual(["NEW"]);
    expect(hearing.on).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe("two quotes in the narrator's words", () => {
  const text = "“Hello,” said Alice. “Goodbye,” said Bob.";

  it("gives the second to its speaker and leaves the first as it was", () => {
    const story = parse(text);
    const [, second] = quotesIn(text, 0, text.length);
    const given = applyChanges(text, giveQuote(story, second as NonNullable<typeof second>, "Bob"));
    expect(given).toBe("“Hello,” said Alice. @Bob “Goodbye,” said Bob.");
    const heard = lines(parse(given)).map((line) => [line.speaker, line.text]);
    expect(heard).toEqual([
      ["Narrator", "“Hello,” said Alice."],
      ["Bob", "Goodbye,"],
      ["Narrator", "said Bob."],
    ]);
  });

  it("are both found by the next quote with no speaker", () => {
    const story = parse(text);
    const first = nextNarratedQuote(story, -1);
    const second = nextNarratedQuote(story, first?.from ?? 0);
    expect([first?.text, second?.text]).toEqual(["Hello,", "Goodbye,"]);
  });
});

describe("the counts", () => {
  it("time what is heard, not what is printed, and add the pauses", () => {
    const printed = `{book only} ${"word ".repeat(1000)}\n\n{audio only} Hi.`;
    expect(countsOf(parse(printed)).heard).toBeLessThan(2);
    expect(countsOf(parse(printed)).words).toBe(1000);
    const heard = `{audio only} ${"word ".repeat(1000)}\n\n{pause 120s}`;
    expect(Math.round(countsOf(parse(heard)).heard)).toBe(400 + 120);
    expect(countsOf(parse(heard)).words).toBe(0);
  });
});

describe("an edit's marks, no more than needed", () => {
  const give = (text: string, nth: number, name: string) => {
    const story = parse(text);
    const speeches = story.blocks
      .flatMap((block) => (block.kind === "paragraph" ? block.lines : []))
      .flatMap((line) => line.items)
      .filter((item) => item.kind === "speech");
    const target = speeches[nth];
    if (target?.kind !== "speech") throw new Error("no speech");
    return applyChanges(text, withoutSpareMarks(story, setSpeaker(story, target, name)));
  };

  it("leaves out a mark that says again who already speaks", () => {
    expect(give("@Wanda “Fine!” @Bob “Hm.”", 1, "Wanda")).toBe("@Wanda “Fine!” “Hm.”");
  });

  it("keeps every mark that changes who or how", () => {
    expect(give("@Wanda “Fine!” said Bob. “Hm.”", 2, "Bob")).toBe(
      "@Wanda “Fine!” said Bob. @Bob “Hm.”",
    );
    const text = "@Wanda (softly) “Fine!” @Wanda “Hm.”";
    expect(
      applyChanges(text, withoutSpareMarks(parse(text), [{ from: 0, to: 0, insert: "" }])),
    ).toBe(text);
  });
});
