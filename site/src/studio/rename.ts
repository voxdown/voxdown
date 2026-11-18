/** A previewable, atomic rename of character cues, never a global text replacement. */
import { parseFountain } from "./fountain";
import { screenplayInsights } from "./insights";
import { readSource } from "./source";

export interface CharacterRenameChange {
  /** UTF-16 offsets into the exact source supplied to the planner. */
  from: number;
  to: number;
  insert: string;
}

export interface CharacterRenamePlan {
  /** Source-ordered, non-overlapping changes; dispatch all in one editor transaction. */
  changes: CharacterRenameChange[];
  preview: { line: number; before: string; after: string }[];
  skipped: { line: number; reason: "private-comment" | "formatted-or-escaped-name" }[];
  /** The chosen name already identifies another cast member; show this before applying. */
  targetAlreadyExists: boolean;
  /** Exact resulting source, useful for confirmation and testing; never normalized. */
  candidate: string;
}

function identity(name: string): string {
  return name.trim().replace(/\s+/gu, " ").normalize("NFC").toUpperCase();
}

function destination(name: string): string {
  if (
    !name ||
    name.length > 200 ||
    name !== name.trim() ||
    !/[\p{L}\p{N}]/u.test(name) ||
    /[^\p{L}\p{M}\p{N} .'’‐‑–—-]/u.test(name)
  ) {
    throw new Error(
      "Use a character name of up to 200 characters: letters, numbers, spaces, apostrophes, periods or hyphens. Leave out Fountain markers and performance extensions.",
    );
  }
  return name;
}

/** Locate the literal name while preserving leading whitespace, @, extensions,
 * a simultaneous-dialogue marker, and trailing whitespace byte for byte.
 * Extension stripping mirrors the cast index, including repeated (V.O.) (CONT'D).
 */
function nameRange(raw: string, dual: boolean): { from: number; to: number } {
  let from = raw.search(/[^\s]/u);
  if (from < 0) return { from: 0, to: 0 };
  if (raw[from] === "@") {
    from++;
    while (from < raw.length && /\s/u.test(raw[from] ?? "")) from++;
  }
  let to = raw.length;
  while (to > from && /\s/u.test(raw[to - 1] ?? "")) to--;
  if (dual && raw[to - 1] === "^") {
    to--;
    while (to > from && /\s/u.test(raw[to - 1] ?? "")) to--;
  }
  while (raw[to - 1] === ")") {
    let opening = to - 2;
    while (opening >= from && raw[opening] !== "(" && raw[opening] !== ")") opening--;
    if (opening < from || raw[opening] !== "(") break;
    to = opening;
    while (to > from && /\s/u.test(raw[to - 1] ?? "")) to--;
  }
  return { from, to };
}

/** Throws on invalid names, malformed private passages, size limits, or a rename
 * that would change Fountain interpretation. Call again against current source
 * immediately before applying; a preview must not authorize edits to a new revision.
 */
export function planCharacterRename(
  source: string,
  oldName: string,
  newName: string,
): CharacterRenamePlan {
  readSource(source);
  const replacement = destination(newName);
  if (!oldName.trim() || oldName.length > 500 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(oldName))
    throw new Error("Choose an existing character name from this screenplay.");
  const document = parseFountain(source);
  if (document.warnings.length)
    throw new Error("Close the incomplete private notes or omitted passages before renaming.");
  const cast = screenplayInsights(document, source).characters;
  const oldKey = identity(oldName);
  const newKey = identity(replacement);
  const character = cast.find((entry) => identity(entry.name) === oldKey);
  const plan: CharacterRenamePlan = {
    changes: [],
    preview: [],
    skipped: [],
    targetAlreadyExists: newKey !== oldKey && cast.some((entry) => identity(entry.name) === newKey),
    candidate: source,
  };
  let omissionIndex = 0;
  for (const line of character?.lines ?? []) {
    const element = document.elements[line - 1];
    if (!element || element.kind !== "character") continue;
    while ((document.omissions[omissionIndex]?.to ?? Number.POSITIVE_INFINITY) <= element.from)
      omissionIndex++;
    const omission = document.omissions[omissionIndex];
    if (omission && omission.from < element.to && omission.to > element.from) {
      plan.skipped.push({ line, reason: "private-comment" });
      continue;
    }
    const raw = source.slice(element.from, element.to);
    const range = nameRange(raw, Boolean(element.dual));
    const literal = raw.slice(range.from, range.to);
    // Cast identities use rendered emphasis/escapes; don't guess how to rewrite
    // their source representation. Leave those cues visible in the skipped list.
    if (identity(literal) !== oldKey || /[\\*_]/u.test(literal)) {
      plan.skipped.push({ line, reason: "formatted-or-escaped-name" });
      continue;
    }
    if (literal === replacement) continue;
    plan.changes.push({
      from: element.from + range.from,
      to: element.from + range.to,
      insert: replacement,
    });
    plan.preview.push({
      line,
      before: raw,
      after: raw.slice(0, range.from) + replacement + raw.slice(range.to),
    });
  }
  if (!plan.changes.length) return plan;
  const parts: string[] = [];
  const offsets: number[] = [];
  let cursor = 0;
  let delta = 0;
  for (const change of plan.changes) {
    parts.push(source.slice(cursor, change.from), change.insert);
    cursor = change.to;
    delta += change.insert.length - (change.to - change.from);
    offsets.push(delta);
  }
  parts.push(source.slice(cursor));
  plan.candidate = parts.join("");
  readSource(plan.candidate);
  const candidate = parseFountain(plan.candidate);
  const changedLines = new Set(plan.preview.map((entry) => entry.line));
  for (let index = 0; index < document.elements.length; index++) {
    const before = document.elements[index];
    const after = candidate.elements[index];
    if (
      !before ||
      !after ||
      before.kind !== after.kind ||
      before.dual !== after.dual ||
      (!changedLines.has(before.line) && before.text !== after.text)
    ) {
      throw new Error(
        `Renaming would change screenplay interpretation near line ${index + 1}. For unforced character cues, use an uppercase name that is not a scene heading or other Fountain instruction.`,
      );
    }
  }
  // Every edited cue must still belong to the requested cast identity.
  const renamed = screenplayInsights(candidate, plan.candidate).characters.find(
    (entry) => identity(entry.name) === newKey,
  );
  const renamedLines = new Set(renamed?.lines ?? []);
  if ([...changedLines].some((line) => !renamedLines.has(line)))
    throw new Error("The new name cannot be represented safely as a character cue.");
  const mapped = (position: number) => {
    let low = 0;
    let high = plan.changes.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((plan.changes[middle]?.to ?? Number.POSITIVE_INFINITY) <= position) low = middle + 1;
      else high = middle;
    }
    return position + (offsets[low - 1] ?? 0);
  };
  if (
    candidate.warnings.length ||
    candidate.omissions.length !== document.omissions.length ||
    document.omissions.some((before, index) => {
      const after = candidate.omissions[index];
      return (
        !after ||
        after.kind !== before.kind ||
        after.from !== mapped(before.from) ||
        after.to !== mapped(before.to) ||
        source.slice(before.from, before.to) !== plan.candidate.slice(after.from, after.to)
      );
    })
  )
    throw new Error("Renaming would alter a private passage. No changes were applied.");
  return plan;
}
