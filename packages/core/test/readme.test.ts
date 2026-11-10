import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bookText, lines, linesToCsv, parse, spokenScript } from "../src/index";
import { root } from "./examples";

/** The README's 30-second example says what the code does. */
describe("README.md", () => {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const example = /```js\n([\s\S]*?)```/.exec(readme)?.[1] ?? "";
  const comments = (after: string) => {
    const start = example.indexOf(after);
    const lines = example
      .slice(start + after.length)
      .split("\n")
      .slice(1);
    const taken: string[] = [];
    for (const line of lines) {
      if (!line.startsWith("// ")) break;
      taken.push(line.slice(3));
    }
    return taken.join("\n");
  };
  const source = /parse\("(.*)"\)/.exec(example)?.[1] ?? "";
  const story = parse(source);

  it("parses the story it shows", () => {
    expect(source).toContain("@Gerald");
  });

  it("shows the spoken script, the book text and the CSV the code gives", () => {
    expect(comments("spokenScript(story);")).toBe(spokenScript(story));
    expect(comments("bookText(story);")).toBe(bookText(story));
    expect(comments("linesToCsv(lines(story));")).toBe(
      linesToCsv(lines(story)).replace(/\r\n$/, "").replace(/\r\n/g, "\n"),
    );
  });
});
