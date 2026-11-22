/**
 * Edit › Notes › Transpose to key… (loaded when chosen): pick a key, and the selection (or the
 * whole tune, its K: and [K:] fields moved too) goes there by the nearer way, up or down, its
 * notes and chord symbols spelled for the new key.
 */
import { type Key, parseKey } from "./abc";
import { keyLabel } from "./clip-convert";
import { type Change, type Range, transpose } from "./commands";
import { dialogForm } from "./dialog";
import { readingAt } from "./stepentry";
import { type FileIndex, indexFile } from "./tunes";

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MINOR = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];
const tonicPc = (tonic: string) =>
  ((((PC[tonic[0] as string] ?? 0) + (tonic[1] === "#" ? 1 : tonic[1] === "b" ? -1 : 0)) % 12) +
    12) %
  12;

/** A key moved by semitones, named as musicians name it (B♭ not A♯), its mode kept. */
export function movedKey(value: string, semitones: number): string {
  const match = /^\s*([A-G][#b]?)(.*)$/.exec(value);
  if (!match) return value;
  const rest = match[2] as string;
  const minor = /^\s*(m(?!aj)|min|aeo)/i.test(rest);
  const pc = (((tonicPc(match[1] as string) + semitones) % 12) + 12) % 12;
  return `${(minor ? MINOR : MAJOR)[pc]}${rest}`;
}

/** The nearer way from one key's tonic to another's, in semitones (−6 to +6, up on a tie). */
export function interval(from: string, to: string): number {
  const up = (((tonicPc(to) - tonicPc(from)) % 12) + 12) % 12;
  return up > 6 ? up - 12 : up;
}

/**
 * The key the music is in where it would move from: at the selection's start (a [K:] before it
 * counts), or the tune's own key for the whole tune.
 */
export function keyHere(text: string, ranges: Range[], file: FileIndex = indexFile(text)): string {
  const at = ranges[0]?.from ?? 0;
  const tune = file.tunes.find((each) => at >= each.from && at <= each.to);
  if (!tune) return "C";
  const selected = ranges.filter((range) => range.to > range.from);
  if (!selected.length) return tune.key;
  const start = Math.min(...selected.map((range) => range.from));
  const key = readingAt(text, file, start)?.key;
  return key?.tonic ? keyLabel(key) : tune.key;
}

/** The text to a new key: the selection's notes, or the whole tune with its K: fields. */
export function toKey(
  text: string,
  ranges: Range[],
  target: string,
  file: FileIndex = indexFile(text),
): { changes: Change[]; said: string } | { refused: string } {
  const at = ranges[0]?.from ?? 0;
  const tune = file.tunes.find((each) => at >= each.from && at <= each.to);
  if (!tune) return { refused: "Put the caret in a tune to transpose it." };
  const from = /^\s*([A-G][#b]?)/.exec(keyHere(text, ranges, file))?.[1];
  const to = /^\s*([A-G][#b]?)/.exec(target)?.[1];
  if (!from || !to) return { refused: "This tune's key has no tonic to transpose from (K:none)." };
  const semitones = interval(from, to);
  const selected = ranges.some((range) => range.to > range.from);
  const writtenKey = (key: Key): Key =>
    selected
      ? key
      : parseKey(movedKey(`${key.tonic}${key.mode === "maj" ? "" : key.mode}`, semitones));
  const whole = selected ? ranges : [{ from: tune.bodyFrom, to: tune.to }];
  const changes = transpose(text, whole, semitones, file, writtenKey);
  if (!selected) {
    // The key fields move with the music: K: in the header and [K:] in the body.
    for (const match of text.slice(tune.from, tune.to).matchAll(/^K:([^\n%]*)|\[K:([^\]]*)\]/gm)) {
      const value = (match[1] ?? match[2]) as string;
      const start = tune.from + (match.index ?? 0) + 2 + (match[2] !== undefined ? 1 : 0);
      const moved = movedKey(value, semitones);
      if (moved !== value) changes.push({ from: start, to: start + value.length, insert: moved });
    }
  }
  const way =
    semitones === 0
      ? "already there"
      : `${Math.abs(semitones)} semitone${Math.abs(semitones) === 1 ? "" : "s"} ${semitones > 0 ? "up" : "down"}`;
  return {
    changes: changes.sort((a, b) => a.from - b.from),
    said: `${selected ? "The selection" : "The tune"} to ${target}: ${way}${selected ? "; the key signature is as it was" : ""}.`,
  };
}

/** The dialog: which key, then the change made through `apply`. */
export function openTransposeDialog(options: {
  dialog: { dialog: HTMLDialogElement; body: HTMLElement; open(): void };
  current: string;
  run: (target: string) => void;
}) {
  const { dialog, current, run } = options;
  dialog.body.replaceChildren();
  const minor = /^\s*[A-G][#b]?\s*(m(?!aj)|min)/i.test(current);
  const label = document.createElement("label");
  label.textContent = "Key ";
  const select = document.createElement("select");
  for (const tonic of minor ? MINOR : MAJOR) {
    const option = document.createElement("option");
    option.value = `${tonic}${minor ? "m" : ""}`;
    option.textContent = `${tonic.replace("b", "♭").replace("#", "♯")} ${minor ? "minor" : "major"}`;
    if (tonicPc(tonic) === tonicPc(/^\s*([A-G][#b]?)/.exec(current)?.[1] ?? "C"))
      option.selected = true;
    select.append(option);
  }
  label.append(select);
  const note = document.createElement("p");
  note.className = "dialog-note";
  note.textContent =
    "The nearer way, up or down. With music selected, only it moves; else the whole tune, its key signature with it.";
  dialog.body.append(
    dialogForm(dialog.dialog, [label, note], "Transpose", () => run(select.value)),
  );
  dialog.open();
  select.focus();
}
