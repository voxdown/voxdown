import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderBook, renderDocument } from "@voxdown/render";
import { describe, expect, it } from "vitest";
import {
  SPEC_VERSION,
  bookText,
  format,
  fromFountain,
  lines,
  linesToCsv,
  parse,
  spokenScript,
  textByCharacter,
} from "voxdown";
import { VERSION } from "../src/run";
import { peter, root, vxd } from "./memory";

const story = parse(peter);

/** Spaces to tidy, a name to write as the cast spells it, and straight quotes. */
const MESSY = `---
cast:
  Clown: Clown
---
# Title
The  clown   said, @clown "Hello there."



The end.
`;

/** Three warnings and an info. */
const WARNED = `---
cast:
  Bob: Bob
  Sue: Sue
---
@Al “Hi.”
@bob “x
`;

/** Only an info: Sue never speaks. */
const INFO_ONLY = `---
cast:
  Bob: Bob
  Sue: Sue
---
@Bob “Hi.”
`;

const FOUNTAIN = `Title: The Visit
Author: A. Writer

INT. KITCHEN - DAY

Bob enters.

BOB
(quietly)
Hello.

SUE
Hi, Bob.
`;

describe("help and version", () => {
  it("prints the package's version and the spec's", async () => {
    const pkg = JSON.parse(readFileSync(join(root, "packages/cli/package.json"), "utf8"));
    expect(VERSION).toBe(pkg.version);
    for (const flag of ["--version", "-v"]) {
      const result = await vxd([flag]);
      expect(result).toMatchObject({ code: 0, stderr: "" });
      expect(result.stdout).toBe(`vxd ${pkg.version} (VoxDown spec ${SPEC_VERSION})\n`);
    }
  });

  it("lists every command", async () => {
    for (const args of [["--help"], ["-h"], ["help"]]) {
      const result = await vxd(args);
      expect(result.code).toBe(0);
      for (const command of ["check", "fmt", "render", "export", "text", "import"]) {
        expect(result.stdout).toContain(`\n  ${command} <file`);
      }
      expect(result.stdout).toContain("Exit codes: 0 done, 1 problems found, 2");
    }
  });

  it("shows the help on stderr, as a usage error, when no command is given", async () => {
    const result = await vxd([]);
    expect(result).toMatchObject({ code: 2, stdout: "" });
    expect(result.stderr).toContain("Usage: vxd <command>");
  });

  it.each([
    ["check", ["--json", "--strict"]],
    ["fmt", ["--check", "--stdout", "--quotes", "--language", "--no-names"]],
    ["render", ["--view", "--out", "--fragment", "--pages", "--no-header"]],
    ["export", ["--format", "--speech-only", "--out"]],
    ["text", ["--book", "--spoken", "--out"]],
    ["import", ["--out", "--read-scene-headings"]],
  ])("explains %s and each of its options", async (command, options) => {
    const asked = await vxd([command, "--help"]);
    expect(asked).toMatchObject({ code: 0, stderr: "" });
    expect(asked.stdout.startsWith(`Usage: vxd ${command} `)).toBe(true);
    for (const option of options) {
      expect(asked.stdout).toMatch(new RegExp(`^  (?:-\\w, )?${option}\\b`, "m"));
    }
    expect((await vxd(["help", command])).stdout).toBe(asked.stdout);
    expect((await vxd([command, "-h"])).stdout).toBe(asked.stdout);
    // Help wins over any mistake beside it.
    expect(await vxd([command, "a.vxd", "--bogus", "--help"])).toMatchObject({
      code: 0,
      stdout: asked.stdout,
    });
  });
});

describe("usage errors", () => {
  it.each([
    [["bogus"], 'vxd: unknown command "bogus" (see vxd --help)'],
    [["--bogus"], "vxd: unknown option --bogus (see vxd --help)"],
    [["help", "bogus"], 'vxd: unknown command "bogus" (see vxd --help)'],
    [["check"], "vxd: check needs at least one file (see vxd check --help)"],
    [["check", "--bogus", "a.vxd"], "vxd: unknown option --bogus for check (see vxd check --help)"],
    [["check", "-x", "a.vxd"], "vxd: unknown option -x for check (see vxd check --help)"],
    [["check", "--json=yes", "a.vxd"], "vxd: --json takes no value (see vxd check --help)"],
    [["check", "-", "-"], "vxd: - (standard input) can be given only once (see vxd check --help)"],
    [["render"], "vxd: render needs a file (see vxd render --help)"],
    [["render", "a.vxd", "b.vxd"], "vxd: render takes one file, not 2 (see vxd render --help)"],
    [["render", "a.vxd", "--out"], "vxd: --out needs a value (see vxd render --help)"],
    [["render", "a.vxd", "--out", "--pages"], "vxd: --out needs a value (see vxd render --help)"],
    [
      ["render", "a.vxd", "--view", "page"],
      'vxd: --view must be script or book, not "page" (see vxd render --help)',
    ],
    [
      ["export", "a.vxd", "--format", "xml"],
      'vxd: --format must be json, csv or text, not "xml" (see vxd export --help)',
    ],
    [
      ["fmt", "a.vxd", "--quotes", "smart"],
      'vxd: --quotes must be curly or keep, not "smart" (see vxd fmt --help)',
    ],
    [
      ["fmt", "--check", "--stdout", "a.vxd"],
      "vxd: --check and --stdout can't be used together (see vxd fmt --help)",
    ],
    [["fmt", "--stdout", "a.vxd", "b.vxd"], "vxd: --stdout takes one file (see vxd fmt --help)"],
    [
      ["fmt", "-", "a.vxd"],
      "vxd: - (standard input) is printed, so it can't be formatted with other files (see vxd fmt --help)",
    ],
    [["text", "a.vxd"], "vxd: text needs --book or --spoken (see vxd text --help)"],
    [
      ["text", "a.vxd", "--book", "--spoken"],
      "vxd: choose one of --book and --spoken (see vxd text --help)",
    ],
    [["import"], "vxd: import needs a file (see vxd import --help)"],
  ])("vxd %j", async (args, message) => {
    const result = await vxd(args, { "a.vxd": MESSY, "b.vxd": MESSY });
    expect(result).toMatchObject({ code: 2, stdout: "", stderr: `${message}\n`, written: [] });
  });
});

describe("files that can't be read or written", () => {
  it("names a missing file in one line", async () => {
    const result = await vxd(["check", "x.vxd"]);
    expect(result).toMatchObject({ code: 2, stdout: "", stderr: "vxd: no such file: x.vxd\n" });
  });

  it("reads every file before it reports or writes anything", async () => {
    const result = await vxd(["fmt", "a.vxd", "missing.vxd"], { "a.vxd": MESSY });
    expect(result).toMatchObject({ code: 2, stdout: "", written: [] });
    expect(result.stderr).toBe("vxd: no such file: missing.vxd\n");
  });

  it("asks for the files in a folder", async () => {
    const result = await vxd(["check", "chapters/"], { "chapters/one.vxd": peter });
    expect(result.code).toBe(2);
    expect(result.stderr).toBe(
      "vxd: chapters/ is a folder: name the files in it, such as chapters/*.vxd\n",
    );
  });

  it("says so when a file isn't UTF-8", async () => {
    const io = {
      readFile: async () => {
        throw Object.assign(new TypeError("bad"), { code: "ERR_ENCODING_INVALID_ENCODED_DATA" });
      },
    };
    const result = await vxd(["check", "latin1.vxd"], {}, { io });
    expect(result).toMatchObject({ code: 2, stderr: "vxd: latin1.vxd is not UTF-8 text\n" });
  });

  it("turns any other failure into one line, without a stack trace", async () => {
    const io = {
      writeFile: async () => {
        throw new Error("disk full");
      },
    };
    const result = await vxd(["render", "a.vxd", "--out", "a.html"], { "a.vxd": peter }, { io });
    expect(result).toMatchObject({ code: 2, stderr: "vxd: can't write a.html: disk full\n" });
  });

  it("reads a file whose name starts with a dash after --", async () => {
    const result = await vxd(["check", "--", "-odd.vxd"], { "-odd.vxd": peter });
    expect(result).toMatchObject({ code: 0, stdout: "No problems in -odd.vxd.\n" });
  });
});

describe("vxd check", () => {
  it("passes Peter Rabbit", async () => {
    const result = await vxd(["check", "peter-rabbit.vxd"], { "peter-rabbit.vxd": peter });
    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(result.stdout).toBe("No problems in peter-rabbit.vxd.\n");
  });

  it("prints every warning as file:line:column  level  code  message, in order", async () => {
    const result = await vxd(["check", "story.vxd"], { "story.vxd": WARNED });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe(
      [
        "story.vxd:4:3  info  silent-cast-member  Sue is in the cast but never speaks.",
        "story.vxd:6:2  warning  unknown-character  “Al” is not in the cast.",
        "story.vxd:7:2  warning  name-case  “bob” is written “Bob” elsewhere.",
        "story.vxd:7:6  warning  unclosed-quote  This quote is never closed.",
        "3 warnings, 1 info in story.vxd.",
        "",
      ].join("\n"),
    );
    for (const warning of parse(WARNED).warnings) {
      expect(result.stdout).toContain(
        `story.vxd:${warning.line}:${warning.column}  ${warning.severity}  ${warning.code}  ${warning.message}\n`,
      );
    }
  });

  it("fails on info only with --strict", async () => {
    const files = { "story.vxd": INFO_ONLY };
    const relaxed = await vxd(["check", "story.vxd"], files);
    expect(relaxed.code).toBe(0);
    expect(relaxed.stdout).toBe(
      "story.vxd:4:3  info  silent-cast-member  Sue is in the cast but never speaks.\n1 info in story.vxd.\n",
    );
    expect((await vxd(["check", "story.vxd", "--strict"], files)).code).toBe(1);
    expect((await vxd(["check", "--strict", "story.vxd"], { "story.vxd": peter })).code).toBe(0);
  });

  it("checks several files and counts the ones with problems", async () => {
    const files = { "a.vxd": peter, "b.vxd": WARNED, "c.vxd": peter };
    const result = await vxd(["check", "a.vxd", "b.vxd", "c.vxd"], files);
    expect(result.code).toBe(1);
    expect(result.stdout.split("\n").filter((line) => line.startsWith("b.vxd:"))).toHaveLength(4);
    expect(result.stdout).not.toContain("a.vxd:");
    expect(result.stdout.endsWith("3 warnings, 1 info in 1 of 3 files.\n")).toBe(true);
    const clean = await vxd(["check", "a.vxd", "c.vxd"], files);
    expect(clean).toMatchObject({ code: 0, stdout: "No problems in 2 files.\n" });
  });

  it("prints a JSON array with --json", async () => {
    const result = await vxd(["check", "--json", "story.vxd"], { "story.vxd": WARNED });
    expect(result.code).toBe(1);
    expect(result.stdout.endsWith("]\n")).toBe(true);
    const problems = JSON.parse(result.stdout);
    expect(problems).toHaveLength(4);
    expect(problems[1]).toEqual({
      file: "story.vxd",
      line: 6,
      column: 2,
      endLine: 6,
      endColumn: 4,
      level: "warning",
      code: "unknown-character",
      message: "“Al” is not in the cast.",
    });
    const clean = await vxd(["check", "--json", "a.vxd"], { "a.vxd": peter });
    expect(clean).toMatchObject({ code: 0, stdout: "[]\n" });
  });

  it("reads standard input for -", async () => {
    const result = await vxd(["check", "-"], {}, { stdin: WARNED });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("<stdin>:6:2  warning  unknown-character");
  });
});

describe("vxd fmt", () => {
  it("formats a file in place and lists it", async () => {
    const result = await vxd(["fmt", "story.vxd"], { "story.vxd": MESSY });
    expect(result).toMatchObject({ code: 0, stdout: "story.vxd\n", stderr: "" });
    expect(result.written).toEqual(["story.vxd"]);
    expect(result.file("story.vxd")).toBe(format(MESSY));
    expect(result.file("story.vxd")).toContain(
      'The clown said, @Clown "Hello there."\n\nThe end.\n',
    );
  });

  it("never rewrites a file that is already formatted", async () => {
    const files = { "peter.vxd": peter, "story.vxd": MESSY };
    const result = await vxd(["fmt", "peter.vxd", "story.vxd"], files);
    expect(result).toMatchObject({ code: 0, stdout: "story.vxd\n" });
    expect(result.written).toEqual(["story.vxd"]);
    expect(result.file("peter.vxd")).toBe(peter);
  });

  it("with --check, writes nothing, lists what would change and exits 1", async () => {
    const files = { "peter.vxd": peter, "story.vxd": MESSY };
    const result = await vxd(["fmt", "--check", "peter.vxd", "story.vxd"], files);
    expect(result).toMatchObject({ code: 1, stdout: "story.vxd\n", stderr: "", written: [] });
    expect(result.file("story.vxd")).toBe(MESSY);
    const clean = await vxd(["fmt", "--check", "peter.vxd"], files);
    expect(clean).toMatchObject({ code: 0, stdout: "", written: [] });
    expect((await vxd(["fmt", "--check", "-"], {}, { stdin: MESSY })).stdout).toBe("<stdin>\n");
  });

  it("prints with --stdout, and for standard input", async () => {
    const printed = await vxd(["fmt", "--stdout", "story.vxd"], { "story.vxd": MESSY });
    expect(printed).toMatchObject({ code: 0, stdout: format(MESSY), written: [] });
    const piped = await vxd(["fmt", "-"], {}, { stdin: MESSY });
    expect(piped).toMatchObject({ code: 0, stdout: format(MESSY), written: [] });
  });

  it("makes quotes curly when asked, in the story's language or the one given", async () => {
    const curly = await vxd(["fmt", "--stdout", "--quotes", "curly", "s.vxd"], { "s.vxd": MESSY });
    expect(curly.stdout).toBe(format(MESSY, { quotes: "curly" }));
    expect(curly.stdout).toContain("@Clown “Hello there.”");
    const german = await vxd(
      ["fmt", "-", "--quotes", "curly", "--language", "de"],
      {},
      { stdin: MESSY },
    );
    expect(german.stdout).toBe(format(MESSY, { quotes: "curly", language: "de" }));
    expect(german.stdout).toContain("@Clown „Hello there.“");
    const kept = await vxd(["fmt", "-", "--quotes", "keep"], {}, { stdin: MESSY });
    expect(kept.stdout).toBe(format(MESSY));
  });

  it("leaves names, or spacing, alone when asked", async () => {
    const names = await vxd(["fmt", "-", "--no-names"], {}, { stdin: MESSY });
    expect(names.stdout).toBe(format(MESSY, { names: false }));
    expect(names.stdout).toContain("@clown");
    const spacing = await vxd(["fmt", "-", "--no-spacing"], {}, { stdin: MESSY });
    expect(spacing.stdout).toBe(format(MESSY, { spacing: false }));
    expect(spacing.stdout).toContain("The  clown   said, @Clown");
  });
});

describe("vxd render", () => {
  const files = { "peter.vxd": peter };

  it("writes a whole page of the script view by default", async () => {
    const result = await vxd(["render", "peter.vxd"], files);
    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(result.stdout).toBe(renderDocument(story, "script"));
    expect(result.stdout.startsWith("<!doctype html>")).toBe(true);
    expect(result.stdout).toContain('<article class="vxd vxd-script"');
  });

  it("writes the book view, with page numbers when asked", async () => {
    expect((await vxd(["render", "peter.vxd", "--view", "book"], files)).stdout).toBe(
      renderDocument(story, "book"),
    );
    const pages = await vxd(["render", "peter.vxd", "--view=book", "--pages", "--fragment"], files);
    expect(pages.stdout).toBe(`${renderBook(story, { pages: true })}\n`);
    expect(pages.stdout).toContain("vxd-page-number");
  });

  it("writes only the article with --fragment, and no header with --no-header", async () => {
    const fragment = await vxd(["render", "peter.vxd", "--fragment"], files);
    expect(fragment.stdout).toBe(`${render(story, "script")}\n`);
    expect(fragment.stdout.startsWith("<article")).toBe(true);
    const bare = await vxd(["render", "peter.vxd", "--fragment", "--no-header"], files);
    expect(bare.stdout).toBe(`${render(story, "script", { header: false })}\n`);
    expect(fragment.stdout).toContain("vxd-header");
    expect(bare.stdout).not.toContain("vxd-header");
  });

  it("writes to --out, or to standard output for -", async () => {
    const result = await vxd(["render", "peter.vxd", "-o", "site/peter.html"], files);
    expect(result).toMatchObject({ code: 0, stdout: "", written: ["site/peter.html"] });
    expect(result.file("site/peter.html")).toBe(renderDocument(story, "script"));
    expect((await vxd(["render", "peter.vxd", "--out", "-"], files)).stdout).toBe(
      renderDocument(story, "script"),
    );
  });

  it("refuses to write over a folder", async () => {
    const result = await vxd(["render", "peter.vxd", "--out", "site"], {
      ...files,
      "site/index.html": "",
    });
    expect(result).toMatchObject({ code: 2, stderr: "vxd: site is a folder, not a file\n" });
  });
});

describe("vxd export", () => {
  const files = { "peter.vxd": peter };

  it("writes the lines as JSON by default, with the kind first", async () => {
    const result = await vxd(["export", "peter.vxd"], files);
    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(result.stdout.endsWith("]\n")).toBe(true);
    expect(result.stdout).toContain('\n  {\n    "kind": "speech",\n    "speaker": "Narrator",');
    const rows = JSON.parse(result.stdout);
    expect(rows).toEqual(lines(story));
    expect(Object.keys(rows[0]).slice(0, 4)).toEqual(["kind", "speaker", "direction", "text"]);
  });

  it("keeps only what characters say with --speech-only", async () => {
    const rows = JSON.parse((await vxd(["export", "peter.vxd", "--speech-only"], files)).stdout);
    expect(rows).toEqual(lines(story, { speechOnly: true }));
    expect(rows.some((row: { kind: string }) => row.kind === "vocal")).toBe(true);
    expect(rows.every((row: { kind: string }) => ["speech", "vocal"].includes(row.kind))).toBe(
      true,
    );
  });

  it("writes CSV", async () => {
    const all = await vxd(["export", "peter.vxd", "--format", "csv"], files);
    expect(all.stdout).toBe(linesToCsv(lines(story)));
    const said = await vxd(["export", "peter.vxd", "--format", "csv", "--speech-only"], files);
    expect(said.stdout).toBe(linesToCsv(lines(story, { speechOnly: true })));
    expect(said.stdout.split("\r\n")[0]).toBe("kind,speaker,direction,text,scene,page");
    const saved = await vxd(
      ["export", "peter.vxd", "--format", "csv", "--out", "lines.csv"],
      files,
    );
    expect(saved).toMatchObject({ code: 0, stdout: "", written: ["lines.csv"] });
    expect(saved.file("lines.csv")).toBe(all.stdout);
  });

  it("writes what each character says as == Name == sections", async () => {
    const said = textByCharacter(story);
    const result = await vxd(["export", "peter.vxd", "--format", "text"], files);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      [...said].map(([name, text]) => `== ${name} ==\n${text}`).join("\n"),
    );
    expect(result.stdout.startsWith("== Narrator ==\nThe Tale of Peter Rabbit\n")).toBe(true);
    expect(result.stdout).toContain("\n\n== Peter ==\n[small sobs]\n(a real sneeze) Kertyschoo!\n");
    const saved = await vxd(["export", "peter.vxd", "--format", "text", "-o", "all.txt"], files);
    expect(saved.file("all.txt")).toBe(result.stdout);
  });

  it("writes one Name.txt per character into a folder", async () => {
    const said = textByCharacter(story);
    const made = await vxd(["export", "peter.vxd", "--format", "text", "--out", "sides/"], files);
    expect(made).toMatchObject({ code: 0, stdout: "", stderr: "" });
    expect(made.written).toEqual([...said.keys()].map((name) => `sides/${name}.txt`));
    for (const [name, text] of said) expect(made.file(`sides/${name}.txt`)).toBe(text);
    // An existing folder needs no slash.
    const existing = await vxd(["export", "peter.vxd", "--format", "text", "--out", "sides"], {
      ...files,
      "sides/notes.md": "",
    });
    expect(existing.written).toEqual(made.written);
  });

  it("gives every character a file name that works everywhere", async () => {
    const source = "---\nnarrator: The Teller\n---\n@Con “Hello.”\n\nOnce upon a time.\n";
    const result = await vxd(
      ["export", "-", "--format", "text", "--out", "sides/"],
      {},
      {
        stdin: source,
      },
    );
    expect(result.written.sort()).toEqual(["sides/Con_.txt", "sides/The Teller.txt"]);
  });

  it("refuses a folder for JSON or CSV", async () => {
    const result = await vxd(["export", "peter.vxd", "--out", "out/"], files);
    expect(result).toMatchObject({ code: 2, written: [] });
    expect(result.stderr).toBe(
      "vxd: --out out/ is a folder, but json is one file (see vxd export --help)\n",
    );
  });
});

describe("vxd text", () => {
  const files = { "peter.vxd": peter };

  it("prints the book text or the spoken script", async () => {
    const book = await vxd(["text", "peter.vxd", "--book"], files);
    expect(book).toMatchObject({ code: 0, stdout: `${bookText(story)}\n` });
    expect(book.stdout).not.toContain("@");
    const spoken = await vxd(["text", "--spoken", "peter.vxd"], files);
    expect(spoken).toMatchObject({ code: 0, stdout: `${spokenScript(story)}\n` });
    expect(spoken.stdout).toContain("\nMother (brisk and kind): Now my dears,\n");
  });

  it("writes to --out, and prints nothing for an empty story", async () => {
    const saved = await vxd(["text", "peter.vxd", "--book", "--out", "peter.md"], files);
    expect(saved).toMatchObject({ code: 0, stdout: "", written: ["peter.md"] });
    expect(saved.file("peter.md")).toBe(`${bookText(story)}\n`);
    expect(await vxd(["text", "-", "--book"], {}, { stdin: "" })).toMatchObject({
      code: 0,
      stdout: "",
    });
  });
});

describe("vxd import", () => {
  const files = { "visit.fountain": FOUNTAIN };

  it("turns a Fountain screenplay into a story", async () => {
    const result = await vxd(["import", "visit.fountain"], files);
    expect(result).toMatchObject({ code: 0, stderr: "", stdout: fromFountain(FOUNTAIN) });
    expect(result.stdout).toContain("## INT. KITCHEN - DAY {hidden}\n");
    expect(result.stdout).toContain("@Bob (quietly) “Hello.”\n");
  });

  it("reads scene headings aloud when asked", async () => {
    const result = await vxd(["import", "visit.fountain", "--read-scene-headings"], files);
    expect(result.stdout).toBe(fromFountain(FOUNTAIN, { readSceneHeadings: true }));
    expect(result.stdout).not.toContain("{hidden}");
  });

  it("writes to --out a story that checks clean", async () => {
    const result = await vxd(["import", "visit.fountain", "--out", "visit.vxd"], files);
    expect(result).toMatchObject({ code: 0, stdout: "", written: ["visit.vxd"] });
    const imported = result.file("visit.vxd") ?? "";
    expect(await vxd(["check", "-"], {}, { stdin: imported })).toMatchObject({ code: 0 });
  });
});
