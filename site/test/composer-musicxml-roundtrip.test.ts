import { readFileSync } from "node:fs";
import abcjs from "abcjs";
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../src/composer/examples";
import { exportMusicXml } from "../src/composer/musicxml/export";
import { importMusicXml } from "../src/composer/musicxml/import";
import { MORE } from "./musicxml-cases";
import { musicOf } from "./musicxml-music";

function roundTrip(text: string) {
  const before = abcjs.parseOnly(text)[0] as never;
  const xml = exportMusicXml(before);
  return { xml, before };
}

describe("round trip: ABC → MusicXML → ABC gives back the same music", () => {
  const cases: [string, () => Promise<string>][] = [
    ...EXAMPLES.map(
      (example) =>
        [`example: ${example.title}`, async () => example.text] as [string, () => Promise<string>],
    ),
    ...MORE.map(([name, text]) => [name, async () => text] as [string, () => Promise<string>]),
    ...[
      "features",
      "grand-staff-dorico",
      "timewise",
      "transposing-and-percussion",
      "twinkle-two-parts",
    ].map(
      (name) =>
        [
          `fixture: ${name}`,
          async () =>
            (
              await importMusicXml([
                readFileSync(`test/fixtures/musicxml/${name}.musicxml`, "utf8"),
              ])
            ).text,
        ] as [string, () => Promise<string>],
    ),
  ];
  for (const [name, text] of cases)
    it(name, async () => {
      const abc = await text();
      const { xml, before } = roundTrip(abc);
      const { text: again } = await importMusicXml([xml]);
      const after = abcjs.parseOnly(again)[0] as never;
      const a = musicOf(before);
      const b = musicOf(after);
      expect(b.voices.length).toBe(a.voices.length);
      b.voices.forEach((voice, index) => {
        const original = a.voices[index] as (typeof a.voices)[number];
        expect(voice.bars, `voice ${index + 1} bars`).toBe(original.bars);
        expect(voice.events, `voice ${index + 1} notes`).toEqual(original.events);
        expect(voice.repeats, `voice ${index + 1} repeats`).toEqual(original.repeats);
        expect(voice.lyrics, `voice ${index + 1} lyrics`).toEqual(original.lyrics);
      });
      expect(b.title).toBe(a.title);
    });
});
