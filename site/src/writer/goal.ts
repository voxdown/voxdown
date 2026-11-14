/**
 * The writing goal, counted by the day, and sprints: a time to write in, and the words written in
 * it. All kept in this browser (localStorage), by story: the words a story had when the day began
 * here, each day's words, and the sprints written.
 */

/** A day as this computer's calendar has it: `2026-11-14`. */
export function dayOf(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** What a story's days are kept as: where today began, and the words written each day. */
export type Days = {
  /** The day the count started from, and the story's words then. */
  today: { day: string; start: number };
  /** Words written on each day (net: words taken out count against them), the newest last. */
  written: Record<string, number>;
};

export type Sprint = {
  /** When it started, and how long it runs, in minutes. */
  startedAt: number;
  minutes: number;
  /** The story it was started on, and its words then. */
  story: string;
  title: string;
  startWords: number;
};

export type SprintDone = {
  day: string;
  at: number;
  minutes: number;
  words: number;
  title: string;
};

/** Where things are kept, or a stand-in for a test. */
export type Keeper = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const DAYS = "vxd-writer-days";
const SPRINT = "vxd-writer-sprint";
const SPRINTS = "vxd-writer-sprints";
/** How many days, and sprints, are kept. */
const KEEP_DAYS = 60;
const KEEP_SPRINTS = 60;

function read<T>(keeper: Keeper, key: string, fallback: T): T {
  try {
    return (JSON.parse(keeper.getItem(key) ?? "null") as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function write(keeper: Keeper, key: string, value: unknown): void {
  try {
    keeper.setItem(key, JSON.stringify(value));
  } catch {
    // Short of room, or a private window: the count holds for this visit.
  }
}

/**
 * The words written today in a story, given its words now: the day's count goes on from where it
 * was (a reload, the story opened again); a new day starts from the words it has. Kept as it goes.
 */
export function writtenToday(keeper: Keeper, story: string, words: number, now: number): number {
  const all = read<Record<string, Days>>(keeper, DAYS, {});
  const day = dayOf(now);
  const kept = all[story];
  const days: Days =
    kept && kept.today.day === day
      ? kept
      : { today: { day, start: words }, written: kept?.written ?? {} };
  const today = words - days.today.start;
  days.written[day] = today;
  // The oldest days go, past the ones kept.
  const order = Object.keys(days.written).sort();
  for (const old of order.slice(0, Math.max(0, order.length - KEEP_DAYS))) delete days.written[old];
  all[story] = days;
  write(keeper, DAYS, all);
  return today;
}

/** The words written each day, all stories together, the newest first. */
export function daysWritten(keeper: Keeper): Array<{ day: string; words: number }> {
  const totals = new Map<string, number>();
  for (const days of Object.values(read<Record<string, Days>>(keeper, DAYS, {})))
    for (const [day, words] of Object.entries(days.written ?? {}))
      totals.set(day, (totals.get(day) ?? 0) + words);
  return [...totals]
    .map(([day, words]) => ({ day, words }))
    .sort((a, b) => b.day.localeCompare(a.day));
}

/** The sprint running, if any, and whether it has run its time. */
export function sprintNow(keeper: Keeper): Sprint | undefined {
  return read<Sprint | undefined>(keeper, SPRINT, undefined);
}

export function startSprint(keeper: Keeper, sprint: Sprint): void {
  write(keeper, SPRINT, sprint);
}

/** Ends the sprint running: kept in the log if it wrote anything or ran its time. */
export function endSprint(keeper: Keeper, words: number, now: number): SprintDone | undefined {
  const sprint = sprintNow(keeper);
  keeper.removeItem(SPRINT);
  if (!sprint) return undefined;
  const minutes = Math.min(sprint.minutes, Math.round((now - sprint.startedAt) / 60000));
  const done: SprintDone = {
    day: dayOf(sprint.startedAt),
    at: sprint.startedAt,
    minutes,
    words: words - sprint.startWords,
    title: sprint.title,
  };
  if (minutes < 1 && done.words <= 0) return done;
  const log = read<SprintDone[]>(keeper, SPRINTS, []);
  log.push(done);
  write(keeper, SPRINTS, log.slice(-KEEP_SPRINTS));
  return done;
}

/** The sprints written, the newest first. */
export function sprintsDone(keeper: Keeper): SprintDone[] {
  return read<SprintDone[]>(keeper, SPRINTS, []).slice().reverse();
}

/** `25:00`, `4:05`: the time left, as a clock shows it. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
