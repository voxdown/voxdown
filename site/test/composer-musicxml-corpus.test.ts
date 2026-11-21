import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import abcjs from "abcjs";
import { describe, expect, it } from "vitest";
import { checkBars } from "../src/composer/barcheck";
import { readScore } from "../src/composer/musicxml";
import { exportMusicXml } from "../src/composer/musicxml/export";
import { importMusicXml } from "../src/composer/musicxml/import";
import { indexFile } from "../src/composer/tunes";
import { musicOf } from "./musicxml-music";

const DIR = fileURLToPath(new URL("./fixtures/musicxml/lilypond-suite", import.meta.url));
const FILES = readdirSync(DIR)
  .filter((name) => /\.(xml|mxl)$/.test(name))
  .sort();

/** Files whose import does not come out clean, and why (each is said in the import report). */
const NOT_CLEAN: Record<string, string> = {
  "02a-Rests-Durations.xml": "rests down to 1/1024: shorter than abcjs can draw",
  "03a-Rhythm-Durations.xml": "notes up to a maxima and down to 1/1024: beyond abcjs",
  "03d-Rhythm-DottedDurations-Factors.xml": "a 31/8 bar of multi-dotted notes abcjs cannot draw",
  "23b-Tuplets-Styles.xml": "a 17-note tuplet: ABC writes tuplets of up to 9 notes",
  "23d-Tuplets-Nested.xml": "nested tuplets: ABC cannot nest them",
  "46f-IncompleteMeasures.xml": "a measure that does not add up: kept, and flagged as a problem",
  "46i-OverfullMeasures.xml": "overfull measures: kept, and flagged as problems",
};
/** Files whose round trip changes, and why. */
const NOT_ROUND: Record<string, string> = {
  "11h-TimeSignatures-SenzaMisura.xml": "free meter: an empty bar's length is not known",
  "21i-Chord-DifferentVoices.xml": "a chord shared between voices comes back in one voice",
  "71e-TabStaves.xml": "tablature: its spacing rests are re-measured",
};

describe("the unofficial MusicXML test suite", () => {
  it(`imports all ${FILES.length} files without failing`, async () => {
    for (const name of FILES) {
      const result = await readScore(new Uint8Array(readFileSync(`${DIR}/${name}`)));
      expect(result.text, name).toMatch(/^X:1\n/);
    }
  });
  it("draws every other file without warnings, and every bar adds up", async () => {
    const unclean: string[] = [];
    for (const name of FILES) {
      const { text } = await readScore(new Uint8Array(readFileSync(`${DIR}/${name}`)));
      const warnings = (abcjs.parseOnly(text) as unknown as { warnings?: string[] }[]).flatMap(
        (tune) => tune.warnings ?? [],
      );
      const file = indexFile(text);
      const issues = file.tunes.flatMap((tune) => checkBars(text, tune, file));
      if (warnings.length || issues.length) unclean.push(name);
    }
    expect(unclean).toEqual(Object.keys(NOT_CLEAN));
  });
  it("sends every other file round through MusicXML unchanged", async () => {
    const changed: string[] = [];
    for (const name of FILES) {
      const { text } = await readScore(new Uint8Array(readFileSync(`${DIR}/${name}`)));
      for (const tune of abcjs.parseOnly(text) as unknown as never[]) {
        const back = await importMusicXml([exportMusicXml(tune)]);
        const again = abcjs.parseOnly(back.text)[0] as never;
        if (JSON.stringify(musicOf(tune).voices) !== JSON.stringify(musicOf(again).voices)) {
          changed.push(name);
          break;
        }
      }
    }
    expect(changed).toEqual(Object.keys(NOT_ROUND));
  });
});
