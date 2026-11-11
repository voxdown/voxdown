/**
 * Tagging a whole story: passage after passage, each asked of the chosen AI with the speakers
 * given so far already marked in it (so the next passage reads on from them), each answer read
 * and given by the core, which keeps every word as it was. Nothing is written here: the caller
 * shows what was found and writes it if the writer wants.
 */
import { type Quote, type Story, applyChanges, giveQuotes, parse, quotesOf } from "voxdown";
import { AiFailure, type Backend } from "./ai";
import {
  type Confidence,
  INSTRUCTIONS,
  type Passage,
  type Reading,
  answerSchema,
  passagePrompt,
  passagesOf,
  readAnswer,
  tagGifts,
} from "./tagging";

/** A speaker the AI proposed for a quote, and what became of it. */
export type Proposal = {
  quote: number;
  /** The quote's 1-based line in the story as it was. */
  line: number;
  /** Its first words. */
  words: string;
  speaker: string;
  confidence: Confidence;
  cue: string;
  /** Given, held back as less sure than asked for, or refused by the core (with why). */
  outcome: "given" | "held" | "refused";
  why?: string;
};

export type Tagged = {
  /** The story with the speakers given. */
  source: string;
  proposals: Proposal[];
  /** Quotes the AI couldn't tell, by number. */
  unknown: number[];
  /** Quotes that went along with one given before them. */
  carried: number[];
  /** Characters who joined the cast. */
  joined: string[];
  /** What in the answers couldn't be used. */
  problems: string[];
  /** Passages asked about, and how many there were. */
  asked: number;
  passages: number;
  /** Why it stopped early, if it did. */
  stopped?: string;
};

export type Progress = {
  passage: Passage;
  /** From 1. */
  index: number;
  of: number;
  /** After the answer, what it gave. */
  reading?: Reading;
};

const ORDER: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

/** Tags the story's quotes that no one is marked to say, with `backend`, or with dialogue tags alone. */
export async function tagStory(
  story: Story,
  options: {
    backend: Backend | "tags";
    /** Speakers less sure than this are held back. */
    minimum?: Confidence;
    words?: number;
    onProgress?: (progress: Progress) => void;
    signal?: AbortSignal;
  },
): Promise<Tagged> {
  const minimum = ORDER[options.minimum ?? "medium"];
  const first = quotesOf(story);
  const at = (number: number): Quote | undefined => first[number - 1];
  const result: Tagged = {
    source: story.source,
    proposals: [],
    unknown: [],
    carried: [],
    joined: [],
    problems: [],
    asked: 0,
    passages: passagesOf(story, options.words ? { words: options.words } : {}).length,
  };
  const describe = (number: number) => {
    const quote = at(number);
    return {
      line: quote?.line ?? 0,
      words: quote ? (quote.text.length > 48 ? `${quote.text.slice(0, 47)}…` : quote.text) : "",
    };
  };
  let current = story;
  const give = (gifts: Array<{ quote: number; speaker: string; fullName?: string }>) => {
    const given = giveQuotes(current, gifts);
    current = parse(applyChanges(current.source, given.changes));
    result.carried.push(...given.carried);
    result.joined.push(...given.joined);
    return given;
  };
  if (options.backend === "tags") {
    const gifts = tagGifts(story);
    const given = give(gifts);
    const refused = new Map(given.refused.map((refusal) => [refusal.quote, refusal.why]));
    for (const gift of gifts)
      result.proposals.push({
        quote: gift.quote,
        ...describe(gift.quote),
        speaker: gift.speaker,
        confidence: "high",
        cue: "dialogue tag",
        outcome: refused.has(gift.quote) ? "refused" : "given",
        ...(refused.has(gift.quote) ? { why: refused.get(gift.quote) as string } : {}),
      });
    result.source = current.source;
    result.asked = 0;
    return result;
  }
  const backend = options.backend;
  const pending = new Set(first.filter((quote) => quote.narrated).map((quote) => quote.number));
  const newcomers = new Map<string, string>();
  while (pending.size > 0) {
    if (options.signal?.aborted) {
      result.stopped = "stopped";
      break;
    }
    const [passage] = passagesOf(current, {
      only: pending,
      ...(options.words ? { words: options.words } : {}),
    });
    if (!passage) break;
    for (const number of passage.numbers) pending.delete(number);
    result.asked++;
    const index = result.asked;
    const of = Math.max(result.passages, index);
    options.onProgress?.({ passage, index, of });
    const ask = {
      instructions: INSTRUCTIONS,
      prompt: passagePrompt(current, passage),
      schema: answerSchema(current),
      ...(options.signal ? { signal: options.signal } : {}),
    };
    let reading: Reading | undefined;
    try {
      reading = readAnswer(current, passage, await backend.ask(ask), newcomers);
      // An answer that can't be read is asked for again, once, with what was wrong with it.
      if (reading.gifts.length === 0 && reading.problems.length > 0) {
        const again = await backend.ask({
          ...ask,
          prompt: `${ask.prompt}\n\nYour last answer couldn't be used: ${reading.problems.join("; ")}. Answer again with only the JSON object.`,
        });
        reading = readAnswer(current, passage, again, newcomers);
      }
    } catch (error) {
      result.stopped =
        error instanceof AiFailure || error instanceof Error ? error.message : String(error);
      // The passage wasn't answered: its quotes stay as they were.
      result.unknown.push(...passage.numbers);
      break;
    }
    options.onProgress?.({ passage, index, of, reading });
    result.problems.push(...reading.problems);
    result.unknown.push(...reading.unknown);
    const sure = reading.gifts.filter((gift) => ORDER[gift.confidence] >= minimum);
    const given = give(sure);
    const refused = new Map(given.refused.map((refusal) => [refusal.quote, refusal.why]));
    for (const gift of reading.gifts) {
      const held = ORDER[gift.confidence] < minimum;
      result.proposals.push({
        quote: gift.quote,
        ...describe(gift.quote),
        speaker: gift.speaker,
        confidence: gift.confidence,
        cue: gift.cue,
        outcome: held ? "held" : refused.has(gift.quote) ? "refused" : "given",
        ...(refused.has(gift.quote) ? { why: refused.get(gift.quote) as string } : {}),
      });
    }
  }
  result.source = current.source;
  result.passages = Math.max(result.passages, result.asked);
  return result;
}

/**
 * A story with the marks before its quotes taken out, as if no one had marked who says them: for
 * measuring how well an AI puts them back. Marks with a direction stay, as the AI isn't asked for
 * directions.
 */
export function withoutSpeakers(story: Story): string {
  const cuts = new Map<number, { from: number; to: number; insert: string }>();
  for (const block of story.blocks) {
    if (block.kind !== "paragraph") continue;
    for (const line of block.lines)
      for (const item of line.items) {
        if (item.kind !== "speech" || !item.quoted || !item.mark || item.mark.direction) continue;
        const mark = item.mark.range;
        if (story.source.slice(mark.to, item.range.from).trim() !== "") continue;
        cuts.set(mark.from, { from: mark.from, to: item.range.from, insert: "" });
      }
  }
  return applyChanges(story.source, [...cuts.values()]);
}

/**
 * How many of the quotes a book's own marks give, a tagging gave to the same speaker: those that
 * waited for a speaker in `bare` (the book without its marks), which are the ones asked about. (A
 * quote a mark further back on its line claims once the marks are out, §5.4, isn't asked.)
 */
export function scoreAgainst(
  marked: Story,
  tagged: Story,
  bare?: Story,
): {
  right: number;
  wrong: Array<{ quote: number; line: number; expected: string; got: string }>;
  of: number;
} {
  const was = quotesOf(marked);
  const now = quotesOf(tagged);
  const asked = bare
    ? new Set(
        quotesOf(bare)
          .filter((quote) => quote.narrated)
          .map((quote) => quote.number),
      )
    : undefined;
  const wrong: Array<{ quote: number; line: number; expected: string; got: string }> = [];
  let right = 0;
  let of = 0;
  for (const quote of was) {
    if (quote.narrated || (asked && !asked.has(quote.number))) continue;
    of++;
    const got = now[quote.number - 1];
    if (got && got.speaker.toLowerCase() === quote.speaker.toLowerCase()) right++;
    else
      wrong.push({
        quote: quote.number,
        line: quote.line,
        expected: quote.speaker,
        got: got?.narrated ? "(none)" : (got?.speaker ?? "(none)"),
      });
  }
  return { right, wrong, of };
}
