/**
 * Bytes to text for MusicXML: a byte-order mark, else the encoding the XML declaration names, else
 * UTF-8. Text that does not decode is an error said plainly, never an empty document.
 */

export class MusicXmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MusicXmlError";
  }
}

/** The largest MusicXML document Composer opens (64 MB). */
export const DOCUMENT_LIMIT = 64 * 1024 * 1024;

/** The encoding named in an XML declaration (<?xml … encoding="…"?>), if any. */
function declared(bytes: Uint8Array): string | null {
  let head = "";
  for (let at = 0; at < Math.min(bytes.length, 200); at++)
    head += String.fromCharCode(bytes[at] as number);
  return /^<\?xml[^>]*\bencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head)?.[1] ?? null;
}

export function decodeText(bytes: Uint8Array, name = "This file"): string {
  let label = "utf-8";
  let start = 0;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) label = "utf-16le";
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) label = "utf-16be";
  else {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
    label = declared(bytes.subarray(start))?.toLowerCase() ?? "utf-8";
  }
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(label, { fatal: true });
  } catch {
    throw new MusicXmlError(
      `${name} is written in an encoding Composer cannot read (${label}). Save it as UTF-8 MusicXML.`,
    );
  }
  try {
    return decoder.decode(bytes.subarray(start));
  } catch {
    throw new MusicXmlError(
      `${name} is not valid ${label.toUpperCase()} text, so it cannot be read. It may be damaged, or not a MusicXML file.`,
    );
  }
}
