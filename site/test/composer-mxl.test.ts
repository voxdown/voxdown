import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readScore } from "../src/composer/musicxml";
import { ZipError, crc32, mxlDocuments, readZip, writeZip } from "../src/composer/musicxml/zip";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/musicxml/${name}`, import.meta.url), "utf8");
const encode = (text: string) => new TextEncoder().encode(text);

describe("zip archives", () => {
  it("writes and reads stored entries, with their CRC", async () => {
    const zip = writeZip([
      { name: "a.txt", data: encode("hello") },
      { name: "dir/b.musicxml", data: encode("<x/>") },
    ]);
    const entries = readZip(zip);
    expect(entries.map((entry) => entry.name)).toEqual(["a.txt", "dir/b.musicxml"]);
    expect(new TextDecoder().decode(await (entries[1] as (typeof entries)[number]).data())).toBe(
      "<x/>",
    );
    expect(crc32(encode("hello"))).toBe(0x3610a686);
  });
  it("inflates deflated entries and follows container.xml to the score", async () => {
    const deflate = async (text: string) => {
      const stream = new Blob([encode(text)])
        .stream()
        .pipeThrough(new CompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    };
    const score = fixture("twinkle-two-parts.musicxml");
    const packed = await deflate(score);
    const zip = writeZip([
      {
        name: "META-INF/container.xml",
        data: encode(
          '<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.xml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>',
        ),
      },
      { name: "score.xml", data: packed },
    ]);
    // Mark the second entry as deflated, with its real size, as a real .mxl would.
    const view = new DataView(zip.buffer);
    const central = view.getUint32(zip.length - 6, true);
    const second = central + 46 + "META-INF/container.xml".length;
    view.setUint16(second + 10, 8, true);
    view.setUint32(second + 24, encode(score).length, true);
    const documents = await mxlDocuments(zip);
    expect(documents).toHaveLength(1);
    expect(documents[0]?.text).toBe(score);
  });
  it("refuses encrypted and zip64 archives plainly", () => {
    const zip = writeZip([{ name: "a.xml", data: encode("<a/>") }]);
    const view = new DataView(zip.buffer);
    const central = view.getUint32(zip.length - 6, true);
    view.setUint16(central + 8, 1, true);
    expect(() => readZip(zip)).toThrow(/encrypted/);
    view.setUint16(central + 8, 0, true);
    view.setUint32(central + 20, 0xffffffff, true);
    expect(() => readZip(zip)).toThrow(/zip64/);
    expect(() => readZip(encode("not a zip at all, just some words"))).toThrow(ZipError);
  });
  it("reads a real deflated .mxl, as MuseScore writes it", async () => {
    const bytes = new Uint8Array(
      readFileSync(new URL("./fixtures/musicxml/twinkle-two-parts.mxl", import.meta.url)),
    );
    const documents = await mxlDocuments(bytes);
    expect(documents.map((document) => document.name)).toEqual(["score.musicxml"]);
    expect(documents[0]?.text).toBe(fixture("twinkle-two-parts.musicxml"));
  });
});

/**
 * A zip whose entries may be deflated and may claim any unpacked size: built with writeZip, then
 * each entry's method and size patched in both its headers.
 */
function zipOf(files: { name: string; data: Uint8Array; deflated?: boolean; claims?: number }[]) {
  const zip = writeZip(
    files.map((file) => ({
      name: file.name,
      data: file.deflated ? new Uint8Array(deflateRawSync(file.data)) : file.data,
    })),
  );
  const view = new DataView(zip.buffer);
  let at = view.getUint32(zip.length - 6, true);
  for (const file of files) {
    const local = view.getUint32(at + 42, true);
    const nameLength = view.getUint16(at + 28, true);
    const size = file.claims ?? file.data.length;
    if (file.deflated) {
      view.setUint16(at + 10, 8, true);
      view.setUint16(local + 8, 8, true);
    }
    view.setUint32(at + 24, size, true);
    view.setUint32(local + 22, size, true);
    at += 46 + nameLength;
  }
  return zip;
}
const container = (...paths: string[]) => ({
  name: "META-INF/container.xml",
  data: encode(
    `<?xml version="1.0"?><container><rootfiles>${paths.map((path) => `<rootfile full-path="${path}" media-type="application/vnd.recordare.musicxml+xml"/>`).join("")}</rootfiles></container>`,
  ),
});
const score = () => ({
  name: "score.xml",
  data: encode(fixture("twinkle-two-parts.musicxml")),
  deflated: true,
});

describe("archives that would unpack to too much", () => {
  it("refuses by the directory's sizes before unpacking anything", () => {
    // An honest bomb: 2 MB that says it unpacks to 2 GB.
    const honest = zipOf([container("score.xml"), { ...score(), claims: 2 * 1024 ** 3 }]);
    const started = performance.now();
    expect(() => readZip(honest)).toThrow(
      "This .mxl unpacks to more than 64 MB, too large to open here.",
    );
    expect(performance.now() - started).toBeLessThan(50);
    // Under 64 MB each, over 128 MB together.
    const many = zipOf([
      container("score.xml"),
      score(),
      ...[1, 2, 3].map((n) => ({
        name: `part${n}.bin`,
        data: encode("x"),
        claims: 50 * 1024 ** 2,
      })),
    ]);
    expect(() => readZip(many)).toThrow(
      "This .mxl unpacks to more than 128 MB in all, too large to open here.",
    );
    // More than 1,000 tiny files.
    const tiny = zipOf(
      Array.from({ length: 1001 }, (_, n) => ({ name: `f${n}.txt`, data: encode("x") })),
    );
    expect(() => readZip(tiny)).toThrow(
      "This .mxl holds 1,001 files, too many for a score (Composer reads up to 1,000).",
    );
  });
  it("stops unpacking at 64 MB whatever the header claims", async () => {
    // A lying header: says 1,000 bytes, unpacks to 80 MB of zeros.
    const bomb = zipOf([
      container("score.xml"),
      { name: "score.xml", data: new Uint8Array(80 * 1024 ** 2), deflated: true, claims: 1000 },
    ]);
    expect(bomb.length).toBeLessThan(200_000);
    const started = performance.now();
    await expect(mxlDocuments(bomb)).rejects.toThrow(
      "This .mxl unpacks to more than 64 MB, too large to open here.",
    );
    expect(performance.now() - started).toBeLessThan(3000);
  });
  it("ignores names with ../ or an absolute path: only container.xml's root file is read", async () => {
    const evil = (name: string) => ({
      name,
      data: encode("<score-partwise><evil/></score-partwise>"),
    });
    const named = zipOf([
      evil("../evil.musicxml"),
      evil("/abs.musicxml"),
      evil("C:/win.musicxml"),
      container("../evil.musicxml", "/abs.musicxml", "score.xml"),
      score(),
    ]);
    expect((await mxlDocuments(named)).map((document) => document.name)).toEqual(["score.xml"]);
    // With no container.xml, the first score that is not outside the archive.
    const bare = zipOf([evil("../evil.musicxml"), evil("/abs.musicxml"), score()]);
    expect((await mxlDocuments(bare)).map((document) => document.name)).toEqual(["score.xml"]);
  });
  it("says so when the text does not decode, and reads a declared encoding", async () => {
    const broken = encode('<?xml version="1.0"?><score-partwise><work><work-title>Caf');
    const bytes = new Uint8Array([
      ...broken,
      0xff,
      0xfe,
      0xc3,
      ...encode("</work-title></work></score-partwise>"),
    ]);
    await expect(readScore(bytes)).rejects.toThrow(
      "This file is not valid UTF-8 text, so it cannot be read. It may be damaged, or not a MusicXML file.",
    );
    // Latin-1, as its XML declaration says: one byte a character.
    const text = `<?xml version="1.0" encoding="ISO-8859-1"?>${fixture("timewise.musicxml")
      .replace(/^<\?xml[^>]*>/, "")
      .replace("<work-title>Timewise", "<work-title>Café")}`;
    const withE = Uint8Array.from(text, (char) => char.charCodeAt(0));
    expect((await readScore(withE)).text).toContain("T:Café");
    await expect(readScore(new Uint8Array(65 * 1024 ** 2))).rejects.toThrow(
      "This file is larger than 64 MB, too large to open here.",
    );
  });
});
