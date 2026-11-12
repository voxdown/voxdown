/**
 * An edit's marks, no more than needed: after giving a passage to someone or saying how it is
 * said, a mark on the lines it touched that changes nothing (`@Wanda “Fine!” @Wanda “Hm.”`, the
 * second `@Wanda` saying again who already speaks) is taken out. A mark is taken out only if,
 * without it, every word is heard as before: by the same voice, said the same way.
 */
import { type Story, type TextChange, applyChanges, diffChanges, lines, parse } from "voxdown";

/**
 * Everything heard, in order, by whom and how: each character of speech by itself, so that a
 * mark which only cuts one voice's words in two (`@Ann She said @Ann hello`) changes nothing.
 */
const heard = (story: Story) =>
  lines(story)
    .flatMap((line) =>
      line.kind === "speech"
        ? [...line.text.replace(/\s+/g, "")].map(
            (char) => `${line.speaker}|${line.direction}|${char}`,
          )
        : [`${line.kind}|${line.speaker}|${line.direction}|${line.text}|${line.name}`],
    )
    .join("\n");

/** `changes` made to `story`, with the marks they leave that change nothing taken out too. */
export function withoutSpareMarks(story: Story, changes: readonly TextChange[]): TextChange[] {
  if (changes.length === 0) return [...changes];
  const first = applyChanges(story.source, changes);
  const wanted = heard(parse(first));
  // Again and again: a mark taken out can leave another saying nothing (`@Bob @() cb` once the
  // name's own direction has gone).
  let source = first;
  for (let pass = 0; pass < 4; pass++) {
    const next = merged(story.source, sparePass(story.source, source, wanted), wanted);
    if (next === source) break;
    source = next;
  }
  return source === first ? [...changes] : diffChanges(story.source, source);
}

/** The lines the edit touched, in the text it makes: from the first changed to the last. */
function touched(original: string, source: string): { from: number; to: number } {
  let start = 0;
  while (start < source.length && source[start] === original[start]) start++;
  let end = 0;
  while (
    end < source.length - start &&
    end < original.length - start &&
    source[source.length - 1 - end] === original[original.length - 1 - end]
  )
    end++;
  const from = source.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = source.indexOf("\n", source.length - end);
  return { from, to: lineEnd < 0 ? source.length : lineEnd };
}

/** The marks in the touched lines (names, directions, `@/`). */
function marksIn(source: string, original: string) {
  const { from, to } = touched(original, source);
  return parse(source)
    .blocks.flatMap((block) => (block.kind === "paragraph" ? block.lines : []))
    .flatMap((line) => line.items)
    .filter(
      (item): item is Extract<typeof item, { kind: "mark" | "direction" | "end" }> =>
        (item.kind === "mark" || item.kind === "direction" || item.kind === "end") &&
        item.range.from >= from &&
        item.range.to <= to,
    );
}

/** One sweep: each mark that changes nothing heard taken out, the last first. */
function sparePass(original: string, text: string, wanted: string): string {
  let source = text;
  const items = marksIn(source, original);
  // Each mark whole, and a name's own direction alone (`@Gerald (softly) @(sadly)`: the softly
  // says nothing), each with the space after it, never the words.
  const marks = [
    ...items.map((item) => ({
      from: item.range.from,
      to: source[item.range.to] === " " ? item.range.to + 1 : item.range.to,
    })),
    ...items.flatMap((item) =>
      item.kind === "mark" && item.directionRange
        ? [{ from: item.nameRange.to, to: item.directionRange.to }]
        : [],
    ),
  ].sort((a, b) => b.from - a.from || a.to - b.to);
  let reach = Number.POSITIVE_INFINITY;
  for (const mark of marks) {
    // A place already changed by a mark taken out after it waits for the next sweep.
    if (mark.to > reach) continue;
    const without = applyChanges(source, [{ from: mark.from, to: mark.to, insert: "" }]);
    if (heard(parse(without)) !== wanted) continue;
    source = without;
    reach = mark.from;
  }
  return source;
}

/** A name and the direction straight after it as one mark: `@Ann @(loudly)` is `@Ann (loudly)`. */
function merged(original: string, text: string, wanted: string): string {
  let source = text;
  const items = marksIn(source, original).sort((a, b) => b.range.from - a.range.from);
  for (const item of items) {
    if (item.kind !== "direction" || !item.direction) continue;
    // The name straight before it: before it, and only spaces between.
    const name = items.find(
      (other) =>
        other.kind === "mark" &&
        !other.directionRange &&
        other.range.to <= item.range.from &&
        /^[ \t]*$/.test(source.slice(other.range.to, item.range.from)),
    );
    if (!name || name.kind !== "mark") continue;
    const joined = applyChanges(source, [
      // ` @(` becomes ` (`: the `@` and the space before it go, one space stays.
      { from: name.range.to, to: item.range.from + 1, insert: " " },
    ]);
    if (heard(parse(joined)) !== wanted) continue;
    source = joined;
  }
  return source;
}
