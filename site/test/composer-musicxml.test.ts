import { readFileSync } from "node:fs";
import abcjs from "abcjs";
import { describe, expect, it } from "vitest";
import { checkBars } from "../src/composer/barcheck";
import { harmonyXml } from "../src/composer/musicxml/export";
import {
  MusicXmlError,
  chordSymbol,
  describeReport,
  importMusicXml,
  keyName,
} from "../src/composer/musicxml/import";
import { XmlError, parseXml } from "../src/composer/musicxml/xml";
import { indexFile } from "../src/composer/tunes";

/** A one-part score: measures of notes, with divisions and the first attributes. */
const score = (
  measures: string[],
  divisions: number,
  attributes = "<time><beats>4</beats><beat-type>4</beat-type></time>",
) =>
  `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name></part-name></score-part></part-list><part id="P1">${measures
    .map(
      (measure, index) =>
        `<measure number="${index + 1}">${index === 0 ? `<attributes><divisions>${divisions}</divisions>${attributes}</attributes>` : ""}${measure}</measure>`,
    )
    .join("")}</part></score-partwise>`;
/** A note: pitch, duration, then alter, type (quarter by default) and anything after the type. */
const note = (
  step: string,
  octave: number,
  duration: number,
  alter = "",
  type = "quarter",
  after = "",
) =>
  `<note><pitch><step>${step.toUpperCase()}</step>${alter}<octave>${octave}</octave></pitch><duration>${duration}</duration><type>${type}</type>${after}</note>`;
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
      /<\/a> found where <\/b> was expected \(line 3, column 1\)/,
    );
    expect(() => parseXml("<a>")).toThrow(/<a> is not closed/);
    expect(() => parseXml("just text")).toThrow(XmlError);
  });
  it("gives every error a line and column: bad character references, entities, limits", () => {
    const error = (source: string, limits?: { length: number; elements: number }) => {
      try {
        parseXml(source, limits);
      } catch (caught) {
        return caught;
      }
      return null;
    };
    // The reviewer's file: &#x110000; is past Unicode. A RangeError before; now an XmlError.
    const bad = error(fixture("review-bad-charref.musicxml")) as XmlError;
    expect(bad).toBeInstanceOf(XmlError);
    expect(bad.message).toBe("&#x110000; is not a character XML allows (line 1, column 74)");
    expect(bad.line).toBe(1);
    expect(bad.column).toBe(74);
    for (const reference of ["&#0;", "&#xD800;", "&#xFFFE;", "&#1114112;"])
      expect(error(`<a>\n  x${reference}</a>`), reference).toBeInstanceOf(XmlError);
    expect((error('<a b="1 &#x0; 2"/>') as XmlError).message).toBe(
      "&#x0; is not a character XML allows (line 1, column 9)",
    );
    // A DTD's entities are never expanded (the reviewer's billion laughs).
    expect((error(fixture("review-billion-laughs.musicxml")) as XmlError).message).toMatch(
      /^&lol9; is an entity Composer does not expand .* \(line \d+, column \d+\)$/,
    );
    // Too long, or too many elements.
    expect((error("<a></a>", { length: 4, elements: 10 }) as XmlError).message).toBe(
      "The document is larger than 0 MB, too large to open here (line 1, column 1)",
    );
    expect((error("<a><b/><b/><b/></a>", { length: 100, elements: 3 }) as XmlError).message).toBe(
      "The document has more than 3 elements, too many to open here (line 1, column 12)",
    );
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
      "[M:3/4] [K:D] [K:clef=bass] !marcato!D,2 z2 !fermata!F,2",
      "z6 | z6 | z6 | !D.C.alfine!D,6 |]",
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
  it("takes lengths from the note type, so rounded tuplets (Sibelius 256, Finale 768) come out exact", async () => {
    for (const name of ["sibelius-256.musicxml", "finale-768.musicxml"]) {
      const { text, report } = await imported(name);
      expect(text, name).toContain(
        "(3c2d2e2 (5:4:5f e d c B (7:4:7c d e f g a b c'3 b | (3G2 A2- A2- A4 B6 c2 | (3d4 e4 f4 g7 a |]",
      );
      expect(report.notes.join(" "), name).not.toMatch(/rounded/);
    }
    // The reviewer's file: types win over durations that do not add up.
    const { text } = await imported("review-sibelius-rounded.musicxml");
    expect(text).toContain("(3c2 d2 e2 f4 g8 | (7:4:7g f e d c B A G4 c8 |]");
    // A note with no type goes by its duration, rounded to a note value abcjs draws.
    const { text: untyped, report } = await importMusicXml([
      score(
        [
          "<note><pitch><step>C</step><octave>5</octave></pitch><duration>85</duration></note><note><pitch><step>D</step><octave>5</octave></pitch><duration>939</duration></note>",
        ],
        256,
      ),
    ]);
    expect(untyped).toContain("c3/4 d7 |]");
    expect(report.notes).toContain(
      "2 notes without a written note type had their lengths rounded to the nearest note value.",
    );
  });
  it("writes clef, key, time and transposition changes where they happen in the bar", async () => {
    const { text, report } = await imported("mid-bar-changes.musicxml");
    expect(text).toContain(
      "c d [K:clef=bass] C, D, | E, [K:D] =F, =C, [K:clef=treble] =f | [M:3/4] g a b |]",
    );
    // Clarinet in B♭, then in A from bar 3: both at sounding pitch, the key unchanged.
    expect(text).toContain('c d e f | g f e d | "^To Cl. in A"c d e |]');
    expect(report.notes).toContain(
      "Clarinet changes instrument transposition in bar 3; the notes after it are written at their new sounding pitch.",
    );
    // A key change in the middle of bar 1, and a time signature given twice at its start.
    const { text: first } = await importMusicXml([
      score(
        [
          `${note("C", 5, 1)}${note("D", 5, 1)}<attributes><key><fifths>-1</fifths></key></attributes>${note("B", 4, 1, "<alter>-1</alter>")}${note("A", 4, 1)}`,
        ],
        1,
        "<time><beats>4</beats><beat-type>4</beat-type></time></attributes><attributes><time><beats>2</beats><beat-type>2</beat-type></time>",
      ),
    ]);
    expect(first).toContain("M:2/2\n");
    expect(first).toContain("c d [K:F] B A |]");
  });
  it("writes a lone whole-bar rest as a rest of the bar's length, and Zn only for several", async () => {
    const { text, report } = await imported("bar-rests.musicxml");
    expect(text).toContain("c d e f | z4 | [M:3/4] z3 | z3 |\nV:1\nz3 | g f e |]");
    expect(report.notes).toContain(
      "Multi-bar rests in a meter other than the tune's first are written bar by bar, as abcjs would time them by the first meter.",
    );
    const { text: four } = await importMusicXml([
      score(
        [
          '<attributes><measure-style><multiple-rest>2</multiple-rest></measure-style></attributes><note><rest measure="yes"/><duration>4</duration></note>',
          '<note><rest measure="yes"/><duration>4</duration></note>',
          note("C", 5, 4, "", "whole"),
        ],
        1,
      ),
    ]);
    expect(four).toContain("Z2 | c8 |]");
  });
  it("keeps every text on its line: line breaks, % and quotes", async () => {
    const { text } = await imported("awkward-text.musicxml");
    expect(text.match(/^X:/gm)).toEqual(["X:"]);
    expect(text).toContain(
      "T:The Title T:Not a field X:9\nT:Second movement\nT:A 100\\% traditional air\nC:Trad. X:2\nC:Words: Words by \\%anon\n",
    );
    expect(text).toContain('V:1 name="Voice \\%\\%score" clef=treble');
    expect(text).toContain(`"^50\\% slower 'rit.'"c4 d4 |]\nw:100\\% sure`);
    const injected = await imported("review-injection.musicxml");
    expect(injected.text.match(/^X:/gm)).toEqual(["X:"]);
    expect(injected.text).toContain("w:a\\|b\\-c\\_d\\%e");
  });
  it("says in Good to know what playback and drawing do differently", async () => {
    const { report } = await imported("review-dorico-winds.musicxml");
    expect(report.notes).toEqual([
      "D.C., D.S., Fine, segno and coda marks are drawn; playback plays the music as written, without those jumps (repeats and endings are played).",
      "“To Coda” is written as text over the staff; playback does not jump to the coda.",
      "Transposing parts (Clarinet in B♭, Horn in F) are written at sounding pitch, as in a concert score.",
    ]);
    const { report: octaves } = await imported("octave-instruments.musicxml");
    expect(octaves.notes).toContain(
      "Parts written an octave from where they sound (Tenor, Guitar, Piccolo, Piccolo (8va clef), Contrabass, Contrabass (8vb clef)) keep their written octave: an octave clef, or transpose= on the voice, plays them at sounding pitch.",
    );
    // A cross-staff note, and a chord kind with no symbol of its own.
    const piano = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><harmony><root><root-step>D</root-step><root-alter>-1</root-alter></root><kind>Neapolitan</kind></harmony><note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note><note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>2</staff></note></measure></part></score-partwise>`;
    const { report: cross } = await importMusicXml([piano]);
    expect(cross.notes).toContain(
      "1 note written on the other staff of a grand staff is drawn on its voice's own staff.",
    );
    expect(cross.notes).toContain("Neapolitan chords are written as Db.");
  });
  it("chooses the unit that reads plainly, and writes dotted pairs as broken rhythm", async () => {
    // A hornpipe's dotted pairs: L:1/8 and B>G.
    const dotted = (step: string, octave: number) =>
      `${note(step, octave, 3, "", "eighth", "<dot/>")}${note(step === "B" ? "G" : "A", octave, 1, "", "16th")}`;
    const { text: hornpipe } = await importMusicXml([
      score([dotted("B", 4) + dotted("c", 5) + dotted("B", 4) + note("A", 4, 4, "", "quarter")], 4),
    ]);
    expect(hornpipe).toContain("L:1/8\n");
    expect(hornpipe).toContain("B>G c>a B>G A2 |]");
    // A hymn of quarters and halves: L:1/4.
    const { text: hymn } = await importMusicXml([
      score([note("G", 4, 1) + note("A", 4, 1) + note("B", 4, 2, "", "half")], 1),
    ]);
    expect(hymn).toContain("L:1/4\n");
    expect(hymn).toContain("G A B2 |]");
  });
  it("imports the reviewer's MuseScore, Dorico, Finale and Sibelius files cleanly", async () => {
    for (const name of [
      "review-musescore-song",
      "review-dorico-winds",
      "review-finale-guitar",
      "review-sibelius-rounded",
      "review-satb",
      "review-injection",
      "octave-instruments",
      "sibelius-256",
      "finale-768",
      "mid-bar-changes",
      "bar-rests",
      "awkward-text",
    ])
      await imported(`${name}.musicxml`);
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
  });
  it("spells chord kinds as lead sheets do, and exports them back to the same kinds", () => {
    const harmony = (body: string) => chordSymbol(parseXml(`<harmony>${body}</harmony>`));
    const degree = ([value, alter, type]: [number, number, string]) =>
      `<degree><degree-value>${value}</degree-value><degree-alter>${alter}</degree-alter><degree-type>${type}</degree-type></degree>`;
    const cases: [string, [number, number, string][], string][] = [
      ["major", [], "C"],
      ["minor", [], "Cm"],
      ["dominant", [], "C7"],
      ["major-seventh", [], "Cmaj7"],
      ["minor-seventh", [], "Cm7"],
      ["diminished", [], "Cdim"],
      ["diminished-seventh", [], "Cdim7"],
      ["half-diminished", [], "Cm7b5"],
      ["augmented", [], "Caug"],
      ["major-sixth", [], "C6"],
      ["minor-sixth", [], "Cm6"],
      ["dominant-ninth", [], "C9"],
      ["dominant-13th", [], "C13"],
      ["major-minor", [], "Cm(maj7)"],
      ["suspended-fourth", [], "Csus4"],
      ["suspended-second", [], "Csus2"],
      ["dominant", [[9, -1, "add"]], "C7b9"],
      ["dominant", [[9, 1, "add"]], "C7#9"],
      ["dominant", [[11, 1, "add"]], "C7#11"],
      ["dominant", [[5, -1, "alter"]], "C7b5"],
      ["dominant", [[13, -1, "add"]], "C7b13"],
      ["suspended-fourth", [[7, 0, "add"]], "C7sus4"],
      ["major-sixth", [[9, 0, "add"]], "C6/9"],
      ["minor-sixth", [[9, 0, "add"]], "Cm6/9"],
      ["major", [[9, 0, "add"]], "Cadd9"],
      ["major-seventh", [[11, 1, "add"]], "Cmaj7#11"],
      ["dominant", [[3, 0, "subtract"]], "C7no3"],
    ];
    for (const [kind, degrees, name] of cases) {
      const xml = `<root><root-step>C</root-step></root><kind>${kind}</kind>${degrees.map(degree).join("")}`;
      expect(harmony(xml), kind).toBe(name);
      const back = harmonyXml(name) as string;
      expect(chordSymbol(parseXml(back)), `${name} exported`).toBe(name);
    }
    expect(
      harmony(
        "<root><root-step>B</root-step><root-alter>-1</root-alter></root><kind>dominant</kind><bass><bass-step>D</bass-step></bass>",
      ),
    ).toBe("Bb7/D");
  });
});
