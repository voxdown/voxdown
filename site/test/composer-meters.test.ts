import { describe, expect, it } from "vitest";
import { defaultUnit, meterLength, value } from "../src/composer/abc";
import { checkBars } from "../src/composer/barcheck";
import { describeMeter } from "../src/composer/explain";
import { indexFile } from "../src/composer/tunes";

/** Bar issues for one line of music in a meter, with the default unit (no L:). */
function issues(meter: string, music: string) {
  const text = `X:1\nM:${meter}\nK:C\n${music}\n`;
  const file = indexFile(text);
  return checkBars(text, file.tunes[0] as never, file).map((issue) => issue.message);
}

describe("meters", () => {
  it("knows the length of every common meter", () => {
    const length = (meter: string) => value(meterLength(meter) as never);
    expect(length("C")).toBe(1);
    expect(length("C|")).toBe(1);
    expect(length("2/2")).toBe(1);
    expect(length("6/8")).toBe(0.75);
    expect(length("9/8")).toBe(1.125);
    expect(length("12/8")).toBe(1.5);
    expect(meterLength("none")).toBeNull();
  });
  it("gives each meter its default unit length", () => {
    expect(defaultUnit("C")).toEqual({ num: 1, den: 8 });
    expect(defaultUnit("C|")).toEqual({ num: 1, den: 8 });
    expect(defaultUnit("2/2")).toEqual({ num: 1, den: 8 });
    expect(defaultUnit("6/8")).toEqual({ num: 1, den: 8 });
    expect(defaultUnit("2/4")).toEqual({ num: 1, den: 16 });
    expect(defaultUnit("none")).toEqual({ num: 1, den: 8 });
  });
  it("checks bars by them", () => {
    // Eighths by default: C and C| hold 8, 6/8 holds 6, 9/8 holds 9, 12/8 holds 12.
    expect(issues("C", "CDEF GABc | CDEF GABc |")).toEqual([]);
    expect(issues("C|", "CDEF GABc | C4 C4 |")).toEqual([]);
    expect(issues("C|", "CDEF GAB | C4 C4 |")).toEqual([]);
    expect(issues("C|", "CDEF GABcd | C8 |")).toEqual(["Bar 1 has 9 eighths, 8 expected (M:C|)."]);
    expect(issues("2/2", "C4 C4 | C8 |")).toEqual([]);
    expect(issues("6/8", "CDE FGA | C3 C3 |")).toEqual([]);
    expect(issues("9/8", "CDE FGA Bcd | C9 |")).toEqual([]);
    expect(issues("12/8", "CDE FGA Bcd efg | C12 |")).toEqual([]);
    expect(issues("none", "CDEFGABcdefg | C |")).toEqual([]);
  });
  it("explains them", () => {
    expect(describeMeter("C")).toBe("common time, four quarter notes a bar");
    expect(describeMeter("C|")).toBe("cut time, two half notes a bar");
    expect(describeMeter("2/2")).toBe("2 half notes a bar");
    expect(describeMeter("6/8")).toBe("6 eighth notes a bar, 2 dotted beats");
    expect(describeMeter("9/8")).toBe("9 eighth notes a bar, 3 dotted beats");
    expect(describeMeter("12/8")).toBe("12 eighth notes a bar, 4 dotted beats");
    expect(describeMeter("none")).toBe("free time, no bar length");
  });
});
