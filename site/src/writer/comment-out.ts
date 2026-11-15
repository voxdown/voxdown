/**
 * Commenting words out (Insert › A comment for yourself, with words selected). A comment ends at
 * its first `-->` (spec §10.1), so words holding a comment of their own can't simply be wrapped:
 * the comment inside would end the new one early, and the rest would be read and printed. Its end
 * is spaced instead (`-- >`), so the words and the comment inside are one comment; a selection
 * that starts or ends inside a comment takes in that whole comment.
 */

/** The comments in `text`, each from its `<!--` to the end of its `-->`. An unclosed one is text. */
export function commentsIn(text: string): Array<{ from: number; to: number }> {
  return [...text.matchAll(/<!--[\s\S]*?-->/g)].map((found) => ({
    from: found.index ?? 0,
    to: (found.index ?? 0) + found[0].length,
  }));
}

export type CommentOut = {
  /** The selection, taken out to the whole comments it starts or ends in. */
  from: number;
  to: number;
  /** What it becomes. */
  insert: string;
  /** Comments already in it, kept inside the new one. */
  kept: number;
  /** A speaker's name commented out with the words, whose quote after them is now the narrator's. */
  unnamed?: string;
};

/**
 * `source` from `from` to `to` commented out, as one comment. Undefined when it holds only
 * comments and spaces: there is nothing left to comment out.
 */
export function commentOut(
  source: string,
  selectedFrom: number,
  selectedTo: number,
): CommentOut | undefined {
  const all = commentsIn(source);
  let from = selectedFrom;
  let to = selectedTo;
  // A selection starting or ending inside a comment takes that comment in.
  for (const comment of all) {
    if (comment.from < from && from < comment.to) from = comment.from;
    if (comment.from < to && to < comment.to) to = comment.to;
  }
  const text = source.slice(from, to);
  const inside = all.filter((comment) => comment.from >= from && comment.to <= to);
  if (!text.replace(/<!--[\s\S]*?-->/g, "").trim()) return undefined;
  const lead = /^\s*/.exec(text)?.[0] ?? "";
  const tail = /\s*$/.exec(text)?.[0] ?? "";
  // Every `-->` inside, a comment's or a stray one, spaced: only the new comment's end ends it.
  const words = text.slice(lead.length, text.length - tail.length).replace(/-->/g, "-- >");
  // A name (and its direction) at the end of the words, a quote straight after: the quote loses it.
  const name = /@([\p{L}][\p{L}\p{M}\p{N}_'’-]*)(?:[ \t]*\([^)\n]*\))?$/u.exec(words);
  const after = source.slice(to);
  const unnamed = name && /^[ \t]*(?:\([^)\n]*\)[ \t]*)?[“"«„]/u.test(after) ? name[1] : undefined;
  return {
    from,
    to,
    insert: `${lead}<!-- ${words} -->${tail}`,
    kept: inside.length,
    ...(unnamed ? { unnamed } : {}),
  };
}
