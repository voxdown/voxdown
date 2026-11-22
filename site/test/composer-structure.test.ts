import { describe, expect, it } from "vitest";
import { checkBars } from "../src/composer/barcheck";
import { cutPlan, duplicate, replaceKeepingBars } from "../src/composer/barwise";
import { insertRepeat } from "../src/composer/inserts";
import { planPaste } from "../src/composer/paste";
import { selectedNotes } from "../src/composer/selected";
import { indexFile } from "../src/composer/tunes";
import { tuneItems } from "../src/composer/walk";
import { apply, played } from "./composer-played";

/* Round 5: what a musician expects of Delete, Backspace, typing, Cut, Paste and Repeat. */

const head = "X:1\nT:t\nM:3/4\nL:1/4\nK:C\n";
/** Each bar's notes as a selection takes them. */
function barsOf(text: string) {
  const file = indexFile(text);
  const bars: { from: number; to: number }[][] = [[]];
  for (const item of tuneItems(text, file.tunes[0] as never, file)) {
    if (item.type === "bar") bars.push([]);
    else (bars[bars.length - 1] as { from: number; to: number }[]).push(item);
  }
  return bars
    .filter((bar) => bar.length)
    .map((bar) => {
      const first = bar[0] as { from: number };
      const span = selectedNotes(text, [{ from: first.from, to: first.from + 1 }], file)[0]?.span;
      return { from: span?.from ?? first.from, to: (bar[bar.length - 1] as { to: number }).to };
    });
}
const barTokens = (text: string) =>
  text.match(/(?:\[\||\|\]|:\|\]|\|[0-9]+|:*\|+:*[0-9]*|:{2,}|\[[0-9]+)/g) ?? [];

// Every kind of bar line, compact and spaced.
const compact = [
  `${head}C D E|:F G A::B c d:|e f g||A B c|]\n`,
  `${head}|:C D E|1F G A:|2B c d|]\n`,
  `${head}|:C D E|[1F G A:|[2B c d|]\n`,
  `${head}G A B|:E B E:|G3|]\n`,
];
const spaced = compact.map((tune) =>
  tune
    .replace(/((?:\[\||\|\]|:\|\]|\|[0-9]+|:*\|+:*[0-9]*|:{2,}|\[[0-9]+))/g, " $1 ")
    .replace(/ +/g, " ")
    .replace(/\n /g, "\n"),
);

describe("deleting, backspacing and typing over every bar's notes (round 5, finding 1)", () => {
  for (const tune of [...compact, ...spaced])
    for (const [at, bar] of barsOf(tune).entries()) {
      const notes = tune.slice(bar.from, bar.to);
      it(`Delete and Backspace (one plan) over bar ${at + 1} of ${JSON.stringify(tune.slice(head.length, -1))}`, () => {
        const plan = cutPlan(tune, [bar]);
        expect(plan).not.toBeNull();
        if (!plan || "refused" in plan) {
          expect(plan && "refused" in plan && plan.refused).toMatch(/repeat|ending/);
          return;
        }
        const after = apply(tune, plan.changes);
        // No bar lines fused into signs that weren't there.
        for (const token of barTokens(after))
          expect(["|::|", "|:|", "::|", "|::", ":||:"]).not.toContain(token);
        if (!/\|\|/.test(tune)) expect(barTokens(after)).not.toContain("||");
        // The play order loses exactly those notes.
        const before = played(tune).filter((note) => note.start < bar.from || note.start >= bar.to);
        expect(
          played(after).map((note) => note.pitch),
          after,
        ).toEqual(before.map((note) => note.pitch));
      });
      it(`typing over bar ${at + 1} (${notes}) keeps every bar line its own`, () => {
        const changes = replaceKeepingBars(tune, [bar], "z3");
        expect(changes && !("refused" in changes)).toBe(true);
        const after = apply(tune, changes as never);
        expect(barTokens(after)).toEqual(barTokens(tune));
        const before = played(tune).filter((note) => note.start < bar.from || note.start >= bar.to);
        expect(played(after).map((note) => note.pitch)).toEqual(before.map((note) => note.pitch));
      });
    }
});

describe("Insert › Repeat never nests (round 5, finding 4)", () => {
  const tune = `${head.replace("M:3/4", "M:4/4")}|: C D E F | G A B c |[1 d e f g :|[2 c B A G | C4 |]\nE F G A | B c d e |]\n`;
  const bars = barsOf(tune);
  for (let a = 0; a < bars.length; a++)
    for (let b = a; b < Math.min(bars.length, a + 2); b++) {
      const range = {
        from: (bars[a] as { from: number }).from,
        to: (bars[b] as { to: number }).to,
      };
      it(`over bars ${a + 1}–${b + 1}: refused inside a repeat, else they play twice`, () => {
        const result = insertRepeat(tune, [range]);
        if (!result) throw new Error("no notes");
        if ("refused" in result) {
          expect(result.refused).toMatch(/Already inside a repeat \(bars 1–5\)/);
          expect(a).toBeLessThan(5);
          return;
        }
        expect(a).toBeGreaterThanOrEqual(5);
        const after = apply(tune, result);
        const before = played(tune);
        const run = before.filter((note) => note.start >= range.from && note.start < range.to);
        const at = before.findIndex((note) => note.start >= range.to);
        const expected = [
          ...before.slice(0, at === -1 ? before.length : at),
          ...run,
          ...(at === -1 ? [] : before.slice(at)),
        ];
        expect(
          played(after).map((note) => note.pitch),
          after,
        ).toEqual(expected.map((note) => note.pitch));
      });
    }
});

const kesh =
  "X:2\nT:Kesh\nR:jig\nM:6/8\nL:1/8\nK:G\n|:GAG GAB|ABA ABd|edd gdd|edB dBA|\nGAG GAB|ABA ABd|edd gdB|AGF G3:|\n|:BAB dBd|ege dBA|BAB dBG|ABA AGA|\nBAB dBd|ege dBd|gfg aga|bgf g3:|\n";
const morrison =
  "X:3\nT:Morrison's\nR:jig\nM:6/8\nL:1/8\nK:Edor\n|:E3 B3|EBE AFD|EDE B3|dcB AFD|\nE3 B3|EBE AFD|G3 FGA|1 BAG FED:|2 BAG FE2||\n";

describe("a repeat across a line break is cut as one (round 5, finding 5)", () => {
  it("the Kesh's B part goes whole, its signs with it, no lines of bar lines left", () => {
    const range = { from: kesh.indexOf("BAB dBd"), to: kesh.lastIndexOf("g3") + 2 };
    const plan = cutPlan(kesh, [range]);
    if (!plan || "refused" in plan) throw new Error(plan ? plan.refused : "none");
    const after = apply(kesh, plan.changes);
    expect(after).toBe(kesh.slice(0, kesh.indexOf("|:BAB")));
    expect(plan.clip.startsWith("|:BAB dBd|")).toBe(true);
    expect(plan.clip.endsWith("bgf g3:|")).toBe(true);
  });
  it("moving the B part before the A part: cut, then paste at the start", () => {
    const range = { from: kesh.indexOf("BAB dBd"), to: kesh.lastIndexOf("g3") + 2 };
    const plan = cutPlan(kesh, [range]);
    if (!plan || "refused" in plan) throw new Error("refused");
    const after = apply(kesh, plan.changes);
    const start = after.indexOf("|:GAG");
    const paste = planPaste(after, [{ from: start, to: start }], 0, plan.clip, null);
    const moved =
      paste && "changes" in paste
        ? apply(after, paste.changes)
        : `${after.slice(0, start)}${plan.clip}${after.slice(start)}`;
    const split = kesh.indexOf("|:BAB");
    const a = played(kesh).filter((note) => note.start < split);
    const b = played(kesh).filter((note) => note.start >= split);
    expect(
      played(moved).map((note) => note.pitch),
      moved,
    ).toEqual([...b, ...a].map((note) => note.pitch));
  });
  it("Morrison's whole repeat with its endings, over two lines, goes as one", () => {
    const range = { from: morrison.indexOf("E3 B3"), to: morrison.lastIndexOf("FE2") + 3 };
    const plan = cutPlan(morrison, [range]);
    if (!plan || "refused" in plan) throw new Error(plan ? plan.refused : "none");
    const after = apply(morrison, plan.changes);
    expect(played(after)).toEqual([]);
    expect(after).not.toMatch(/\n\|*\n|\|:\s*:\|/);
  });
  it("its body with its 1st ending: the 2nd ending then plays once", () => {
    const range = { from: morrison.indexOf("E3 B3"), to: morrison.indexOf("FED") + 3 };
    const plan = cutPlan(morrison, [range]);
    if (!plan || "refused" in plan) throw new Error(plan ? plan.refused : "none");
    const after = apply(morrison, plan.changes);
    expect(played(after).map((note) => note.pitch)).toEqual(
      played(morrison)
        .filter((note) => note.start >= morrison.indexOf("FED") + 3)
        .map((note) => note.pitch),
    );
  });
});

const hymn =
  'X:1\nT:Old Hundredth\nM:2/2\nL:1/4\n%%score (S A) (T B)\nV:S clef=treble name="Soprano"\nV:A clef=treble name="Alto"\nV:T clef=bass name="Tenor"\nV:B clef=bass name="Bass"\nK:G\n[V:S] G2 | G F E D | G2 A2 | B2 B2 |]\nw: All peo-ple that on earth do dwell,\n[V:A] D2 | D D C B, | D2 D2 | D2 D2 |]\n[V:T] B,2 | B, A, G, G, | B,2 C2 | B,2 G,2 |]\n[V:B] G,2 | G, D, E, G, | G,2 F,2 | G,2 G,2 |]\n';
const issues = (text: string) => {
  const file = indexFile(text);
  return checkBars(text, file.tunes[0] as never, file);
};

describe("voices kept in step (round 5, finding 6)", () => {
  it("Delete in the tenor only leaves rests as long as its notes", () => {
    const range = { from: hymn.indexOf("B, A, G, G,"), to: hymn.indexOf("B, A, G, G,") + 11 };
    const plan = cutPlan(hymn, [range]);
    if (!plan || "refused" in plan) throw new Error("refused");
    const after = apply(hymn, plan.changes);
    expect(after).toContain("[V:T] B,2 | z4 | B,2 C2");
    expect(plan.said.join(" ")).toMatch(/Rests in place of the notes, so V:T stays in step/);
    expect(issues(after)).toEqual([]);
  });
  it("Delete of a bar in every voice takes the time out, and its syllables", () => {
    const bar = (voice: string, notes: string) => {
      const at = hymn.indexOf(notes, hymn.indexOf(`[V:${voice}]`));
      return { from: at, to: at + notes.length };
    };
    const ranges = [
      bar("S", "G F E D"),
      bar("A", "D D C B,"),
      bar("T", "B, A, G, G,"),
      bar("B", "G, D, E, G,"),
    ];
    const plan = cutPlan(hymn, ranges);
    if (!plan || "refused" in plan) throw new Error("refused");
    const after = apply(hymn, plan.changes);
    expect(after).toContain("[V:S] G2 | G2 A2 | B2 B2 |]\nw: All earth do dwell,");
    expect(issues(after)).toEqual([]);
  });
  it("Duplicate in one voice fills the others with rests, and brings the syllables", () => {
    const at = hymn.indexOf("G F E D");
    const plan = duplicate(hymn, [{ from: at, to: at + 7 }]);
    if ("refused" in plan) throw new Error(plan.refused);
    const after = apply(hymn, plan.changes);
    expect(after).toContain("[V:S] G2 | G F E D | G F E D | G2 A2");
    expect(after).toContain("w: All peo-ple that on peo-ple that on earth do dwell,");
    expect(after).toContain("[V:A] D2 | D D C B, | z4 | D2 D2");
    expect(issues(after)).toEqual([]);
    expect(plan.said.join(" ")).toMatch(/rests in V:A and V:T and V:B keep them in step/);
  });
  it("the bar check lists a voice a bar short", () => {
    const short = hymn.replace("[V:T] B,2 | B, A, G, G, | B,2 C2 |", "[V:T] B,2 | B,2 C2 |");
    // (The pickup isn't counted: three bars after it, against two.)
    expect(issues(short).map((issue) => issue.label)).toEqual([
      "V:T out of step — 2 bars against V:S's 3",
    ]);
  });
});

describe("a bar pasted over part of a bar (round 5, finding 7; round 7, finding 1)", () => {
  it("overwrites forward from the selection's first note, the bar lines where they were", () => {
    const tune = `${head}C D E|F G A|B c d|]\n`;
    const at = tune.indexOf("G A");
    const plan = planPaste(tune, [{ from: at, to: at + 3 }], 0, "e f g|", null);
    if (!plan || "refused" in plan) throw new Error("no plan");
    // (The notes after the copy's end stay: round 8, item 4.)
    expect(apply(tune, plan.changes)).toBe(`${head}C D E|F e f|g c d|]\n`);
    expect(plan.message).toMatch(
      /^Pasted over the selection from its first note; it ran on over 1 more note, replaced\.$/,
    );
  });
});

describe("a tune pasted after music gets its blank line (round 5, finding 11)", () => {
  it("before the X: line, and after it when music follows", () => {
    const two = `${head}C D E|]\n`;
    const end = two.length;
    const plan = planPaste(two, [{ from: end, to: end }], 0, "X:2\nT:u\nK:C\nG A B|]\n", null);
    if (!plan || "refused" in plan) throw new Error("no plan");
    expect(apply(two, plan.changes)).toBe(`${two}\nX:2\nT:u\nK:C\nG A B|]\n`);
  });
});

describe("moving the Kesh's parts, every way of pasting (round 6, finding 1)", () => {
  const split = kesh.indexOf("|:BAB");
  const a = played(kesh).filter((note) => note.start < split);
  const b = played(kesh).filter((note) => note.start >= split);
  const pitches = (list: { pitch: number }[]) => list.map((note) => note.pitch);
  const move = (part: "A" | "B", where: (after: string) => { from: number; to: number }) => {
    const range =
      part === "B"
        ? { from: kesh.indexOf("BAB dBd"), to: kesh.lastIndexOf("g3") + 2 }
        : { from: kesh.indexOf("GAG GAB"), to: kesh.indexOf("AGF G3") + 6 };
    const plan = cutPlan(kesh, [range]);
    if (!plan || "refused" in plan) throw new Error("refused");
    const after = apply(kesh, plan.changes);
    const place = where(after);
    const paste = planPaste(after, [place], 0, plan.clip, null);
    if (paste && "refused" in paste) throw new Error(paste.refused);
    return paste
      ? apply(after, paste.changes)
      : `${after.slice(0, place.from)}${plan.clip}${after.slice(place.to)}`;
  };
  it("B before A: at a caret at A's start", () => {
    const out = move("B", (after) => ({
      from: after.indexOf("|:GAG"),
      to: after.indexOf("|:GAG"),
    }));
    expect(pitches(played(out)), out).toEqual(pitches([...b, ...a]));
  });
  it("B before A: on A's first note, clicked", () => {
    const out = move("B", (after) => ({
      from: after.indexOf("GAG"),
      to: after.indexOf("GAG") + 1,
    }));
    expect(pitches(played(out)), out).toEqual(pitches([...b, ...a]));
  });
  it("B before A: over A's first bar, selected (never inside A)", () => {
    const out = move("B", (after) => ({
      from: after.indexOf("GAG GAB"),
      to: after.indexOf("GAG GAB") + 7,
    }));
    expect(pitches(played(out)), out).toEqual(pitches([...b, ...a]));
  });
  it("A after B: at a caret after B's last note, before its end repeat", () => {
    const out = move("A", (after) => ({
      from: after.lastIndexOf("g3") + 2,
      to: after.lastIndexOf("g3") + 2,
    }));
    expect(pitches(played(out)), out).toEqual(pitches([...b, ...a]));
    expect(out).toMatch(/bgf g3::GAG|bgf g3:\|\n?\|:GAG/);
  });
  it("A after B: on B's last note, clicked", () => {
    const out = move("A", (after) => ({
      from: after.lastIndexOf("g3"),
      to: after.lastIndexOf("g3") + 2,
    }));
    expect(pitches(played(out)), out).toEqual(pitches([...b, ...a]));
  });
});
