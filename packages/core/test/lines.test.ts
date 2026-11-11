import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bookText,
  fromFountain,
  lines,
  linesToCsv,
  parse,
  spokenScript,
  textByCharacter,
} from "../src/index";
import { lexedTokens } from "../src/lexed";
import { root } from "./examples";

const peter = parse(readFileSync(join(root, "examples", "peter-rabbit.vxd"), "utf8"));

describe("lines", () => {
  it("lists what is heard with speaker, direction, scene and page", () => {
    const story = parse(
      [
        "@(warmly) Once upon a time.",
        "## The cave",
        "@Gerald (yawning) “Hi.” [bell] {page 12}",
        "@Gerald [snores] {pause 2s} %% softly %%",
        "---",
        "{book only} Printed only.",
        "",
        "{page}",
        "The end. {recorder:take 3}",
      ].join("\n"),
    );
    expect(
      lines(story).map(({ kind, speaker, direction, text, name, scene, sceneTitle, page }) => [
        kind,
        speaker,
        direction,
        text,
        name,
        scene,
        sceneTitle,
        page,
      ]),
    ).toEqual([
      ["speech", "Narrator", "warmly", "Once upon a time.", null, 1, null, "1"],
      ["speech", "Narrator", null, "The cave", null, 2, "The cave", "1"],
      ["speech", "Gerald", "yawning", "Hi.", null, 2, "The cave", "1"],
      ["sound", null, null, "bell", null, 2, "The cave", "1"],
      ["page", null, null, "12", "page", 2, "The cave", "12"],
      ["vocal", "Gerald", null, "snores", null, 2, "The cave", "12"],
      ["pause", null, null, "2s", "pause", 2, "The cave", "12"],
      ["note", null, null, "softly", null, 2, "The cave", "12"],
      ["page", null, null, "", "page", 3, null, "13"],
      ["speech", "Narrator", null, "The end.", null, 3, null, "13"],
      ["instruction", null, null, "3", "recorder:take", 3, null, "13"],
    ]);
    expect(lines(story)[2]).toMatchObject({ heading: null, line: 3, column: 19 });
    expect(lines(story)[1]).toMatchObject({ heading: 2 });
  });

  it("starts no scene for notes and page turns alone", () => {
    const story = parse("%% A note. %%\n\n{page}\n\n# Title\n\nOnce.\n\n## Two\n\nTwice.");
    expect(lines(story, { speechOnly: true }).map((line) => [line.text, line.scene])).toEqual([
      ["Title", 1],
      ["Once.", 1],
      ["Two", 2],
      ["Twice.", 2],
    ]);
    expect(lines(peter, { speechOnly: true })[0]?.scene).toBe(1);
  });

  it("can list only what is said", () => {
    const kinds = new Set(lines(peter, { speechOnly: true }).map((line) => line.kind));
    expect([...kinds].sort()).toEqual(["speech", "vocal"]);
  });

  it("counts Peter Rabbit's pages and speakers", () => {
    const all = lines(peter);
    const speakers = new Set(
      all.filter((line) => line.kind === "speech").map((line) => line.speaker),
    );
    expect([...speakers].sort()).toEqual(["McGregor", "Mother", "Narrator", "Peter"]);
    expect(all.filter((line) => line.kind === "page").length).toBeGreaterThan(10);
  });

  it("writes CSV with quoting where a cell needs it", () => {
    const csv = linesToCsv(lines(parse('@Gerald (dry, very) “He said "no", twice.”')));
    expect(csv).toBe(
      'kind,speaker,direction,text,scene,page\r\nspeech,Gerald,"dry, very","He said ""no"", twice.",1,1\r\n',
    );
  });

  it("gives each character's lines as plain text, in cast order", () => {
    const sides = textByCharacter(peter);
    expect([...sides.keys()]).toEqual(["Narrator", "Peter", "Mother", "McGregor"]);
    expect(sides.get("Mother")?.split("\n")[0]).toMatch(/^\(.*\) Now my dears,|^Now my dears,/);
  });
});

describe("what review found", () => {
  it("opens a straight ' quote only before a closing one on its line (§5.5)", () => {
    expect(spokenScript(parse(`@Gerald "Hi," he said ' and left.`))).toBe(
      "Gerald: Hi,\nNarrator: he said ' and left.",
    );
    expect(spokenScript(parse("@Gerald 'Hi,' he said, 'and bye.'"))).toBe(
      "Gerald: Hi,\nNarrator: he said,\nGerald: and bye.",
    );
  });

  it("takes a name written in another Unicode form for the same name, without a warning", () => {
    const story = parse("---\ncast:\n  Zoë: Zoë the Cat\n---\n@Zoe\u0308 “Hi.”");
    expect(story.warnings).toEqual([]);
    expect(spokenScript(story)).toBe("Zoë: Hi.");
  });
});

describe("the spec's other quotation marks (§5.5) and scripts written without spaces (§5.2)", () => {
  it("closes Swedish »…» and Danish »…«, and German ‚…‘ or ‚…’", () => {
    expect(spokenScript(parse("@Anna »Hej,» sa Anna."))).toBe("Anna: Hej,\nNarrator: sa Anna.");
    expect(spokenScript(parse("@Anna »Hej,« sagde Anna."))).toBe(
      "Anna: Hej,\nNarrator: sagde Anna.",
    );
    for (const close of ["‘", "’"]) {
      expect(spokenScript(parse(`@Anna ‚nein${close}, sagte sie.`))).toBe(
        "Anna: nein\nNarrator: , sagte sie.",
      );
    }
  });

  it("reads a mark straight after Thai, as after Chinese or Japanese", () => {
    expect(spokenScript(parse("สมชาย@Somchai “สวัสดี”"))).toBe("Narrator: สมชาย\nSomchai: สวัสดี");
    expect(spokenScript(parse("花子は@Hanako「はい」"))).toBe("Narrator: 花子は\nHanako: はい");
  });
});

describe("links, as Markdown reads them (§8.3)", () => {
  it("runs a link's text to the bracket that balances it", () => {
    const story = parse("[a [fine] story](https://example.com) and on.");
    expect(spokenScript(story)).toBe("Narrator: a [fine] story and on.");
    expect(story.warnings).toEqual([]);
  });

  it("reads an image's address without its title or angle brackets", () => {
    const image = (text: string) =>
      parse(text)
        .blocks.flatMap((block) => (block.kind === "paragraph" ? block.lines : []))
        .flatMap((line) => line.items)
        .find((item) => item.kind === "image");
    expect(image('![a [b] c](pic.png "A title")')).toMatchObject({
      alt: "a [b] c",
      src: "pic.png",
    });
    expect(image("![x](<my pic.png>)")).toMatchObject({ src: "my pic.png" });
    // An address with a title is an address: no warning that a sound reads as a link.
    expect(parse('[story](https://example.com "A story")').warnings).toEqual([]);
  });

  it("makes the innermost of links inside links the link, the rest text, as Markdown does", () => {
    // CommonMark: a link may not hold a link, so the inner one is the link.
    expect(spokenScript(parse("[a [b](x) c](y)"))).toBe("Narrator: [a b c](y)");
    expect(spokenScript(parse("[[b](x)](y)"))).toBe("Narrator: [b](y)");
    expect(spokenScript(parse("[a](x) [b](y)"))).toBe("Narrator: a b");
  });

  it("reads a link's address and title as Markdown does, lone parentheses and all", () => {
    // Each as CommonMark reads it (checked with markdown-it): a title may hold a lone `(` or `)`,
    // an address in `<…>` a `)`, and an escape counts. Where Markdown sees no link, neither does
    // the parser: a sound, then text.
    const said = (text: string) => spokenScript(parse(text));
    for (const link of [
      '[the chapter](book.html "Chapter (one")',
      "[the chapter](<https://example.com/a)b>)",
      '[the chapter](b "t)")',
      "[the chapter](b 't)')",
      "[the chapter](b (t))",
      "[the chapter](<b c>)",
      "[the chapter]( b )",
      "[the chapter](<>)",
      "[the chapter](b(c)d)",
      "[the chapter](b\\)c)",
      "[the chapter](<b\\>c>)",
      '[the chapter](b "t" )',
      '[the chapter]("t")',
    ]) {
      expect(said(`Read ${link} now.`), link).toBe("Narrator: Read the chapter now.");
    }
    for (const text of ["(b (t()", '(<b>"t")', "(b(c d)", "(<b<c>)", '(b "t" x)']) {
      expect(said(`Read [a]${text} now.`), text).toBe(
        `Narrator: Read\n[a]\nNarrator: ${text} now.`,
      );
    }
    const image = parse('See ![pic](<a b\\>.png> "A (big") here.')
      .blocks.flatMap((block) => (block.kind === "paragraph" ? block.lines : []))
      .flatMap((line) => line.items)
      .find((item) => item.kind === "image");
    expect(image).toMatchObject({ alt: "pic", src: "a b>.png" });
  });

  it("reads a link on one line: one that runs onto the next is a sound and text, and warned of", () => {
    const story = parse('See [the map](maps.png\n"A map").');
    expect(spokenScript(story)).toBe(
      'Narrator: See\n[the map]\nNarrator: (maps.png\nNarrator: "A map").',
    );
    expect(story.warnings.map((warning) => warning.code)).toContain("sound-looks-like-link");
    expect(story.warnings[0]?.message).toMatch(/doesn't close on its line/);
  });

  it("opens a link at the `[` nearest its `]`: a `[` left open before it is text", () => {
    const story = parse("Read [[the map](maps.png) now.");
    expect(spokenScript(story)).toBe("Narrator: Read [the map now.");
    const tokens = lexedTokens(story.source).filter(
      (token) => token.type === "text" && !token.plain,
    );
    expect(tokens.map((token) => story.source.slice(token.range.from, token.range.to))).toEqual([
      "[the map](maps.png)",
    ]);
  });

  it("reads an image that is a link's text as an image, with its link (§8.3)", () => {
    const story = parse("See [![A map](map.png)](map-large.png) here.");
    const image = story.blocks
      .flatMap((block) => (block.kind === "paragraph" ? block.lines : []))
      .flatMap((line) => line.items)
      .find((item) => item.kind === "image");
    expect(image).toMatchObject({ alt: "A map", src: "map.png", link: "map-large.png" });
    expect(spokenScript(story)).toBe(
      "Narrator: See\n[![A map](map.png)](map-large.png)\nNarrator: here.",
    );
    // An image with words beside it in a link's text: the words are heard, the image isn't.
    expect(spokenScript(parse("[![a](i.png) and more](y)"))).toBe("Narrator: and more");
    // A link in an image's description is its words.
    expect(spokenScript(parse("![a [b](x)](y.png)"))).toBe("![a b](y.png)");
  });

  it("reads a character reference as its character, never as a mark (§11)", () => {
    expect(spokenScript(parse("Tom &amp; Jerry said &quot;hello&quot;."))).toBe(
      'Narrator: Tom & Jerry said "hello".',
    );
    expect(spokenScript(parse("@Tom “It&#8217;s mine &#x26; yours.”"))).toBe(
      "Tom: It’s mine & yours.",
    );
    // An escaped `&`, an unknown name and a missing `;` are text as written.
    expect(spokenScript(parse("A \\&amp; B, &nosuch; and &amp"))).toBe(
      "Narrator: A &amp; B, &nosuch; and &amp",
    );
    expect(bookText(parse("[Tom &quot;Cat&quot;](c.html?x=1&amp;y=2)"))).toBe(
      '[Tom "Cat"](c.html?x=1&y=2)',
    );
  });

  it("reads brackets nested deep, and lines of many links, in linear time", () => {
    for (const text of [
      `${"[".repeat(150_000)}x${"]".repeat(150_000)}(y)`,
      "[a](".repeat(40_000),
      "[x](y) ".repeat(25_000),
    ]) {
      const start = performance.now();
      const story = parse(text);
      spokenScript(story);
      lines(story);
      expect(performance.now() - start, text.slice(0, 6)).toBeLessThan(2000);
    }
  });
});

describe("the Fountain import", () => {
  const screenplay = [
    "Title: The Dragon Who Wouldn't Roar",
    "Author: A. Writer",
    "",
    "INT. CAVE - NIGHT",
    "",
    "A dragon snores. [[Loud enough to shake the walls.]]",
    "",
    "SIR PERCIVAL",
    "(nervous)",
    'Hello? Is anyone "home"?',
    "(louder)",
    "HELLO?",
    "",
    "GERALD (V.O.)",
    "Could you not?",
    "",
    "SIR PERCIVAL (CONT'D)",
    "Sorry.",
    "",
    "CUT TO:",
    "",
    "===",
    "",
    "EXT. CAVE - DAY",
    "",
    "The end. Write to me@example.com, or {here}.",
    "",
  ].join("\n");

  it("turns cues into marks, parentheticals into directions and headings into labels", () => {
    const vxd = fromFountain(screenplay);
    expect(vxd).toBe(
      [
        "---",
        "voxdown: 1.0",
        "title: The Dragon Who Wouldn't Roar",
        "author: A. Writer",
        "cast:",
        "  SirPercival: Sir Percival",
        "  Gerald:",
        "---",
        "",
        "## INT. CAVE - NIGHT {hidden}",
        "",
        "A dragon snores. %% Loud enough to shake the walls. %%",
        "",
        '@SirPercival (nervous) “Hello? Is anyone \\"home\\"? @(louder) HELLO?”',
        "",
        "@Gerald (V.O.) “Could you not?”",
        "",
        "@SirPercival “Sorry.”",
        "",
        "%% CUT TO: %%",
        "",
        "{page}",
        "",
        "## EXT. CAVE - DAY {hidden}",
        "",
        "The end. Write to me@example.com, or \\{here\\}.",
        "",
      ].join("\n"),
    );
    const story = parse(vxd);
    expect(story.warnings).toEqual([]);
    expect(spokenScript(story)).toContain(
      'SirPercival (nervous): Hello? Is anyone "home"?\nSirPercival (louder): HELLO?',
    );
  });

  it("writes a cue in capitals as a name: an apostrophe takes a capital only after one letter", () => {
    const vxd = fromFountain("INT. HOUSE - DAY\n\nBOB'S MOTHER\nHello.\n\nO'BRIEN\nHi.\n");
    expect(vxd).toContain("Bob'sMother: Bob's Mother");
    expect(vxd).toContain("@Bob'sMother “Hello.”");
    expect(vxd).toContain("@O'Brien “Hi.”");
  });
});
