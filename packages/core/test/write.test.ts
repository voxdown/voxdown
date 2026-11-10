import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type Speech,
  type Story,
  applyChanges,
  changesFrom,
  insertLine,
  insertSound,
  isName,
  parse,
  renameCharacter,
  setDirection,
  setFullName,
  setMeta,
  setSpeaker,
  spokenScript,
  write,
} from "../src/index";
import { root } from "./examples";

function speeches(story: Story): Speech[] {
  return story.blocks.flatMap((block) => {
    if (block.kind === "break") return [];
    const lines = block.kind === "heading" ? [block.line] : block.lines;
    return lines.flatMap((line) =>
      line.items.filter((item): item is Speech => item.kind === "speech"),
    );
  });
}

/** The nth speech of a one-line file, given to an edit, then the file and its script after. */
function edit(
  source: string,
  nth: number,
  change: (story: Story, speech: Speech) => ReturnType<typeof setSpeaker>,
) {
  const story = parse(source);
  const speech = speeches(story)[nth] as Speech;
  const text = applyChanges(source, change(story, speech));
  return { text, script: spokenScript(parse(text)) };
}

const exampleFiles = readdirSync(join(root, "examples")).filter((name) => name.endsWith(".vxd"));

describe("the writer", () => {
  it.each(exampleFiles)("writes %s back byte for byte", (name) => {
    const source = readFileSync(join(root, "examples", name), "utf8");
    expect(write(parse(source))).toBe(source);
    expect(changesFrom(parse(source))).toEqual([]);
  });

  it("keeps CRLF line endings and a byte order mark", () => {
    const source = "﻿---\r\ntitle: Toast\r\n---\r\n@Gerald “Hi.”\r\n";
    expect(write(parse(source))).toBe(source);
    const story = parse(source);
    story.meta.title = "Jam";
    expect(write(story)).toBe("﻿---\r\ntitle: Jam\r\n---\r\n@Gerald “Hi.”\r\n");
  });

  it("writes a speaker or direction changed on the model, touching only that mark", () => {
    const source = "Before.  Spaces kept.\n@Gerald “Could you not?” said the dragon.\n";
    const story = parse(source);
    const [, gerald] = speeches(story) as [Speech, Speech];
    gerald.speaker = "Wanda";
    gerald.ownDirection = "dryly";
    expect(write(story)).toBe(
      "Before.  Spaces kept.\n@Wanda (dryly) “Could you not?” said the dragon.\n",
    );
  });

  it("writes sounds, notes, instructions, heading levels, details and the cast", () => {
    const source = [
      "---",
      "title: Toast",
      "cast:",
      "  Gerald: Gerald the Dragon",
      "---",
      "# Toast",
      "@Gerald [snores] The kettle boiled. [kettle] %% softly %% {pause 2s}",
    ].join("\n");
    const story = parse(source);
    const heading = story.blocks[0];
    if (heading?.kind === "heading") heading.level = 2;
    const paragraph = story.blocks[1];
    if (paragraph?.kind !== "paragraph") throw new Error("expected a paragraph");
    for (const item of paragraph.lines[0]?.items ?? []) {
      if (item.kind === "vocal") item.description = "snores loudly";
      if (item.kind === "sound") item.description = "kettle [whistling]";
      if (item.kind === "note") item.text = "very softly";
      if (item.kind === "instruction") item.value = "1s";
    }
    story.meta.title = "Toast: a story";
    const gerald = story.cast[0];
    if (gerald) {
      gerald.name = "Gerald, a dragon";
      gerald.handle = "Gerry";
    }
    expect(write(story)).toBe(
      [
        "---",
        'title: "Toast: a story"',
        "cast:",
        "  Gerry: Gerald, a dragon",
        "---",
        "## Toast",
        "@Gerry [snores loudly] The kettle boiled. [kettle \\[whistling\\]] %% very softly %% {pause 1s}",
      ].join("\n"),
    );
  });

  it("refuses a story whose items were added or removed", () => {
    const story = parse("@Gerald “Hi.” [bell]");
    const paragraph = story.blocks[0];
    if (paragraph?.kind === "paragraph") paragraph.lines[0]?.items.pop();
    expect(() => write(story)).toThrow(/edit functions/);
  });
});

describe("changing who says a line (§13, rule 4)", () => {
  it("replaces the name in the mark", () => {
    expect(edit("@Gerald “Could you not?”", 0, (s, sp) => setSpeaker(s, sp, "Wanda")).text).toBe(
      "@Wanda “Could you not?”",
    );
  });

  it("marks a later quote that carried the speech on, so it keeps its speaker", () => {
    const result = edit("@Baker “Just a little flame,” said the baker. “Gently.”", 0, (s, sp) =>
      setSpeaker(s, sp, "Wanda"),
    );
    expect(result.text).toBe("@Wanda “Just a little flame,” said the baker. @Baker “Gently.”");
    expect(result.script).toBe(
      "Wanda: Just a little flame,\nNarrator: said the baker.\nBaker: Gently.",
    );
  });

  it("keeps the carried direction on the quote it marks", () => {
    const result = edit("@Advisor (urgent) “Sire,” whispered his advisor. “Attack!”", 0, (s, sp) =>
      setSpeaker(s, sp, "King"),
    );
    expect(result.text).toBe(
      "@King (urgent) “Sire,” whispered his advisor. @Advisor (urgent) “Attack!”",
    );
  });

  it("adds a mark to a quote that carried another speech on", () => {
    const result = edit("@Baker “Just a little flame,” said the baker. “Gently.”", 2, (s, sp) =>
      setSpeaker(s, sp, "Wanda"),
    );
    expect(result.text).toBe("@Baker “Just a little flame,” said the baker. @Wanda “Gently.”");
  });

  it("turns a quote's own @(…) into the new mark with its direction", () => {
    const result = edit("@(quieter) “Oh dear,” he said.", 0, (s, sp) => setSpeaker(s, sp, "King"));
    expect(result.text).toBe("@King (quieter) “Oh dear,” he said.");
    expect(result.script).toBe("King (quieter): Oh dear,\nNarrator: he said.");
  });

  it("gives narration and an unmarked quote to a character", () => {
    expect(edit("The dragon sighed.", 0, (s, sp) => setSpeaker(s, sp, "Gerald")).text).toBe(
      "@Gerald The dragon sighed.",
    );
    expect(edit("“Rooooar.”", 0, (s, sp) => setSpeaker(s, sp, "Gerald")).script).toBe(
      "Gerald: Rooooar.",
    );
  });

  it("gives unquoted speech back to the narrator by removing the name", () => {
    expect(edit("@Gerald (dry) Well.", 0, (s, sp) => setSpeaker(s, sp, "Narrator")).text).toBe(
      "@(dry) Well.",
    );
    expect(edit("@Gerald Well.", 0, (s, sp) => setSpeaker(s, sp, "narrator")).text).toBe("Well.");
  });

  it("splits unquoted speech at a direction mark", () => {
    const result = edit("@Gerald Could you not? @(yawning) I’m tired.", 1, (s, sp) =>
      setSpeaker(s, sp, "Wanda"),
    );
    expect(result.text).toBe("@Gerald Could you not? @Wanda (yawning) I’m tired.");
    expect(result.script).toBe("Gerald: Could you not?\nWanda (yawning): I’m tired.");
  });

  it("writes the cast's spelling and refuses what isn't a name", () => {
    const source = "---\ncast:\n  Clown: The Silly Clown\n---\n“Honk!”";
    expect(edit(source, 0, (s, sp) => setSpeaker(s, sp, "clown")).text).toContain("@Clown “Honk!”");
    expect(() => edit(source, 0, (s, sp) => setSpeaker(s, sp, "Silly Clown"))).toThrow(/one word/);
    expect(isName("O’Brien")).toBe(true);
    expect(isName("花子")).toBe(true);
    expect(isName("2pac")).toBe(false);
  });
});

describe("directions (§13, rules 3 and 5)", () => {
  const set = (source: string, nth: number, direction: string | null) =>
    edit(source, nth, (s, sp) => setDirection(s, sp, direction));

  it("adds a direction after the name, or before narration's first word", () => {
    expect(set("@Gerald “Could you not?”", 0, "yawning").text).toBe(
      "@Gerald (yawning) “Could you not?”",
    );
    expect(set("Once upon a time.", 0, "warmly").text).toBe("@(warmly) Once upon a time.");
  });

  it("replaces a direction where it is written", () => {
    expect(set("@Gerald (yawning) “Hi.”", 0, "sleepy").text).toBe("@Gerald (sleepy) “Hi.”");
    expect(set("@Gerald “I know. @(yawning) I’m tired.”", 1, "sleepy").text).toBe(
      "@Gerald “I know. @(sleepy) I’m tired.”",
    );
  });

  it("removes a direction with one space, and a mark narration no longer needs", () => {
    expect(set("@Gerald (yawning) “Hi.”", 0, null).text).toBe("@Gerald “Hi.”");
    expect(set("@(warmly) Once upon a time.", 0, null).text).toBe("Once upon a time.");
    expect(set("@Narrator (warmly) Once upon a time.", 0, null).text).toBe("Once upon a time.");
  });

  it("ends a carried direction with @()", () => {
    const result = set("@Gerald (yawning) “I’m tired,” he said. “Very.”", 2, null);
    expect(result.text).toBe("@Gerald (yawning) “I’m tired,” he said. @() “Very.”");
    expect(result.script).toBe("Gerald (yawning): I’m tired,\nNarrator: he said.\nGerald: Very.");
    expect(set("@Gerald (grumpy) “I know. @(yawning) I’m tired.”", 1, null).script).toBe(
      "Gerald (grumpy): I know.\nGerald: I’m tired.",
    );
  });

  it("gives a carried-on quote a direction of its own", () => {
    expect(set("@Gerald “I’m tired,” he said. “Very.”", 2, "brightly").text).toBe(
      "@Gerald “I’m tired,” he said. @(brightly) “Very.”",
    );
  });

  it("escapes parentheses that don't balance", () => {
    const result = set("@Gerald “Hi.”", 0, "sad :(");
    expect(result.text).toBe("@Gerald (sad :\\() “Hi.”");
    expect(result.script).toBe("Gerald (sad :(): Hi.");
  });
});

describe("renaming a character (§13, rule 6)", () => {
  it("renames the short name in the cast, the narrator key and every mark", () => {
    const source = [
      "---",
      "narrator: Peter",
      "cast:",
      "  Peter: Peter Rabbit",
      "---",
      "::: @peter (whispering)",
      "@Peter “Hi.” @Mother “Hush.”",
      ":::",
    ].join("\n");
    const story = parse(source);
    const text = applyChanges(source, renameCharacter(story, "Peter", "Pete"));
    expect(text).toBe(
      [
        "---",
        "narrator: Pete",
        "cast:",
        "  Pete: Peter Rabbit",
        "---",
        "::: @Pete (whispering)",
        "@Pete “Hi.” @Mother “Hush.”",
        ":::",
      ].join("\n"),
    );
  });

  it("sets a full name in every way the cast can write one", () => {
    const source = [
      "---",
      "cast:",
      "  Gerald:",
      "  Clown: The Silly Clown",
      "  Mother:",
      "    about: Kind.",
      "  Wanda:",
      "    name: Wanda the Witch",
      "title: Toast",
      "---",
      "Story.",
    ].join("\n");
    const story = parse(source);
    const all = [
      ...setFullName(story, "Gerald", "Gerald the Dragon"),
      ...setFullName(story, "Clown", "The Sad Clown"),
      ...setFullName(story, "Mother", "Mrs. Rabbit"),
      ...setFullName(story, "Wanda", "Wanda: Witch"),
      ...setFullName(story, "Percival", "Sir Percival"),
    ];
    const text = applyChanges(source, all);
    expect(parse(text).cast.map((member) => [member.handle, member.name])).toEqual([
      ["Gerald", "Gerald the Dragon"],
      ["Clown", "The Sad Clown"],
      ["Mother", "Mrs. Rabbit"],
      ["Wanda", "Wanda: Witch"],
      ["Percival", "Sir Percival"],
    ]);
    expect(parse(text).warnings.filter((w) => w.code === "front-matter")).toEqual([]);
    expect(text).toContain("  Percival: Sir Percival\ntitle: Toast");
  });

  it("adds front matter when there is none", () => {
    const story = parse("@Gerald “Hi.”\n");
    const text = applyChanges(story.source, setFullName(story, "Gerald", "Gerald the Dragon"));
    expect(text).toBe("---\ncast:\n  Gerald: Gerald the Dragon\n---\n\n@Gerald “Hi.”\n");
  });

  it("sets, quotes and removes book details", () => {
    const story = parse("---\ntitle: Toast\nauthor: Me\n---\nStory.");
    const text = applyChanges(story.source, [
      ...setMeta(story, "title", "1984"),
      ...setMeta(story, "author", null),
      ...setMeta(story, "language", "en-US"),
    ]);
    expect(text).toBe('---\ntitle: "1984"\nlanguage: en-US\n---\nStory.');
    expect(parse(text).meta).toMatchObject({ title: "1984", language: "en-US" });
  });
});

describe("adding marks (§13, rule 3)", () => {
  it("puts a sound after the word it belongs to, after one space", () => {
    const story = parse("The broom fell over. Then silence.");
    const at = story.source.indexOf("over") + 2;
    expect(applyChanges(story.source, insertSound(story, at, "clatter"))).toBe(
      "The broom fell over. [clatter] Then silence.",
    );
  });

  it("puts a page turn, pause or note on a line of its own", () => {
    const story = parse("One.\nTwo.\n");
    const at = story.source.indexOf("Two");
    const text = applyChanges(story.source, insertLine(story, at + 1, "{page}"));
    expect(text).toBe("One.\n{page}\nTwo.\n");
    expect(spokenScript(parse(text))).toBe("Narrator: One.\n{page}\nNarrator: Two.");
  });
});
