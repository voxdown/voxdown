/**
 * A small zip reader and writer for .mxl files and tune-book exports. Reading follows the
 * central directory and inflates "deflate" entries with the browser's DecompressionStream; writing
 * stores entries uncompressed. Encrypted and zip64 archives are refused with a plain message, and
 * so are archives that would unpack to more than a score could need (a zip bomb): by the sizes the
 * directory gives before anything is unpacked, and by what actually comes out while unpacking.
 */
import { decodeText } from "./text";

/** The most one file inside an .mxl may unpack to, all of them together, and how many there are. */
export const ENTRY_LIMIT = 64 * 1024 * 1024;
export const TOTAL_LIMIT = 128 * 1024 * 1024;
export const ENTRY_COUNT_LIMIT = 1000;
const TOO_LARGE = "This .mxl unpacks to more than 64 MB, too large to open here.";

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

export type ZipEntry = {
  name: string;
  method: number;
  size: number;
  data: () => Promise<Uint8Array>;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export const isZip = (bytes: Uint8Array) =>
  bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4;

/** Inflates a deflate entry, stopping as soon as it passes the limit, whatever its header says. */
async function inflate(bytes: Uint8Array, limit = ENTRY_LIMIT): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined")
    throw new ZipError("This browser cannot unpack compressed .mxl files.");
  const reader = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new ZipError(TOO_LARGE);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ZipError) throw error;
    throw new ZipError("A file inside this .mxl is damaged and cannot be unpacked.");
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** The entries of a zip archive, read from its central directory. */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end of central directory record: the last 22+ bytes, searched backwards past a comment.
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65535); at--)
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  if (end < 0) throw new ZipError("This is not a complete zip archive (.mxl).");
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const offset = view.getUint32(end + 16, true);
  if (count === 0xffff || offset === 0xffffffff || size === 0xffffffff)
    throw new ZipError(
      "This archive uses zip64, which Composer does not read. Save it as plain MusicXML (.musicxml) instead.",
    );
  if (count > ENTRY_COUNT_LIMIT)
    throw new ZipError(
      `This .mxl holds ${count.toLocaleString("en")} files, too many for a score (Composer reads up to ${ENTRY_COUNT_LIMIT.toLocaleString("en")}).`,
    );
  let total = 0;
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let at = offset;
  for (let index = 0; index < count; index++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50)
      throw new ZipError("The archive's directory is damaged.");
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const plain = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (flags & 1)
      throw new ZipError(
        "This archive is encrypted. Save the score without a password and open it again.",
      );
    if (compressed === 0xffffffff || plain === 0xffffffff || local === 0xffffffff)
      throw new ZipError(
        "This archive uses zip64, which Composer does not read. Save it as plain MusicXML (.musicxml) instead.",
      );
    if (method !== 0 && method !== 8)
      throw new ZipError(`"${name}" is packed in a way Composer does not read (method ${method}).`);
    // Refused by the sizes the directory gives, before anything is unpacked.
    total += plain;
    if (plain > ENTRY_LIMIT) throw new ZipError(TOO_LARGE);
    if (total > TOTAL_LIMIT)
      throw new ZipError("This .mxl unpacks to more than 128 MB in all, too large to open here.");
    if (local + 30 > bytes.length) throw new ZipError("The archive's directory is damaged.");
    entries.push({
      name,
      method,
      size: plain,
      data: async () => {
        if (view.getUint32(local, true) !== 0x04034b50)
          throw new ZipError(`"${name}" is damaged in the archive.`);
        const localName = view.getUint16(local + 26, true);
        const localExtra = view.getUint16(local + 28, true);
        const start = local + 30 + localName + localExtra;
        if (start + compressed > bytes.length)
          throw new ZipError(`"${name}" is damaged in the archive.`);
        const raw = bytes.subarray(start, start + compressed);
        if (method === 0 && raw.length > ENTRY_LIMIT) throw new ZipError(TOO_LARGE);
        return method === 0 ? raw : inflate(raw);
      },
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** A zip archive of the given files, stored without compression. */
export function writeZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true); // UTF-8 names
    view.setUint16(8, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, file.data.length, true);
    view.setUint32(22, file.data.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    const record = new Uint8Array(46 + name.length);
    const entry = new DataView(record.buffer);
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, file.data.length, true);
    entry.setUint32(24, file.data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    record.set(name, 46);
    parts.push(local, file.data);
    central.push(record);
    offset += local.length + file.data.length;
  }
  const centralSize = central.reduce((sum, record) => sum + record.length, 0);
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, files.length, true);
  view.setUint16(10, files.length, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let at = 0;
  for (const part of [...parts, ...central, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A name that points outside the archive's own folder: never used (we only look names up). */
const outside = (name: string) => /^[/\\]|^[A-Za-z]:|(^|[/\\])\.\.([/\\]|$)/.test(name);

/**
 * The MusicXML documents inside an .mxl: the root files named in META-INF/container.xml (several
 * for a book of movements), or the first .musicxml/.xml outside META-INF when it is missing.
 * Names with ../ or an absolute path are ignored.
 */
export async function mxlDocuments(bytes: Uint8Array): Promise<{ name: string; text: string }[]> {
  const entries = readZip(bytes);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const container = byName.get("META-INF/container.xml");
  let roots: string[] = [];
  if (container) {
    const text = decodeText(await container.data(), "META-INF/container.xml");
    roots = [...text.matchAll(/<rootfile\b[^>]*\bfull-path\s*=\s*["']([^"']+)["'][^>]*>/g)]
      .filter(
        (match) => !/media-type\s*=\s*["'](?!application\/vnd\.recordare\.musicxml)/.test(match[0]),
      )
      .map((match) => match[1] as string)
      .filter((name) => !outside(name));
  }
  if (!roots.length)
    roots = entries
      .map((entry) => entry.name)
      .filter(
        (name) =>
          !name.startsWith("META-INF/") && !outside(name) && /\.(musicxml|xml)$/i.test(name),
      )
      .slice(0, 1);
  if (!roots.length) throw new ZipError("No MusicXML score was found inside this .mxl file.");
  const documents: { name: string; text: string }[] = [];
  for (const root of roots) {
    const entry = byName.get(root);
    if (!entry) throw new ZipError(`The .mxl names "${root}", but it is not in the archive.`);
    documents.push({ name: root, text: decodeText(await entry.data(), root) });
  }
  return documents;
}
