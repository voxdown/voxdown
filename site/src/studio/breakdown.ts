import { type FountainElement, parseFountain } from "./fountain";
import { fountainRuns } from "./inline";
import { countWords, screenplayInsights } from "./insights";
import { assertUnambiguousOmissions } from "./public-source";
import { readSource } from "./source";

export interface BreakdownRole {
  readonly name: string;
  readonly speeches: number;
  readonly words: number;
  /** Explicit ^ cues with real speech; not a count of simultaneous pairs. */
  readonly dualCues: number;
}
export interface BreakdownScene {
  /** Snapshot-local occurrence; repeated headings remain separate. */
  readonly id: number;
  readonly heading: string;
  readonly number: string;
  readonly line: number;
  readonly beforeFirst: boolean;
  readonly roles: readonly BreakdownRole[];
  readonly dialogueWords: number;
  readonly actionWords: number;
  readonly speeches: number;
  readonly dualCues: number;
}
export interface BreakdownSummary {
  readonly scenes: number;
  readonly beforeFirst: number;
  readonly roles: number;
  readonly dialogueWords: number;
  readonly actionWords: number;
  readonly speeches: number;
  readonly dualCues: number;
}
export interface BreakdownReport {
  readonly rows: readonly BreakdownScene[];
  readonly summary: BreakdownSummary;
}
const plain = (text: string) =>
  fountainRuns(text)
    .map((run) => run.text)
    .join("");
const privateKinds = new Set(["note", "boneyard"]);
const bodyKinds = new Set(["dialogue", "parenthetical", "lyric"]);

export function summarizeBreakdown(rows: readonly BreakdownScene[]): BreakdownSummary {
  const names = new Set<string>();
  let scenes = 0;
  let beforeFirst = 0;
  let dialogueWords = 0;
  let actionWords = 0;
  let speeches = 0;
  let dualCues = 0;
  for (const row of rows) {
    if (row.beforeFirst) beforeFirst++;
    else scenes++;
    for (const role of row.roles) names.add(role.name);
    dialogueWords += row.dialogueWords;
    actionWords += row.actionWords;
    speeches += row.speeches;
    dualCues += row.dualCues;
  }
  return Object.freeze({
    scenes,
    beforeFirst,
    roles: names.size,
    dialogueWords,
    actionWords,
    speeches,
    dualCues,
  });
}

/** Public planning data from one bounded immutable source snapshot. Never retains
 * source, title/contact fields, outline text or private omissions. */
export function prepareBreakdown(source: string): BreakdownReport {
  readSource(source);
  const document = parseFountain(source);
  if (document.warnings.length)
    throw new Error(
      "Close unfinished private notes and omitted passages before preparing a breakdown.",
    );
  assertUnambiguousOmissions(source, document);
  const names = new Map<number, string>();
  for (const role of screenplayInsights(document, source).characters)
    for (const line of role.lines) names.set(line, role.name);
  type Mutable = {
    id: number;
    heading: string;
    number: string;
    line: number;
    beforeFirst: boolean;
    roles: Map<string, { name: string; speeches: number; words: number; dualCues: number }>;
    dialogueWords: number;
    actionWords: number;
    speeches: number;
    dualCues: number;
    content: boolean;
  };
  const make = (id: number, heading: string, number: string, line: number): Mutable => ({
    id,
    heading,
    number,
    line,
    beforeFirst: id === 0,
    roles: new Map(),
    dialogueWords: 0,
    actionWords: 0,
    speeches: 0,
    dualCues: 0,
    content: false,
  });
  const entries = [make(0, "Before the first scene", "", 1)];
  let current = entries[0] as Mutable;
  for (let i = 0; i < document.elements.length; i++) {
    const element = document.elements[i] as FountainElement;
    if (element.kind === "scene") {
      current = make(entries.length, plain(element.text), element.sceneNumber ?? "", element.line);
      entries.push(current);
    } else if (element.kind === "character") {
      if (plain(element.text).trim()) {
        if (!current.content && current.beforeFirst) current.line = element.line;
        current.content = true;
      }
      let words = 0;
      let spoken = false;
      let end = i + 1;
      for (; end < document.elements.length; end++) {
        const next = document.elements[end] as FountainElement;
        if (privateKinds.has(next.kind)) continue;
        if (!bodyKinds.has(next.kind)) break;
        const text = plain(next.text);
        if (text.trim()) {
          if (!current.content && current.beforeFirst) current.line = next.line;
          current.content = true;
        }
        if (next.kind === "dialogue" || next.kind === "lyric") {
          words += countWords(text);
          spoken ||= Boolean(text.trim());
        }
      }
      const name = names.get(element.line);
      if (spoken) {
        current.dialogueWords += words;
        current.speeches++;
        current.dualCues += Number(Boolean(element.dual));
      }
      if (spoken && name) {
        const role = current.roles.get(name) ?? { name, speeches: 0, words: 0, dualCues: 0 };
        role.speeches++;
        role.words += words;
        role.dualCues += Number(Boolean(element.dual));
        current.roles.set(name, role);
      }
      i = end - 1;
    } else if (["action", "centered", "transition", "lyric"].includes(element.kind)) {
      const text = plain(element.text);
      if (!text.trim()) continue;
      if (!current.content && current.beforeFirst) current.line = element.line;
      current.content = true;
      if (element.kind === "action" || element.kind === "centered")
        current.actionWords += countWords(text);
      // Uncued lyrics are still public spoken text, but never imply a speaking role.
      if (element.kind === "lyric") current.dialogueWords += countWords(text);
    }
  }
  const rows = Object.freeze(
    entries
      .filter((entry) => !entry.beforeFirst || entry.content)
      .map(({ content: _, roles, ...entry }) =>
        Object.freeze({
          ...entry,
          roles: Object.freeze([...roles.values()].map((role) => Object.freeze(role))),
        }),
      ),
  );
  return Object.freeze({ rows, summary: summarizeBreakdown(rows) });
}

/** Filters complete scene occurrences; totals retain all speech within matching scenes. */
export function filterBreakdown(
  report: BreakdownReport,
  filter: { query?: string; role?: string } = {},
): readonly BreakdownScene[] {
  const normalize = (text: string) => text.normalize("NFC").toLocaleLowerCase();
  const query = normalize(filter.query?.trim() ?? "");
  const role = normalize(filter.role?.trim() ?? "");
  return Object.freeze(
    report.rows.filter(
      (row) =>
        (!query || normalize(`${row.heading}\n${row.number}`).includes(query)) &&
        (!role || row.roles.some((member) => normalize(member.name).includes(role))),
    ),
  );
}

/** Prefix formula-like source fields before RFC4180 quoting. This is a safe
 * spreadsheet handoff, deliberately not a byte-exact source backup. */
export function spreadsheetCell(value: string): string {
  // Excel/LibreOffice may ignore leading Unicode whitespace and control/format
  // characters. Treat every such prefix conservatively, including a BOM.
  const probe = value.replace(/^[\s\p{Cc}\p{Cf}]*/u, "");
  const safe = /^[=+@-]/u.test(probe) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
export function breakdownCsv(rows: readonly BreakdownScene[]): string {
  const header = [
    "Occurrence",
    "Scene heading",
    "Explicit scene number",
    "Source line",
    "Speaking roles",
    "Speech blocks by role",
    "Dialogue words by role",
    "Explicit dual cues by role",
    "Speech blocks",
    "Dialogue words",
    "Action words",
    "Explicit dual cues",
  ];
  return `${[
    header,
    ...rows.map((row) => [
      row.beforeFirst ? "Before first scene" : String(row.id),
      row.heading,
      row.number,
      String(row.line),
      row.roles.map((role) => role.name).join("\n"),
      row.roles.map((role) => `${role.name}: ${role.speeches}`).join("\n"),
      row.roles.map((role) => `${role.name}: ${role.words}`).join("\n"),
      row.roles.map((role) => `${role.name}: ${role.dualCues}`).join("\n"),
      String(row.speeches),
      String(row.dialogueWords),
      String(row.actionWords),
      String(row.dualCues),
    ]),
  ]
    .map((cells) => cells.map(spreadsheetCell).join(","))
    .join("\r\n")}\r\n`;
}
