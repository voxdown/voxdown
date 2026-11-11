/**
 * Who says each quote: every quote in a story, numbered in reading order, with who says it now;
 * and quotes given to their speakers, many at once, each read back so that a quote goes to the
 * speaker it was given to and every word is heard as before. For tools that tag speakers, by hand
 * or with a model's help: the numbers stay the same while only marks change, so a list made once
 * can be answered in several goes.
 */
import { hasLetterOrDigit } from "./chars";
import { type TextChange, applyChanges, isName, markAt, setFullName, spelled } from "./edit";
import { lexedTokens } from "./lexed";
import { lines } from "./lines";
import type { Line, Speech, Story } from "./model";
import { nameKey } from "./names";
import { parse } from "./parse";
import { bookText } from "./readings";
import { session } from "./session";
import { diffChanges } from "./write";

/** A quote in the story: where it is, its words, and who says it now. */
export type Quote = {
  /** Its place among the story's quotes, from 1. It stays the same while only marks change. */
  number: number;
  /** Where its opening quotation mark is. */
  from: number;
  /** Just after its closing mark, or the end of its line when it runs on past it. */
  to: number;
  /** Its words as written, on one line. */
  text: string;
  /** Who says it now. */
  speaker: string;
  /**
   * No mark gives it to anyone: the narrator reads it with the words around it, as in
   * `“Stop thief!” cried Mr. McGregor.` These are the quotes waiting for a speaker.
   */
  narrated: boolean;
  /** It carries on a speech from earlier on its line, or from the paragraph before (§5.6, §5.7). */
  continued: boolean;
  /** Its 1-based line in the file. */
  line: number;
};

/** Every quote in the story's paragraphs, in reading order. */
export function quotesOf(story: Story): Quote[] {
  const speeches: Speech[] = [];
  const lineOf: Line[] = [];
  for (const block of story.blocks) {
    if (block.kind !== "paragraph") continue;
    for (const line of block.lines)
      for (const item of line.items)
        if (item.kind === "speech") {
          speeches.push(item);
          lineOf.push(line);
        }
  }
  const narrator = nameKey(story.meta.narrator);
  const starts = lineStarts(story.source);
  const tokens = lexedTokens(story.source).filter(
    (token) => token.type === "open" || token.type === "close",
  );
  const quotes: Quote[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const open = tokens[index];
    if (open?.type !== "open") continue;
    const at = open.range.from;
    const found = speechAt(speeches, at);
    if (found < 0) continue;
    const speech = speeches[found] as Speech;
    const line = lineOf[found] as Line;
    // It ends at its closing mark, unless another quote opens first: then at its line's end.
    const next = tokens[index + 1];
    const close = next?.type === "close" ? next : undefined;
    const to = close ? close.range.to : line.range.to;
    const words = close ? story.source.slice(open.range.to, close.range.from) : "";
    const text = (words || story.source.slice(open.range.to, to)).replace(/\s+/g, " ").trim();
    if (!hasLetterOrDigit(text)) continue;
    const own = speech.quoted && speech.openQuote?.from === at;
    quotes.push({
      number: quotes.length + 1,
      from: at,
      to,
      text,
      speaker: speech.speaker,
      narrated: !own && nameKey(speech.speaker) === narrator,
      continued: own && speech.continued,
      line: lineNumber(starts, at),
    });
  }
  return quotes;
}

/** The speech whose stretch holds `at`, by its index; -1 if none does. */
function speechAt(speeches: readonly Speech[], at: number): number {
  let low = 0;
  let high = speeches.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((speeches[middle] as Speech).range.from <= at) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  // The last speech starting at or before `at`; a quote opening a speech starts it.
  for (let index = found; index >= 0 && index >= found - 1; index--) {
    const speech = speeches[index] as Speech;
    if (speech.range.from <= at && at < Math.max(speech.range.to, speech.range.from + 1))
      return index;
  }
  return -1;
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = source.indexOf("\n"); index >= 0; index = source.indexOf("\n", index + 1))
    starts.push(index + 1);
  return starts;
}

function lineNumber(starts: readonly number[], at: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((starts[middle] as number) <= at) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}

/** Words that tag a quote with who says it, in English. */
const SAYING =
  "said|says|asked|asks|replied|replies|whispered|whispers|shouted|shouts|cried|cries|called|calls|answered|answers|muttered|mutters|murmured|murmurs|added|adds|sighed|sighs|laughed|laughs|snapped|snaps|exclaimed|exclaims|yelled|yells|demanded|demands|began|begins|continued|continues|went on|goes on|told|tells|repeated|repeats|insisted|insists|admitted|admits|agreed|agrees|declared|declares|explained|explains|growled|growls|hissed|hisses|protested|protests|retorted|retorts|roared|roars|screamed|screams|sobbed|sobs|stammered|stammers|suggested|suggests|thought|thinks|wondered|wonders";

const PRONOUNS = /^(?:He|She|They|It|I|We|You|The|His|Her|Their|Then|But|And|So)$/u;

/**
 * The name an English dialogue tag gives a quote, if it gives one: `“…” asked Mara`,
 * `“…” Mara said`, `Mara said, “…”`. A pronoun says nothing of who, so gives nothing. The name is
 * as written: it may be a cast member's full name, or a word that isn't a name at all.
 */
export function taggedName(story: Story, quote: Quote): string | undefined {
  const source = story.source;
  const lineFrom = source.lastIndexOf("\n", quote.from - 1) + 1;
  const lineEnd = source.indexOf("\n", quote.to);
  const before = source.slice(lineFrom, quote.from);
  const after = source.slice(quote.to, lineEnd < 0 ? source.length : lineEnd);
  // A name, one or two words, a title before it kept with it: `Mara`, `Old Tom`, `Mr. Fox`.
  const name =
    "((?:(?:Mr|Mrs|Ms|Mx|Dr|St)\\.?\\s+)?\\p{Lu}[\\p{L}’'-]*(?:\\s+\\p{Lu}[\\p{L}’'-]*)?)";
  const behind = new RegExp(
    `^[\\s,.!?—–-]*(?:(?:${SAYING})\\s+(?:the\\s+)?${name}|${name}\\s+(?:${SAYING})\\b)`,
    "u",
  ).exec(after);
  const ahead = new RegExp(`${name}\\s+(?:${SAYING})[\\s,:]*$`, "u").exec(before);
  const found = behind?.[1] ?? behind?.[2] ?? ahead?.[1];
  if (!found || PRONOUNS.test(found.split(/\s+/)[0] ?? "")) return undefined;
  // A title alone (`said Mr.`) names no one.
  if (/^(?:Mr|Mrs|Ms|Mx|Dr|St|Sir|Lady|Lord|Miss|Madam)\.?$/.test(found)) return undefined;
  return found;
}

/**
 * The cast member a name means: their short name, their full name, or a full name's last word
 * (`Mrs. Rabbit` for `Mother: Mrs. Rabbit`); undefined if it means no one in the cast.
 */
export function castMemberNamed(story: Story, name: string): string | undefined {
  const key = nameKey(name.trim());
  if (key === nameKey(story.meta.narrator)) return story.meta.narrator;
  for (const member of story.cast) {
    if (nameKey(member.handle) === key || nameKey(member.name) === key) return member.handle;
  }
  return undefined;
}

/** A quote to give: its number, and the speaker's name, with their full name if they're new. */
export type Gift = { quote: number; speaker: string; fullName?: string };

/** What giving quotes did. */
export type Given = {
  /** The changes that give them, against the story as it was. */
  changes: TextChange[];
  /** The quotes now said by whom they were given to. */
  given: number[];
  /** Quotes not given, and why. */
  refused: Array<{ quote: number; why: string }>;
  /**
   * Quotes no one was given that now go with a quote before them on their line, or with the
   * paragraph before (§5.6, §5.7): `@Mara “Hello,” she said. “Come in.”`
   */
  carried: number[];
  /** Characters who joined the cast. */
  joined: string[];
};

/**
 * Gives quotes to their speakers: a mark straight before each that needs one (none where the
 * quote would go to them anyway, carried on from the quote before), and anyone new joins the cast
 * when the story has one. Read back, each quote given is its speaker's, no quote not given changes
 * hands but by carrying on, and every word is heard and printed as before; a gift that can't keep
 * all that is refused, and the others are still given.
 */
export function giveQuotes(story: Story, gifts: readonly Gift[]): Given {
  return session(() => giveQuotesNow(story, gifts));
}

function giveQuotesNow(story: Story, gifts: readonly Gift[]): Given {
  const quotes = quotesOf(story);
  const refused: Given["refused"] = [];
  const wanted = new Map<number, { quote: Quote; speaker: string; fullName?: string }>();
  for (const gift of gifts) {
    const quote = quotes[gift.quote - 1];
    if (!quote) {
      refused.push({ quote: gift.quote, why: `there is no quote ${gift.quote}` });
      continue;
    }
    const speaker = castMemberNamed(story, gift.speaker) ?? gift.speaker.trim();
    if (!isName(speaker)) {
      refused.push({
        quote: gift.quote,
        why: `“${gift.speaker}” isn't a name: a name is one word, such as ${joinedName(gift.speaker)}`,
      });
      continue;
    }
    wanted.set(gift.quote, {
      quote,
      speaker,
      ...(gift.fullName ? { fullName: gift.fullName } : {}),
    });
  }
  // Up to three goes: a gift that fails its read-back is refused (or, if it went without a mark of
  // its own, given one), and the rest are given again without it.
  const explicit = new Set<number>();
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = attemptGifts(story, quotes, wanted, explicit);
    if (result.failed.size === 0) return { ...result.given, refused: [...refused] };
    // Words changed, but by which gift? One at a time will tell.
    if (result.wordsChanged) break;
    for (const [number, why] of result.failed) {
      if (result.unmarked.has(number) && !explicit.has(number)) explicit.add(number);
      else {
        wanted.delete(number);
        refused.push({ quote: number, why });
      }
    }
  }
  // What still fails is given one at a time, so that one bad gift can't hold back the rest.
  const given: Given = { changes: [], given: [], refused, carried: [], joined: [] };
  let source = story.source;
  for (const [number, gift] of wanted) {
    const now = parse(source);
    const result = attemptGifts(now, quotesOf(now), new Map([[number, gift]]), new Set([number]));
    if (result.failed.size > 0) {
      refused.push({ quote: number, why: [...result.failed.values()][0] as string });
      continue;
    }
    source = applyChanges(source, result.given.changes);
    given.given.push(number);
    given.carried.push(...result.given.carried);
    given.joined.push(...result.given.joined);
  }
  given.changes = diffChanges(story.source, source);
  return given;
}

/** A name's words joined into one, as a short name for someone with a longer one. */
function joinedName(name: string): string {
  const joined = name
    .split(/[^\p{L}\p{N}'’_-]+/u)
    .filter(Boolean)
    .map((word) => (word[0] as string).toUpperCase() + word.slice(1))
    .join("");
  return isName(joined) ? joined : "SillyClown";
}

type Attempt = {
  given: Omit<Given, "refused">;
  /** Gifts that failed their read-back, and why. */
  failed: Map<number, string>;
  /** Gifts that went without a mark of their own. */
  unmarked: Set<number>;
  /** The gifts together would change the words heard or printed. */
  wordsChanged: boolean;
};

function attemptGifts(
  story: Story,
  quotes: readonly Quote[],
  wanted: ReadonlyMap<number, { quote: Quote; speaker: string; fullName?: string }>,
  explicit: ReadonlySet<number>,
): Attempt {
  const source = story.source;
  const narrator = nameKey(story.meta.narrator);
  const unmarked = new Set<number>();
  const marks: TextChange[] = [];
  // Who says each quote once these are given, as far as the marks go: for a quote that could
  // carry on the one before it on its line.
  const after = new Map<number, string>();
  for (const quote of quotes) {
    const gift = wanted.get(quote.number);
    if (!gift) {
      after.set(quote.number, quote.speaker);
      continue;
    }
    after.set(quote.number, gift.speaker);
    const key = nameKey(gift.speaker);
    // Already theirs: nothing to do.
    if (key === nameKey(quote.speaker) && (!quote.narrated || key === narrator)) continue;
    const before = quotes[quote.number - 2];
    const carries =
      before !== undefined &&
      before.line === quote.line &&
      !explicit.has(quote.number) &&
      !/[@{}[\]]/.test(source.slice(before.to, quote.from)) &&
      nameKey(after.get(before.number) ?? "") === key &&
      (quote.narrated || quote.continued);
    if (carries) {
      unmarked.add(quote.number);
      continue;
    }
    if (key === narrator) {
      // Back to the narrator would need a mark of the narrator's own: left to the writer.
      continue;
    }
    marks.push({
      from: quote.from,
      to: quote.from,
      insert: markAt(source, quote.from, `@${spelled(story, gift.speaker)}`),
    });
  }
  // Anyone new joins the cast, when the story has one, their full name with them.
  const hasCast = story.cast.length > 0 || "cast" in (story.frontMatter?.data ?? {});
  let text = applyChanges(source, marks);
  const joined: string[] = [];
  if (hasCast) {
    const known = new Set([narrator, ...story.cast.map((member) => nameKey(member.handle))]);
    for (const gift of wanted.values()) {
      const key = nameKey(gift.speaker);
      if (known.has(key)) continue;
      known.add(key);
      const cast = setFullName(parse(text), gift.speaker, gift.fullName?.trim() || gift.speaker);
      if (cast.length === 0) continue;
      text = applyChanges(text, cast);
      joined.push(gift.speaker);
    }
  }
  // Read back.
  const failed = new Map<number, string>();
  const read = parse(text);
  const now = quotesOf(read);
  if (now.length !== quotes.length) {
    for (const number of wanted.keys())
      failed.set(number, "giving it would make the story's quotes read differently");
    return { given: emptyGiven(), failed, unmarked, wordsChanged: true };
  }
  const carried: number[] = [];
  const given: number[] = [];
  for (const quote of quotes) {
    const was = quote;
    const is = now[quote.number - 1] as Quote;
    const gift = wanted.get(quote.number);
    if (gift) {
      const ok =
        nameKey(is.speaker) === nameKey(gift.speaker) &&
        (nameKey(gift.speaker) !== narrator || is.narrated);
      if (ok) given.push(quote.number);
      else
        failed.set(
          quote.number,
          nameKey(gift.speaker) === narrator
            ? `it goes with ${is.speaker}'s speech before it on the line: giving it back to the narrator needs a mark of the narrator's own`
            : `read back, it would be ${is.speaker}'s, not ${gift.speaker}'s`,
        );
    } else if (nameKey(is.speaker) !== nameKey(was.speaker)) {
      if (was.narrated && (is.continued || !is.narrated)) carried.push(quote.number);
      else failed.set(blame(quotes, wanted, quote), `it would take quote ${quote.number} with it`);
    }
  }
  const wordsChanged = !sameWords(story, read);
  if (wordsChanged)
    for (const number of wanted.keys())
      failed.set(number, "giving it would change the words heard or printed");
  return {
    given: { changes: diffChanges(source, text), given, carried, joined },
    failed,
    unmarked,
    wordsChanged,
  };
}

/** The gift nearest before a quote that changed hands: the one that took it. */
function blame(
  quotes: readonly Quote[],
  wanted: ReadonlyMap<number, unknown>,
  quote: Quote,
): number {
  for (let number = quote.number - 1; number >= 1; number--) if (wanted.has(number)) return number;
  return [...wanted.keys()][0] ?? quote.number;
}

function emptyGiven(): Omit<Given, "refused"> {
  return { changes: [], given: [], carried: [], joined: [] };
}

/** Whether two readings of a story are heard and printed with the same words. */
function sameWords(before: Story, after: Story): boolean {
  // Words alone: a stretch of punctuation between two quotes (`»…« -- »…«`) isn't heard once
  // the quotes are someone's (§12.1), and quotation marks go with the narrator's reading.
  const heard = (story: Story) =>
    lines(story)
      .filter((line) => line.kind === "speech")
      .flatMap((line) => line.text.match(/[\p{L}\p{N}]+/gu) ?? [])
      .join(" ");
  const printed = (story: Story) => bookText(story).replace(/^---\n[\s\S]*?\n---\n?/, "");
  return heard(before) === heard(after) && printed(before) === printed(after);
}
