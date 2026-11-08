import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The spec's examples are the parser's conformance tests (SPEC.md §3). Until the parser exists,
 * this checks they are well formed: an input, a spoken script written in the §12.1 line
 * grammar, and an optional book text.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const spec = readFileSync(join(root, "SPEC.md"), "utf8");

type Example = { line: number; parts: number; input: string; script: string; book?: string };

function examples(markdown: string): Example[] {
  const found: Example[] = [];
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== "```example") continue;
    const start = i + 1;
    let end = start;
    while (end < lines.length && lines[end] !== "```") end++;
    const parts: string[][] = [[]];
    for (const line of lines.slice(start, end)) {
      if (line === ".") parts.push([]);
      else parts[parts.length - 1]?.push(line);
    }
    const [input = [], script = [], book] = parts;
    found.push({
      line: start,
      parts: parts.length,
      input: input.join("\n"),
      script: script.join("\n"),
      ...(book ? { book: book.join("\n") } : {}),
    });
    i = end;
  }
  return found;
}

const HANDLE = String.raw`\p{L}[\p{L}\p{M}\p{N}_-]*(?:['’]\p{L}[\p{L}\p{M}\p{N}_-]*)*`;
const DIRECTION = String.raw`\((?:[^()]|\([^()]*\))+\)`;
const SCRIPT_LINE = new RegExp(
  [
    String.raw`^$`,
    String.raw`^---$`,
    String.raw`^#{1,6} ${HANDLE}(?: ${DIRECTION})?: .+$`,
    String.raw`^#{1,6} .+ \{(?:hidden|book only)\}$`,
    String.raw`^${HANDLE}(?: ${DIRECTION})?: .+$`,
    String.raw`^${HANDLE}(?: ${DIRECTION})? \[[^\]]+\]$`,
    String.raw`^\[[^\]]+\]$`,
    String.raw`^\{[^{}]+\}$`,
    String.raw`^\{(?:book only|hidden)\} .+$`,
    String.raw`^%% .+ %%$`,
    String.raw`^!\[[^\]]*\]\([^)]+\)$`,
  ].join("|"),
  "u",
);

describe("SPEC.md examples", () => {
  const all = examples(spec);

  it("has examples for every part of the spec", () => {
    expect(all.length).toBeGreaterThanOrEqual(60);
  });

  it.each(all.map((example) => [example.line, example] as const))(
    "example at line %i has an input, a spoken script and at most a book text",
    (_line, example) => {
      expect([2, 3]).toContain(example.parts);
      expect(example.input.trim()).not.toBe("");
      expect(example.script.trim()).not.toBe("");
    },
  );

  it.each(all.map((example) => [example.line, example] as const))(
    "example at line %i writes its spoken script in the §12.1 line grammar",
    (_line, example) => {
      const bad = example.script.split("\n").filter((line) => !SCRIPT_LINE.test(line));
      expect(bad).toEqual([]);
    },
  );
});

describe("examples folder", () => {
  it("Peter Rabbit declares the spec version it follows", () => {
    const peter = readFileSync(join(root, "examples", "peter-rabbit.md"), "utf8");
    expect(peter.startsWith("---\naudiobook-markup: 0.1\n")).toBe(true);
  });
});
