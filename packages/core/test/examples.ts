import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The spec's examples (SPEC.md §3): an input, a line with a single dot, the spoken script, and
 * optionally a second dot and the book text. `line` is the 1-based line of its opening fence.
 */
export type Example = {
  line: number;
  /** The section it is in, such as "5.6". */
  section: string;
  /** The spec version it is new in, if later than 1.0: its fence says so (```` ```example 1.1 ````). */
  since?: string;
  parts: number;
  input: string;
  script: string;
  book?: string;
};

/** The repository root, where `spec/` and `examples/` are. */
export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const spec = readFileSync(join(root, "spec", "SPEC.md"), "utf8");

export function examples(markdown: string): Example[] {
  const found: Example[] = [];
  const lines = markdown.split("\n");
  let section = "";
  for (let i = 0; i < lines.length; i++) {
    const heading = /^#{2,3} (\d+(?:\.\d+)?)\.? /.exec(lines[i] ?? "");
    if (heading?.[1]) section = heading[1];
    const fence = /^```example(?: (\d+\.\d+))?$/.exec(lines[i] ?? "");
    if (!fence) continue;
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
      section,
      ...(fence[1] ? { since: fence[1] } : {}),
      parts: parts.length,
      input: input.join("\n"),
      script: script.join("\n"),
      ...(book ? { book: book.join("\n") } : {}),
    });
    i = end;
  }
  return found;
}
