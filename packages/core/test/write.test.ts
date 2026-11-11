import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import v8 from "node:v8";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  type Item,
  type Speech,
  type Story,
  applyChanges,
  changesFrom,
  format,
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
import { diffChanges } from "../src/write";
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
    // The `@(…)` directed the whole narration, “Oh dear,” and he said: the words left with the
    // narrator keep it, with an `@(…)` of their own.
    const result = edit("@(quieter) “Oh dear,” he said.", 0, (s, sp) => setSpeaker(s, sp, "King"));
    expect(result.text).toBe("@King (quieter) “Oh dear,” @(quieter) he said.");
    expect(result.script).toBe("King (quieter): Oh dear,\nNarrator (quieter): he said.");
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

  const sound = (source: string, at: number) =>
    applyChanges(source, insertSound(parse(source), at, "clatter"));
  const line = (source: string, at: number, text = "{page}") =>
    applyChanges(source, insertLine(parse(source), at, text));

  it("never puts a sound where it would be a character's own, or inside something else", () => {
    // Inside a mark or its direction: after the first word the mark gives, not after the mark.
    expect(sound("@Gerald (yawning) “Hi there”", 3)).toBe("@Gerald (yawning) “Hi [clatter] there”");
    expect(sound("@Gerald (yawning) “Hi there”", 11)).toBe(
      "@Gerald (yawning) “Hi [clatter] there”",
    );
    // Inside an instruction or a note: after it.
    expect(sound("He paused {pause 2s} and went on.", 13)).toBe(
      "He paused {pause 2s} [clatter] and went on.",
    );
    expect(sound("A %% a note here %% b", 6)).toBe("A %% a note here %% [clatter] b");
    // In the front matter: after the story's first word.
    expect(sound("---\ntitle: X\n---\nStory.", 3)).toBe("---\ntitle: X\n---\nStory. [clatter]");
    // A mark with nothing after it: the sound would be Gerald's, so nothing is done.
    expect(insertSound(parse("@Gerald"), 3, "clatter")).toEqual([]);
    expect(applyChanges("Hi", insertSound(parse("Hi"), 0, "a]b"))).toBe("Hi [a\\]b]");
    expect(() => insertSound(parse("Hi"), 9, "clatter")).toThrow(RangeError);
  });

  it("never puts a line in the front matter or a note, and keeps the line endings", () => {
    expect(line("---\ntitle: X\n---\nStory.", 0)).toBe("---\ntitle: X\n---\n{page}\n\nStory.");
    expect(line("---\ntitle: X\n---", 2)).toBe("---\ntitle: X\n---\n{page}");
    expect(line("One.\r\nTwo.\r\n", 7)).toBe("One.\r\n{page}\r\nTwo.\r\n");
    expect(line("A %% note\nover lines %% b\nC", 12, "{pause}")).toBe(
      "{pause}\n\nA %% note\nover lines %% b\nC",
    );
    expect(() => insertLine(parse("Hi"), -1, "{page}")).toThrow(RangeError);
  });

  it("keeps a quote that runs over lines or paragraphs going past the new line (§5.7)", () => {
    const verse = "@Gerald (softly) “Twinkle, twinkle, little star,\nHow I wonder what you are.”";
    expect(spokenScript(parse(line(verse, verse.indexOf("How"))))).toBe(
      "Gerald (softly): Twinkle, twinkle, little star,\n{page}\nGerald (softly): How I wonder what you are.",
    );
    const paragraphs = "@Gerald “Once upon a time.\n\n“He believed.”";
    expect(line(paragraphs, paragraphs.indexOf("“He"))).toBe(
      "@Gerald “Once upon a time.\n\n{page}\n\n“He believed.”",
    );
  });
});

describe("what fuzzing, real books and review found", () => {
  const stretch = (story: Story, text: string) => {
    const found = speeches(story).find((speech) => speech.text === text);
    if (!found) throw new Error(`No stretch “${text}”`);
    return found;
  };
  const speaker = (source: string, text: string, name: string) => {
    const story = parse(source);
    return applyChanges(source, setSpeaker(story, stretch(story, text), name));
  };
  const direction = (source: string, text: string, value: string | null) => {
    const story = parse(source);
    return applyChanges(source, setDirection(story, stretch(story, text), value));
  };

  it("a direction set on one stretch leaves the later ones of its mark as they were", () => {
    expect(
      direction("@Gerald (yawning) “Hello,” he said. “I just woke up.”", "Hello,", "softly"),
    ).toBe("@Gerald (softly) “Hello,” he said. @(yawning) “I just woke up.”");
    expect(direction("@Gerald “Hello,” he said. “I’m tired.”", "Hello,", "softly")).toBe(
      "@Gerald (softly) “Hello,” he said. @() “I’m tired.”",
    );
  });

  it("a stretch given to someone else keeps how it is said, and other sounds keep their owner", () => {
    expect(
      speaker("@Gerald (yawning) “Hello,” he said. “I just woke up.”", "I just woke up.", "Wanda"),
    ).toBe("@Gerald (yawning) “Hello,” he said. @Wanda (yawning) “I just woke up.”");
    expect(speaker("@Fox [gasps] “Oh!” @Fox (sadly) [sighs] “Gone.”", "Oh!", "Wanda")).toBe(
      "@Fox [gasps] @Wanda “Oh!” @Fox (sadly) [sighs] “Gone.”",
    );
    expect(speaker("@Wanda [gasp] “Who’s there?”", "Who’s there?", "Gerald")).toBe(
      "@Wanda [gasp] @Gerald “Who’s there?”",
    );
  });

  it("narration given to a character gives the quote it holds, marked just before it", () => {
    const source = "The fox ran. “Wait!” called the hen.";
    const text = speaker(source, source, "Fox");
    expect(text).toBe("The fox ran. @Fox “Wait!” called the hen.");
    expect(spokenScript(parse(text))).toBe(
      "Narrator: The fox ran.\nFox: Wait!\nNarrator: called the hen.",
    );
    expect(speaker("@() “Hi,” said Gerald.", "“Hi,” said Gerald.", "Gerald")).toBe(
      "@Gerald “Hi,” said Gerald.",
    );
    expect(speaker("@Gerald “Hi,” he said (quietly).", "he said (quietly).", "Wanda")).toBe(
      "@Gerald “Hi,” @Wanda he said (quietly).",
    );
  });

  it("a quote over several lines is given away whole (§5.7)", () => {
    const verse = "@Gerald (softly) “Twinkle, twinkle, little star,\nHow I wonder what you are.”";
    expect(speaker(verse, "How I wonder what you are.", "Wanda")).toBe(
      "@Wanda (softly) “Twinkle, twinkle, little star,\nHow I wonder what you are.”",
    );
    expect(direction(verse, "How I wonder what you are.", "loudly")).toBe(
      "@Gerald (loudly) “Twinkle, twinkle, little star,\nHow I wonder what you are.”",
    );
  });

  it("renames the narrator, refuses a name that is taken, and keeps comments in the front matter", () => {
    const story = parse("@Gerald “Hi.” Once upon a time.");
    expect(applyChanges(story.source, renameCharacter(story, "Narrator", "Teller"))).toBe(
      "---\nnarrator: Teller\n---\n\n@Gerald “Hi.” Once upon a time.",
    );
    expect(() => renameCharacter(parse("@Gerald “Hi.” @Zed “Yo.”"), "Gerald", "Zed")).toThrow(
      "There is already a character called “Zed”.",
    );
    const cast = parse("---\ncast:\n  Gerald: Gerald the Dragon # the hero\n---\nHi.");
    expect(applyChanges(cast.source, setFullName(cast, "Gerald", "Sir Gerald"))).toBe(
      "---\ncast:\n  Gerald: Sir Gerald # the hero\n---\nHi.",
    );
    const meta = parse("---\ntitle: Old # working title\n---\nHi.");
    expect(applyChanges(meta.source, setMeta(meta, "title", "New"))).toBe(
      "---\ntitle: New # working title\n---\nHi.",
    );
  });

  it("the writer makes several changes, keeps the author's marks, and its changes say the same", () => {
    const story = parse("@Gerald “Hi.” @Wanda “Yo.”\nThe end.");
    const [hi, yo] = speeches(story) as [Speech, Speech];
    hi.speaker = "Wanda";
    yo.ownDirection = "softly";
    const text = "@Wanda “Hi.” @Wanda (softly) “Yo.”\nThe end.";
    expect(write(story)).toBe(text);
    expect(applyChanges(story.source, changesFrom(story))).toBe(text);
  });

  it("never changes the printed book: a mark next to punctuation goes without a space", () => {
    expect(direction("@Anna „Guten Morgen“, sagte Anna.", ", sagte Anna.", "leise")).toBe(
      "@Anna „Guten Morgen“@(leise), sagte Anna.",
    );
    expect(speaker("@Gerald “Hi”—and then he left.", "—and then he left.", "Wanda")).toBe(
      "@Gerald “Hi”@Wanda—and then he left.",
    );
    expect(direction("@Pierre « Bonjour », dit-il.", ", dit-il.", "doucement")).toBe(
      "@Pierre « Bonjour »@(doucement), dit-il.",
    );
    // A name can't touch the letter after it, and a space would show: nothing is done.
    const japanese = parse("@Hanako 花子は「はい」と言った。");
    expect(setSpeaker(japanese, stretch(japanese, "と言った。"), "Zed")).toEqual([]);
  });

  it("gives a quote away whole, over its sounds, page turns and directions", () => {
    expect(speaker("@Wanda “Come in— [door slams] oh.”", "Come in—", "Gerald")).toBe(
      "@Gerald “Come in— [door slams] oh.”",
    );
    expect(speaker("@Gerald “Hi. {page} How are you?”", "How are you?", "Wanda")).toBe(
      "@Wanda “Hi. {page} How are you?”",
    );
    expect(speaker("@Gerald “I know. @(yawning) I’m tired.”", "I know.", "Wanda")).toBe(
      "@Wanda “I know. @(yawning) I’m tired.”",
    );
    expect(speaker("@Gerald “Hi @[sneezes] there.”", "Hi", "Wanda")).toBe(
      "@Wanda “Hi @[sneezes] there.”",
    );
    // A direction runs to the quote's end, or to a direction of its own inside it.
    expect(direction("@Wanda “Come in— [door slams] oh.”", "Come in—", "startled")).toBe(
      "@Wanda (startled) “Come in— [door slams] oh.”",
    );
    expect(direction("@Gerald “I know. @(yawning) I’m tired.”", "I know.", "softly")).toBe(
      "@Gerald (softly) “I know. @(yawning) I’m tired.”",
    );
  });

  it("marks only the first later quote that carried the speech on, quickly on a crowded line", () => {
    const dense = `@Alice ${"“Hello,” said Alice. ".repeat(3)}`;
    expect(speaker(dense, "Hello,", "Zed")).toBe(
      "@Zed “Hello,” said Alice. @Alice “Hello,” said Alice. “Hello,” said Alice. ",
    );
    const crowded = parse(`@Alice ${"“Hello,” said Alice. ".repeat(1000)}`);
    const start = performance.now();
    expect(setSpeaker(crowded, stretch(crowded, "Hello,"), "Zed").length).toBe(2);
    expect(performance.now() - start).toBeLessThan(2000);
  });

  it("edits a speech over paragraphs as one, by its mark, with no new warnings (§5.7)", () => {
    const source =
      "@Tom “Maud! Are you up there?\n\n“I’ve rowed out twice.\n\n“Will you come down?”";
    const loud = direction(source, "I’ve rowed out twice.", "loudly");
    expect(loud).toBe(
      "@Tom (loudly) “Maud! Are you up there?\n\n“I’ve rowed out twice.\n\n“Will you come down?”",
    );
    expect(spokenScript(parse(loud))).toBe(
      "Tom (loudly): Maud! Are you up there?\n\nTom (loudly): I’ve rowed out twice.\n\nTom (loudly): Will you come down?",
    );
    const given = speaker(source, "Will you come down?", "Wanda");
    expect(given).toBe(
      "@Wanda “Maud! Are you up there?\n\n“I’ve rowed out twice.\n\n“Will you come down?”",
    );
    expect(parse(loud).warnings).toEqual([]);
    expect(parse(given).warnings).toEqual([]);
    // A paragraph's own direction carries into the next (§5.7). Without it, the next paragraph
    // keeps its direction with a `@(…)` just inside its opening mark, so it still carries on.
    const own = "@Tom “Maud!\n\n“@(angrily)I’ve rowed out twice.\n\n“Will you come down?”";
    const calmer = direction(own, "I’ve rowed out twice.", null);
    expect(calmer).toBe("@Tom “Maud!\n\n“I’ve rowed out twice.\n\n“@(angrily)Will you come down?”");
    expect(spokenScript(parse(calmer))).toBe(
      "Tom: Maud!\n\nTom: I’ve rowed out twice.\n\nTom (angrily): Will you come down?",
    );
    expect(parse(calmer).warnings).toEqual([]);
  });

  it("refuses a line that would change who says the rest", () => {
    const story = parse("@Gerald “Hi.”\nThe end.\n");
    expect(insertLine(story, story.source.indexOf("The"), "::: @Gerald")).toEqual([]);
  });

  it("keeps quoted values, comments and whole block scalars apart in the front matter", () => {
    const meta = (source: string, value: string | null) => {
      const story = parse(source);
      return applyChanges(source, setMeta(story, "title", value));
    };
    expect(meta('---\ntitle: "Chapter #1" # keep\n---\nHello.', "New")).toBe(
      "---\ntitle: New # keep\n---\nHello.",
    );
    expect(meta("---\ntitle: 'It''s # here' # keep\n---\nHi.", "New")).toBe(
      "---\ntitle: New # keep\n---\nHi.",
    );
    expect(meta("---\ntitle: |\n  First\n\n  Second\nauthor: Me\n---\nHello.", "New")).toBe(
      "---\ntitle: New\nauthor: Me\n---\nHello.",
    );
    expect(meta("---\ntitle: |\n  First\n\n  Second\n---\nHello.", null)).toBe("---\n---\nHello.");
    const cast = parse('---\ncast:\n  Gerald: "The #1 dragon" # hero\n---\nHi.');
    expect(applyChanges(cast.source, setFullName(cast, "Gerald", "Sir G"))).toBe(
      "---\ncast:\n  Gerald: Sir G # hero\n---\nHi.",
    );
  });
});

describe("review, round three", () => {
  const giveFirst = (source: string, name: string) => {
    const story = parse(source);
    const first = speeches(story).find((speech) => /[\p{L}\p{N}]/u.test(speech.text)) as Speech;
    return applyChanges(source, setSpeaker(story, first, name));
  };

  it("gives narration's first quote, from the stretch's start, as the parser reads its quotes", () => {
    expect(giveFirst("“I do,” Alice hastily replied; “at least I mean what I say.”", "Alice")).toBe(
      "@Alice “I do,” Alice hastily replied; “at least I mean what I say.”",
    );
    // A quote inside the quote, and plural possessives, don't end it.
    expect(giveFirst("“It’s the boys’ room, isn’t it, ‘no’.”", "Maud")).toBe(
      "@Maud “It’s the boys’ room, isn’t it, ‘no’.”",
    );
    expect(
      spokenScript(parse(giveFirst(`"Rock 'n' roll never dies, 'never'," whispered Zoë.`, "Maud"))),
    ).toBe("Maud: Rock 'n' roll never dies, 'never',\nNarrator: whispered Zoë.");
  });

  it("gives a group character's words whole, the quote they hold too (§7.2)", () => {
    const text = giveFirst(
      "::: @Gerald\nThey charge, shouting, ‘PREPARE TO MEET THY DOOM!’\n:::",
      "Wanda",
    );
    expect(text).toBe(
      "::: @Gerald\n@Wanda They charge, shouting, @Wanda ‘PREPARE TO MEET THY DOOM!’\n:::",
    );
    expect(spokenScript(parse(text))).toBe(
      "Wanda: They charge, shouting,\nWanda: PREPARE TO MEET THY DOOM!",
    );
  });

  it("gives an unmarked speech over paragraphs whole, and a sound made inside a quote with it", () => {
    const speech =
      "{page}\n\n“Maud! Are you up there?\n\n“I’ve rowed out twice.\n\n“Will you come down?”\n\nShe sighed.";
    const text = giveFirst(speech, "Tom");
    expect(text).toBe(speech.replace("“Maud!", "@Tom “Maud!"));
    expect(spokenScript(parse(text))).toBe(
      "{page}\n\nTom: Maud! Are you up there?\n\nTom: I’ve rowed out twice.\n\nTom: Will you come down?\n\nNarrator: She sighed.",
    );
    expect(parse(text).warnings).toEqual([]);
    const sound = giveFirst(
      "“It’s how I sing it. @[clears throat] Besides, nobody remembers.”",
      "Gull",
    );
    expect(spokenScript(parse(sound))).toBe(
      "Gull: It’s how I sing it.\nGull [clears throat]\nGull: Besides, nobody remembers.",
    );
  });

  it("adds a book detail at the indentation the front matter has, and reads it back", () => {
    const story = parse("---\n  author: Me\n---\nHello.");
    expect(applyChanges(story.source, setMeta(story, "title", "New"))).toBe(
      "---\n  author: Me\n  title: New\n---\nHello.",
    );
  });

  it("makes `cast: null` a cast, and refuses a cast that is a list", () => {
    const empty = parse("---\ncast: null\n---\nHello.");
    expect(applyChanges(empty.source, setFullName(empty, "Bob", "Robert"))).toBe(
      "---\ncast:\n  Bob: Robert\n---\nHello.",
    );
    expect(setFullName(parse("---\ncast: [Gerald, Wanda]\n---\nHello."), "Bob", "Robert")).toEqual(
      [],
    );
    expect(setFullName(parse("---\ncast:\n  - Gerald\n---\nHello."), "Bob", "Robert")).toEqual([]);
  });

  it("writes back changes to a long story with a line added, quickly and line by line", () => {
    const base = Array.from(
      { length: 30_000 },
      (_, at) => `@Alice “Line ${at},” she said.\n\n`,
    ).join("");
    const after = base
      .replace(/@Alice/g, "@Alicia")
      .replace("Line 15000,", "Line 15000,\nAnother line,");
    const start = performance.now();
    const changes = diffChanges(base, after);
    expect(performance.now() - start).toBeLessThan(2000);
    expect(applyChanges(base, changes)).toBe(after);
    expect(changes.length).toBeGreaterThan(29_000);
  });
});

describe("review, round four", () => {
  const giveFirst = (source: string, name: string) => {
    const story = parse(source);
    const first = speeches(story).find((speech) => /[\p{L}\p{N}]/u.test(speech.text)) as Speech;
    return applyChanges(source, setSpeaker(story, first, name));
  };

  it("writes a group's direction into the new mark, the one way §13.3 gives", () => {
    expect(giveFirst("::: @Tom (sighing)\n@Tom “Hi.”\n:::", "Zed")).toBe(
      "::: @Tom (sighing)\n@Zed (sighing) “Hi.”\n:::",
    );
  });

  it("writes narration's speaker through the model as setSpeaker gives it", () => {
    const story = parse("He said, “Hi.”");
    (speeches(story)[0] as Speech).speaker = "Tom";
    expect(write(story)).toBe("He said, @Tom “Hi.”");
  });

  it("refuses a heading level it can't write, and a change outside the text", () => {
    const story = parse("# Title\n\nText.");
    const heading = story.blocks[0];
    if (heading?.kind === "heading") heading.level = 9;
    expect(() => write(story)).toThrow(RangeError);
    expect(() => applyChanges("abc", [{ from: 2, to: 1, insert: "" }])).toThrow(RangeError);
    expect(() => applyChanges("abc", [{ from: -1, to: 0, insert: "" }])).toThrow(RangeError);
    expect(() => applyChanges("abc", [{ from: 3, to: 4, insert: "" }])).toThrow(RangeError);
  });

  it("puts a sound after a word, never before a mark, inside a line ending or inside a link", () => {
    const sound = (source: string, at: number) =>
      applyChanges(source, insertSound(parse(source), at, "clatter"));
    expect(sound("@Tom “Hello, you,” he said.", 0)).toBe("@Tom “Hello, [clatter] you,” he said.");
    expect(sound("Tom waved.\r\nNext.", 11)).toBe("Tom waved. [clatter]\r\nNext.");
    expect(sound("Tom waved.\r\n", 12)).toBe("Tom waved. [clatter]\r\n");
    expect(sound("See [the old bat](https://e.com) fly.", 9)).toBe(
      "See [the old bat](https://e.com) [clatter] fly.",
    );
  });

  it("takes out a mark the edit wrote that another already covers", () => {
    // A group character's words holding two quotes: one mark gives them all.
    expect(giveFirst('::: @Tom (sighing)\n"Yes," "Yes,"\n:::', "Zed")).toBe(
      '::: @Tom (sighing)\n@Zed (sighing) "Yes," "Yes,"\n:::',
    );
  });
});

describe("the writer, asked for what it can't do", () => {
  const items = (story: Story) =>
    story.blocks.flatMap((block) =>
      block.kind === "break"
        ? []
        : (block.kind === "heading" ? [block.line] : block.lines).flatMap((line) => line.items),
    );

  it("throws rather than write a note, sound or instruction that would read differently", () => {
    const note = parse("Hello. %% old %%");
    const found = items(note).find((item) => item.kind === "note");
    if (found?.kind === "note") found.text = "Use %% for notes.";
    expect(() => write(note)).toThrow(RangeError);
    const sound = parse("Hi [bang] there");
    const bang = items(sound).find((item) => item.kind === "sound");
    if (bang?.kind === "sound") bang.description = "";
    expect(() => write(sound)).toThrow(RangeError);
  });

  it("escapes an instruction's value, so it can't start another", () => {
    const story = parse("Hi {recorder:take 1} there");
    const take = items(story).find((item) => item.kind === "instruction");
    if (take?.kind === "instruction") take.value = "2} Goodbye. {pause";
    const text = write(story);
    expect(spokenScript(parse(text))).toBe(
      "Narrator: Hi\n{recorder:take 2} Goodbye. {pause}\nNarrator: there",
    );
  });

  it("throws rather than leave out a change an edit can't make", () => {
    const story = parse("don’t«{pause 2s}");
    const [first] = speeches(story);
    if (first) first.speaker = "Zed";
    expect(() => write(story)).toThrow(RangeError);
  });

  it("gives two stretches to one character with one mark, and renames quickly", () => {
    const story = parse("He polished his armor. [armor squeaking] He practiced his cry.");
    for (const stretch of speeches(story)) stretch.speaker = "Zed";
    expect(write(story)).toBe(
      "@Zed He polished his armor. [armor squeaking] He practiced his cry.",
    );
    const long = parse(
      `---\ncast:\n  Alice: Alice\n---\n${"@Alice “Hello,” she said. “How are you?”\n\n".repeat(3000)}`,
    );
    (long.cast[0] as (typeof long.cast)[number]).handle = "Alicia";
    const start = performance.now();
    expect(write(long)).toContain("@Alicia “Hello,”");
    expect(performance.now() - start).toBeLessThan(3000);
  });
});

describe("review, round five", () => {
  const nth = (source: string, at: number) => {
    const story = parse(source);
    return { story, speech: speeches(story)[at] as Speech };
  };
  const give = (source: string, at: number, name: string) => {
    const { story, speech } = nth(source, at);
    return applyChanges(source, setSpeaker(story, speech, name));
  };
  const say = (source: string, at: number, direction: string) => {
    const { story, speech } = nth(source, at);
    return applyChanges(source, setDirection(story, speech, direction));
  };

  it("gives an unmarked speech over paragraphs whole from any of them, from where it starts (§5.7)", () => {
    expect(give("“One.\n\n“Two.”", 1, "Ann")).toBe("@Ann “One.\n\n“Two.”");
    expect(give("“One.\n\n“Two.\n\n“Three,” said Ann.", 2, "Ann")).toBe(
      "@Ann “One.\n\n“Two.\n\n“Three,” said Ann.",
    );
    expect(give("He said, “One.\n\n“Two.”", 1, "Ann")).toBe("He said, @Ann “One.\n\n“Two.”");
    // A quote closed in its own paragraph carries nothing on.
    expect(give("“One,” he said.\n\n“Two.”", 1, "Ann")).toBe("“One,” he said.\n\n@Ann “Two.”");
  });

  it("gives a later paragraph of an unmarked speech a direction of its own, inside its mark", () => {
    expect(say("“One.\n\n“Two.”", 1, "soft")).toBe("“One.\n\n“@(soft)Two.”");
    expect(say("“One.\n\n“Two.\n\n“Three,” said Ann.", 2, "soft")).toBe(
      "“One.\n\n“Two.\n\n“@(soft)Three,” said Ann.",
    );
  });

  it("throws when changes made together would undo each other, and makes those that don't", () => {
    const together = parse("@Zoë (softly) “We’ll see,\nDon’t go.”");
    const [first, second] = speeches(together) as [Speech, Speech];
    first.speaker = "Ann";
    second.speaker = "Cy";
    expect(() => write(together)).toThrow(/undone by another/);
    const apart = parse("“One.”\n\n“Two.”");
    const [one, two] = speeches(apart) as [Speech, Speech];
    one.speaker = "Ann";
    two.speaker = "Bob";
    expect(write(apart)).toBe("@Ann “One.”\n\n@Bob “Two.”");
  });

  it("changes only the lines that differ, even where other lines look alike", () => {
    // Line 2 and line 9 are much alike: lining them up would rewrite everything between.
    const before =
      "::: @Gerald (whispering)\n“Hello,” said Gerald.\n:::\n\n::: whispering\n@Gerald “Hello. @(whispering) Hello.”\n:::\n\n“Hello,” said Gerald.\n";
    const after =
      "::: @Gerald (whispering)\n@Ann (whispering) “Hello,” @Ann (whispering) said Gerald.\n:::\n\n::: whispering\n@Gerald “Hello. @(whispering) Hello.”\n:::\n\n@Ann “Hello,” said Gerald.\n";
    const changes = diffChanges(before, after);
    expect(applyChanges(before, changes)).toBe(after);
    expect(changes.map((c) => before.slice(c.from, c.to))).toEqual(["“Hello,”", ""]);
  });

  it("lines up long texts quickly, however their lines move", () => {
    const n = 100_000;
    const lines = Array.from({ length: n }, (_, at) => `Line ${at}.\n`);
    const texts: Array<[string, string]> = [
      [lines.join(""), [...lines].reverse().join("")],
      [lines.join(""), [lines[n - 1], ...lines.slice(0, n - 1)].join("")],
      [lines.join(""), lines.map((line, at) => (at % 2 ? line : `${line}x\n`)).join("")],
      ["a\n".repeat(n), "a\nb\n".repeat(n / 2)],
      [lines.join(""), lines.map((line) => `@Zed ${line}`).join("")],
      [lines.join(""), lines.map((_, at) => lines[(at * 7919) % n]).join("")],
    ];
    for (const [a, b] of texts) {
      const start = performance.now();
      const changes = diffChanges(a, b);
      expect(performance.now() - start).toBeLessThan(2000);
      // Compared as a boolean: a failure would print two texts of 100,000 lines.
      expect(applyChanges(a, changes) === b).toBe(true);
    }
  });

  it("edits a line of many sounds quickly", () => {
    const source = `@Tom “Hi.” ${"[tap] ".repeat(40_000)}he said.`;
    const story = parse(source);
    const said = speeches(story).filter((speech) => /\p{L}/u.test(speech.text));
    const start = performance.now();
    expect(give(source, 0, "Ann").startsWith("@Ann “Hi.”")).toBe(true);
    const last = said[said.length - 1] as Speech;
    expect(setSpeaker(story, last, "Ann")).toHaveLength(1);
    expect(setDirection(story, last, "soft")).toHaveLength(1);
    expect(insertSound(story, source.length - 3, "bang")).toHaveLength(1);
    expect(performance.now() - start).toBeLessThan(3000);
  });

  it("escapes a parenthesis after a new name, and glues a name only where no space can go", () => {
    // Unescaped, `(Not now.)` would be read as how Ann says it (§6.1).
    expect(give("(Not now.) He left.", 0, "Ann")).toBe("@Ann \\(Not now.) He left.");
    expect(give("@Tom “Hi.” (Not now.) He left.", 1, "Ann")).toBe(
      "@Tom “Hi.” @Ann \\(Not now.) He left.",
    );
    // With no space between, a space after the name would show in the book.
    expect(give("@Tom “Hi.”(he left).", 1, "Ann")).toBe("@Tom “Hi.”@Ann\\(he left).");
    expect(give("@Tom “Hi.”—he left.", 1, "Ann")).toBe("@Tom “Hi.”@Ann—he left.");
    // A name glued to a word would run on into it, and a space would show: no change can do.
    expect(give("@Tom “Hi.”He left.", 1, "Ann")).toBe("@Tom “Hi.”He left.");
    expect(say("@Tom “Hi.”He left.", 1, "soft")).toBe("@Tom “Hi.”@(soft)He left.");
  });

  it("writes a book detail with a control character or a YAML float's name as it was given", () => {
    for (const value of ["One\rTwo", "Tab\there", "x\u0001y", "Line\u2028break", ".inf", "-.NaN"]) {
      const story = parse("---\ntitle: Old\n---\n\nHello.");
      const text = applyChanges(story.source, setMeta(story, "title", value));
      expect(parse(text).meta.title, JSON.stringify(value)).toBe(value);
      // No raw control character in the file: each is written as an escape.
      const front = text.slice(0, text.indexOf("\n---"));
      for (const raw of ["\r", "\u0001", "\u2028"]) expect(front).not.toContain(raw);
    }
    expect(
      applyChanges(
        "---\ntitle: Old\n---\n",
        setMeta(parse("---\ntitle: Old\n---\n"), "title", ".inf"),
      ),
    ).toBe('---\ntitle: ".inf"\n---\n');
  });

  it("puts in no line that brings a new warning", () => {
    const line = (text: string) => insertLine(parse("Hello.\n"), 0, text);
    for (const text of ["%% an open note", "“An open quote", ":::", "@Ann"]) {
      expect(line(text), text).toEqual([]);
    }
    expect(line("%% A note. %%")).toHaveLength(1);
    expect(line("{page}")).toHaveLength(1);
  });

  it("keeps nothing it read once an edit, the writer or the formatter is done", () => {
    // What an edit reads again and again is kept only while it works: ten edits to a long story
    // once left hundreds of megabytes behind them.
    v8.setFlagsFromString("--expose-gc");
    const gc = vm.runInNewContext("gc") as () => void;
    const paragraph =
      "@Gerald “It was the kind of night that hums,” he said. The dragon yawned and turned over.\n\n";
    const source = paragraph.repeat(6_000);
    const story = parse(source);
    const said = speeches(story);
    gc();
    const before = process.memoryUsage().heapUsed;
    for (let at = 0; at < 10; at++) {
      const target = said[(at * 997) % said.length] as Speech;
      if (at % 2) setSpeaker(story, target, "Ann");
      else setDirection(story, target, "softly");
    }
    insertSound(story, 100, "bang");
    format(source);
    (said[5] as Speech).speaker = "Ann";
    write(story);
    gc();
    expect((process.memoryUsage().heapUsed - before) / 1e6).toBeLessThan(100);
  }, 60_000);
});

describe("review, round six", () => {
  const nth = (source: string, at: number) => {
    const story = parse(source);
    return { story, speech: speeches(story)[at] as Speech };
  };
  const give = (source: string, at: number, name: string) => {
    const { story, speech } = nth(source, at);
    return applyChanges(source, setSpeaker(story, speech, name));
  };
  const say = (source: string, at: number, direction: string) => {
    const { story, speech } = nth(source, at);
    return applyChanges(source, setDirection(story, speech, direction));
  };

  it("puts in no line that would hide, unprint or split what it joins", () => {
    const line = (source: string, at: number, text: string) =>
      applyChanges(source, insertLine(parse(source), at, text));
    for (const text of ["{hidden}", "{book only}", "{audio only}", "", "x\ny", "Hello there."]) {
      expect(line("A b.\nC.", 5, text), JSON.stringify(text)).toBe("A b.\nC.");
    }
    expect(line("A.\nB.", 3, "{page}")).toBe("A.\n{page}\nB.");
    expect(line("A.\nB.", 3, "[thunder]")).toBe("A.\n[thunder]\nB.");
    // Before a paragraph, as a paragraph of its own, it hides only itself.
    expect(line("A.\n\nB.", 4, "{hidden}")).toBe("A.\n\n{hidden}\n\nB.");
  });

  it("gives narration between a mark and its quote, the mark going before the quote (§5.4)", () => {
    expect(give("@Gerald Gerald put on his spectacles. “I thought so.”", 0, "Zed")).toBe(
      "@Zed Gerald put on his spectacles. @Gerald “I thought so.”",
    );
    expect(
      give("@Baker (nervously) And out of the blue, “Just a little flame,” he said.", 0, "Zed"),
    ).toBe("@Zed And out of the blue, @Baker (nervously) “Just a little flame,” he said.");
    expect(give("@Wanda She stared at the broom. [gasp] “On strike?”", 0, "Zed")).toBe(
      "@Zed She stared at the broom. [gasp] @Wanda “On strike?”",
    );
    expect(give("@Gerald yawning “I’m tired.”", 0, "Zed")).toBe(
      "@Zed yawning @Gerald “I’m tired.”",
    );
  });

  it("sets a direction from the mark for a whole speech, and one of a stretch's own in its place", () => {
    // A speech over paragraphs takes its direction from its mark: setting it sets the mark's.
    expect(say("@Gerald “One.\n\n“Two.\n\n“Three.”", 1, "soft")).toBe(
      "@Gerald (soft) “One.\n\n“Two.\n\n“Three.”",
    );
    // A stretch whose direction comes from a `@(…)` gets one of its own, and the rest keep theirs:
    // in a paragraph that carries the speech on, just inside its opening mark (§13, rule 3).
    expect(say("@Gerald “One. @(loud) More.\n\n“Two.\n\n“Three.”", 2, "soft")).toBe(
      "@Gerald “One. @(loud) More.\n\n“@(soft)Two.\n\n“@(loud)Three.”",
    );
    // On the next line of a quote, the mark on the line before isn't touched.
    expect(say("@Gerald “One. @(loud) More,\nAgain.”", 2, "soft")).toBe(
      "@Gerald “One. @(loud) More,\n@(soft) Again.”",
    );
  });

  it("sets a detail to one value, never over the cast, with changes of just where and what", () => {
    const story = parse("---\ntitle: Old\ncast:\n  Tom: T\n---\n\n@Tom “Hi.”");
    expect(setMeta(story, "cast", "x")).toEqual([]);
    expect(setMeta(story, "cast", null)).toEqual([]);
    for (const changes of [setMeta(story, "title", "New"), setFullName(story, "Tom", "Thomas")]) {
      for (const change of changes)
        expect(Object.keys(change).sort()).toEqual(["from", "insert", "to"]);
    }
  });

  it("throws for a change on the model it can't write, rather than leave it out", () => {
    const source =
      "---\ncast:\n  Tom:\n    name: T\n    about: A cat.\n---\n\n::: softly\n@Tom [snores] “Hi.” ![a](b.png)\n:::\n";
    const changed: Array<[string, (story: Story) => void]> = [
      [
        "vocal",
        (story) =>
          findItem(story, "vocal", (item) => {
            item.speaker = "Ann";
          }),
      ],
      [
        "speech text",
        (story) =>
          findItem(story, "speech", (item) => {
            item.text = "Bye.";
          }),
      ],
      [
        "image",
        (story) =>
          findItem(story, "image", (item) => {
            item.alt = "c";
          }),
      ],
      [
        "narrator",
        (story) => {
          story.meta.narrator = "Ann";
        },
      ],
      [
        "about",
        (story) => {
          (story.cast[0] as Story["cast"][number]).about = "A dog.";
        },
      ],
      [
        "group",
        (story) => {
          (story.groups[0] as Story["groups"][number]).direction = "loudly";
        },
      ],
      [
        "visibility",
        (story) => {
          (story.blocks[0] as { visibility: string }).visibility = "book";
        },
      ],
    ];
    for (const [what, change] of changed) {
      const story = parse(source);
      change(story);
      expect(() => write(story), what).toThrow(RangeError);
    }
    expect(write(parse(source))).toBe(source);
  });
});

function findItem<K extends Item["kind"]>(
  story: Story,
  kind: K,
  change: (item: Extract<Item, { kind: K }>) => void,
): void {
  for (const block of story.blocks) {
    if (block.kind !== "paragraph") continue;
    for (const line of block.lines) {
      const item = line.items.find((other) => other.kind === kind);
      if (item) {
        change(item as Extract<Item, { kind: K }>);
        return;
      }
    }
  }
}

describe("review, round seven", () => {
  const edit = (
    source: string,
    make: (story: Story, first: Speech) => ReturnType<typeof setSpeaker>,
  ) => {
    const story = parse(source);
    return applyChanges(source, make(story, speeches(story)[0] as Speech));
  };

  it("gives back a voice without the direction its group gives anyway", () => {
    expect(
      edit("::: whispering\nThe fox froze. @[gasps]\n:::", (story, first) =>
        setDirection(story, first, "softly"),
      ),
    ).toBe("::: whispering\n@(softly) The fox froze. @Narrator [gasps]\n:::");
    expect(
      edit("::: @Ann reading\nThe fox froze. @[gasps]\n:::", (story, first) =>
        setSpeaker(story, first, "Zed"),
      ),
    ).toBe("::: @Ann reading\n@Zed (reading) The fox froze. @Ann [gasps]\n:::");
  });

  it("puts no sound where nothing is read aloud", () => {
    expect(insertSound(parse("{book only} First published 1902."), 18, "thunder")).toEqual([]);
    expect(insertSound(parse("## The Cave {hidden}"), 6, "thunder")).toEqual([]);
    expect(insertSound(parse("Hello there."), 5, "thunder")).toHaveLength(1);
  });
});

describe("review, round eight", () => {
  it("renames the narrator however the front matter writes the name", () => {
    for (const written of [
      "narrator: >-\n  Watson",
      'narrator: "Wat\\u0073on"',
      "narrator: Watson",
    ]) {
      const source = `---\n${written}\ncast:\n  Watson: Dr Watson\n---\nI arrived. @Watson “Hello.”`;
      const text = applyChanges(source, renameCharacter(parse(source), "Watson", "John"));
      expect(text, written).toContain("narrator: John\ncast:\n  John: Dr Watson");
      expect(spokenScript(parse(text))).toBe("John: I arrived.\nJohn: Hello.");
    }
  });

  it("throws for a book detail it can't set, rather than leave it out", () => {
    const story = parse("---\ntitle:\n  - a list\n---\nHello.");
    story.meta.title = "A Title";
    expect(() => write(story)).toThrow(RangeError);
  });

  it("writes a sound, note or direction with `&` as given, not as a character reference", () => {
    const sound = (description: string) => {
      const text = applyChanges(
        "The door shut.",
        insertSound(parse("The door shut."), 14, description),
      );
      return { text, read: spokenScript(parse(text)) };
    };
    expect(sound("bells &amp; whistles")).toEqual({
      text: "The door shut. [bells \\&amp; whistles]",
      read: "Narrator: The door shut.\n[bells &amp; whistles]",
    });
    expect(sound("rock & roll").text).toBe("The door shut. [rock & roll]");
    const story = parse("Hi [bang] there %% note %%");
    for (const item of story.blocks
      .flatMap((block) => (block.kind === "paragraph" ? block.lines : []))
      .flatMap((line) => line.items)) {
      if (item.kind === "sound") item.description = "x &amp; y";
      if (item.kind === "note") item.text = "a &lt; b";
    }
    expect(write(story)).toBe("Hi [x \\&amp; y] there %% a \\&lt; b %%");
  });
});
