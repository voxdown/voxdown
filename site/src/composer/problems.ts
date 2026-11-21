/**
 * Problems in the editor's own words. abcjs reports what its parser tripped on ("Unknown
 * character ignored"); where the cause can be read from the text, say what is wrong and where.
 * abcjs's words are kept as a second line only when no reading fits.
 */
import { DECORATIONS } from "./explain";
import type { FileIndex, TuneInfo } from "./tunes";
import { walkTune } from "./walk";

export type Warning = { from: number; to: number; message: string };
export type PlainProblem = Warning & { detail?: string };

/** The run of non-space characters around a position on its line. */
function wordAround(text: string, position: number): { from: number; to: number } {
  let from = Math.min(position, text.length);
  // A warning on the space after a word belongs to that word.
  if (from > 0 && /\s/.test(text[from] ?? " ") && !/\s/.test(text[from - 1] ?? " ")) from -= 1;
  let to = from;
  while (from > 0 && !/\s/.test(text[from - 1] as string)) from -= 1;
  while (to < text.length && !/\s/.test(text[to] as string)) to += 1;
  return { from, to };
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const kept = row[j] as number;
      row[j] = Math.min(
        (row[j] as number) + 1,
        (row[j - 1] as number) + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = kept;
    }
  }
  return row[b.length] as number;
}

/** The decoration a misspelt name was most likely meant to be. */
export function nearestDecoration(name: string): string | null {
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const known of Object.keys(DECORATIONS)) {
    if (/[()]$/.test(known) && !/[()]$/.test(name)) continue;
    const found = distance(name.toLowerCase(), known);
    if (found < bestDistance) {
      best = known;
      bestDistance = found;
    }
  }
  return best && bestDistance <= Math.max(1, Math.floor(name.length / 3)) ? best : null;
}

const shorten = (value: string, most = 14) =>
  value.length > most ? `${value.slice(0, most - 1)}…` : value;

/** abcjs's warnings in plain words, merged where several point at one cause. */
export function plainWarnings(warnings: Warning[], text: string): PlainProblem[] {
  const out: PlainProblem[] = [];
  const covered = (position: number) =>
    out.some(
      (problem) => position >= problem.from && position < Math.max(problem.to, problem.from + 1),
    );
  for (const warning of [...warnings].sort((a, b) => a.from - b.from)) {
    const raw = warning.message;
    const at = warning.from;
    if (covered(at)) continue;
    const plain = readWarning(raw, at, text);
    if (plain && out.some((problem) => problem.from === plain.from)) continue;
    if (plain) out.push(plain);
    else
      out.push({
        from: at,
        to: Math.max(warning.to, at + 1),
        message: "abcjs couldn't read this part of the line.",
        detail: `abcjs: ${raw}`,
      });
  }
  return foldCascades(out, text);
}

/**
 * One cause, one problem: after a chord symbol, decoration, chord or grace group that never
 * closes, abcjs skips what follows on its line letter by letter. Those letters fold into it.
 */
function foldCascades(problems: PlainProblem[], text: string): PlainProblem[] {
  const opens = problems.filter((problem) =>
    /is missing its closing|are missing their closing/.test(problem.message),
  );
  if (!opens.length) return problems;
  const lineEnd = (at: number) => {
    const end = text.indexOf("\n", at);
    return end < 0 ? text.length : end;
  };
  const folded = new Map<PlainProblem, string[]>();
  const kept = problems.filter((problem) => {
    if (!/isn't ABC music here/.test(problem.message)) return true;
    const cause = opens.find(
      (open) => problem.from > open.from && problem.from < lineEnd(open.from),
    );
    if (!cause) return true;
    folded.set(cause, [...(folded.get(cause) ?? []), text.slice(problem.from, problem.to)]);
    return false;
  });
  for (const [cause, letters] of folded)
    cause.detail = `Until it is closed, abcjs skips what follows on this line (${letters.map((letter) => `“${letter}”`).join(", ")}).`;
  return kept;
}

function readWarning(raw: string, at: number, text: string): PlainProblem | null {
  const lineStart = text.lastIndexOf("\n", at - 1) + 1;
  const lineEnd = text.indexOf("\n", at) < 0 ? text.length : text.indexOf("\n", at);
  const decoration = /^Unknown decoration: (.+)$/.exec(raw);
  if (decoration && /\s/.test((decoration[1] as string).trim())) {
    // abcjs read on to the next ! on the line: the first one never closed.
    const start = text.lastIndexOf("!", at) >= lineStart ? text.lastIndexOf("!", at) : at;
    const word = wordAround(text, start);
    return {
      from: start,
      to: word.to,
      message: `!${shorten(text.slice(start + 1, word.to))}… is missing its closing\u00a0!.`,
    };
  }
  if (decoration) {
    const name = (decoration[1] as string).trim();
    const start = text.lastIndexOf("!", at) >= lineStart ? text.lastIndexOf("!", at) : at;
    const close = text.indexOf("!", start + 1);
    const to = close >= 0 && close < lineEnd ? close + 1 : start + name.length + 2;
    const guess = nearestDecoration(name);
    return {
      from: start,
      to,
      message: `!${name}! isn't a decoration abcjs knows${guess ? ` (did you mean !${guess}!?)` : ""}.`,
    };
  }
  if (/^Missing the closing quote while parsing the chord symbol/.test(raw)) {
    const open = text.lastIndexOf('"', at) >= lineStart ? text.lastIndexOf('"', at) : at;
    const word = wordAround(text, open + 1);
    return {
      from: open,
      to: Math.max(word.to, open + 1),
      message: `The chord symbol ${shorten(text.slice(open, word.to))} is missing its closing\u00a0".`,
    };
  }
  if (/^Expected '\]' to end the chords/.test(raw)) {
    const open = text.lastIndexOf("[", at);
    if (open >= lineStart) {
      const word = wordAround(text, open);
      return {
        from: open,
        to: Math.max(word.to, open + 1),
        message: `This chord ${shorten(text.slice(open, word.to))} is missing its closing\u00a0].`,
      };
    }
  }
  if (/^Missing the closing '\}' while parsing grace note/.test(raw)) {
    const open = text.lastIndexOf("{", at) >= lineStart ? text.lastIndexOf("{", at) : at;
    const word = wordAround(text, open);
    return {
      from: open,
      to: Math.max(word.to, open + 1),
      message: `The grace notes ${shorten(text.slice(open, word.to))} are missing their closing\u00a0}.`,
    };
  }
  if (/^Unknown character ignored/.test(raw)) {
    const word = wordAround(text, at);
    const token = text.slice(word.from, word.to);
    const bang = token.lastIndexOf("!", at - word.from);
    // "!fermat A": a decoration that never closes.
    if (bang >= 0 && !token.slice(bang + 1).includes("!")) {
      const name = token.slice(bang + 1).replace(/[^\w().<>]+$/, "");
      return {
        from: word.from + bang,
        to: word.to,
        message: `!${shorten(name)}… is missing its closing\u00a0!.`,
      };
    }
    // Inside a !name! that abcjs skipped letter by letter (after an earlier ! went unclosed).
    const pair = /!([^!\s]+)!/g;
    for (let found = pair.exec(token); found; found = pair.exec(token)) {
      const from = word.from + found.index;
      const to = from + found[0].length;
      if (at < from || at >= to) continue;
      const name = found[1] as string;
      if (name in DECORATIONS) break;
      const guess = nearestDecoration(name);
      return {
        from,
        to,
        message: `!${name}! isn't a decoration abcjs knows${guess ? ` (did you mean !${guess}!?)` : ""}.`,
      };
    }
    const char = text[at] ?? "";
    if (char.trim())
      return {
        from: at,
        to: at + 1,
        message: `“${char}” isn't ABC music here; abcjs skips it.`,
      };
  }
  if (/^Unknown bar (symbol|type)/.test(raw)) {
    const word = wordAround(text, at);
    return {
      from: word.from,
      to: word.to,
      message: `${shorten(text.slice(word.from, word.to))} isn't a bar line abcjs knows: | || |] |: :| :: work.`,
    };
  }
  return null;
}

/** Slurs that open and never close, or close without opening, per voice. */
export function checkSlurs(text: string, tune: TuneInfo, file: FileIndex | null): PlainProblem[] {
  const open = new Map<string, number[]>();
  const out: PlainProblem[] = [];
  walkTune(text, tune, file, (token, state) => {
    if (token.kind !== "slur") return;
    const stack = open.get(state.voice) ?? [];
    open.set(state.voice, stack);
    if (token.text === "(") stack.push(token.from);
    else if (stack.length) stack.pop();
    else
      out.push({
        from: token.from,
        to: token.to,
        message: "This ) closes no slur: there is no ( before it in this voice.",
      });
  });
  for (const stack of open.values())
    for (const from of stack)
      out.push({
        from,
        to: from + 1,
        message: "This slur ( has no closing\u00a0): add one after its last note.",
      });
  return out.sort((a, b) => a.from - b.from);
}
