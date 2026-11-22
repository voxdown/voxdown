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
import { lineKind, tokenizeMusic } from "./abc";
import {
  insertsAtNote,
  joinedClip,
  lyricsFor,
  noteStartsBar,
  notesIn,
  overwriteForward,
  pasteInStep,
  pasteKeepingBars,
  samePoint,
  wholeBars,
} from "./barwise";
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

export type PastePlan =
  | {
      changes: Change[];
      message: string;
      /** Its inserts are already written for their places (units, keys, bar lines). */
      final?: boolean;
    }
  | { refused: string };

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
  staves?: Staves,
  fit?: (insert: string, at: number) => string,
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
  const given = ranges[0] as Range;
  if (!inMusic(text, file, given.from))
    return {
      refused: `The copy has ${all}: click in a voice's music to paste it there, or select a place in each voice.`,
    };
  // A clicked note starting its bar, with whole bars: they go in before it, as at a caret there.
  const before = insertsAtNote(text, file, given, parts[0]?.text ?? "");
  const range = before === null ? given : { from: before, to: before };
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
  if (own && tune) {
    const decided = voicedInStep(text, file, tune, given, own, parts, staves, fit);
    if (decided) return decided;
  }
  if (own) {
    // A staff holding the copy's other voices too takes them, at the same point, in step.
    const mates = tune ? staffMates(text, tune, here, staves) : [here];
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
  if (tune) {
    // Into this voice, by the same rules (in step at a bar's start, forward over notes).
    const mine = { ...chosen, voice: here };
    const decided = voicedInStep(text, file, tune, given, mine, [mine], staves, fit);
    if (decided && "refused" in decided) return decided;
    if (decided)
      return {
        ...decided,
        message: `${decided.message.replace(`V:${here}`, `V:${chosen.voice}'s part into V:${here}`)}${others.length ? ` The copy also had ${names(others)}.` : ""}`,
      };
  }
  return {
    changes: [{ ...range, insert: chosen.text }],
    message: `Pasted V:${chosen.voice}'s part${others.length ? `; the copy also had ${names(others)}` : ""}.`,
  };
}

/**
 * A copy of voices pasted at one place, decided once for the whole copy (round 8, item 3):
 * - at a bar's start (a caret there, or a clicked note starting its bar), it goes in: each voice's
 *   part is made whole bars (rests to its bar line) and as many bars as the longest, and every
 *   other voice of the tune gets as many bars of rests at the same point;
 * - over notes, it overwrites forward in every voice the copy has on that staff, from the same
 *   point in each (./barwise overwriteForward); the other voices are as they were.
 * Null where it goes in as before (a caret inside a bar, or at the music's end).
 */
function voicedInStep(
  text: string,
  file: FileIndex,
  tune: TuneInfo,
  given: Range,
  own: VoicedPart,
  parts: VoicedPart[],
  staves: Staves | undefined,
  fit: ((insert: string, at: number) => string) | undefined,
): PastePlan | null {
  const mates = staffMates(text, tune, own.voice, staves);
  const pasted = [own, ...parts.filter((part) => part !== own && mates.includes(part.voice))];
  const left = parts.filter((part) => !pasted.includes(part));
  const written = (part: VoicedPart, at: number) => (fit ? fit(part.text, at) : part.text);
  const not = left.length ? `; the copy also has ${names(left)}, not pasted` : "";
  // Where it goes in: a clicked note starting its bar, or a caret just before one.
  let start: number | null = null;
  if (given.to > given.from) start = noteStartsBar(text, file, given);
  else {
    const lineEnd =
      text.indexOf("\n", given.from) < 0 ? text.length : text.indexOf("\n", given.from);
    const next = selectedNotes(text, [{ from: given.from, to: lineEnd }], file).find(
      (each) => each.span.from >= given.from,
    );
    if (next && !text.slice(given.from, next.span.from).trim())
      start = noteStartsBar(text, file, next.span);
    if (start === null) return null;
  }
  const sounding = (voice: string) =>
    `V:${voice} has a note sounding across this point: paste where every voice's notes start, or select a place in each.`;
  if (start !== null) {
    const points: number[] = [];
    for (const part of pasted) {
      const at = part === own ? start : samePoint(text, file, start, part.voice);
      if (at === null) return { refused: sounding(part.voice) };
      points.push(at);
    }
    const first = pasted.map((part, index) =>
      wholeBars(
        written(part, points[index] as number),
        text,
        file,
        points[index] as number,
        part.voice,
      ),
    );
    const bars = Math.max(...first.map((each) => each.bars));
    const changes: Change[] = pasted.map((part, index) => {
      const at = points[index] as number;
      const made = wholeBars(written(part, at), text, file, at, part.voice, bars);
      return { from: at, to: at, insert: `${made.text} ` };
    });
    // Every other voice: as many bars of rests, at the same point.
    const rested: string[] = [];
    for (const voice of tune.voices.map((each) => each.id)) {
      if (pasted.some((part) => part.voice === voice)) continue;
      const at = samePoint(text, file, start, voice);
      if (at === null) {
        // (A voice that has ended before this point needs none.)
        if (
          selectedNotes(text, [{ from: start, to: tune.to }], file).some(
            (each) => each.event.voice === voice,
          )
        )
          return { refused: sounding(voice) };
        continue;
      }
      const made = wholeBars("", text, file, at, voice, bars);
      changes.push({ from: at, to: at, insert: `${made.text} ` });
      rested.push(`V:${voice}`);
    }
    return {
      changes,
      message: `Pasted ${names(pasted)} as ${bars === 1 ? "a whole bar" : `${bars} whole bars`} here, in step${rested.length ? `; rests in ${rested.join(" and ")} for as long` : ""}${not}.`,
      final: true,
    };
  }
  // Over notes: forward in each voice from the same point.
  const firstNote = selectedNotes(text, [given], file).find((each) => each.whole);
  if (!firstNote) return null;
  const changes: Change[] = [];
  for (const part of pasted) {
    let place: Range = given;
    if (part !== own) {
      const at = samePoint(text, file, firstNote.event.from, part.voice);
      if (at === null) return { refused: sounding(part.voice) };
      const there = selectedNotes(text, [{ from: at, to: at + 1 }], file)[0];
      if (!there) return { refused: sounding(part.voice) };
      place = there.span;
    }
    const over = overwriteForward(text, file, place, written(part, place.from));
    if (!over) return null;
    if ("refused" in over) return over;
    changes.push(...over.changes);
  }
  return {
    changes,
    message: `Pasted ${names(pasted)} over the notes, forward from the same point in each; the other voices are as they were${not}.`,
    final: true,
  };
}

/** The voices drawn on a voice's staff, by its id, as the drawn score has them (./score). */
export type Staves = (voice: string) => string[] | null;

/**
 * The voices drawn on one staff with a voice: as the drawn score has them, else as %%score (or
 * %%staves) groups them in (…), wherever in the tune it is (after K: too).
 */
function staffMates(text: string, tune: TuneInfo, voice: string, staves?: Staves): string[] {
  const drawn = staves?.(voice);
  if (drawn?.includes(voice) && drawn.length > 1) return drawn;
  const line = /^%%(?:score|staves)(.*)$/m.exec(text.slice(tune.from, tune.to))?.[1] ?? "";
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

/** A caret inside a note (between its letter and its length) is after the note. */
function outOfNotes(text: string, file: FileIndex, ranges: Range[]): Range[] {
  return ranges.map((range) => {
    if (range.from !== range.to || !inMusic(text, file, range.from)) return range;
    const lineFrom = text.lastIndexOf("\n", range.from - 1) + 1;
    const lineTo =
      text.indexOf("\n", range.from) < 0 ? text.length : text.indexOf("\n", range.from);
    const inside = tokenizeMusic(text.slice(lineFrom, lineTo), lineFrom).find(
      (token) =>
        ["note", "rest", "chord-close"].includes(token.kind) &&
        token.from < range.from &&
        token.to > range.from,
    );
    return inside ? { from: inside.to, to: inside.to } : range;
  });
}

/**
 * What a paste writes over the selection (`main` is the main range's index), or null when the
 * editor's own paste does just the same. `source` is where Composer copied it, when it did.
 */
export function planPaste(
  text: string,
  given: Range[],
  main: number,
  clip: string,
  source: ClipSource | null,
  file: FileIndex = indexFile(text),
  staves?: Staves,
): PastePlan | null {
  const ranges = outOfNotes(text, file, given);
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
  // Several music lines (and their verses) into a music line with verses: one line, the verses
  // given the copy's syllables, or a `*` a note.
  const target = ranges[main] ?? (ranges[0] as Range);
  const joined = versed(text, file, target.from) ? joinedClip(copy) : null;
  if (joined) {
    const plan = planPaste(text, ranges, main, joined.music, source, file, staves);
    if (!plan) {
      const changes = ranges.map((range) => ({ ...range, insert: joined.music }));
      return { changes: withLyrics(text, file, changes, joined.verses), message: JOINED };
    }
    if ("refused" in plan) return plan;
    return {
      changes: relyric(text, file, plan.changes, joined.verses),
      message: [plan.message, JOINED].filter(Boolean).join(" "),
    };
  }
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
    const plan = pasteVoiced(text, places, parts, file, staves, fit);
    if ("refused" in plan) return plan;
    if (plan.final)
      return {
        changes: withLyrics(text, file, plan.changes),
        message: [plan.message, ...said].join(" "),
      };
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
  for (const target of targets) {
    const insert = fit(copy, target.from);
    // Over notes, the copy overwrites forward from the first (as MuseScore does); a single note
    // starting its bar takes whole bars in before it, as at a caret there.
    const at = insertsAtNote(text, file, target, insert);
    const range = at === null ? target : { from: at, to: at };
    const over =
      targets.length === 1 && at === null ? overwriteForward(text, file, range, insert) : null;
    if (over && "refused" in over) return over;
    if (over) {
      special = true;
      said.push(over.said);
      changes.push(...over.changes);
      continue;
    }
    const fitted = pasteKeepingBars(text, [range], insert, file, meter);
    if (fitted && "refused" in fitted) return fitted;
    // (A clicked note made a caret is ours too: the editor's own paste would replace the note.)
    if (fitted || insert !== copy || at !== null) special = true;
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
    // Bars put in keep a space from the music beside them (`G4 A4 | G6`, `|] "C"e2`).
    // (In a line that writes its bar lines spaced, `G4 A4 | G6`; a compact one stays compact.)
    const lineTo =
      text.indexOf("\n", change.from) < 0 ? text.length : text.indexOf("\n", change.from);
    const spaced = /\S \|+ \S/.test(` ${line}${text.slice(change.from, lineTo)} `);
    const pure = change.from === change.to;
    if (pure && spaced && /[|\]]$/.test(insert) && /^[^\s|\]:]/.test(text[change.to] ?? "\n"))
      insert += " ";
    if (
      pure &&
      spaced &&
      /[|\]]$/.test(text.slice(0, change.from)) &&
      /^[A-Ga-gzx"!^_=(.~]/.test(insert)
    )
      insert = ` ${insert}`;
    return insert === change.insert ? change : { ...change, insert };
  });
}

const JOINED =
  "The copy's lines went in as one, so the line keeps its verses; its syllables went with it.";

/** Whether a place is in a music line (or at its end) with w: lines under it. */
function versed(text: string, file: FileIndex, at: number): boolean {
  const from = text.lastIndexOf("\n", at - 1) + 1;
  const to = text.indexOf("\n", at) < 0 ? text.length : text.indexOf("\n", at);
  return (
    inMusic(text, file, at) &&
    lineKind(text.slice(from, to), true) === "music" &&
    text.startsWith("w:", to + 1)
  );
}

/** A plan's changes, their lyrics worked out again with the copy's own syllables. */
function relyric(text: string, file: FileIndex, changes: Change[], verses: string[][]): Change[] {
  // (The lyric changes the plan made are the ones in w: lines: they're made again.)
  const music = changes.filter((change) => {
    const line = text.slice(text.lastIndexOf("\n", change.from - 1) + 1, change.from);
    return !line.startsWith("w:");
  });
  return withLyrics(text, file, music, verses);
}

function withLyrics(
  text: string,
  file: FileIndex,
  changes: Change[],
  verses?: string[][],
): Change[] {
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
    extra.push(...lyricsFor(text, file, gone, count ? [[change.from, count, verses]] : []));
  }
  return seams(text, [...changes, ...extra]).sort((a, b) => a.from - b.from || a.to - b.to);
}
