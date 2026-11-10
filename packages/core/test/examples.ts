import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The spec's examples (SPEC.md §3): an input, a line with a single dot, the spoken script, and
 * optionally a second dot and the book text. `line` is the 1-based line of its opening fence.
 */
export type Example = { line: number; parts: number; input: string; script: string; book?: string };

/** The repository root, where `spec/` and `examples/` are. */
export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const spec = readFileSync(join(root, "spec", "SPEC.md"), "utf8");

export function examples(markdown: string): Example[] {
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
