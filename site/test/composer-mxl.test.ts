import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ZipError, crc32, mxlDocuments, readZip, writeZip } from "../src/composer/musicxml/zip";

const fixture = (name: string) => readFileSync(`test/fixtures/musicxml/${name}`, "utf8");
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
    const bytes = new Uint8Array(readFileSync("test/fixtures/musicxml/twinkle-two-parts.mxl"));
    const documents = await mxlDocuments(bytes);
    expect(documents.map((document) => document.name)).toEqual(["score.musicxml"]);
    expect(documents[0]?.text).toBe(fixture("twinkle-two-parts.musicxml"));
  });
});
