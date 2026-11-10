/**
 * The parsed story. Every node keeps its source range (UTF-16 offsets), so an editor can highlight
 * it and write changes back without touching anything else (§13).
 */
import type { Range } from "./source";

export type { Range };

export type Story = {
  source: string;
  frontMatter: FrontMatter | null;
  meta: Meta;
  /** The cast in the order the front matter lists it (§4.3). */
  cast: CastMember[];
  /** Paragraphs, headings and scene breaks in order. Group lines are in `groups`. */
  blocks: Block[];
  /** Every group in the file, in the order they open (§7). */
  groups: Group[];
  warnings: Warning[];
};

export type FrontMatter = {
  /** From the opening `---` to the end of the closing `---`. */
  range: Range;
  /** The YAML between the two `---` lines, exactly as written. */
  raw: string;
  data: Record<string, unknown>;
};

export type Meta = {
  title?: string;
  subtitle?: string;
  author?: string;
  language?: string;
  /** The spec version the file follows, from its `voxdown` key. */
  version?: string;
  /** How the narrator is written: the cast's spelling, else the `narrator:` key, else "Narrator". */
  narrator: string;
};

export type CastMember = {
  /** The one word written after `@`. */
  handle: string;
  /** The full name, which defaults to the handle. */
  name: string;
  about?: string;
  /** The member's map from the front matter, or an empty object. */
  data: Record<string, unknown>;
};

/** Who can hear or see a paragraph or heading (§9.3). */
export type Visibility = "both" | "book" | "audio" | "hidden";

export type Block = Paragraph | Heading | Break;

export type Paragraph = {
  kind: "paragraph";
  lines: Line[];
  visibility: Visibility;
  /** The groups around the paragraph, outermost first. */
  groups: Group[];
  range: Range;
};

export type Heading = {
  kind: "heading";
  level: number;
  /** The heading's text, after the `#` signs. */
  line: Line;
  visibility: Visibility;
  groups: Group[];
  range: Range;
};

export type Break = { kind: "break"; range: Range };

export type Group = {
  /** The character everything unmarked inside belongs to (§7.2). */
  character?: string;
  direction?: string;
  visibility?: Visibility;
  /** The opening line. */
  range: Range;
  /** The closing line, or null when the group runs to the end of the file. */
  closeRange: Range | null;
  /** The character mark on the opening line, without the direction. */
  mark?: Mark;
  directionRange?: Range;
  instructions: Instruction[];
  notes: Note[];
};

/** A line of a paragraph. A note that runs over several lines makes them one line. */
export type Line = { range: Range; items: Item[] };

/**
 * What a line holds, in source order. Speech, vocal sounds, sounds, instructions, notes and images
 * are what the spoken script lists; marks and directions are kept so an editor can find them.
 */
export type Item = Speech | Vocal | Sound | Instruction | Note | Image | Mark | DirectionMark;

/** One stretch of speech or narration (§12.1). Narration is speech by the narrator. */
export type Speech = {
  kind: "speech";
  /** The canonical spelling of the speaker's name (§5.2). */
  speaker: string;
  /** The direction it is performed with, after the group rules (§6.4). */
  direction: string | null;
  /** Its own direction, from a `@(…)`, the speech it carries on, or its mark. */
  ownDirection: string | null;
  /** What is heard: marks, escapes and the speech's own quotation marks removed, spaces collapsed. */
  text: string;
  /** The stretch, with its own quotation marks. */
  range: Range;
  /** The words alone. */
  textRange: Range;
  /** Whether the words are inside the speaker's own quotation marks. */
  quoted: boolean;
  /** Whether the quote carries on an earlier speech without a mark of its own (§5.6, §5.7). */
  continued: boolean;
  /** The character mark that gave this speech its speaker. */
  mark?: Mark;
  /** The `@(…)` its own direction was written in, if any. */
  directionMark?: DirectionMark;
  openQuote?: Range;
  closeQuote?: Range;
};

/** A sound a character makes (§8.2): `@Gerald [snores]`, or `@[sneezes]` inside a speech. */
export type Vocal = {
  kind: "vocal";
  speaker: string;
  direction: string | null;
  description: string;
  range: Range;
  /** The character mark the sound follows. Absent for `@[…]`. */
  mark?: Mark;
};

/** A sound in the world (§8.1). */
export type Sound = { kind: "sound"; description: string; range: Range };

/** `{page}`, `{pause 2s}`, `{book only}`, `{recorder:take 3}` … (§9). */
export type Instruction = {
  kind: "instruction";
  name: string;
  value: string | null;
  /** The instruction as written, braces included. */
  raw: string;
  range: Range;
};

/** `%% … %%` (§10). `text` has its spaces and line breaks run together. */
export type Note = { kind: "note"; text: string; range: Range };

export type Image = { kind: "image"; alt: string; src: string; range: Range };

/** A character mark, `@Gerald` or `@Gerald (yawning)` (§5.2, §6.1). */
export type Mark = {
  kind: "mark";
  speaker: string;
  direction: string | null;
  range: Range;
  nameRange: Range;
  directionRange?: Range;
};

/** `@(…)`, a direction for whoever is speaking (§6.2), or `@()`, back to none (§6.3). */
export type DirectionMark = { kind: "direction"; direction: string | null; range: Range };

export type WarningCode =
  | "unclosed-quote"
  | "quote-over-line-break"
  | "unclosed-group"
  | "stray-group-close"
  | "idle-mark"
  | "stray-quote"
  | "unknown-character"
  | "name-case"
  | "silent-cast-member"
  | "unknown-instruction"
  | "pause-value"
  | "sound-looks-like-link"
  | "unclosed-note"
  | "front-matter";

export type Warning = {
  code: WarningCode;
  severity: "warning" | "info";
  message: string;
  range: Range;
  /** 1-based. */
  line: number;
  /** 1-based, in UTF-16 code units. */
  column: number;
};
