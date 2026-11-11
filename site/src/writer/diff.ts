/**
 * Two versions of a story, line by line: what both have, what only the earlier one had, and what
 * only the later one has. The lines both share at the start and at the end are set aside first,
 * so a long book with a few changes is compared in the blink of an eye.
 */

export type DiffLine = { kind: "same" | "gone" | "new"; text: string };

/** Beyond this many changed lines, the middle is shown as taken away and written anew. */
const MOST_EDITS = 1500;

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split(/\r\n?|\n/);
  const b = after.split(/\r\n?|\n/);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  const same = (lines: string[]) => lines.map((text): DiffLine => ({ kind: "same", text }));
  const middleA = a.slice(start, a.length - end);
  const middleB = b.slice(start, b.length - end);
  const middle = myers(middleA, middleB) ?? pairUp(middleA, middleB);
  return [...same(a.slice(0, start)), ...middle, ...same(a.slice(a.length - end))];
}

/**
 * Too many changes to find the shortest way: as many lines on each side (a name changed all
 * through a book) are taken line for line; otherwise the one stretch went, the other came.
 */
function pairUp(a: readonly string[], b: readonly string[]): DiffLine[] {
  if (a.length !== b.length)
    return [
      ...a.map((text): DiffLine => ({ kind: "gone", text })),
      ...b.map((text): DiffLine => ({ kind: "new", text })),
    ];
  return a.flatMap((text, index): DiffLine[] => {
    const next = b[index] as string;
    return text === next
      ? [{ kind: "same", text }]
      : [
          { kind: "gone", text },
          { kind: "new", text: next },
        ];
  });
}

/** Two lines word by word: the words both have, those gone and those new, spaces kept. */
export function diffWords(before: string, after: string): DiffLine[] {
  const a = before.split(/(\s+)/).filter(Boolean);
  const b = after.split(/(\s+)/).filter(Boolean);
  const words = myers(a, b) ?? [
    { kind: "gone" as const, text: before },
    { kind: "new" as const, text: after },
  ];
  // Neighbours of a kind joined: fewer, longer stretches to read.
  const joined: DiffLine[] = [];
  for (const word of words) {
    const last = joined.at(-1);
    if (last && last.kind === word.kind) last.text += word.text;
    else joined.push({ ...word });
  }
  return joined;
}

export type CompareRow =
  | DiffLine
  | { kind: "skip"; count: number }
  | { kind: "changed"; parts: DiffLine[] };

/**
 * Lines taken away and as many put in straight after are the same lines changed: each shown once,
 * its words gone and new within it.
 */
export function withWords(
  rows: ReadonlyArray<DiffLine | { kind: "skip"; count: number }>,
): CompareRow[] {
  const out: CompareRow[] = [];
  for (let i = 0; i < rows.length; ) {
    let gone = 0;
    while (rows[i + gone]?.kind === "gone") gone++;
    let added = 0;
    while (rows[i + gone + added]?.kind === "new") added++;
    if (gone > 0 && gone === added) {
      for (let k = 0; k < gone; k++)
        out.push({
          kind: "changed",
          parts: diffWords((rows[i + k] as DiffLine).text, (rows[i + gone + k] as DiffLine).text),
        });
      i += gone * 2;
    } else if (gone + added > 0) {
      for (let k = 0; k < gone + added; k++) out.push(rows[i + k] as DiffLine);
      i += gone + added;
    } else {
      out.push(rows[i] as CompareRow);
      i++;
    }
  }
  return out;
}

/** The shortest way from `a` to `b` (Myers, 1986), or undefined past `MOST_EDITS` changes. */
function myers(a: readonly string[], b: readonly string[]): DiffLine[] | undefined {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= Math.min(max, MOST_EDITS); d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0));
      let x = down ? (v[offset + k + 1] ?? 0) : (v[offset + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return walkBack(trace, a, b);
    }
  }
  return undefined;
}

function walkBack(trace: readonly Int32Array[], a: readonly string[], b: readonly string[]) {
  const out: DiffLine[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = trace.length - 1; d >= 0; d--) {
    const before = trace[d] as Int32Array;
    const at = (k: number) => before[k + d + 1] ?? 0;
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const fromK = down ? k + 1 : k - 1;
    const fromX = d === 0 ? 0 : at(fromK);
    const fromY = d === 0 ? 0 : fromX - fromK;
    while (x > fromX && y > fromY) {
      out.push({ kind: "same", text: a[x - 1] as string });
      x--;
      y--;
    }
    if (d > 0) {
      if (down) out.push({ kind: "new", text: b[y - 1] as string });
      else out.push({ kind: "gone", text: a[x - 1] as string });
      x = fromX;
      y = fromY;
    }
  }
  return out.reverse();
}

/**
 * The changes with a little of what surrounds them: each long stretch of lines both share becomes
 * one line saying how many there are.
 */
export function changesOnly(
  lines: readonly DiffLine[],
  around = 2,
): Array<DiffLine | { kind: "skip"; count: number }> {
  const near = new Uint8Array(lines.length);
  lines.forEach((line, index) => {
    if (line.kind === "same") return;
    for (let i = Math.max(0, index - around); i <= Math.min(lines.length - 1, index + around); i++)
      near[i] = 1;
  });
  const out: Array<DiffLine | { kind: "skip"; count: number }> = [];
  let skipped = 0;
  lines.forEach((line, index) => {
    if (near[index]) {
      if (skipped) out.push({ kind: "skip", count: skipped });
      skipped = 0;
      out.push(line);
    } else skipped++;
  });
  if (skipped) out.push({ kind: "skip", count: skipped });
  return out;
}
