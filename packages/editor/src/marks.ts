import { type Item, type Line, type Story, parse } from "voxdown";

/**
 * What the editor draws, worked out from the parsed story: each mark with its range in the text.
 * Speech by a character is underlined in their color; marks become chips on lines you aren't
 * typing in; lines inside a group get a bar beside them.
 */
export type EditorMark =
  | { kind: "speech"; from: number; to: number; speaker: string }
  /** Words a direction of their own applies to: dashed, as a script marks them. */
  | { kind: "directed"; from: number; to: number }
  | { kind: "name"; from: number; to: number; speaker: string }
  /** `speaker`: whose words it directs (the name it sits with, else the next speech on its line). */
  | { kind: "direction"; from: number; to: number; text: string; speaker?: string }
  | { kind: "cleared"; from: number; to: number }
  | { kind: "sound"; from: number; to: number; text: string }
  | { kind: "vocal"; from: number; to: number; speaker: string; text: string }
  | { kind: "page"; from: number; to: number; label?: string; ownLine: boolean }
  | { kind: "pause"; from: number; to: number; value?: string }
  | { kind: "instruction"; from: number; to: number; text: string; raw: string }
  | { kind: "note"; from: number; to: number; text: string }
  | {
      kind: "group";
      from: number;
      to: number;
      text: string;
      speaker?: string;
      close?: boolean;
      /** Whose lines it holds: its character's, else the narrator's (for Listen as). */
      voice?: string;
    }
  | { kind: "heading"; from: number; to: number; text: string; hidden: boolean }
  | { kind: "break"; from: number; to: number }
  | { kind: "escape"; from: number; to: number }
  | { kind: "frontmatter"; from: number; to: number }
  | { kind: "in-group"; from: number; to: number }
  /** A direction repeated on the next lines of a run (§7.1 by hand): drawn once, like a group's. */
  | { kind: "run-repeat"; from: number; to: number; text: string }
  /** Something that probably isn't what was meant: an unclosed quote, a bracket left open. */
  | {
      kind: "warning";
      from: number;
      to: number;
      message: string;
      /** The parser's warning code, or `open-bracket` for a sound or instruction left open. */
      code: string;
      /** What "Did you mean …?" means, as an edit one click can make, and what to call it. */
      fix?: { from: number; to: number; insert: string; label?: string };
    };

/** Warnings worth an underline while typing (the rest are for whole-file checks). */
const WARNED = new Set([
  "unclosed-quote",
  "quote-over-line-break",
  "stray-quote",
  "idle-mark",
  "unknown-instruction",
  "pause-value",
  "sound-looks-like-link",
  "unclosed-note",
  "unclosed-group",
  "stray-group-close",
]);

const INSTRUCTIONS = ["page", "pause", "book only", "audio only", "hidden"];

/** Edits between two words, a swap of neighboring letters counting as one (pasue → pause). */
function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  const at = (i: number, j: number) => d[i]?.[j] ?? Number.POSITIVE_INFINITY;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        best = Math.min(best, at(i - 2, j - 2) + 1);
      const row = d[i];
      if (row) row[j] = best;
    }
  return at(a.length, b.length);
}

/** Warnings in the words of someone writing a story, with a likely fix where there is one. */
function plain(
  warning: Story["warnings"][number],
  source: string,
): { message: string; fix?: { from: number; to: number; insert: string; label?: string } } {
  if (warning.code === "unknown-instruction") {
    const raw = source.slice(warning.range.from, warning.range.to);
    const name =
      raw
        .replace(/^\{|\}$/gu, "")
        .trim()
        .split(/\s+/u)[0] ?? "";
    // What was typed is most likely the start of one (`{pau}` is `{pause}`, not `{page}`). A
    // length after it (`{paws 2s}`) can only be a pause's; a page turn takes none.
    const timed = /^\{\s*\S+\s+\d+(?:\.\d+)?\s*(?:ms|s|sec|secs|seconds?)\s*\}?$/iu.test(raw);
    const scored = INSTRUCTIONS.map((i) => ({
      i,
      d:
        name && i.startsWith(name.toLowerCase())
          ? -1
          : distance(name.toLowerCase(), i.split(" ")[0] ?? i) - (timed && i === "pause" ? 0.5 : 0),
    })).sort((x, y) => x.d - y.d);
    const near = scored[0] && scored[0].d <= 2 ? scored[0].i : undefined;
    if (!near)
      return {
        message: `${raw} isn't an instruction this editor knows: it's kept, but does nothing.`,
      };
    // Only the misspelled word changes: `{pasue 2s}` becomes `{pause 2s}`.
    // With a value after it (`{pasue 2s}`), only the misspelled word changes; alone, the whole name.
    const head = near.split(" ")[0] ?? near;
    const args = raw
      .replace(/^\{|\}$/gu, "")
      .trim()
      .slice(name.length)
      .trim();
    const insert = name && args ? raw.replace(name, head) : `{${near}}`;
    return {
      message: `${raw} isn't an instruction. Did you mean ${insert === raw ? `{${near}}` : insert}?`,
      ...(insert !== raw
        ? { fix: { from: warning.range.from, to: warning.range.to, insert } }
        : {}),
    };
  }
  // A pause with a bare number: seconds, as written most often ({pause 2} → 2s).
  if (warning.code === "pause-value") {
    const raw = source.slice(warning.range.from, warning.range.to);
    const bare = /^\{\s*pause\s+(\d+(?:\.\d+)?)\s*(?:sec|secs|seconds?)?\s*\}$/iu.exec(raw);
    if (bare)
      return {
        message: warning.message,
        fix: {
          from: warning.range.from,
          to: warning.range.to,
          insert: `{pause ${bare[1]}s}`,
          label: `Change to {pause ${bare[1]}s}`,
        },
      };
  }
  // A quote never closed: closed after its first sentence when more follows on the
  // line (narration typed on after it), else at the line's end.
  if (warning.code === "unclosed-quote") {
    const open = warning.range.from;
    const lineEnd = source.indexOf("\n", open);
    const rest = source.slice(open + 1, lineEnd < 0 ? source.length : lineEnd);
    const end = /[.!?…]+[”"’']?(?=[ \t]+\S)/u.exec(rest);
    const said = end ? rest.slice(0, end.index + end[0].length) : rest.trimEnd();
    if (said.trim()) {
      const at = open + 1 + said.length;
      return {
        message: warning.message,
        fix: {
          from: at,
          to: at,
          insert: "”",
          label: end
            ? `Close it after “${said.trim().slice(-24)}”`
            : "Close it at the end of the line",
        },
      };
    }
  }
  // A group never closed: one click closes it after its paragraph.
  if (warning.code === "unclosed-group") {
    const opener = source.indexOf("\n", warning.range.from);
    const blank = opener < 0 ? -1 : source.slice(opener).search(/\n[ \t]*\n/u);
    const end = blank < 0 ? source.replace(/\s+$/u, "").length : opener + blank;
    if (opener >= 0 && end > opener)
      return {
        message: "This group is never closed, so it runs to the end of the text.",
        fix: { from: end, to: end, insert: "\n:::", label: "Close it after its paragraph" },
      };
  }
  return { message: warning.message };
}

export { distance as editDistance };

/** A `[` or `{` with no partner on its line reads aloud as text: say so where it is. */
function unclosedBrackets(story: Story): EditorMark[] {
  const out: EditorMark[] = [];
  const body = story.frontMatter ? story.frontMatter.range.to : 0;
  const inNote = (at: number) =>
    story.blocks.some(
      (b) =>
        b.kind === "paragraph" &&
        b.lines.some((l) =>
          l.items.some((i) => i.kind === "note" && i.range.from <= at && at < i.range.to),
        ),
    );
  // Names the story knows: its cast, and every name it writes with @ (a host's text may have no cast
  // list, but every character speaks with their @ somewhere).
  const handles = new Set(story.cast.map((c) => c.handle.toLowerCase()));
  for (const m of story.source.matchAll(/(?:^|[^\p{L}\p{N}\\])@(\p{L}[\p{L}\p{M}\p{N}_'’-]*)/gu))
    handles.add((m[1] ?? "").toLowerCase());
  let offset = body;
  for (const line of story.source.slice(body).split("\n")) {
    for (const [open, close, what] of [
      ["[", "]", "A sound needs its closing ]"],
      ["{", "}", "An instruction needs its closing }"],
    ] as const) {
      let depth = 0;
      let first = -1;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === "\\") {
          i++;
          continue;
        }
        if (line[i] === open) {
          if (depth === 0) first = i;
          depth++;
        } else if (line[i] === close && depth > 0) depth--;
      }
      if (depth > 0 && first >= 0 && !inNote(offset + first))
        out.push({
          kind: "warning",
          from: offset + first,
          to: offset + Math.max(first + 1, line.length),
          message: what,
          code: "open-bracket",
        });
    }
    // A quote opening while one is still open: its closing ” was forgotten, and everything up to
    // the next ” is read in the first speaker's voice.
    {
      let open = -1;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === "\\") {
          i++;
          continue;
        }
        if (ch === "”" && open >= 0) open = -1;
        else if (ch === "“") {
          if (open >= 0 && !inNote(offset + i) && !inNote(offset + open)) {
            const end = /[.!?…]+[ \t]/u.exec(line.slice(open + 1, i));
            const close = end ? open + 1 + end.index + end[0].trimEnd().length : -1;
            out.push({
              kind: "warning",
              from: offset + i,
              to: offset + i + 1,
              message:
                "A quote opens here while the one before is still open, so the words between are read in the first speaker's voice. Is its closing ” missing?",
              code: "quote-in-quote",
              ...(close > open
                ? {
                    fix: {
                      from: offset + close,
                      to: offset + close,
                      insert: "”",
                      label: `Close it after “${line
                        .slice(open + 1, close)
                        .trim()
                        .slice(-24)}”`,
                    },
                  }
                : {}),
            });
          }
          open = i;
        }
      }
    }
    // Marks that read as words: `@ Rupert`, a direction never closed, one closed after its quote.
    const at = (i: number) => offset + i;
    // A direction without its `@` is read aloud: `(whispering) line`, `Rupert (softly) “…”`.
    const bare = /^([ \t]*)\(([^()\n]{1,60})\)[ \t]+(?=[\p{L}\p{N}“"‘])/u.exec(line);
    if (bare && !inNote(at(bare.index)))
      out.push({
        kind: "warning",
        from: at((bare[1] ?? "").length),
        to: at(bare[0].trimEnd().length),
        message: `Did you mean @(${bare[2]})? Without @ it's read aloud.`,
        code: "bare-direction",
        fix: {
          from: at((bare[1] ?? "").length),
          to: at((bare[1] ?? "").length),
          insert: "@",
        },
      });
    const named =
      /(^|[\s“"])(\p{L}[\p{L}\p{M}\p{N}_'’-]*)[ \t]+\(([^()\n]{1,60})\)[ \t]*[“"]/u.exec(line);
    if (
      named &&
      handles.has((named[2] ?? "").toLowerCase()) &&
      line[named.index + (named[1] ?? "").length - 1] !== "@" &&
      !inNote(at(named.index))
    ) {
      const from = named.index + (named[1] ?? "").length;
      out.push({
        kind: "warning",
        from: at(from),
        to: at(named.index + named[0].length - 1),
        message: `Did you mean @${named[2]} (${named[3]})? Without @ the name and direction are read aloud.`,
        code: "bare-direction",
        fix: { from: at(from), to: at(from), insert: "@" },
      });
    }
    // A `:::` line holds the group's direction and nothing else: speech on it is lost.
    const groupHead = /^[ \t]*:::[ \t]*(?:@\p{L}[\p{L}\p{M}\p{N}_'’-]*)?/u.exec(line);
    if (groupHead) {
      const head = groupHead[0].length;
      const k = line.slice(head).search(/[@“"]/u);
      if (k >= 0) {
        let cut = head + k;
        while (cut > head && /[ \t]/u.test(line[cut - 1] ?? "")) cut--;
        out.push({
          kind: "warning",
          from: at(head + k),
          to: at(line.length),
          message: "A ::: line holds only the group's direction. Put the words on the next line.",
          code: "group-words",
          fix: {
            from: at(cut),
            to: at(head + k),
            insert: "\n",
            label: "Move the words to the next line",
          },
        });
      }
    }
    // A direction without its brackets is read aloud: `@Rupert softly “…”`.
    const unbracketed =
      /(^|[^\p{L}\p{N}\\])@(\p{L}[\p{L}\p{M}\p{N}_'’-]*)[ \t]+(\p{L}[\p{L}’'-]*(?:,?[ \t]+\p{L}[\p{L}’'-]*){0,3})[ \t]*[“"]/u.exec(
        line,
      );
    if (unbracketed && !inNote(at(unbracketed.index))) {
      const words = unbracketed[3] ?? "";
      const from =
        unbracketed.index +
        unbracketed[0].indexOf(
          words,
          (unbracketed[1] ?? "").length + 1 + (unbracketed[2] ?? "").length,
        );
      out.push({
        kind: "warning",
        from: at(from),
        to: at(from + words.length),
        message: `Did you mean @${unbracketed[2]} (${words})? Without brackets the narrator reads “${words}”.`,
        code: "bare-direction",
        fix: { from: at(from), to: at(from + words.length), insert: `(${words})` },
      });
    }
    const loose = /(^|[^\p{L}\p{N}\\])@(\s+)(\p{L}[\p{L}\p{M}\p{N}_'’-]*)/u.exec(line);
    if (loose && !inNote(at(loose.index))) {
      const sign = loose.index + (loose[1] ?? "").length;
      const name = loose[3] ?? "";
      out.push({
        kind: "warning",
        from: at(sign),
        to: at(sign + 1 + (loose[2] ?? "").length + 1),
        message: "@ needs the name straight after it (@Rupert), or the narrator reads it out.",
        code: "loose-at",
        // One click closes the gap.
        fix: {
          from: at(sign + 1),
          to: at(sign + 1 + (loose[2] ?? "").length),
          insert: "",
          label: `Change to @${name}`,
        },
      });
    }
    // An @ with no name, direction or sound after it says nothing, and is left out.
    for (const lone of line.matchAll(
      /(^|[^\p{L}\p{N}\\])@(?=[ \t]*$|[ \t]*[^\p{L}\p{N}(\[\s])/gu,
    )) {
      const from = (lone.index ?? 0) + (lone[1] ?? "").length;
      if (inNote(at(from))) continue;
      // Taken out with the space after it, where a space before it keeps the words apart.
      const spaced =
        /[ \t]/u.test(line[from + 1] ?? "") && (from === 0 || /[ \t]/u.test(line[from - 1] ?? ""));
      out.push({
        kind: "warning",
        from: at(from),
        to: at(from + 1),
        message:
          "This @ has no name after it, so it is left out. Write the name straight after it (@Rupert), or take it out.",
        code: "lone-at",
        fix: { from: at(from), to: at(from + (spaced ? 2 : 1)), insert: "", label: "Take it out" },
      });
    }
    const open = /(^|[^\\])@(\p{L}[\p{L}\p{M}\p{N}_'’-]*)?[ \t]*\(([^)]*)$/u.exec(line);
    if (open && !inNote(at(open.index))) {
      // Where the direction most likely ends: before the first word with a capital,
      // or a quote mark; one click closes it there.
      const inside = open[3] ?? "";
      const insideAt = open.index + open[0].length - inside.length;
      const words = /[ \t]+(?=[\p{Lu}“"])/u.exec(inside);
      const named = Boolean(open[2]);
      out.push({
        kind: "warning",
        from: at(open.index + (open[1] ?? "").length),
        to: at(line.length),
        message: named
          ? "This direction needs its closing ) before the words: @Rupert (sleepily) “…”"
          : "This direction needs its closing ) before the words: @(sleepily) Everyone…",
        code: "open-direction",
        ...(words && words.index > 0
          ? {
              fix: {
                from: at(insideAt + words.index),
                to: at(insideAt + words.index),
                insert: ")",
                label: `Close it before “${inside
                  .slice(words.index + words[0].length)
                  .replace(/^[“"]+/u, "")
                  .split(/\s/u)[0]
                  ?.slice(0, 20)}”`,
              },
            }
          : {}),
      });
    }
    const swallowed = /(^|[^\\])@(?:\p{L}[\p{L}\p{M}\p{N}_'’-]*)?[ \t]*\([^)]*[“"«„][^)]*\)/u.exec(
      line,
    );
    if (swallowed && !open && !inNote(at(swallowed.index))) {
      // One click: the ) moved to just before the quote, as `(` auto-closes it after.
      const start = swallowed.index + (swallowed[1] ?? "").length;
      const end = swallowed.index + swallowed[0].length;
      const paren = line.indexOf("(", start);
      const inside = line.slice(paren + 1, end - 1);
      const quote = inside.search(/[“"«„]/u);
      const how = inside.slice(0, quote).trimEnd();
      const said = inside.slice(quote).trimEnd();
      out.push({
        kind: "warning",
        from: at(start),
        to: at(end),
        message:
          "The direction runs into the quote: close it with ) before the quote, (sleepily) “…”",
        code: "direction-quote",
        ...(how
          ? {
              fix: {
                from: at(paren),
                to: at(end),
                insert: `(${how}) ${said}`,
                label: `Close it before “${said
                  .replace(/^[“"«„]+/u, "")
                  .split(/\s/u)[0]
                  ?.slice(0, 20)}”`,
              },
            }
          : {}),
      });
    }
    offset += line.length + 1;
  }
  return out;
}

const ESCAPE = /\\[!-/:-@[-`{-~“”‘’„‚«»‹›「」『』]/gu;

function lineIsOnly(story: Story, line: Line, item: Item) {
  return (
    story.source.slice(line.range.from, line.range.to).trim() ===
    story.source.slice(item.range.from, item.range.to)
  );
}

/**
 * The bar runs unbroken through the blank lines between two lines of one group, so a group set
 * one line to a paragraph reads as one stretch. Only gaps that hold nothing but blank lines.
 */
function bridge(out: EditorMark[], source: string, a: number, b: number) {
  const end = source.indexOf("\n", a);
  if (end < 0 || end >= b) return;
  const gap = source.slice(end + 1, b);
  if (gap.trim()) return;
  for (let at = end + 1; at < b; at = source.indexOf("\n", at) + 1) {
    out.push({ kind: "in-group", from: at, to: at });
    if (source.indexOf("\n", at) < 0) break;
  }
}

/**
 * Two or more lines in a row that each carry the same direction of their own read as a group
 * (§7.1), so they are drawn as one: the bar beside them, the direction once at the top, and no
 * dashes under each line. The text stays as written; the line being edited shows its own mark.
 */
function drawRuns(
  out: EditorMark[],
  source: string,
  rows: ReadonlyArray<{
    from: number;
    start: number;
    end: number;
    carries: string | null;
    speaks: boolean;
  } | null>,
) {
  const runs: Array<typeof rows extends ReadonlyArray<infer R> ? NonNullable<R>[] : never> = [];
  let run: NonNullable<(typeof rows)[number]>[] = [];
  let direction: string | null = null;
  const close = () => {
    // Trailing lines with nothing to say aren't part of it.
    while (run.length && !run[run.length - 1]?.speaks) run.pop();
    if (run.filter((r) => r.carries).length >= 2) runs.push(run);
    run = [];
    direction = null;
  };
  for (const row of rows) {
    if (!row) {
      close();
      continue;
    }
    if (!row.speaks) {
      if (run.length) run.push(row);
      continue;
    }
    if (row.carries && row.carries === direction) {
      run.push(row);
      continue;
    }
    close();
    if (row.carries) {
      run = [row];
      direction = row.carries;
    }
  }
  close();
  const drop = new Set<number>();
  for (const lines of runs) {
    lines.forEach((row, i) => {
      out.push({ kind: "in-group", from: row.from, to: row.from });
      const next = lines[i + 1];
      if (next) bridge(out, source, row.from, next.from);
      for (let k = row.start; k < row.end; k++) {
        const mark = out[k] as EditorMark;
        if (mark.kind === "directed") drop.add(k);
        else if (mark.kind === "direction" && i > 0)
          out[k] = { kind: "run-repeat", from: mark.from, to: mark.to, text: mark.text };
      }
    });
  }
  if (drop.size) {
    const kept = out.filter((_, k) => !drop.has(k));
    out.length = 0;
    for (const mark of kept) out.push(mark);
  }
}

export function marksOf(story: Story): EditorMark[] {
  const out: EditorMark[] = [];
  const narrator = story.meta.narrator.toLowerCase();
  if (story.frontMatter) out.push({ kind: "frontmatter", ...story.frontMatter.range });

  for (const group of story.groups) {
    out.push({
      kind: "group",
      from: group.range.from,
      to: group.range.to,
      text: group.direction ?? "",
      ...(group.character ? { speaker: group.character } : {}),
      voice: group.character ?? story.meta.narrator,
    });
    if (group.closeRange) out.push({ kind: "group", ...group.closeRange, text: "", close: true });
  }

  const visit = (line: Line) => {
    // A character's sound and the mark before it are one chip: "Pickle · peep".
    const vocalMarks = new Set(
      line.items.flatMap((i) => (i.kind === "vocal" && i.mark ? [i.mark.range.from] : [])),
    );
    for (const item of line.items) {
      switch (item.kind) {
        case "speech":
          if (item.speaker.toLowerCase() !== narrator && item.textRange.to > item.textRange.from)
            out.push({ kind: "speech", ...item.textRange, speaker: item.speaker });
          if (item.ownDirection && item.textRange.to > item.textRange.from)
            out.push({ kind: "directed", ...item.textRange });
          break;
        case "mark":
          if (vocalMarks.has(item.range.from)) {
            if (item.directionRange)
              out.push({
                kind: "direction",
                ...item.directionRange,
                text: item.direction ?? "",
                speaker: item.speaker,
              });
            break;
          }
          // The chip stands for `@Name`, the at sign included.
          out.push({
            kind: "name",
            from: item.range.from,
            to: item.nameRange.to,
            speaker: item.speaker,
          });
          if (item.directionRange)
            out.push({
              kind: "direction",
              ...item.directionRange,
              text: item.direction ?? "",
              speaker: item.speaker,
            });
          break;
        case "direction": {
          // Whose words it directs: the next speech on its line.
          const next = line.items.find(
            (other) => other.kind === "speech" && other.range.from >= item.range.to,
          );
          const speaker = next?.kind === "speech" ? next.speaker : undefined;
          if (item.direction)
            out.push({
              kind: "direction",
              ...item.range,
              text: item.direction,
              ...(speaker ? { speaker } : {}),
            });
          else out.push({ kind: "cleared", ...item.range });
          break;
        }
        case "vocal":
          out.push({
            kind: "vocal",
            from: item.mark && !item.mark.directionRange ? item.mark.range.from : item.range.from,
            to: item.range.to,
            speaker: item.speaker,
            text: item.description,
          });
          if (item.mark?.directionRange)
            out.push({
              kind: "name",
              from: item.mark.range.from,
              to: item.mark.nameRange.to,
              speaker: item.speaker,
            });
          break;
        case "sound":
          out.push({ kind: "sound", ...item.range, text: item.description });
          break;
        case "note":
          out.push({ kind: "note", ...item.range, text: item.text });
          break;
        case "instruction":
          if (item.name === "page")
            out.push({
              kind: "page",
              ...item.range,
              ...(item.value ? { label: item.value } : {}),
              ownLine: lineIsOnly(story, line, item),
            });
          else if (item.name === "pause")
            out.push({
              kind: "pause",
              ...item.range,
              ...(item.value ? { value: item.value } : {}),
            });
          else
            out.push({
              kind: "instruction",
              ...item.range,
              text: item.value ? `${item.name} ${item.value}` : item.name,
              raw: item.raw,
            });
          break;
        case "image":
          break;
      }
    }
  };

  // Lines in order, for runs of lines that each carry the same direction of their own.
  type Row = { from: number; start: number; end: number; carries: string | null; speaks: boolean };
  const rows: Array<Row | null> = [];
  // The last line drawn inside a group, so blank lines between two of its lines carry the bar.
  let grouped: { inner: unknown; from: number } | null = null;
  for (const block of story.blocks) {
    if (block.kind !== "paragraph" || block.groups.length) rows.push(null);
    if (block.kind === "break") out.push({ kind: "break", ...block.range });
    else if (block.kind === "heading") {
      const words = block.line.items
        .filter((i) => i.kind === "speech")
        .map((i) => (i.kind === "speech" ? i.text : ""))
        .join(" ")
        .trim();
      out.push({
        kind: "heading",
        ...block.range,
        text:
          words || story.source.slice(block.range.from, block.range.to).replace(/^\s*#+\s*/u, ""),
        hidden: block.visibility === "hidden" || block.visibility === "book",
      });
    } else {
      for (const line of block.lines) {
        if (block.groups.length) {
          out.push({ kind: "in-group", from: line.range.from, to: line.range.from });
          const inner = block.groups[block.groups.length - 1];
          if (grouped && grouped.inner === inner)
            bridge(out, story.source, grouped.from, line.range.from);
          grouped = { inner, from: line.range.from };
        }
        const start = out.length;
        visit(line);
        if (block.groups.length) continue;
        const speech = line.items.flatMap((i) =>
          i.kind === "speech" && /[\p{L}\p{N}]/u.test(i.text) ? [i] : [],
        );
        const own = new Set(speech.map((i) => (i.ownDirection ? i.direction : null)));
        const only = own.size === 1 ? [...own][0] : null;
        rows.push({
          from: line.range.from,
          start,
          end: out.length,
          carries: only ?? null,
          speaks: speech.length > 0,
        });
      }
    }
  }
  drawRuns(out, story.source, rows);

  const unclosed = new Set(
    story.warnings.filter((w) => w.code === "unclosed-quote").map((w) => w.range.from),
  );
  for (const warning of story.warnings) {
    if (warning.severity !== "warning" || !WARNED.has(warning.code)) continue;
    // One underline per mistake: a quote never closed also runs over a line break.
    if (warning.code === "quote-over-line-break" && unclosed.has(warning.range.from)) continue;
    // A quote left open is underlined to the end of its line, not by a tick under the mark.
    const lineEnd = story.source.indexOf("\n", warning.range.from);
    const opened = warning.code === "unclosed-quote" || warning.code === "quote-over-line-break";
    const to = opened
      ? lineEnd < 0
        ? story.source.length
        : Math.max(lineEnd, warning.range.from + 1)
      : Math.max(warning.range.to, Math.min(story.source.length, warning.range.from + 1));
    out.push({
      kind: "warning",
      from: warning.range.from,
      to,
      ...plain(warning, story.source),
      code: warning.code,
    });
  }
  for (const open of unclosedBrackets(story)) out.push(open);

  const body = story.frontMatter ? story.frontMatter.range.to : 0;
  for (const m of story.source.slice(body).matchAll(ESCAPE))
    out.push({ kind: "escape", from: body + (m.index ?? 0), to: body + (m.index ?? 0) + 1 });
  return out;
}

export function editorMarks(source: string): EditorMark[] {
  const marks = marksOf(parse(source));
  // A direction left open after a name is the mistake: its mark then gives the name
  // nothing to say, but that follows from it, and the fix is to close the direction.
  const open = new Set(
    marks.flatMap((m) =>
      m.kind === "warning" && (m.code === "open-direction" || m.code === "direction-quote")
        ? [m.from]
        : [],
    ),
  );
  return open.size
    ? marks.filter((m) => !(m.kind === "warning" && m.code === "idle-mark" && open.has(m.from)))
    : marks;
}
