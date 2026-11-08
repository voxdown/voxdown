import { describe, expect, it } from "vitest";
import { bookText, parse, spokenScript } from "../src/index";
import { examples, spec } from "./examples";

/** Every example in SPEC.md, run through the parser (§3). Tests are named by the line of the fence. */
describe("SPEC.md conformance", () => {
  const all = examples(spec);

  it.each(all.map((example) => [example.line, example] as const))(
    "example at line %i",
    (_line, example) => {
      const story = parse(example.input);
      expect(spokenScript(story)).toBe(example.script);
      if (example.book !== undefined) expect(bookText(story)).toBe(example.book);
    },
  );
});
