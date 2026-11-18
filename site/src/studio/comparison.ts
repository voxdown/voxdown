/** Display-only comparison. The caller must retain original sources for restoration. */
export type ComparisonRange = { from: number; to: number; lineFrom: number; lineTo: number };
export type ComparisonChange = { saved: ComparisonRange; current: ComparisonRange };
export type SourceComparison = {
  saved: string;
  current: string;
} & (
  | {
      status: "complete";
      added: number;
      removed: number;
      unchanged: number;
      changes: ComparisonChange[];
    }
  | { status: "too-large" }
);
const MAX_CHARACTERS = 500_000;
const MAX_LINES = 20_000;
const MAX_WORK = 2_000_000;
const MAX_TRACE = 1_000_000;

/** Bounded Myers shortest edit script, with common edges removed before searching. */
export function compareSources(savedSource: string, currentSource: string): SourceComparison {
  const saved = savedSource.replace(/\r\n?/g, "\n");
  const current = currentSource.replace(/\r\n?/g, "\n");
  const fallback: SourceComparison = { status: "too-large", saved, current };
  if (saved.length > MAX_CHARACTERS || current.length > MAX_CHARACTERS) return fallback;
  const a = saved ? saved.split("\n") : [];
  const b = current ? current.split("\n") : [];
  if (a.length > MAX_LINES || b.length > MAX_LINES) return fallback;
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - suffix - 1] === b[b.length - suffix - 1]
  )
    suffix++;
  const n = a.length - prefix - suffix;
  const m = b.length - prefix - suffix;
  const trace: Int32Array[] = [];
  let work = 0;
  let cells = 0;
  let found = false;
  const operations: string[] = [];
  if (!n || !m) {
    operations.push(...Array<string>(n).fill("-"), ...Array<string>(m).fill("+"));
    found = true;
  } else {
    for (let d = 0; d <= n + m; d++) {
      cells += 2 * d + 1;
      if (cells > MAX_TRACE) return fallback;
      const layer = new Int32Array(2 * d + 1);
      const previous = trace[d - 1];
      for (let k = -d; k <= d; k += 2) {
        if (++work > MAX_WORK) return fallback;
        const left = previous?.[k - 1 + d - 1] ?? -1;
        const right = previous?.[k + 1 + d - 1] ?? -1;
        let x = d === 0 ? 0 : k === -d || (k !== d && left < right) ? right : left + 1;
        let y = x - k;
        while (x < n && y < m && a[prefix + x] === b[prefix + y]) {
          if (++work > MAX_WORK) return fallback;
          x++;
          y++;
        }
        layer[k + d] = x;
        if (x >= n && y >= m) {
          trace.push(layer);
          found = true;
          break;
        }
      }
      if (found) break;
      trace.push(layer);
    }
    if (!found) return fallback;
    let x = n;
    let y = m;
    for (let d = trace.length - 1; d > 0; d--) {
      const previous = trace[d - 1];
      if (!previous) return fallback;
      const k = x - y;
      const left = previous[k - 1 + d - 1] ?? -1;
      const right = previous[k + 1 + d - 1] ?? -1;
      const previousK = k === -d || (k !== d && left < right) ? k + 1 : k - 1;
      const previousX = previous[previousK + d - 1] ?? 0;
      const previousY = previousX - previousK;
      while (x > previousX && y > previousY) {
        operations.push("=");
        x--;
        y--;
      }
      if (x === previousX) {
        operations.push("+");
        y--;
      } else {
        operations.push("-");
        x--;
      }
    }
    while (x > 0 && y > 0) {
      operations.push("=");
      x--;
      y--;
    }
    operations.reverse();
  }
  const starts = (lines: string[]) => {
    const offsets = [0];
    for (const line of lines) offsets.push((offsets.at(-1) ?? 0) + line.length + 1);
    return offsets;
  };
  const aStarts = starts(a);
  const bStarts = starts(b);
  const range = (offsets: number[], from: number, to: number, length: number): ComparisonRange => ({
    from: Math.min(offsets[from] ?? length, length),
    to: Math.min(offsets[to] ?? length, length),
    lineFrom: from + 1,
    lineTo: to,
  });
  let ai = prefix;
  let bi = prefix;
  let added = 0;
  let removed = 0;
  let unchanged = prefix + suffix;
  const changes: ComparisonChange[] = [];
  for (let i = 0; i < operations.length; ) {
    if (operations[i] === "=") {
      ai++;
      bi++;
      unchanged++;
      i++;
      continue;
    }
    const aFrom = ai;
    const bFrom = bi;
    while (i < operations.length && operations[i] !== "=") {
      if (operations[i] === "-") {
        ai++;
        removed++;
      } else {
        bi++;
        added++;
      }
      i++;
    }
    changes.push({
      saved: range(aStarts, aFrom, ai, saved.length),
      current: range(bStarts, bFrom, bi, current.length),
    });
  }
  return { status: "complete", saved, current, added, removed, unchanged, changes };
}
