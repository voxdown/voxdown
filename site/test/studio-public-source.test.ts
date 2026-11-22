import { describe, expect, it } from "vitest";
import { exportFdx } from "../src/studio/fdx";
import { parseFountain } from "../src/studio/fountain";
import { assertUnambiguousOmissions } from "../src/studio/public-source";
import { prepareActorSides } from "../src/studio/sides";

describe("consistent private boundaries in public handoffs", () => {
  it.each([
    "[[outside [[inside]] trailing private]]",
    "/* outside /* inside */ trailing private */",
    "[[outside /* inside */ end]]",
    "/* outside [[inside]] end */",
    "[[outside \\\\[[inside]] trailing private]]",
  ])("refuses ambiguous boundaries across exports: %s", (note) => {
    const source = `INT. ROOM - DAY\n\nMARA\nHello. ${note}`;
    const parsed = parseFountain(source);
    expect(parsed.warnings).toEqual([]);
    expect(() => assertUnambiguousOmissions(source, parsed)).toThrow(/Nested private/);
    expect(() => prepareActorSides(source)).toThrow(/Nested private/);
    expect(() => exportFdx(source)).toThrow(/Nested private/);
  });
  it.each([
    "[[A normal note]]",
    "/* A normal omission */",
    "[[The literal \\[[ opener is escaped]]",
    "/* The literal \\/* opener is escaped */",
    "[[two]] [[separate]]",
  ])("allows ordinary and explicitly escaped comments: %s", (note) => {
    const source = `INT. ROOM - DAY\n\nMARA\nHello. ${note}`;
    expect(() => assertUnambiguousOmissions(source, parseFountain(source))).not.toThrow();
    expect(prepareActorSides(source).characters).toHaveLength(1);
    expect(exportFdx(source).xml).toContain("Hello.");
  });
  it("does not expose private content in its error", () => {
    const source = "[[SECRET [[inner]] tail]]";
    try {
      assertUnambiguousOmissions(source, parseFountain(source));
    } catch (error) {
      expect(String(error)).not.toContain("SECRET");
      return;
    }
    throw new Error("Expected ambiguous source rejection");
  });
});
