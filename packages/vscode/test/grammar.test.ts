import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { type Item, type SyntaxToken, type TokenKind, parse, tokens } from "voxdown";
import { TOKEN_SCOPES, hasScope } from "../src/scopes";

/**
 * The grammar against the core: for every example in the spec and every example story, each
 * syntax token the core reports starts where the grammar gives it that kind's scope, and the
 * grammar gives no kind's scope where the core reports no token of that kind.
 */

const require = createRequire(import.meta.url);
const onig = require("vscode-oniguruma") as typeof import("vscode-oniguruma");
const textmate = require("vscode-textmate") as typeof import("vscode-textmate");

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const wasm = readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm"));
const loaded = onig.loadWASM(
  wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer,
);

const grammars: Record<string, string> = {
  "text.voxdown": read("../syntaxes/voxdown.tmLanguage.json"),
  "markdown.voxdown.codeblock": read("../syntaxes/voxdown.markdown.tmLanguage.json"),
  // A stand-in for VS Code's Markdown grammar, for the code block injection.
  "text.html.markdown": JSON.stringify({ scopeName: "text.html.markdown", patterns: [] }),
};

const registry = new textmate.Registry({
  onigLib: loaded.then(() => ({
    createOnigScanner: (sources: string[]) => new onig.OnigScanner(sources),
    createOnigString: (text: string) => new onig.OnigString(text),
  })),
  loadGrammar: async (scopeName) => {
    const raw = grammars[scopeName];
    return raw === undefined ? null : textmate.parseRawGrammar(raw, `${scopeName}.json`);
  },
  getInjections: (scopeName) =>
    scopeName === "text.html.markdown" ? ["markdown.voxdown.codeblock"] : undefined,
});

type Scoped = { from: number; to: number; scopes: string[] };

async function tokenize(text: string, scopeName = "text.voxdown"): Promise<Scoped[]> {
  const grammar = await registry.loadGrammar(scopeName);
  if (!grammar) throw new Error(`No grammar for ${scopeName}`);
  const scoped: Scoped[] = [];
  let stack = textmate.INITIAL;
  let offset = 0;
  for (const raw of text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const result = grammar.tokenizeLine(line, stack);
    for (const token of result.tokens) {
      const to = Math.min(token.endIndex, line.length);
      if (to > token.startIndex) {
        scoped.push({ from: offset + token.startIndex, to: offset + to, scopes: token.scopes });
      }
    }
    stack = result.ruleStack;
    offset += raw.length + 1;
  }
  return scoped;
}

function scopesAt(scoped: readonly Scoped[], offset: number): string[] {
  return scoped.find((token) => token.from <= offset && offset < token.to)?.scopes ?? [];
}

/** Where an offset is, for messages: its line and column, and the text from there. */
function at(text: string, offset: number): string {
  const before = text.slice(0, offset).split("\n");
  const rest = text.slice(offset, offset + 24).split("\n")[0];
  return `${before.length}:${(before[before.length - 1]?.length ?? 0) + 1} “${rest}”`;
}

function items(text: string): Item[] {
  return parse(text).blocks.flatMap((block) => {
    if (block.kind === "paragraph") return block.lines.flatMap((line) => line.items);
    return block.kind === "heading" ? block.line.items : [];
  });
}

/**
 * The exception for the spec's examples. A speech's quotation marks need the parser's quote rules:
 * the grammar colors the quotes after a character mark, to the end of the line where the last of
 * them closes, but a quote that carries a speech on into the next paragraph (§5.7) stays plain. So
 * quote tokens of carried-on speeches (`continued`) may be missing; every other one must be there,
 * and the grammar never colors a quote the core doesn't give to a speech.
 */
function mayMiss(text: string, token: SyntaxToken): boolean {
  if (token.kind !== "quote") return false;
  return items(text).some(
    (item) =>
      item.kind === "speech" &&
      item.continued &&
      (item.openQuote?.from === token.range.from || item.closeQuote?.from === token.range.from),
  );
}

const KINDS = Object.keys(TOKEN_SCOPES) as TokenKind[];

async function disagreements(text: string): Promise<string[]> {
  const scoped = await tokenize(text);
  const found = tokens(parse(text));
  const problems: string[] = [];
  for (const token of found) {
    const scopes = scopesAt(scoped, token.range.from);
    if (!hasScope(scopes, TOKEN_SCOPES[token.kind]) && !mayMiss(text, token)) {
      problems.push(
        `the core's ${token.kind} at ${at(text, token.range.from)} has ${scopes.join(" ")}`,
      );
    }
  }
  for (const token of scoped) {
    for (const kind of KINDS) {
      if (!hasScope(token.scopes, TOKEN_SCOPES[kind])) continue;
      const agrees = found.some(
        (other) =>
          other.kind === kind &&
          (kind === "quote"
            ? other.range.from === token.from
            : other.range.from <= token.from && token.from < other.range.to),
      );
      if (!agrees)
        problems.push(`the grammar's ${kind} at ${at(text, token.from)} isn't the core's`);
    }
  }
  return problems;
}

type Example = { example: number; section: string; input: string };
const conformance = JSON.parse(read("../../../spec/conformance.json")) as Example[];
const examplesDir = new URL("../../../examples/", import.meta.url);
const stories = readdirSync(examplesDir)
  .filter((name) => name.endsWith(".vxd"))
  .map((name) => [name, readFileSync(new URL(name, examplesDir), "utf8")] as const);

describe("the grammar agrees with the core's tokens", () => {
  it.each(conformance.map((entry) => [entry.example, entry.section, entry.input] as const))(
    "example %i (§%s)",
    async (_example, _section, input) => {
      expect(await disagreements(input)).toEqual([]);
    },
  );

  it.each(stories)("examples/%s", async (_name, text) => {
    expect(await disagreements(text)).toEqual([]);
  });

  it("ends what a mark does at a line break inside a note, as the core does (§5.3, §10)", async () => {
    for (const text of [
      "@Alice “Hello.” %% a\nnote %% “Goodbye.”",
      "@Bob Hello %% a\nnote %% world.",
      "@Alice “Hello %% a\nnote %% there.” And then.",
    ]) {
      expect(await disagreements(text), text).toEqual([]);
    }
  });

  it("has an example story to check", () => {
    expect(stories.length).toBeGreaterThan(0);
  });
});

/**
 * Two things a grammar can't know without looking ahead, where the core reads to the end first: a
 * `%%` that is never closed is text to the core, and a first line `---` that is never closed is a
 * scene break. The grammar colors the rest of the file as a note, or as front matter.
 */
function needsLookahead(text: string): boolean {
  const story = parse(text);
  if (story.warnings.some((warning) => warning.code === "unclosed-note")) return true;
  return /^\uFEFF?---\s*$/.test(text.split("\n")[0] ?? "") && story.frontMatter === null;
}

/** Lines that put marks side by side in ways the spec's examples don't. */
const EDGE_LINES = [
  "@Gerald(yawning)“Hi.”",
  "@Gerald [x](https://example.com) z",
  "@Gerald [x](unclosed",
  "@Wanda “a” {page} “b” @(x) “c”",
  "::: @Gerald [snores] x",
  "::: whisper @Gerald",
  "::: {book only} x {hidden}",
  "# @Gerald “Title",
  "@Gerald “x [y”] z”",
  "@G 'cause 'em 'x'",
  "@G rock'n'roll 'hi'",
  "\\\\@Gerald",
  "a@(x) a@Gerald",
  "@(x)@Gerald",
  "@Gerald’s cave “Hi”",
  "{pause 2 s} {pause x} {page:x} {Page} {1}",
  "@Gerald [ ] “x”",
  "_a_b_ __c__ *d* **e**",
  "„x“ @Anna „y“",
  "@A »x« »y»",
  "@A ‹x› 『x』 ‚x‘",
  "%% a \\%% b %%",
  "@A “x %% ” %% y”",
  "@A “x @B (d) y” z",
  "::::",
  "::: :",
  "####### seven",
];

describe("the grammar agrees with the core on example lines put together", () => {
  it("in 400 texts made at random from them, with a fixed seed", async () => {
    const pool = [...new Set(conformance.flatMap((entry) => entry.input.split("\n")))];
    pool.push(...EDGE_LINES);
    let seed = 1;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const problems: string[] = [];
    let checked = 0;
    while (checked < 400) {
      const lines = Array.from({ length: 1 + Math.floor(random() * 5) }, () =>
        random() < 0.2 ? "" : (pool[Math.floor(random() * pool.length)] ?? ""),
      );
      const text = lines.join("\n");
      if (needsLookahead(text)) continue;
      checked++;
      const found = await disagreements(text);
      if (found.length > 0) problems.push(`${JSON.stringify(text)}: ${found.join("; ")}`);
    }
    expect(problems).toEqual([]);
  });

  it("but not in the two places that need looking ahead", async () => {
    expect(needsLookahead("Ten %% percent.\nMore.")).toBe(true);
    expect(await scopesOf("Ten %% percent.\nMore.", "More")).toContain(
      "comment.block.note.voxdown",
    );
    expect(needsLookahead("---\nNo closing line.")).toBe(true);
    expect(await scopesOf("---\nNo closing line.", "No")).toContain("meta.frontmatter.voxdown");
  });
});

/** The scopes at the first occurrence of `needle` in `text`. */
async function scopesOf(text: string, needle: string, scopeName?: string): Promise<string[]> {
  const offset = text.indexOf(needle);
  if (offset < 0) throw new Error(`“${needle}” is not in the text`);
  return scopesAt(await tokenize(text, scopeName), offset);
}

describe("the grammar by hand", () => {
  it("leaves an email address and a lone @ as text", async () => {
    const text = "Write to tom@example.com, or meet me @ noon.";
    expect(await scopesOf(text, "@example")).toEqual(["text.voxdown"]);
    expect(await scopesOf(text, "example")).toEqual(["text.voxdown"]);
    expect(await scopesOf(text, "@ noon")).toEqual(["text.voxdown"]);
  });

  it("reads \\@ as an escape, not a mark", async () => {
    const text = "\\@Gerald is my username.";
    expect(await scopesOf(text, "\\@")).toContain("constant.character.escape.voxdown");
    expect(await scopesOf(text, "Gerald")).toEqual(["text.voxdown"]);
  });

  it("reads @[text](address) as an @ and a link, as the core does (§8.3)", async () => {
    const text = "@Gerald “Hi @[the page](https://a.b).” @[sneezes]";
    const scopes = await scopesOf(text, "the page");
    expect(scopes).toContain("string.other.link.title.voxdown");
    expect(hasScope(scopes, TOKEN_SCOPES.vocal)).toBe(false);
    expect(hasScope(await scopesOf(text, "sneezes"), TOKEN_SCOPES.vocal)).toBe(true);
  });

  it("reads [text](address) as a link, not a sound", async () => {
    const text = "Read more at [our website](https://example.com).";
    const scopes = await scopesOf(text, "our website");
    expect(scopes).toContain("string.other.link.title.voxdown");
    expect(hasScope(scopes, TOKEN_SCOPES.sound)).toBe(false);
    expect(await scopesOf(text, "https")).toContain("markup.underline.link.voxdown");
    expect(hasScope(await scopesOf("A clang. [crash] Then", "crash"), TOKEN_SCOPES.sound)).toBe(
      true,
    );
  });

  it("colors a note over several lines and paragraphs, and nothing in it", async () => {
    const text = "%%\nHushed from here.\n\n## Not a heading @Gerald\n%%\nOnce upon a time.";
    for (const needle of ["Hushed", "## Not", "@Gerald"]) {
      const scopes = await scopesOf(text, needle);
      expect(scopes).toContain("comment.block.note.voxdown");
      expect(scopes.filter((scope) => scope !== "comment.block.note.voxdown")).toEqual([
        "text.voxdown",
      ]);
    }
    expect(await scopesOf(text, "Once")).toEqual(["text.voxdown"]);
  });

  it("gives a character mark, its name, direction, sound and speech their scopes", async () => {
    const text = "@Gerald (softly) [snores] “Could you not?” said the dragon.";
    expect(await scopesOf(text, "@")).toContain("punctuation.definition.tag.voxdown");
    expect(await scopesOf(text, "Gerald")).toContain("entity.name.tag.character.voxdown");
    expect(await scopesOf(text, "softly")).toContain(
      "entity.other.attribute-name.direction.voxdown",
    );
    expect(await scopesOf(text, "snores")).toContain("entity.name.type.vocal.voxdown");
    expect(await scopesOf(text, "“")).toContain("punctuation.definition.string.begin.voxdown");
    expect(await scopesOf(text, "Could")).toContain("string.quoted.double.speech.voxdown");
    expect(await scopesOf(text, "said")).toEqual(["text.voxdown"]);
  });

  it("names in any script, with apostrophes between letters", async () => {
    for (const [text, name] of [
      ["@Zoë “Hi.”", "Zoë"],
      ["@O’Brien “Hi.”", "O’Brien"],
      ["雷公听见了@雷公 [笑]", "雷公 "],
    ] as const) {
      const offset = text.indexOf(name);
      const scoped = await tokenize(text);
      const token = scoped.find((t) => t.from <= offset && offset < t.to);
      expect(token?.scopes).toContain("entity.name.tag.character.voxdown");
      expect(text.slice(token?.from, token?.to)).toBe(name.trim());
    }
  });

  it("tells page turns, pauses and visibility from a tool's instructions", async () => {
    const text = "{page 12} {pause 2s} {book only} {recorder:take 3} {whatever}";
    expect(await scopesOf(text, "page")).toContain("keyword.control.page.voxdown");
    expect(await scopesOf(text, "12")).toContain("constant.numeric.page.voxdown");
    expect(await scopesOf(text, "pause")).toContain("keyword.control.pause.voxdown");
    expect(await scopesOf(text, "2s")).toContain("constant.numeric.length.voxdown");
    expect(await scopesOf(text, "book")).toContain("storage.modifier.visibility.voxdown");
    expect(await scopesOf(text, "recorder")).toContain("entity.name.function.tool.voxdown");
    expect(await scopesOf(text, "take 3")).toContain("entity.name.function.tool.voxdown");
    expect(await scopesOf(text, "whatever")).toContain("keyword.other.instruction.voxdown");
    expect(await scopesOf("{1} {}", "1")).toEqual(["text.voxdown"]);
  });

  it("colors headings, groups, scene breaks and front matter", async () => {
    const text = "---\ntitle: T\n---\n## The cave {hidden}\n::: @Wanda reading\nDear.\n:::\n***";
    expect(await scopesOf(text, "title")).toContain("meta.embedded.block.frontmatter.voxdown");
    expect(await scopesOf(text, "##")).toContain("punctuation.definition.heading.voxdown");
    expect(await scopesOf(text, "The cave")).toContain("entity.name.section.voxdown");
    expect(await scopesOf(text, "hidden")).toContain("storage.modifier.visibility.voxdown");
    expect(await scopesOf(text, ":::")).toContain("keyword.control.group.begin.voxdown");
    expect(await scopesOf(text, "Wanda")).toContain("entity.name.tag.character.voxdown");
    expect(await scopesOf(text, "reading")).toContain(
      "entity.other.attribute-name.direction.voxdown",
    );
    expect(await scopesOf(text, "Dear")).toEqual(["text.voxdown", "meta.group.voxdown"]);
    expect(await scopesOf(text, ":::\n***")).toContain("keyword.control.group.end.voxdown");
    expect(await scopesOf(text, "***")).toContain("meta.separator.voxdown");
    for (const spaced of ["* * *", "- - -"]) {
      expect(await scopesOf(`One.\n\n${spaced}\n\nTwo.`, spaced)).toContain(
        "meta.separator.voxdown",
      );
    }
  });

  it("tells a group's closing line from a line of colons that closes nothing", async () => {
    const text = "::: whispering\n::: @Gerald\nCould you not?\n:::\n:::\n:::";
    const lines = await tokenize(text);
    const closes = lines.filter((token) => text.slice(token.from, token.to) === ":::");
    expect(closes.map((token) => hasScope(token.scopes, TOKEN_SCOPES.group))).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
    expect(await scopesOf(text, "Could")).toEqual([
      "text.voxdown",
      "meta.group.voxdown",
      "meta.group.voxdown",
    ]);
  });

  it("colors emphasis", async () => {
    const text = "I don’t *even* like **treasure**.";
    expect(await scopesOf(text, "even")).toContain("markup.italic.voxdown");
    expect(await scopesOf(text, "treasure")).toContain("markup.bold.voxdown");
  });

  it("colors VoxDown in Markdown code blocks tagged vxd or voxdown", async () => {
    for (const tag of ["vxd", "voxdown", "VoxDown"]) {
      const text = `Some Markdown. @Gerald\n\n\`\`\`${tag}\n@Gerald “Could you not?”\n\`\`\`\n@Wanda`;
      expect(await scopesOf(text, "Gerald “", "text.html.markdown")).toContain(
        "entity.name.tag.character.voxdown",
      );
      expect(await scopesOf(text, "Could", "text.html.markdown")).toContain(
        "meta.embedded.block.voxdown",
      );
      expect(await scopesOf(text, "Gerald", "text.html.markdown")).toEqual(["text.html.markdown"]);
      expect(await scopesOf(text, "Wanda", "text.html.markdown")).toEqual(["text.html.markdown"]);
    }
    const other = "```js\n@Gerald\n```";
    expect(await scopesOf(other, "Gerald", "text.html.markdown")).not.toContain(
      "entity.name.tag.character.voxdown",
    );
  });
});
