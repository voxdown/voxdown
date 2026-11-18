import { type FountainDocument, parseFountain } from "./fountain";
import { assertUnambiguousOmissions } from "./public-source";
import { readSource } from "./source";

export interface ProductionState {
  locked: boolean;
  reserved: string[];
  from?: number;
  to?: number;
}
export interface SceneNumberSuggestion {
  line: number;
  number: string;
  from: number;
  to: number;
  insert: string;
}
export interface ProductionPlan {
  changes: { from: number; to: number; insert: string }[];
  candidate: string;
}
const identity = (value: string) => (/^\d+$/.test(value) ? value.replace(/^0+/, "") || "0" : value);
const label = /^[\p{L}\p{N}.-]+$/u;
const ordinary = /^(\d+)([A-Z]*)$/;
const metadataError = () =>
  new Error(
    "Production numbering metadata is invalid or unsupported. Repair or remove its VoxDown production block before numbering scenes.",
  );
function checked(source: string, document?: FountainDocument): FountainDocument {
  readSource(source);
  const result = document ?? parseFountain(source);
  if (result.warnings.length)
    throw new Error("Close incomplete private notes or omitted passages before numbering scenes.");
  assertUnambiguousOmissions(source, result);
  return result;
}
/** The lock is portable Fountain source, hidden by an ordinary completed boneyard.
 * Unknown versions, partial blocks and multiple blocks fail closed rather than
 * silently allowing reserved production references to be reused. */
export function readProduction(source: string, document?: FountainDocument): ProductionState {
  readSource(source);
  const matches = [...source.matchAll(/\/\*[ \t]*VoxDown production\b/g)];
  if (!matches.length) return { locked: false, reserved: [] };
  if (matches.length !== 1) throw metadataError();
  const parsed = document ?? parseFountain(source);
  const from = matches[0]?.index;
  const span = parsed.omissions.find(
    (omission) => omission.from === from && omission.kind === "boneyard",
  );
  if (!span) throw metadataError();
  const raw = source.slice(span.from, span.to);
  const body = /^\/\* VoxDown production v1(?:\r\n|\n|\r)([^\r\n]+)(?:\r\n|\n|\r)\*\/$/.exec(raw);
  if (!body?.[1]) throw metadataError();
  let data: unknown;
  try {
    data = JSON.parse(body[1]);
  } catch {
    throw metadataError();
  }
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    Object.keys(data).length !== 1 ||
    !("reserved" in data) ||
    !Array.isArray(data.reserved)
  )
    throw metadataError();
  const reserved: string[] = [];
  const seen = new Set<string>();
  for (const item of data.reserved) {
    if (typeof item !== "string" || !label.test(item) || seen.has(identity(item)))
      throw metadataError();
    reserved.push(item);
    seen.add(identity(item));
  }
  return { locked: true, reserved, from: span.from, to: span.to };
}
function block(reserved: string[], newline: string) {
  return `/* VoxDown production v1${newline}${JSON.stringify({ reserved })}${newline}*/`;
}
function reserve(parsed: FountainDocument, state: ProductionState): string[] {
  const values = new Map(state.reserved.map((value) => [identity(value), value]));
  for (const element of parsed.elements) {
    if (element.kind === "scene" && element.sceneNumber !== undefined)
      values.set(
        identity(element.sceneNumber),
        values.get(identity(element.sceneNumber)) ?? element.sceneNumber,
      );
  }
  return [...values.values()];
}
function nextSuffix(suffix: string): string {
  const letters = [...suffix];
  for (let i = letters.length - 1; i >= 0; i--) {
    if (letters[i] !== "Z") {
      letters[i] = String.fromCharCode((letters[i]?.charCodeAt(0) ?? 64) + 1);
      return letters.join("");
    }
    letters[i] = "A";
  }
  return `A${letters.join("")}`;
}
/** Suggestions are view-only. Only a commit inserts a standard Fountain #label#.
 * Letter suffixes describe inserted scenes, not lexical sorting: between 15 and
 * 15A we use 15AA; between 15A and 15B likewise use 15AA. Existing references
 * remain untouched. Exotic or descending neighbours need an author decision. */
export function sceneNumberSuggestions(
  source: string,
  document?: FountainDocument,
): SceneNumberSuggestion[] {
  const parsed = checked(source, document);
  const production = readProduction(source, parsed);
  const headings = parsed.elements.filter((element) => element.kind === "scene");
  const reserved = new Set(reserve(parsed, production).map(identity));
  const following: (string | undefined)[] = new Array(headings.length);
  let next: string | undefined;
  for (let i = headings.length - 1; i >= 0; i--) {
    following[i] = next;
    next = headings[i]?.sceneNumber ?? next;
  }
  let previous: string | undefined;
  let previousSuggested = false;
  let omissionIndex = 0;
  const suggestions: SceneNumberSuggestion[] = [];
  for (const [i, heading] of headings.entries()) {
    if (heading.sceneNumber !== undefined) {
      previous = heading.sceneNumber;
      previousSuggested = false;
      continue;
    }
    while ((parsed.omissions[omissionIndex]?.to ?? Number.POSITIVE_INFINITY) <= heading.from)
      omissionIndex++;
    const omission = parsed.omissions[omissionIndex];
    const raw = source.slice(heading.from, heading.to);
    if ((omission && omission.from < heading.to) || /[\\*_]/u.test(raw)) continue;
    const before = previous === undefined ? ["", "0", ""] : ordinary.exec(previous);
    const after = following[i] === undefined ? undefined : ordinary.exec(following[i] ?? "");
    if (!before || (following[i] !== undefined && !after)) continue;
    const lower = BigInt(before[1] ?? "0");
    const upper = after ? BigInt(after[1] ?? "0") : undefined;
    if (upper !== undefined && upper < lower) continue;
    let number: string | undefined;
    // Prefer a whole number in the gap; never coerce large labels to Number.
    if (!before[2] || upper === undefined || upper > lower) {
      let integer = lower + 1n;
      while (reserved.has(integer.toString())) integer++;
      if (upper === undefined || integer < upper) number = integer.toString();
    }
    if (number === undefined && previous !== undefined) {
      let suffix = "A";
      let base = `${lower}`;
      const previousSuffix = before[2] ?? "";
      if (previousSuffix) {
        if (upper === lower && !previousSuggested) {
          base += previousSuffix;
        } else {
          suffix = nextSuffix(previousSuffix);
        }
      }
      // A preceding integer followed by its A scene needs a nested suffix.
      if (upper === lower && after?.[2]?.startsWith(`${previousSuffix}A`)) suffix = "AA";
      number = `${base}${suffix}`;
      while (reserved.has(number)) {
        suffix = nextSuffix(suffix);
        number = `${base}${suffix}`;
      }
    }
    if (!number) continue;
    reserved.add(identity(number));
    previous = number;
    previousSuggested = true;
    const at = heading.from + raw.trimEnd().length;
    suggestions.push({ line: heading.line, number, from: at, to: at, insert: ` #${number}#` });
  }
  return suggestions;
}
function plan(source: string, changes: ProductionPlan["changes"]): ProductionPlan {
  changes.sort((a, b) => a.from - b.from);
  const pieces: string[] = [];
  let cursor = 0;
  for (const change of changes) {
    pieces.push(source.slice(cursor, change.from), change.insert);
    cursor = change.to;
  }
  pieces.push(source.slice(cursor));
  const candidate = pieces.join("");
  checked(candidate);
  return { changes, candidate };
}
export function planLock(source: string, locked: boolean): ProductionPlan {
  const parsed = checked(source);
  const current = readProduction(source, parsed);
  if (!locked)
    return plan(
      source,
      current.locked
        ? [{ from: current.from as number, to: current.to as number, insert: "" }]
        : [],
    );
  const reserved = reserve(parsed, current);
  const newline = readSource(source).newline;
  const insert = block(reserved, newline);
  if (current.locked)
    return plan(
      source,
      source.slice(current.from, current.to) === insert
        ? []
        : [{ from: current.from as number, to: current.to as number, insert }],
    );
  return plan(source, [
    { from: source.length, to: source.length, insert: `${newline}${newline}${insert}` },
  ]);
}
/** Explicit recovery for unsupported/damaged locks. Keep all labels and comment
 * contents; only retire the recognized header. Unclosed comments still need repair. */
export function planReleaseProductionLock(source: string): ProductionPlan {
  readSource(source);
  const changes = [...source.matchAll(/\/\*[ \t]*(VoxDown production)\b/g)].map((match) => {
    const from = match.index + match[0].indexOf("VoxDown");
    return { from, to: from + "VoxDown production".length, insert: "Released lock" };
  });
  if (!changes.length) throw new Error("No production lock was found.");
  let candidate = source;
  for (const change of [...changes].reverse())
    candidate = candidate.slice(0, change.from) + change.insert + candidate.slice(change.to);
  readSource(candidate);
  return { changes, candidate };
}
/** Commit all current view-only suggestions in one atomic source transaction. */
export function planSuggestedSceneNumbers(source: string): ProductionPlan {
  const parsed = checked(source);
  return commit(source, parsed, sceneNumberSuggestions(source, parsed));
}
/** Keep externally assigned labels reserved when a locked heading is deleted. */
export function planReserveSceneNumbers(source: string, numbers: string[]): ProductionPlan {
  const parsed = checked(source);
  const current = readProduction(source, parsed);
  if (!current.locked) throw new Error("Scene numbers are not locked.");
  const reserved = new Map(reserve(parsed, current).map((value) => [identity(value), value]));
  for (const number of numbers) {
    if (!label.test(number)) throw metadataError();
    if (!reserved.has(identity(number))) reserved.set(identity(number), number);
  }
  const insert = block([...reserved.values()], readSource(source).newline);
  return plan(
    source,
    source.slice(current.from, current.to) === insert
      ? []
      : [{ from: current.from as number, to: current.to as number, insert }],
  );
}
export function planCommitSceneNumber(source: string, line: number): ProductionPlan {
  const parsed = checked(source);
  const suggestion = sceneNumberSuggestions(source, parsed).find((item) => item.line === line);
  if (!suggestion)
    throw new Error(
      "This scene has no safe number suggestion. Existing scene numbers are never replaced.",
    );
  return commit(source, parsed, [suggestion]);
}
function commit(
  source: string,
  parsed: FountainDocument,
  suggestions: SceneNumberSuggestion[],
): ProductionPlan {
  const current = readProduction(source, parsed);
  if (!suggestions.length) return { changes: [], candidate: source };
  const labels = new Map(suggestions.map((item) => [item.line, item.number]));
  const changes: ProductionPlan["changes"] = suggestions.map(({ from, to, insert }) => ({
    from,
    to,
    insert,
  }));
  if (current.locked) {
    const reserved = reserve(parsed, current);
    reserved.push(...suggestions.map((item) => item.number));
    changes.push({
      from: current.from as number,
      to: current.to as number,
      insert: block(reserved, readSource(source).newline),
    });
  }
  const result = plan(source, changes);
  const after = parseFountain(result.candidate);
  const beforePublic = parsed.elements.filter((element) => element.kind !== "blank");
  const afterPublic = after.elements.filter((element) => element.kind !== "blank");
  if (
    beforePublic.length !== afterPublic.length ||
    beforePublic.some((element, index) => {
      const other = afterPublic[index];
      return (
        !other ||
        element.kind !== other.kind ||
        element.text !== other.text ||
        (labels.get(element.line) ?? element.sceneNumber) !== other.sceneNumber
      );
    })
  )
    throw new Error("Numbering would change screenplay interpretation. No changes applied.");
  return result;
}
