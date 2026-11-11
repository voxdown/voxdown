/**
 * What to put right in a story: the parser's warnings, in the editor's words where it has some,
 * with its fix; and the slips only the editor sees as you type (`@ Wanda`, a direction left
 * open), with theirs. Where the editor has no fix, a few are offered here: a sound or instruction
 * left open is closed at the end of its line, and a name not in the cast can be added to it.
 */
import type { EditorMark } from "@voxdown/editor";
import type { Story } from "voxdown";

export type Fix = { from: number; to: number; insert: string; label?: string };

export type Problem = {
  from: number;
  to: number;
  line: number;
  message: string;
  code: string;
  severity: string;
  fix?: Fix;
  /** A name the story uses that isn't in the cast: offered to be added. */
  cast?: string;
};

type Warning = Extract<EditorMark, { kind: "warning" }>;

export function problems(
  story: Story,
  marks: readonly EditorMark[],
  lineOf: (at: number) => number,
): Problem[] {
  const source = story.source;
  const drawn = marks.filter((mark): mark is Warning => mark.kind === "warning");
  const used = new Set<Warning>();
  const found: Problem[] = story.warnings.map((warning) => {
    const mine = drawn.find(
      (mark) =>
        !used.has(mark) &&
        mark.code === warning.code &&
        mark.from <= warning.range.to &&
        warning.range.from <= mark.to,
    );
    if (mine) used.add(mine);
    const name =
      warning.code === "unknown-character"
        ? source.slice(warning.range.from, warning.range.to).replace(/^@/, "")
        : undefined;
    return {
      from: warning.range.from,
      to: warning.range.to,
      line: warning.line,
      message: mine?.message ?? warning.message,
      code: warning.code,
      severity: warning.severity,
      ...(mine?.fix ? { fix: mine.fix } : {}),
      ...(name ? { cast: name } : {}),
    };
  });
  for (const mark of drawn) {
    if (used.has(mark) || mark.from > source.length) continue;
    const fix = mark.fix ?? closeAtLineEnd(source, mark);
    found.push({
      from: mark.from,
      to: mark.to,
      line: lineOf(mark.from),
      message: mark.message,
      code: mark.code,
      severity: "warning",
      ...(fix ? { fix } : {}),
    });
  }
  return found.sort((a, b) => a.from - b.from);
}

/** A `[` or `{` left open: closed where its line ends. */
function closeAtLineEnd(source: string, mark: Warning): Fix | undefined {
  if (mark.code !== "open-bracket") return undefined;
  const opener = source[mark.from];
  const closer = opener === "[" ? "]" : opener === "{" ? "}" : undefined;
  if (!closer) return undefined;
  const end = source.indexOf("\n", mark.from);
  const at = end < 0 ? source.length : source[end - 1] === "\r" ? end - 1 : end;
  return { from: at, to: at, insert: closer, label: "Close it at the end of the line" };
}
