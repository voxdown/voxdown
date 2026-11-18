import { describe, expect, it } from "vitest";
import { compareSources } from "../src/studio/comparison";

describe("bounded source comparison", () => {
  it("counts additions, removals, unchanged lines and provides normalized selection offsets", () => {
    const result = compareSources("A\r\nold\r\nC\rD", "A\nnew\nC\nextra\nD");
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;
    expect([result.added, result.removed, result.unchanged]).toEqual([2, 1, 3]);
    expect(
      result.changes.map((change) => [
        result.saved.slice(change.saved.from, change.saved.to),
        result.current.slice(change.current.from, change.current.to),
      ]),
    ).toEqual([
      ["old\n", "new\n"],
      ["", "extra\n"],
    ]);
  });
  it("handles repeated lines, empty files, EOF insertions, and literal HTML", () => {
    for (const [saved, current, counts] of [
      ["a\nb\na\nb", "a\na\nb", [0, 1, 3]],
      ["", "<script>hello</script>", [1, 0, 0]],
      ["a", "a\nb", [1, 0, 1]],
      ["a\nb", "", [0, 2, 0]],
      ["a\r\n", "a\n", [0, 0, 2]],
    ] as const) {
      const result = compareSources(saved, current);
      expect(result.status).toBe("complete");
      if (result.status === "complete")
        expect([result.added, result.removed, result.unchanged]).toEqual(counts);
    }
  });
  it("matches an independent LCS oracle for repeated short sequences", () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed;
    };
    for (let trial = 0; trial < 300; trial++) {
      const a = Array.from({ length: random() % 14 }, () => String(random() % 4));
      const b = Array.from({ length: random() % 14 }, () => String(random() % 4));
      const rows = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
      for (let i = 1; i <= a.length; i++)
        for (let j = 1; j <= b.length; j++) {
          const row = rows[i];
          const previous = rows[i - 1];
          if (row && previous)
            row[j] =
              a[i - 1] === b[j - 1]
                ? (previous[j - 1] ?? 0) + 1
                : Math.max(previous[j] ?? 0, row[j - 1] ?? 0);
        }
      const common = rows[a.length]?.[b.length] ?? 0;
      const result = compareSources(a.join("\n"), b.join("\n"));
      expect(result.status).toBe("complete");
      if (result.status !== "complete") continue;
      expect([result.added, result.removed, result.unchanged]).toEqual([
        b.length - common,
        a.length - common,
        common,
      ]);
      const restored = [...a];
      for (const change of [...result.changes].reverse()) {
        const from = change.saved.lineFrom - 1;
        const to = change.saved.lineTo;
        restored.splice(
          from,
          to - from,
          ...b.slice(change.current.lineFrom - 1, change.current.lineTo),
        );
      }
      expect(restored).toEqual(b);
      expect(
        result.changes.every(
          (change) =>
            change.saved.from <= change.saved.to && change.current.from <= change.current.to,
        ),
      ).toBe(true);
    }
  });
  it("handles long similar scripts and explicitly falls back for pathological unrelated scripts", () => {
    const lines = Array.from({ length: 19_000 }, (_, i) => `Line ${i}`);
    const revised = [...lines];
    revised[10] = "Changed";
    revised[18_000] = "Also changed";
    const result = compareSources(lines.join("\n"), revised.join("\n"));
    expect(result.status).toBe("complete");
    if (result.status === "complete") expect(result.changes).toHaveLength(2);
    const unrelated = compareSources(
      lines.join("\n"),
      lines.map((line) => `Other ${line}`).join("\n"),
    );
    expect(unrelated.status).toBe("too-large");
    expect(compareSources("x".repeat(500_001), "").status).toBe("too-large");
  });
});
