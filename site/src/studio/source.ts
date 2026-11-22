import { filenameStem } from "./filename";
/** Saving uses original source, never reconstructed parser elements. */
export const MAX_SOURCE = 500_000;
export const MAX_LINES = 20_000;
export type SourceFile = {
  original: string;
  normalized: string;
  newline: string;
  bom: boolean;
  mixed: boolean;
};
export function readSource(original: string): SourceFile {
  if (original.length > MAX_SOURCE * 2 + 1)
    throw new Error(
      "This experimental Studio supports up to 500,000 characters per screenplay. Open a smaller file or split it into acts.",
    );
  if (original.includes("\0"))
    throw new Error("This looks like a binary file. Open a UTF-8 .fountain or .txt file.");
  const bom = original.startsWith("\uFEFF");
  const body = bom ? original.slice(1) : original;
  const normalized = body.replace(/\r\n?|\n/g, "\n");
  if (normalized.length > MAX_SOURCE)
    throw new Error(
      "This experimental Studio supports up to 500,000 characters per screenplay. Open a smaller file or split it into acts.",
    );
  if (normalized.split("\n").length > MAX_LINES)
    throw new Error(
      "This experimental Studio supports up to 20,000 lines per screenplay. Split this file into smaller parts.",
    );
  const endings = body.match(/\r\n|\r|\n/g) ?? [];
  return {
    original,
    normalized,
    newline: endings[0] ?? "\n",
    bom,
    mixed: new Set(endings).size > 1,
  };
}
export function writeSource(file: SourceFile, text: string): string {
  if (text === file.normalized) return file.original;
  return `${file.bom ? "\uFEFF" : ""}${text.replace(/\n/g, file.newline)}`;
}
export function fountainName(name: string): string {
  return `${filenameStem(name)}.fountain`;
}

/** UTF-8 cannot represent lone UTF-16 surrogates. Refuse a lossy text-file copy. */
export function encodeUtf8Losslessly(text: string): Uint8Array<ArrayBuffer> {
  const bytes = new TextEncoder().encode(text);
  if (new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes) !== text)
    throw new Error(
      "This text contains an incomplete Unicode character. Finish composing or correct it before saving a text file. A Studio backup preserves the current text.",
    );
  return bytes;
}
