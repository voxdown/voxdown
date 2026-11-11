/**
 * Tagging speakers with a model's help: a story cut into passages, each with the quotes no one is
 * marked to say numbered in it; what a model is asked about each passage, and the shape its answer
 * must take; and its answer read as gifts for the core's `giveQuotes`, which gives them only if
 * every word stays as it was. The model never writes the story: it only names speakers.
 */
import {
  type Gift,
  type Quote,
  type Story,
  castMemberNamed,
  isName,
  lines,
  quotesOf,
  taggedName,
} from "voxdown";

/** A stretch of the story to ask about. */
export type Passage = {
  /** From 1. */
  index: number;
  /** The heading of the chapter or scene it is in, if any. */
  heading: string | null;
  /** The quotes it asks about, by number. */
  numbers: number[];
  /** The passage as written, `⟦n⟧` before each quote it asks about. */
  text: string;
  /** A little of what comes before it, as written, for context. */
  before: string;
  /** Its 1-based first line in the file. */
  line: number;
};

/** About this many words a passage, so that a model reads the whole of it with care. */
export const PASSAGE_WORDS = 2500;

const wordCount = (text: string) => text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;

/**
 * The story's passages that hold quotes no one is marked to say (or only those numbered in
 * `only`): its paragraphs and headings in order, a new passage at each chapter heading once the
 * one before has some length, and at about `words` words.
 */
export function passagesOf(
  story: Story,
  options: { words?: number; only?: ReadonlySet<number> } = {},
): Passage[] {
  const limit = options.words ?? PASSAGE_WORDS;
  const quotes = quotesOf(story).filter(
    (quote) => quote.narrated && (!options.only || options.only.has(quote.number)),
  );
  const source = story.source;
  const passages: Passage[] = [];
  let blocks: Array<{ from: number; to: number }> = [];
  let words = 0;
  let heading: string | null = null;
  let passageHeading: string | null = null;
  let previous: Array<{ from: number; to: number }> = [];
  let next = 0;
  const flush = () => {
    if (blocks.length === 0) return;
    const from = (blocks[0] as { from: number }).from;
    const to = (blocks.at(-1) as { to: number }).to;
    const asked: Quote[] = [];
    while (next < quotes.length && (quotes[next] as Quote).from < to) {
      const quote = quotes[next] as Quote;
      if (quote.from >= from) asked.push(quote);
      next++;
    }
    if (asked.length > 0) {
      let text = "";
      let at = from;
      for (const quote of asked) {
        text += `${source.slice(at, quote.from)}⟦${quote.number}⟧`;
        at = quote.from;
      }
      text += source.slice(at, to);
      // The last few paragraphs before it, up to about 400 words: who was talking, and to whom.
      const context = previous.slice(-4);
      let before = context.map((block) => source.slice(block.from, block.to)).join("\n\n");
      const contextWords = before.split(/\s+/);
      if (contextWords.length > 400) before = `… ${contextWords.slice(-400).join(" ")}`;
      passages.push({
        index: passages.length + 1,
        heading: passageHeading,
        numbers: asked.map((quote) => quote.number),
        text,
        before,
        line: source.slice(0, from).split("\n").length,
      });
    }
    previous = blocks;
    blocks = [];
    words = 0;
  };
  for (const block of story.blocks) {
    if (block.kind === "heading" && block.level <= 2 && words > limit / 4) flush();
    if (block.kind === "heading")
      heading = block.line.items.length ? headingText(story, block) : heading;
    if (blocks.length === 0) passageHeading = heading;
    const range = { from: block.range.from, to: block.range.to };
    blocks.push(range);
    words += wordCount(source.slice(range.from, range.to));
    if (words >= limit) flush();
  }
  flush();
  return passages;
}

function headingText(story: Story, block: Story["blocks"][number]): string | null {
  if (block.kind !== "heading") return null;
  return (
    story.source
      .slice(block.line.range.from, block.line.range.to)
      .replace(/\{[^}]*\}/g, "")
      .trim() || null
  );
}

/** Who can be given a quote: the cast, then anyone else the story gives words to. */
export function speakersOf(
  story: Story,
): Array<{ name: string; fullName: string; about?: string }> {
  const out = story.cast.map((member) => ({
    name: member.handle,
    fullName: member.name,
    ...(member.about ? { about: member.about } : {}),
  }));
  const known = new Set(out.map((member) => member.name.toLowerCase()));
  known.add(story.meta.narrator.toLowerCase());
  for (const line of lines(story)) {
    if (line.kind !== "speech" || !line.speaker) continue;
    const key = line.speaker.toLowerCase();
    if (known.has(key)) continue;
    known.add(key);
    out.push({ name: line.speaker, fullName: line.speaker });
  }
  return out;
}

/** What a model is told once, before any passage. */
export const INSTRUCTIONS = `You attribute dialogue in fiction: for each numbered quote, you say which character speaks it.

The story is written in VoxDown, a plain-text format for stories read aloud. What matters here:
- A quote marked ⟦12⟧ is quote number 12, and needs a speaker.
- \`@Name “…”\` means Name says that quote: those already have their speakers. Use them as anchors for who has been talking.
- A quote later on the same line as a marked one carries on the same speaker.
- Other marks you may see: \`(softly)\` after a name is how it is said, \`[door creaks]\` is a sound, \`{pause}\` and \`{page}\` are instructions, \`%% … %%\` is a note. They are not dialogue.

How to decide:
- Dialogue tags ("said Mara", "he asked"), and who a pronoun last referred to.
- Turn-taking: in a two-person exchange, speakers alternate.
- A name used to address someone ("Come in, Tom") usually means Tom is not the speaker.
- Action beats in the same paragraph, and each character's voice and the cast's descriptions.

How to answer:
- For each quote, first write the clue you used in a few words (cue), then the speaker.
- speaker is a short name from the cast list, exactly as written there.
- A quote that no character says aloud (a sign, a title, a word being discussed, a letter the narrator reads out) goes to the narrator. A character's quoted thought is theirs.
- A character who speaks but isn't in the cast: speaker "new", with their name in newName (as the story calls them). Otherwise newName is "".
- confidence: high when the text settles it, medium when it's the clear best reading, low when it's a guess. Use "unknown" only when there is no way to tell.
- Answer every numbered quote in the passage, and only those. Never rewrite the story.`;

/** The JSON a model's answer must match, its speakers held to the story's cast. */
export function answerSchema(story: Story): Record<string, unknown> {
  const names = [
    ...new Set([...speakersOf(story).map((member) => member.name), story.meta.narrator]),
  ];
  return {
    type: "object",
    additionalProperties: false,
    required: ["answers"],
    properties: {
      answers: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["quote", "cue", "speaker", "newName", "confidence"],
          properties: {
            quote: { type: "integer", description: "The quote's number, from ⟦n⟧." },
            cue: {
              type: "string",
              description:
                "A few words: the clue used (tag, turn-taking, pronoun, vocative, beat).",
            },
            speaker: { type: "string", enum: [...names, "new", "unknown"] },
            newName: {
              type: "string",
              description: 'A new character\'s name when speaker is "new"; otherwise "".',
            },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
          },
        },
      },
    },
  };
}

/** What a model is asked about one passage. */
export function passagePrompt(story: Story, passage: Passage): string {
  const meta = story.meta;
  const about = [
    meta.title ? `“${meta.title}”` : "A story",
    meta.author ? `by ${meta.author}` : "",
    meta.language ? `(language: ${meta.language})` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const cast = speakersOf(story)
    .map(
      (member) =>
        `- ${member.name}${member.fullName !== member.name ? ` (${member.fullName})` : ""}${member.about ? `: ${member.about}` : ""}`,
    )
    .join("\n");
  const quotes = quotesOf(story);
  const hints = passage.numbers
    .map((number) => {
      const quote = quotes[number - 1];
      const tag = quote ? taggedName(story, quote) : undefined;
      return tag ? `⟦${number}⟧ ${tag}` : "";
    })
    .filter(Boolean);
  return [
    `${about}. The narrator is ${meta.narrator}.`,
    "",
    "Cast (short name, full name, about):",
    cast || "(none listed yet: name the speakers as new characters)",
    "",
    ...(passage.before ? ["Just before the passage, for context only:", passage.before, ""] : []),
    `Passage${passage.heading ? ` (in “${passage.heading}”)` : ""}:`,
    passage.text,
    "",
    `Quotes to attribute: ${passage.numbers.map((number) => `⟦${number}⟧`).join(" ")}`,
    ...(hints.length
      ? [`Names in nearby dialogue tags (hints, often right): ${hints.join(", ")}`]
      : []),
  ].join("\n");
}

/** How sure a model is of a speaker. */
export type Confidence = "high" | "medium" | "low";

/** A model's answer about a passage, read as gifts; what it got wrong, said. */
export type Reading = {
  gifts: Array<Gift & { confidence: Confidence; cue: string }>;
  /** Quotes it couldn't tell, or didn't answer. */
  unknown: number[];
  /** What in the answer couldn't be used. */
  problems: string[];
};

/**
 * Reads a model's answer: JSON, perhaps in a code fence or with words around it. `newcomers`
 * remembers the short names given to new characters, so that the same person keeps one name
 * from passage to passage.
 */
export function readAnswer(
  story: Story,
  passage: Passage,
  answer: string,
  newcomers: Map<string, string> = new Map(),
): Reading {
  const problems: string[] = [];
  const data = jsonIn(answer) as { answers?: unknown; speakers?: unknown } | undefined;
  const items = Array.isArray(data?.answers)
    ? data.answers
    : Array.isArray(data?.speakers)
      ? data.speakers
      : undefined;
  if (!items)
    return {
      gifts: [],
      unknown: [...passage.numbers],
      problems: ["the answer wasn't the JSON asked for"],
    };
  const asked = new Set(passage.numbers);
  const gifts: Reading["gifts"] = [];
  const answered = new Set<number>();
  const known = speakersOf(story);
  for (const item of items as Array<Record<string, unknown>>) {
    const quote = Number(item?.quote);
    const speaker = typeof item?.speaker === "string" ? item.speaker.trim() : "";
    const confidence: Confidence =
      item?.confidence === "high" || item?.confidence === "low" ? item.confidence : "medium";
    const cue = typeof item?.cue === "string" ? item.cue.trim() : "";
    if (!asked.has(quote)) {
      problems.push(`quote ${String(item?.quote)} wasn't asked about`);
      continue;
    }
    if (answered.has(quote)) continue;
    answered.add(quote);
    if (!speaker || speaker === "unknown" || speaker === "?") continue;
    if (speaker === "new") {
      const full = typeof item?.newName === "string" ? item.newName.trim() : "";
      const member = full ? castMemberNamed(story, full) : undefined;
      if (member) {
        gifts.push({ quote, speaker: member, confidence, cue });
        continue;
      }
      const short = full ? (newcomers.get(full.toLowerCase()) ?? shortName(full)) : "";
      if (!short) {
        problems.push(`quote ${quote}: a new character with no usable name`);
        continue;
      }
      newcomers.set(full.toLowerCase(), short);
      gifts.push({ quote, speaker: short, fullName: full, confidence, cue });
      continue;
    }
    const member =
      castMemberNamed(story, speaker) ??
      known.find((other) => other.name.toLowerCase() === speaker.toLowerCase())?.name;
    if (member) gifts.push({ quote, speaker: member, confidence, cue });
    else problems.push(`quote ${quote}: “${speaker}” isn't in the cast`);
  }
  const unknown = passage.numbers.filter((number) => !gifts.some((gift) => gift.quote === number));
  return { gifts, unknown, problems };
}

/**
 * A short name for someone new: their name if it is one word, else its words joined (`Old Tom`
 * becomes `OldTom`), titles and articles left out (`the Queen` becomes `Queen`).
 */
export function shortName(name: string): string {
  const words = name
    .split(/[^\p{L}\p{N}'’_-]+/u)
    .filter(Boolean)
    .filter(
      (word, index, all) =>
        all.length === 1 ||
        !/^(the|a|an|mr|mrs|ms|miss|dr|sir|lady|lord|captain|capt|mate|father|mother|uncle|aunt|king|queen|prince|princess|professor|colonel|major|general|sergeant|lieutenant|commander|admiral|reverend|madam|madame|monsieur)$/i.test(
          word,
        ) ||
        index === all.length - 1,
    );
  return joined(words.join(" "));
}

/** A name's words joined into one name (`Old Tom` → `OldTom`), or "" if they can't be. */
function joined(name: string): string {
  const words = name.split(/[^\p{L}\p{N}'’_-]+/u).filter(Boolean);
  const short = words.map((word) => (word[0] as string).toUpperCase() + word.slice(1)).join("");
  return isName(short) ? short : "";
}

/** The first JSON object in a text: all of it, or in a code fence, or between its outer braces. */
export function jsonIn(text: string): unknown {
  const attempts = [
    text.trim(),
    /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1] ?? "",
    text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1),
  ];
  for (const attempt of attempts) {
    if (!attempt) continue;
    try {
      return JSON.parse(attempt);
    } catch {}
  }
  return undefined;
}

/**
 * The quotes an English dialogue tag names someone for (`“…” asked Mara`), as gifts: a pass that
 * needs no model, for writers without one or to save it work. Someone the cast doesn't have joins
 * it.
 */
export function tagGifts(story: Story, only?: ReadonlySet<number>): Gift[] {
  const gifts: Gift[] = [];
  const known = speakersOf(story);
  /** Someone new, by their name with no hyphen or space in it: `Guernsey-man` and `Guernseyman` are one. */
  const newcomers = new Map<string, string>();
  for (const quote of quotesOf(story)) {
    if (!quote.narrated || (only && !only.has(quote.number))) continue;
    const tag = taggedName(story, quote);
    if (!tag) continue;
    const member =
      castMemberNamed(story, tag) ??
      known.find((other) => other.name.toLowerCase() === tag.toLowerCase())?.name;
    if (member) {
      if (member !== story.meta.narrator) gifts.push({ quote: quote.number, speaker: member });
      continue;
    }
    // Someone the cast doesn't have yet: they join it, by a one-word name, the same one each time.
    const named = isName(tag) ? tag : shortName(tag);
    const key = named.toLowerCase().replace(/[-'’]/g, "");
    const short = newcomers.get(key) ?? named;
    if (named) newcomers.set(key, short);
    if (short)
      gifts.push({
        quote: quote.number,
        speaker: short,
        ...(short !== tag ? { fullName: tag } : {}),
      });
  }
  return gifts;
}
