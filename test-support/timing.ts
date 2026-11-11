/**
 * Time budgets for the tests that guard against slow algorithms: a search made quadratic again, a
 * recursion as deep as its input. A wall clock says as much about the computer, and what else it
 * is doing, as about the code; so a budget here is for the laptop the budgets were set on, scaled by how
 * much slower this computer does a fixed piece of work at the moment, and work over it is done
 * twice more before failing, the quickest counted. A slow machine or a busy one gets more time;
 * work that went from linear to quadratic, tens or thousands of times slower, still fails.
 */
import { expect } from "vitest";

/** The fixed piece of work: strings, regular expressions and small objects, as the parser does. */
function reference(): number {
  const start = performance.now();
  const words: string[] = [];
  for (let at = 0; at < 40_000; at++) words.push(`word${at % 97}`);
  const text = words.join(" ");
  let found = 0;
  for (let round = 0; round < 6; round++) {
    for (const match of text.matchAll(/\bword(\d+)\b/g)) found += match[1]?.length ?? 0;
    found += text.split(" ").map((word) => ({ word, long: word.length > 5 })).length;
  }
  if (found < 0) throw new Error("unreachable");
  return performance.now() - start;
}

/** How long the reference takes on the laptop the budgets were set on, in ms. */
const BASELINE = 20;

/** How many times slower than that this computer does the reference now: 1 at the least. */
export function slowness(): number {
  return Math.max(1, Math.min(reference(), reference()) / BASELINE);
}

/** How long `work` took, its quickest of up to three tries, and the budget this computer gets. */
export function timed(budget: number, work: () => unknown): { took: number; allowed: number } {
  let took = Number.POSITIVE_INFINITY;
  let allowed = budget;
  for (let attempt = 0; attempt < 3; attempt++) {
    const start = performance.now();
    work();
    took = Math.min(took, performance.now() - start);
    if (took < budget) return { took, allowed: budget };
    allowed = budget * slowness();
    if (took < allowed) break;
  }
  return { took, allowed };
}

/** Fails unless `work` is done within `budget` ms, scaled to this computer as it is now. */
export function inGoodTime(budget: number, work: () => unknown, what = "the work"): void {
  const { took, allowed } = timed(budget, work);
  expect(
    took,
    `${what} took ${Math.round(took)} ms (allowed ${Math.round(allowed)} here)`,
  ).toBeLessThan(allowed);
}
