import abcjs from "abcjs";
import { describe, expect, it } from "vitest";
import {
  type Change,
  duplicateChange,
  incipitsText,
  lineUpChanges,
  newTuneAfterChange,
  renumberChanges,
  sortChange,
  titleKey,
} from "../src/composer/book";
import { newTuneTemplate } from "../src/composer/commands";
import { EXAMPLES } from "../src/composer/examples";
import { indexFile } from "../src/composer/tunes";

/* biome-ignore lint/suspicious/noExplicitAny: abcjs objects. */
type Any = any;

const applyChanges = (text: string, changes: Change[]) => {
  let out = text;
  for (const change of [...changes].sort((a, b) => b.from - a.from))
    out = out.slice(0, change.from) + change.insert + out.slice(change.to);
  return out;
};

const BOOK = `%abc-2.1
% A small tune book.
M:4/4

X:7
T:The Swallowtail
K:Em
GEE BEE|

% Between: a note on the next tune.
X:3
T:Àfter the Fair
M:3/4
K:D
DFA|

X:12
T:Banish Misfortune
M:6/8
K:Dmix
fed cAG|
`;

/** abcjs's parse with positions taken out: what is drawn and played. */
function music(text: string) {
  const tunes = (abcjs as Any).parseOnly(text) as Any[];
  return JSON.stringify(
    tunes.map((tune) =>
      tune.lines.map((line: Any) =>
        (line.staff ?? []).map((staff: Any) =>
          staff.voices.map((voice: Any[]) =>
            voice.map((element) => {
              const { startChar: _s, endChar: _e, abselem: _a, ...rest } = element;
              return rest;
            }),
          ),
        ),
      ),
    ),
  );
}

describe("tune-book commands", () => {
  it("renumbers X: 1…n in file order and changes nothing else", () => {
    const text = BOOK.replace("X:3", "X:  3 % third");
    const changes = renumberChanges(text, indexFile(text));
    expect(changes).toHaveLength(3);
    const out = applyChanges(text, changes);
    expect(out.match(/^X:.*$/gm)).toEqual(["X:1", "X:  2 % third", "X:3"]);
    expect(out.replace(/^X:.*$/gm, "")).toBe(text.replace(/^X:.*$/gm, ""));
    expect(renumberChanges(out, indexFile(out))).toEqual([]);
  });
  it("sorts by title, ignoring The, accents and case; the header stays first", () => {
    const change = sortChange(BOOK, indexFile(BOOK), "title");
    const out = applyChanges(BOOK, change ? [change] : []);
    expect(indexFile(out).tunes.map((tune) => tune.title)).toEqual([
      "Àfter the Fair",
      "Banish Misfortune",
      "The Swallowtail",
    ]);
    expect(out.startsWith("%abc-2.1\n% A small tune book.\nM:4/4\n\nX:3\n") === false).toBe(true);
    // The text between two tunes moves with the tune after it.
    expect(out).toContain("% Between: a note on the next tune.\nX:3\nT:Àfter the Fair");
    expect(out.startsWith("%abc-2.1\n% A small tune book.\nM:4/4\n\n% Between")).toBe(true);
    // Every line is kept; only the order changes.
    expect(out.split("\n").sort()).toEqual(BOOK.split("\n").sort());
    expect(titleKey("The Àfter")).toBe("after");
  });
  it("sorts by X: and by key", () => {
    const byNumber = applyChanges(BOOK, [sortChange(BOOK, indexFile(BOOK), "number") as Change]);
    expect(indexFile(byNumber).tunes.map((tune) => tune.number)).toEqual(["3", "7", "12"]);
    const byKey = applyChanges(BOOK, [sortChange(BOOK, indexFile(BOOK), "key") as Change]);
    expect(indexFile(byKey).tunes.map((tune) => tune.key)).toEqual(["D", "Dmix", "Em"]);
    // Already in order: nothing to change.
    expect(sortChange(byNumber, indexFile(byNumber), "number")).toBeNull();
  });
  it("lines up bar lines with spaces only, and the music is the same", () => {
    const tune = `X:1
T:Lined
M:4/4
L:1/8
K:G
|:GABc d2B2|c2A2 B4|AGFE D2D2|G8:|
w:a b c d e f g h i j k l m n o p q r s t u v w x y z
gfed B2B2|cdcB A4|BAGF E2E2|1 D8:|2 D6 z2|]
`;
    const changes = lineUpChanges(tune, indexFile(tune));
    expect(changes.every((change) => change.from === change.to && /^ +$/.test(change.insert))).toBe(
      true,
    );
    const out = applyChanges(tune, changes);
    const lines = out.split("\n");
    const bars = (line: string) => [...line.matchAll(/\|/g)].map((match) => match.index);
    expect(bars(lines[5] as string).slice(1, 4)).toEqual(bars(lines[7] as string).slice(0, 3));
    expect(music(out)).toBe(music(tune));
    // Twice is the same as once.
    expect(lineUpChanges(out, indexFile(out))).toEqual([]);
  });
  it("lines up the voices of a system, and leaves lines with far other bar counts", () => {
    const tune = `X:1
T:Two voices
M:2/4
L:1/8
%%score 1 2
V:1
V:2 clef=bass
K:D
V:1
d2fa|g2e2|fedc|d4|]
V:2
D,4|E,2A,2|D,2A,,2|D,4|]
V:1
d|
`;
    const out = applyChanges(tune, lineUpChanges(tune, indexFile(tune)));
    const lines = out.split("\n");
    const bars = (line: string) => [...line.matchAll(/\|/g)].map((match) => match.index);
    expect(bars(lines[9] as string)).toEqual(bars(lines[11] as string));
    expect(lines[13]).toBe("d|");
    expect(music(out)).toBe(music(tune));
  });
  it("never changes the music of the examples", () => {
    for (const example of EXAMPLES) {
      const out = applyChanges(example.text, lineUpChanges(example.text, indexFile(example.text)));
      expect(music(out), example.title).toBe(music(example.text));
    }
  });
  it("lists each tune's header and first bars as incipits", () => {
    const tunes = `X:1
T:Pickup
M:4/4
L:1/8
K:G
D2|GABc d2B2|c2A2 B4|AGFE D4|
w:la la la la la la la la

X:2
T:Two voices
M:3/4
L:1/4
V:1 clef=bass
V:2
K:F
V:1
F, A, C|D3|E3|F3|]
V:2
f a c'|d'3|e'3|f'3|]
`;
    const out = incipitsText(tunes, indexFile(tunes), 2, "book.abc");
    expect(out).toBe(`% Incipits of book.abc: the first 2 bars of each tune.

X:1
T:Pickup
M:4/4
L:1/8
K:G
D2|GABc d2B2|c2A2 B4|

X:2
T:Two voices
M:3/4
L:1/4
K:F clef=bass
F, A, C|D3|
`);
    expect(incipitsText(tunes, indexFile(tunes), 1, "book.abc")).toContain("K:G\nD2|GABc d2B2|\n");
    const warnings = ((abcjs as Any).parseOnly(out) as Any[]).flatMap(
      (tune) => tune.warnings ?? [],
    );
    expect(warnings).toEqual([]);
  });
  it("duplicates a tune after itself, and starts a new one after it", () => {
    const index = indexFile(BOOK);
    const first = index.tunes[0] as never;
    const copy = applyChanges(BOOK, [duplicateChange(BOOK, index, first)]);
    expect(indexFile(copy).tunes.map((tune) => `${tune.number} ${tune.title}`)).toEqual([
      "7 The Swallowtail",
      "13 The Swallowtail",
      "3 Àfter the Fair",
      "12 Banish Misfortune",
    ]);
    expect(copy).toContain("GEE BEE|\n\nX:13\nT:The Swallowtail\nK:Em\nGEE BEE|\n\n% Between");
    const last = index.tunes[2] as never;
    const change = newTuneAfterChange(BOOK, index, last, newTuneTemplate);
    const added = applyChanges(BOOK, [change]);
    expect(indexFile(added).tunes.map((tune) => tune.number)).toEqual(["7", "3", "12", "13"]);
    expect(added.startsWith(BOOK)).toBe(true);
  });
});
