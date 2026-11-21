/**
 * MusicXML in and out, loaded the first time it is used: never part of the first view.
 */
import { type ImportResult, importMusicXml } from "./import";
import { isZip, mxlDocuments } from "./zip";

export { MusicXmlError, describeReport, type ImportReport, type ImportResult } from "./import";
export { ZipError, writeZip } from "./zip";

/** Text from bytes: UTF-8, or UTF-16 when it starts with a byte-order mark. */
function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  return new TextDecoder().decode(bytes);
}

/** Reads a .musicxml, .xml or .mxl file into ABC text and a report. */
export async function readScore(
  bytes: Uint8Array,
  progress: (done: number, total: number) => void = () => {},
): Promise<ImportResult> {
  const documents = isZip(bytes)
    ? (await mxlDocuments(bytes)).map((document) => document.text)
    : [decodeText(bytes)];
  return importMusicXml(documents, progress);
}
