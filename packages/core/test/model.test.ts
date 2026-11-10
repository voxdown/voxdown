import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type Item,
  type Speech,
  type Story,
  type WarningCode,
  parse,
  spokenScript,
  tokens,
} from "../src/index";
import { root } from "./examples";

const peterSource = readFileSync(join(root, "examples", "peter-rabbit.vxd"), "utf8");

function items(story: Story): Item[] {
  return story.blocks.flatMap((block) => {
    if (block.kind === "paragraph") return block.lines.flatMap((line) => line.items);
    return block.kind === "heading" ? block.line.items : [];
  });
}

function speeches(story: Story): Speech[] {
  return items(story).filter((item): item is Speech => item.kind === "speech");
}

const slice = (story: Story, range: { from: number; to: number }) =>
  story.source.slice(range.from, range.to);

const codes = (source: string): WarningCode[] => parse(source).warnings.map((w) => w.code);

describe("Peter Rabbit", () => {
  const story = parse(peterSource);

  it("parses without warnings", () => {
    expect(story.warnings).toEqual([]);
  });

  it("reads its front matter, details and cast", () => {
    expect(story.frontMatter?.raw.startsWith("audiobook-markup: 0.1\ntitle:")).toBe(true);
    expect(slice(story, story.frontMatter?.range ?? { from: 0, to: 0 })).toMatch(
      /^---\n[\s\S]*\n---$/,
    );
    expect(story.meta).toEqual({
      title: "The Tale of Peter Rabbit",
      author: "Beatrix Potter",
      language: "en-GB",
      version: "0.1",
      narrator: "Narrator",
    });
    expect(story.cast.map((member) => [member.handle, member.name])).toEqual([
      ["Narrator", "Narrator"],
      ["Peter", "Peter Rabbit"],
      ["Mother", "Mrs. Rabbit"],
      ["McGregor", "Mr. McGregor"],
    ]);
    expect(story.cast[2]?.about).toBe("Peter’s mother. Kind, brisk, and firm about gardens.");
  });

  it("points every speech's text range at its words", () => {
    const all = speeches(story);
    expect(all.length).toBeGreaterThan(50);
    for (const speech of all) {
      expect(slice(story, speech.textRange).replace(/\s+/g, " ")).toBe(speech.text);
      expect(speech.range.from).toBeLessThanOrEqual(speech.textRange.from);
      expect(speech.range.to).toBeGreaterThanOrEqual(speech.textRange.to);
    }
  });

  it("points marks, quotes, directions and sounds at their source", () => {
    for (const item of items(story)) {
      if (item.kind === "mark") {
        expect(slice(story, item.range).startsWith(`@${slice(story, item.nameRange)}`)).toBe(true);
        expect(slice(story, item.nameRange)).toBe(item.speaker);
        if (item.directionRange)
          expect(slice(story, item.directionRange)).toBe(`(${item.direction})`);
      }
      if (item.kind === "speech" && item.openQuote) expect(slice(story, item.openQuote)).toBe("‘");
      if (item.kind === "speech" && item.closeQuote)
        expect(slice(story, item.closeQuote)).toBe("’");
      if (item.kind === "sound") expect(slice(story, item.range)).toBe(`[${item.description}]`);
      if (item.kind === "direction") expect(slice(story, item.range)).toBe(`@(${item.direction})`);
    }
  });

  it("gives the group's direction to the narration inside it", () => {
    const group = story.groups.find((g) => g.direction === "hushed, holding still");
    expect(group?.closeRange).not.toBeNull();
    const sneeze = speeches(story).find((speech) => speech.text === "Kertyschoo!");
    expect(sneeze).toMatchObject({ speaker: "Peter", direction: "a real sneeze", quoted: true });
    expect(sneeze?.mark?.speaker).toBe("Peter");
  });
});

describe("the model", () => {
  it("uses UTF-16 offsets", () => {
    const story = parse("🐉 @Gerald “Hi”");
    const speech = speeches(story).find((s) => s.speaker === "Gerald");
    expect(speech?.textRange).toEqual({ from: 12, to: 14 });
    expect(slice(story, speech?.textRange ?? { from: 0, to: 0 })).toBe("Hi");
  });

  it("keeps ranges across CRLF line endings", () => {
    const story = parse("Line one\r\n@Gerald “Line two”\r\n");
    const speech = speeches(story).find((s) => s.speaker === "Gerald");
    expect(slice(story, speech?.textRange ?? { from: 0, to: 0 })).toBe("Line two");
    expect(spokenScript(story)).toBe("Narrator: Line one\nGerald: Line two");
  });

  it("marks carried-on speeches, which have no mark of their own", () => {
    const story = parse("@Baker “Just a little flame,” said the baker. “Gently.”");
    const [first, , last] = speeches(story);
    expect(first).toMatchObject({ speaker: "Baker", continued: false, quoted: true });
    expect(first?.mark).toBeDefined();
    expect(last).toMatchObject({ speaker: "Baker", continued: true, quoted: true });
    expect(last?.mark).toBeUndefined();
  });

  it("separates a speech's own direction from its effective one", () => {
    const story = parse("::: whispering\n@Gerald “Hello.” @(loud) Then @() quiet.\n:::");
    expect(
      speeches(story).map((s) => [s.speaker, s.ownDirection, s.direction, s.directionMark?.kind]),
    ).toEqual([
      ["Gerald", null, "whispering", undefined],
      ["Narrator", "loud", "loud", "direction"],
      ["Narrator", null, "whispering", "direction"],
    ]);
  });

  it("records groups with their character, direction and lines", () => {
    const story = parse("::: @Wanda (reading the letter) {book only}\nDear Management,\n:::");
    const [group] = story.groups;
    expect(group).toMatchObject({
      character: "Wanda",
      direction: "reading the letter",
      visibility: "book",
    });
    expect(slice(story, group?.directionRange ?? { from: 0, to: 0 })).toBe("(reading the letter)");
    expect(slice(story, group?.closeRange ?? { from: 0, to: 0 })).toBe(":::");
    const paragraph = story.blocks[0];
    expect(paragraph?.kind === "paragraph" && paragraph.groups[0]).toBe(group);
  });

  it("joins the lines a note runs over into one line", () => {
    const story = parse("Before %% a note\n\nover a blank line %% after.\nNext line.");
    const paragraph = story.blocks[0];
    expect(paragraph?.kind === "paragraph" && paragraph.lines.length).toBe(2);
    expect(spokenScript(story)).toBe(
      "Narrator: Before\n%% a note over a blank line %%\nNarrator: after.\nNarrator: Next line.",
    );
  });
});

describe("warnings (§12.3)", () => {
  it("reports where each warning is", () => {
    const [warning] = parse("Fine.\n  @Gerald “Oh no").warnings;
    expect(warning).toMatchObject({ code: "unclosed-quote", line: 2, column: 11 });
  });

  it("reports a quote that is never closed, but not one carried into the next paragraph", () => {
    expect(codes("@Gerald “Oh no, I’m going to")).toEqual(["unclosed-quote"]);
    expect(codes("@Gerald “Once upon a time.\n\n{page}\n\n“The end.”")).toEqual([]);
    expect(codes("@Gerald “Once upon a time.\n\nThe end.")).toEqual(["unclosed-quote"]);
  });

  it("reports a quote that runs over a line break", () => {
    expect(codes("@Gerald “Twinkle,\nlittle star.”")).toEqual(["quote-over-line-break"]);
  });

  it("reports a group that is never closed, and colons with no group open", () => {
    expect(codes("::: whispering\nText.")).toEqual(["unclosed-group"]);
    expect(codes("Text.\n:::")).toEqual(["stray-group-close"]);
  });

  it("reports a mark that gives its character nothing to say or do", () => {
    expect(codes("“Could you not?” said @Gerald.")).toEqual(["idle-mark"]);
    expect(codes("@Gerald @Percival “Sorry.”")).toEqual(["idle-mark"]);
    expect(codes("@Gerald [snores]")).toEqual([]);
  });

  it("reports a quotation mark with nothing after it on its line", () => {
    expect(codes('@Clown "Just you wait!" he smirked."')).toEqual(["stray-quote"]);
    expect(codes("The rabbits'")).toEqual([]);
  });

  it("reports names missing from the cast, mixed capitals and silent cast members", () => {
    const source =
      "---\ncast:\n  Clown: The Clown\n  Broom:\n---\n@Clown “Honk!” @clown “Hm.” @Bob “Hi.”";
    const story = parse(source);
    expect(story.warnings.map((w) => [w.code, w.severity])).toEqual([
      ["silent-cast-member", "info"],
      ["name-case", "warning"],
      ["unknown-character", "warning"],
    ]);
    expect(slice(story, story.warnings[0]?.range ?? { from: 0, to: 0 })).toBe("Broom");
    expect(codes("@Clown “Honk!” @Bob “Hi.”")).toEqual([]);
    expect(codes("---\ncast:\n  Clown:\n---\n@Narrator Hello. @Clown “Honk!”")).toEqual([]);
  });

  it("reports unknown instructions and pauses that are not lengths", () => {
    expect(codes("{chapter 2} {kinu:take 3} {page 4} {pause 2s} {pause 500ms}")).toEqual([
      "unknown-instruction",
    ]);
    expect(codes("{pause long}")).toEqual(["pause-value"]);
  });

  it("reports a sound followed directly by a parenthesis", () => {
    expect(codes("The door [slams](loudly) shut.")).toEqual(["sound-looks-like-link"]);
    expect(codes("Read more at [our website](https://example.com).")).toEqual([]);
  });

  it("reports front matter it cannot read, and still parses the story", () => {
    const story = parse("---\ntitle: Fine\nmap: {a: 1}\n---\nOnce.");
    expect(story.warnings.map((w) => w.code)).toEqual(["front-matter"]);
    expect(story.meta.title).toBe("Fine");
    expect(spokenScript(story)).toBe("Narrator: Once.");
  });
});

describe("tokens", () => {
  it("lists syntax ranges in order, with speakers", () => {
    const source =
      "## Scene\n@Gerald (yawning) “Hi \\@you.” [door] {page} %% note %% @[sighs]\n---";
    const story = parse(source);
    const found = tokens(story).map((token) => [
      token.kind,
      slice(story, token.range),
      token.speaker,
    ]);
    expect(found).toEqual([
      ["heading", "##", undefined],
      ["mark", "@", "Gerald"],
      ["name", "Gerald", "Gerald"],
      ["direction", "(yawning)", "Gerald"],
      ["quote", "“", "Gerald"],
      ["escape", "\\@", undefined],
      ["quote", "”", "Gerald"],
      ["sound", "[door]", undefined],
      ["instruction", "{page}", undefined],
      ["note", "%% note %%", undefined],
      ["mark", "@", "Narrator"],
      ["vocal", "[sighs]", "Narrator"],
      ["break", "---", undefined],
    ]);
  });

  it("includes front matter and group lines", () => {
    const story = parse("---\ntitle: x\n---\n::: @Wanda softly\nHi.\n:::");
    const kinds = tokens(story).map((token) => [token.kind, slice(story, token.range)]);
    expect(kinds).toEqual([
      ["frontmatter", "---\ntitle: x\n---"],
      ["group", ":::"],
      ["mark", "@"],
      ["name", "Wanda"],
      ["direction", "softly"],
      ["group", ":::"],
    ]);
  });
});
