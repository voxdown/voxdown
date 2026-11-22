/** Small, reversible source edits; Fountain remains the document of record. */
import type { Completion, CompletionSource } from "@codemirror/autocomplete";
import { isolateHistory } from "@codemirror/commands";
import {
  type ChangeSet,
  type ChangeSpec,
  EditorSelection,
  type EditorState,
  type StateCommand,
} from "@codemirror/state";
import type { FountainDocument } from "./fountain";
import { parsedSource } from "./syntax";

export type ScreenplayLineType = "scene" | "action" | "character" | "parenthetical" | "transition";

const naturalScene = /^(?:INT\.?\/EXT|INT|EXT|EST|I\/E)(?:[. ]|$)/i;
const forcedScene = /^\.[\p{L}\p{N}]/u;

function singleLine(state: EditorState) {
  if (state.readOnly || state.selection.ranges.length !== 1) return null;
  const range = state.selection.main;
  const line = state.doc.lineAt(range.from);
  // A multi-line selection may be a pasted passage. Never reinterpret it as one element.
  if (range.to > line.to) return null;
  return line;
}

function safeLineDocument(state: EditorState, from: number, to: number) {
  // Explicit toolbar/shortcut operations can afford an authoritative fresh parse.
  // Worker results may lag typing, so they cannot establish this safety boundary.
  const parsed = parsedSource(state.doc);
  if (parsed.warnings.length || parsed.omissions.some((span) => span.from <= to && span.to > from))
    return null;
  return parsed;
}

function preservesOmissions(state: EditorState, before: FountainDocument, changes: ChangeSet) {
  const after = parsedSource(changes.apply(state.doc));
  return (
    !after.warnings.length &&
    before.omissions.length === after.omissions.length &&
    before.omissions.every((span, index) => {
      const next = after.omissions[index];
      return (
        next?.kind === span.kind &&
        next.from === changes.mapPos(span.from, 1) &&
        next.to === changes.mapPos(span.to, -1)
      );
    })
  );
}

/** Format one source line, preserving its words, whitespace, and selected words.
 * Explicit markers avoid silently uppercasing names such as McClane or 李明.
 * Returns false for multi-line selections and structural/comment marker lines.
 * Parenthetical only wraps text; it needs a preceding character/dialogue in Fountain.
 */
export function setScreenplayLine(type: ScreenplayLineType): StateCommand {
  return ({ state, dispatch }) => {
    const line = singleLine(state);
    if (!line) return false;
    const parsed = safeLineDocument(state, line.from, line.to);
    if (!parsed) return false;
    const leading = line.text.match(/^\s*/)?.[0].length ?? 0;
    const trailing = line.text.trimEnd().length;
    const trimmed = line.text.trim();
    if (/^(?:\[\[|\/\*|\*\/|#|=|\\)/.test(trimmed)) return false;
    let start = leading;
    let end = Math.max(start, trailing);
    if (/^[@!>~]/.test(trimmed) || forcedScene.test(trimmed)) start++;
    if (trimmed.startsWith(">") && trimmed.endsWith("<")) end--;
    if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
      start++;
      end--;
    }
    // Spaces separating an old marker from its text cannot follow a forced scene dot.
    if (type === "scene") start += line.text.slice(start, end).match(/^\s*/)?.[0].length ?? 0;
    const content = line.text.slice(start, end);
    let prefix = "";
    let suffix = "";
    if (type === "scene") {
      // A forced scene must begin with a letter/number, not an ellipsis or punctuation.
      if (content && !/^[\p{L}\p{N}]/u.test(content)) return false;
      const boundary = line.number === 1 || !state.doc.line(line.number - 1).text.trim();
      prefix = content ? (boundary && naturalScene.test(content) ? "" : ".") : "INT. ";
      if (!content && !boundary) prefix = `.${prefix}`;
    } else if (type === "action") {
      // The explicit action marker also exits dialogue and disambiguates uppercase prose.
      prefix = "!";
    } else if (type === "character") {
      prefix = "@";
    } else if (type === "transition") {
      prefix = ">";
    } else {
      prefix = "(";
      suffix = ")";
    }
    const changes: ChangeSpec[] = [];
    if (line.text.slice(leading, start) !== prefix) {
      changes.push({ from: line.from + leading, to: line.from + start, insert: prefix });
    }
    if (line.text.slice(end, Math.max(leading, trailing)) !== suffix) {
      changes.push({
        from: line.from + end,
        to: line.from + Math.max(leading, trailing),
        insert: suffix,
      });
    }
    if (!changes.length) return true;
    const set = state.changes(changes);
    if (!preservesOmissions(state, parsed, set)) return false;
    const range = state.selection.main;
    // Keep selections over the same words, excluding newly inserted syntax.
    const map = (position: number) =>
      position <= line.from + start
        ? line.from + leading + prefix.length
        : position >= line.from + end
          ? line.from + leading + prefix.length + content.length
          : set.mapPos(position);
    dispatch(
      state.update({
        changes: set,
        selection: EditorSelection.single(map(range.anchor), map(range.head)),
        scrollIntoView: true,
        userEvent: "input.format",
        annotations: isolateHistory.of("full"),
      }),
    );
    return true;
  };
}

export const setSceneLine = setScreenplayLine("scene");
export const setActionLine = setScreenplayLine("action");
export const setCharacterLine = setScreenplayLine("character");
export const setParentheticalLine = setScreenplayLine("parenthetical");
export const setTransitionLine = setScreenplayLine("transition");

/** Explicit new paragraph (e.g. Mod-Enter). It inserts at the end of the current
 * line without deleting selected text or splitting words. Ordinary Enter is left alone.
 */
export const insertScreenplayParagraph: StateCommand = ({ state, dispatch }) => {
  const line = singleLine(state);
  if (!line) return false;
  const parsed = safeLineDocument(state, line.from, line.to);
  if (!parsed) return false;
  const next = line.number < state.doc.lines ? state.doc.line(line.number + 1) : undefined;
  const after = line.number + 1 < state.doc.lines ? state.doc.line(line.number + 2) : undefined;
  const third = line.number + 2 < state.doc.lines ? state.doc.line(line.number + 3) : undefined;
  if (next?.text === "" && after?.text === "" && (!third || third.text === "")) {
    dispatch(state.update({ selection: { anchor: after.from }, scrollIntoView: true }));
  } else {
    // Leave a blank separator on both sides of the new paragraph when text follows.
    // Two-space dialogue-continuation lines are intentional source, not empty lines.
    const insert =
      next?.text === "" ? (after?.text === "" || !after ? "\n" : "\n\n") : next ? "\n\n\n" : "\n\n";
    const changes = state.changes({ from: line.to, insert });
    if (!preservesOmissions(state, parsed, changes)) return false;
    dispatch(
      state.update({
        changes,
        selection: { anchor: line.to + 2 },
        scrollIntoView: true,
        userEvent: "input",
        annotations: isolateHistory.of("full"),
      }),
    );
  }
  return true;
};

export const MAX_COMPLETION_ELEMENTS = 20_000;
export const MAX_COMPLETION_CANDIDATES = 200;
export const MAX_COMPLETION_RESULTS = 40;

/** Use the latest worker result; the candidate index is reused between worker results.
 * Pass the same FountainDocument object until a new result arrives to reuse the index.
 * Ctrl-Space works on empty boundary lines; natural typing completes explicit @ cues,
 * uppercase cues at paragraph boundaries, and INT./EXT./forced scene headings only.
 */
export function screenplayCompletions(
  latest: () => FountainDocument | undefined,
): CompletionSource {
  let indexed: FountainDocument | undefined;
  let characters: string[] = [];
  let scenes: string[] = [];
  return (context) => {
    if (
      context.state.readOnly ||
      context.state.selection.ranges.length !== 1 ||
      !context.state.selection.main.empty
    )
      return null;
    const line = context.state.doc.lineAt(context.pos);
    const before = context.state.sliceDoc(line.from, context.pos);
    // Prevent implicit replacements from the middle of an existing name/sentence.
    if (context.state.sliceDoc(context.pos, line.to).trim()) return null;
    const boundary = line.number === 1 || !context.state.doc.line(line.number - 1).text.trim();
    const sceneMatch = /^(\s*\.?)(?:(?:INT\.?\/EXT|INT|EXT|EST|I\/E)[. ]\s*)/i.exec(before);
    const forced = /^\s*\.([\p{L}\p{N}][^\n]*)$/u.exec(before);
    const cue = /^(\s*@)([^\n]*)$/.exec(before);
    const naturalCue = boundary && /^[\p{Lu}\p{N} .’'_-]*$/u.test(before.trim());
    const isScene = Boolean(sceneMatch || forced);
    if (!isScene && !cue && !(naturalCue && (context.explicit || before.trim().length >= 2))) {
      return null;
    }
    if (isScene && !boundary && !/^\s*\./.test(before)) return null;
    // Blank lines only offer character names when explicitly requested.
    if (!context.explicit && !before.trim()) return null;
    const document = latest();
    if (!document) return null;
    // The worker index can lag typing; validate comment context against current source.
    const current = parsedSource(context.state.doc);
    if (
      current.warnings.length ||
      current.omissions.some((span) => context.pos > span.from && context.pos < span.to)
    )
      return null;
    if (document !== indexed) {
      indexed = document;
      const names = new Set<string>();
      const headings = new Set<string>();
      for (
        let index = 0;
        index < Math.min(document.elements.length, MAX_COMPLETION_ELEMENTS);
        index++
      ) {
        const element = document.elements[index];
        if (!element) continue;
        if (element.kind === "character" && names.size < MAX_COMPLETION_CANDIDATES) {
          const name = element.text.replace(/\s*\([^)]*\)\s*$/, "").trim();
          if (name && name.length <= 120 && !/[\r\n]/.test(name)) names.add(name);
        } else if (element.kind === "scene" && headings.size < MAX_COMPLETION_CANDIDATES) {
          const heading = element.text.trim();
          if (heading && heading.length <= 160 && !/[\r\n]/.test(heading)) headings.add(heading);
        }
        if (names.size === MAX_COMPLETION_CANDIDATES && headings.size === MAX_COMPLETION_CANDIDATES)
          break;
      }
      characters = [...names];
      scenes = [...headings];
    }
    const leading = before.match(/^\s*/)?.[0].length ?? 0;
    const marker = cue ? 1 : /^\s*\./.test(before) ? 1 : 0;
    const from = line.from + leading + marker;
    const query = context.state.sliceDoc(from, context.pos).toLocaleLowerCase();
    const options: Completion[] = [];
    for (const text of isScene ? scenes : characters) {
      if (!text.toLocaleLowerCase().startsWith(query) || text.toLocaleLowerCase() === query)
        continue;
      // Names whose case cannot be recognized naturally need the Fountain @ marker.
      const forceCue = !isScene && !cue && (!/\p{Lu}/u.test(text) || /\p{Ll}/u.test(text));
      options.push({
        label: text,
        apply: forceCue ? `@${text}` : text,
        type: isScene ? "text" : "variable",
        detail: isScene ? "scene heading" : "character",
      });
      if (options.length === MAX_COMPLETION_RESULTS) break;
    }
    return options.length ? { from, options, filter: false } : null;
  };
}
