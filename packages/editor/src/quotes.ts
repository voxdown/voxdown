import { EditorState, type Extension, type Text } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { type Speech, type Story, curlQuotes, parse, quotationMarks } from "voxdown";
import { FRESH_BELOW } from "./decorations";

/**
 * Typographer's quotes as you type: `"` opens with “ after a space, a line's start or an opening
 * bracket, and closes with ” anywhere else; `'` is an apostrophe ’ after a letter, and opens with ‘
 * after a space. Undo straight after brings back the straight mark.
 */
const OPENS_AFTER = /[\s([{—–\-]$/u;

/**
 * Pasted words get the quotes and apostrophes the formatter would give them (it's → it’s,
 * "Hi" → “Hi”), checked against the parser as the formatter checks them: where curly marks would
 * make anyone say anything differently, they stay straight. Front matter, link addresses and
 * titles, marks, sounds, notes and instructions keep their marks, and so does a measurement
 * (6'2"). Only what was pasted changes.
 */
const pastedApostrophes = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent("input.paste")) return tr;
  const after = tr.newDoc.toString();
  const curled = curlQuotes(after);
  // Each mark is one character either way, so the pasted ranges stand where they did.
  if (curled === after || curled.length !== after.length) return tr;
  const specs: Array<{ from: number; to: number; insert: string }> = [];
  let found = false;
  tr.changes.iterChanges((fromA, toA, fromB, toB) => {
    const insert = curled.slice(fromB, toB);
    if (insert !== after.slice(fromB, toB)) found = true;
    specs.push({ from: fromA, to: toA, insert });
  });
  if (!found) return tr;
  // Only what was pasted takes its curly marks, so the story is checked as it will be: a quote
  // opened before the paste with a straight mark must still close in it (`"Hello` + ` world," she
  // said.`), or the paste keeps the marks it came with.
  const pieces: string[] = [];
  let at = 0;
  tr.changes.iterChanges((_fromA, _toA, fromB, toB) => {
    pieces.push(after.slice(at, fromB), curled.slice(fromB, toB));
    at = toB;
  });
  pieces.push(after.slice(at));
  if (voices(parse(pieces.join(""))) !== voices(parse(after))) return tr;
  return {
    changes: specs,
    selection: tr.selection,
    scrollIntoView: tr.scrollIntoView,
    userEvent: "input.paste",
  };
});

/** Who says what, and how: every stretch and character's sound, with its quotation marks as one. */
function voices(story: Story): string {
  const heard: string[] = [];
  for (const block of story.blocks) {
    if (block.kind === "break") continue;
    for (const line of block.kind === "heading" ? [block.line] : block.lines) {
      for (const item of line.items) {
        if (item.kind === "speech") {
          const words = item.text.replace(/["'“”‘’„‚«»‹›「」『』]/gu, "'");
          heard.push(`${item.speaker}\u0000${item.direction}\u0000${item.quoted}\u0000${words}`);
        } else if (item.kind === "vocal") {
          heard.push(`${item.speaker}\u0000${item.direction}\u0000[${item.description}]`);
        }
      }
    }
  }
  return heard.join("\n");
}

/** The mark that closes each opening one, as the parser pairs them (§5.5); the language's first. */
const CLOSING: Record<string, string> = {
  "“": "”",
  "‘": "’",
  '"': '"',
  "'": "'",
  "„": "“",
  "‚": "‘",
  "«": "»",
  "»": "«",
  "‹": "›",
  "「": "」",
  "『": "』",
};

/** Opening marks of the double kind, which a typed `"` closes. */
const DOUBLE = new Set(['"', "“", "„", "«", "»", "「"]);

function closerFor(opener: string, language: string | undefined): string {
  const marks = quotationMarks(language);
  if (opener === marks.open) return marks.close;
  if (opener === marks.innerOpen) return marks.innerClose;
  return CLOSING[opener] ?? marks.close;
}

/** The quote open at `at`, as the parser reads it: its speech, and the mark that opened it. */
function openQuoteAt(story: Story, at: number): { speech: Speech; opener: string } | undefined {
  for (const block of story.blocks) {
    if (block.kind === "break" || at < block.range.from || at > block.range.to) continue;
    for (const line of block.kind === "heading" ? [block.line] : block.lines) {
      if (at < line.range.from || at > line.range.to) continue;
      for (const item of line.items) {
        if (item.kind !== "speech" || !item.openQuote) continue;
        // A quote nothing closes runs to the end of its line, spaces typed after it included.
        const end = item.closeQuote ? item.closeQuote.from : line.range.to;
        if (item.openQuote.to <= at && at <= end) {
          return {
            speech: item,
            opener: story.source.slice(item.openQuote.from, item.openQuote.to),
          };
        }
      }
    }
  }
  return undefined;
}

/**
 * The mark that opened the quote the paragraphs before `at` leave open, if any: the last quote of
 * the last paragraph before it that has one, as §5.7 skips paragraphs of notes.
 */
function unclosedBefore(story: Story, at: number): string | undefined {
  let last: Speech | undefined;
  for (const block of story.blocks) {
    if (block.range.from >= at) break;
    if (block.kind !== "paragraph" || block.range.to > at) {
      if (block.kind !== "paragraph") last = undefined;
      continue;
    }
    for (const line of block.lines) {
      for (const item of line.items) if (item.kind === "speech" && item.openQuote) last = item;
    }
  }
  if (!last?.openQuote || last.closeQuote) return undefined;
  return story.source.slice(last.openQuote.from, last.openQuote.to);
}

/**
 * Whether the paragraph up to `at` leaves a straight `"` open: an odd number of them, not escaped
 * and not after a digit (`6'2"`).
 */
function straightOpen(doc: Text, at: number): boolean {
  let start = doc.lineAt(at).from;
  for (let n = doc.lineAt(at).number - 1; n >= 1; n--) {
    const line = doc.line(n);
    if (!line.text.trim()) break;
    start = line.from;
  }
  const text = doc.sliceString(start, at);
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === '"' && !/\d/u.test(text[i - 1] ?? "")) count++;
  }
  return count % 2 === 1;
}

/** The last mark for `speaker` between `from` and `to`, its name as written. */
function nameBefore(story: Story, from: number, to: number, speaker: string): string | undefined {
  let name: string | undefined;
  for (const block of story.blocks) {
    if (block.kind === "break" || block.range.to < from || block.range.from > to) continue;
    for (const line of block.kind === "heading" ? [block.line] : block.lines) {
      for (const item of line.items) {
        if (item.kind !== "mark" || item.speaker !== speaker) continue;
        if (item.range.from >= from && item.range.to <= to) {
          name = story.source.slice(item.nameRange.from, item.nameRange.to);
        }
      }
    }
  }
  return name;
}

/** The speech that holds the character just before `at`. */
function speechBefore(story: Story, at: number): Speech | undefined {
  for (const block of story.blocks) {
    if (block.kind === "break" || at <= block.range.from || at > block.range.to) continue;
    for (const line of block.kind === "heading" ? [block.line] : block.lines) {
      for (const item of line.items) {
        if (item.kind === "speech" && item.range.from < at && at <= item.range.to) return item;
      }
    }
  }
  return undefined;
}

/** A story read for a decision at one place, and how far its text is shifted from the editor's. */
type Near = { story: Story; text: string; shift: number };

/**
 * The story around `at`, to decide a quote by. A short story is read whole. A long one is read as
 * its front matter (for the language and the cast) with the paragraph at `at` and the one before it
 * (for a speech it carries on, §5.7): reading a whole book on each Enter or quote typed made those
 * keys lag (150 ms at 120,000 words). Positions in it are the editor's less `shift`.
 */
function readNear(state: EditorState, at: number): Near {
  const doc = state.doc;
  if (doc.length < FRESH_BELOW) {
    const text = doc.toString();
    return { story: parse(text), text, shift: 0 };
  }
  // Where the front matter ends: the line closing a `---` that opens the file.
  const opening = doc.sliceString(0, Math.min(doc.length, 50_000));
  const front = /^\uFEFF?---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)[ \t]*(?=\r?\n|$)/.exec(
    opening,
  );
  const frontEnd = front ? front[0].length : 0;
  if (at <= frontEnd) {
    const text = doc.sliceString(0, Math.min(doc.length, frontEnd + 1));
    return { story: parse(text), text, shift: 0 };
  }
  const blank = (number: number) => doc.line(number).text.trim() === "";
  let first = doc.lineAt(at).number;
  while (first > 1 && !blank(first - 1)) first--;
  let before = first - 1;
  while (before > 1 && blank(before)) before--;
  while (before > 1 && !blank(before - 1)) before--;
  let last = doc.lineAt(at).number;
  while (last < doc.lines && !blank(last + 1)) last++;
  const from = Math.max(frontEnd, doc.line(Math.max(1, before)).from);
  const head = frontEnd ? `${doc.sliceString(0, frontEnd)}\n\n` : "";
  const text = head + doc.sliceString(from, doc.line(last).to);
  return { story: parse(text), text, shift: from - head.length };
}

/** Whether a line's text up to here leaves a sound's `[` open. */
function inLabel(head: string): boolean {
  let inside = false;
  for (let i = 0; i < head.length; i++) {
    const c = head[i];
    if (c === "\\") i++;
    else if (c === "[") inside = true;
    else if (c === "]") inside = false;
  }
  return inside;
}

export function smartQuotes(): Extension {
  return [pastedApostrophes, smartQuoteInput];
}

/** A word cut short at its start ('Twas, 'n', 'em, '90s): its mark is an apostrophe. */
const ELIDED = /(^|[\s([{—–-])‘((?:twas|tis|em|n|cause|til|round|bout|ere)|\d+s?)$/iu;

const smartQuoteInput = EditorView.inputHandler.of((view, from, to, text) => {
  if (view.state.readOnly) return false;
  // Typed, the ‘ came before the word was known: once the word ends it becomes ’.
  if (/^[\s,.;:!?'’]$/u.test(text) && from === to) {
    const line = view.state.doc.lineAt(from);
    const before = line.text.slice(0, from - line.from);
    const elided = ELIDED.exec(before);
    if (elided) {
      const mark = from - (elided[2] ?? "").length - 1;
      view.dispatch({
        changes: [
          { from: mark, to: mark + 1, insert: "’" },
          { from, to, insert: text === "'" ? "’" : text },
        ],
        selection: { anchor: from + 1 },
        userEvent: "input.type",
      });
      return true;
    }
  }
  if (text === "%") return closeNote(view, from, to);
  if (/^\d$/u.test(text) && pauseLength(view, from, to, text)) return true;
  if (text === " " && leavePause(view, from, to)) return true;
  if (text === " ") return noteSpace(view, from, to);
  if (text !== '"' && text !== "'") return false;
  // In a sound's label a mark stays as typed: the label names the same sound.
  {
    const line = view.state.doc.lineAt(from);
    if (inLabel(line.text.slice(0, from - line.from))) return false;
  }
  const before = view.state.sliceDoc(Math.max(0, from - 1), from);
  // 6" and 5' are measurements, not quotes.
  if (/\d/u.test(before)) return false;
  // Where the formatter keeps marks as written, typing does too: the front matter, a group line,
  // an instruction, a note, a mark or direction, an image, and a link's address.
  const near = readNear(view.state, from);
  const story = near.story;
  // Where the cursor is in what was read.
  const here = from - near.shift;
  const within = (range: { from: number; to: number }) => range.from < here && here < range.to;
  if (story.frontMatter && here <= story.frontMatter.range.to) return false;
  // Front matter still being written: the story opens with `---`, and nothing closes it yet.
  {
    const head = view.state.sliceDoc(0, from);
    if (/^\uFEFF?---[ \t]*\r?\n/.test(head) && !/\n(?:---|\.\.\.)[ \t]*\r?\n/.test(head.slice(3))) {
      return false;
    }
  }
  // A group line, to its end: what is typed there is still the group's.
  const onLine = (range: { from: number; to: number }) => range.from < here && here <= range.to;
  for (const group of story.groups) {
    if (onLine(group.range) || (group.closeRange && onLine(group.closeRange))) return false;
  }
  for (const block of story.blocks) {
    if (block.kind === "break") continue;
    for (const item of (block.kind === "heading" ? [block.line] : block.lines).flatMap(
      (l) => l.items,
    )) {
      if (
        item.kind !== "speech" &&
        item.kind !== "vocal" &&
        item.kind !== "sound" &&
        within(item.range)
      )
        return false;
    }
  }
  {
    // A link's address, and an instruction or note still being written: a `{` the line hasn't
    // closed, or a `%%` that opens a note no `%%` has closed yet.
    const line = view.state.doc.lineAt(from);
    const head = line.text.slice(0, from - line.from);
    if (/\]\([^)]*$/u.test(head) || /\{[^{}]*$/u.test(head)) return false;
    const notes = view.state.sliceDoc(0, from).replace(/\\%/g, "").split("%%").length - 1;
    if (notes % 2 === 1) return false;
  }
  const marks = quotationMarks(story.meta.language);
  // A quote opened with a straight mark closes with one, as typed: `"Hello world,"`. A curly `”`
  // would close nothing, and the rest of the line would be said.
  const outer = openQuoteAt(story, here);
  if (outer && outer.opener === text) return false;
  // A straight `"` the narration holds open is no one's speech, so the parser lists it nowhere:
  // with an odd number of them in the paragraph so far, the `"` typed closes one, straight.
  if (text === '"' && !outer && straightOpen(view.state.doc, from)) return false;
  // A paragraph that opens with the mark the speech before it opened with carries it on (§5.7):
  // typed straight after a speech opened straight, the mark stays straight and carries it on.
  if (!outer && !view.state.sliceDoc(view.state.doc.lineAt(from).from, from).trim()) {
    const before = unclosedBefore(story, here);
    if (before === text) return false;
  }
  // A `'` is no quote until something closes it (§5.5), so the parser is asked with the mark typed
  // straight: if it closes a quote opened with `'`, it stays straight.
  if (text === "'" && !outer) {
    const lineStart = view.state.doc.lineAt(from).from;
    if (view.state.sliceDoc(lineStart, from).includes("'")) {
      const tried = parse(near.text.slice(0, here) + text + near.text.slice(here + (to - from)));
      const closed = speechBefore(tried, here + 1);
      if (
        closed?.closeQuote?.from === here &&
        closed.openQuote &&
        tried.source.slice(closed.openQuote.from, closed.openQuote.to) === "'"
      ) {
        return false;
      }
    }
  }
  // A quote inside the other kind opens (“‘…’”); straight after its own opener, it closes it.
  const nested =
    (text === '"' && before === marks.innerOpen) || (text === "'" && before === marks.open);
  // Straight after a name or its direction, a quote is the line it says: it opens.
  const line = view.state.doc.lineAt(from);
  const head = line.text.slice(0, from - line.from);
  const afterMark =
    text === '"' &&
    /(^|[^\p{L}\p{N}\\])@(?:\p{L}[\p{L}\p{M}\p{N}_'’-]*)?\s*(\([^()]*\))?\s*$/u.test(head);
  // A `"` after a dash closes a quote the line has open (`“Wait—”`) rather than open another.
  const count = (mark: string) => head.split(mark).length - 1;
  let open =
    marks.open === marks.close
      ? count(marks.open) % 2 === 1
      : count(marks.open) > count(marks.close);
  // A quote opened with another language's marks (“ in a German story) closes with its own.
  let closer = marks.close;
  if (!open && outer && DOUBLE.has(outer.opener)) {
    open = true;
    closer = closerFor(outer.opener, story.meta.language);
  }
  const closes = text === '"' && open && !nested && !afterMark;
  const opening =
    !closes && (from === 0 || before === "" || OPENS_AFTER.test(before) || nested || afterMark);
  // In the story's language (front matter's `language`): „…“ in German, «…» in French.
  const insert = text === '"' ? (opening ? marks.open : closer) : opening ? marks.innerOpen : "’";
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    userEvent: "input.type",
  });
  return true;
});

/**
 * A length typed straight after a finished `{pause}` is its length: `{pause} 1` becomes
 * `{pause 1}`, the cursor inside, so `{pau` ⏎ `1s` gives `{pause 1s}`.
 */
function pauseLength(view: EditorView, from: number, to: number, digit: string): boolean {
  if (from !== to) return false;
  const before = view.state.sliceDoc(Math.max(0, from - 12), from);
  const m = /\{pause\}([ \t]*)$/iu.exec(before);
  if (!m) return false;
  const close = from - 1 - (m[1] ?? "").length;
  view.dispatch({
    changes: { from: close, to: from, insert: ` ${digit}}` },
    selection: { anchor: close + 1 + digit.length },
    userEvent: "input.type",
  });
  return true;
}

/** A space after a pause's length leaves the pause: `{pause 1s|}` ␣ gives `{pause 1s} |`. */
function leavePause(view: EditorView, from: number, to: number): boolean {
  if (from !== to || view.state.sliceDoc(from, from + 1) !== "}") return false;
  const line = view.state.doc.lineAt(from);
  const before = line.text.slice(0, from - line.from);
  if (!/\{pause \d+(?:\.\d*)?\s*(?:ms|s)?$/iu.test(before)) return false;
  const spaced = view.state.sliceDoc(from + 1, from + 2) === " ";
  view.dispatch({
    ...(spaced ? {} : { changes: { from: from + 1, insert: " " } }),
    selection: { anchor: from + 2 },
    userEvent: "input.type",
  });
  return true;
}

/** The second `%` of a note's opening `%%` closes the note too: `%% | %%`, cursor inside. */
function closeNote(view: EditorView, from: number, to: number): boolean {
  if (from !== to) return false;
  const line = view.state.doc.lineAt(from);
  const before = line.text.slice(0, from - line.from);
  const after = line.text.slice(from - line.from);
  // `%` typed just before a note's own ` %%`: it closes the note, keeping the space.
  if (after.startsWith(" %%") && (before.match(/%%/gu) ?? []).length % 2 === 1) {
    // A space typed after the last word already sits before the closing ` %%`: drop it.
    if (before.endsWith(" ") && !/%% $/u.test(before)) {
      view.dispatch({
        changes: { from: from - 1, to: from },
        selection: { anchor: from + 1 },
        userEvent: "input.type",
      });
      return true;
    }
    view.dispatch({ selection: { anchor: from + 2 }, userEvent: "input.type" });
    return true;
  }
  // Typing the closing marks of a note that closed itself steps over them.
  if (
    after.startsWith("%") &&
    /%%/u.test(before) &&
    (before.match(/%%/gu) ?? []).length % 2 === 1
  ) {
    if (after.startsWith("%%") || before.endsWith("%")) {
      view.dispatch({ selection: { anchor: from + 1 }, userEvent: "input.type" });
      return true;
    }
  }
  if (!before.endsWith("%")) return false;
  const opening = before.slice(0, -1);
  if (opening.endsWith("\\") || (opening.match(/%%/gu) ?? []).length % 2 === 1) return false;
  if (after.includes("%%")) return false;
  view.dispatch({
    changes: { from, insert: "%  %%" },
    selection: { anchor: from + 2 },
    userEvent: "input.type",
  });
  return true;
}

/**
 * Inside a note that closed itself: right after the opening `%% ` the space is there already, so
 * a space typed there isn't doubled. Anywhere else a space is a space between the note's words
 * (`%`, or Enter at the end, leaves the note).
 */
function noteSpace(view: EditorView, from: number, to: number): boolean {
  if (from !== to) return false;
  const line = view.state.doc.lineAt(from);
  const before = line.text.slice(0, from - line.from);
  const after = line.text.slice(from - line.from);
  if (!/^ %%/u.test(after) || (before.match(/%%/gu) ?? []).length % 2 !== 1) return false;
  return /%% $/u.test(before);
}

/**
 * Enter at the end of a note's words leaves the note: the cursor goes past its closing `%%`
 * first, so the note stays on its line.
 */
export const noteEnter = keymap.of([
  {
    key: "Enter",
    run: (view) => {
      const { from, to } = view.state.selection.main;
      if (from !== to) return false;
      const line = view.state.doc.lineAt(from);
      const before = line.text.slice(0, from - line.from);
      const after = line.text.slice(from - line.from);
      if (!/^\s*%%\s*$/u.test(after) || (before.match(/%%/gu) ?? []).length % 2 !== 1) return false;
      view.dispatch({
        changes: { from: line.to, insert: "\n" },
        selection: { anchor: line.to + 1 },
        userEvent: "input",
      });
      return true;
    },
  },
]);

/** A split's new line: a name, its direction, and the quote's opening mark, nothing after. */
const OPENED = /^@(\p{L}[\p{L}\p{M}\p{N}_'’-]*)[ \t]*(\([^()]*\))?[ \t]*([“‘"'„‚«»‹「『])$/u;

/**
 * Enter inside a quote splits it: the quote closes, and the next line opens it again for the same
 * speaker and direction (`@Rupert “No toast.” ⏎ @Rupert “No bread either.”`). What a mark does
 * ends with its line, so a quote never runs on into the next one. The quote is the one the parser
 * has open at the cursor, closed with its own mark (`„…“` in German, `"…"` when opened straight),
 * and the split must give both halves to the same speaker, with the same direction; anywhere else
 * Enter is Enter.
 */
export const quoteEnter = keymap.of([
  {
    key: "Enter",
    run: (view) => {
      const { from, to } = view.state.selection.main;
      if (from !== to || view.state.readOnly) return false;
      const line = view.state.doc.lineAt(from);
      const head = line.text.slice(0, from - line.from);
      const tail = line.text.slice(from - line.from);
      // Enter on a split's empty new line (`@Rupert “` and nothing yet) ends the speech there,
      // as Enter on an empty list item ends a list: a new paragraph follows, so two
      // Enters after a quote make one, as they do anywhere else.
      if (!tail.trim() && OPENED.test(head)) {
        view.dispatch({
          changes: { from: line.from, to: line.to, insert: "\n" },
          selection: { anchor: line.from + 1 },
          userEvent: "delete",
        });
        return true;
      }
      const near = readNear(view.state, from);
      const { story, text: source, shift } = near;
      const here = from - shift;
      const open = openQuoteAt(story, here);
      if (!open?.speech.openQuote) return false;
      const { speech, opener } = open;
      const start = speech.openQuote?.to ?? here;
      if (start + shift < line.from || !/[\p{L}\p{N}]/u.test(source.slice(start, here)))
        return false;
      const rest = tail.replace(/^[ \t]+/u, "");
      const restFrom = from + (tail.length - rest.length);
      // The quote closes straight after its last word, not after a space typed before Enter.
      const words = head.replace(/[ \t]+$/u, "");
      const splitAt = from - (head.length - words.length);
      // Right before the closing mark the quote is finished: the new line goes after the whole
      // line, whatever follows the quote (a sound, "he said").
      if (speech.closeQuote?.from === restFrom - shift) {
        view.dispatch({
          changes: { from: line.to, insert: "\n" },
          selection: { anchor: line.to + 1 },
          userEvent: "input",
        });
        return true;
      }
      // The speaker's mark as written, the last on the line before the quote (a quote that
      // carries on a speech has none of its own), and the direction the quote is said with.
      const name = nameBefore(story, line.from - shift, start, speech.speaker);
      const direction = speech.ownDirection;
      const mark = name ? `@${name} ${direction ? `(${direction}) ` : ""}` : "";
      const closer = closerFor(opener, story.meta.language);
      const insert = `${closer}\n${mark}${opener}`;
      const at = splitAt - shift;
      const after = source.slice(0, at) + insert + source.slice(restFrom - shift);
      // Both halves are the speaker's, said the same way, or the split isn't made.
      const split = parse(after);
      const first = speechBefore(split, at);
      const second = openQuoteAt(split, at + insert.length)?.speech;
      const same = (other: Speech | undefined) =>
        other?.speaker === speech.speaker && other.direction === speech.direction;
      if (!same(first) || first?.closeQuote?.from !== at || !same(second)) return false;
      view.dispatch({
        changes: { from: splitAt, to: restFrom, insert },
        selection: { anchor: splitAt + insert.length },
        userEvent: "input",
      });
      return true;
    },
  },
]);

/**
 * Backspace straight after a split quote's new `@Name “` joins the two lines back into one quote,
 * in one step (Enter's split undone by the key that undoes typing), whatever the quote's marks.
 */
export const quoteBackspace = keymap.of([
  {
    key: "Backspace",
    run: (view) => {
      const { from, to } = view.state.selection.main;
      if (from !== to || view.state.readOnly) return false;
      const line = view.state.doc.lineAt(from);
      if (line.number < 2) return false;
      const head = line.text.slice(0, from - line.from);
      const opened = OPENED.exec(head);
      if (!opened) return false;
      const prev = view.state.doc.line(line.number - 1);
      const closers = new Set([CLOSING[opened[3] ?? ""], opened[3] === "„" ? "”" : undefined]);
      if (!closers.has(prev.text.slice(-1)) || !prev.text.includes(`@${opened[1]}`)) return false;
      const before = prev.text.slice(-2, -1);
      const after = line.text.slice(from - line.from, from - line.from + 1);
      const space = /\s/u.test(before) || !after || /\s/u.test(after) ? "" : " ";
      view.dispatch({
        changes: { from: prev.to - 1, to: from, insert: space },
        selection: { anchor: prev.to - 1 + space.length },
        userEvent: "delete.backward",
      });
      return true;
    },
  },
]);

/** The closing mark for each mark opened on a line: `[` sounds, `{` instructions, `(` directions. */
const CLOSER: Record<string, string> = { "[": "]", "{": "}", "(": ")" };

/**
 * Enter inside a mark that isn't finished (`[hiccup`, `{pause 3s`, `@Rupert (softly`) closes it as
 * typed rather than breaking the line inside it. A suggestion picked from the list comes first.
 */
/** Prose on both sides: words, not a group's `:::`, a heading, a break or a note's line. */
const PROSE = /^(?!\s*(?::{3}|#{1,6}\s|([-*_])[ \t]*(?:\1[ \t]*){2,}$|%%)).*[\p{L}\p{N}]/u;

/**
 * Two lines of words joined with Backspace at the start of the second (or Delete at the end of
 * the first) keep a space between them: "throne," + "sat" is "throne, sat".
 */
export const lineJoin = keymap.of([
  {
    key: "Backspace",
    run: (view) => {
      const { from, to } = view.state.selection.main;
      if (from !== to || view.state.readOnly) return false;
      const line = view.state.doc.lineAt(from);
      if (from !== line.from || line.number === 1) return false;
      const above = view.state.doc.line(line.number - 1);
      if (!PROSE.test(above.text) || !PROSE.test(line.text) || /\s$/u.test(above.text))
        return false;
      view.dispatch({
        changes: { from: above.to, to: line.from, insert: " " },
        selection: { anchor: above.to + 1 },
        userEvent: "delete.backward",
      });
      return true;
    },
  },
  {
    key: "Delete",
    run: (view) => {
      const { from, to } = view.state.selection.main;
      if (from !== to || view.state.readOnly) return false;
      const line = view.state.doc.lineAt(from);
      if (from !== line.to || line.number === view.state.doc.lines) return false;
      const below = view.state.doc.line(line.number + 1);
      if (!PROSE.test(line.text) || !PROSE.test(below.text) || /\s$/u.test(line.text)) return false;
      view.dispatch({
        changes: { from: line.to, to: below.from, insert: " " },
        selection: { anchor: line.to },
        userEvent: "delete.forward",
      });
      return true;
    },
  },
]);

/** The instructions a `{` can hold, by name. */
const INSTRUCTION_NAMES = ["page", "pause", "book only", "audio only", "hidden"];

export const markEnter = keymap.of([{ key: "Enter", run: (view) => markEnterRun(view) }]);

function markEnterRun(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  if (from !== to || view.state.readOnly) return false;
  const line = view.state.doc.lineAt(from);
  const head = line.text.slice(0, from - line.from);
  // The innermost mark opened before the cursor and not closed.
  const stack: { char: string; at: number }[] = [];
  for (let i = 0; i < head.length; i++) {
    const c = head[i] as string;
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "[" || c === "{") stack.push({ char: c, at: i });
    else if (c === "(" && /@[\p{L}\p{M}\p{N}_'’-]*[ \t]*$/u.test(head.slice(0, i)))
      stack.push({ char: c, at: i });
    else if ((c === "]" || c === "}" || c === ")") && stack.length) {
      const top = stack[stack.length - 1];
      if (top && CLOSER[top.char] === c) stack.pop();
    }
  }
  const open = stack[stack.length - 1];
  if (!open) return false;
  const closer = CLOSER[open.char] as string;
  if (!/\S/u.test(head.slice(open.at + 1))) return false;
  // An instruction is one of a few words: the start of only one of them is that one, even
  // before the suggestions appear (`{pau` ⏎ is `{pause}`).
  if (open.char === "{") {
    const typed = head.slice(open.at + 1);
    const word = typed.trim().toLowerCase();
    const only = INSTRUCTION_NAMES.filter((n) => n.startsWith(word));
    if (word && /^[\p{L} ]+$/u.test(word) && only.length === 1 && only[0] !== word) {
      const full = only[0] as string;
      const start = line.from + open.at + 1;
      view.dispatch({
        changes: { from: start, to: from, insert: full },
        selection: { anchor: start + full.length },
        userEvent: "input.complete",
      });
      return markEnterRun(view);
    }
  }
  const next = line.text.slice(from - line.from, from - line.from + 1);
  const closed = next === closer;
  const after = line.text.slice(from - line.from + (closed ? 1 : 0)).slice(0, 1);
  const space = after === " " ? "" : " ";
  view.dispatch({
    changes: closed ? { from: from + 1, insert: space } : { from, insert: `${closer}${space}` },
    selection: { anchor: from + 1 + space.length },
    userEvent: "input",
  });
  return true;
}
