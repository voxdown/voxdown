import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bookText, format, lines, parse, spokenScript, write } from "../src/index";
import { examples, root, spec } from "./examples";

/**
 * Every example in SPEC.md, run through the parser (§3), and the conformance file other
 * implementations test themselves with (spec/conformance.json, §15). Run with UPDATE_FIXTURES=1
 * (`pnpm fixtures`) to write the file again after changing the spec.
 */
const fixturesPath = join(root, "spec", "conformance.json");

type Fixture = {
  example: number;
  section: string;
  line: number;
  input: string;
  script: string;
  book?: string;
  lines: ReturnType<typeof lines>;
  warnings: Array<{ code: string; line: number; column: number }>;
};

function fixtures(): Fixture[] {
  return examples(spec).map((example, index) => {
    const story = parse(example.input);
    return {
      example: index + 1,
      section: example.section,
      line: example.line,
      input: example.input,
      script: example.script,
      ...(example.book !== undefined ? { book: example.book } : {}),
      lines: lines(story),
      warnings: story.warnings.map(({ code, line, column }) => ({ code, line, column })),
    };
  });
}

const generated = fixtures();
if (process.env.UPDATE_FIXTURES) {
  writeFileSync(fixturesPath, `${JSON.stringify(generated, null, 2)}\n`);
}
const published = JSON.parse(readFileSync(fixturesPath, "utf8")) as Fixture[];

describe("SPEC.md conformance", () => {
  it.each(generated.map((fixture) => [fixture.line, fixture] as const))(
    "example at line %i",
    (_line, example) => {
      const story = parse(example.input);
      expect(spokenScript(story)).toBe(example.script);
      if (example.book !== undefined) expect(bookText(story)).toBe(example.book);
    },
  );
});

describe("spec/conformance.json", () => {
  it("is up to date with SPEC.md and the parser (run `pnpm fixtures` if not)", () => {
    expect(published).toEqual(generated);
  });

  it("numbers every example and names its section", () => {
    expect(published.map((fixture) => fixture.example)).toEqual(
      published.map((_fixture, index) => index + 1),
    );
    expect(published.every((fixture) => /^\d+(?:\.\d+)?$/.test(fixture.section))).toBe(true);
  });

  it.each(published.map((fixture) => [fixture.example, fixture] as const))(
    "example %i parses to its fixture and writes back byte for byte",
    (_number, fixture) => {
      const story = parse(fixture.input);
      expect(spokenScript(story)).toBe(fixture.script);
      if (fixture.book !== undefined) expect(bookText(story)).toBe(fixture.book);
      expect(lines(story)).toEqual(fixture.lines);
      expect(story.warnings.map(({ code, line, column }) => ({ code, line, column }))).toEqual(
        fixture.warnings,
      );
      expect(write(story)).toBe(fixture.input);
    },
  );

  it.each(published.map((fixture) => [fixture.example, fixture] as const))(
    "example %i keeps who says what through the formatter, which settles at once",
    (_number, fixture) => {
      const formatted = format(fixture.input);
      expect(format(formatted)).toBe(formatted);
      const voices = (text: string) =>
        lines(parse(text)).map((line) => [line.kind, line.speaker, line.direction, line.text]);
      expect(voices(formatted)).toEqual(voices(fixture.input));
    },
  );
});
