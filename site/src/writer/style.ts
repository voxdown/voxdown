/**
 * A gentle style check, on this computer, with no AI: a word said again too soon, a sentence long
 * enough to lose a listener, and the words a story leans on most. Only the story's words are read:
 * its marks, directions, sounds, instructions, notes, headings and the writer's comments are left out.
 */

export type StyleHint = {
  from: number;
  to: number;
  kind: "again" | "long";
  message: string;
};

/** Words too common to count as said again: articles, pronouns, the commonest verbs and the like. */
const COMMON = new Set(
  `a about above after again against all also am an and any are as at be because been before
being below between both but by can could did do does doing down during each even ever every few
for from further get got had has have having he her here hers herself him himself his how i if in
into is it its itself just let like made make me might more most much must my myself never no nor
not now of off on once one only or other our ours ourselves out over own said same say says see
seemed she should so some such than that the their theirs them themselves then there these they
this those through to too under until up upon us very was we were what when where which while who
whom why will with would yes yet you your yours yourself yourselves back come came go went know
knew look looked still well way thing things something nothing anything everything there's it's
i'm don't didn't can't won't that's he's she's they're we're you're asked replied told`.split(
    /\s+/,
  ),
);

/** Words a draft often leans on, said in a list of their own. */
export const CRUTCHES = new Set(
  `just really very quite rather suddenly actually basically literally simply somehow somewhat
seemed seem seems began started felt feel feeling realized realised noticed nodded shrugged sighed
smiled grinned turned looked glanced`.split(/\s+/),
);

/**
 * The story's words alone, at their places: every mark and its words turned to spaces, so a
 * place in this text is the same place in the story.
 */
export function wordsOnly(text: string): string {
  const blank = (found: string) => found.replace(/[^\n]/g, " ");
  return (
    text
      // The writer's comments and notes, over several lines or not.
      .replace(/<!--[\s\S]*?-->/g, blank)
      .replace(/%%[\s\S]*?%%/g, blank)
      // A name and its direction, a direction for whoever speaks, an end, `@()`.
      .replace(/@[\p{L}][\p{L}\p{M}\p{N}_'’-]*(?:[ \t]*\([^)\n]*\))?|@\([^)\n]*\)|@\//gu, blank)
      // Sounds and a character's sounds, instructions, headings' and groups' signs.
      .replace(/\[[^\]\n]*\]|\{[^}\n]*\}/g, blank)
      // Headings, whole: a chapter's name is no sentence of the story's.
      .replace(/^[ \t]*(?:#{1,6}[ \t].*|#{1,6}$|:::.*)$/gm, blank)
  );
}

const WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu;

/** How a word is compared: its case and its apostrophe's kind left aside. */
const key = (word: string) => word.toLowerCase().replace(/’/g, "'");

/**
 * Hints in `text`, which starts at `offset` in the story: a word of four letters or more, not a
 * common one, said again within `within` words; a sentence of more than `long` words.
 */
export function styleHints(
  text: string,
  offset = 0,
  { within = 30, long = 40 }: { within?: number; long?: number } = {},
): StyleHint[] {
  const hints: StyleHint[] = [];
  const plain = wordsOnly(text);
  const seen = new Map<string, { at: number; capital: boolean }>();
  let index = 0;
  for (const found of plain.matchAll(WORD)) {
    const word = key(found[0]);
    const capital = /^\p{Lu}/u.test(found[0]);
    if (word.length >= 4 && !COMMON.has(word) && !/^\d+$/.test(word)) {
      const before = seen.get(word);
      const last = before?.at;
      // A name, capitalised both times, is meant to come back.
      if (last !== undefined && index - last <= within && !(capital && before?.capital)) {
        const gap = index - last - 1;
        hints.push({
          from: offset + (found.index ?? 0),
          to: offset + (found.index ?? 0) + found[0].length,
          kind: "again",
          message: `“${found[0]}” again, ${gap === 0 ? "right after the last" : `${gap} ${gap === 1 ? "word" : "words"} after the last`}`,
        });
      }
      seen.set(word, { at: index, capital });
    }
    index++;
  }
  // Sentences: up to a full stop, a question or an exclamation, or a blank line.
  for (const sentence of plain.matchAll(/[^.!?…\n]+(?:\n(?!\s*\n)[^.!?…\n]+)*[.!?…]*/g)) {
    const count = sentence[0].match(WORD)?.length ?? 0;
    if (count <= long) continue;
    const start = (sentence.index ?? 0) + (sentence[0].length - sentence[0].trimStart().length);
    hints.push({
      from: offset + start,
      to: offset + (sentence.index ?? 0) + sentence[0].trimEnd().length,
      kind: "long",
      message: `A sentence of ${count} words: a listener may lose its thread`,
    });
  }
  return hints.sort((a, b) => a.from - b.from);
}

export type Overused = { word: string; count: number; perThousand: number; crutch: boolean };

/**
 * The words the story leans on most, beyond the common ones: those it uses at least `least` times,
 * the most first; the words drafts often lean on (just, really, suddenly…) wherever they come.
 */
export function overusedWords(text: string, least = 8, most = 15): Overused[] {
  const counts = new Map<string, { word: string; count: number; capitals: number }>();
  let total = 0;
  for (const found of wordsOnly(text).matchAll(WORD)) {
    total++;
    const word = key(found[0]);
    if (/^\d+$/.test(word)) continue;
    if (COMMON.has(word) && !CRUTCHES.has(word)) continue;
    if (word.length < 4 && !CRUTCHES.has(word)) continue;
    const capital = /^\p{Lu}/u.test(found[0]) ? 1 : 0;
    const kept = counts.get(word);
    if (kept) {
      kept.count++;
      kept.capitals += capital;
    } else counts.set(word, { word: found[0].toLowerCase(), count: 1, capitals: capital });
  }
  const perThousand = (count: number) => Math.round((count / Math.max(1, total)) * 10000) / 10;
  return (
    [...counts.entries()]
      // Names, nearly always capitalised, are meant to come back: left out.
      .filter(([word, { count, capitals }]) => capitals < count * 0.9 || CRUTCHES.has(word))
      .filter(([word, { count }]) => count >= (CRUTCHES.has(word) ? 3 : least))
      .map(([word, { count }]) => ({
        word,
        count,
        perThousand: perThousand(count),
        crutch: CRUTCHES.has(word),
      }))
      .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
      .slice(0, most)
  );
}
