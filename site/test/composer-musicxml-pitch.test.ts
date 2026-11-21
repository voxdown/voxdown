/**
 * Played pitch, not just notation: what Composer's player schedules for an imported score must be
 * what the MusicXML sounds, read straight from the XML; and the same after export and import
 * again. A round trip alone cannot catch errors that cancel out.
 */
import { readFileSync } from "node:fs";
import abcjs from "abcjs";
import { describe, expect, it } from "vitest";
import { exportMusicXml } from "../src/composer/musicxml/export";
import { importMusicXml } from "../src/composer/musicxml/import";
import { drawnOf, playedOf, sameNotes, sorted, soundingOf } from "./musicxml-sound";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/musicxml/${name}.musicxml`, import.meta.url), "utf8");
const imported = async (xml: string) => (await importMusicXml([xml])).text;
const exported = (abc: string) => exportMusicXml(abcjs.parseOnly(abc)[0] as never);

/** Each part's drawn places (abcjs's verticalPos), from the MusicXML. */
const drawnByPart = (xml: string) => {
  const parts: number[][] = [];
  for (const note of soundingOf(xml)) {
    const list = parts[note.part] ?? [];
    list.push(note.drawn as number);
    parts[note.part] = list;
  }
  return parts;
};

describe("played pitch against the MusicXML's sounding pitch", () => {
  for (const name of [
    "octave-instruments",
    "review-satb",
    "review-finale-guitar",
    "review-dorico-winds",
    "mid-bar-changes",
    "sibelius-256",
    "finale-768",
    "twinkle-two-parts",
    "grand-staff-dorico",
    "bar-rests",
  ])
    it(`${name}: plays what it sounds, imported and after export and import again`, async () => {
      const xml = fixture(name);
      const abc = await imported(xml);
      const sounding = soundingOf(xml);
      const check = (notes: { time: number; midi: number }[], what: string) => {
        if (!sameNotes(notes, sounding)) expect(sorted(notes), what).toEqual(sorted(sounding));
      };
      check(playedOf(abc), "played");
      const again = exported(abc);
      check(soundingOf(again), "exported");
      check(playedOf(await imported(again)), "played again");
    });

  it("draws octave instruments where the original does, and plays them where they sound", async () => {
    for (const name of ["octave-instruments", "review-satb", "review-finale-guitar"]) {
      const xml = fixture(name);
      const abc = await imported(xml);
      expect(drawnOf(abc), name).toEqual(drawnByPart(xml));
      // After export and import again, still drawn in the same places.
      expect(drawnOf(await imported(exported(abc))), `${name} again`).toEqual(drawnByPart(xml));
    }
  });

  it("the tenor's middle C, the guitar's D and the piccolo's E: placed and played", async () => {
    const first = async (name: string, part: number) => {
      const xml = fixture(name);
      const abc = await imported(xml);
      const voice = drawnOf(abc)[part] as number[];
      const played = playedOf(abc).filter((note) => note.track === part);
      return { drawn: voice[0], played: played[0]?.midi };
    };
    // Tenor, treble-8 clef, C4 in MusicXML: on the third space (abcjs 7), sounding middle C.
    expect(await first("review-satb", 2)).toEqual({ drawn: 7, played: 60 });
    // Finale's guitar (treble-8 clef and an octave transposition), written D4: just below the
    // staff (abcjs 1), sounding D3.
    expect(await first("review-finale-guitar", 0)).toEqual({ drawn: 1, played: 50 });
    // Piccolo, written E5 with an octave-up transposition: the bottom space... the fourth space
    // (abcjs 9), sounding E6.
    expect(await first("octave-instruments", 2)).toEqual({ drawn: 9, played: 88 });
    // Contrabass, written E3 on the bass staff (abcjs 7), sounding E2.
    expect(await first("octave-instruments", 4)).toEqual({ drawn: 7, played: 40 });
  });
});
