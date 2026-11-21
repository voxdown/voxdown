/**
 * Tune-book commands: renumber, sort, line up bars, incipits, duplicate a tune and start one after
 * it. Each works out its changes from the text and touches nothing it was not asked to change;
 * the editor applies them as one undo step. Loaded the first time one is used.
 */
import { isolateHistory } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { fieldOf, lineKind, meterLength, tokenizeMusic, value } from "./abc";
import { newTuneTemplate } from "./commands";
import { createDialog, dialogForm } from "./dialog";
import {
  type FileIndex,
  type TuneInfo,
  indexFile,
  nextTuneNumber,
  tuneAt,
  tuneLabel,
} from "./tunes";
import { tuneItems } from "./walk";

export type Change = { from: number; to: number; insert: string };

const plural = (count: number, one: string) => `${count} ${count === 1 ? one : `${one}s`}`;

/* Renumber. */

/** X: 1…n in file order: only each X: line's number changes. */
export function renumberChanges(text: string, index: FileIndex): Change[] {
  const changes: Change[] = [];
  index.tunes.forEach((tune, at) => {
    const lineEnd = text.indexOf("\n", tune.from);
    const line = text.slice(tune.from, lineEnd < 0 ? text.length : lineEnd);
    // "X:", spaces, the number (anything up to a space or a comment), the rest as it is.
    const match = /^X:([ \t]*)([^\s%]*)/.exec(line);
    if (!match) return;
    const from = tune.from + 2 + (match[1] as string).length;
    const to = from + (match[2] as string).length;
    const wanted = String(at + 1);
    if (match[2] !== wanted) changes.push({ from, to, insert: wanted });
  });
  return changes;
}

/* Sort. */

export type SortBy = "title" | "number" | "key";

/** A title as it sorts: without a leading "The", "A" or "An", accents or case. */
export const titleKey = (title: string) =>
  title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/^\s*(the|a|an)\s+/i, "")
    .trim()
    .toLowerCase();

const TONICS = ["C", "D", "E", "F", "G", "A", "B"];
/** A key as it sorts: its tonic (C, C♯, D♭ … B), then its mode, major first. */
function keyKey(key: string): string {
  const match = /^\s*([A-G])([#b]?)\s*([A-Za-z]*)/.exec(key);
  if (!match) return `z${key}`;
  const tonic = TONICS.indexOf(match[1] as string) * 3 + (match[2] === "b" ? 0 : match[2] ? 2 : 1);
  const mode = (match[3] ?? "").toLowerCase().slice(0, 3);
  const modes = ["", "maj", "ion", "mix", "dor", "m", "min", "aeo", "phr", "lyd", "loc"];
  const rank = modes.indexOf(mode);
  return `${String(tonic).padStart(2, "0")}${String(rank < 0 ? 99 : rank).padStart(2, "0")}`;
}

/**
 * The tunes in a new order, as one replacement from the first X: on. The file's own header (all
 * before the first X:) stays first; text between two tunes moves with the tune after it; the
 * blank lines between tunes stay where they were; anything after the last tune stays last.
 */
export function sortChange(text: string, index: FileIndex, by: SortBy): Change | null {
  const tunes = index.tunes;
  if (tunes.length < 2) return null;
  const start = (tunes[0] as TuneInfo).from;
  const chunks = tunes.map((tune, at) => {
    const from = at === 0 ? start : (tunes[at - 1] as TuneInfo).to;
    const chunk = text.slice(from, tune.to);
    // The blank lines before a tune belong to the gap; what follows them moves with the tune.
    const lead = (/^(?:[ \t]*\n)*/.exec(chunk) as RegExpExecArray)[0];
    return { tune, lead, body: chunk.slice(lead.length) };
  });
  const end = (tunes[tunes.length - 1] as TuneInfo).to;
  const compare = (a: TuneInfo, b: TuneInfo) => {
    if (by === "number") {
      const x = Number(a.number);
      const y = Number(b.number);
      if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return x - y;
      if (a.number !== b.number) return a.number.localeCompare(b.number);
    }
    if (by === "key") {
      const order = keyKey(a.key).localeCompare(keyKey(b.key));
      if (order) return order;
    }
    return (
      titleKey(tuneLabel(a)).localeCompare(titleKey(tuneLabel(b)), undefined, {
        sensitivity: "base",
        numeric: true,
      }) || a.index - b.index
    );
  };
  const ordered = [...chunks].sort((a, b) => compare(a.tune, b.tune));
  if (ordered.every((chunk, at) => chunk === chunks[at])) return null;
  const out = ordered
    .map((chunk, at) => {
      const body =
        at < ordered.length - 1 && !chunk.body.endsWith("\n") ? `${chunk.body}\n` : chunk.body;
      return (chunks[at] as (typeof chunks)[number]).lead + body;
    })
    .join("");
  return { from: start, to: end, insert: out };
}

/* Line up bars. */

/** What may come before a line's leading bar line without being music: `[V:1] !segno! "^Intro" |:`. */
const BEFORE_MUSIC = new Set([
  "inline-field",
  "decoration",
  "chord-symbol",
  "annotation",
  "continuation",
]);

/**
 * Where a music line's bar lines stand: the first bar token of each run, after the first note. A
 * bar line with only inline fields, decorations, chord symbols or annotations before it leads the
 * line and is not a column.
 */
function barColumns(line: string): number[] {
  const tokens = tokenizeMusic(line);
  const columns: number[] = [];
  let music = false;
  let inRun = false;
  for (const token of tokens) {
    if (token.kind === "comment") break;
    if (token.kind === "bar") {
      if (music && !inRun) columns.push(token.from);
      inRun = true;
      continue;
    }
    if (token.kind === "space" || (!music && BEFORE_MUSIC.has(token.kind))) continue;
    inRun = false;
    music = true;
  }
  return columns;
}

/**
 * Spaces that line the bar lines of consecutive music lines up, like a table: within each run
 * of music lines (voice and lyrics lines between them stay in the run, so the voices of a system
 * line up too), on the bar lines each line has. Lines with far more or fewer bars than the run's
 * usual count stay as they are. Spaces only, and only just before a bar line, so the music,
 * notes and beams, cannot change. `range` limits it to the lines it touches.
 */
export function lineUpChanges(
  text: string,
  index: FileIndex,
  range: { from: number; to: number } | null = null,
): Change[] {
  const changes: Change[] = [];
  for (const tune of index.tunes) {
    if (range && (tune.to <= range.from || tune.from >= range.to)) continue;
    const runs: { from: number; line: string; columns: number[] }[][] = [];
    let run: { from: number; line: string; columns: number[] }[] = [];
    const close = () => {
      if (run.length > 1) runs.push(run);
      run = [];
    };
    let at = tune.bodyFrom;
    while (at < tune.to) {
      const end = text.indexOf("\n", at);
      const stop = end < 0 || end > tune.to ? tune.to : end;
      const line = text.slice(at, stop);
      const inRange = !range || (at < range.to && stop >= range.from);
      const kind = lineKind(line, true);
      const field = fieldOf(line);
      if (kind === "music" && inRange) {
        const columns = barColumns(line);
        if (columns.length) run.push({ from: at, line, columns });
        else close();
      } else if (
        !(kind === "lyrics" || kind === "comment" || (kind === "field" && field?.key === "V"))
      )
        close();
      at = stop + 1;
    }
    close();
    // Lines go in groups of like bar counts (within one bar), and each group lines up on its
    // own: a two-voice system of four bars, then one of two; a line far from the rest stays.
    const groups: (typeof runs)[number][] = [];
    for (const lines of runs) {
      const sorted = [...lines].sort((a, b) => a.columns.length - b.columns.length);
      let group: (typeof lines)[number][] = [];
      for (const each of sorted) {
        if (
          group.length &&
          each.columns.length - (group[0] as (typeof lines)[number]).columns.length > 1
        ) {
          if (group.length > 1) groups.push(group);
          group = [];
        }
        group.push(each);
      }
      if (group.length > 1) groups.push(group);
    }
    for (const near of groups) {
      if (near.length < 2) continue;
      // Column by column: each line's bar moves right to the furthest one, everything after it
      // moving with it.
      const added = near.map(() => 0);
      const inserts = near.map(() => [] as { at: number; spaces: number }[]);
      const most = Math.max(...near.map((each) => each.columns.length));
      for (let column = 0; column < most; column++) {
        const standing = near.map((each, line) =>
          column < each.columns.length
            ? (each.columns[column] as number) + (added[line] as number)
            : -1,
        );
        const target = Math.max(...standing);
        near.forEach((each, line) => {
          const now = standing[line] as number;
          if (now < 0 || now >= target) return;
          inserts[line]?.push({ at: each.columns[column] as number, spaces: target - now });
          added[line] = (added[line] as number) + target - now;
        });
      }
      near.forEach((each, line) => {
        for (const insert of inserts[line] ?? [])
          changes.push({
            from: each.from + insert.at,
            to: each.from + insert.at,
            insert: " ".repeat(insert.spaces),
          });
      });
    }
  }
  return changes.sort((a, b) => a.from - b.from);
}

/* Incipits. */

/** A tune's header field, or the file header's. */
function headerField(text: string, index: FileIndex, tune: TuneInfo, key: string): string | null {
  const read = (from: number, to: number) => {
    for (const line of text.slice(from, to).split("\n")) {
      const field = fieldOf(line);
      if (field?.key === key) return field.value.trim();
    }
    return null;
  };
  return (
    read(tune.from, tune.bodyFrom >= 0 ? tune.bodyFrom : tune.to) ??
    (index.header ? read(index.header.from, index.header.to) : null)
  );
}

/**
 * A new tune file listing every tune by its header (X:, T:, M:, L:, K:) and its first bars, in
 * its first voice: a tune index. A pickup comes with its bars.
 */
export function incipitsText(text: string, index: FileIndex, bars: number, name: string): string {
  const out: string[] = [
    `% Incipits of ${name}: the first ${bars === 1 ? "bar" : `${bars} bars`} of each tune.`,
  ];
  for (const tune of index.tunes) {
    if (tune.bodyFrom < 0) continue;
    const items = tuneItems(text, tune, index);
    const voice = items.find((item) => item.type === "event")?.voice;
    if (voice === undefined) continue;
    const mine = items.filter((item) => item.voice === voice);
    // A first bar shorter than the meter is a pickup: it comes along with the bars asked for.
    const firstBar = mine.findIndex(
      (item, at) => item.type === "bar" && mine.slice(0, at).some((each) => each.type === "event"),
    );
    const meter = mine.find((item) => item.type === "event")?.meter ?? tune.meter;
    const full = meterLength(meter);
    let pickupLength = 0;
    for (const item of mine.slice(0, firstBar < 0 ? mine.length : firstBar))
      if (item.type === "event") pickupLength += value(item.duration);
    const pickup = Boolean(full && firstBar >= 0 && pickupLength < value(full) - 1e-9);
    let wanted = bars + (pickup ? 1 : 0);
    let cut = -1;
    let seenMusic = false;
    for (const item of mine) {
      if (item.type === "event") seenMusic = true;
      else if (seenMusic && wanted > 0) {
        wanted -= 1;
        cut = item.to;
        if (!wanted) break;
      }
    }
    const lastEvent = [...mine].reverse().find((item) => item.type === "event");
    if (cut < 0) cut = lastEvent?.to ?? tune.bodyFrom;
    // The first voice's music lines up to the cut, without lyrics or other voices.
    const firstAt = mine[0]?.from ?? tune.bodyFrom;
    const music: string[] = [];
    let at = text.lastIndexOf("\n", firstAt - 1) + 1;
    while (at < cut) {
      const end = text.indexOf("\n", at);
      const stop = end < 0 ? text.length : end;
      const line = text.slice(at, Math.min(stop, cut));
      const inVoice = mine.some((item) => item.from >= at && item.from < stop);
      if (inVoice && lineKind(line, true) === "music") music.push(line.trimEnd());
      at = stop + 1;
    }
    let key = headerField(text, index, tune, "K") ?? "C";
    const clef = tune.voices[0]
      ? /\bclef=\S+/.exec(
          text.slice(tune.voices[0].from, text.indexOf("\n", tune.voices[0].from)),
        )?.[0]
      : undefined;
    if (clef && !/\bclef=/.test(key)) key = `${key} ${clef}`;
    const lines = [`X:${tune.number || tune.index + 1}`, `T:${tuneLabel(tune)}`];
    for (const field of ["M", "L"]) {
      const found = headerField(text, index, tune, field);
      if (found) lines.push(`${field}:${found}`);
    }
    lines.push(`K:${key}`);
    let body = music.join("\n").trimEnd();
    if (body && !/[|\]:]\s*$/.test(body)) body += " |";
    out.push(`${lines.join("\n")}\n${body}`);
  }
  return `${out.join("\n\n")}\n`;
}

/* One tune: duplicate it, or start one after it. */

/** The text that ends a tune (its blank line) and where the next tune would go. */
function after(text: string, tune: TuneInfo): { at: number; lead: string } {
  const at = tune.to;
  const before = text.slice(0, at);
  return {
    at,
    lead: before.endsWith("\n\n") || at === 0 ? "" : before.endsWith("\n") ? "\n" : "\n\n",
  };
}

/** A copy of the tune right after it, with the next free X: number. */
export function duplicateChange(text: string, index: FileIndex, tune: TuneInfo): Change {
  const { at, lead } = after(text, tune);
  let body = text.slice(tune.from, tune.to).replace(/\n*$/, "\n");
  body = body.replace(/^X:[ \t]*[^\s%]*/, `X:${nextTuneNumber(index)}`);
  return {
    from: at,
    to: at,
    insert: `${lead}${body}${text.slice(at).startsWith("\n") || at >= text.length ? "" : "\n"}`,
  };
}

/** A new tune right after this one, from the template. */
export function newTuneAfterChange(
  text: string,
  index: FileIndex,
  tune: TuneInfo,
  template: (number: number) => string,
): Change & { caret: number } {
  const { at, lead } = after(text, tune);
  const body = template(nextTuneNumber(index)).replace(/\n*$/, "\n");
  const trail = text.slice(at).startsWith("\n") || at >= text.length ? "" : "\n";
  return {
    from: at,
    to: at,
    insert: `${lead}${body}${trail}`,
    caret: at + lead.length + body.length - 1,
  };
}

/* The dialogs, built the first time a command needs one. */

type Dialog = { dialog: HTMLDialogElement; body: HTMLElement; open(): void; close(): void };
type DialogMaker = (id: string, title: string) => Dialog;

function choice(name: string, options: [string, string][], chosen: string): HTMLFieldSetElement {
  const set = document.createElement("fieldset");
  set.className = "book-choice";
  for (const [valueText, label] of options) {
    const row = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = valueText;
    input.checked = valueText === chosen;
    row.append(input, ` ${label}`);
    set.append(row);
  }
  return set;
}
let sortDialog: Dialog | null = null;
/** Sort tunes: by title, X: or key, and what moves with what. */
export function openSort(make: DialogMaker, tunes: number, sort: (by: SortBy) => void) {
  sortDialog ??= make("sort-tunes", "Sort tunes");
  const dialog = sortDialog;
  const lead = document.createElement("p");
  lead.textContent = `Put the ${tunes} tunes of this file in order:`;
  const options = choice(
    "sort-by",
    [
      ["title", "By title (ignoring “The”, accents and capitals)"],
      ["number", "By X: number"],
      ["key", "By key (C to B, major before minor)"],
    ],
    "title",
  );
  const note = document.createElement("p");
  note.className = "dialog-note";
  note.textContent =
    "The file's own header, before the first tune, stays first. Comments or other text between two tunes move with the tune after them. One undo puts the old order back.";
  dialog.body.replaceChildren(
    dialogForm(dialog, [lead, options, note], "Sort", () =>
      sort((options.querySelector<HTMLInputElement>("input:checked")?.value ?? "title") as SortBy),
    ),
  );
  dialog.open();
}

let incipitDialog: Dialog | null = null;
/** Incipits: how many bars of each tune. */
export function openIncipits(make: DialogMaker, make2: (bars: number) => void) {
  incipitDialog ??= make("incipits", "Incipits");
  const dialog = incipitDialog;
  const lead = document.createElement("p");
  lead.textContent =
    "A new draft listing every tune by its header (X:, T:, M:, L:, K:) and its first bars, as a tune index you can print. This file is not changed.";
  const options = choice(
    "incipit-bars",
    [
      ["1", "1 bar"],
      ["2", "2 bars"],
      ["3", "3 bars"],
      ["4", "4 bars"],
    ],
    "2",
  );
  options.classList.add("inline");
  dialog.body.replaceChildren(
    dialogForm(dialog, [lead, options], "Make incipits", () =>
      make2(Number(options.querySelector<HTMLInputElement>("input:checked")?.value ?? 2)),
    ),
  );
  dialog.open();
}

/* The commands, run from the Edit menu or a tune's menu in the rail. */

export type BookCommand = "renumber" | "sort" | "line-up" | "incipits" | "duplicate" | "new-after";
export type BookContext = {
  view: EditorView;
  file: FileIndex;
  caret: number;
  /** The file's name, for the incipits draft. */
  name: string;
  notice: (message: string, kind?: "success") => void;
  explain: (message: string) => void;
  newTune: () => void;
  /** Opens text as a new draft. */
  openDraft: (text: string, name: string) => void;
};

export function runBook(command: BookCommand, context: BookContext, tune?: TuneInfo) {
  const { view, file, notice } = context;
  const text = view.state.doc.toString();
  /** Each command's changes are one undo step of their own. */
  const apply = (changes: Change[], message: string, caret?: number) => {
    view.dispatch({
      changes,
      ...(caret === undefined ? {} : { selection: { anchor: caret } }),
      annotations: isolateHistory.of("full"),
      userEvent: "input.tunebook",
      scrollIntoView: true,
    });
    // A notice: the status line goes back to explaining the caret as soon as it moves.
    notice(message, "success");
  };
  const target =
    (tune && file.tunes.find((each) => each.from === tune.from)) ?? tuneAt(file, context.caret);
  const count = file.tunes.length;
  switch (command) {
    case "renumber": {
      const changes = renumberChanges(text, file);
      if (!changes.length) return notice(`The tunes are already numbered X:1–${count}.`, "success");
      return apply(changes, `Renumbered ${plural(count, "tune")} (X:1–${count}).`);
    }
    case "sort":
      if (count < 2) return notice("Sorting needs two tunes or more in the file.");
      return openSort(createDialog, count, (by) => {
        const latest = view.state.doc.toString();
        const change = sortChange(latest, indexFile(latest), by);
        const how = by === "number" ? "X:" : by;
        if (!change) return notice(`The tunes are already in order by ${how}.`, "success");
        apply([change], `Sorted ${plural(count, "tune")} by ${how}.`);
      });
    case "line-up": {
      const selection = view.state.selection.main;
      const lined = tune && target;
      const range = lined
        ? { from: target.from, to: target.to }
        : selection.empty
          ? null
          : { from: selection.from, to: selection.to };
      const changes = lineUpChanges(text, file, range);
      if (!changes.length) return notice("Bars already line up.", "success");
      const lineStarts = new Set(changes.map((change) => text.lastIndexOf("\n", change.from - 1)));
      const tunes = new Set(
        changes.map(
          (change) =>
            file.tunes.find((each) => change.from >= each.from && change.from < each.to)?.from,
        ),
      );
      return apply(
        changes,
        `Lined up ${plural(lineStarts.size, "line")} in ${plural(tunes.size, "tune")}.`,
      );
    }
    case "incipits":
      if (!count) return notice("There are no tunes to list yet.");
      return openIncipits(createDialog, (bars) => {
        const name = context.name.replace(/\.abc$/i, "");
        context.openDraft(incipitsText(text, file, bars, context.name), `${name} incipits`);
        const made = file.tunes.filter((each) => each.bodyFrom >= 0).length;
        notice(
          `Made incipits of ${plural(made, "tune")}, in a new draft. ${name} is unchanged; Recent… opens it again.`,
          "success",
        );
      });
    case "duplicate": {
      if (!target) return notice("Put the caret in a tune to duplicate it.");
      const change = duplicateChange(text, file, target);
      return apply(
        [change],
        `Duplicated ${tuneLabel(target)} as X:${nextTuneNumber(file)}.`,
        change.from + change.insert.indexOf("X:"),
      );
    }
    case "new-after": {
      if (!target) return context.newTune();
      const change = newTuneAfterChange(text, file, target, newTuneTemplate);
      apply(
        [{ from: change.from, to: change.to, insert: change.insert }],
        `A new tune, X:${nextTuneNumber(file)}, after ${tuneLabel(target)}.`,
        change.caret,
      );
      return view.focus();
    }
  }
}
