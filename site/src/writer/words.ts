/**
 * Words: how many, how long they take to hear, and a kept story's title and first words to know
 * it by.
 */

/** The words in a text: letters and digits, with the apostrophes and hyphens inside them. */
export const wordCount = (content: string): number =>
  content.match(/[\p{L}\p{N}][\p{L}\p{N}’'-]*/gu)?.length ?? 0;

/** How long words take to hear, read aloud at a storyteller's pace (150 words a minute). */
export function listening(words: number): string {
  const minutes = words / 150;
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))} s to hear`;
  const whole = Math.round(minutes);
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
