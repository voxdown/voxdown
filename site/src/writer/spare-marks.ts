/**
 * An edit's marks, no more than needed: after giving a passage to someone or saying how it is
 * said, a mark on the lines it touched that changes nothing (`@Wanda “Fine!” @Wanda “Hm.”`, the
 * second `@Wanda` saying again who already speaks) is taken out. A mark is taken out only if,
 * without it, every word is heard as before: by the same voice, said the same way.
 */
import { type Story, type TextChange, applyChanges, lines, parse } from "voxdown";
import { composed } from "./changes";

/** Everything heard, in order, by whom and how. */
const heard = (story: Story) =>
  JSON.stringify(
    lines(story).map((line) => [line.kind, line.speaker, line.direction, line.text, line.name]),
  );

/** `changes` made to `story`, with the marks they leave that change nothing taken out too. */
export function withoutSpareMarks(story: Story, changes: readonly TextChange[]): TextChange[] {
  if (changes.length === 0) return [...changes];
  let source = applyChanges(story.source, changes);
  let after = parse(source);
  const wanted = heard(after);
  // The stretch of lines the edit touched, in the text it makes.
  let start = 0;
  while (start < source.length && source[start] === story.source[start]) start++;
  let end = 0;
  while (
    end < source.length - start &&
    end < story.source.length - start &&
    source[source.length - 1 - end] === story.source[story.source.length - 1 - end]
  )
    end++;
  const from = source.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = source.indexOf("\n", source.length - end);
  const to = lineEnd < 0 ? source.length : lineEnd;
  // The character marks there, the last first, so that taking one out moves none still to try.
  const marks = after.blocks
    .flatMap((block) => (block.kind === "paragraph" ? block.lines : []))
    .flatMap((line) => line.items)
    .filter((item) => item.kind === "mark" && item.range.from >= from && item.range.to <= to)
    .map((item) => item.range)
    .sort((a, b) => b.from - a.from);
  const spare: TextChange[] = [];
  for (const mark of marks) {
    // The mark and the space after it, never the words.
    const end = source[mark.to] === " " ? mark.to + 1 : mark.to;
    const without = applyChanges(source, [{ from: mark.from, to: end, insert: "" }]);
    const read = parse(without);
    if (heard(read) !== wanted) continue;
    spare.push({ from: mark.from, to: end, insert: "" });
    source = without;
    after = read;
  }
  return spare.length ? composed(story.source, changes, spare) : [...changes];
}
