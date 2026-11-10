import { describe, expect, it } from "vitest";
import { parse, spokenScript } from "../src/index";
import { readYaml } from "../src/yaml";

const read = (lines: string[]) => readYaml(lines.join("\n"));
const data = (lines: string[]) => read(lines).data;

describe("the front matter YAML subset", () => {
  it("reads keys and values, with empty values as null", () => {
    expect(
      data(["title: The Tale of Peter Rabbit", "author: Beatrix Potter", "narrator:"]),
    ).toEqual({
      title: "The Tale of Peter Rabbit",
      author: "Beatrix Potter",
      narrator: null,
    });
  });

  it("nests maps by indentation and keeps their order", () => {
    const result = data([
      "cast:",
      "  Narrator:",
      "  Peter: Peter Rabbit",
      "  Mother:",
      "    name: Mrs. Rabbit",
      "    about: Peter’s mother.",
      "language: en-GB",
    ]);
    expect(result).toEqual({
      cast: {
        Narrator: null,
        Peter: "Peter Rabbit",
        Mother: { name: "Mrs. Rabbit", about: "Peter’s mother." },
      },
      language: "en-GB",
    });
    expect(Object.keys(result.cast as object)).toEqual(["Narrator", "Peter", "Mother"]);
  });

  it("reads plain, single-quoted and double-quoted scalars", () => {
    expect(
      data([
        "plain: It's a plain: value",
        "single: 'Don''t # stop'",
        'double: "Tab\\there \\"quoted\\" \\u00e9"',
        "'quoted key': yes",
      ]),
    ).toEqual({
      plain: "It's a plain: value",
      single: "Don't # stop",
      double: 'Tab\there "quoted" é',
      "quoted key": "yes",
    });
  });

  it("follows the core schema for plain scalars only", () => {
    expect(
      data(["a: 0.1", "b: 12", "c: true", "d: ~", "e: null", "f: 007", "g: '0.1'", "h: 1.2.3"]),
    ).toEqual({ a: 0.1, b: 12, c: true, d: null, e: null, f: "007", g: "0.1", h: "1.2.3" });
  });

  it("continues plain and quoted scalars on more indented lines", () => {
    expect(
      data([
        "about: Kind, brisk,",
        "  and firm about gardens.",
        'quote: "one',
        '  two"',
        "next: x",
      ]),
    ).toEqual({ about: "Kind, brisk, and firm about gardens.", quote: "one two", next: "x" });
  });

  it("reads literal and folded block scalars with their chomping", () => {
    const result = data([
      "literal: |",
      "  line one",
      "    indented",
      "  line three",
      "",
      "strip: |-",
      "  no newline",
      "folded: >",
      "  folded",
      "  together",
      "",
      "  new paragraph",
      "folded_strip: >-",
      "  a",
      "  b",
      "keep: |+",
      "  kept",
      "",
      "after: done",
    ]);
    expect(result).toEqual({
      literal: "line one\n  indented\nline three\n",
      strip: "no newline",
      folded: "folded together\nnew paragraph\n",
      folded_strip: "a b",
      keep: "kept\n\n",
      after: "done",
    });
  });

  it("keeps comment-like lines inside block scalars", () => {
    expect(data(["note: |", "  # not a comment", "  text"])).toEqual({
      note: "# not a comment\ntext\n",
    });
  });

  it("reads block lists, including lists of maps and lists under a key at its indentation", () => {
    expect(
      data([
        "tags:",
        "  - one",
        "  - 'two'",
        "takes:",
        "- line: 3",
        "  take: 2",
        "- line: 4",
        "nested:",
        "  -",
        "    - deep",
      ]),
    ).toEqual({
      tags: ["one", "two"],
      takes: [{ line: 3, take: 2 }, { line: 4 }],
      nested: [["deep"]],
    });
  });

  it("reads flow lists of scalars", () => {
    expect(data(["a: [one, two three, 'four, five', 6]", "b: []", "c: [x,]"])).toEqual({
      a: ["one", "two three", "four, five", 6],
      b: [],
      c: ["x"],
    });
  });

  it("ignores comments", () => {
    expect(
      data(["# A comment", "title: Peter # trailing comment", "  # indented comment", "url: a#b"]),
    ).toEqual({ title: "Peter", url: "a#b" });
  });

  it("records where each key was written", () => {
    const text = "cast:\n  Peter: Peter Rabbit\n";
    const { keys } = readYaml(text, 100);
    expect(keys.map((key) => key.path)).toEqual([["cast"], ["cast", "Peter"]]);
    const peter = keys[1]?.range ?? { from: 0, to: 0 };
    expect(text.slice(peter.from - 100, peter.to - 100)).toBe("Peter");
  });

  it("never touches the object prototype", () => {
    const result = data(["__proto__: polluted", "constructor: fine"]);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.keys(result)).toEqual(["__proto__", "constructor"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("reports what it can't read instead of failing", () => {
    const result = read([
      "title: ok",
      "map: {a: 1}",
      "alias: *anchor",
      "list: [a, [b]]",
      "open: [a, b",
      'unclosed: "never',
      "no colon here",
      "\ttabbed: x",
      "title: again",
      "  too: deep",
    ]);
    expect(result.data).toMatchObject({
      title: "again",
      map: "{a: 1}",
      alias: "*anchor",
      list: "[a, [b]]",
      open: "[a, b",
    });
    expect(result.problems.length).toBeGreaterThanOrEqual(8);
    for (const problem of result.problems) {
      expect(problem.range.to).toBeGreaterThanOrEqual(problem.range.from);
    }
  });

  it("reports a top-level list", () => {
    const result = read(["- a", "- b"]);
    expect(result.data).toEqual({});
    expect(result.problems).toHaveLength(1);
  });

  it("handles CRLF line endings and empty input", () => {
    expect(readYaml("a: 1\r\nb: two\r\n").data).toEqual({ a: 1, b: "two" });
    expect(readYaml("").data).toEqual({});
  });

  it("never exhausts the stack: nesting past 32 levels is reported and skipped", () => {
    const deep = `k:\n  ${"- ".repeat(5000)}x\nafter: true`;
    const result = readYaml(deep);
    expect(result.problems.map((problem) => problem.message)).toContain(
      "The front matter is nested too deeply here.",
    );
    expect(result.data.after).toBe(true);
    const story = parse(`---\n${deep}\n---\nHello.`);
    expect(spokenScript(story)).toBe("Narrator: Hello.");
  });

  it("says where each value is written, to its last line and before a comment", () => {
    const text = 'title: "Chapter #1" # keep\nblock: |\n  First\n\n  Second\nnext: 1';
    const keys = readYaml(text).keys;
    const value = (key: string) => {
      const found = keys.find((entry) => entry.path[0] === key)?.value;
      return found && text.slice(found.text.from, found.text.to);
    };
    expect(value("title")).toBe('"Chapter #1"');
    expect(value("block")).toBe("|\n  First\n\n  Second");
    expect(value("next")).toBe("1");
  });

  it("keeps an escape that is no character as written, with a problem, instead of failing", () => {
    const result = readYaml('title: "a \\UFFFFFFFF b"');
    expect(result.data.title).toBe("a \\UFFFFFFFF b");
    expect(result.problems.map((problem) => problem.message)).toContain(
      "This escape is not a character, so it is kept as written.",
    );
    expect(spokenScript(parse('---\ntitle: "\\UFFFFFFFF"\n---\nHello.'))).toBe("Narrator: Hello.");
  });

  it("reads a # inside a quoted list item, and a plain value past an empty line", () => {
    expect(readYaml('tags: ["a # b", c] # x').data.tags).toEqual(["a # b", "c"]);
    expect(readYaml("title: first\n\n  second\nnext: 1").data).toEqual({
      title: "first\nsecond",
      next: 1,
    });
  });

  it("reads a long quoted value over many lines in linear time", () => {
    const lines = Array.from({ length: 30_000 }, () => "  continuation").join("\n");
    const start = performance.now();
    const title = readYaml(`title: "start\n${lines}\n  end"`).data.title as string;
    expect(performance.now() - start).toBeLessThan(1000);
    expect(title.startsWith("start continuation")).toBe(true);
  });

  it("opens a quote in a list only at an item's start, and joins an escaped line break", () => {
    expect(readYaml("tags: [don't, can't, stop]").data.tags).toEqual(["don't", "can't", "stop"]);
    expect(readYaml('title: "The long\\\n  story"').data.title).toBe("The longstory");
    expect(readYaml('title: "two\n  lines"').data.title).toBe("two lines");
  });

  it("reads a value that starts on the line after its key", () => {
    expect(readYaml("narrator:\n  Watson").data).toEqual({ narrator: "Watson" });
    expect(readYaml("title:\n  The Long\n  Night\nnarrator: Ann").data).toEqual({
      title: "The Long Night",
      narrator: "Ann",
    });
    expect(readYaml("cast:\n  Ann:\n    Ann Smith").data).toEqual({ cast: { Ann: "Ann Smith" } });
    expect(readYaml("title:\n  'quoted'").data).toEqual({ title: "quoted" });
    expect(readYaml("title:\n  - a list").data).toEqual({ title: ["a list"] });
  });

  it("ends a plain value at a comment, and reports a line that would carry it on", () => {
    // YAML 1.2 (§7.3.3) has no comment inside a plain scalar: a YAML library refuses these.
    // The value is read up to its comment, and the line after is reported where it stands.
    for (const text of ["title: first # a comment\n  second", "title: first\n  # c\n  second"]) {
      const read = readYaml(text);
      expect(read.data).toEqual({ title: "first" });
      expect(
        read.problems.map((problem) => text.slice(problem.range.from, problem.range.to)),
      ).toEqual(["  second"]);
    }
    expect(readYaml("title: first\n  second # c").data).toEqual({ title: "first second" });
  });

  it("keeps an empty block's line breaks with keep chomping, as YAML does", () => {
    // Each as a YAML library (PyYAML 6) reads it (YAML 1.2, §8.1.1.2). The reader is given the
    // lines between a file's `---` lines, joined: a document's last line break isn't in them.
    const cases: Array<[string, unknown]> = [
      ["title: |+\n\n\n", { title: "\n\n" }],
      ["title: |+\n\n", { title: "\n" }],
      ["title: |+\n", { title: "" }],
      ["title: >+\n\n\n", { title: "\n\n" }],
      ["title: |-\n\n\n", { title: "" }],
      ["title: |\n\n\n", { title: "" }],
      ["title: |+\n\n\nnext: x", { title: "\n\n", next: "x" }],
      ["title: |+\n  a\n\n\n", { title: "a\n\n\n" }],
      ["title: >+\n  a\n  b\n\n", { title: "a b\n\n" }],
      ["a: |+\n\n  \nb: 1", { a: "\n\n", b: 1 }],
    ];
    for (const [document, data] of cases) {
      const lines = document.replace(/\n$/, "");
      expect(readYaml(lines).data, JSON.stringify(document)).toEqual(data);
      const file = parse(`---\n${lines}\n---\nHello.`);
      expect(file.frontMatter?.data, JSON.stringify(document)).toEqual(data);
    }
  });
});
