/** Bounded display-only token comparison. Every output segment retains literal source. */
export interface WordSegment {
  text: string;
  changed: boolean;
}
export interface WordComparison {
  before: WordSegment[];
  after: WordSegment[];
}
const MAX_CHARACTERS = 4096;
const MAX_TOKENS = 200;
const MAX_CELLS = 40_000;
export function compareWords(before: string, after: string): WordComparison | undefined {
  if (before.length > MAX_CHARACTERS || after.length > MAX_CHARACTERS) return;
  const tokens = (value: string) =>
    value.match(/\s+|[\p{L}\p{N}\p{M}]+|[^\s\p{L}\p{N}\p{M}]+/gu) ?? [];
  const a = tokens(before);
  const b = tokens(after);
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS || (a.length + 1) * (b.length + 1) > MAX_CELLS)
    return;
  const width = b.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i * width + j] =
        a[i] === b[j]
          ? 1 + (table[(i + 1) * width + j + 1] ?? 0)
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
  const result: WordComparison = { before: [], after: [] };
  function append(side: WordSegment[], text: string, changed: boolean) {
    const last = side.at(-1);
    if (last?.changed === changed) last.text += text;
    else side.push({ text, changed });
  }
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      append(result.before, a[i] ?? "", false);
      append(result.after, b[j] ?? "", false);
      i++;
      j++;
    } else if (
      i < a.length &&
      (j === b.length || (table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0))
    ) {
      append(result.before, a[i++] ?? "", true);
    } else append(result.after, b[j++] ?? "", true);
  }
  return result;
}
