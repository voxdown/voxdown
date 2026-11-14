import { describe, expect, it } from "vitest";
import {
  type Keeper,
  clock,
  dayOf,
  daysWritten,
  endSprint,
  sprintNow,
  sprintsDone,
  startSprint,
  writtenToday,
} from "../src/writer/goal";

/** A browser's storage, in memory. */
function keeper(): Keeper {
  const kept = new Map<string, string>();
  return {
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => void kept.set(key, value),
    removeItem: (key) => void kept.delete(key),
  };
}

const morning = new Date(2026, 10, 14, 9, 0).getTime();
const evening = new Date(2026, 10, 14, 21, 0).getTime();
const tomorrow = new Date(2026, 10, 15, 8, 0).getTime();

describe("the goal, counted by the day", () => {
  it("goes on counting through a reload, and starts again the next day", () => {
    const store = keeper();
    expect(writtenToday(store, "owl", 1000, morning)).toBe(0);
    expect(writtenToday(store, "owl", 1240, morning + 60_000)).toBe(240);
    // The page loaded again in the evening: the day's words are still the day's.
    expect(writtenToday(store, "owl", 1300, evening)).toBe(300);
    // Words taken out count against the day.
    expect(writtenToday(store, "owl", 1280, evening + 1)).toBe(280);
    expect(writtenToday(store, "owl", 1280, tomorrow)).toBe(0);
    expect(writtenToday(store, "owl", 1500, tomorrow + 1)).toBe(220);
    expect(dayOf(morning)).toBe("2026-11-14");
  });

  it("adds every story's words for each day, the newest first", () => {
    const store = keeper();
    writtenToday(store, "owl", 100, morning);
    writtenToday(store, "owl", 400, morning + 1);
    writtenToday(store, "fox", 50, evening);
    writtenToday(store, "fox", 150, evening + 1);
    writtenToday(store, "owl", 400, tomorrow);
    writtenToday(store, "owl", 450, tomorrow + 1);
    expect(daysWritten(store)).toEqual([
      { day: "2026-11-15", words: 50 },
      { day: "2026-11-14", words: 400 },
    ]);
  });
});

describe("sprints", () => {
  it("run their time, and are kept with the words written in them", () => {
    const store = keeper();
    startSprint(store, {
      startedAt: morning,
      minutes: 25,
      story: "owl",
      title: "The Owl",
      startWords: 1000,
    });
    expect(sprintNow(store)?.minutes).toBe(25);
    const done = endSprint(store, 1412, morning + 25 * 60_000);
    expect(done).toMatchObject({ minutes: 25, words: 412, title: "The Owl" });
    expect(sprintNow(store)).toBeUndefined();
    expect(sprintsDone(store)).toHaveLength(1);
  });

  it("stopped at once with nothing written, leave nothing in the log", () => {
    const store = keeper();
    startSprint(store, { startedAt: morning, minutes: 15, story: "owl", title: "", startWords: 9 });
    endSprint(store, 9, morning + 5_000);
    expect(sprintsDone(store)).toEqual([]);
  });

  it("show the time left as a clock", () => {
    expect(clock(25 * 60)).toBe("25:00");
    expect(clock(245.2)).toBe("4:06");
    expect(clock(-3)).toBe("0:00");
  });
});
