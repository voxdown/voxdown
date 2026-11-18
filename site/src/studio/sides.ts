import { type FountainDocument, type FountainElement, parseFountain } from "./fountain";
import { fountainRuns } from "./inline";
import { screenplayInsights } from "./insights";
import { type ScreenplayLayout, layoutScreenplay } from "./layout";
import { readSource } from "./source";

export interface ActorSidesSegment {
  heading: string;
  line: number;
  endLine: number;
  /** Actual speaking cue blocks for this role, not every cue appearing in the scene. */
  cues: number;
  beforeFirstScene: boolean;
}
export interface ActorSidesResult {
  character: string;
  title: string;
  segments: ActorSidesSegment[];
  layout: ScreenplayLayout;
  warnings: string[];
}
export interface ActorSidesProject {
  characters: { name: string; segments: number; cues: number }[];
  hasScriptTitle: boolean;
  build(
    character: string,
    paper?: "letter" | "a4",
    options?: { includeScriptTitle?: boolean },
  ): ActorSidesResult;
}

const privateKinds = new Set(["title", "note", "boneyard", "section", "synopsis"]);
const identity = (name: string) => name.trim().replace(/\s+/gu, " ").normalize("NFC").toUpperCase();
const plain = (text: string) =>
  fountainRuns(text)
    .map((run) => run.text)
    .join("");
const literal = (text: string) => text.replace(/[\\*_]/g, "\\$&");
const synthetic = (kind: "scene" | "page-break", text: string): FountainElement => ({
  kind,
  text,
  from: 0,
  to: 0,
  line: 0,
});

/** Parse one immutable source snapshot and prepare a reusable cast/segment index.
 * Only nonempty dialogue/lyrics count as speaking. A cue with just a parenthetical
 * does not silently select a scene. Source is never reconstructed or modified.
 */
export function prepareActorSides(source: string): ActorSidesProject {
  readSource(source);
  const document = parseFountain(source);
  if (document.warnings.length)
    throw new Error(
      "Close incomplete private notes or omitted passages before exporting actor sides.",
    );
  const cast = screenplayInsights(document, source).characters;
  const names = new Map(cast.map((entry) => [identity(entry.name), entry.name]));
  const cueNames = new Map<number, string>();
  for (const character of cast)
    for (const line of character.lines) cueNames.set(line, identity(character.name));
  type Segment = {
    heading: string;
    line: number;
    endLine: number;
    elements: FountainElement[];
    roles: Map<string, Set<number>>;
    beforeFirstScene: boolean;
  };
  const segments: Segment[] = [];
  let segment: Segment = {
    heading: "Before the first scene",
    line: 1,
    endLine: 1,
    elements: [],
    roles: new Map(),
    beforeFirstScene: true,
  };
  segments.push(segment);
  let active: { key: string; line: number } | undefined;
  for (const element of document.elements) {
    if (element.kind === "scene") {
      segment = {
        heading: plain(element.text),
        line: element.line,
        endLine: element.line,
        elements: [],
        roles: new Map(),
        beforeFirstScene: false,
      };
      segments.push(segment);
    }
    segment.elements.push(element);
    segment.endLine = element.line;
    if (element.kind === "character") {
      const key = cueNames.get(element.line);
      active = key ? { key, line: element.line } : undefined;
    } else if (element.kind === "dialogue" || element.kind === "lyric") {
      if (active && plain(element.text).trim()) {
        let cues = segment.roles.get(active.key);
        if (!cues) {
          cues = new Set();
          segment.roles.set(active.key, cues);
        }
        cues.add(active.line);
      }
    } else if (!["parenthetical", "note", "boneyard"].includes(element.kind)) active = undefined;
  }
  const totals = new Map<string, { name: string; segments: number; cues: number }>();
  for (const entry of segments) {
    for (const [key, cues] of entry.roles) {
      let total = totals.get(key);
      if (!total) {
        total = { name: names.get(key) ?? key, segments: 0, cues: 0 };
        totals.set(key, total);
      }
      total.segments++;
      total.cues += cues.size;
    }
  }
  const characters = [...totals.values()];
  return {
    // These are display values only; mutating them cannot alter the captured AST.
    characters: characters.map((entry) => ({ ...entry })),
    hasScriptTitle: Boolean(document.title.title?.trim()),
    build(character, paper = "letter", options = {}) {
      const key = identity(character);
      const role = totals.get(key);
      if (!role) throw new Error("Choose a character with spoken dialogue in this snapshot.");
      if (role.name.length > 200)
        throw new Error(
          "This character name is too long for an actor-sides cover. Shorten the cue name to 200 characters or fewer.",
        );
      const selected = segments.filter((entry) => entry.roles.has(key));
      const title = `${role.name} — actor sides`;
      const titleFields: Record<string, string> = Object.create(null);
      titleFields.title = literal(title);
      titleFields.credit =
        "Complete scenes for rehearsal\nRepaginated; not original screenplay pages\nIncludes other characters for context";
      if (options.includeScriptTitle && document.title.title)
        titleFields.source = literal(plain(document.title.title));
      const elements: FountainElement[] = [];
      for (const [index, entry] of selected.entries()) {
        if (index) elements.push(synthetic("page-break", ""));
        if (entry.beforeFirstScene) elements.push(synthetic("scene", "BEFORE THE FIRST SCENE"));
        for (const element of entry.elements)
          if (!privateKinds.has(element.kind)) elements.push({ ...element });
      }
      const packet: FountainDocument = {
        elements,
        title: titleFields,
        warnings: [],
        omissions: [],
      };
      const layout = layoutScreenplay(packet, paper);
      return {
        character: role.name,
        title,
        segments: selected.map((entry) => ({
          heading: entry.heading,
          line: entry.line,
          endLine: entry.endLine,
          cues: entry.roles.get(key)?.size ?? 0,
          beforeFirstScene: entry.beforeFirstScene,
        })),
        layout,
        warnings: [
          "Pages are repaginated, not locked to the original screenplay. Each selected segment starts on a new page.",
          "Complete scenes include other characters and action for context. Private notes, outlines and original author/contact fields are excluded.",
          ...layout.warnings,
        ],
      };
    },
  };
}
