import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { examples, root, spec } from "./examples";

/**
 * The spec's examples are the parser's conformance tests (SPEC.md §3). This checks they are well
 * formed: an input, a spoken script written in the §12.1 line grammar, and an optional book text.
 * `conformance.test.ts` checks that the parser produces them.
 */
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
    const peter = readFileSync(join(root, "examples", "peter-rabbit.vxd"), "utf8");
    expect(peter.startsWith("---\nvoxdown: 1.0\n")).toBe(true);
  });
});
