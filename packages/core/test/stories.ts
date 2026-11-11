/**
 * Stories made at random the way people write them: narration, dialogue with and without marks,
 * dialogue tags, directions, a character's sounds, quotes inside quotes, speeches over paragraphs,
 * groups, page turns, pauses and notes, now and then a cast and CRLF line endings. The fuzz tests
 * use them to measure how often an edit declines on prose, where it should almost never.
 */
import fc from "fast-check";

const NAMES = ["Gerald", "Wanda", "Tom", "Zoë", "O’Brien"];
const DIRECTIONS = ["whispering", "softly", "deep, polite", "yawning", "angrily"];
const SOUNDS = ["sighs", "snores", "laughs", "a door creaks", "rain on the roof"];
const SAID = ["said", "asked", "whispered", "replied", "muttered"];
const UTTERANCES = [
  "Hello",
  "Could you not",
  "I’m tired",
  "It’s late",
  "Don’t go",
  "What’s that",
  "We’ll see",
  "Not again",
  "Is anyone there",
  "Rock ’n’ roll, then",
  "Give ’em a chance",
  "’Tis the boys’ dinner",
  "It’s the twins’ turn",
];
const NARRATION = [
  "The dragon yawned.",
  "Rain fell on the old roof.",
  "Nobody moved for a long while.",
  "It was the kind of night that hums.",
  "She didn’t look up from her book.",
  "The kettle began to sing—quietly at first.",
  "Twenty children laughed.",
];
const QUOTES: Array<[string, string]> = [
  ["“", "”"],
  ["“", "”"],
  ['"', '"'],
  ["‘", "’"],
];

const pick = <T>(items: readonly T[]) => fc.constantFrom(...items);
const end = pick([".", "?", "!", "…"]);

/** One line of a paragraph. */
const line: fc.Arbitrary<string> = fc.oneof(
  pick(NARRATION),
  fc
    .tuple(pick(NAMES), pick(QUOTES), pick(UTTERANCES), pick(SAID), pick(UTTERANCES), end)
    .map(
      ([name, [open, close], first, said, second, stop]) =>
        `@${name} ${open}${first},${close} ${said} ${name}. ${open}${second}${stop}${close}`,
    ),
  fc
    .tuple(pick(NAMES), pick(DIRECTIONS), pick(QUOTES), pick(UTTERANCES), end)
    .map(
      ([name, how, [open, close], words, stop]) =>
        `@${name} (${how}) ${open}${words}${stop}${close}`,
    ),
  // Dialogue nobody has marked yet: the narrator's, until someone gives it away.
  fc
    .tuple(pick(QUOTES), pick(UTTERANCES), pick(SAID), pick(NAMES))
    .map(([[open, close], words, said, name]) => `${open}${words},${close} ${said} ${name}.`),
  fc
    .tuple(pick(NAMES), pick(NAMES), pick(UTTERANCES))
    .map(([who, name, words]) => `${who} looked up. @${name} “${words}?”`),
  fc
    .tuple(pick(NAMES), pick(SOUNDS), pick(UTTERANCES))
    .map(([name, sound, words]) => `@${name} [${sound}] “${words}.”`),
  // Markdown with the dialogue: emphasis around a quote and inside one, a link in a quote and in
  // narration.
  fc
    .tuple(pick(NAMES), pick(QUOTES), pick(UTTERANCES), pick(SAID))
    .map(
      ([name, [open, close], words, said]) =>
        `@${name} *${open}${words}.${close}* ${said} ${name}.`,
    ),
  fc
    .tuple(pick(NAMES), pick(QUOTES), pick(UTTERANCES), pick(UTTERANCES))
    .map(([name, [open, close], a, b]) => `@${name} ${open}${a}, **${b}**.${close}`),
  fc
    .tuple(pick(NAMES), pick(UTTERANCES))
    .map(([name, words]) => `@${name} “${words}: look at [the map](https://example.com/map)!”`),
  fc
    .tuple(pick(NARRATION), pick(NAMES))
    .map(([words, name]) => `${words} _${name}_ found [a note](note.html "A note").`),
  // A mark before the narration that leads up to its quote (§5.4).
  fc
    .tuple(pick(NAMES), pick(NAMES), pick(QUOTES), pick(UTTERANCES), fc.option(pick(DIRECTIONS)))
    .map(
      ([name, who, [open, close], words, how]) =>
        `@${name}${how ? ` (${how})` : ""} ${who} put down the cup. ${open}${words}.${close}`,
    ),
  fc
    .tuple(pick(NAMES), pick(UTTERANCES))
    .map(([name, words]) => `@${name} “He said ‘${words}’, and left.”`),
  fc
    .tuple(pick(NAMES), pick(UTTERANCES), pick(DIRECTIONS), pick(UTTERANCES))
    .map(([name, first, how, second]) => `@${name} “${first}. @(${how}) ${second}.”`),
  fc
    .tuple(pick(NARRATION), pick(SOUNDS))
    .map(([words, sound]) => `${words} [${sound}] Nobody spoke.`),
  fc
    .tuple(pick(NAMES), pick(UTTERANCES))
    .map(([name, words]) => `@${name} “${words} {page} and on.”`),
);

/** A block: a paragraph, a speech over paragraphs, a group, a heading, a page turn or a note. */
const block: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.array(line, { minLength: 1, maxLength: 3 }).map((lines) => lines.join("\n")),
  },
  {
    weight: 1,
    arbitrary: fc
      .tuple(pick(NAMES), pick(UTTERANCES), pick(UTTERANCES), pick(UTTERANCES))
      .map(([name, a, b, c]) => `@${name} “${a}.\n\n“${b}.\n\n“${c}.”`),
  },
  {
    // A speech over paragraphs nobody has marked yet, its tag at the end (§5.7).
    weight: 1,
    arbitrary: fc
      .tuple(pick(QUOTES), pick(UTTERANCES), pick(UTTERANCES), pick(SAID), pick(NAMES))
      .map(
        ([[open, close], a, b, said, name]) =>
          `${open}${a}.\n\n${open}${b},${close} ${said} ${name}.`,
      ),
  },
  {
    weight: 1,
    arbitrary: fc
      .tuple(pick(NAMES), pick(DIRECTIONS), fc.array(line, { minLength: 1, maxLength: 2 }))
      .map(([name, how, lines]) => `::: @${name} (${how})\n${lines.join("\n")}\n:::`),
  },
  {
    weight: 1,
    arbitrary: fc
      .tuple(pick(DIRECTIONS), fc.array(line, { minLength: 1, maxLength: 2 }))
      .map(([how, lines]) => `::: ${how}\n${lines.join("\n")}\n:::`),
  },
  {
    weight: 1,
    arbitrary: fc
      .tuple(pick(NAMES), pick(UTTERANCES), pick(UTTERANCES))
      .map(([name, a, b]) => `@${name} (softly) “${a},\n${b}.”`),
  },
  {
    // A direction inside a quote that runs on over the next line.
    weight: 1,
    arbitrary: fc
      .tuple(pick(NAMES), pick(UTTERANCES), pick(DIRECTIONS), pick(UTTERANCES), pick(UTTERANCES))
      .map(([name, a, how, b, c]) => `@${name} “${a}. @(${how}) ${b},\n${c}.”`),
  },
  {
    weight: 1,
    arbitrary: pick([
      "# Chapter One",
      "## The Storm",
      "***",
      "{page}",
      "{pause 2s}",
      "%% Slowly here. %%",
    ]),
  },
);

const cast = fc
  .subarray(NAMES, { minLength: 1 })
  .map(
    (names) =>
      `---\ncast:\n${names.map((name) => `  ${name}: ${name} the Brave`).join("\n")}\n---\n\n`,
  );

/** A story of a few blocks, with a cast now and then, and CRLF line endings now and then. */
export const proseStory: fc.Arbitrary<string> = fc
  .tuple(
    fc.option(cast, { freq: 3 }),
    fc.array(block, { minLength: 1, maxLength: 8 }),
    fc.boolean(),
  )
  .map(([front, blocks, crlf]) => {
    const text = `${front ?? ""}${blocks.join("\n\n")}\n`;
    return crlf ? text.replace(/\n/g, "\r\n") : text;
  });
