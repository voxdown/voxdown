/**
 * Directing a reading with a model's help: what a model is asked (the story a passage at a time,
 * to be given back with marks added for how it is performed), and its answer read as suggestions
 * the writer chooses from. A model is asked to change no word; here that is made sure of. Each
 * paragraph it gives back is lined up with the paragraph as written, and kept only if all it did
 * was add marks (a direction, a pause, a stressed word, a sound, a sound a character makes) and
 * the paragraph still prints the same words, given to the same speakers, with the writer's own
 * marks still there. The marks are then put into the writer's own text, so a quote mark or a
 * space the model wrote differently changes nothing.
 */
import type { TextChange } from "./edit";
import type { Item, Paragraph, Range, Story } from "./model";
import { parse } from "./parse";
import { bookText } from "./readings";

/** A stretch of the story to ask about. */
export type DirectingPassage = {
  /** From 1. */
  index: number;
  /** The heading of the chapter or scene it is in, if any. */
  heading: string | null;
  /** Where it runs in the text, from its first paragraph to the end of its last. */
  from: number;
  to: number;
  /** The passage as written. */
  text: string;
  /** A little of what comes before it, as written, for context. */
  before: string;
  /** Its 1-based first line. */
  line: number;
};

/** What kind of mark a suggestion adds. */
export type SuggestionKind = "direction" | "pause" | "stress" | "sound" | "vocal";

/** A mark the model would add: one change to the text (a stressed word, two), to take or leave. */
export type Suggestion = {
  /** The same for the same mark in the same words, while the story changes elsewhere. */
  id: string;
  kind: SuggestionKind;
  /** The mark, as it would be written: `(softly)`, `{pause}`, `*never*`. */
  label: string;
  /** Its 1-based line in the story. */
  line: number;
  /** What it adds, to the story's text. */
  changes: TextChange[];
  /** Its line with it added, shortened around it, and where in that the mark is. */
  preview: { text: string; added: Array<[number, number]> };
  /** The paragraph it is in. */
  paragraph: Range;
};

/** A paragraph whose marks were left out, and why. */
export type Refusal = { line: number; words: string; why: string };

export type Directed = {
  suggestions: Suggestion[];
  refused: Refusal[];
  /** Paragraphs in reach that the answer didn't give back. */
  missing: number;
  /** Those paragraphs, each with its line and its first words. */
  missed: Refusal[];
};

/** About this many words a passage: enough to read a scene, little enough to give back whole. */
export const DIRECTING_WORDS = 1000;

const wordCount = (text: string) => text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;

/** The paragraphs that are heard, from `from` to `to`. */
function paragraphsIn(story: Story, from = 0, to = story.source.length): Paragraph[] {
  return story.blocks.filter(
    (block): block is Paragraph =>
      block.kind === "paragraph" &&
      block.visibility !== "book" &&
      block.range.to > from &&
      block.range.from < to,
  );
}

/**
 * The story's passages to ask about, from `from` to `to` (all of it if not given): its heard
 * paragraphs in order, a new passage at a chapter or scene heading once the one before has some
 * length, and at about `words` words.
 */
export function directingPassages(
  story: Story,
  options: { words?: number; from?: number; to?: number } = {},
): DirectingPassage[] {
  const limit = options.words ?? DIRECTING_WORDS;
  const from = options.from ?? 0;
  const to = options.to ?? story.source.length;
  const source = story.source;
  const passages: DirectingPassage[] = [];
  let group: Paragraph[] = [];
  let words = 0;
  let heading: string | null = null;
  let groupHeading: string | null = null;
  let previous = "";
  const flush = () => {
    const first = group[0];
    const last = group.at(-1);
    if (first && last) {
      const contextWords = previous.split(/\s+/).filter(Boolean);
      passages.push({
        index: passages.length + 1,
        heading: groupHeading,
        from: first.range.from,
        to: last.range.to,
        text: source.slice(first.range.from, last.range.to),
        before: contextWords.length > 150 ? `… ${contextWords.slice(-150).join(" ")}` : previous,
        line: source.slice(0, first.range.from).split("\n").length,
      });
      previous = source.slice(first.range.from, last.range.to);
    }
    group = [];
    words = 0;
  };
  for (const block of story.blocks) {
    if (block.kind === "heading") {
      if (words > limit / 4) flush();
      heading =
        source
          .slice(block.line.range.from, block.line.range.to)
          .replace(/\{[^}]*\}/g, "")
          .trim() || heading;
      continue;
    }
    if (block.kind !== "paragraph" || block.visibility === "book") continue;
    if (block.range.to <= from || block.range.from >= to) {
      if (block.range.to <= from) previous = source.slice(block.range.from, block.range.to);
      continue;
    }
    if (group.length === 0) groupHeading = heading;
    group.push(block);
    words += wordCount(source.slice(block.range.from, block.range.to));
    if (words >= limit) flush();
  }
  flush();
  return passages;
}

/** What a model is told once, before any passage. */
export const DIRECTING_INSTRUCTIONS = `You are an audiobook director. You mark how a story is performed when it is read aloud, by adding marks to its text. You never change the story's words.

The story is written in VoxDown, a plain-text format for stories read aloud:
- \`@Mara “Who’s there?”\` means Mara says that quote. Text with no name before it is the narrator's.
- \`@Mara (softly) “Who’s there?”\`: a direction, straight after a name, says how the line is said.
- \`@(grimly) The door would not open.\`: a direction for whoever is speaking (here the narrator) from there to the end of the line. Inside a quote, \`@(laughing)\` changes how the rest of it is said. \`@()\` ends a direction early.
- \`*never*\`: a word to stress.
- \`{pause}\` is a beat of silence; \`{pause 2s}\` a longer one.
- \`[door creaks]\` is a sound in the world, heard where it is written.
- \`@[sighs]\` inside a character's quote is a sound they make; \`@Mara [sighs]\` is Mara sighing on her own.
- \`{…}\`, \`%% … %%\`, \`<!-- … -->\` and \`::: …\` are other instructions, notes and the writer's comments: keep them as they are.

What to add, sparingly:
- A direction where a good narrator or actor would change their voice: a whisper, a shout, sarcasm, fear, a line said through tears. One to three words, like an actor's note: softly, bitterly, with a laugh, barely audible. Put it straight after the speaker's name, or as @(…) for the narrator.
- A stressed word where the meaning turns on it ("I *never* said that").
- A pause at a real beat: before a reveal, after a shock, at a change of scene.
- A sound only where the text says it happens ("the door slammed" may get [door slams] after it). A character's sound only where the text says they make it.

Rules:
- Never add, remove, change or reorder a word or a punctuation mark. Only add marks.
- Never add, remove or change a name after @: who speaks each line stays as it is. A quote with no name before it stays the narrator's.
- Keep every mark already there exactly as it is.
- Most lines need nothing. A good performance is mostly the words themselves; mark only what a reader would get wrong without it.
- Write directions in English, which voice services understand best.
- Give back the whole passage, every paragraph, with a blank line between paragraphs as in the original.`;

/** The JSON a model's answer must match. */
export function directingSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["text"],
    properties: {
      text: {
        type: "string",
        description: "The whole passage, word for word, with the marks added.",
      },
    },
  };
}

/** What a model is asked about one passage. */
export function directingPrompt(story: Story, passage: DirectingPassage): string {
  const meta = story.meta;
  const about = [
    meta.title ? `“${meta.title}”` : "A story",
    meta.author ? `by ${meta.author}` : "",
    meta.language ? `(language: ${meta.language})` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const cast = story.cast
    .map(
      (member) =>
        `- ${member.handle}${member.name !== member.handle ? ` (${member.name})` : ""}${member.about ? `: ${member.about}` : ""}`,
    )
    .join("\n");
  return [
    `${about}. The narrator is ${meta.narrator}.`,
    ...(cast ? ["", "Cast:", cast] : []),
    "",
    ...(passage.before ? ["Just before the passage, for context only:", passage.before, ""] : []),
    `Passage${passage.heading ? ` (in “${passage.heading}”)` : ""}, to give back with marks added:`,
    passage.text,
  ].join("\n");
}

/**
 * Everything to paste into an AI chat for the story from `from` to `to`: the instructions and the
 * passage together, asking for the text back in a code block.
 */
export function directingRequest(story: Story, from = 0, to = story.source.length): string {
  const paragraphs = paragraphsIn(story, from, to);
  const first = paragraphs[0];
  const last = paragraphs.at(-1);
  if (!first || !last) return "";
  const [passage] = directingPassages(story, {
    from: first.range.from,
    to: last.range.to,
    words: Number.POSITIVE_INFINITY,
  });
  if (!passage) return "";
  return `${DIRECTING_INSTRUCTIONS}

Answer with only the passage, marks added, in one code block.

${directingPrompt(story, passage)}`;
}

// Lining up a paragraph given back with the paragraph as written.

/** Marks a model may add, each one piece; and words, signs and spaces, each one piece. */
const PIECE =
  /@\/|@\([^()\n]*\)|@[\p{L}\p{N}_][\p{L}\p{N}_'’-]*|\([^()\n]*\)|\[[^[\]\n]*\]|\{[^{}\n]*\}|%%[\s\S]*?%%|\*+|\s+|\.\.\.|…|--|—|[\p{L}\p{N}]+|[\s\S]/gu;

/** What a piece is, for lining up: quotes, apostrophes, ellipses and dashes however written. */
function same(piece: string): string {
  if (/^\s+$/.test(piece)) return " ";
  if (piece === "...") return "…";
  if (piece === "--") return "—";
  if (/^[“”„‟"«»]$/.test(piece)) return '"';
  if (/^[‘’‚‛']$/.test(piece)) return "'";
  return piece;
}

/** Whether a piece is a mark a model may add (or space around one). */
const addable = (piece: string) => /^(?:\s+|@[^/]|\(|\[|\{pause|\*)/u.test(piece);

/** Letters and digits alone, marks taken out: a paragraph known however it is marked. */
function keyOf(text: string): string {
  return text
    .replace(
      /@\([^()\n]*\)|@[\p{L}\p{N}_][\p{L}\p{N}_'’-]*(?:[ \t]*\([^()\n]*\))?|\[[^[\]\n]*\]|\{[^{}\n]*\}/gu,
      "",
    )
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}

/** The words alone, marks taken out, for telling a paragraph given back with its words changed. */
function wordsOf(text: string): string[] {
  return (
    text
      .replace(
        /@\([^()\n]*\)|@[\p{L}\p{N}_][\p{L}\p{N}_'’-]*(?:[ \t]*\([^()\n]*\))?|\[[^[\]\n]*\]|\{[^{}\n]*\}/gu,
        " ",
      )
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

/** How alike two paragraphs' words are, from 0 to 1: the words they share, over all of them. */
function alike(a: readonly string[], b: readonly string[]): number {
  if (!a.length || !b.length) return 0;
  const counts = new Map<string, number>();
  for (const word of a) counts.set(word, (counts.get(word) ?? 0) + 1);
  let shared = 0;
  for (const word of b) {
    const left = counts.get(word) ?? 0;
    if (left > 0) {
      shared++;
      counts.set(word, left - 1);
    }
  }
  return (2 * shared) / (a.length + b.length);
}

/**
 * A paragraph given back, as the story's paragraphs are: a group's `:::` lines and headings,
 * which are no paragraph's, taken out, and a pause given a line of its own put at the start of
 * the line after it, where it is heard the same.
 */
function givenParagraph(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^[ \t]*(?::::|#{1,6}(?:[ \t]|$))/.test(line))
    .join("\n")
    .replace(/(^|\n)[ \t]*(\{pause[^{}\n]*\})[ \t]*\n(?=[ \t]*\S)/g, "$1$2 ")
    .replace(/^\n+|\n+$/g, "");
}

/**
 * The marks a paragraph given back adds to the one as written, as insertions into it; undefined
 * if it does anything but add marks.
 */
export function addedMarks(
  written: string,
  given: string,
): Array<{ at: number; text: string }> | undefined {
  const a = [...written.matchAll(PIECE)].map((match) => ({ text: match[0], at: match.index }));
  const b = [...given.matchAll(PIECE)].map((match) => match[0]);
  const out: Array<{ at: number; text: string }> = [];
  let i = 0;
  let pending = "";
  const flush = (at: number) => {
    if (pending.trim()) out.push({ at, text: pending });
    pending = "";
  };
  for (const piece of b) {
    const next = a[i];
    if (next && same(next.text) === same(piece)) {
      flush(next.at);
      i++;
      continue;
    }
    // A space the model left out: the writer's own stays. (Looked past only when what follows it
    // is this piece, so a mark just before a space stays before it.)
    const after = a[i + 1];
    if (
      next &&
      after &&
      /^\s+$/.test(next.text) &&
      !/^\s+$/.test(piece) &&
      same(after.text) === same(piece)
    ) {
      flush(next.at);
      i += 2;
      continue;
    }
    // A mark goes within a line: a line of its own could give the words after it to someone else.
    if (!addable(piece) || piece.includes("\n")) return undefined;
    pending += piece;
  }
  while (i < a.length && /^\s+$/.test((a[i] as { text: string }).text)) i++;
  if (i < a.length) return undefined;
  flush(written.length);
  return out;
}

/** What is heard and printed, for telling whether marks changed it. */
type Reading = {
  book: string;
  speech: Array<[string, string]>;
  directions: string[];
  kept: string[];
  added: string[];
};

const bare = (text: string) => text.replace(/\*/g, "").replace(/\s+/g, " ").trim();

function readingOf(text: string): Reading {
  const story = parse(text);
  const speech: Array<[string, string]> = [];
  const directions: string[] = [];
  const kept: string[] = [];
  const added: string[] = [];
  const items: Item[] = story.blocks.flatMap((block) =>
    block.kind === "paragraph" ? block.lines.flatMap((line) => line.items) : [],
  );
  for (const item of items) {
    if (item.kind === "speech") {
      const words = bare(item.text);
      const last = speech.at(-1);
      if (last && last[0] === item.speaker.toLowerCase()) last[1] = bare(`${last[1]} ${words}`);
      else if (words) speech.push([item.speaker.toLowerCase(), words]);
      if (item.ownDirection) directions.push(item.ownDirection);
    } else if (item.kind === "vocal") added.push(`vocal:${item.speaker}:${item.description}`);
    else if (item.kind === "sound") added.push(`sound:${item.description}`);
    else if (item.kind === "instruction")
      (item.name === "pause" ? added : kept).push(`instruction:${item.raw}`);
    else if (item.kind === "note") kept.push(`note:${item.text}`);
    else if (item.kind === "comment") kept.push(`comment:${item.text}`);
    else if (item.kind === "image") kept.push(`image:${item.src}`);
    else if (item.kind === "end") kept.push("end");
  }
  return { book: bare(bookText(story)), speech, directions, kept, added };
}

/** Whether every item of `part` is in `whole`, in order. */
function within(part: readonly string[], whole: readonly string[]): boolean {
  let at = 0;
  for (const item of whole) if (item === part[at]) at++;
  return at === part.length;
}

/** Why marks added to a paragraph change more than how it is performed; undefined if they don't. */
export function whyNot(written: string, marked: string): string | undefined {
  const was = readingOf(written);
  const now = readingOf(marked);
  if (now.book !== was.book) return "it would change the printed words";
  if (
    now.speech.length !== was.speech.length ||
    now.speech.some(([who, words], index) => {
      const old = was.speech[index] as [string, string];
      return who !== old[0] || words !== old[1];
    })
  )
    return "it would change who says what";
  if (!within(was.directions, now.directions)) return "it would change a direction you wrote";
  if (now.kept.join("\n") !== was.kept.join("\n") || !within(was.added, now.added))
    return "it would change a mark you wrote";
  return undefined;
}

/** A short, stable hash, for ids. */
function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index++)
    value = Math.imul(value ^ text.charCodeAt(index), 0x01000193) >>> 0;
  return value.toString(36);
}

function kindOf(text: string): SuggestionKind {
  const mark = text.trim();
  if (/^\*+$/.test(mark)) return "stress";
  if (/^\{pause/.test(mark)) return "pause";
  if (/^@\[|^@[\p{L}\p{N}_]/u.test(mark)) return "vocal";
  if (/^\[/.test(mark)) return "sound";
  return "direction";
}

/** The paragraphs of an answer: its text (or JSON's `text`), code fences taken out. */
function paragraphsOf(answer: string): string[] {
  let text = answer;
  try {
    const data = JSON.parse(answer.trim()) as { text?: unknown };
    if (typeof data?.text === "string") text = data.text;
  } catch {}
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !/^\s*(```|~~~)/.test(line))
    .join("\n")
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.replace(/^\n+|\n+$/g, ""))
    .filter((paragraph) => paragraph.trim() !== "");
}

/**
 * A model's answer about the story from `from` to `to`, read as suggestions: each paragraph it
 * gave back found among the story's by its words, and its marks kept only where they change
 * nothing else. Answers about several passages can be read at once, joined.
 */
export function readDirected(
  story: Story,
  answer: string,
  options: { from?: number; to?: number } = {},
): Directed {
  const source = story.source;
  const paragraphs = paragraphsIn(story, options.from, options.to);
  const keys = paragraphs.map((paragraph) =>
    keyOf(source.slice(paragraph.range.from, paragraph.range.to)),
  );
  const result: Directed = { suggestions: [], refused: [], missing: 0, missed: [] };
  const lineAt = (at: number) => source.slice(0, at).split("\n").length;
  /** A paragraph said by its line and its first words, and why. */
  const said = (from: number, written: string, why: string): Refusal => {
    const words = bare(written.replace(/\s+/g, " "));
    return { line: lineAt(from), words: words.length > 60 ? `${words.slice(0, 59)}…` : words, why };
  };
  const seen = new Map<string, number>();
  // A paragraph of marks alone (`{page}`, a sound) has no words to find it by, nor any to direct:
  // never counted as not given back.
  const matched = new Set<number>(keys.flatMap((key, index) => (key === "" ? [index] : [])));
  let cursor = 0;
  for (const answered of paragraphsOf(answer)) {
    const given = givenParagraph(answered);
    const key = keyOf(given);
    if (!key) continue;
    let index = keys.indexOf(key, cursor);
    // Not there in order: a paragraph the model gave back earlier than it is.
    if (index < 0) index = keys.findIndex((other, at) => other === key && !matched.has(at));
    // Not there at all: its words changed. The next paragraphs not yet given back, if one is
    // mostly the same words, is the one it is, refused below and listed, not counted missing.
    if (index < 0) {
      const words = wordsOf(given);
      let best = 0.6;
      for (let at = cursor; at < Math.min(keys.length, cursor + 3); at++) {
        if (matched.has(at)) continue;
        const paragraph = paragraphs[at] as Paragraph;
        const score = alike(words, wordsOf(source.slice(paragraph.range.from, paragraph.range.to)));
        if (score >= best) {
          best = score;
          index = at;
        }
      }
    }
    if (index < 0) continue;
    matched.add(index);
    cursor = index + 1;
    const paragraph = paragraphs[index] as Paragraph;
    const { from } = paragraph.range;
    const written = source.slice(from, paragraph.range.to);
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    const refuse = (why: string) => result.refused.push(said(from, written, why));
    const added = addedMarks(written, given);
    if (!added) {
      if (bare(given) !== bare(written)) refuse("its words weren’t given back as written");
      continue;
    }
    if (added.length === 0) continue;
    const marked = insertAll(written, added);
    const why = whyNot(written, marked);
    if (why) {
      refuse(why);
      continue;
    }
    // A stressed word's two stars are one suggestion.
    const stars = added.filter((mark) => kindOf(mark.text) === "stress");
    if (stars.length % 2) {
      refuse("a stressed word wasn’t closed");
      continue;
    }
    const groups: Array<Array<{ at: number; text: string }>> = [];
    for (const mark of added) if (kindOf(mark.text) !== "stress") groups.push([mark]);
    for (let at = 0; at < stars.length; at += 2)
      groups.push([
        stars[at] as { at: number; text: string },
        stars[at + 1] as { at: number; text: string },
      ]);
    groups.sort((x, y) => (x[0] as { at: number }).at - (y[0] as { at: number }).at);
    for (const group of groups) {
      const first = group[0] as { at: number; text: string };
      const kind = kindOf(first.text);
      const label =
        kind === "stress"
          ? `*${written.slice(first.at, (group[1] as { at: number }).at).trim()}*`
          : first.text.trim();
      result.suggestions.push({
        id: `${hash(key)}.${occurrence}.${first.at}.${label}`,
        kind,
        label,
        line: lineAt(from + first.at),
        changes: group.map((mark) => ({
          from: from + mark.at,
          to: from + mark.at,
          insert: mark.text,
        })),
        preview: previewOf(
          source,
          group.map((mark) => ({ at: from + mark.at, text: mark.text })),
        ),
        paragraph: { from, to: paragraph.range.to },
      });
    }
  }
  result.missing = paragraphs.length - matched.size;
  for (const [index, paragraph] of paragraphs.entries())
    if (!matched.has(index))
      result.missed.push(
        said(
          paragraph.range.from,
          source.slice(paragraph.range.from, paragraph.range.to),
          "the answer didn’t give it back",
        ),
      );
  return result;
}

/** Insertions made into a text, in order. */
function insertAll(text: string, marks: ReadonlyArray<{ at: number; text: string }>): string {
  let out = "";
  let at = 0;
  for (const mark of [...marks].sort((x, y) => x.at - y.at)) {
    out += text.slice(at, mark.at) + mark.text;
    at = mark.at;
  }
  return out + text.slice(at);
}

/** A suggestion's line, with it in, about 90 characters around it. */
function previewOf(
  source: string,
  marks: ReadonlyArray<{ at: number; text: string }>,
): Suggestion["preview"] {
  const first = (marks[0] as { at: number }).at;
  const last = (marks.at(-1) as { at: number }).at;
  const lineFrom = source.lastIndexOf("\n", first - 1) + 1;
  const end = source.indexOf("\n", last);
  const lineTo = end < 0 ? source.length : end;
  const from = Math.max(lineFrom, first - 45);
  const to = Math.min(lineTo, last + 45);
  let text = from > lineFrom ? "…" : "";
  const added: Array<[number, number]> = [];
  let at = from;
  for (const mark of marks) {
    text += source.slice(at, mark.at);
    const trimmed = mark.text.trim();
    const lead = mark.text.indexOf(trimmed);
    text += mark.text.slice(0, lead);
    added.push([text.length, text.length + trimmed.length]);
    text += mark.text.slice(lead);
    at = mark.at;
  }
  text += source.slice(at, to) + (to < lineTo ? "…" : "");
  return { text, added };
}

/**
 * The changes for the suggestions chosen, each paragraph checked again with only those (a mark
 * left out can matter to one kept), and how many were dropped because together they no longer
 * held.
 */
export function chosenChanges(
  story: Story,
  chosen: readonly Suggestion[],
): { changes: TextChange[]; dropped: number } {
  const byParagraph = new Map<number, Suggestion[]>();
  for (const suggestion of chosen) {
    const list = byParagraph.get(suggestion.paragraph.from) ?? [];
    list.push(suggestion);
    byParagraph.set(suggestion.paragraph.from, list);
  }
  const changes: TextChange[] = [];
  let dropped = 0;
  for (const [from, list] of byParagraph) {
    const to = (list[0] as Suggestion).paragraph.to;
    const written = story.source.slice(from, to);
    const marks = list.flatMap((suggestion) =>
      suggestion.changes.map((change) => ({ at: change.from - from, text: change.insert })),
    );
    if (whyNot(written, insertAll(written, marks))) {
      dropped += list.length;
      continue;
    }
    changes.push(...list.flatMap((suggestion) => suggestion.changes));
  }
  changes.sort((a, b) => a.from - b.from);
  return { changes, dropped };
}
