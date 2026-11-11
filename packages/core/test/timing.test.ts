import { describe, expect, it } from "vitest";
import { inGoodTime, slowness, timed } from "../../../test-support/timing";

const busy = (ms: number) => () => {
  const end = performance.now() + ms;
  while (performance.now() < end);
};

describe("the tests' time budgets", () => {
  it("pass work within its budget at once, without measuring the computer", () => {
    expect(timed(200, busy(1))).toEqual({ took: expect.any(Number), allowed: 200 });
    inGoodTime(200, busy(1));
  });

  it("still fail work many times over its budget, however slow the computer", () => {
    const factor = slowness();
    expect(factor).toBeGreaterThanOrEqual(1);
    expect(() => inGoodTime(5, busy(Math.min(400, 60 * factor)), "slow work")).toThrow(
      /slow work took \d+ ms \(allowed \d+ here\)/,
    );
  });
});
