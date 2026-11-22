/**
 * A file's text exactly as it was. The editor works on text with "\n" line ends; saving an
 * unchanged file writes the original bytes, and a changed one keeps its BOM, line ends and
 * encoding. ABC 2.1 files are UTF-8 by default; older Latin-1 files reopen and save as Latin-1.
 */
import { PlainError } from "./plain";
export type SourceFile = {
  original: string;
  normalized: string;
  newline: string;
  bom: boolean;
  encoding: "utf-8" | "windows-1252";
};

export const MAX_SOURCE = 2_000_000;

export function readText(original: string, encoding: SourceFile["encoding"] = "utf-8"): SourceFile {
  if (original.length > MAX_SOURCE)
    throw new PlainError(
      "This file is larger than Composer can edit (2 million characters). Split it into smaller files.",
    );
  if (original.includes("\0"))
    throw new PlainError("This looks like a binary file. Open a UTF-8 .abc or .txt file.");
  const bom = original.startsWith("\uFEFF");
  const body = bom ? original.slice(1) : original;
  const endings = body.match(/\r\n|\r|\n/g) ?? [];
  return {
    original,
    normalized: body.replace(/\r\n?/g, "\n"),
    newline: endings[0] ?? "\n",
    bom,
    encoding,
  };
}

/** Bytes to text: UTF-8 when valid, otherwise Windows-1252 (the browser's Latin-1). */
export function readBytes(bytes: Uint8Array): SourceFile {
  try {
    return readText(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
      "utf-8",
    );
  } catch (error) {
    if (error instanceof TypeError)
      return readText(new TextDecoder("windows-1252").decode(bytes), "windows-1252");
    throw error;
  }
}

export function writeText(file: SourceFile, text: string): string {
  if (text === file.normalized) return file.original;
  return `${file.bom ? "\uFEFF" : ""}${text.replace(/\n/g, file.newline)}`;
}

let reverse1252: Map<string, number> | null = null;
function encode1252(text: string): Uint8Array | null {
  if (!reverse1252) {
    reverse1252 = new Map();
    const decoder = new TextDecoder("windows-1252");
    for (let byte = 0; byte < 256; byte++)
      reverse1252.set(decoder.decode(new Uint8Array([byte])), byte);
  }
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) {
    const byte = reverse1252.get(text[index] as string);
    if (byte === undefined) return null;
    out[index] = byte;
  }
  return out;
}

/** The bytes to save, and whether a Latin-1 file had to become UTF-8. */
export function encodeText(
  file: SourceFile,
  text: string,
): { bytes: Uint8Array<ArrayBuffer>; upgraded: boolean } {
  const output = writeText(file, text);
  if (file.encoding === "windows-1252") {
    const bytes = encode1252(output);
    if (bytes) return { bytes: bytes as Uint8Array<ArrayBuffer>, upgraded: false };
  }
  const bytes = new TextEncoder().encode(output);
  if (new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes) !== output)
    throw new PlainError(
      "This text contains an incomplete Unicode character. Correct it before saving.",
    );
  return { bytes, upgraded: file.encoding === "windows-1252" };
}

/** A safe file name ending in .abc. */
export function abcName(value: string): string {
  const cleaned = [...value]
    .map((char) =>
      char.charCodeAt(0) < 32
        ? " "
        : /[<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/.test(char)
          ? "-"
          : char,
    )
    .join("")
    // One line, and no runs of dashes where several unsafe characters stood.
    .replace(/\s+/g, " ")
    .replace(/-+( ?-+)*/g, "-")
    .replace(/\.(?:abc|txt)$/i, "")
    .replace(/^[. -]+|[. -]+$/g, "")
    .slice(0, 120);
  return `${cleaned || "Untitled"}.abc`;
}

export function newSource(text: string): SourceFile {
  return { original: text, normalized: text, newline: "\n", bom: false, encoding: "utf-8" };
}
