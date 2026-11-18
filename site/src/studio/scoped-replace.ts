import { parseFountain } from "./fountain";
import { MAX_SOURCE, readSource } from "./source";

export type ReplaceScope = "screenplay" | "scene" | "dialogue" | "action" | "selection";
export interface ReplaceOptions {
  query: string;
  replacement: string;
  scope: ReplaceScope;
  caseSensitive: boolean;
  wholeWord: boolean;
  position: number;
  selection: { from: number; to: number };
}
export interface ScopedReplacePlan {
  changes: { from: number; to: number; insert: string }[];
  candidate: string;
  matches: number;
  preview: { line: number; before: string; after: string }[];
}
export const MAX_REPLACE_CHANGES = 10_000;
export const MAX_REPLACE_QUERY = 1_000;
export const MAX_REPLACE_TEXT = 2_000;
const printable = new Set([
  "scene",
  "action",
  "character",
  "dialogue",
  "parenthetical",
  "transition",
  "centered",
  "lyric",
]);
const scopes = new Set<ReplaceScope>(["screenplay", "scene", "dialogue", "action", "selection"]);
const word = /[\p{L}\p{M}\p{N}_]/u;
function preceding(source: string, position: number) {
  if (position <= 0) return "";
  const last = source.charCodeAt(position - 1);
  const from = last >= 0xdc00 && last <= 0xdfff ? Math.max(0, position - 2) : position - 1;
  return source.slice(from, position);
}
function following(source: string, position: number) {
  const code = source.codePointAt(position);
  return code === undefined ? "" : String.fromCodePoint(code);
}
function validOffset(source: string, position: number) {
  return Number.isInteger(position) && position >= 0 && position <= source.length;
}

/** Literal source matching in printable elements. Never matches across a physical
 * line or private omission, and never silently applies a partial set of results. */
export function planScopedReplace(source: string, options: ReplaceOptions): ScopedReplacePlan {
  const original = readSource(source);
  if (
    !options.query ||
    options.query.length > MAX_REPLACE_QUERY ||
    options.replacement.length > MAX_REPLACE_TEXT ||
    [options.query, options.replacement].some((value) =>
      /[\r\n\u2028\u2029\0\uD800-\uDFFF]/u.test(value),
    )
  )
    throw new Error(
      "Use a single-line search of 1–1,000 characters and replacement of up to 2,000 characters. Line breaks, NUL and incomplete Unicode characters are not supported.",
    );
  if (!scopes.has(options.scope)) throw new Error("Choose a supported replacement scope.");
  const document = parseFountain(source);
  if (document.warnings.length)
    throw new Error(
      "Close unfinished private notes and omitted passages before scoped replacement.",
    );
  let from = 0;
  let to = source.length;
  if (options.scope === "selection") {
    ({ from, to } = options.selection);
    if (!validOffset(source, from) || !validOffset(source, to) || from >= to)
      throw new Error("Select a nonempty text range in the screenplay, then reopen Replace.");
  } else if (options.scope === "scene") {
    if (!validOffset(source, options.position))
      throw new Error("Place the caret inside a scene, then reopen Replace.");
    let scene: number | undefined;
    for (const element of document.elements) {
      if (element.from > options.position) break;
      if (element.kind === "scene") scene = element.from;
      else if (element.kind === "section") scene = undefined;
    }
    if (scene === undefined)
      throw new Error("Place the caret inside a scene, then reopen Replace.");
    from = scene;
    to =
      document.elements.find(
        (element) =>
          element.from > from && (element.kind === "scene" || element.kind === "section"),
      )?.from ?? source.length;
  }
  const starts = new Map(document.omissions.map((span) => [span.from, span.to]));
  const ends = new Map(document.omissions.map((span) => [span.to, span.from]));
  const wordBefore = (position: number) => {
    let cursor = position;
    while (ends.has(cursor)) {
      const previous = ends.get(cursor) as number;
      if (/[\r\n]/u.test(source.slice(previous, cursor))) return false;
      cursor = previous;
    }
    return word.test(preceding(source, cursor));
  };
  const wordAfter = (position: number) => {
    let cursor = position;
    while (starts.has(cursor)) {
      const next = starts.get(cursor) as number;
      if (/[\r\n]/u.test(source.slice(cursor, next))) return false;
      cursor = next;
    }
    return word.test(following(source, cursor));
  };
  const expression = new RegExp(
    options.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    options.caseSensitive ? "gu" : "giu",
  );
  const plan: ScopedReplacePlan = { changes: [], candidate: source, matches: 0, preview: [] };
  const changedLines = new Set<number>();
  let omissionIndex = 0;
  for (const element of document.elements) {
    if (
      !printable.has(element.kind) ||
      element.to <= from ||
      element.from >= to ||
      (options.scope === "dialogue" && element.kind !== "dialogue") ||
      (options.scope === "action" && element.kind !== "action")
    )
      continue;
    const low = Math.max(from, element.from);
    const high = Math.min(to, element.to);
    while ((document.omissions[omissionIndex]?.to ?? Number.POSITIVE_INFINITY) <= low)
      omissionIndex++;
    const ranges: { from: number; to: number }[] = [];
    let cursor = low;
    for (let index = omissionIndex; index < document.omissions.length; index++) {
      const omission = document.omissions[index];
      if (!omission || omission.from >= high) break;
      if (cursor < omission.from) ranges.push({ from: cursor, to: Math.min(omission.from, high) });
      cursor = Math.max(cursor, Math.min(high, omission.to));
    }
    if (cursor < high) ranges.push({ from: cursor, to: high });
    for (const range of ranges) {
      const text = source.slice(range.from, range.to);
      expression.lastIndex = 0;
      for (let match = expression.exec(text); match; match = expression.exec(text)) {
        const start = range.from + match.index;
        const end = start + match[0].length;
        if (options.wholeWord && (wordBefore(start) || wordAfter(end))) continue;
        plan.matches++;
        if (plan.matches > MAX_REPLACE_CHANGES)
          throw new Error(
            "More than 10,000 matches. Narrow the scope or search text; no partial replacement was prepared.",
          );
        if (match[0] === options.replacement) continue;
        plan.changes.push({ from: start, to: end, insert: options.replacement });
        changedLines.add(element.line);
        if (plan.preview.length < 50) {
          const left = text.slice(Math.max(0, match.index - 60), match.index);
          const right = text.slice(
            match.index + match[0].length,
            match.index + match[0].length + 60,
          );
          plan.preview.push({
            line: element.line,
            before: left + match[0] + right,
            after: left + options.replacement + right,
          });
        }
      }
    }
  }
  if (!plan.changes.length) return plan;
  const expansion = plan.changes.reduce(
    (sum, change) => sum + change.insert.length - (change.to - change.from),
    0,
  );
  if (original.normalized.length + expansion > MAX_SOURCE)
    throw new Error(
      "These replacements would exceed the 500,000-character screenplay limit. Narrow the search or shorten the replacement.",
    );
  const parts: string[] = [];
  const deltas: number[] = [];
  let cursor = 0;
  let delta = 0;
  for (const change of plan.changes) {
    parts.push(source.slice(cursor, change.from), change.insert);
    cursor = change.to;
    delta += change.insert.length - (change.to - change.from);
    deltas.push(delta);
  }
  parts.push(source.slice(cursor));
  plan.candidate = parts.join("");
  readSource(plan.candidate);
  const candidate = parseFountain(plan.candidate);
  if (
    candidate.warnings.length ||
    candidate.elements.length !== document.elements.length ||
    document.elements.some((before, index) => {
      const after = candidate.elements[index];
      return (
        !after ||
        before.kind !== after.kind ||
        before.dual !== after.dual ||
        before.level !== after.level ||
        before.sceneNumber !== after.sceneNumber ||
        (!changedLines.has(before.line) && before.text !== after.text)
      );
    })
  )
    throw new Error(
      "This replacement would change Fountain structure or leave an unfinished private passage. Use a narrower search or edit those lines directly.",
    );
  const mapped = (position: number) => {
    let low = 0;
    let high = plan.changes.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((plan.changes[middle]?.to ?? Number.POSITIVE_INFINITY) <= position) low = middle + 1;
      else high = middle;
    }
    return position + (deltas[low - 1] ?? 0);
  };
  if (
    candidate.omissions.length !== document.omissions.length ||
    document.omissions.some((before, index) => {
      const after = candidate.omissions[index];
      return (
        !after ||
        before.kind !== after.kind ||
        after.from !== mapped(before.from) ||
        after.to !== mapped(before.to) ||
        source.slice(before.from, before.to) !== plan.candidate.slice(after.from, after.to)
      );
    })
  )
    throw new Error(
      "This replacement would create, remove or change a private passage. No changes were prepared.",
    );
  return plan;
}
