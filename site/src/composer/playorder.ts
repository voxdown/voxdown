/**
 * The order a tune is played in. abcjs plays repeats and endings but not D.C., D.S., Fine or
 * Coda, so Composer works the order out itself:
 *
 * - repeats as abcjs plays them: `:|` goes back to the last `|:` (or `::`), or to just after the
 *   last `:|`, or to the start; a section with endings is played as many times as its highest
 *   ending number, each time taking the ending with that number;
 * - D.C. (`!D.C.!`, "D.C.", "Da Capo") goes back to the start, D.S. (`!D.S.!`, "D.S.", "Dal
 *   Segno") to `!segno!`, at the end of the bar that carries it, once the bar's own repeat is
 *   played out;
 * - on that return, repeats are not played again and each run of endings takes its last ending;
 * - al Fine stops at the end of the bar with `!fine!` ("Fine"); a plain D.C. or D.S. does too
 *   when the tune has a Fine, and otherwise plays to the end;
 * - al Coda leaves at the end of the bar with "To Coda" (`!dacoda!`, or the first `!coda!` when
 *   there is no "To Coda"), and goes on from the next `!coda!`;
 * - a mark on a bar line (`!segno!|:`) belongs to the bar after it when it is a segno or coda,
 *   and to the bar before it otherwise.
 *
 * Times are written times in whole notes, the score index's clock.
 */
import type { Pass, PlayNote, Timeline } from "./timeline";

// biome-ignore lint/suspicious/noExplicitAny: abcjs's parse has no published types.
type Any = any;

const EPS = 1e-6;

export type Jump = { kind: "D.C." | "D.S."; until: "end" | "fine" | "coda" };
export type Bar = {
  from: number;
  to: number;
  repeatStart: boolean;
  repeatEnd: boolean;
  /** The ending this bar is part of ([1, [2, [1,3), or null. */
  ending: number[] | null;
  /** The highest ending number in this bar's run of endings. */
  lastEnding: number;
  /** Marks that act at the end of this bar. */
  jump: Jump | null;
  fine: boolean;
  toCoda: boolean;
};
export type Structure = {
  bars: Bar[];
  /** Where D.S. goes back to, and where al Coda goes on from. */
  segno: number | null;
  coda: number | null;
};
/** A stretch of written time, and whether it is played after a jump: the return, or the coda. */
export type Segment = { from: number; to: number; returning: "D.C." | "D.S." | "Coda" | null };

/** A bar of written music with nothing on it yet. */
export const bar = (from: number, to: number, extra: Partial<Bar> = {}): Bar => ({
  from,
  to,
  repeatStart: false,
  repeatEnd: false,
  ending: null,
  lastEnding: 0,
  jump: null,
  fine: false,
  toCoda: false,
  ...extra,
});

type Mark =
  | { kind: "segno" | "coda" | "fine" | "toCoda" }
  | { kind: "jump"; jump: "D.C." | "D.S."; until: Jump["until"] | null };

/** The jump marks a decoration or an annotation makes. */
export function markOf(text: string, decoration: boolean): Mark | null {
  if (decoration) {
    const name = text;
    if (name === "segno") return { kind: "segno" };
    if (name === "coda") return { kind: "coda" };
    if (name === "fine") return { kind: "fine" };
    if (name === "dacoda") return { kind: "toCoda" };
    const jump = /^(D\.C\.|D\.S\.|dacapo)(al(fine|coda))?$/.exec(name);
    if (!jump) return null;
    return {
      kind: "jump",
      jump: jump[1] === "D.S." ? "D.S." : "D.C.",
      until: (jump[3] as "fine" | "coda" | undefined) ?? null,
    };
  }
  const words = text.trim().replace(/\s+/g, " ");
  if (/^fine\.?$/i.test(words)) return { kind: "fine" };
  if (/^(to coda|al coda)\b/i.test(words) || /^𝄌$/.test(words)) return { kind: "toCoda" };
  if (/^coda\.?$/i.test(words)) return { kind: "coda" };
  const jump = /^(D\.? ?C\.?|Da Capo|D\.? ?S\.?|Dal Segno)(?: al (Fine|Coda))?\.?$/i.exec(words);
  if (!jump) return null;
  return {
    kind: "jump",
    jump: /^(D\.? ?S|Dal)/i.test(jump[1] as string) ? "D.S." : "D.C.",
    until: (jump[2]?.toLowerCase() as "fine" | "coda" | undefined) ?? null,
  };
}

const endingNumbers = (text: string): number[] => {
  const numbers: number[] = [];
  for (const part of String(text).split(",")) {
    const range = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
    if (!range) continue;
    const from = Number(range[1]);
    const to = Number(range[2] ?? range[1]);
    for (let n = from; n <= to && n < from + 20; n++) numbers.push(n);
  }
  return numbers.length ? numbers : [1];
};

/**
 * The bars of a tune (from its first voice) and its jump marks (from every voice), from abcjs's
 * parse, on the same clock as the score index.
 */
export function structureOf(visual: Any): Structure {
  const bars: Bar[] = [];
  const marks: { time: number; mark: Mark }[] = [];
  const lines: Any[] = (visual?.lines ?? []).filter((line: Any) => line.staff);
  const keys = new Set<string>();
  for (const line of lines)
    (line.staff as Any[]).forEach((staff, staffIndex) =>
      (staff.voices as Any[]).forEach((_, voiceIndex) => keys.add(`${staffIndex}.${voiceIndex}`)),
    );
  for (const key of keys) {
    const [staffIndex, voiceIndex] = key.split(".").map(Number) as [number, number];
    const first = key === "0.0";
    let time = 0;
    let triplet = 1;
    let inTriplet = false;
    let barFrom = 0;
    let barEnding: number[] | null = null;
    let ending: number[] | null = null;
    let repeatStart = false;
    for (const line of lines) {
      const elements: Any[] = line.staff?.[staffIndex]?.voices?.[voiceIndex] ?? [];
      for (const element of elements) {
        if (element.el_type === "note") {
          if (element.startTriplet) {
            triplet = element.tripletMultiplier ?? 1;
            inTriplet = true;
          }
          for (const name of element.decoration ?? []) {
            const mark = markOf(String(name), true);
            if (mark) marks.push({ time, mark });
          }
          for (const chord of element.chord ?? [])
            for (const name of String(chord.name ?? "").split("\n")) {
              const mark = markOf(name, false);
              if (mark) marks.push({ time, mark });
            }
          const spacer = element.rest?.type === "spacer";
          time += spacer ? 0 : (element.duration ?? 0) * (inTriplet ? triplet : 1);
          if (element.endTriplet) {
            inTriplet = false;
            triplet = 1;
          }
        } else if (element.el_type === "bar") {
          // A mark on a bar line: a segno or coda starts the bar after it; Fine, To Coda and
          // jumps end the bar before it.
          for (const name of element.decoration ?? []) {
            const mark = markOf(String(name), true);
            if (mark)
              marks.push({
                time: mark.kind === "segno" || mark.kind === "coda" ? time : time - EPS * 10,
                mark,
              });
          }
          if (!first) continue;
          const type = String(element.type ?? "");
          const closesRepeat = /right_repeat|dbl_repeat/.test(type);
          if (time > barFrom + EPS) {
            bars.push(
              bar(barFrom, time, { repeatStart, repeatEnd: closesRepeat, ending: barEnding }),
            );
            barFrom = time;
            repeatStart = false;
          } else if (closesRepeat && bars.length) (bars[bars.length - 1] as Bar).repeatEnd = true;
          if (element.endEnding || closesRepeat) ending = null;
          if (element.startEnding) ending = endingNumbers(element.startEnding);
          if (/left_repeat|dbl_repeat/.test(type)) repeatStart = true;
          barEnding = ending;
        }
      }
    }
    if (first && time > barFrom + EPS)
      bars.push(bar(barFrom, time, { repeatStart, ending: barEnding }));
  }
  // Runs of endings, and the last ending of each.
  let run: Bar[] = [];
  const closeRun = () => {
    const last = Math.max(0, ...run.flatMap((each) => each.ending ?? []));
    for (const each of run) each.lastEnding = last;
    run = [];
  };
  for (const each of bars) {
    if (each.ending) run.push(each);
    else if (run.length) closeRun();
  }
  closeRun();
  const indexAt = (time: number) => {
    const found = bars.findIndex((each) => time >= each.from - EPS && time < each.to - EPS);
    return found >= 0 ? found : bars.length - 1;
  };
  marks.sort((a, b) => a.time - b.time);
  const segno = marks.find((each) => each.mark.kind === "segno")?.time ?? null;
  const codas = [
    ...new Set(marks.filter((each) => each.mark.kind === "coda").map((each) => each.time)),
  ];
  const hasFine = marks.some((each) => each.mark.kind === "fine");
  for (const { time, mark } of marks) {
    const at = bars[indexAt(time)];
    if (!at) continue;
    if (mark.kind === "fine") at.fine = true;
    if (mark.kind === "toCoda") at.toCoda = true;
    if (mark.kind === "jump" && !bars.some((each) => each.jump))
      at.jump = { kind: mark.jump, until: mark.until ?? (hasFine ? "fine" : "end") };
  }
  // With no "To Coda", the first coda sign is where al Coda leaves; it goes on from the next.
  let leave = bars.findIndex((each) => each.toCoda);
  if (leave < 0 && codas.length > 1) {
    leave = indexAt(codas[0] as number);
    if (bars[leave]) (bars[leave] as Bar).toCoda = true;
  }
  const leaveEnd = leave >= 0 ? (bars[leave] as Bar).to : Number.NEGATIVE_INFINITY;
  const coda = codas.find((time) => time >= leaveEnd - EPS) ?? null;
  return { bars, segno, coda };
}

/** Whether a tune has a jump to follow (D.C. or D.S.). */
export const hasJumps = (structure: Structure) => structure.bars.some((each) => each.jump);

/** The written music in the order it is played, as stretches of written time. */
export function playOrder(structure: Structure, followJumps = true): Segment[] {
  const { bars } = structure;
  const segments: Segment[] = [];
  const push = (from: number, to: number, returning: Segment["returning"]) => {
    if (to - from <= EPS) return;
    const last = segments[segments.length - 1];
    if (last && Math.abs(last.to - from) < EPS && last.returning === returning) last.to = to;
    else segments.push({ from, to, returning });
  };
  const indexAt = (time: number) => {
    const found = bars.findIndex((each) => time >= each.from - EPS && time < each.to - EPS);
    return found >= 0 ? found : 0;
  };
  let index = 0;
  let pass = 1;
  let sectionStart = 0;
  let returning: Segment["returning"] = null;
  let until: Jump["until"] = "end";
  let startAt: number | null = null;
  for (let guard = 0; index < bars.length && guard < 100_000; guard++) {
    const current = bars[index] as Bar;
    if (!returning && current.repeatStart && sectionStart !== index) {
      sectionStart = index;
      pass = 1;
    }
    if (current.ending) {
      const wanted = returning ? current.lastEnding : pass;
      if (!current.ending.includes(wanted)) {
        index++;
        continue;
      }
    }
    push(startAt ?? current.from, current.to, returning);
    startAt = null;
    // At the end of the bar: Fine, To Coda, the bar's repeat, then a jump back.
    if (returning && until === "fine" && current.fine) break;
    if (returning && until === "coda" && current.toCoda && structure.coda !== null) {
      index = indexAt(structure.coda);
      startAt = structure.coda > (bars[index] as Bar).from + EPS ? structure.coda : null;
      until = "end";
      returning = "Coda";
      continue;
    }
    if (current.repeatEnd && !returning) {
      const total = current.ending ? Math.max(2, current.lastEnding) : 2;
      if (pass < total) {
        pass++;
        index = sectionStart;
        continue;
      }
      pass = 1;
      sectionStart = index + 1;
    }
    if (current.jump && !returning && followJumps) {
      returning = current.jump.kind;
      until = current.jump.until;
      const target = current.jump.kind === "D.S." && structure.segno !== null ? structure.segno : 0;
      index = indexAt(target);
      startAt = target > (bars[index] as Bar).from + EPS ? target : null;
      continue;
    }
    index++;
  }
  return segments;
}

/**
 * A timeline laid out in a play order: each written note (once, as first played) placed where
 * its stretch is played. Bars and passes are worked out again; the stretches after a jump are
 * marked so the clock can say "D.S.".
 */
export function followOrder(
  timeline: Timeline,
  structure: Structure,
  segments: Segment[],
): Timeline {
  const once: PlayNote[] = [];
  const seen = new Set<string>();
  for (const note of [...timeline.notes].sort((a, b) => a.time - b.time)) {
    const key = `${note.track}:${note.pitch}:${Math.round(note.written * 1e5)}:${note.start ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    once.push(note);
  }
  once.sort((a, b) => a.written - b.written || a.track - b.track);
  const notes: PlayNote[] = [];
  const bars: number[] = [];
  const returns: NonNullable<Timeline["returns"]> = [];
  let cursor = 0;
  for (const segment of segments) {
    for (const note of once)
      if (note.written >= segment.from - EPS && note.written < segment.to - EPS)
        notes.push({
          ...note,
          time: cursor + note.written - segment.from,
          duration: Math.min(note.duration, segment.to - note.written),
        });
    for (const each of structure.bars)
      if (each.from >= segment.from - EPS && each.from < segment.to - EPS)
        bars.push(cursor + each.from - segment.from);
      else if (each.from < segment.from - EPS && each.to > segment.from + EPS) bars.push(cursor);
    if (segment.returning) {
      const last = returns[returns.length - 1];
      if (last && Math.abs(last.to - cursor) < EPS && last.label === segment.returning)
        last.to = cursor + segment.to - segment.from;
      else
        returns.push({
          from: cursor,
          to: cursor + segment.to - segment.from,
          label: segment.returning,
        });
    }
    cursor += segment.to - segment.from;
  }
  notes.sort((a, b) => a.time - b.time || a.track - b.track || a.pitch - b.pitch);
  // A new pass wherever playback goes back in the written music.
  const passes: Pass[] = [];
  let passStart = 0;
  let previous: PlayNote | undefined;
  let repeat = false;
  for (const note of notes) {
    if (note.start === undefined) continue;
    if (previous && note.written < previous.written - EPS) {
      passes.push({ from: passStart, to: note.time, repeat });
      passStart = note.time;
      repeat = !repeat;
    }
    previous = note;
  }
  passes.push({ from: passStart, to: cursor, repeat });
  return {
    ...timeline,
    notes,
    length: Math.max(cursor, ...notes.map((note) => note.time + note.duration), 0),
    bars: [...new Set(bars.map((time) => Math.round(time * 1e6) / 1e6))].sort((a, b) => a - b),
    passes,
    returns,
  };
}
