import { readFileSync } from "node:fs";
import abcjs from "abcjs";
import { describe, expect, it } from "vitest";
import { checkBars } from "../src/composer/barcheck";
import {
  MusicXmlError,
  chordSymbol,
  describeReport,
  importMusicXml,
  keyName,
} from "../src/composer/musicxml/import";
import { XmlError, parseXml } from "../src/composer/musicxml/xml";
import { indexFile } from "../src/composer/tunes";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/musicxml/${name}`, import.meta.url), "utf8");
const encode = (text: string) => new TextEncoder().encode(text);

/** Imports and checks that the ABC draws without warnings and every bar adds up. */
async function imported(name: string) {
  const result = await importMusicXml([fixture(name)]);
  const tunes = abcjs.parseOnly(result.text) as unknown as { warnings?: string[] }[];
  for (const tune of tunes) expect(tune.warnings ?? []).toEqual([]);
  const file = indexFile(result.text);
  for (const tune of file.tunes) expect(checkBars(result.text, tune, file)).toEqual([]);
  return result;
}

describe("the XML reader", () => {
  it("reads elements, attributes, text, entities and CDATA, and skips the DOCTYPE", () => {
    const root = parseXml(
      `<?xml version="1.0"?>\n<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD" "http://example.invalid/x.dtd" [ <!ENTITY x "y"> ]>\n<!-- a comment --><a b="1 &amp; 2" c='&quot;'><t>Tom &lt;&#65;&#x42;&gt;</t><![CDATA[<raw>]]><e/></a>`,
    );
    expect(root.name).toBe("a");
    expect(root.attrs).toEqual({ b: "1 & 2", c: '"' });
    expect(root.children.map((each) => each.name)).toEqual(["t", "e"]);
    expect(root.children[0]?.text).toBe("Tom <AB>");
    expect(root.text).toBe("<raw>");
  });
  it("says what is wrong and where", () => {
    expect(() => parseXml("<a>\n<b>\n</a>")).toThrow(XmlError);
    expect(() => parseXml("<a>\n<b>\n</a>")).toThrow(
      /<\/a> found where <\/b> was expected \(line 3\)/,
    );
    expect(() => parseXml("<a>")).toThrow(/<a> is not closed/);
    expect(() => parseXml("just text")).toThrow(XmlError);
  });
});

describe("MusicXML import", () => {
  it("brings in two parts with lyrics, title, composer, lyricist and tempo", async () => {
    const { text, report } = await imported("twinkle-two-parts.musicxml");
    expect(text).toContain("T:Twinkle, Twinkle, Little Star");
    expect(text).toContain("C:Traditional");
    expect(text).toContain("C:Words: Jane Taylor");
    expect(text).toContain("Q:1/4=96");
    expect(text).toContain("%%score 1 2");
    expect(text).toContain('V:1 name="Voice" clef=treble');
    expect(text).toContain('V:2 name="Bass" clef=bass');
    expect(text).toContain("C C | G G | A A | G2 |");
    expect(text).toContain("w:Twin-kle, | twin-kle, | lit-tle | star,");
    expect(text).toContain("D,2 | C,2 | G,,2 | C,2 |]");
    expect(report).toMatchObject({ parts: 2, bars: 8, tunes: 1 });
    expect(describeReport(report)).toBe(
      "Imported “Twinkle, Twinkle, Little Star”: 2 parts, 8 bars. Left out: page layout.",
    );
  });
  it("maps the features: accidentals, beams, slurs, tuplets, grace notes, ties, chords and marks", async () => {
    const { text, report } = await imported("features.musicxml");
    for (const piece of [
      "M:6/8",
      "L:1/8",
      "K:G",
      "!p!d |:",
      '("Am7".=f^fe)',
      '"^dolce"!>!!tenuto!^c2 c',
      '|[1 (3"G/B"!<(!Bcd !<)!!trill!!f!{/a}g3 [GBd] :|[2',
      "!lowermordent!A3- A2 ~=F ||",
      "[K:D] [M:3/4] [K:clef=bass] !marcato!D,2 z2 !fermata!F,2",
      "Z3 |",
      "!D.C.alfine!D,6 |]",
      "w:Oh | hap-py _ day to",
    ])
      expect(text).toContain(piece);
    expect(report.dropped).toEqual([
      { label: "fingerings", count: 1 },
      { label: "pedal marks", count: 1 },
    ]);
  });
  it("splits a grand staff into voices, with %%score, and follows new systems", async () => {
    const { text } = await imported("grand-staff-dorico.musicxml");
    expect(text).toContain("%%score {(1 2) 3}");
    expect(text).toContain("K:Dm");
    expect(text).toMatch(/V:1\nA B c \|\nV:2\nF2 x \|\nV:3\nD,3 \|\nV:1\nd3 \|\]/);
  });
  it("reads timewise scores, common time and several parts", async () => {
    const { text } = await imported("timewise.musicxml");
    expect(text).toContain("M:C");
    expect(text).toMatch(/V:1\ne4 d4 \| c8 \|\]\nV:2\nC,8 \| C,,8 \|\]/);
  });
  it("writes transposing parts at sounding pitch and says so; percussion at display pitch", async () => {
    const { text, report } = await imported("transposing-and-percussion.musicxml");
    expect(text).toMatch(/V:1\nc d \|\]/);
    expect(text).toContain("clef=perc");
    expect(report.notes[0]).toMatch(/Clarinet in B♭.*sounding pitch/);
    expect(report.dropped.map((item) => item.label)).toContain(
      "unpitched notes written at their display pitch",
    );
  });
  it("draws part brackets and braces, a brace inside a bracket, and reports what cannot nest", async () => {
    const group = (number: number, type: string, symbol = "") =>
      `<part-group number="${number}" type="${type}">${symbol ? `<group-symbol>${symbol}</group-symbol>` : ""}</part-group>`;
    const part = (n: number) =>
      `<score-part id="P${n}"><part-name>Part ${n}</part-name></score-part>`;
    const list = [
      group(1, "start", "bracket"),
      part(1),
      group(2, "start", "brace"),
      part(2),
      part(3),
      group(2, "stop"),
      group(1, "stop"),
      group(3, "start", "bracket"),
      part(4),
      group(4, "start", "bracket"),
      part(5),
      part(6),
      group(4, "stop"),
      group(3, "stop"),
    ].join("");
    const music = [1, 2, 3, 4, 5, 6]
      .map(
        (n) =>
          `<part id="P${n}"><measure number="1">${n === 1 ? "<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>" : "<attributes><divisions>1</divisions></attributes>"}<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note></measure></part>`,
      )
      .join("");
    const { text, report } = await importMusicXml([
      `<score-partwise version="4.0"><part-list>${list}</part-list>${music}</score-partwise>`,
    ]);
    expect(text).toContain("%%score [1 {2 3}] [4 5 6]\n");
    expect(report.dropped.map((item) => item.label)).toContain(
      "part brackets and braces ABC cannot nest",
    );
    const staff =
      (
        abcjs.parseOnly(text)[0] as never as {
          lines: { staff: { bracket?: string; brace?: string }[] }[];
        }
      ).lines[0]?.staff ?? [];
    expect(staff.map((each) => `${each.bracket ?? ""}/${each.brace ?? ""}`)).toEqual([
      "start/",
      "continue/start",
      "end/end",
      "start/",
      "continue/",
      "end/",
    ]);
  });
  it("turns several documents into several tunes", async () => {
    const { text, report } = await importMusicXml([
      fixture("timewise.musicxml"),
      fixture("twinkle-two-parts.musicxml"),
    ]);
    expect(text).toMatch(/^X:1\nT:Timewise/);
    expect(text).toContain("\nX:2\nT:Twinkle");
    expect(report.tunes).toBe(2);
  });
  it("gives a plain error for malformed or foreign files, never a draft", async () => {
    await expect(importMusicXml([fixture("malformed.musicxml")])).rejects.toThrow(MusicXmlError);
    await expect(importMusicXml([fixture("malformed.musicxml")])).rejects.toThrow(
      /not well-formed XML.*<\/score-partwise> found where <\/part> was expected/,
    );
    await expect(importMusicXml(["<html></html>"])).rejects.toThrow(/not a MusicXML score/);
    await expect(importMusicXml(['<opus version="4.0"/>'])).rejects.toThrow(/opus/);
  });
  it("names keys and chord symbols the ABC way", () => {
    expect(keyName(0)).toBe("C");
    expect(keyName(-3, "minor")).toBe("Cm");
    expect(keyName(1, "dorian")).toBe("ADor");
    expect(keyName(-2, "mixolydian")).toBe("FMix");
    const harmony = (body: string) => chordSymbol(parseXml(`<harmony>${body}</harmony>`));
    expect(harmony("<root><root-step>A</root-step></root><kind>minor-seventh</kind>")).toBe("Am7");
    expect(
      harmony(
        "<root><root-step>F</root-step><root-alter>1</root-alter></root><kind>half-diminished</kind>",
      ),
    ).toBe("F#m7b5");
    expect(
      harmony(
        "<root><root-step>G</root-step></root><kind>major</kind><bass><bass-step>B</bass-step></bass>",
      ),
    ).toBe("G/B");
    expect(
      harmony(
        "<root><root-step>C</root-step></root><kind>dominant</kind><degree><degree-value>9</degree-value><degree-alter>-1</degree-alter><degree-type>add</degree-type></degree>",
      ),
    ).toBe("C7addb9");
  });
});
