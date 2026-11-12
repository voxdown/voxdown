/**
 * The TextMate grammar, written as code so its patterns can share their parts: a name, a
 * direction's balanced parentheses, where an `@` can start a mark. `pnpm grammar` writes
 * `syntaxes/*.json` from this file, and a test checks that they match it.
 *
 * It follows the core's lexer (`inline.ts` and `blocks.ts` in the core) as closely as a regex
 * grammar can. Three things need the whole file, and a grammar reads a line at a time:
 *
 * - Which quotation marks belong to a speech (SPEC.md §5.4 to §5.7). The grammar colors the quotes
 *   after a character mark, to the end of the line where the last of them closes, so a quote that
 *   carries a speech on into the next paragraph stays plain.
 * - Whether a `%%` is ever closed. Until it is, the rest of the file is colored as a note.
 * - Whether a first line `---` is ever closed. Until it is, the file is colored as front matter.
 *
 * test/grammar.test.ts checks the grammar against the core's tokens, with these exceptions.
 */
import { TOKEN_SCOPES } from "./scopes";

type Capture = { name?: string; patterns?: Rule[] };
type Rule = { [key: string]: unknown };

// A small regex builder that numbers capture groups, so patterns can be put together from parts.

type Part = { source: string; groups: number } | { open: Capture } | { close: true };

class Re {
  constructor(readonly parts: readonly Part[]) {}
}

type Piece = Re | string;

function seq(...pieces: Piece[]): Re {
  return new Re(
    pieces.flatMap((piece) =>
      typeof piece === "string" ? [{ source: piece, groups: countGroups(piece) }] : piece.parts,
    ),
  );
}

/** A capture group, with the scope and patterns its text gets. */
function cap(capture: Capture | string, ...pieces: Piece[]): Re {
  const open = typeof capture === "string" ? { name: capture } : capture;
  return new Re([{ open }, ...seq(...pieces).parts, { close: true }]);
}

function optional(...pieces: Piece[]): Re {
  return seq("(?:", seq(...pieces), ")?");
}

function compile(re: Re): { source: string; captures: Record<string, Capture> } {
  let source = "";
  let count = 0;
  const captures: Record<string, Capture> = {};
  for (const part of re.parts) {
    if ("open" in part) {
      count++;
      source += "(";
      if (part.open.name !== undefined || part.open.patterns !== undefined) {
        captures[count] = part.open;
      }
    } else if ("close" in part) {
      source += ")";
    } else {
      source += part.source;
      count += part.groups;
    }
  }
  return { source, captures };
}

/** The capturing groups in a pattern: a `(` not escaped, not in a class, and not `(?`. */
function countGroups(source: string): number {
  let groups = 0;
  let classDepth = 0;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") i++;
    else if (char === "[") classDepth++;
    else if (char === "]" && classDepth > 0) classDepth--;
    else if (char === "(" && classDepth === 0 && source[i + 1] !== "?") groups++;
  }
  return groups;
}

function match(name: string | undefined, ...pieces: Piece[]): Rule {
  const { source, captures } = compile(seq(...pieces));
  return {
    ...(name ? { name } : {}),
    match: source,
    ...(Object.keys(captures).length > 0 ? { captures } : {}),
  };
}

const include = (name: string): Rule => ({ include: `#${name}` });

// Scope names. The ones for the core's token kinds come from TOKEN_SCOPES.

const S = TOKEN_SCOPES;
const vd = (scope: string) => `${scope}.voxdown`;

// Characters (SPEC.md §5.2, §11).

/** Letters and digits in any script, for a character class. */
const WORD = String.raw`\p{L}\p{M}\p{N}`;
const LETTER = String.raw`\p{L}\p{M}`;
/** Scripts written without spaces between words. */
const UNSPACED = String.raw`\p{Han}\p{Hiragana}\p{Katakana}\p{Thai}\p{Lao}\p{Khmer}\p{Myanmar}`;
/**
 * An `@` is a mark only when no letter or digit comes right before it, unless that letter belongs
 * to a script written without spaces.
 */
const AT_START = String.raw`(?<![${WORD}&&[^${UNSPACED}]])`;
/** A name: a letter, then letters, digits, `-`, `_`, and apostrophes between two letters. */
const NAME = String.raw`\p{L}(?:[${WORD}_\-]|(?<=[${LETTER}])['’](?=[${LETTER}]))*`;
/**
 * One character of a mark's text, other than those in `not`. It never crosses a line break or
 * the start of a note (a note cuts a line in two, §10), and a backslash takes the next character
 * with it.
 */
const char = (not: string) => String.raw`(?:[^${not}\\%\n]|\\.|%(?!%))`;
/** Balanced parentheses, as a direction is written (§6.1). One capture group, called again inside. */
const PARENS = String.raw`(\((?:${char("()")}|\g<-1>)*\))`;
/** A sound's text: anything up to the closing bracket, with something other than spaces in it. */
const SOUND_TEXT = String.raw`(?=[^\]\n]*?[^\s\]])${char(String.raw`\]`)}*`;
/** A backslash before ASCII punctuation or a quotation mark (§11). */
const ESCAPE = String.raw`\\[!-\/:-@\[-\x60{-~“”‘’„‚«»‹›「」『』]`;

// Inline marks.

const escapeRule: Rule = { name: vd(S.escape), match: ESCAPE };

const note: Rule = {
  name: vd(S.note),
  begin: "%%",
  end: "%%",
  beginCaptures: { 0: { name: "punctuation.definition.comment.begin.voxdown" } },
  endCaptures: { 0: { name: "punctuation.definition.comment.end.voxdown" } },
  patterns: [include("escape")],
};

const escapes = [include("escape")];

/**
 * `[description]`, the brackets and the text. The text is named again: a capture that has patterns
 * of its own loses the scopes of the captures around it.
 */
const soundParts = (scope: string) =>
  cap(
    scope,
    cap("punctuation.definition.sound.begin.voxdown", String.raw`\[`),
    cap({ name: scope, patterns: escapes }, SOUND_TEXT),
    cap("punctuation.definition.sound.end.voxdown", String.raw`\]`),
  );

const sound = match(undefined, soundParts(vd(S.sound)));

/** `[text](address)`: a link, whose text is read (§8.3). */
const link = match(
  "meta.link.inline.voxdown",
  cap("punctuation.definition.link.title.begin.voxdown", String.raw`\[`),
  cap({ name: "string.other.link.title.voxdown", patterns: escapes }, `${char(String.raw`\]`)}*`),
  cap("punctuation.definition.link.title.end.voxdown", String.raw`\]`),
  cap("punctuation.definition.metadata.voxdown", String.raw`\(`),
  cap({ name: "markup.underline.link.voxdown", patterns: escapes }, `(?:${char("()")}|${PARENS})*`),
  cap("punctuation.definition.metadata.voxdown", String.raw`\)`),
);

/** `![description](file)`: an image, shown and not heard (§8.3). */
const image = match(
  "meta.image.inline.voxdown",
  cap("punctuation.definition.link.description.begin.voxdown", String.raw`!\[`),
  cap(
    { name: "string.other.link.description.voxdown", patterns: escapes },
    `${char(String.raw`\]`)}*`,
  ),
  cap("punctuation.definition.link.description.end.voxdown", String.raw`\]`),
  cap("punctuation.definition.metadata.voxdown", String.raw`\(`),
  cap(
    { name: "markup.underline.link.image.voxdown", patterns: escapes },
    `(?:${char("()")}|${PARENS})*`,
  ),
  cap("punctuation.definition.metadata.voxdown", String.raw`\)`),
);

// Instructions (§9): `{page}`, `{pause 2s}`, `{book only}`, `{recorder:take 3}`.

const OPEN_BRACE = cap("punctuation.definition.instruction.begin.voxdown", String.raw`\{[ \t]*`);
const CLOSE_BRACE = cap("punctuation.definition.instruction.end.voxdown", String.raw`[ \t]*\}`);
const VALUE = `${char(String.raw`\}`)}*?`;
const value = (name: string) => optional("[ \\t]+", cap({ name, patterns: escapes }, VALUE));
const instructionName = (kind: string, scope: string) =>
  `${vd(`${S.instruction}.${kind}`)} ${scope}`;

const instruction: Rule = {
  patterns: [
    match(
      instructionName("visibility", "storage.modifier.visibility.voxdown"),
      OPEN_BRACE,
      String.raw`(?:(?:book|audio)[ \t]+only|hidden)`,
      CLOSE_BRACE,
    ),
    match(
      instructionName("page", "keyword.control.page.voxdown"),
      OPEN_BRACE,
      "page",
      value("constant.numeric.page.voxdown"),
      CLOSE_BRACE,
    ),
    match(
      instructionName("pause", "keyword.control.pause.voxdown"),
      OPEN_BRACE,
      "pause",
      optional(
        "[ \\t]+",
        "(?:",
        cap(
          "constant.numeric.length.voxdown",
          String.raw`\d+(?:\.\d+)?`,
          cap("keyword.other.unit.voxdown", " ?(?:ms|s)"),
        ),
        "(?=[ \\t]*\\})|",
        cap({ name: "string.unquoted.value.voxdown", patterns: escapes }, VALUE),
        ")",
      ),
      CLOSE_BRACE,
    ),
    match(
      instructionName("tool", "entity.name.function.tool.voxdown"),
      OPEN_BRACE,
      String.raw`\p{L}[^\s}:\\%]*:[^\s}\\%]*`,
      value("string.unquoted.value.voxdown"),
      CLOSE_BRACE,
    ),
    match(
      instructionName("unknown", "keyword.other.instruction.voxdown"),
      OPEN_BRACE,
      String.raw`\p{L}[^\s}\\%]*`,
      value("string.unquoted.value.voxdown"),
      CLOSE_BRACE,
    ),
  ],
};

// Marks (§5, §6, §8.2).

const AT = cap(vd(S.mark), "@");
const direction = (...pieces: Piece[]) =>
  cap({ name: vd(S.direction), patterns: escapes }, ...pieces);
/** A character's own sound, straight after the mark or its direction. Not a link. */
const ownSound = optional(String.raw`[^\S\n]*`, soundParts(vd(S.vocal)), `(?!${PARENS})`);

/** `@Gerald`, `@Gerald (yawning)`, `@Gerald [snores]`. */
const characterMark = seq(
  AT_START,
  AT,
  cap(vd(S.name), NAME),
  optional("[ \\t]*", direction(PARENS)),
  ownSound,
);

const directionMark = match("meta.mark.direction.voxdown", AT_START, AT, direction(PARENS));
/** `@/`, the end of a speech without quotes (§5.9); `@/lib` is text. */
const endMark = match(
  "meta.mark.end.voxdown",
  AT_START,
  cap(vd(S.mark), "@/"),
  String.raw`(?![\p{L}\p{N}/])`,
);
/** `@[sneezes]`; but `@[text](address)` is an `@` and a link (§8.3). */
const vocalMark = match(
  "meta.mark.vocal.voxdown",
  AT_START,
  AT,
  soundParts(vd(S.vocal)),
  `(?!${PARENS})`,
);

// Speech (§5.4 to §5.7): the quotes after a character mark, on its line, are the character's.

const QUOTES: ReadonlyArray<{ open: string; close: string; style: string }> = [
  { open: "“", close: "”", style: "double" },
  { open: "‘", close: "’", style: "single" },
  { open: '"', close: '"', style: "double" },
  { open: "'", close: "'", style: "single" },
  { open: "„", close: "“”", style: "double" },
  { open: "‚", close: "‘’", style: "single" },
  { open: "«", close: "»", style: "double" },
  { open: "»", close: "«»", style: "double" },
  { open: "‹", close: "›", style: "single" },
  { open: "「", close: "」", style: "other" },
  { open: "『", close: "』", style: "other" },
];

/** A closing mark. A `’` or `'` followed by a letter or digit is an apostrophe (`don’t`). */
function closer(chars: string): string {
  return [...chars].map((c) => (c === "’" || c === "'" ? `${c}(?![${WORD}])` : c)).join("|");
}

/** A paragraph ends at a blank line, or at a line that is a heading, group or scene break. */
const PARAGRAPH_END = String.raw`(?=^\s*$)|(?=^[ \t]*(?:#{1,6}[ \t]|:{3,}|(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$))`;

function quote(open: string, close: string, style: string, multiLine: boolean): Rule {
  // A `'`, `‘` or `"` straight after a letter or digit is an apostrophe or a measure (§5.5).
  const after = "'‘\"".includes(open) ? `(?<![${WORD}])` : "";
  // A straight `'` needs its closing mark on the same line; any other needs something after it.
  const ahead =
    open === "'" ? `(?=(?:[^'\\n]|'(?=[${WORD}]))*'(?![${WORD}]))` : String.raw`(?!\s*$)`;
  const ends = multiLine && open !== "'" ? PARAGRAPH_END : "$";
  return {
    name: `string.quoted.${style}.speech.voxdown`,
    begin: `${after}${open}${ahead}`,
    beginCaptures: { 0: { name: `${S.quote}.begin.voxdown` } },
    end: `(${closer(close)})|${ends}`,
    endCaptures: { 1: { name: `${S.quote}.end.voxdown` } },
    patterns: [include("speech-text")],
  };
}

/** A note that doesn't close on its line. */
const NOTE_OVER_LINE = "(?=%%(?!.*%%))";

/** From a character mark to the end of its line, or to the next character mark. */
function speech(multiLine: boolean): Rule {
  const { source, captures } = compile(characterMark);
  // Another name, or `@/` (§5.9), ends what the mark claims.
  const nextMark = `${AT_START}(?=@\\p{L}|@/(?![\\p{L}\\p{N}/]))`;
  return {
    begin: source,
    beginCaptures: captures,
    // `(?=^)`: a quote that ran to the end of its paragraph ends the line it was on. A note that
    // runs on past the line's end ends what the mark does before it: the words after the note
    // are the next line's (§5.3, §10), though a quote open in it carries on.
    end: multiLine ? `$|(?=^)|${nextMark}|${NOTE_OVER_LINE}` : `$|${nextMark}|${NOTE_OVER_LINE}`,
    patterns: [
      include("escape"),
      include("note"),
      include("image"),
      include("link"),
      include("sound"),
      include("instruction"),
      include(multiLine ? "quote" : "quote-line"),
      include("end-mark"),
      include("direction-mark"),
      include("vocal-mark"),
      include("emphasis"),
    ],
  };
}

// Emphasis (§11).

const EMPHASIS_TEXT = { patterns: [include("emphasis-text")] };
const emphasis: Rule = {
  patterns: [
    match(
      "markup.bold.voxdown",
      cap("punctuation.definition.bold.voxdown", String.raw`\*\*`),
      cap(EMPHASIS_TEXT, String.raw`(?=\S)(?:${char("*")}|\*(?!\*))+?(?<=\S)`),
      cap("punctuation.definition.bold.voxdown", String.raw`\*\*`),
    ),
    match(
      "markup.bold.voxdown",
      `(?<![${WORD}_])`,
      cap("punctuation.definition.bold.voxdown", "__"),
      cap(EMPHASIS_TEXT, String.raw`(?=\S)(?:${char("_")}|_(?!_))+?(?<=\S)`),
      cap("punctuation.definition.bold.voxdown", "__"),
      `(?![${WORD}_])`,
    ),
    match(
      "markup.italic.voxdown",
      String.raw`(?<!\*)`,
      cap("punctuation.definition.italic.voxdown", String.raw`\*`),
      cap(EMPHASIS_TEXT, String.raw`(?=[^\s*])${char("*")}+?(?<=\S)`),
      cap("punctuation.definition.italic.voxdown", String.raw`\*`),
      String.raw`(?!\*)`,
    ),
    match(
      "markup.italic.voxdown",
      `(?<![${WORD}_])`,
      cap("punctuation.definition.italic.voxdown", "_"),
      cap(EMPHASIS_TEXT, `(?=[^\\s_])${char("_")}+?(?<=\\S)`),
      cap("punctuation.definition.italic.voxdown", "_"),
      `(?![${WORD}_])`,
    ),
  ],
};

// Blocks (§4.4, §7).

const frontMatter: Rule = {
  // A file has front matter only if a second `---` line closes the first (§4.4). A grammar can't
  // look ahead, so a file that opens with `---` and never closes it is all front matter here.
  name: vd(S.frontmatter),
  begin: String.raw`\A(?=\x{FEFF}?---\s*$)`,
  end: String.raw`^(---)\s*$`,
  applyEndPatternLast: 1,
  endCaptures: { 1: { name: "punctuation.definition.frontmatter.end.voxdown" } },
  patterns: [
    {
      begin: String.raw`\A\x{FEFF}?(---)\s*$`,
      while: String.raw`^(?!---\s*$)`,
      beginCaptures: { 1: { name: "punctuation.definition.frontmatter.begin.voxdown" } },
      contentName: "meta.embedded.block.frontmatter.voxdown",
      patterns: [
        { include: "source.yaml" },
        // Without the YAML grammar a rule with no patterns left is dropped, and the front matter
        // with it, so a little YAML is colored here too. With it, YAML's own patterns come first.
        { name: "comment.line.number-sign.yaml.voxdown", match: String.raw`(?<=^|\s)#.*$` },
        {
          match: String.raw`^[ \t]*(?:-[ \t]+)?([^\s#:'"\-][^#:]*?)(:)(?=\s|$)`,
          captures: {
            1: { name: "entity.name.tag.yaml.voxdown" },
            2: { name: "punctuation.separator.key-value.mapping.yaml.voxdown" },
          },
        },
      ],
    },
  ],
};

const heading: Rule = {
  name: "markup.heading.voxdown",
  begin: String.raw`^[ \t]*(#{1,6})(?=[ \t])`,
  beginCaptures: { 1: { name: vd(S.heading) } },
  end: "$",
  contentName: "entity.name.section.voxdown",
  patterns: [include("heading-text")],
};

const sceneBreak = match(
  undefined,
  "^[ \\t]*",
  // Three or more of one sign, spaces between them or not: `***`, `* * *` (§4.4).
  cap(vd(S.break), String.raw`(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})`),
  "$",
);

/**
 * A group, from its opening line to the line of colons that closes it, or to the end of the file
 * (§7.3). Groups nest, so a line of colons that closes no group is told apart, as the core does.
 */
const group: Rule = {
  name: "meta.group.voxdown",
  begin: String.raw`^(?=[ \t]*:{3,}(?!:)[^\S\n]*\S)`,
  end: String.raw`^[ \t]*(:{3,})\s*$`,
  endCaptures: { 1: { name: vd(`${S.group}.end`) } },
  patterns: [include("group-line"), include("blocks")],
};

/** A line of colons with no group open: ignored, with a warning (§7.3). */
const strayGroupClose = match("meta.group.stray.voxdown", String.raw`^[ \t]*:{3,}\s*$`);

/** A group's opening line: a character mark, instructions and notes, and the direction, which is the rest (§7). */
const groupLine: Rule = {
  name: "meta.group.begin.voxdown",
  // `\G`: only where the group begins, so a nested group's line starts a group of its own.
  begin: "\\G[ \\t]*(:{3,})",
  beginCaptures: { 1: { name: vd(`${S.group}.begin`) } },
  end: "$",
  patterns: [
    include("escape"),
    include("note"),
    include("instruction"),
    match(
      "meta.mark.character.voxdown",
      AT_START,
      AT,
      cap(vd(S.name), NAME),
      optional("[ \\t]*", direction(PARENS)),
    ),
    { name: vd(S.direction), match: String.raw`[^\s@{%\\]+(?:[^\S\n]+[^\s@{%\\]+)*` },
    { name: vd(S.direction), match: String.raw`[@{%\\]` },
  ],
};

const markText = [
  include("escape"),
  include("note"),
  include("image"),
  include("link"),
  include("sound"),
  include("instruction"),
];

export const grammar = {
  information_for_contributors: [
    "This file is written by src/grammar.ts. Change that file, then run `pnpm grammar`.",
  ],
  name: "VoxDown",
  scopeName: "text.voxdown",
  fileTypes: ["vxd"],
  patterns: [include("front-matter"), include("blocks")],
  repository: {
    "front-matter": frontMatter,
    blocks: {
      patterns: [
        include("heading"),
        include("group"),
        include("stray-group-close"),
        include("scene-break"),
        include("paragraph"),
      ],
    },
    heading,
    group,
    "group-line": groupLine,
    "stray-group-close": strayGroupClose,
    "scene-break": sceneBreak,
    paragraph: {
      patterns: [
        ...markText,
        include("speech"),
        include("end-mark"),
        include("direction-mark"),
        include("vocal-mark"),
        include("emphasis"),
      ],
    },
    "heading-text": {
      patterns: [
        ...markText,
        include("speech-heading"),
        include("end-mark"),
        include("direction-mark"),
        include("vocal-mark"),
        include("emphasis"),
      ],
    },
    escape: escapeRule,
    note,
    image,
    link,
    sound,
    instruction,
    "end-mark": endMark,
    "direction-mark": directionMark,
    "vocal-mark": vocalMark,
    "character-mark": match("meta.mark.character.voxdown", characterMark),
    speech: speech(true),
    "speech-heading": speech(false),
    quote: { patterns: QUOTES.map((q) => quote(q.open, q.close, q.style, true)) },
    "quote-line": { patterns: QUOTES.map((q) => quote(q.open, q.close, q.style, false)) },
    "speech-text": {
      patterns: [
        ...markText,
        include("end-mark"),
        include("direction-mark"),
        include("vocal-mark"),
        include("character-mark"),
        include("emphasis"),
      ],
    },
    emphasis,
    "emphasis-text": {
      patterns: [
        ...markText,
        include("end-mark"),
        include("direction-mark"),
        include("vocal-mark"),
        include("character-mark"),
      ],
    },
  },
};

/** Colors VoxDown in Markdown code blocks tagged `vxd` or `voxdown`. */
export const markdownInjection = {
  information_for_contributors: [
    "This file is written by src/grammar.ts. Change that file, then run `pnpm grammar`.",
  ],
  scopeName: "markdown.voxdown.codeblock",
  injectionSelector: "L:text.html.markdown",
  patterns: [{ include: "#voxdown-code-block" }],
  repository: {
    "voxdown-code-block": {
      name: "markup.fenced_code.block.markdown",
      begin: String.raw`(^|\G)(\s*)(\x60{3,}|~{3,})\s*(?i:(vxd|voxdown)((?:\s+|:|,|\{|\?)[^\x60~]*)?$)`,
      beginCaptures: {
        3: { name: "punctuation.definition.markdown" },
        4: { name: "fenced_code.block.language.markdown" },
        5: { name: "fenced_code.block.language.attributes.markdown" },
      },
      end: String.raw`(^|\G)(\2|\s{0,3})(\3)\s*$`,
      endCaptures: { 3: { name: "punctuation.definition.markdown" } },
      patterns: [
        {
          begin: String.raw`(^|\G)(\s*)(.*)`,
          while: String.raw`(^|\G)(?!\s*([\x60~]{3,})\s*$)`,
          contentName: "meta.embedded.block.voxdown",
          patterns: [{ include: "text.voxdown" }],
        },
      ],
    },
  },
};
