/**
 * Commenting words out (Insert › A comment for yourself, with words selected), and putting them
 * back. A comment ends at its first `-->` (spec §10.1), so words holding a comment of their own
 * can't simply be wrapped: the comment inside would end the new one early, and the rest would be
 * read and printed. Its end is spaced instead (`-- >`), so the words and the comment inside are
 * one comment; a selection that starts or ends inside a comment takes in that whole comment.
 * Words taken out of a paragraph can give what is left of it to someone else (a name, or half a
 * quote, gone): who says each part before and after is compared, and any change said.
 */
import { type Speech, parse } from "voxdown";

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
  // A whole quote commented out takes its speaker's name (and direction) before it, never left
  // to give the words after it to someone.
  if (/^[“"«„]/u.test(source.slice(from, to)) && /[”"»]/u.test(source.slice(from + 1, to))) {
    const lineStart = source.lastIndexOf("\n", from - 1) + 1;
    const name = /@[\p{L}][\p{L}\p{M}\p{N}_'’-]*(?:[ \t]*\([^)\n]*\))?[ \t]*$/u.exec(
      source.slice(lineStart, from),
    );
    if (name) from = lineStart + name.index;
  }
  const text = source.slice(from, to);
  const inside = all.filter((comment) => comment.from >= from && comment.to <= to);
  if (!text.replace(/<!--[\s\S]*?-->/g, "").trim()) return undefined;
  const lead = /^\s*/.exec(text)?.[0] ?? "";
  const tail = /\s*$/.exec(text)?.[0] ?? "";
  // Every `-->` inside, a comment's or a stray one, spaced: only the new comment's end ends it.
  const words = text.slice(lead.length, text.length - tail.length).replace(/-->/g, "-- >");
  return { from, to, insert: `${lead}<!-- ${words} -->${tail}`, kept: inside.length };
}

/**
 * The comment the selection `from`–`to` is in (a cursor in it, or words of it selected), put back
 * in the text: its words as they were, a comment it held closing again. Undefined outside one.
 */
export function commentBack(
  source: string,
  from: number,
  to: number,
): { from: number; to: number; insert: string } | undefined {
  const comment = commentsIn(source).find((each) =>
    from === to ? each.from < from && from < each.to : each.from <= from && to <= each.to,
  );
  if (!comment) return undefined;
  const inner = source.slice(comment.from + 4, comment.to - 3);
  const words = inner.replace(/^ /, "").replace(/ $/, "").replace(/-- >/g, "-->");
  return { from: comment.from, to: comment.to, insert: words };
}

/** Who says each stretch of a paragraph, and its words. */
function speechesOf(text: string): Speech[] {
  return parse(text).blocks.flatMap((block) =>
    block.kind === "paragraph"
      ? block.lines.flatMap((line) =>
          line.items.filter((item): item is Speech => item.kind === "speech"),
        )
      : [],
  );
}

/**
 * The words whose speaker a change makes another: each with who said them and who says them now.
 * Only the paragraphs it is in are read, on their own.
 */
export function speakersChanged(
  source: string,
  change: { from: number; to: number; insert: string },
  /** The groups the change is in (`::: @Wanda`, its lines given to her), read with them. */
  around?: { from: number; to: number },
): Array<{ words: string; was: string; now: string }> {
  // The paragraphs around the change, from the blank line before it to the one after, or the
  // whole of the groups it is in, whose first line says whose its words are.
  const before = source.lastIndexOf("\n\n", change.from);
  const after = source.indexOf("\n\n", change.to);
  const start = Math.min(before < 0 ? 0 : before + 2, around?.from ?? source.length);
  const end = Math.max(after < 0 ? source.length : after, around?.to ?? 0);
  const was = source.slice(start, end);
  const from = change.from - start;
  const to = change.to - start;
  const now = was.slice(0, from) + change.insert + was.slice(to);
  const grown = change.insert.length - (to - from);
  const old = speechesOf(was);
  const changed: Array<{ words: string; was: string; now: string }> = [];
  for (const speech of speechesOf(now)) {
    // Its first letter: narration's stretch takes in the quotation marks a speaker's doesn't.
    const letter = now.slice(speech.textRange.from, speech.textRange.to).search(/[\p{L}\p{N}]/u);
    if (letter < 0) continue;
    const at = speech.textRange.from + letter;
    // Words inside what was put in (the comment) aren't the story's: only those around it.
    if (at >= from && at < from + change.insert.length) continue;
    const then = at < from ? at : at - grown;
    const said = old.find((each) => each.textRange.from <= then && then < each.textRange.to);
    if (!said || said.speaker === speech.speaker || !speech.text.trim()) continue;
    // The words alone, every quotation mark taken out.
    const text = speech.text
      .replace(/[“”"«»„]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
    const words = text.length > 40 ? `${text.slice(0, 39)}…` : text;
    changed.push({ words, was: said.speaker, now: speech.speaker });
  }
  return changed;
}
