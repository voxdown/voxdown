/**
 * MusicXML in and out, loaded the first time it is used: never part of the first view.
 */
import { type ImportResult, importMusicXml } from "./import";
import { DOCUMENT_LIMIT, MusicXmlError, decodeText } from "./text";
import { isZip, mxlDocuments } from "./zip";

export { describeReport, type ImportReport, type ImportResult } from "./import";
export { MusicXmlError } from "./text";
export { ZipError, writeZip } from "./zip";
export { exportMusicXml } from "./export";

/** Reads a .musicxml, .xml or .mxl file into ABC text and a report. */
export async function readScore(
  bytes: Uint8Array,
  progress: (done: number, total: number) => void = () => {},
): Promise<ImportResult> {
  if (!isZip(bytes) && bytes.length > DOCUMENT_LIMIT)
    throw new MusicXmlError("This file is larger than 64 MB, too large to open here.");
  const documents = isZip(bytes)
    ? (await mxlDocuments(bytes)).map((document) => document.text)
    : [decodeText(bytes)];
  return importMusicXml(documents, progress);
}
