import { type FountainDocument, parseFountain } from "./fountain";
import { readSource } from "./source";

export type LocationExclusionReason =
  | "private-comment"
  | "formatted-or-escaped"
  | "unqualified-heading"
  | "ambiguous-time"
  | "ambiguous-location";
export interface LocationAppearance {
  line: number;
  heading: string;
  prefix: string;
  time?: string;
  number?: string;
}
export interface ScreenplayLocation {
  name: string;
  appearances: LocationAppearance[];
}
export interface LocationDirectory {
  locations: ScreenplayLocation[];
  excluded: { line: number; heading: string; reason: LocationExclusionReason }[];
  warnings: string[];
}
export interface LocationRenamePlan {
  changes: { from: number; to: number; insert: string }[];
  preview: { line: number; before: string; after: string }[];
  excluded: LocationDirectory["excluded"];
  targetAlreadyExists: boolean;
  candidate: string;
}
type Range = { from: number; to: number; name: string; appearance: LocationAppearance };
const identity = (name: string) => name.trim().replace(/\s+/gu, " ").normalize("NFC").toUpperCase();
const timeLabel =
  /^(?:(?:EARLY|LATE)\s+)?(?:DAY|NIGHT|DAWN|DUSK|MORNING|AFTERNOON|EVENING|SUNRISE|SUNSET|TWILIGHT|PRE-DAWN|MAGIC HOUR|LATER|CONTINUOUS|SAME TIME|MOMENTS LATER)(?:\s*\([^()]+\))?$/iu;
const unsafe = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\\[\]#*_@!~><=^]/u;
const prefixLike = /^(?:INT\.?\/EXT|EXT\.?\/INT|INT|EXT|EST|I\/E)(?:[. ]|$)/iu;
function validName(name: string): boolean {
  return Boolean(
    name &&
      name.length <= 200 &&
      name === name.trim() &&
      /[\p{L}\p{N}]/u.test(name) &&
      !unsafe.test(name) &&
      !prefixLike.test(name),
  );
}

function indexLocations(source: string, document: FountainDocument) {
  const directory: LocationDirectory = {
    locations: [],
    excluded: [],
    warnings: document.warnings.map((warning) => `Line ${warning.line}: ${warning.message}`),
  };
  const groups = new Map<string, ScreenplayLocation>();
  const ranges: Range[] = [];
  let omissionIndex = 0;
  for (const element of document.elements) {
    if (element.kind !== "scene") continue;
    const excluded = (reason: LocationExclusionReason) =>
      directory.excluded.push({ line: element.line, heading: element.text, reason });
    while ((document.omissions[omissionIndex]?.to ?? Number.POSITIVE_INFINITY) <= element.from)
      omissionIndex++;
    const omission = document.omissions[omissionIndex];
    if (omission && omission.from < element.to && omission.to > element.from) {
      excluded("private-comment");
      continue;
    }
    const raw = source.slice(element.from, element.to);
    if (/[\\*_]/u.test(raw)) {
      excluded("formatted-or-escaped");
      continue;
    }
    const prefix =
      /^[\s]*\.?((?:INT\.?\/EXT|EXT\.?\/INT|INT|EXT|EST|I\/E)(?:\.[ \t]*|[ \t]+))/iu.exec(raw);
    if (!prefix) {
      excluded("unqualified-heading");
      continue;
    }
    const from = prefix[0].length;
    let to = raw.trimEnd().length;
    if (element.sceneNumber) {
      const marker = `#${element.sceneNumber}#`;
      if (!raw.slice(0, to).endsWith(marker)) {
        excluded("ambiguous-location");
        continue;
      }
      to -= marker.length;
      while (to > from && /\s/u.test(raw[to - 1] ?? "")) to--;
    }
    let time: string | undefined;
    const content = raw.slice(from, to);
    const separators = [...content.matchAll(/[ \t]+-[ \t]+/g)];
    const last = separators.at(-1);
    if (last) {
      time = content.slice(last.index + last[0].length).trim();
      const previous = separators.at(-2);
      const stackedTime =
        previous &&
        timeLabel.test(content.slice(previous.index + previous[0].length, last.index).trim());
      if (!timeLabel.test(time) || stackedTime) {
        excluded("ambiguous-time");
        continue;
      }
      to = from + last.index;
    }
    while (to > from && /\s/u.test(raw[to - 1] ?? "")) to--;
    const name = raw.slice(from, to);
    if (!validName(name) || /^[/.]/u.test(name)) {
      excluded("ambiguous-location");
      continue;
    }
    const appearance: LocationAppearance = {
      line: element.line,
      heading: element.text,
      prefix: (prefix[1] ?? "").trim(),
      ...(time ? { time } : {}),
      ...(element.sceneNumber ? { number: element.sceneNumber } : {}),
    };
    ranges.push({ from: element.from + from, to: element.from + to, name, appearance });
    const key = identity(name);
    let group = groups.get(key);
    if (!group) {
      group = { name: name.trim().replace(/\s+/gu, " ").normalize("NFC"), appearances: [] };
      groups.set(key, group);
      directory.locations.push(group);
    }
    group.appearances.push(appearance);
  }
  return { directory, ranges };
}

/** Conservative directory: uncertain scene syntax stays visible in excluded headings. */
export function locationDirectory(source: string): LocationDirectory {
  readSource(source);
  return indexLocations(source, parseFountain(source)).directory;
}

/** Literal location spans only; never global replacement. The exact snapshot must
 * still be current when applying all changes in one isolated editor transaction.
 */
export function planLocationRename(
  source: string,
  oldName: string,
  newName: string,
): LocationRenamePlan {
  readSource(source);
  if (!validName(newName))
    throw new Error(
      "Use a location name of up to 200 characters without control characters, bidirectional controls or Fountain markers. Leave out INT/EXT prefixes, scene numbers and time suffixes.",
    );
  const document = parseFountain(source);
  if (document.warnings.length)
    throw new Error(
      "Close incomplete private notes or omitted passages before renaming locations.",
    );
  const { directory, ranges } = indexLocations(source, document);
  const oldKey = identity(oldName);
  const newKey = identity(newName);
  const plan: LocationRenamePlan = {
    changes: [],
    preview: [],
    excluded: directory.excluded,
    targetAlreadyExists:
      oldKey !== newKey &&
      directory.locations.some((location) => identity(location.name) === newKey),
    candidate: source,
  };
  for (const range of ranges) {
    if (identity(range.name) !== oldKey || range.name === newName) continue;
    const element = document.elements[range.appearance.line - 1];
    if (!element) continue;
    plan.changes.push({ from: range.from, to: range.to, insert: newName });
    plan.preview.push({
      line: element.line,
      before: source.slice(element.from, element.to),
      after: source.slice(element.from, range.from) + newName + source.slice(range.to, element.to),
    });
  }
  if (!plan.changes.length) return plan;
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
  const after = parseFountain(plan.candidate);
  const changed = new Set(plan.preview.map((entry) => entry.line));
  if (
    after.warnings.length ||
    after.elements.length !== document.elements.length ||
    document.elements.some((element, index) => {
      const next = after.elements[index];
      return (
        !next ||
        next.kind !== element.kind ||
        next.dual !== element.dual ||
        next.sceneNumber !== element.sceneNumber ||
        (!changed.has(element.line) && element.text !== next.text)
      );
    })
  )
    throw new Error("Renaming would change screenplay interpretation. No changes were applied.");
  const recognized = new Set(
    indexLocations(plan.candidate, after)
      .ranges.filter((range) => identity(range.name) === newKey)
      .map((range) => range.appearance.line),
  );
  if ([...changed].some((line) => !recognized.has(line)))
    throw new Error(
      "This name would make a location or time boundary ambiguous. Use a literal place name without a time suffix or INT/EXT prefix.",
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
    after.omissions.length !== document.omissions.length ||
    document.omissions.some((span, index) => {
      const next = after.omissions[index];
      return (
        !next ||
        next.kind !== span.kind ||
        next.from !== mapped(span.from) ||
        next.to !== mapped(span.to) ||
        source.slice(span.from, span.to) !== plan.candidate.slice(next.from, next.to)
      );
    })
  )
    throw new Error("Renaming would alter a private passage. No changes were applied.");
  return plan;
}
