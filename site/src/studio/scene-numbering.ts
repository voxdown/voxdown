import { type FountainDocument, type FountainElement, parseFountain } from "./fountain";
import { assertUnambiguousOmissions } from "./public-source";
import { readSource } from "./source";
export type SceneNumberingMode = "unnumbered" | "renumber";
export type NumberingSkip = {
  line: number;
  reason: "private-comment" | "formatted-or-escaped" | "ambiguous-number";
};
export interface SceneNumberingSummary {
  scenes: number;
  eligible: number;
  numbered: number;
  skipped: NumberingSkip[];
  suggestedStart: number | undefined;
}
export interface SceneNumberingPlan {
  mode: SceneNumberingMode;
  start: number;
  changes: { from: number; to: number; insert: string }[];
  candidate: string;
  preview: { line: number; before: string; after: string; number: string }[];
  skipped: NumberingSkip[];
  preserved: number;
  warnings: string[];
}
type Heading = {
  element: FountainElement;
  from: number;
  to: number;
  eligible: boolean;
  raw: string;
};
function index(source: string) {
  readSource(source);
  const document = parseFountain(source);
  if (document.warnings.length)
    throw new Error("Close incomplete private notes or omitted passages before numbering scenes.");
  assertUnambiguousOmissions(source, document);
  const headings: Heading[] = [];
  const skipped: NumberingSkip[] = [];
  let cursor = 0;
  let highest = "0";
  for (const element of document.elements) {
    if (element.kind !== "scene") continue;
    if (element.sceneNumber && /^\d+$/.test(element.sceneNumber)) {
      const value = canonicalInteger(element.sceneNumber);
      if (value.length > highest.length || (value.length === highest.length && value > highest))
        highest = value;
    }
    while ((document.omissions[cursor]?.to ?? Number.POSITIVE_INFINITY) <= element.from) cursor++;
    const omission = document.omissions[cursor];
    const raw = source.slice(element.from, element.to);
    let reason: NumberingSkip["reason"] | undefined;
    if (omission && omission.from < element.to && omission.to > element.from)
      reason = "private-comment";
    else if (/[\\*_]/u.test(raw)) reason = "formatted-or-escaped";
    const end = raw.trimEnd().length;
    const marker = element.sceneNumber ? `#${element.sceneNumber}#` : "";
    if (marker && !raw.slice(0, end).endsWith(marker)) reason ??= "ambiguous-number";
    if (reason) skipped.push({ line: element.line, reason });
    headings.push({
      element,
      raw,
      eligible: !reason,
      from: element.from + (marker ? end - marker.length + 1 : end),
      to: element.from + (marker ? end - 1 : end),
    });
  }
  const suggestedStart =
    Number.isSafeInteger(Number(highest)) && Number(highest) < Number.MAX_SAFE_INTEGER
      ? Number(highest) + 1
      : undefined;
  return {
    document,
    headings,
    summary: {
      scenes: headings.length,
      eligible: headings.filter((h) => h.eligible).length,
      numbered: headings.filter((h) => h.element.sceneNumber !== undefined).length,
      skipped,
      suggestedStart,
    } satisfies SceneNumberingSummary,
  };
}
export function sceneNumberingSummary(source: string): SceneNumberingSummary {
  return index(source).summary;
}
const canonicalInteger = (value: string) => value.replace(/^0+/u, "") || "0";
const identity = (number: string) => (/^\d+$/.test(number) ? canonicalInteger(number) : number);
/** Assign explicit #N# labels in source order, retaining every unrelated byte.
 * Apply all changes atomically against this exact source revision only.
 */
export function planSceneNumbering(
  source: string,
  options: { mode: SceneNumberingMode; start?: number },
): SceneNumberingPlan {
  if (options.mode !== "unnumbered" && options.mode !== "renumber")
    throw new Error("Choose a scene numbering mode.");
  const { document, headings, summary } = index(source);
  const start = options.start ?? (options.mode === "renumber" ? 1 : summary.suggestedStart);
  if (start === undefined || !Number.isSafeInteger(start) || start < 1)
    throw new Error(
      "Choose a positive whole-number start up to 9,007,199,254,740,991. Existing large labels require an explicit starting number.",
    );
  const targets = headings.filter(
    (h) => h.eligible && (options.mode === "renumber" || h.element.sceneNumber === undefined),
  );
  const targeted = new Set(targets);
  const reserved = new Set<string>();
  let preserved = 0;
  let duplicates = 0;
  for (const heading of headings) {
    if (targeted.has(heading) || heading.element.sceneNumber === undefined) continue;
    const key = identity(heading.element.sceneNumber);
    if (reserved.has(key)) duplicates++;
    reserved.add(key);
    preserved++;
  }
  const plan: SceneNumberingPlan = {
    mode: options.mode,
    start,
    changes: [],
    candidate: source,
    preview: [],
    skipped: summary.skipped,
    preserved,
    warnings: [],
  };
  if (duplicates)
    plan.warnings.push(
      `${duplicates} duplicate existing labels remain on preserved headings. Newly assigned labels avoid all preserved labels.`,
    );
  if (summary.skipped.length)
    plan.warnings.push(
      `${summary.skipped.length} ambiguous, formatted or private-comment headings are skipped. Review them in source.`,
    );
  const labels = new Map<number, string>();
  let next = BigInt(start);
  const limit = BigInt(Number.MAX_SAFE_INTEGER);
  for (const heading of targets) {
    while (reserved.has(next.toString())) next++;
    if (next > limit)
      throw new Error(
        "Scene numbering would exceed the largest supported positive integer. Choose a smaller start.",
      );
    const number = next.toString();
    reserved.add(number);
    next++;
    labels.set(heading.element.line, number);
    if (heading.element.sceneNumber === number) continue;
    const insert = heading.element.sceneNumber === undefined ? ` #${number}#` : number;
    plan.changes.push({ from: heading.from, to: heading.to, insert });
    plan.preview.push({
      line: heading.element.line,
      before: heading.raw,
      after:
        heading.raw.slice(0, heading.from - heading.element.from) +
        insert +
        heading.raw.slice(heading.to - heading.element.from),
      number,
    });
  }
  const pieces: string[] = [];
  let cursor = 0;
  for (const change of plan.changes) {
    pieces.push(source.slice(cursor, change.from), change.insert);
    cursor = change.to;
  }
  pieces.push(source.slice(cursor));
  plan.candidate = pieces.join("");
  readSource(plan.candidate);
  const after = parseFountain(plan.candidate);
  const same = (a: FountainElement, b: FountainElement | undefined) =>
    !!b &&
    a.kind === b.kind &&
    a.text === b.text &&
    a.dual === b.dual &&
    a.level === b.level &&
    (labels.get(a.line) ?? a.sceneNumber) === b.sceneNumber;
  if (
    after.warnings.length ||
    document.elements.length !== after.elements.length ||
    document.elements.some((element, i) => !same(element, after.elements[i]))
  )
    throw new Error(
      "Numbering would change the interpretation of screenplay content. No changes applied.",
    );
  checkOmissions(source, plan.candidate, document, after, plan.changes);
  return plan;
}
function checkOmissions(
  source: string,
  candidate: string,
  before: FountainDocument,
  after: FountainDocument,
  changes: SceneNumberingPlan["changes"],
) {
  if (before.omissions.length !== after.omissions.length)
    throw new Error("Numbering would alter a private passage. No changes applied.");
  let cursor = 0;
  let delta = 0;
  for (let i = 0; i < before.omissions.length; i++) {
    const span = before.omissions[i];
    if (!span) continue;
    while (changes[cursor] && (changes[cursor]?.to ?? Number.POSITIVE_INFINITY) <= span.from) {
      const change = changes[cursor++];
      if (change) delta += change.insert.length - (change.to - change.from);
    }
    const other = after.omissions[i];
    if (
      !other ||
      other.kind !== span.kind ||
      other.from !== span.from + delta ||
      other.to !== span.to + delta ||
      source.slice(span.from, span.to) !== candidate.slice(other.from, other.to)
    )
      throw new Error("Numbering would alter a private passage. No changes applied.");
  }
}
