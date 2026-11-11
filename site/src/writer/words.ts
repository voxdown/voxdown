/**
 * Words: how many, how long they take to hear, and a kept story's title and first words to know
 * it by.
 */

/** The words in a text: letters and digits, with the apostrophes and hyphens inside them. */
export const wordCount = (content: string): number =>
  content.match(/[\p{L}\p{N}][\p{L}\p{N}’'-]*/gu)?.length ?? 0;

/**
 * The words a story's book holds, near enough, read straight from its text as the status line counts
 * them: the front matter, notes, names, directions, sounds and instructions left out, and what the
 * book doesn't print (`{hidden}`, `{audio only}`, in a paragraph, a heading or a group) with them.
 */
export function proseWords(source: string): number {
  const front = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  const body = source.slice(front ? front[0].length : 0).replace(/%%[\s\S]*?(?:%%|$)/g, " ");
  const unprinted = /\{\s*(?:hidden|audio only)\s*\}/i;
  const kept: string[] = [];
  // Groups open around the lines, each printed or not.
  const groups: boolean[] = [];
  let paragraph: string[] = [];
  const end = () => {
    const text = paragraph.join("\n");
    if (!groups.includes(false) && !unprinted.test(text)) kept.push(text);
    paragraph = [];
  };
  for (const line of body.split(/\r?\n/)) {
    const fence = /^:::(.*)$/.exec(line.trim());
    if (fence) {
      end();
      if ((fence[1] ?? "").trim()) groups.push(!unprinted.test(fence[1] ?? ""));
      else groups.pop();
    } else if (!line.trim()) end();
    else if (/^#{1,6}\s/.test(line)) {
      end();
      paragraph.push(line);
      end();
    } else paragraph.push(line);
  }
  end();
  return wordCount(
    kept
      .join("\n\n")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/@[\p{L}\p{N}_-]*(?:[ \t]*\([^)\n]*\))?|\[[^\]\n]*\]|\{[^}\n]*\}/gu, " "),
  );
}

/** A count of words, as said: 1 word, 2 words, 1,234 words. */
export const words = (count: number): string =>
  `${count.toLocaleString()} ${count === 1 ? "word" : "words"}`;

/** How long words take to hear, read aloud at a storyteller's pace (150 words a minute). */
export function listening(words: number): string {
  return timeToHear((words / 150) * 60);
}

/** A time to hear, as said: `40 s to hear`, `12 min to hear`, `2 h 5 min to hear`. */
export function timeToHear(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s to hear`;
  const whole = Math.round(seconds / 60);
  if (whole < 60) return `${whole} min to hear`;
  return `${Math.floor(whole / 60)} h ${whole % 60} min to hear`;
}

/** A kept story's title, from its front matter, and its first words, marks left out. */
export function glimpse(source: string): { title?: string; words: string } {
  const front = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source.slice(0, 20_000));
  const title = front?.[1]
    ? /^title:[ \t]*(["']?)(.+?)\1[ \t]*$/m.exec(front[1])?.[2]?.trim()
    : undefined;
  const body = source
    .slice(front ? front[0].length : 0)
    .slice(0, 1500)
    .replace(/%%[\s\S]*?(?:%%|$)/g, " ")
    .replace(/^#{1,6}[ \t]+/gm, "")
    .replace(/@[\p{L}\p{N}_-]+|\{[^}\n]*\}|\([^)\n]*\)|\[[^\]\n]*\]/gu, " ")
    .replace(/[*_]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const words = body.length > 90 ? `${body.slice(0, 90).replace(/\s\S*$/, "")}…` : body;
  return { ...(title ? { title } : {}), words };
}

/**
 * A file name from a story's title, as the writer would type it: its words and capitals kept, the
 * signs a computer won't have in a file name left out.
 */
export function fileNameFor(title: string): string {
  const name = title
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it takes out
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 80)
    .trim();
  return name || "Untitled";
}
