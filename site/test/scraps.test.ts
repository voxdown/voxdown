import { describe, expect, it } from "vitest";
import {
  type Keeper,
  type Scrap,
  deletedScraps,
  findDeleted,
  forgetDeleted,
  joinScraps,
  keepDeleted,
  keepScraps,
  markScrapsSaved,
  mergeScraps,
  readScrapsFile,
  scrapsByName,
  scrapsFile,
  scrapsFileName,
  scrapsOf,
  scrapsStanding,
  searchScraps,
} from "../src/writer/scraps";

const at = Date.UTC(2026, 10, 14, 13, 2);
const owl: Scrap = {
  id: "a1",
  text: "The owl said nothing at all.\n\n@Mara “Who’s there?”",
  note: 'For the "ending"?',
  at,
  from: "One",
};
const fox: Scrap = { id: "b2", text: "The fox ran.", note: "", at, from: "", used: at + 1000 };

function keeper(): Keeper {
  const kept = new Map<string, string>();
  return {
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => void kept.set(key, value),
  };
}

describe("scraps", () => {
  it("are kept by story", () => {
    const store = keeper();
    keepScraps(store, "owl", [owl]);
    keepScraps(store, "fox", [fox]);
    expect(scrapsOf(store, "owl")).toEqual([owl]);
    keepScraps(store, "owl", []);
    expect(scrapsOf(store, "owl")).toEqual([]);
    expect(scrapsOf(store, "fox")).toEqual([fox]);
  });

  it("are written beside the story as Markdown, and read back as they were", () => {
    const file = scrapsFile([owl, fox], "The Owl");
    expect(file).toBe(`# Scraps for The Owl

<!-- scrap id="a1" at="2026-11-14T13:02:00.000Z" from="One" note="For the &quot;ending&quot;?" -->
The owl said nothing at all.

@Mara “Who’s there?”

<!-- scrap id="b2" at="2026-11-14T13:02:00.000Z" used="2026-11-14T13:02:01.000Z" -->
The fox ran.
`);
    expect(readScrapsFile(file)).toEqual([owl, fox]);
    expect(readScrapsFile(file.replace(/\n/g, "\r\n"))).toEqual([owl, fox]);
    expect(scrapsFileName("owl.vxd")).toBe("owl.scraps.md");
    expect(scrapsFileName("The Owl.md")).toBe("The Owl.scraps.md");
  });

  it("keep a line of their own that looks like the start of another", () => {
    const { used: _used, ...plain } = fox;
    const odd: Scrap = { ...plain, text: '<!-- scrap id="x" -->\nstill mine' };
    expect(readScrapsFile(scrapsFile([odd], "T"))).toEqual([odd]);
  });

  it("from a file join the ones kept, none twice", () => {
    const { scraps, added } = mergeScraps([owl], [fox, { ...owl }, { ...owl, id: "c3" }]);
    expect(scraps.map((scrap) => scrap.id)).toEqual(["a1", "b2"]);
    expect(added).toBe(1);
  });

  it("are found by their words, notes and place, whatever the case and accents", () => {
    const café = { ...fox, id: "d4", text: "Un café, vite." };
    expect(searchScraps([owl, fox, café], "ENDING").map((s) => s.id)).toEqual(["a1"]);
    expect(searchScraps([owl, fox, café], "cafe").map((s) => s.id)).toEqual(["d4"]);
    expect(searchScraps([owl, fox, café], "one owl").map((s) => s.id)).toEqual(["a1"]);
    expect(searchScraps([owl, fox], "  ")).toHaveLength(2);
  });
});

describe("scraps kept safe", () => {
  it("say whether they are in this browser only, or saved beside the story as they are", () => {
    const store = keeper();
    expect(scrapsStanding(store, "owl", [])).toBe("none");
    keepScraps(store, "owl", [owl], "owl.vxd");
    expect(scrapsStanding(store, "owl", [owl])).toBe("browser");
    markScrapsSaved(store, "owl", [owl]);
    expect(scrapsStanding(store, "owl", [owl])).toBe("saved");
    expect(scrapsStanding(store, "owl", [{ ...owl, note: "changed" }])).toBe("changed");
    // All deleted since they were saved: changed, so the file is emptied too; then none.
    expect(scrapsStanding(store, "owl", [])).toBe("changed");
    markScrapsSaved(store, "owl", []);
    expect(scrapsStanding(store, "owl", [])).toBe("none");
  });

  it("keep those deleted, the latest first, to bring back after a reload", () => {
    const store = keeper();
    keepDeleted(store, "owl", owl, 1000);
    keepDeleted(store, "owl", fox, 2000);
    expect(deletedScraps(store, "owl", 3000).map((each) => each.id)).toEqual([fox.id, owl.id]);
    expect(findDeleted(store, "owl", owl.id)).toEqual(owl);
    forgetDeleted(store, "owl", owl.id);
    expect(deletedScraps(store, "owl", 3000).map((each) => each.id)).toEqual([fox.id]);
    // A month on, gone.
    expect(deletedScraps(store, "owl", 2000 + 31 * 86_400_000)).toEqual([]);
  });

  it("join their file changed outside the Writer, losing nothing", () => {
    const written = [owl, fox];
    const there = [
      { ...owl, text: "The owl said one thing." },
      { ...fox, id: "new", text: "A hare." },
    ];
    const here = [owl, { ...fox, note: "changed here" }];
    const joined = joinScraps(here, there, written);
    expect(joined.scraps.map((each) => each.text)).toEqual([
      "The owl said one thing.",
      fox.text,
      "A hare.",
    ]);
    expect(joined.scraps[1]?.note).toBe("changed here");
    expect(joined.fromThere).toBe(2);
    // Its words changed there, its note here: both kept, in the one scrap.
    const fields = joinScraps(
      [{ ...fox, note: "mine" }],
      [{ ...fox, text: "The fox ran far." }],
      [fox],
    );
    expect(fields.scraps).toEqual([{ ...fox, text: "The fox ran far.", note: "mine" }]);
    expect(fields.fromThere).toBe(1);
    // Its words changed on both sides: both versions kept, the file's beside it.
    const clash = joinScraps(
      [{ ...fox, text: "Here." }],
      [{ ...fox, text: "There." }],
      [fox],
      () => "f1",
    );
    expect(clash.scraps.map((each) => [each.id, each.text, each.note])).toEqual([
      [fox.id, "Here.", ""],
      ["f1", "There.", "From the file"],
    ]);
    // Only its note changed on both sides: one scrap, both notes.
    const notes = joinScraps([{ ...fox, note: "mine" }], [{ ...fox, note: "theirs" }], [fox]);
    expect(notes.scraps).toEqual([{ ...fox, note: "mine / from the file: theirs" }]);
    // Deleted here since: stays deleted, though the file still has it.
    expect(joinScraps([owl], [owl, fox], written).scraps).toEqual([owl]);
  });

  it("are found by the story's file name, when it is opened as another story", () => {
    const store = keeper();
    keepScraps(store, "first", [owl], "owl.vxd");
    keepScraps(store, "other", [fox], "fox.vxd");
    expect(scrapsByName(store, "owl.vxd", "second")).toEqual({ story: "first", scraps: [owl] });
    expect(scrapsByName(store, "owl.vxd", "first")).toBeUndefined();
    expect(scrapsByName(store, "hen.vxd", "second")).toBeUndefined();
  });
});
