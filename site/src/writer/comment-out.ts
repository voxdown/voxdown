/**
 * Commenting words out (Insert › A comment for yourself, with words selected). A comment ends at
 * its first `-->` (spec §10.1), so words holding a comment of their own can't simply be wrapped:
 * the comment inside would end the new one early, and the rest would be read and printed. The
 * words between the comments are each commented out instead, and the comments are kept as they
 * are; a selection that starts or ends inside a comment takes in that whole comment.
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
  /** Words already commented out, kept as they were. */
  kept: number;
};

/**
 * `source` from `from` to `to` commented out: wrapped in one comment, or, around the comments
 * already in it, each run of words between them wrapped in its own. Undefined when it holds only
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
  const inside = all.filter((comment) => comment.from >= from && comment.to <= to);
  const wrap = (text: string) => {
    if (!text.trim()) return text;
    const lead = /^\s*/.exec(text)?.[0] ?? "";
    const tail = /\s*$/.exec(text)?.[0] ?? "";
    // A stray `-->` in the words would end their comment early: spaced, it can't.
    const words = text.slice(lead.length, text.length - tail.length).replace(/-->/g, "-- >");
    return `${lead}<!-- ${words} -->${tail}`;
  };
  let insert = "";
  let at = from;
  for (const comment of inside) {
    insert += wrap(source.slice(at, comment.from)) + source.slice(comment.from, comment.to);
    at = comment.to;
  }
  insert += wrap(source.slice(at, to));
  if (insert === source.slice(from, to)) return undefined;
  return { from, to, insert, kept: inside.length };
}
