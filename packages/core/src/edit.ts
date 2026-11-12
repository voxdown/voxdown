import { escapeReferences, hasLetterOrDigit } from "./chars";
import { baseSpeaker } from "./groups";
import { scanName } from "./inline";
import { lexedTokens } from "./lexed";
import type { Block, Group, Item, Line, Mark, Speech, Story, Vocal } from "./model";
import { nameKey } from "./names";
import { parse } from "./parse";
import { bookText as readBook } from "./readings";
/**
 * Edits that follow the spec's rules for tools (§13): each returns the smallest set of text
 * changes that makes it, and never touches the author's spacing, quotation marks or line breaks
 * elsewhere. Apply them with `applyChanges`, then parse again.
 */
import { onForget, remembering, session } from "./session";
import type { Range } from "./source";
import { type YamlKey, readYaml } from "./yaml";

/** Replace `from`–`to` with `insert`. An insertion has `from === to`. */
export type TextChange = { from: number; to: number; insert: string };

/** Applies changes made against the same text. Overlapping changes are an error. */
export function applyChanges(source: string, changes: readonly TextChange[]): string {
  for (const { from, to } of changes) {
    if (
      !(
        Number.isInteger(from) &&
        Number.isInteger(to) &&
        0 <= from &&
        from <= to &&
        to <= source.length
      )
    ) {
      throw new RangeError(
        `A change must lie within the text and end where it starts or after: ${from} to ${to} in ${source.length} characters.`,
      );
    }
  }
  const sorted = changes
    .map((change, order) => ({ ...change, order }))
    .sort((a, b) => a.from - b.from || a.to - b.to || a.order - b.order);
  let out = "";
  let at = 0;
  for (const change of sorted) {
    if (change.from < at) throw new RangeError("Two changes overlap.");
    out += source.slice(at, change.from) + change.insert;
    at = change.to;
  }
  return out + source.slice(at);
}

/** Whether a word can be written after `@` as a name (§5.2): exactly what the parser reads as one. */
export function isName(name: string): boolean {
  return name.length > 0 && scanName(name, 0, name.length) === name.length;
}

function checkName(name: string): void {
  if (!isName(name)) {
    throw new RangeError(
      `“${name}” can't be written after @: a name is one word, starting with a letter.`,
    );
  }
}

/** The cast's spelling of a name, else the name as given (§13.3). */
export function spelled(story: Story, name: string): string {
  if (nameKey(name) === nameKey(story.meta.narrator)) return story.meta.narrator;
  return story.cast.find((member) => nameKey(member.handle) === nameKey(name))?.handle ?? name;
}

/** Parentheses inside a direction must balance (§6.1); unbalanced ones are escaped. */
function directionText(given: string): string {
  // One line, its backslashes and note marks escaped, so it reads back as given.
  const direction = given.replace(/\s+/g, " ").replace(/([\\%])/g, "\\$1");
  let depth = 0;
  for (const char of direction) {
    if (char === "(") depth++;
    else if (char === ")" && --depth < 0) break;
  }
  return escapeReferences(depth === 0 ? direction : direction.replace(/([()])/g, "\\$1"));
}

type Place = { block: Block; line: Line; groups: readonly Group[] };

/** The block and line an item is on. */
function place(story: Story, item: Item): Place {
  for (const block of story.blocks) {
    if (block.kind === "break") continue;
    const lines = block.kind === "heading" ? [block.line] : block.lines;
    for (const line of lines) {
      if (line.items.includes(item)) return { block, line, groups: block.groups };
    }
  }
  throw new RangeError("That item is not part of this story.");
}

const speechesOf = (line: Line) =>
  line.items.filter((item): item is Speech => item.kind === "speech");

/** Whether a `@(…)` is this stretch's own: just before it with only spaces between, or inside it. */
function ownDirectionMark(story: Story, speech: Speech): Range | null {
  const mark = speech.directionMark;
  if (!mark) return null;
  const inside = mark.range.from >= speech.range.from && mark.range.to <= speech.range.to;
  const before =
    mark.range.to <= speech.range.from &&
    story.source.slice(mark.range.to, speech.range.from).trim() === "";
  return inside || before ? mark.range : null;
}

/** Whether a speech's mark gave a sound of the character's before it on its line: `@Wanda [gasp] “…”`. */
function sharesMark(line: Line, speech: Speech): boolean {
  return line.items.some(
    (item) =>
      item.kind === "vocal" &&
      item.mark !== undefined &&
      item.mark === speech.mark &&
      item.range.from < speech.range.from,
  );
}

/**
 * The stretches of one quote, in order, and with them the sounds made inside it that have no mark
 * of their own (`@[sneezes]`). A quote runs to its closing mark (§6.4): over sounds, page turns,
 * notes and lines (§5.7), and on into the paragraphs that carry it on with the same character and
 * direction. No mark can go inside it, so an edit to one stretch is an edit to all, made where the
 * quote's mark is. For a direction, a `@(…)` inside the quote starts a new run.
 */
function quoteOf(
  story: Story,
  speech: Speech,
  acrossDirections: boolean,
): { stretches: Speech[]; items: Item[] } {
  const { block, line } = place(story, speech);
  // Words without quotes or a mark of their own run to the end of the line, or to another
  // speaker (§6.4), past any sound, page turn or note: the run is one stretch.
  if (!speech.quoted && !speech.mark) {
    const stretches = narrationRun(story, speech);
    const inRun = new Set<Item>(stretches);
    const last = stretches[stretches.length - 1] as Speech;
    const items = line.items.filter(
      (item) =>
        (item.kind === "speech" && inRun.has(item)) ||
        (item.kind === "vocal" &&
          !item.mark &&
          item.range.from > speech.range.from &&
          item.range.to <= last.range.from),
    );
    return { stretches, items };
  }
  if (block.kind !== "paragraph") return { stretches: [speech], items: [speech] };
  const paragraphs = story.blocks.filter((other) => other.kind === "paragraph");
  const items = paragraphs.flatMap((other) => other.lines.flatMap((line) => line.items));
  const blockOf = new Map<Item, Block>();
  for (const other of paragraphs) {
    for (const line of other.lines) for (const item of line.items) blockOf.set(item, other);
  }
  const said = items.filter((item): item is Speech => item.kind === "speech");
  const joined = (a: Speech | undefined, b: Speech | undefined) => {
    if (!a || !b || !a.quoted || !b.quoted || a.closeQuote) return false;
    if (!acrossDirections && b.directionMark) return false;
    // The same quote, on one line or over lines of a paragraph.
    if (!b.openQuote) return a.mark === b.mark && blockOf.get(a) === blockOf.get(b);
    // The next paragraph carries it on: it opens with the quote's mark and has none of its own.
    return b.continued && !b.mark && blockOf.get(a) !== blockOf.get(b);
  };
  let from = said.indexOf(speech);
  let to = from;
  while (joined(said[from - 1], said[from])) from--;
  while (joined(said[to], said[to + 1])) to++;
  const stretches = said.slice(from, to + 1);
  const inQuote = new Set<Item>(stretches);
  const start = items.indexOf(stretches[0] as Speech);
  const end = items.indexOf(stretches[stretches.length - 1] as Speech);
  const inside = items
    .slice(start, end + 1)
    .filter((item) =>
      item.kind === "speech" ? inQuote.has(item) : item.kind === "vocal" && !item.mark,
    );
  return { stretches, items: inside };
}

/**
 * The narration that would carry on the quote `speech` leaves open, were it someone's (§5.7): the
 * next lines of its paragraph (a straight `'` closes on its own line), then each paragraph that
 * opens with the quote's own mark, to where it closes. Paragraphs of page turns and notes alone
 * are passed over; a heading or a scene break ends it.
 */
function narrationCarrying(
  story: Story,
  speech: Speech,
  quote: Range,
): { stretches: Speech[]; reach: Range[] } {
  const opening = story.source[quote.from];
  const { block, line } = place(story, speech);
  const stretches: Speech[] = [];
  const reach: Range[] = [];
  const done = { stretches, reach };
  if (block.kind !== "paragraph") return done;
  const closes = lexedTokens(story.source).filter((token) => token.type === "close");
  // Takes stretches the quote runs into, each as far as the quote goes in it; true once it closes.
  const take = (more: readonly Speech[]) => {
    for (const stretch of more) {
      const close = closes.find(
        (token) =>
          token.range.from >= stretch.textRange.from && token.range.from < stretch.textRange.to,
      );
      stretches.push(stretch);
      reach.push({ from: stretch.range.from, to: close ? close.range.to : stretch.range.to });
      if (close) return true;
    }
    return false;
  };
  const narration = (stretch: Speech | undefined): stretch is Speech =>
    stretch !== undefined &&
    !stretch.quoted &&
    !stretch.mark &&
    nameKey(stretch.speaker) === nameKey(story.meta.narrator);
  if (opening !== "'") {
    for (const next of block.lines.slice(block.lines.indexOf(line) + 1)) {
      const first = next.items[0];
      if (first?.kind !== "speech" || !narration(first)) return done;
      if (take(narrationRun(story, first))) return done;
    }
  }
  for (const next of story.blocks.slice(story.blocks.indexOf(block) + 1)) {
    if (next.kind !== "paragraph") break;
    const said = next.lines
      .flatMap((other) => other.items)
      .filter((item): item is Speech => item.kind === "speech");
    if (said.length === 0) continue;
    const first = said[0];
    if (!narration(first) || story.source[first.textRange.from] !== opening) break;
    if (take([first])) break;
  }
  return done;
}

/**
 * Where an unmarked speech over paragraphs starts, if `speech` is one of its later paragraphs: the
 * narration in a paragraph before whose open quote goes on into this one (§5.7). Undefined if
 * it isn't one.
 */
function narrationOrigin(story: Story, speech: Speech): Speech | undefined {
  if (speech.quoted || speech.mark || !sameName(speech.speaker, story.meta.narrator)) return;
  const { block } = place(story, speech);
  if (block.kind !== "paragraph") return;
  const first = block.lines.flatMap((line) => line.items).find((item) => item.kind === "speech");
  if (first !== speech || !OPENING_MARKS.has(story.source[speech.textRange.from] ?? "")) return;
  const at = story.blocks.indexOf(block);
  for (let back = at - 1; back >= 0 && back >= at - 64; back--) {
    const before = story.blocks[back] as Block;
    if (before.kind !== "paragraph") return;
    const said = before.lines
      .flatMap((line) => line.items)
      .filter((item): item is Speech => item.kind === "speech");
    for (const candidate of [...said].reverse()) {
      if (candidate.quoted || candidate.mark) continue;
      const quotes = quotesWithin(story, candidate);
      const last = quotes[quotes.length - 1];
      if (!last || last.closed) continue;
      const end = narrationRun(story, candidate).at(-1) as Speech;
      if (narrationCarrying(story, end, last).stretches.includes(speech)) {
        return narrationOrigin(story, candidate) ?? candidate;
      }
    }
    // A paragraph of page turns or notes alone is passed over; one with words ends the search.
    if (said.some((stretch) => hasLetterOrDigit(stretch.text))) return;
  }
  return;
}

const OPENING_MARKS = new Set(['"', "'", "“", "‘", "„", "‚", "«", "»", "‹", "「", "『"]);

/** Whether a speech carries on the one in the paragraph before (§5.7): it opens a paragraph with the quote's mark. */
function carriesParagraph(story: Story, speech: Speech): boolean {
  if (!speech.continued || !speech.openQuote || speech.mark) return false;
  const { block } = place(story, speech);
  if (block.kind !== "paragraph") return false;
  const first = block.lines
    .flatMap((line) => line.items)
    .find((item): item is Speech => item.kind === "speech");
  return first === speech;
}

/** Whether a speech is the first stretch its mark gives on its line. */
function firstOfMark(line: Line, speech: Speech): boolean {
  return !speechesOf(line).some(
    (other) =>
      other !== speech && other.mark === speech.mark && other.range.from < speech.range.from,
  );
}

/**
 * The first speech later on the line that carries this one on (§5.6). The ones after it carry
 * that one on in turn, so a mark on it keeps them all.
 */
function carriedOn(line: Line, speech: Speech): Speech | undefined {
  let between = false;
  for (const other of speechesOf(line)) {
    if (other.range.from <= speech.range.from || !other.quoted) continue;
    if (other.continued && other.speaker === speech.speaker && !between) return other;
    // Another quoted speech ended in between: later quotes carry that one on instead.
    if (other.mark !== speech.mark) return undefined;
    between = true;
  }
  return undefined;
}

/**
 * A mark written at `at`, with the space after it §13.3 writes, unless the space would show in the
 * book: between two characters with no space between them (`„Guten Morgen“@(leise), sagte`,
 * `”@Ann—he`) a mark goes without one. Where a name would then run on into what follows
 * (`”@AnnHe`), the edit reads it back, hears it differently and declines, as it would have to
 * with the space.
 */
export function markAt(source: string, at: number, mark: string): string {
  const before = source[at - 1];
  const next = source[at];
  const spaced = before === undefined || next === undefined || /\s/.test(before + next);
  return spaced ? `${mark} ` : mark;
}

/**
 * Where a new name goes before words glued to a page turn, note or image (`{page}Hello`): before
 * that, where the space after the name, or none, can't show in the book. Elsewhere, `at` itself.
 */
function beforeGlued(story: Story, line: Line, at: number): number {
  const source = story.source;
  const glued = (where: number) =>
    !/\s/.test(source[where - 1] ?? " ") && /[\p{L}\p{N}\p{M}_'’(\[@-]/u.test(source[where] ?? " ");
  if (!glued(at)) return at;
  let where = at;
  for (;;) {
    const item = line.items.find(
      (other) =>
        other.range.to === where &&
        (other.kind === "instruction" || other.kind === "note" || other.kind === "image"),
    );
    if (!item) return at;
    where = item.range.from;
    if (/\s/.test(source[where - 1] ?? " ") || where === line.range.from) return where;
  }
}

/** A mark for `speaker` with an optional direction, as §13.3 writes it. */
function markText(speaker: string, direction: string | null): string {
  return direction ? `@${speaker} (${directionText(direction)})` : `@${speaker}`;
}

/**
 * Gives a stretch of speech or narration to another character (§13.4). The name is written as
 * the cast spells it. Later quotes on the line that carried the speech on keep their speaker.
 * Like every edit here, it changes only what it says it does: where that can't be done without
 * changing other words or voices, it returns no changes.
 */
export function setSpeaker(story: Story, speech: Speech, name: string): TextChange[] {
  return session(() => setSpeakerNow(story, speech, name));
}

function setSpeakerNow(story: Story, speech: Speech, name: string): TextChange[] {
  // A stretch with no letter or digit in it isn't heard (§12.1): nothing to give.
  if (!hasLetterOrDigit(speech.text)) return [];
  // A later paragraph of an unmarked speech over paragraphs is given with the whole speech.
  const origin = narrationOrigin(story, speech);
  if (origin) return setSpeaker(story, origin, name);
  // A quote is given away whole, with the sounds made inside it.
  const { stretches, items: quote } = quoteOf(story, speech, true);
  const first = stretches[0] as Speech;
  const key = nameKey(name);
  const spelling = spelled(story, name);
  // Narration that holds quotes gives them, with the new mark directly before the first (§13.3):
  // the first quote goes whole, a quote after it may go with it (§5.6), and the narrator's own
  // words stay the narrator's.
  const quotes = quotesWithin(story, first);
  const opening = quotes[0];
  if (opening) {
    const inQuote = (at: number) => quotes.some((range) => at >= range.from && at < range.to);
    // A quote the narration leaves open will go on in the paragraphs that open with its mark
    // (§5.7), once it is someone's: they go with it.
    const last = quotes[quotes.length - 1] as Quote;
    const { stretches: carried, reach } = last.closed
      ? { stretches: [] as Speech[], reach: [] as Range[] }
      : narrationCarrying(story, narrationRun(story, first).at(-1) as Speech, last);
    // The rest of the narration's run, and sounds made inside its quotes for whoever is
    // speaking, go with them.
    const rest = narrationRun(story, first).slice(1);
    const sounds = place(story, first).line.items.filter(
      (item) => item.kind === "vocal" && !item.mark && inQuote(item.range.from),
    );
    // The first quote's words must go; where it seems to run on (lines, paragraphs), they may,
    // as the parser reads it once the quote is someone's: never forced with marks of their own.
    const firstQuote = (at: number) => at >= opening.from && at < opening.to;
    const runsOn = (at: number) => reach.some((range) => at >= range.from && at < range.to);
    const mayGo = (at: number) => inQuote(at) || runsOn(at);
    const given = settled(
      story,
      [...new Set([...quote, ...rest, ...sounds, ...carried])],
      speakerChanges(story, first, name, opening.from),
      {
        inside: (was, now) =>
          (firstQuote(was.at)
            ? nameKey(now.speaker) === key
            : mayGo(was.at)
              ? nameKey(now.speaker) === key || sameName(now.speaker, was.speaker)
              : sameName(now.speaker, was.speaker)) && now.direction === was.direction,
        wanted: (was, now) => ({
          speaker:
            firstQuote(was.at) || (mayGo(was.at) && nameKey(now.speaker) === key)
              ? spelling
              : was.speaker,
          direction: was.direction,
        }),
        some: (now) => now.some((char) => nameKey(char.speaker) === key),
      },
    );
    // A quote with no words to give: the stretch goes whole instead.
    if (given.length > 0) return given;
  }
  // Anything else goes whole: every word of the stretch, said as before.
  const whole: Promise = {
    inside: (was, now) => nameKey(now.speaker) === key && now.direction === was.direction,
    wanted: (was) => ({ speaker: spelling, direction: was.direction }),
  };
  // Narration between a mark and the quote it gives (`@Gerald Gerald put on his spectacles.
  // “I thought…”`, §5.4): a new mark before it would claim that quote instead, so the mark there
  // becomes the new speaker's, who says the rest of the line up to the next mark, and the mark
  // it was goes before its quote, as written.
  const ahead = markAhead(story, first);
  // Narration that runs on over a mark to its quote (`He turned. @Waiter (softly) He bowed low,
  // “Bonjour.”`, §5.4): the new speaker's mark goes before it, and the one inside it before its
  // quote, so the new speaker says all of it up to there.
  const across = markAcross(story, first);
  if (across) {
    const { mark, quote: given } = across;
    const at = given.openQuote?.from ?? given.range.from;
    const start = first.textRange.from;
    const moved = settled(
      story,
      quote,
      [
        { from: start, to: start, insert: markAt(story.source, start, markText(spelling, null)) },
        { ...removeWithSpace(story.source, mark.range), insert: "" },
        {
          from: at,
          to: at,
          insert: markAt(story.source, at, story.source.slice(mark.range.from, mark.range.to)),
        },
      ],
      whole,
    );
    if (moved.length > 0) return moved;
  }
  if (ahead) {
    const { mark, quote: given } = ahead;
    const at = given.openQuote?.from ?? given.range.from;
    const moved = settled(
      story,
      quote,
      [
        { ...mark.range, insert: markText(spelling, null) },
        {
          from: at,
          to: at,
          insert: markAt(story.source, at, story.source.slice(mark.range.from, mark.range.to)),
        },
      ],
      whole,
    );
    if (moved.length > 0) return moved;
  }
  return settled(story, quote, speakerChanges(story, first, name), whole);
}

/**
 * A mark inside a stretch of narration, which the narration runs on over, and the quote after the
 * stretch that it gives; null if there is none.
 */
function markAcross(story: Story, speech: Speech): { mark: Mark; quote: Speech } | null {
  if (speech.quoted || speech.mark || speech.directionMark) return null;
  const { line } = place(story, speech);
  const mark = line.items.find(
    (item): item is Mark =>
      item.kind === "mark" &&
      item.range.from > speech.textRange.from &&
      item.range.to <= speech.textRange.to,
  );
  if (!mark) return null;
  const quote = line.items.find(
    (item): item is Speech =>
      item.kind === "speech" &&
      item.mark === mark &&
      item.quoted &&
      item.range.from >= speech.range.to,
  );
  return quote ? { mark, quote } : null;
}

/**
 * The mark just before a stretch of narration on its line, with nothing heard between them, and
 * the quote later on the line it gives (§5.4); null if the stretch isn't between the two.
 */
function markAhead(story: Story, speech: Speech): { mark: Mark; quote: Speech } | null {
  if (speech.quoted || speech.mark || speech.directionMark) return null;
  const { line } = place(story, speech);
  const index = line.items.indexOf(speech);
  let mark: Mark | undefined;
  for (let i = index - 1; i >= 0 && !mark; i--) {
    const item = line.items[i] as Item;
    if (item.kind === "mark") mark = item;
    else if (item.kind === "speech" || item.kind === "vocal" || item.kind === "direction") {
      return null;
    }
  }
  if (!mark) return null;
  const quote = line.items
    .slice(index + 1)
    .find((item): item is Speech => item.kind === "speech" && item.mark === mark && item.quoted);
  return quote ? { mark, quote } : null;
}

/**
 * In narration nothing marks, the quotes it holds, as the parser reads them: where each opens and
 * where it closes (or the stretch ends). A character's own words in a group keep their quotes
 * (§7.2), so only the narrator's are looked in.
 */
function quotesWithin(story: Story, speech: Speech): Quote[] {
  if (speech.quoted || speech.mark) return [];
  if (nameKey(speech.speaker) !== nameKey(story.meta.narrator)) return [];
  const run = narrationRun(story, speech);
  const from = speech.textRange.from;
  const to = (run[run.length - 1] as Speech).textRange.to;
  const quotes: Quote[] = [];
  // Quotes that open in the stretch itself, and may close further on in its run.
  for (const token of lexedTokens(story.source)) {
    if (token.range.from < from || token.range.from >= to) continue;
    if (token.type === "open" && token.range.from >= speech.textRange.to) break;
    if (token.type === "open") quotes.push({ from: token.range.from, to, closed: false });
    else if (token.type === "close" && quotes.length > 0) {
      const quote = quotes[quotes.length - 1] as Quote;
      quote.to = token.range.to;
      quote.closed = true;
    }
  }
  return quotes;
}

/**
 * Narration that a sound, page turn or note splits on its line is one run: a quote in it can go
 * on past them. It ends at a mark, a direction, or someone else's words.
 */
function narrationRun(story: Story, speech: Speech): Speech[] {
  const { line } = place(story, speech);
  const run: Speech[] = [speech];
  for (const item of line.items.slice(line.items.indexOf(speech) + 1)) {
    if (item.kind === "mark" || item.kind === "direction") break;
    if (item.kind !== "speech") continue;
    if (item.quoted || item.mark || item.directionMark || !sameName(item.speaker, speech.speaker)) {
      break;
    }
    run.push(item);
  }
  return run;
}

/** A quote inside narration: where it opens and ends, and whether its closing mark is there. */
type Quote = Range & { closed: boolean };

function speakerChanges(
  story: Story,
  speech: Speech,
  name: string,
  quoteAt?: number,
): TextChange[] {
  checkName(name);
  const speaker = spelled(story, name);
  if (nameKey(speaker) === nameKey(speech.speaker)) return [];
  const { line, groups } = place(story, speech);
  const changes: TextChange[] = [];
  const keep = (other: Speech) => {
    const own = ownDirectionMark(story, other);
    if (own) {
      changes.push({ ...own, insert: markText(speech.speaker, other.ownDirection) });
    } else if (other.openQuote) {
      const at = other.openQuote.from;
      const insert = markAt(story.source, at, markText(speech.speaker, other.ownDirection));
      changes.push({ from: at, to: at, insert });
    }
  };
  const own = ownDirectionMark(story, speech);
  const base = baseSpeaker(groups, story.meta.narrator);
  const toBase = nameKey(speaker) === nameKey(base);
  // A group's direction is its own character's (§7.2): given to someone else, the stretch keeps
  // it in the new mark, written the one way §13.3 gives (`@Zed (sighing)`).
  const fromGroup =
    speech.ownDirection === null &&
    speech.direction !== null &&
    nameKey(speech.speaker) === nameKey(base) &&
    nameKey(base) !== nameKey(story.meta.narrator);
  const how = speech.ownDirection ?? (fromGroup ? speech.direction : null);
  if (speech.mark && !speech.continued && firstOfMark(line, speech) && !sharesMark(line, speech)) {
    const mark = speech.mark;
    if (toBase && !speech.quoted) {
      // Narration needs no mark: `@Gerald (dry) Well.` becomes `@(dry) Well.`
      if (mark.directionRange) {
        changes.push({ from: mark.range.from, to: mark.directionRange.from, insert: "@" });
      } else {
        changes.push({ ...removeWithSpace(story.source, mark.range), insert: "" });
      }
    } else if (fromGroup && !mark.directionRange && how) {
      changes.push({ ...mark.nameRange, insert: `${speaker} (${directionText(how)})` });
    } else {
      changes.push({ ...mark.nameRange, insert: speaker });
    }
  } else if (own) {
    // `@(quieter) “Oh dear.”` becomes `@Gerald (quieter) “Oh dear.”`; `@()Well` becomes `@Gerald Well`.
    const spaced =
      speech.ownDirection === null && !/^\s/.test(story.source.slice(own.to, own.to + 1));
    changes.push({
      ...own,
      insert: `${markText(speaker, speech.ownDirection)}${spaced ? " " : ""}`,
    });
  } else {
    // A quote carried on from a mark keeps how it is said: `@Zed (yawning) “Very.”`.
    const at = speech.openQuote?.from ?? quoteAt ?? beforeGlued(story, line, speech.textRange.from);
    changes.push({ from: at, to: at, insert: markAt(story.source, at, markText(speaker, how)) });
  }
  // Words that open with `(` would read as the new mark's direction: `@Gerald \(sighs)`.
  if (!speech.quoted && quoteAt === undefined && story.source[speech.textRange.from] === "(") {
    const at = speech.textRange.from;
    changes.push({ from: at, to: at, insert: "\\" });
  }
  const next = carriedOn(line, speech);
  if (next) keep(next);
  // A character's words in a group may hold a quote (§7.2): a mark at their start would claim
  // just the quote, so the quote gets the new speaker's mark too.
  if (!speech.quoted && quoteAt === undefined) {
    const inner = lexedTokens(story.source).find(
      (token) =>
        token.type === "open" &&
        token.range.from > speech.textRange.from &&
        token.range.from < speech.textRange.to,
    );
    if (inner) {
      const at = inner.range.from;
      const mark = markText(speaker, how);
      changes.push({ from: at, to: at, insert: markAt(story.source, at, mark) });
    }
  }
  // Words without quotes are the new speaker's only if no quote follows them on the line: the
  // next quote gets a mark of its own, so it keeps its speaker (`@Baker said the baker. @Baker “…”`).
  if (!speech.quoted && quoteAt === undefined && !next) {
    const following = speechesOf(line).find(
      (other) => other.quoted && other.range.from >= speech.range.to,
    );
    const ownMark = following?.mark !== undefined && following.mark.range.from >= speech.range.to;
    if (following?.openQuote && !ownMark) {
      const at = following.openQuote.from;
      const mark = markText(spelled(story, following.speaker), following.ownDirection);
      changes.push({ from: at, to: at, insert: markAt(story.source, at, mark) });
    }
  }
  return changes.sort((a, b) => a.from - b.from || a.to - b.to);
}

/**
 * Sets how a stretch is said (§13.3), or removes its own direction with `null` (§13.5). A
 * direction a group gives can't be removed this way; give the stretch another one instead.
 */
export function setDirection(story: Story, speech: Speech, direction: string | null): TextChange[] {
  return session(() => setDirectionNow(story, speech, direction));
}

/** The voice a line has of its own at `at`: the innermost character group's, else the narrator (§7.2). */
function baseVoiceAt(story: Story, at: number): string {
  let base = story.meta.narrator;
  let innermost = -1;
  for (const group of story.groups) {
    // A group runs from its opening line to its closing one, or to the end (§7).
    const end = group.closeRange?.from ?? story.source.length;
    if (!group.character || group.range.from > at || at > end) continue;
    if (group.range.from > innermost) {
      innermost = group.range.from;
      base = group.character;
    }
  }
  return base;
}

/**
 * The words between `from` and `to`, within one line, widened to whole words and the marks that
 * close them (`circulation.`, `*softly*`), for an edit of those words alone. Undefined across a
 * line break, or with no letter or digit in it.
 */
function wordsWithin(source: string, from: number, to: number): Range | undefined {
  const word = /[\p{L}\p{N}\p{M}_'’-]/u;
  let start = Math.max(0, Math.min(from, to));
  let end = Math.max(from, to);
  if (/[\r\n]/.test(source.slice(start, end))) return undefined;
  while (start < end && /\s/.test(source[start] ?? "")) start++;
  while (end > start && /\s/.test(source[end - 1] ?? "")) end--;
  while (start > 0 && word.test(source[start - 1] ?? "") && word.test(source[start] ?? "")) start--;
  while (word.test(source[end] ?? "") && word.test(source[end - 1] ?? "")) end++;
  while (/[\p{Pe}\p{Pf}.,;:!?…*_]/u.test(source[end] ?? "")) end++;
  return /[\p{L}\p{N}]/u.test(source.slice(start, end)) ? { from: start, to: end } : undefined;
}

/**
 * Gives the words between `from` and `to` to `name`, and nothing else: on each line (marks work a
 * line at a time, §5.3), a mark before them, the marks inside them taken out, and after them
 * whatever gives the rest of the line back as it was, `@/` for the line's own voice, the narrator
 * or a group's character (§5.9). A quote is said by one voice: words in one can't be given to
 * someone else without new quotation marks. All of it, or no changes.
 */
export function setSpeakerWithin(
  story: Story,
  from: number,
  to: number,
  name: string,
): TextChange[] {
  return session(() => byLines(story, from, to, (line, a, b) => speakerInLine(line, a, b, name)));
}

/**
 * Says the words between `from` and `to` as `direction` (or with no direction of their own,
 * `null`), and nothing else: on each line, `@(…)` before them, and after them whatever gives the
 * rest back as it was said, `@()` or the direction it had (§6.2, §6.3). Inside a quote too.
 */
export function setDirectionWithin(
  story: Story,
  from: number,
  to: number,
  direction: string | null,
): TextChange[] {
  return session(() =>
    byLines(story, from, to, (line, a, b) => directionInLine(line, a, b, direction)),
  );
}

/**
 * An edit of the words between `from` and `to`, line by line, from the last line to the first so
 * that the places before stay as they were. `edit` gives a line's changes, none where nothing
 * needs changing, or null where it can't be done; then nothing is changed.
 */
function byLines(
  story: Story,
  from: number,
  to: number,
  edit: (story: Story, from: number, to: number) => TextChange[] | null,
): TextChange[] {
  const source = story.source;
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const segments: Array<[number, number]> = [];
  for (let at = start; at < end; ) {
    const lineEnd = source.indexOf("\n", at);
    const stop = lineEnd < 0 || lineEnd >= end ? end : lineEnd;
    segments.push([at, stop]);
    at = stop + 1;
  }
  if (segments.length === 1) {
    const [a, b] = segments[0] as [number, number];
    return edit(story, a, b) ?? [];
  }
  let current = story;
  let changed = false;
  for (const [a, b] of segments.reverse()) {
    const changes = edit(current, a, b);
    if (changes === null) return [];
    if (changes.length === 0) continue;
    current = parsed(applyChanges(current.source, changes));
    changed = true;
  }
  if (!changed) return [];
  // One change, from the first character changed to the last.
  const before = story.source;
  const after = current.source;
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail++;
  return [{ from: head, to: before.length - tail, insert: after.slice(head, after.length - tail) }];
}

/** Who says a few words of one line: see `setSpeakerWithin`. */
function speakerInLine(story: Story, from: number, to: number, name: string): TextChange[] | null {
  const span = wordsWithin(story.source, from, to);
  if (!span) return [];
  const within = (char: Heard) => char.at >= span.from && char.at < span.to;
  const chars = heard(story).filter(within);
  if (chars.length === 0) return [];
  if (chars.some((char) => char.item.kind !== "speech" || char.item.quoted)) return null;
  const speaker = spelled(story, name);
  if (chars.every((char) => sameName(char.speaker, speaker))) return [];
  const source = story.source;
  // The marks inside the words go, with the space after each: they are all one voice's now. A
  // mark that gives a character's sound stays with it.
  const line = place(story, (chars[0] as Heard).item).line;
  const sounds = new Set(
    line.items.flatMap((item) => (item.kind === "vocal" && item.mark ? [item.mark] : [])),
  );
  const removed = line.items
    .filter(
      (item) =>
        ((item.kind === "mark" && !sounds.has(item)) || item.kind === "end") &&
        item.range.from >= span.from &&
        item.range.to <= span.to,
    )
    .map((item) => ({
      from: item.range.from,
      to: item.range.to + (source[item.range.to] === " " ? 1 : 0),
      insert: "",
    }));
  const at = span.from;
  const name_ = markAt(source, at, `@${speaker}`);
  const first = removed[0];
  const opening =
    first && first.from === at
      ? [{ ...first, insert: name_ }, ...removed.slice(1)]
      : [{ from: at, to: at, insert: name_ }, ...removed];
  const promise = {
    inside: (_was: Heard, now: Heard) => sameName(now.speaker, speaker),
    wanted: () => ({ speaker, direction: null }),
  };
  // The mark alone, the voices after the words given back where they changed.
  const alone = settled(story, within, opening, promise);
  if (alone.length) return alone;
  // A quote further on the line took the mark (§5.4): `@/` straight after the words keeps it
  // from it, where the line's own voice speaks next (§5.9).
  const lineEnd = source.indexOf("\n", span.to);
  const end = lineEnd < 0 ? source.length : lineEnd;
  let next = span.to;
  while (next < end && /\s/.test(source[next] ?? "")) next++;
  const after = heard(story).find((char) => char.at >= next && char.at < end);
  if (!after || !sameName(after.speaker, baseVoiceAt(story, next))) return null;
  const back = { from: next, to: next, insert: markAt(source, next, "@/") };
  const closed = settled(story, within, [...opening, back], promise);
  return closed.length ? closed : null;
}

/** How a few words of one line are said: see `setDirectionWithin`. */
function directionInLine(
  story: Story,
  from: number,
  to: number,
  direction: string | null,
): TextChange[] | null {
  const span = wordsWithin(story.source, from, to);
  if (!span) return [];
  const within = (char: Heard) => char.at >= span.from && char.at < span.to;
  const chars = heard(story).filter(within);
  if (chars.length === 0) return [];
  const value = direction?.replace(/\s+/g, " ").trim() || null;
  if (value !== null && chars.every((char) => char.direction === value)) return [];
  const at = span.from;
  const mark = value ? `@(${directionText(value)})` : "@()";
  const changes = settled(
    story,
    within,
    [{ from: at, to: at, insert: markAt(story.source, at, mark) }],
    {
      inside: (was, now) =>
        sameName(now.speaker, was.speaker) && (value === null || now.direction === value),
      wanted: (was, now) => ({ speaker: was.speaker, direction: value ?? now.direction }),
    },
  );
  return changes.length ? changes : value === null ? [] : null;
}

function setDirectionNow(story: Story, speech: Speech, direction: string | null): TextChange[] {
  // A stretch with no letter or digit in it isn't heard (§12.1): nothing to say differently.
  if (!hasLetterOrDigit(speech.text)) return [];
  // To its closing mark, or to the next `@(…)` inside it.
  const { stretches, items: quote } = quoteOf(story, speech, false);
  const changes = directionChanges(story, stretches[0] as Speech, direction);
  const value = direction?.replace(/\s+/g, " ").trim() || null;
  return settled(story, quote, changes, {
    inside: (was, now) =>
      sameName(now.speaker, was.speaker) && (value === null || now.direction === value),
    wanted: (was, now) => ({ speaker: was.speaker, direction: value ?? now.direction }),
  });
}

// What an edit may change: every character a listener hears, and who says it and how

/**
 * Spaces and punctuation (quotation marks, escapes' backslashes, a full stop) are not words: marks
 * may move them about, and a stretch left with nothing but punctuation isn't read aloud (§12.1).
 */
const NOT_WORDS = /[\s\p{P}]/u;
/** NOT_WORDS of the first 128 characters, looked up rather than matched: most text is these. */
const ASCII_NOT_WORDS = Array.from({ length: 128 }, (_, code) =>
  NOT_WORDS.test(String.fromCharCode(code)),
);
const notWord = (char: string) => {
  const code = char.charCodeAt(0);
  return code < 128 ? (ASCII_NOT_WORDS[code] as boolean) : NOT_WORDS.test(char);
};

type Voice = { speaker: string; direction: string | null };

/** One character a listener hears, in speech or in a character's sound, and who says it and how. */
type Heard = Voice & {
  char: string;
  /** Where it is in the source. */
  at: number;
  item: Speech | Vocal;
  /** Whether it is the first character heard of its item, so a mark can go before the item. */
  first: boolean;
  /** Whether it belongs to the stretch being edited. */
  target: boolean;
  /** Whether it is read aloud at all: its block isn't `{book only}` or `{hidden}` (§9.3). */
  audible: boolean;
};

function heard(story: Story, target: readonly Item[] = []): Heard[] {
  const all = heardCache.get(story) ?? hear(story);
  if (remembering()) {
    heardCache.set(story, all);
    hold(story);
  }
  if (target.length === 0) return all;
  const targets = new Set(target);
  return all.map((char) => (targets.has(char.item) ? { ...char, target: true } : char));
}

// What an edit reads again and again, kept while it works (session.ts): stories by their text,
// and what each is heard and printed as. The stories are never changed.
const heardCache = new WeakMap<Story, Heard[]>();
const bookCache = new WeakMap<Story, string>();
const recentStories: Story[] = [];
/**
 * The stories whose readings are kept, most recently used last, and only a few: the writer makes
 * change after change, and a long story's readings are large.
 */
const held = new Set<Story>();
function hold(story: Story): void {
  held.delete(story);
  held.add(story);
  if (held.size <= 6) return;
  const oldest = held.values().next().value as Story;
  held.delete(oldest);
  heardCache.delete(oldest);
  bookCache.delete(oldest);
}
onForget(() => {
  for (const story of held) {
    heardCache.delete(story);
    bookCache.delete(story);
  }
  held.clear();
  recentStories.length = 0;
});

/**
 * A text's story, parsed once while work is under way (session.ts). Never to be changed: it may be
 * handed to whoever asks for the same text. (For the writer; not part of the package's API.)
 */
export function parsed(text: string): Story {
  const known = recentStories.find((story) => story.source === text);
  if (known) return known;
  const story = parse(text);
  if (remembering()) {
    recentStories.unshift(story);
    if (recentStories.length > 8) recentStories.pop();
  }
  return story;
}

function bookOf(story: Story): string {
  const book = bookCache.get(story) ?? readBook(story);
  if (remembering()) {
    bookCache.set(story, book);
    hold(story);
  }
  return book;
}

function hear(story: Story, target: readonly Item[] = []): Heard[] {
  const out: Heard[] = [];
  const targets = new Set(target);
  for (const block of story.blocks) {
    if (block.kind === "break") continue;
    const audible = block.visibility === "both" || block.visibility === "audio";
    for (const line of block.kind === "heading" ? [block.line] : block.lines) {
      hearLine(story, line, audible, targets, out);
    }
  }
  return out;
}

/** What is heard of one line, added to `out`. */
function hearLine(
  story: Story,
  line: Line,
  audible: boolean,
  targets: ReadonlySet<Item>,
  out: Heard[],
): void {
  // Marks, directions, instructions and notes can sit inside a stretch's range: not heard.
  const unheard = line.items
    .filter((item) => item.kind !== "speech" && item.kind !== "vocal")
    .map((item) => item.range)
    .sort((a, b) => a.from - b.from);
  // Items come in order along the line, so the pointer into what isn't heard only moves on
  // (and starts over in the odd case that a stretch begins before the last one did).
  let next = 0;
  let previous = -1;
  for (const item of line.items) {
    let from: number;
    let to: number;
    // A stretch with no letter or digit in it isn't read aloud (§12.1), so it isn't heard.
    if (item.kind === "speech") {
      if (!hasLetterOrDigit(item.text)) continue;
      ({ from, to } = item.textRange);
    } else if (item.kind === "vocal") {
      from = story.source.indexOf("[", item.range.from) + 1;
      to = item.range.to - 1;
    } else continue;
    if (from < previous) next = 0;
    previous = from;
    let first = true;
    const isTarget = targets.has(item);
    for (let at = from; at < to; at++) {
      const char = story.source[at] as string;
      if (notWord(char)) continue;
      if (item.kind === "speech") {
        while (next < unheard.length && (unheard[next] as Range).to <= at) next++;
        const range = unheard[next];
        if (range && range.from <= at) continue;
      }
      out.push({
        char,
        at,
        item,
        first,
        target: isTarget,
        audible,
        speaker: item.speaker,
        direction: item.direction,
      });
      first = false;
    }
  }
}

const voiceOf = (item: Speech | Vocal): Voice => ({
  speaker: item.speaker,
  direction: item.direction,
});
const sameName = (a: string, b: string) => a === b || nameKey(a) === nameKey(b);

type Promise = {
  /** Whether a character of the edited stretch is said as the edit promises. */
  inside: (was: Heard, now: Heard) => boolean;
  /** The voice to give it back when it isn't. */
  wanted: (was: Heard, now: Heard) => Voice;
  /** Whether the edited stretch's characters, taken together, show the edit was made. */
  some?: (now: Heard[], before: Heard[]) => boolean;
};

/**
 * Makes an edit keep its promise. After the changes, every character heard must be the same and
 * in the same order, the edited stretch's said as `promise` says, and every other one said by the
 * same character in the same way. A mark can reach further than its stretch (words without quotes
 * run to the end of the line, a direction to the next speech, a quote carries over lines and
 * paragraphs), so wherever a voice changed, a mark of its own gives it back: `@Narrator`,
 * `@Gerald (yawning)`, `@(quieter)` or `@()`. If that can't be done, there are no changes.
 */
function settled(
  story: Story,
  target: readonly Item[] | ((char: Heard) => boolean),
  changes: TextChange[],
  promise: Promise,
): TextChange[] {
  if (changes.length === 0) return changes;
  const before =
    typeof target === "function"
      ? heard(story).map((char) => ({ ...char, target: target(char) }))
      : heard(story, target);
  let current = changes;
  let last = -1;
  for (let round = 0; round < 16; round++) {
    const result = kept(story, before, current, promise);
    if (result === "broken") return [];
    if (result === "kept") {
      // Marks are not printed: the book must read as it did. Nothing left to change is no edit.
      const done = tidied(story, before, current, promise).filter(
        (change) => story.source.slice(change.from, change.to) !== change.insert,
      );
      return done.length > 0 && sameBook(story, done) && noNewWarnings(story, done) ? done : [];
    }
    const { edited, now, voice } = result;
    // A mark that didn't help the first word said wrongly won't help the second time.
    const index = heard(edited).findIndex((char) => char.at === now.at);
    if (index <= last) return [];
    last = index;
    const fix = giveBack(edited, now, voice);
    const next = fix && editAt(current, fix.at, fix.at, fix.insert);
    if (!next) return [];
    current = next;
  }
  return [];
}

type Missed = { edited: Story; now: Heard; voice: Voice };

/**
 * Whether the changes keep the promise: "kept", "broken" (words changed, or the edit didn't
 * happen), or the first character said wrongly and the voice it should have.
 */
function kept(
  story: Story,
  before: readonly Heard[],
  changes: TextChange[],
  promise: Promise,
): "kept" | "broken" | Missed {
  let edited: Story;
  try {
    edited = parsed(applyChanges(story.source, changes));
  } catch {
    return "broken";
  }
  const after = heard(edited);
  // The same words, each read aloud or not as before: no edit changes what a listener hears.
  if (
    after.length !== before.length ||
    after.some((now, i) => now.char !== before[i]?.char || now.audible !== before[i]?.audible)
  ) {
    return "broken";
  }
  const wrong = before.findIndex((was, i) => {
    const now = after[i] as Heard;
    return was.target
      ? !promise.inside(was, now)
      : !sameName(now.speaker, was.speaker) || now.direction !== was.direction;
  });
  if (wrong >= 0) {
    const was = before[wrong] as Heard;
    const now = after[wrong] as Heard;
    return { edited, now, voice: was.target ? promise.wanted(was, now) : voiceOf(was.item) };
  }
  const edits = after.filter((_, i) => before[i]?.target);
  const was = before.filter((char) => char.target);
  return !promise.some || promise.some(edits, was) ? "kept" : "broken";
}

/**
 * The changes with nothing left over: a mark given back that turns out not to be needed is taken
 * out again, and so is a direction given back that the group around it gives anyway. Each removal
 * is kept only if the promise still holds.
 */
function tidied(
  story: Story,
  before: readonly Heard[],
  changes: TextChange[],
  promise: Promise,
): TextChange[] {
  // A mark the edit left claiming nothing would be a new `idle-mark` warning, which no edit
  // may bring (noNewWarnings): such an edit declines rather than be tidied here.
  let current = changes;
  // Marks given back that another one already covers.
  for (const change of [...current]) {
    if (change.from !== change.to || !change.insert.startsWith("@")) continue;
    const marks =
      change.insert.match(/@(?:\([^)]*\)|[\p{L}\p{N}_'’-]+(?: \([^)]*\))?) ?\\?/gu) ?? [];
    if (marks.length < 2 && current.length < 2) continue;
    for (const mark of marks) {
      const insert = change.insert.replace(mark, "");
      const next = current.map((other) => (other === change ? { ...other, insert } : other));
      if (insert === change.insert) continue;
      const without = next.filter((other) => other.from !== other.to || other.insert !== "");
      if (kept(story, before, without, promise) === "kept") {
        current = without;
        break;
      }
    }
  }
  // A name given back with a direction that the group around it gives anyway
  // (`::: whispering` … `@Narrator (whispering) [gasps]`): the name alone will do.
  for (const change of [...current]) {
    if (change.from !== change.to) continue;
    for (const match of change.insert.matchAll(/(?<=[\p{L}\p{N}_'’-]) \([^)]*\)/gu)) {
      const at = match.index ?? 0;
      const insert = change.insert.slice(0, at) + change.insert.slice(at + match[0].length);
      const next = current.map((other) => (other === change ? { ...other, insert } : other));
      if (kept(story, before, next, promise) === "kept") {
        current = next;
        break;
      }
    }
  }
  return current;
}

/**
 * Whether the changes leave no warning the story didn't have: an edit never makes a file worse.
 * That a new name isn't in the cast, or that someone in it no longer speaks, is what was asked.
 */
function noNewWarnings(story: Story, changes: readonly TextChange[]): boolean {
  const counts = (of: Story) => {
    const found = new Map<string, number>();
    for (const { code } of of.warnings) {
      if (code !== "unknown-character" && code !== "silent-cast-member") {
        found.set(code, (found.get(code) ?? 0) + 1);
      }
    }
    return found;
  };
  const before = counts(story);
  for (const [code, count] of counts(parsed(applyChanges(story.source, changes)))) {
    if (count > (before.get(code) ?? 0)) return false;
  }
  return true;
}

/** Whether the book reads the same after the changes: an edit adds or moves marks, never print. */
function sameBook(story: Story, changes: readonly TextChange[]): boolean {
  return bookOf(parsed(applyChanges(story.source, changes))) === bookOf(story);
}

/**
 * Where a speech or a character's sound is among everything heard, by its first character: edits
 * never move words, so this finds the same item again after other edits. -1 for an item with no
 * words in it. (For the writer; not part of the package's API.)
 */
export function heardIndex(story: Story, item: Speech | Vocal): number {
  return heard(story).findIndex((char) => char.item === item);
}

/**
 * Who says each character heard, and how, in order (for the writer; not part of the package's
 * API).
 */
export function heardVoices(story: Story): Voice[] {
  return heard(story).map((char) => ({ speaker: char.speaker, direction: char.direction }));
}

/** Whether two stories have the same words heard, each said by the same character in the same way. */
export function sameHearing(a: Story, b: Story): boolean {
  return sameHeard(heard(a), heard(b));
}

/**
 * Where, in `a`'s text, words are heard differently in `b`: each character said by someone else
 * or in another way, or, if the words themselves differ, the first that does. (For the formatter;
 * not part of the package's API.)
 */
export function hearingDifferences(a: Story, b: Story): number[] {
  const first = heard(a);
  const second = heard(b);
  const differences: number[] = [];
  for (const [i, was] of first.entries()) {
    const now = second[i];
    if (!now || now.char !== was.char) return [...differences, was.at];
    if (
      !sameName(now.speaker, was.speaker) ||
      now.direction !== was.direction ||
      now.audible !== was.audible
    ) {
      differences.push(was.at);
    }
  }
  if (second.length > first.length) differences.push(a.source.length);
  return differences;
}

/** The same characters, each said by the same character in the same way. */
function sameHeard(first: readonly Heard[], second: readonly Heard[]): boolean {
  return (
    first.length === second.length &&
    first.every((was, i) => {
      const now = second[i] as Heard;
      return (
        now.char === was.char &&
        sameName(now.speaker, was.speaker) &&
        now.direction === was.direction &&
        now.audible === was.audible
      );
    })
  );
}

/** The speech or sound whose first character is at `index` among everything heard. */
export function heardItem(story: Story, index: number): Speech | Vocal | undefined {
  return heard(story)[index]?.item;
}

/** Where, and with what mark, a character heard gets `voice` back: before its stretch or sound. */
function giveBack(story: Story, char: Heard, voice: Voice): { at: number; insert: string } | null {
  const source = story.source;
  const item = char.item;
  let at: number;
  const sameSpeaker = sameName(voice.speaker, item.speaker);
  if (char.first) {
    at = item.kind === "speech" ? (item.openQuote?.from ?? item.textRange.from) : item.range.from;
    // A paragraph that carries a speech on must open with the quote's mark: a direction of its
    // own goes just inside it (`“@()Will you…`).
    if (item.kind === "speech" && sameSpeaker && item.openQuote && carriesParagraph(story, item)) {
      at = item.openQuote.to;
    }
    if (item.kind === "speech" && !item.openQuote)
      at = beforeGlued(story, place(story, item).line, at);
  } else {
    // Within a stretch, a mark needs no letter or digit straight before it (§5.2).
    at = char.at;
    if (/[\p{L}\p{N}]/u.test(source[at - 1] ?? "")) return null;
  }
  const direction = voice.direction ? `@(${directionText(voice.direction)})` : "@()";
  // A sound for whoever is speaking (`@[giggles]`) keeps its voice by taking a name of its own:
  // `@Narrator [giggles]`.
  if (item.kind === "vocal" && !item.mark) {
    const name = spelled(story, voice.speaker);
    const how = voice.direction ? ` (${directionText(voice.direction)})` : "";
    return { at: item.range.from + 1, insert: `${name}${how} ` };
  }
  // Words that open with `(` would read as a new name's direction: they are escaped.
  const escaped = !sameSpeaker && source[at] === "(";
  // The line's own voice back, plainly, in words without quotes: `@/` (§5.9).
  const narratorBack =
    item.kind === "speech" &&
    !item.quoted &&
    !sameSpeaker &&
    voice.direction === null &&
    sameName(voice.speaker, baseVoiceAt(story, at));
  const mark =
    item.kind === "speech" && sameSpeaker
      ? direction
      : narratorBack
        ? "@/"
        : markText(spelled(story, voice.speaker), voice.direction);
  const insert = markAt(source, at, mark) + (escaped ? "\\" : "");
  return { at, insert };
}

/**
 * Adds a change given in the places of the text the changes make (`from`–`to` replaced by
 * `insert`) to the changes, which are made against the original. A change next to or inside
 * another's own text edits that text; one that crosses its edge can't be made.
 */
function editAt(
  changes: TextChange[],
  from: number,
  to: number,
  insert: string,
): TextChange[] | null {
  const sorted = [...changes].sort((a, b) => a.from - b.from || a.to - b.to);
  let delta = 0;
  for (const [index, change] of sorted.entries()) {
    const start = change.from + delta;
    const end = start + change.insert.length;
    const within = from >= start && to <= end && (from === to ? change.insert.length > 0 : true);
    if (from === to ? from < start : to <= start) break;
    if (within) {
      // In this change's own text, or at its edges: edit that text.
      const text = change.insert;
      sorted[index] = {
        ...change,
        insert: text.slice(0, from - start) + insert + text.slice(to - start),
      };
      return sorted;
    }
    if (from < end && to > start) return null;
    delta += change.insert.length - (change.to - change.from);
  }
  const at = from - delta;
  return [...sorted, { from: at, to: at + (to - from), insert }].sort(
    (a, b) => a.from - b.from || a.to - b.to,
  );
}

/** The changes for a new direction, before the stretches after it are kept as they were. */
function directionChanges(story: Story, speech: Speech, direction: string | null): TextChange[] {
  const value = direction?.replace(/\s+/g, " ").trim() || null;
  if (value === speech.ownDirection) return [];
  const { line, groups } = place(story, speech);
  const own = ownDirectionMark(story, speech);
  // A mark that also gives a sound of the character's before this stretch keeps its direction,
  // and one on an earlier line (a quote over lines) is no longer this stretch's to change.
  const markFirst =
    speech.mark &&
    line.items.includes(speech.mark) &&
    !speech.continued &&
    firstOfMark(line, speech) &&
    !sharesMark(line, speech);

  if (value !== null) {
    const text = directionText(value);
    if (own) return [{ from: own.from + 2, to: own.to - 1, insert: text }];
    if (markFirst && speech.mark) {
      const range = speech.mark.directionRange;
      if (range) return [{ from: range.from + 1, to: range.to - 1, insert: text }];
      const at = speech.mark.nameRange.to;
      return [{ from: at, to: at, insert: ` (${text})` }];
    }
    // A paragraph that carries a speech on keeps the quote's mark first (§5.7), as does one that
    // carries an unmarked speech's quote on.
    const at = speech.openQuote
      ? carriesParagraph(story, speech)
        ? speech.openQuote.to
        : speech.openQuote.from
      : narrationOrigin(story, speech)
        ? speech.textRange.from + 1
        : speech.textRange.from;
    return [{ from: at, to: at, insert: markAt(story.source, at, `@(${text})`) }];
  }

  if (speech.ownDirection === null) return [];
  if (own) {
    // Without its `@(…)`, the stretch would fall back to its mark's or the carried direction.
    const fallback =
      speech.mark && !speech.continued
        ? previousOfMark(line, speech)
        : carriedDirection(line, speech);
    return fallback === null
      ? [{ ...removeWithSpace(story.source, own), insert: "" }]
      : [{ ...own, insert: "@()" }];
  }
  if (markFirst && speech.mark?.directionRange) {
    const mark = speech.mark;
    const needed =
      speech.quoted ||
      nameKey(speech.speaker) !== nameKey(baseSpeaker(groups, story.meta.narrator));
    if (!needed) return [{ ...removeWithSpace(story.source, mark.range), insert: "" }];
    const directionRange = mark.directionRange as Range;
    return [{ from: mark.nameRange.to, to: directionRange.to, insert: "" }];
  }
  // A direction carried over from the speech this one carries on.
  if (speech.openQuote) {
    const at = carriesParagraph(story, speech) ? speech.openQuote.to : speech.openQuote.from;
    return [{ from: at, to: at, insert: markAt(story.source, at, "@()") }];
  }
  return [];
}

function allLines(story: Story): Line[] {
  return story.blocks.flatMap((block) =>
    block.kind === "break" ? [] : block.kind === "heading" ? [block.line] : block.lines,
  );
}

/** The direction a stretch of a mark's speech would have without its `@(…)`: the one before. */
function previousOfMark(line: Line, speech: Speech): string | null {
  const before = speechesOf(line).filter(
    (other) => other.mark === speech.mark && other.range.from < speech.range.from,
  );
  const previous = before[before.length - 1];
  return previous ? previous.ownDirection : (speech.mark?.direction ?? null);
}

/** The direction a carried-on speech would have without a `@(…)` of its own. */
function carriedDirection(line: Line, speech: Speech): string | null {
  if (!speech.continued) return null;
  const before = speechesOf(line).filter(
    (other) => other.quoted && other.range.to <= speech.range.from,
  );
  return before[before.length - 1]?.ownDirection ?? null;
}

/** A range widened by one space after it, or else one before it (§13.5). */
function removeWithSpace(source: string, range: Range): Range {
  if (source[range.to] === " ") return { from: range.from, to: range.to + 1 };
  if (source[range.from - 1] === " ") return { from: range.from - 1, to: range.to };
  return range;
}

/**
 * Renames a character's short name, the word after `@` (§13.6): in the cast, the `narrator:` key
 * and every mark. Their full name is left alone.
 */
export function renameCharacter(story: Story, from: string, to: string): TextChange[] {
  return session(() => renameCharacterNow(story, from, to));
}

function renameCharacterNow(story: Story, from: string, to: string): TextChange[] {
  checkName(to);
  const key = nameKey(from);
  if (from === to) return [];
  // The same name in other capitals is this character, spelt anew (`Mcgregor` to `McGregor`):
  // only someone else of that name is in the way.
  const known = [
    story.meta.narrator,
    ...story.cast.map((member) => member.handle),
    ...heard(story).map((char) => char.speaker),
  ];
  if (key !== nameKey(to) && known.some((name) => nameKey(name) === nameKey(to))) {
    throw new RangeError(`There is already a character called “${to}”.`);
  }
  const changes: TextChange[] = [];
  const marks = [
    ...story.groups.flatMap((group) => (group.mark ? [group.mark] : [])),
    ...story.blocks.flatMap((block) => {
      if (block.kind === "break") return [];
      const lines = block.kind === "heading" ? [block.line] : block.lines;
      return lines.flatMap((line) => line.items.filter((item) => item.kind === "mark"));
    }),
  ];
  for (const mark of marks) {
    if (mark.kind === "mark" && nameKey(mark.speaker) === key) {
      changes.push({ ...mark.nameRange, insert: to });
    }
  }
  let narratorKey = false;
  for (const entry of frontMatterKeys(story)) {
    if (
      entry.path.length === 2 &&
      entry.path[0] === "cast" &&
      nameKey(entry.path[1] ?? "") === key
    ) {
      changes.push({ ...entry.range, insert: to });
    }
    if (entry.path.length === 1 && entry.path[0] === "narrator") {
      narratorKey = true;
      // The value as YAML reads it (quoted, escaped or a block scalar), written over whole.
      const setting = story.frontMatter?.data.narrator;
      if (typeof setting === "string" && nameKey(setting.trim()) === key)
        changes.push({ ...replaceValue(entry), insert: ` ${yamlScalar(to)}` });
    }
  }
  // The narrator renamed: narration follows only if the front matter names them.
  if (key === nameKey(story.meta.narrator) && !narratorKey) {
    changes.push(...setMeta(story, "narrator", to));
  }
  const sorted = changes.sort((a, b) => a.from - b.from);
  // Every word still said by the same character, now under the new name, and in the same way.
  const after = heard(parsed(applyChanges(story.source, sorted)));
  const before = heard(story);
  const same =
    after.length === before.length &&
    before.every((was, i) => {
      const now = after[i] as Heard;
      const speaker = nameKey(was.speaker) === key ? to : was.speaker;
      return (
        now.char === was.char && sameName(now.speaker, speaker) && now.direction === was.direction
      );
    });
  return same ? sorted : [];
}

/**
 * Sets a character's full name in the cast (§4.3, §13.6), adding the cast or the character to
 * the front matter when they aren't there yet. Nothing in the story changes.
 */
export function setFullName(story: Story, handle: string, name: string): TextChange[] {
  return session(() => setFullNameNow(story, handle, name));
}

function setFullNameNow(story: Story, handle: string, name: string): TextChange[] {
  checkName(handle);
  const changes = fullNameChanges(story, handle, name);
  // Read back: the character has the name, and everyone else in the cast is as they were.
  const after = parsed(applyChanges(story.source, changes)).cast;
  const key = nameKey(handle);
  const member = after.find((other) => nameKey(other.handle) === key);
  const others = (cast: Story["cast"]) =>
    cast
      .filter((other) => nameKey(other.handle) !== key)
      .map((other) => `${other.handle}=${other.name}`);
  const same = JSON.stringify(others(after)) === JSON.stringify(others(story.cast));
  return member?.name === name && same ? changes : [];
}

function fullNameChanges(story: Story, handle: string, name: string): TextChange[] {
  const keys = frontMatterKeys(story);
  const entry = keys.find(
    (k) =>
      k.path.length === 2 && k.path[0] === "cast" && nameKey(k.path[1] ?? "") === nameKey(handle),
  );
  if (!entry) {
    const written = spelled(story, handle);
    const value = name === written ? "" : ` ${yamlScalar(name)}`;
    return addToFrontMatter(story, ["cast"], `${written}:${value}`);
  }
  const value = writtenValue(entry);
  const current = story.source.slice(value.from, value.to);
  const nameKeyEntry = keys.find(
    (k) =>
      k.path.length === 3 &&
      k.path[0] === "cast" &&
      k.path[1] === entry.path[1] &&
      k.path[2] === "name",
  );
  if (nameKeyEntry) {
    return [{ ...replaceValue(nameKeyEntry), insert: ` ${yamlScalar(name)}` }];
  }
  const hasChildren = keys.some(
    (k) => k.path.length === 3 && k.path[0] === "cast" && k.path[1] === entry.path[1],
  );
  if (hasChildren) {
    const child = keys.find(
      (k) => k.path.length === 3 && k.path[0] === "cast" && k.path[1] === entry.path[1],
    ) as YamlEntry;
    const indent = lineIndent(story.source, child.range.from);
    const at = lineStart(story.source, child.range.from);
    return [{ from: at, to: at, insert: `${indent}name: ${yamlScalar(name)}${eol(story)}` }];
  }
  if (current.trim() === "" && name === entry.path[1]) return [];
  return [{ ...replaceValue(entry), insert: ` ${yamlScalar(name)}` }];
}

/**
 * Sets what the cast says about a character (`about`, §4.3): who they are and how they sound in
 * plain words; null or nothing takes it away. A character not in the cast is added to it, and one
 * written with a full name alone becomes a map keeping that name. Nothing in the story changes.
 */
export function setAbout(story: Story, handle: string, about: string | null): TextChange[] {
  return session(() => setAboutNow(story, handle, about));
}

function setAboutNow(story: Story, handle: string, about: string | null): TextChange[] {
  checkName(handle);
  const asked = about === null || about.trim() === "" ? null : about.trim();
  const changes = aboutChanges(story, handle, asked);
  if (changes.length === 0) return [];
  // Read back: the character says what was asked, with the same full name and everything else
  // they had, and everyone else in the cast is as they were.
  const key = nameKey(handle);
  const after = parsed(applyChanges(story.source, changes)).cast;
  const member = after.find((other) => nameKey(other.handle) === key);
  const before = story.cast.find((other) => nameKey(other.handle) === key);
  const rest = (data: Record<string, unknown> | undefined) =>
    JSON.stringify(
      Object.entries(data ?? {})
        .filter(([field]) => field !== "about" && field !== "name")
        .sort(),
    );
  const others = (cast: Story["cast"]) =>
    JSON.stringify(
      cast
        .filter((other) => nameKey(other.handle) !== key)
        .map((other) => [other.handle, other.name, other.about ?? null, rest(other.data)]),
    );
  const same =
    (member?.about ?? null) === asked &&
    (member?.name ?? handle) === (before?.name ?? handle) &&
    rest(member?.data) === rest(before?.data) &&
    others(after) === others(story.cast);
  return same ? changes : [];
}

function aboutChanges(story: Story, handle: string, about: string | null): TextChange[] {
  const nl = eol(story);
  const source = story.source;
  const keys = frontMatterKeys(story);
  const entry = keys.find(
    (k) =>
      k.path.length === 2 && k.path[0] === "cast" && nameKey(k.path[1] ?? "") === nameKey(handle),
  );
  if (!entry) {
    if (about === null) return [];
    // A new member, its `about` a step further in than the members.
    const cast = keys.find((k) => k.path.length === 1 && k.path[0] === "cast");
    const first = keys.find((k) => k.path.length === 2 && k.path[0] === "cast");
    const members = first
      ? lineIndent(source, first.range.from)
      : `${cast ? lineIndent(source, cast.range.from) : ""}  `;
    return addToFrontMatter(
      story,
      ["cast"],
      `${spelled(story, handle)}:${nl}${members}  about: ${yamlScalar(about)}`,
    );
  }
  const children = keys.filter(
    (k) => k.path.length === 3 && k.path[0] === "cast" && k.path[1] === entry.path[1],
  );
  const written = children.find((k) => k.path[2] === "about");
  if (written) {
    if (about !== null) return [{ ...replaceValue(written), insert: ` ${yamlScalar(about)}` }];
    // Its line or lines taken out whole.
    const from = lineStart(source, written.range.from);
    const end = replaceValue(written).to;
    const next = source.indexOf("\n", end);
    return [{ from, to: next < 0 ? end : next + 1, insert: "" }];
  }
  if (about === null) return [];
  const indent = lineIndent(source, entry.range.from);
  const first = children[0];
  if (first) {
    // After the full name when it comes first, else before the first of the rest.
    const child = lineIndent(source, first.range.from);
    const line = `${child}about: ${yamlScalar(about)}${nl}`;
    if (first.path[2] === "name") {
      const end = replaceValue(first).to;
      const next = source.indexOf("\n", end);
      if (next >= 0) return [{ from: next + 1, to: next + 1, insert: line }];
    }
    const at = lineStart(source, first.range.from);
    return [{ from: at, to: at, insert: line }];
  }
  // `Ann:` or `Ann: Ann Smith` becomes a map, the full name kept.
  const value = writtenValue(entry);
  const name = source.slice(value.from, value.to).trim();
  const member = story.cast.find((other) => nameKey(other.handle) === nameKey(handle));
  const named = name === "" ? "" : `${nl}${indent}  name: ${yamlScalar(member?.name ?? name)}`;
  return [
    { ...replaceValue(entry), insert: `${named}${nl}${indent}  about: ${yamlScalar(about)}` },
  ];
}

/**
 * Book details in the front matter: `title`, `subtitle`, `author`, `language`, `narrator`… set
 * to one value, or removed with null. A key whose value is a map or list (the cast) is left alone.
 */
export function setMeta(story: Story, key: string, value: string | null): TextChange[] {
  return session(() => setMetaNow(story, key, value));
}

function setMetaNow(story: Story, key: string, value: string | null): TextChange[] {
  // A detail is one value: a map or a list (the cast, a tool's own data) isn't set or removed
  // as one.
  const current = story.frontMatter?.data[key];
  if (typeof current === "object" && current !== null) return [];
  const changes = metaChanges(story, key, value);
  const asked = value === null ? undefined : value;
  // Read back: the detail is as asked, and every other detail and the cast as they were, so the
  // story is read as before (but for who narrates it, when that is the detail). The changes are
  // all in the front matter, so only it is read again.
  const body = bodyStart(story);
  if (changes.every((change) => change.to <= body)) {
    const front = parse(applyChanges(story.source.slice(0, body), changes)).frontMatter;
    const rest = (data: Record<string, unknown> | undefined) =>
      JSON.stringify(
        Object.entries(data ?? {})
          .filter(([other]) => other !== key)
          .sort(),
      );
    const same = front?.data[key] === asked && rest(front?.data) === rest(story.frontMatter?.data);
    return same ? changes : [];
  }
  const after = parsed(applyChanges(story.source, changes));
  const same =
    after.frontMatter?.data[key] === asked && (key === "narrator" || sameHearing(after, story));
  return same ? changes : [];
}

function metaChanges(story: Story, key: string, value: string | null): TextChange[] {
  const entry = frontMatterKeys(story).find((k) => k.path.length === 1 && k.path[0] === key);
  if (entry) {
    if (value === null) {
      const from = lineStart(story.source, entry.range.from);
      const end = replaceValue(entry).to;
      const to = story.source.indexOf("\n", end);
      return [{ from, to: to < 0 ? end : to + 1, insert: "" }];
    }
    return [{ ...replaceValue(entry), insert: ` ${yamlScalar(value)}` }];
  }
  if (value === null) return [];
  return addToFrontMatter(story, [], `${key}: ${yamlScalar(value)}`);
}

/**
 * Adds a sound after the word at `offset` (§13.3): one space, then the sound. An offset inside a
 * word moves to its end; inside a mark, a direction, an instruction, a note or another sound, past
 * it; and the sound never goes straight after a mark, where it would be the character's own
 * (§8.2), nor in the front matter. Returns no changes if the story would then be heard differently.
 */
export function insertSound(story: Story, offset: number, description: string): TextChange[] {
  return session(() => insertSoundNow(story, offset, description));
}

function insertSoundNow(story: Story, offset: number, description: string): TextChange[] {
  const source = story.source;
  inText(source, offset);
  if (description.trim() === "") return [];
  const items = allLines(story).flatMap((line) => line.items);
  let at = Math.max(offset, bodyStart(story));
  // A word ends at a space, or where a mark starts.
  const marks = new Map(
    items.flatMap((item) =>
      item.kind === "mark" || item.kind === "direction"
        ? [[item.range.from, item.range.to] as const]
        : [],
    ),
  );
  // On an empty line, or between a carriage return and its line feed, the sound belongs to the
  // words before: it goes back to them.
  while (
    at > 0 &&
    (source[at - 1] === "\r" ||
      (source[at - 1] === "\n" && /^\r?\n|^$/.test(source.slice(at, at + 2))))
  ) {
    at--;
  }
  // A link's text is one: a sound in it goes after the link.
  const links = lexedTokens(source).filter((token) => token.type === "text" && !token.plain);
  for (let moved = true; moved; ) {
    moved = false;
    // At a mark, past it: the sound follows the first word the mark gives.
    const startsMark = marks.get(at);
    if (startsMark !== undefined && startsMark > at) {
      at = startsMark;
      moved = true;
    }
    while (at < source.length && !/\s/.test(source[at] as string) && !marks.has(at)) at++;
    const link = links.find((token) => token.range.from < at && at < token.range.to);
    if (link) {
      at = link.range.to;
      moved = true;
    }
    for (const item of items) {
      if (item.kind === "speech") continue;
      if (item.range.from < at && at < item.range.to) {
        at = item.range.to;
        moved = true;
      } else if ((item.kind === "mark" || item.kind === "direction") && item.range.to === at) {
        // After a mark, the sound follows the first word the mark gives, past any other mark.
        let next = at;
        while (source[next] === " " || source[next] === "\t") next++;
        const end = marks.get(next);
        if (end !== undefined) {
          at = end;
          moved = true;
        } else if (next > at && next < source.length && !/\s/.test(source[next] as string)) {
          at = next;
          moved = true;
        }
      }
    }
  }
  const insert = ` [${escapeReferences(description.trim().replace(/([[\]\\])/g, "\\$1"))}]`;
  const changes = [{ from: at, to: at, insert }];
  const after = parsed(applyChanges(source, changes));
  // The new sound, as asked, in a block that is read aloud: in `{book only}` or `{hidden}` text
  // it would be written and never heard.
  const asked = description.trim().replace(/\s+/g, " ");
  const added = after.blocks.some(
    (block) =>
      block.kind !== "break" &&
      (block.visibility === "both" || block.visibility === "audio") &&
      (block.kind === "heading" ? [block.line] : block.lines).some((line) =>
        line.items.some(
          (item) =>
            item.kind === "sound" && item.range.from === at + 1 && item.description === asked,
        ),
      ),
  );
  return added &&
    sameHearing(story, after) &&
    sameSounds(story, after, { from: at, to: at + insert.length }) &&
    bookOf(after) === bookOf(story)
    ? changes
    : [];
}

/**
 * The sounds heard in `a` are those heard in `b`, in order, but for those `b` has where it was
 * changed: a sound put in is the only one added, and none other comes or goes (a group line it
 * would make text holds sounds of its own).
 */
function sameSounds(a: Story, b: Story, changed: Range): boolean {
  const sounds = (story: Story, skip: Range | null) => {
    const out: string[] = [];
    for (const block of story.blocks) {
      if (block.kind === "break") continue;
      if (block.visibility !== "both" && block.visibility !== "audio") continue;
      for (const line of block.kind === "heading" ? [block.line] : block.lines) {
        for (const item of line.items) {
          if (item.kind !== "sound") continue;
          if (skip && item.range.from >= skip.from && item.range.to <= skip.to) continue;
          out.push(item.description);
        }
      }
    }
    return out.join("\u0000");
  };
  return sounds(a, null) === sounds(b, changed);
}

/**
 * Puts a page turn, pause, note or sound on a line of its own before the line holding `offset`
 * (§13.3), as in `{page}`, `{pause 2s}` or `%% Slowly. %%`: never in the front matter or inside a
 * note, with the line ending of the lines around it, and before a paragraph as a paragraph of its
 * own. `text` is one line. Returns no changes if the story would then be heard or printed
 * differently, or warned about more: a line that prints, an empty line that splits a paragraph,
 * or an instruction that hides the paragraph it joins (`{hidden}`, `{book only}`, `{audio only}`).
 */
export function insertLine(story: Story, offset: number, text: string): TextChange[] {
  return session(() => insertLineNow(story, offset, text));
}

function insertLineNow(story: Story, offset: number, text: string): TextChange[] {
  const source = story.source;
  inText(source, offset);
  if (text.trim() === "" || /[\r\n]/.test(text)) return [];
  let at = Math.max(lineStart(source, offset), bodyStart(story));
  for (const item of allLines(story).flatMap((line) => line.items)) {
    if (item.kind === "note" && item.range.from < at && at < item.range.to) {
      at = Math.max(lineStart(source, item.range.from), bodyStart(story));
    }
  }
  const end = source.indexOf("\n", at);
  const ending =
    end >= 0
      ? source[end - 1] === "\r"
        ? "\r\n"
        : "\n"
      : at > 0
        ? source[at - 2] === "\r"
          ? "\r\n"
          : "\n"
        : eol(story);
  // Before a paragraph's first line, the line is a paragraph of its own, so a quote that the
  // paragraph carries on still does (§5.7). After front matter that ends the file without a line
  // break, it goes after a new one.
  const opens = at === bodyStart(story) || /\n[ \t]*\r?\n$/.test(source.slice(0, at));
  const insert =
    at === source.length && at > 0 && !source.endsWith("\n")
      ? `${ending}${text}`
      : opens && at < source.length
        ? `${text}${ending}${ending}`
        : `${text}${ending}`;
  const changes = [{ from: at, to: at, insert }];
  const after = parsed(applyChanges(source, changes));
  const all = heard(after);
  const rest = all.filter((char) => char.at < at || char.at >= at + insert.length);
  // The new line is heard as its text would be on its own: a note or a pause, nothing.
  const own = all.filter((char) => char.at >= at && char.at < at + insert.length);
  const alone = heard(parsed(text))
    .map((char) => char.char)
    .join("");
  const same =
    sameHeard(heard(story), rest) &&
    own.map((char) => char.char).join("") === alone &&
    sameSounds(story, after, { from: at, to: at + insert.length });
  // Like every edit, it prints the book as it was and brings no new warning (a note or quote
  // left open, a stray `:::`).
  return same && bookOf(after) === bookOf(story) && noNewWarnings(story, changes) ? changes : [];
}

function inText(source: string, offset: number): void {
  if (!(Number.isInteger(offset) && offset >= 0 && offset <= source.length)) {
    throw new RangeError(`There is no offset ${offset} in a text of ${source.length} characters.`);
  }
}

/** Where the story itself starts: after the front matter's closing line, or a byte order mark. */
function bodyStart(story: Story): number {
  const front = story.frontMatter;
  if (!front) return story.source.startsWith("\uFEFF") ? 1 : 0;
  const end = story.source.indexOf("\n", front.range.to);
  return end < 0 ? story.source.length : end + 1;
}

// Front matter

type YamlEntry = YamlKey;

function frontMatterKeys(story: Story): YamlEntry[] {
  const front = story.frontMatter;
  if (!front) return [];
  const rawFrom = story.source.indexOf("\n", front.range.from) + 1;
  return readYaml(front.raw, rawFrom).keys;
}

function eol(story: Story): string {
  return /\r\n/.test(story.source) ? "\r\n" : "\n";
}

function lineStart(source: string, offset: number): number {
  return source.lastIndexOf("\n", offset - 1) + 1;
}

function lineIndent(source: string, offset: number): string {
  const start = lineStart(source, offset);
  return /^[ \t]*/.exec(source.slice(start))?.[0] ?? "";
}

/** A key's value as written, without the spaces before it or a comment after it. */
function writtenValue(entry: YamlEntry): Range {
  return entry.value?.text ?? { from: entry.range.to + 1, to: entry.range.to + 1 };
}

/**
 * From just after `key:` to the end of its value, continuation lines and block scalars included
 * (just after the colon, if it has none). A value on one line ends before a comment after it, so
 * the comment stays.
 */
function replaceValue(entry: YamlEntry): Range {
  const at = entry.value ?? { from: entry.range.to + 1, to: entry.range.to + 1 };
  return { from: at.from, to: at.to };
}

/** Adds a line to the front matter: at the top level, or at the end of a top-level map. */
function addToFrontMatter(story: Story, path: readonly string[], text: string): TextChange[] {
  const nl = eol(story);
  const front = story.frontMatter;
  const parent = path[0];
  if (!front) {
    const body = parent ? `${parent}:${nl}  ${text}` : text;
    const bom = story.source.startsWith("﻿") ? 1 : 0;
    return [{ from: bom, to: bom, insert: `---${nl}${body}${nl}---${nl}${nl}` }];
  }
  const closing = lineStart(story.source, front.range.to);
  if (!parent) {
    // At the indentation the top-level keys already have, after the details and before the
    // first map (the cast), where a reader looks for a title.
    const keys = frontMatterKeys(story);
    const first = keys.find((k) => k.path.length === 1);
    const indent = first ? lineIndent(story.source, first.range.from) : "";
    const map = keys.find(
      (k) =>
        k.path.length === 1 &&
        (keys.some((child) => child.path.length === 2 && child.path[0] === k.path[0]) ||
          story.source.slice(writtenValue(k).from, writtenValue(k).to).trim() === ""),
    );
    const at = map ? lineStart(story.source, map.range.from) : closing;
    return [{ from: at, to: at, insert: `${indent}${text}${nl}` }];
  }
  const keys = frontMatterKeys(story);
  const top = keys.find((k) => k.path.length === 1 && k.path[0] === parent);
  if (!top) return [{ from: closing, to: closing, insert: `${parent}:${nl}  ${text}${nl}` }];
  // `cast: null` (or `~`) becomes a map; another value on the key's line can't take an entry.
  const inline = top.value ? story.source.slice(top.value.text.from, top.value.text.to) : "";
  if (/^(?:null|Null|NULL|~)$/.test(inline) && top.value) {
    return [{ from: top.value.from, to: top.value.to, insert: `${nl}  ${text}` }];
  }
  const children = keys.filter((k) => k.path[0] === parent && k.path.length === 2);
  const first = children[0];
  const indent = first ? lineIndent(story.source, first.range.from) : "  ";
  // After the map's last line: the next top-level key, or the closing `---`.
  const nextTop = keys.find((k) => k.path.length === 1 && k.range.from > top.range.from);
  const at = nextTop ? lineStart(story.source, nextTop.range.from) : closing;
  return [{ from: at, to: at, insert: `${indent}${text}${nl}` }];
}

/** A YAML value written plainly when that reads back as the same text, else double-quoted. */
export function yamlScalar(value: string): string {
  const plain =
    value !== "" &&
    value === value.trim() &&
    !/^[-?:,[\]{}#&*!|>'"%@`]/.test(value) &&
    !/: |:$| #|[\n\r\t]/.test(value) &&
    !UNPRINTABLE.test(value) &&
    !/^(?:null|~|true|false|yes|no|on|off|[-+]?\.(?:inf|nan))$/i.test(value) &&
    !/^[-+]?(?:\.?\d)/.test(value);
  if (plain) return value;
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(
      new RegExp(UNPRINTABLE.source, "g"),
      (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
  return `"${escaped}"`;
}

/** What YAML writes only as an escape: control characters, line and paragraph separators, a BOM. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it finds
const UNPRINTABLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029\ufeff]/;
