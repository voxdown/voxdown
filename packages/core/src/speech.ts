/**
 * Who says what, and how: turning a paragraph's tokens into speech, narration and sounds.
 *
 * Marks work one line at a time (§5.3). On each line:
 *
 * - a character mark claims the first quote after it on its line, unless another character mark
 *   comes first (§5.4); a mark with no quote makes the character say the rest of the line, up to
 *   the next mark, unless a sound follows the mark (§5.8, §8.2);
 * - an unmarked quote after a speech that ended on the same line carries that speech on (§5.6);
 * - `@/` ends a speech without quotes: the rest of the line is the base voice's again (§5.9);
 * - everything else belongs to the line's base voice: the narrator, or a group's character (§7.2).
 *
 * Two things run longer than a line: a quote runs to its closing mark (§5.7), and a group to its
 * closing line (§7).
 */
import { baseSpeaker, groupDirection, visibilityOf } from "./groups";
import {
  type CloseToken,
  type DirectionToken,
  type EndToken,
  type LexedLine,
  type MarkToken,
  type OpenToken,
  type TextToken,
  type Token,
  isBlankText,
} from "./inline";
import type { DirectionMark, Group, Item, Line, Mark } from "./model";
import type { Names } from "./names";
import type { Range } from "./source";
import type { Warn } from "./warnings";

/** Who speaks a stretch, and with what direction of its own. */
export type Voice = {
  speaker: string;
  own: string | null;
  quoted: boolean;
  continued: boolean;
  mark?: Mark;
  directionMark?: DirectionMark;
};

/** A quote still open at the end of a paragraph. `voice` is null when the narration holds it. */
export type OpenQuote = { char: string; range: Range; voice: Voice | null };

export type ParagraphContext = {
  groups: readonly Group[];
  names: Names;
  warn: Warn;
};

/**
 * Reads a paragraph's lines. `carried` is the voice of a speech left open at the end of an earlier
 * paragraph, when this paragraph begins with the same opening mark (§5.7).
 */
export function readParagraph(
  lines: readonly LexedLine[],
  context: ParagraphContext,
  carried: Voice | null,
): { lines: Line[]; open: OpenQuote | null } {
  return new ParagraphReader(context).read(lines, carried);
}

type Stretch = { pieces: TextToken[]; openQuote?: Range; closeQuote?: Range };

class ParagraphReader {
  private readonly base: string;
  /** The quote open right now, which may have opened on an earlier line. */
  private quote: (OpenQuote & { warned: boolean }) | null = null;

  // The state of the line being read.
  private items: Item[] = [];
  private stretch: Stretch = { pieces: [] };
  /** The speech under way, quoted or not. Null while the base voice speaks. */
  private speech: Voice | null = null;
  /** The base voice's own direction on this line, from a `@(…)` (§6.2). */
  private narration: { own: string | null; directionMark?: DirectionMark } = { own: null };
  /** A character mark waiting for the quote it claims. */
  private pending: Mark | null = null;
  /** A `@(…)` with only spaces between it and the next quote, which it belongs to. */
  private pendingDirection: DirectionMark | null = null;
  /** The most recent speech that ended on this line, which an unmarked quote carries on. */
  private lastEnded: Voice | null = null;

  constructor(private readonly context: ParagraphContext) {
    this.base = baseSpeaker(context.groups, context.names.narrator);
  }

  read(lines: readonly LexedLine[], carried: Voice | null) {
    const read = lines.map((line, index) => {
      const result = this.readLine(line, index === 0 ? carried : null);
      if (index < lines.length - 1) this.warnOverLine();
      return result;
    });
    const open = this.quote && {
      char: this.quote.char,
      range: this.quote.range,
      voice: this.quote.voice,
    };
    return { lines: read, open };
  }

  private readLine(line: LexedLine, carried: Voice | null): Line {
    this.items = [];
    this.stretch = { pieces: [] };
    this.newLine();
    const { tokens } = line;
    const first = tokens.findIndex((token) => !isBlankText(token));
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index] as Token;
      switch (token.type) {
        case "text":
          this.stretch.pieces.push(token);
          break;
        case "open":
          this.open(token, index === first ? carried : null);
          break;
        case "close":
          this.close(token);
          break;
        case "mark":
          index = this.mark(token, tokens, index);
          break;
        case "direction":
          this.direction(token, tokens, index);
          break;
        case "end":
          this.end(token);
          break;
        case "vocal": {
          this.flush();
          const voice = this.voice();
          this.items.push({
            kind: "vocal",
            speaker: voice.speaker,
            direction: this.effective(voice.speaker, voice.own),
            description: token.description,
            range: token.range,
          });
          break;
        }
        case "instruction":
          // Visibility applies to the whole paragraph, so it doesn't break a stretch (§9.3).
          if (!visibilityOf(token.name)) this.flush();
          this.items.push({
            kind: "instruction",
            name: token.name,
            value: token.value,
            raw: token.raw,
            range: token.range,
          });
          break;
        case "sound":
          this.flush();
          this.items.push({ kind: "sound", description: token.description, range: token.range });
          break;
        case "note":
          this.flush();
          this.items.push({ kind: "note", text: token.text, range: token.range });
          // A note that runs over a line break keeps its lines one line, but what a mark does
          // still ends with the line it is on (§5.3): after the note, the next line's words.
          if (token.breaks) {
            this.warnOverLine();
            this.newLine();
          }
          break;
        case "image":
          this.flush();
          this.items.push({
            kind: "image",
            alt: token.alt,
            src: token.src,
            ...(token.link === undefined ? {} : { link: token.link }),
            range: token.range,
          });
          break;
      }
    }
    this.flush();
    if (this.quote?.voice && this.speech) this.quote.voice = this.speech;
    const items = this.items.sort((a, b) => a.range.from - b.range.from);
    return { range: line.range, items };
  }

  /** A line starts: only a quote still open carries its speaker over to it. */
  private newLine(): void {
    this.speech = this.quote?.voice ?? null;
    this.narration = { own: null };
    this.pending = null;
    this.pendingDirection = null;
    this.lastEnded = null;
  }

  /** A quote still open at a line break may be missing its closing mark. */
  private warnOverLine(): void {
    if (!this.quote || this.quote.warned) return;
    this.context.warn(
      "quote-over-line-break",
      "This quote runs over a line break. That is fine for verse, but a closing mark may be missing.",
      this.quote.range,
    );
    this.quote.warned = true;
  }

  /** An opening quotation mark: a claimed or carried-on speech, or a quote in the narration. */
  private open(token: OpenToken, carried: Voice | null): void {
    const voice = this.claim(carried);
    if (voice) {
      this.flush();
      this.speech = voice;
      // The narrator's direction ends where a speech begins (§6.2).
      this.narration = { own: null };
      this.stretch.openQuote = token.range;
    } else {
      this.stretch.pieces.push(asText(token));
    }
    this.quote = { char: token.char, range: token.range, voice, warned: false };
    this.pending = null;
    this.pendingDirection = null;
  }

  /** Who a quote belongs to: its mark, else the speech it carries on, else nobody (narration). */
  private claim(carried: Voice | null): Voice | null {
    let voice: Voice | null = null;
    if (this.pending) {
      voice = {
        speaker: this.pending.speaker,
        own: this.pending.direction,
        quoted: true,
        continued: false,
        mark: this.pending,
      };
    } else {
      const earlier = carried ?? this.lastEnded;
      if (earlier) voice = continuation(earlier);
    }
    // A `@(…)` just before the quote comes ahead of the mark's or the carried direction (§6.2).
    const direction = this.pendingDirection;
    return voice && direction
      ? { ...voice, own: direction.direction, directionMark: direction }
      : voice;
  }

  private close(token: CloseToken): void {
    if (this.quote?.voice && this.speech?.quoted) {
      this.stretch.closeQuote = token.range;
      this.flush();
      this.lastEnded = this.speech;
      this.speech = null;
    } else {
      this.stretch.pieces.push(asText(token));
    }
    this.quote = null;
  }

  /** A character mark. Returns the index of the last token it consumed. */
  private mark(token: MarkToken, tokens: readonly Token[], index: number): number {
    const speaker = this.context.names.use(token.name, token.nameRange);
    const mark: Mark = {
      kind: "mark",
      speaker,
      direction: token.direction,
      range: token.range,
      nameRange: token.nameRange,
      ...(token.directionRange ? { directionRange: token.directionRange } : {}),
    };
    this.items.push(mark);
    if (this.speech?.quoted) {
      // Inside a quote, a mark changes who speaks from here to the closing mark.
      this.flush();
      this.speech = { speaker, own: mark.direction, quoted: true, continued: false, mark };
      return this.ownSound(mark, tokens, index);
    }
    if (this.speech) {
      // Speech without quotes ends where the next character mark begins (§5.8).
      this.flush();
      this.speech = null;
    }
    const claimsQuote = quoteAhead(tokens, index);
    const last = this.ownSound(mark, tokens, index);
    if (claimsQuote) {
      this.pending = mark;
    } else if (last === index) {
      // No quote and no sound: the character says the rest of the line (§5.8).
      this.flush();
      this.speech = { speaker, own: mark.direction, quoted: false, continued: false, mark };
      this.narration = { own: null };
    }
    return last;
  }

  /**
   * A sound straight after a mark (or its direction) is the character's own (§8.2). Only one: a
   * second sound is a sound in the world. Returns the index of the sound, or `index` if none.
   */
  private ownSound(mark: Mark, tokens: readonly Token[], index: number): number {
    let next = index + 1;
    while (next < tokens.length && isBlankText(tokens[next] as Token)) next++;
    const token = tokens[next];
    if (token?.type !== "sound") return index;
    this.flush();
    this.items.push({
      kind: "vocal",
      speaker: mark.speaker,
      direction: this.effective(mark.speaker, mark.direction),
      description: token.description,
      range: token.range,
      mark,
    });
    return next;
  }

  /**
   * `@/` ends a speech without quotes, or a mark's wait for its quote: from here the line's base
   * voice speaks, with no direction of its own (§5.9). A quote ends only at its closing mark.
   */
  private end(token: EndToken): void {
    this.items.push({ kind: "end", range: token.range });
    if (this.speech?.quoted) {
      this.context.warn(
        "idle-end",
        "@/ ends a speech without quotes; a quote ends at its closing mark.",
        token.range,
      );
      return;
    }
    if (!this.speech && !this.pending) {
      this.context.warn(
        "idle-end",
        "@/ ends nothing here: the line's own voice is already speaking.",
        token.range,
      );
      return;
    }
    this.flush();
    this.speech = null;
    this.narration = { own: null };
    this.pending = null;
    this.pendingDirection = null;
  }

  /** `@(…)` changes the direction of whoever is speaking, from here (§6.2, §6.3). */
  private direction(token: DirectionToken, tokens: readonly Token[], index: number) {
    this.flush();
    const mark: DirectionMark = {
      kind: "direction",
      direction: token.direction,
      range: token.range,
    };
    this.items.push(mark);
    if (this.speech) {
      this.speech = { ...this.speech, own: mark.direction, directionMark: mark };
      return;
    }
    this.narration = { own: mark.direction, directionMark: mark };
    if (nextSolid(tokens, index)?.type === "open") this.pendingDirection = mark;
  }

  /** Who is speaking right now. */
  private voice(): Voice {
    if (this.speech) return this.speech;
    const { own, directionMark } = this.narration;
    return {
      speaker: this.base,
      own,
      quoted: false,
      continued: false,
      ...(directionMark ? { directionMark } : {}),
    };
  }

  /** A stretch's direction: its own, else its group's, else none (§6.4). */
  private effective(speaker: string, own: string | null): string | null {
    return own ?? groupDirection(this.context.groups, speaker);
  }

  /** Ends the current stretch, adding it as a speech item if it holds anything. */
  private flush(): void {
    const { pieces, openQuote, closeQuote } = this.stretch;
    this.stretch = { pieces: [] };
    const text = pieces
      .map((piece) => piece.value)
      .join("")
      .replace(/[ \t]+/g, " ")
      .trim();
    if (!text && !openQuote && !closeQuote) return;
    const voice = this.voice();
    const textRange = wordsRange(pieces) ?? emptyRange(openQuote?.to ?? closeQuote?.from ?? 0);
    this.items.push({
      kind: "speech",
      speaker: voice.speaker,
      direction: this.effective(voice.speaker, voice.own),
      ownDirection: voice.own,
      text,
      range: { from: openQuote?.from ?? textRange.from, to: closeQuote?.to ?? textRange.to },
      textRange,
      quoted: voice.quoted,
      continued: voice.continued,
      ...(voice.mark ? { mark: voice.mark } : {}),
      ...(voice.directionMark ? { directionMark: voice.directionMark } : {}),
      ...(openQuote ? { openQuote } : {}),
      ...(closeQuote ? { closeQuote } : {}),
    });
  }
}

/** A speech carried on by an unmarked quote keeps its speaker and direction, but not its mark. */
function continuation(voice: Voice): Voice {
  return {
    speaker: voice.speaker,
    own: voice.own,
    quoted: true,
    continued: true,
    ...(voice.directionMark ? { directionMark: voice.directionMark } : {}),
  };
}

/** Whether a quote opens after `index` on this line before the next character mark. */
function quoteAhead(tokens: readonly Token[], index: number): boolean {
  for (let next = index + 1; next < tokens.length; next++) {
    const type = tokens[next]?.type;
    // Another mark, or `@/`, comes first: the quote isn't this mark's.
    if (type === "mark" || type === "end") return false;
    if (type === "open") return true;
  }
  return false;
}

/** The next token after `index` that is not just spaces. */
function nextSolid(tokens: readonly Token[], index: number): Token | undefined {
  for (let next = index + 1; next < tokens.length; next++) {
    const token = tokens[next];
    if (token && !isBlankText(token)) return token;
  }
  return undefined;
}

/** The source range of a stretch's words, without the spaces around them. */
function wordsRange(pieces: readonly TextToken[]): Range | null {
  let from: number | null = null;
  let to = 0;
  for (const piece of pieces) {
    if (piece.value.trim() === "") continue;
    const lead = piece.plain ? piece.value.length - piece.value.trimStart().length : 0;
    const trail = piece.plain ? piece.value.length - piece.value.trimEnd().length : 0;
    from ??= piece.range.from + lead;
    to = piece.range.to - trail;
  }
  return from === null ? null : { from, to };
}

function emptyRange(at: number): Range {
  return { from: at, to: at };
}

function asText(token: OpenToken | CloseToken): TextToken {
  return { type: "text", value: token.char, range: token.range, plain: true };
}
