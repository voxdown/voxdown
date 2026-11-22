import { SPEC_VERSION, lines, parse } from "voxdown";
import { parseFountain } from "./fountain";
import { fountainRuns } from "./inline";
import { screenplayInsights } from "./insights";
import { assertUnambiguousOmissions } from "./public-source";
import { readSource } from "./source";

export const MAX_ADAPTATION_BYTES = 4_000_000;
export interface VoxDownAdaptation {
  source: string;
  bytes: number;
  cast: { handle: string; name: string }[];
  spokenRows: number;
  dualCues: number;
  report: string[];
}
const plain = (value: string) =>
  fountainRuns(value)
    .map((run) => run.text)
    .join("");
const clean = (value: string) => value.replace(/\s+/gu, " ").trim();
const punctuation = /[!-/:-@[-`{-~“”‘’„‚«»‹›「」『』]/u;
/** Spec §11: escape every ASCII punctuation character and every supported quote.
 * In particular, '&' remains literal rather than starting an entity reference.
 */
function literal(value: string): string {
  let result = "";
  for (const char of value) {
    const code = char.codePointAt(0) as number;
    if (
      (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
      (code >= 0xd800 && code <= 0xdfff)
    )
      throw new Error(
        "Public text contains a control character or incomplete Unicode. Correct it before adapting.",
      );
    result += punctuation.test(char) ? `\\${char}` : char;
  }
  return result;
}
function extensions(cue: string): string[] {
  const parts: string[] = [];
  let end = cue.trimEnd().length;
  while (cue[end - 1] === ")") {
    let start = end - 2;
    while (start >= 0 && cue[start] !== "(" && cue[start] !== ")") start--;
    if (start < 0 || cue[start] !== "(") break;
    const value = clean(cue.slice(start + 1, end - 1));
    if (value) parts.unshift(value);
    end = start;
    while (end > 0 && /\s/u.test(cue[end - 1] ?? "")) end--;
  }
  return parts;
}
type Expected = { speaker: string; text: string; direction: string | null; heading: number | null };

/** An explicit public adaptation, not a source conversion or screenplay backup.
 * Callers must obtain acknowledgment of sequential dual delivery before download.
 */
export function adaptToVoxDown(
  source: string,
  options: { readSceneHeadings?: boolean } = {},
): VoxDownAdaptation {
  readSource(source);
  const document = parseFountain(source);
  if (document.warnings.length)
    throw new Error(
      "Close unfinished private notes and omitted passages before adapting to VoxDown.",
    );
  assertUnambiguousOmissions(source, document);
  const roleNames = new Map<number, string>();
  for (const role of screenplayInsights(document, source).characters)
    for (const line of role.lines) roleNames.set(line, role.name);
  const cast: VoxDownAdaptation["cast"] = [];
  const handles = new Map<string, string>();
  function handle(name: string) {
    let result = handles.get(name);
    if (!result) {
      literal(name);
      result = `Cast${cast.length + 1}`;
      handles.set(name, result);
      cast.push({ handle: result, name });
    }
    return result;
  }
  const expected: Expected[] = [];
  const headings: string[] = [];
  const body: string[] = [];
  let outputLength = 0;
  const append = (value: string) => {
    outputLength += value.length + 2;
    if (outputLength > MAX_ADAPTATION_BYTES / 2)
      throw new Error(
        "The adaptation is too large. Split this screenplay into smaller files before adapting.",
      );
    body.push(value);
  };
  const emit = (value: string, name?: string, direction?: string) => {
    const text = clean(value);
    if (!text) return;
    if (!/[\p{L}\p{N}]/u.test(text))
      throw new Error(
        "A public line contains only punctuation or symbols, which VoxDown does not emit as speech. Rewrite that line before adapting; nothing was prepared.",
      );
    const speaker = name ? handle(name) : "Narrator";
    const how = clean(direction ?? "") || null;
    const escaped = literal(text);
    append(
      name
        ? `@${speaker}${how ? ` (${literal(how)})` : ""} “${escaped}”`
        : `${how ? `@(${literal(how)}) ` : ""}${escaped}`,
    );
    expected.push({ speaker, text, direction: how, heading: null });
  };
  let active:
    | {
        name: string | undefined;
        extensions: string[];
        directions: string[];
        pending: boolean;
        lastParenthetical: boolean;
      }
    | undefined;
  const finish = () => {
    if (active?.pending)
      throw new Error(
        "A parenthetical has no following spoken words in its speech. Move or rewrite that direction before adapting; it cannot be transferred without losing meaning.",
      );
    active = undefined;
  };
  let transitions = 0;
  let pageBreaks = 0;
  let lyrics = 0;
  let centered = 0;
  let dualCues = 0;
  let sceneNumbers = 0;
  let blankDialogue = 0;
  for (const element of document.elements) {
    if (element.kind === "note" || element.kind === "boneyard") continue;
    if (element.kind === "character") {
      finish();
      active = {
        name: roleNames.get(element.line),
        extensions: extensions(plain(element.text)),
        directions: [],
        pending: false,
        lastParenthetical: false,
      };
      if (element.dual) dualCues++;
    } else if (element.kind === "parenthetical") {
      if (!active)
        throw new Error(
          "A speech direction has no identifiable character. Correct the cue before adapting.",
        );
      const value = clean(plain(element.text).slice(1, -1));
      if (!active.lastParenthetical) active.directions = [];
      if (value) active.directions.push(value);
      active.lastParenthetical = true;
      active.pending = Boolean(value) || active.pending;
    } else if (element.kind === "dialogue" || element.kind === "lyric") {
      const text = plain(element.text);
      if (element.kind === "dialogue" && !active?.name)
        throw new Error(
          "A spoken line has no identifiable character. Correct the cue before adapting.",
        );
      if (element.kind === "lyric") lyrics++;
      const direction = [
        ...(active?.extensions ?? []),
        ...(active?.directions ?? []),
        ...(element.kind === "lyric" ? ["sung"] : []),
      ].join("; ");
      emit(text, active?.name, direction);
      if (clean(text) && active) active.pending = false;
      if (!clean(text) && element.kind === "dialogue") blankDialogue++;
      if (active) active.lastParenthetical = false;
    } else {
      finish();
      if (element.kind === "scene") {
        const text = clean(plain(element.text));
        if (!text)
          throw new Error("A scene heading has no public text. Correct it before adapting.");
        headings.push(text);
        append(`## ${literal(text)}${options.readSceneHeadings ? "" : " {hidden}"}`);
        if (options.readSceneHeadings) {
          if (!/[\p{L}\p{N}]/u.test(text))
            throw new Error("A scene heading cannot be represented as spoken VoxDown text.");
          expected.push({ speaker: "Narrator", text, direction: null, heading: 2 });
        }
        if (element.sceneNumber !== undefined) sceneNumbers++;
      } else if (element.kind === "action" || element.kind === "centered") {
        emit(plain(element.text));
        if (element.kind === "centered") centered++;
      } else if (element.kind === "transition") transitions++;
      else if (element.kind === "page-break") pageBreaks++;
    }
  }
  finish();
  const front = ["---", `voxdown: ${SPEC_VERSION}`, "narrator: Narrator"];
  if (cast.length) {
    front.push("cast:");
    for (const member of cast) front.push(`  ${member.handle}: ${JSON.stringify(member.name)}`);
  }
  front.push("---");
  const result = `${front.join("\n")}\n\n${body.join("\n\n")}\n`;
  const bytes = new TextEncoder().encode(result).byteLength;
  if (bytes > MAX_ADAPTATION_BYTES)
    throw new Error("The adaptation exceeds 4 MB. Split this screenplay before adapting.");
  const story = parse(result);
  const actual = lines(story);
  const actualHeadings = story.blocks.filter((block) => block.kind === "heading");
  const invalid =
    story.warnings.length ||
    story.groups.length ||
    actual.length !== expected.length ||
    actual.some((row, index) => {
      const wanted = expected[index];
      return (
        !wanted ||
        row.kind !== "speech" ||
        row.together ||
        row.speaker !== wanted.speaker ||
        row.text !== wanted.text ||
        row.direction !== wanted.direction ||
        row.heading !== wanted.heading
      );
    }) ||
    story.cast.length !== cast.length ||
    story.cast.some(
      (member, index) => member.handle !== cast[index]?.handle || member.name !== cast[index]?.name,
    ) ||
    actualHeadings.length !== headings.length ||
    actualHeadings.some(
      (heading, index) =>
        heading.visibility !== (options.readSceneHeadings ? "both" : "hidden") ||
        heading.line.items
          .filter((item) => item.kind === "speech")
          .map((item) => item.text)
          .join("") !== headings[index],
    );
  if (invalid)
    throw new Error(
      "This screenplay could not be adapted without changing spoken words, attribution or directions. No VoxDown file was prepared. Keep the Fountain source and simplify the affected structure.",
    );
  const report = [
    `${expected.length} spoken ${expected.length === 1 ? "row" : "rows"} validated against the VoxDown core parser; ${cast.length} speaking ${cast.length === 1 ? "role uses" : "roles use"} deterministic Cast1, Cast2… handles with their original cast names. Action is narration; a character named Narrator remains a separate role.`,
    `${headings.length} scene ${headings.length === 1 ? "heading" : "headings"} ${headings.length === 1 ? "is" : "are"} ${options.readSceneHeadings ? "read by the narrator" : headings.length === 1 ? "a hidden label, not spoken" : "hidden labels, not spoken"}.`,
    `Private passages (${document.omissions.length}), all title fields including author/contact details, and all outline headings/summaries are excluded.`,
    "Narration and dialogue words and speaker attribution are preserved after Fountain rendering and whitespace normalization. Fountain emphasis is flattened; each nonempty physical spoken/action line becomes a separate VoxDown paragraph. Empty dialogue lines do not create timed pauses.",
    "Cue extensions and parentheticals become performance directions for following lines until another direction or cue. Consecutive parentheticals are combined. Lyric lines receive a sung direction. These instructions require performer review.",
    `${transitions} transitions, ${pageBreaks} page breaks, ${sceneNumbers} scene numbers and ${centered} centered layouts are not transferred. Margins, fonts, pagination and production revisions are not transferred.`,
    "This is an adaptation for voice performance, not a screenplay backup or reversible conversion. Keep your original Fountain file. Open the downloaded .vxd in VoxDown Writer yourself when ready.",
  ];
  if (dualCues)
    report.push(
      `${dualCues} dual-dialogue cues will be read in source order. Overlap/timing is lost. VoxDown's together (+) mark is not used: it means the same words spoken in unison, not different overlapping speeches. Explicit acknowledgment is required before downloading.`,
    );
  if (lyrics || blankDialogue)
    report.push(
      `${lyrics} lyric lines adapted; ${blankDialogue} intentional blank dialogue lines have no spoken words and no timed pause.`,
    );
  return { source: result, bytes, cast, spokenRows: expected.length, dualCues, report };
}
