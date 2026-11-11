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
    const written = source.slice(warning.range.from, warning.range.to);
    const name = warning.code === "unknown-character" ? written.replace(/^@/, "") : undefined;
    // A name a letter or two from one in the cast is most likely that one, mistyped.
    const likely = name
      ? nearestName(
          name,
          story.cast.map((member) => member.handle),
        )
      : undefined;
    const fix =
      mine?.fix ??
      (likely
        ? {
            from: warning.range.from,
            to: warning.range.to,
            insert: likely,
            label: `Change to @${likely}`,
          }
        : undefined);
    return {
      from: warning.range.from,
      to: warning.range.to,
      line: warning.line,
      message: mine?.message ?? warning.message,
      code: warning.code,
      severity: warning.severity,
      ...(fix ? { fix } : {}),
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

/**
 * The name in `names` nearest `name`, if it is one or two letters away (a letter left out, added,
 * changed, or two swapped), and nearer than any other; one letter for a short name.
 */
export function nearestName(name: string, names: readonly string[]): string | undefined {
  const most = name.length <= 4 ? 1 : 2;
  let best: string | undefined;
  let bestDistance = most + 1;
  let tied = false;
  for (const other of names) {
    if (other.toLowerCase() === name.toLowerCase()) return undefined;
    const distance = editDistance(name.toLowerCase(), other.toLowerCase(), most);
    if (distance < bestDistance) {
      best = other;
      bestDistance = distance;
      tied = false;
    } else if (distance === bestDistance) tied = true;
  }
  return tied ? undefined : best;
}

/** Letters to change, add, take out or swap to make `a` into `b`; past `most`, more than it. */
function editDistance(a: string, b: string, most: number): number {
  if (Math.abs(a.length - b.length) > most) return most + 1;
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const row = rows[i] as number[];
      const up = rows[i - 1] as number[];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        (up[j] as number) + 1,
        (row[j - 1] as number) + 1,
        (up[j - 1] as number) + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        value = Math.min(value, ((rows[i - 2] as number[])[j - 2] as number) + 1);
      row[j] = value;
    }
  }
  return (rows[a.length] as number[])[b.length] as number;
}
