/**
 * What a paste writes, decided in one place (loaded once the editor is in use):
 * - A copy of voices (each part under its `V:` line, as Composer copies them; a voice's parts
 *   from several `V:` blocks are joined, in order):
 *   - over a selection in several voices, each place takes its own voice's music (a voice
 *     selected in several places takes its parts piece by piece when the counts agree, else all
 *     of it in its first place); in order when the voices don't match but the counts do;
 *   - at a caret or over one range, the part of the voice there; a voice the copy doesn't have
 *     takes the copy's music without its `V:` lines, said so;
 *   - refused, saying why, at a caret outside music (a header, a comment, between tunes), or with
 *     several voices into a tune that has no `V:`.
 * - Plain music (no `V:` line) over places in several voices goes into the main place only: it
 *   doesn't say which voice it is.
 * - Music copied in Composer under another unit or key is rewritten to sound the same here.
 * - Bar lines: see ./barwise.
 * Every paste says what went where, or is refused; none succeeds in part in silence.
 */
import { lineKind } from "./abc";
import { lyricsFor, notesIn, pasteInStep, pasteKeepingBars, samePoint } from "./barwise";
import { type ClipSource, convertClip, keyLabel } from "./clip-convert";
import type { Change } from "./commands";
import { selectedNotes } from "./selected";
import { readingAt } from "./stepentry";
import { type FileIndex, type TuneInfo, indexFile, voiceAt } from "./tunes";

export type Range = { from: number; to: number };
export { voiceAt };
export type { ClipSource };
export type VoicedPart = { voice: string; text: string; clef?: string };

/** The parts of a copy of voices (one `V:` line or more first), or null when it isn't one. */
export function voicedParts(copy: string): VoicedPart[] | null {
  const lines = copy.replace(/\r\n?/g, "\n").split("\n");
  if (!/^V:\s*\S/.test(lines[0] ?? "")) return null;
  const parts: VoicedPart[] = [];
  for (const line of lines) {
    const voice = /^V:\s*(\S+)(.*)$/.exec(line);
    const clef = /\bclef=(\S+)/.exec(voice?.[2] ?? "")?.[1];
    if (voice) parts.push({ voice: voice[1] as string, text: "", ...(clef ? { clef } : {}) });
    else {
      const part = parts[parts.length - 1] as VoicedPart;
      part.text = part.text ? `${part.text}\n${line}` : line;
    }
  }
  for (const part of parts) part.text = part.text.replace(/\n+$/, "");
  return parts;
}

/** A voice's parts joined, in order: one per voice, in the order the voices first appear. */
export function joinedParts(parts: VoicedPart[]): VoicedPart[] {
  const joined: VoicedPart[] = [];
  for (const part of parts) {
    const own = joined.find((each) => each.voice === part.voice);
    if (own) own.text = `${own.text} ${part.text}`.trim();
    else joined.push({ ...part });
  }
  return joined;
}

export type PastePlan = { changes: Change[]; message: string } | { refused: string };

const tuneOf = (file: FileIndex, position: number): TuneInfo | undefined =>
  file.tunes.find((tune) => position >= tune.from && position <= tune.to);

/** The voice at a place, read within its own tune only. */
function voiceIn(text: string, file: FileIndex, position: number): string {
  const tune = tuneOf(file, position);
  if (!tune) return "";
  return voiceAt(text.slice(tune.from), position - tune.from);
}

/** Whether a place is in a tune's music: on a music line of its body. */
function inMusic(text: string, file: FileIndex, position: number): boolean {
  const tune = tuneOf(file, position);
  if (!tune || tune.bodyFrom < 0 || position < tune.bodyFrom) return false;
  const from = text.lastIndexOf("\n", position - 1) + 1;
  const to = text.indexOf("\n", position) < 0 ? text.length : text.indexOf("\n", position);
  const line = text.slice(from, to);
  // A caret at the start of an empty last line of the body still writes music there.
  return lineKind(line, true) === "music" || (!line && to >= tune.to - 1);
}

const names = (parts: VoicedPart[]) => parts.map((part) => `V:${part.voice}`).join(" and ");

/** What pasting a copy of voices over these places does. */
export function pasteVoiced(
  text: string,
  ranges: Range[],
  copy: VoicedPart[],
  file: FileIndex = indexFile(text),
): PastePlan {
  const parts = joinedParts(copy);
  const all = names(parts);
  if (ranges.length > 1) {
    const voices = ranges.map((range) => voiceIn(text, file, range.from));
    const matched = voices.filter((voice) => parts.some((part) => part.voice === voice));
    // Every place in a voice the copy has, or a copy of one voice: by voice. Places in other
    // voices are left as they are, and said so.
    if (matched.length === voices.length || (parts.length === 1 && matched.length)) {
      const changes: Change[] = [];
      const said: string[] = [];
      for (const part of parts) {
        const places = ranges.filter((_, at) => voices[at] === part.voice);
        if (!places.length) continue;
        const pieces = copy.filter((each) => each.voice === part.voice);
        if (pieces.length === places.length && places.length > 1) {
          places.forEach((place, at) =>
            changes.push({ ...place, insert: (pieces[at] as VoicedPart).text }),
          );
          said.push(`V:${part.voice} piece by piece into its ${places.length} places`);
        } else {
          // One part, several places: the first takes it, the others are left as they were (a
          // place emptied would leave its voice short of the others).
          changes.push({ ...(places[0] as Range), insert: part.text });
          said.push(
            places.length > 1
              ? `V:${part.voice} into the first of its ${places.length} places (the other${places.length > 2 ? "s were" : " was"} left as ${places.length > 2 ? "they were" : "it was"})`
              : `V:${part.voice} into V:${part.voice}`,
          );
        }
      }
      const left = parts.filter((part) => !voices.includes(part.voice));
      const untouched = [...new Set(voices.filter((voice) => !matched.includes(voice)))];
      return {
        changes,
        message: `Pasted ${said.join(", ")}.${left.length ? ` Not pasted: ${names(left)}, not selected.` : ""}${untouched.length ? ` Left as it was: ${untouched.map((voice) => `V:${voice}`).join(" and ")}, not in the copy.` : ""}`,
      };
    }
    if (ranges.length === copy.length)
      return {
        changes: ranges.map((range, at) => ({ ...range, insert: (copy[at] as VoicedPart).text })),
        message: `Pasted the copy's ${copy.length} parts (${names(copy)}) into the ${ranges.length} selected places, in order.`,
      };
    return {
      refused: `The copy has ${all} and the selection ${ranges.length} places in other voices: select one stretch in each voice to paste into, or click where to paste one voice.`,
    };
  }
  const range = ranges[0] as Range;
  if (!inMusic(text, file, range.from))
    return {
      refused: `The copy has ${all}: click in a voice's music to paste it there, or select a place in each voice.`,
    };
  const here = voiceIn(text, file, range.from);
  const tune = tuneOf(file, range.from);
  const voiced = Boolean(here) || (tune?.voices.length ?? 0) > 1;
  if (!voiced) {
    if (parts.length === 1)
      return {
        changes: [{ ...range, insert: (parts[0] as VoicedPart).text }],
        message: `Pasted V:${(parts[0] as VoicedPart).voice}'s music, without its V: line: this tune has one voice.`,
      };
    return {
      refused: `The copy has ${all} and this tune one voice: copy one voice to paste here, or add the voices to the tune first.`,
    };
  }
  const own = parts.find((part) => part.voice === here);
  if (own) {
    // A staff holding the copy's other voices too takes them, at the same point, in step.
    const mates = tune ? staffMates(text, tune, here) : [here];
    const changes: Change[] = [{ ...range, insert: own.text }];
    const also: VoicedPart[] = [];
    for (const part of parts) {
      if (part === own || !mates.includes(part.voice)) continue;
      const at = samePoint(text, file, range.from, part.voice);
      if (at === null)
        return {
          refused: `V:${part.voice} has a note sounding across this point: paste where both voices' notes start, or select a place in each.`,
        };
      changes.push({
        from: at,
        to: at,
        insert: /\|\s*$/.test(part.text) ? part.text : `${part.text} `,
      });
      also.push(part);
    }
    const others = parts.filter((part) => part !== own && !also.includes(part));
    return {
      changes,
      message: `Pasted V:${here}'s part here${also.length ? ` and ${names(also)}'s on the same staff, at the same point` : ""}${others.length ? `; the copy also has ${names(others)}, not pasted` : ""}.`,
    };
  }
  // A voice the copy doesn't have: one part, the one in this voice's clef, else the first.
  const clef = clefOf(text, file, range.from, here);
  const chosen = parts.find((part) => (part.clef ?? "treble") === clef) ?? (parts[0] as VoicedPart);
  const others = parts.filter((part) => part !== chosen);
  return {
    changes: [{ ...range, insert: chosen.text }],
    message: `Pasted V:${chosen.voice}'s part${others.length ? `; the copy also had ${names(others)}` : ""}.`,
  };
}

/** The voices drawn on one staff with a voice, as %%score (or %%staves) groups them in (…). */
function staffMates(text: string, tune: TuneInfo, voice: string): string[] {
  const line = /^%%(?:score|staves)(.*)$/m.exec(text.slice(tune.from, tune.bodyFrom))?.[1] ?? "";
  for (const group of line.matchAll(/\(([^()]*)\)/g)) {
    const ids = (group[1] as string).split(/[\s|{}[\]]+/).filter(Boolean);
    if (ids.includes(voice)) return ids;
  }
  return [voice];
}

/** A voice's clef, as its V: line in the tune says (treble when none does). */
export function clefOf(text: string, file: FileIndex, position: number, voice: string): string {
  const tune = tuneOf(file, position);
  if (!tune) return "treble";
  const body = text.slice(tune.from, tune.to);
  for (const match of body.matchAll(/^V:\s*(\S+)(.*)$/gm))
    if (match[1] === voice) {
      const clef = /\bclef=(\S+)/.exec(match[2] ?? "")?.[1];
      if (clef) return clef;
    }
  return /\bclef=(\S+)/.exec(/^K:(.*)$/m.exec(body)?.[1] ?? "")?.[1] ?? "treble";
}

/** The unit and key in force at a place (where a copy starts), for ./clip-convert. */
export function sourceAt(text: string, file: FileIndex, position: number): ClipSource | null {
  const reading = readingAt(text, file, position);
  return reading ? { unit: reading.unit, key: reading.key, meter: reading.meter } : null;
}

/**
 * What a paste writes over the selection (`main` is the main range's index), or null when the
 * editor's own paste does just the same. `source` is where Composer copied it, when it did.
 */
export function planPaste(
  text: string,
  ranges: Range[],
  main: number,
  clip: string,
  source: ClipSource | null,
  file: FileIndex = indexFile(text),
): PastePlan | null {
  const copy = clip.replace(/\r\n?/g, "\n");
  const said: string[] = [];
  // A whole tune (from its X: line): a blank line before it, and after it when music follows,
  // keeps the tunes apart (a tune runs to the first blank line).
  if (/^\s*X:/.test(copy)) {
    const range = ranges[main] ?? (ranges[0] as Range);
    const before = text.slice(0, range.from);
    const after = text.slice(range.to);
    const lead =
      !before.trim() || /\n\s*\n$/.test(before) ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const body = copy.replace(/^\s+/, "").replace(/\n*$/, "\n");
    const tail = after.trim() && !/^\n/.test(after) ? "\n" : "";
    if (!lead && !tail) return null;
    return {
      changes: [{ ...range, insert: `${lead}${body}${tail}` }],
      message:
        "Pasted the tune with a blank line between it and the music beside it, which keeps tunes apart.",
    };
  }
  // Rewritten for each place's unit and key, when Composer copied it elsewhere.
  const fit = (insert: string, at: number) => {
    if (!source) return insert;
    const reading = readingAt(text, file, at);
    if (!reading) return insert;
    const converted = convertClip(insert, source, reading);
    if (converted.lengths || converted.accidentals) {
      const what = [converted.lengths && "lengths", converted.accidentals && "accidentals"]
        .filter(Boolean)
        .join(" and ");
      const note = `Pasted from L:${source.unit.num}/${source.unit.den}, K:${keyLabel(source.key)}: ${what} rewritten.`;
      if (!said.includes(note)) said.push(note);
    }
    return converted.text;
  };
  const selected = ranges.filter((range) => range.to > range.from);
  const parts = voicedParts(copy);
  // Fitted to the bar lines around each place (./barwise), whole bars under their own meter.
  const meter = source?.meter ? { meter: source.meter } : null;
  const placed = (place: Range, insert: string): Change[] | { refused: string } => {
    const fitted = pasteKeepingBars(text, [place], insert, file, meter);
    if (!fitted) return [{ ...place, insert }];
    if ("refused" in fitted) return fitted;
    if (fitted.said && !said.includes(fitted.said)) said.push(fitted.said);
    return fitted.changes;
  };
  if (parts) {
    const places = selected.length ? selected : [ranges[main] ?? (ranges[0] as Range)];
    const plan = pasteVoiced(text, places, parts, file);
    if ("refused" in plan) return plan;
    const changes: Change[] = [];
    for (const change of plan.changes) {
      const insert = change.insert ? fit(change.insert, change.from) : "";
      const done = placed({ from: change.from, to: change.to }, insert);
      if ("refused" in done) return done;
      changes.push(...done);
    }
    return { changes: withLyrics(text, file, changes), message: [plan.message, ...said].join(" ") };
  }
  let targets = selected.length ? selected : ranges;
  const voices = new Set(selected.map((range) => voiceIn(text, file, range.from)));
  if (selected.length > 1 && voices.size > 1) {
    const chosen = ranges[main]?.to !== ranges[main]?.from ? ranges[main] : selected[0];
    targets = [chosen as Range];
    const voice = voiceIn(text, file, (chosen as Range).from);
    said.push(
      `Pasted into the main selection only${voice ? ` (V:${voice})` : ""}: the copy has no V: line to say which voice it is.`,
    );
  } else if (selected.length > 1) {
    // Several places in one voice: the first takes the copy, the others stay as they were.
    targets = [selected[0] as Range];
    said.push(
      `Pasted into the first of the ${selected.length} selected places; the other${selected.length > 2 ? "s were" : " was"} left as ${selected.length > 2 ? "they were" : "it was"}.`,
    );
  }
  const changes: Change[] = [];
  let special = said.length > 0;
  for (const range of targets) {
    const insert = fit(copy, range.from);
    const fitted = pasteKeepingBars(text, [range], insert, file, meter);
    if (fitted && "refused" in fitted) return fitted;
    if (fitted || insert !== copy) special = true;
    const done = placed(range, insert);
    if ("refused" in done) return done;
    // One voice of several: over a selection it overwrites, at a caret it goes in with rests in
    // the other voices, so they stay in step.
    const inStep = targets.length === 1 ? pasteInStep(text, file, range, insert, done) : null;
    if (inStep && "refused" in inStep) return inStep;
    if (inStep) {
      special = true;
      said.push(inStep.said);
      changes.push(...inStep.changes);
      continue;
    }
    changes.push(...done);
  }
  const lyrical = withLyrics(text, file, changes);
  // (A paste with nothing else to fit still keeps the words on their notes.)
  if (!special && lyrical.length === changes.length) return null;
  return { changes: lyrical, message: said.join(" ") };
}

/**
 * A paste under a w: line keeps its words on their notes: the syllables of the notes it replaces
 * go, and each note it adds gets a `*` (no syllable) in their place.
 */
/** Single spaces at a paste's seams: none doubled with the text beside it (lyrics aside). */
function seams(text: string, changes: Change[]): Change[] {
  return changes.map((change) => {
    const line = text.slice(text.lastIndexOf("\n", change.from - 1) + 1, change.from);
    if (!change.insert || line.startsWith("w:")) return change;
    let insert = change.insert;
    if (change.from === 0 || /\s/.test(text[change.from - 1] ?? ""))
      insert = insert.replace(/^[ \t]+/, "");
    if (/^[ \t]/.test(text.slice(change.to))) insert = insert.replace(/[ \t]+$/, "");
    return insert === change.insert ? change : { ...change, insert };
  });
}

function withLyrics(text: string, file: FileIndex, changes: Change[]): Change[] {
  const extra: Change[] = [];
  for (const change of changes) {
    const gone =
      change.to > change.from
        ? selectedNotes(text, [change], file)
            .filter(
              (each) =>
                each.whole &&
                !each.event.rest &&
                each.event.from >= change.from &&
                each.event.from < change.to,
            )
            .map((each) => each.event.from)
        : [];
    const count = notesIn(change.insert);
    if (!gone.length && !count) continue;
    extra.push(...lyricsFor(text, file, gone, count ? [[change.from, count]] : []));
  }
  return seams(text, [...changes, ...extra]).sort((a, b) => a.from - b.from || a.to - b.to);
}
