import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fromFountain,
  lines,
  linesToCsv,
  parse,
  spokenScript,
  textByCharacter,
} from "../src/index";
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
});
