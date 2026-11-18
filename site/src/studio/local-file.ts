import { fountainName, readSource } from "./source";

/** Minimal interfaces also allow deterministic permission/race tests without disk access. */
export interface LocalFileHandle {
  readonly name: string;
  getFile(): Promise<{ readonly size: number; arrayBuffer(): Promise<ArrayBuffer> }>;
  createWritable(options: { keepExistingData: false; mode: "exclusive" }): Promise<{
    write(data: Uint8Array): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }>;
}
export type LocalFilePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<LocalFileHandle>;

export type LocalFileResult =
  | { status: "saved"; filename: string }
  | { status: "cancelled" | "unsupported" | "unlinked" | "busy" }
  | { status: "stale"; mayHaveWritten: boolean }
  | { status: "conflict"; filename: string }
  | {
      status: "error";
      reason: "permission" | "missing" | "locked" | "quota" | "invalid-source" | "io";
      message: string;
      mayHaveWritten: boolean;
    };

function browserPicker(): LocalFilePicker | null {
  if (typeof window === "undefined" || !window.isSecureContext) return null;
  const picker = (window as unknown as { showSaveFilePicker?: LocalFilePicker }).showSaveFilePicker;
  return typeof picker === "function" ? picker.bind(window) : null;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

// Accepted Studio sources fit comfortably within this bound even as UTF-8.
const MAX_FILE_BYTES = 4_000_004;

async function bytes(handle: LocalFileHandle): Promise<Uint8Array> {
  const file = await handle.getFile();
  if (file.size > MAX_FILE_BYTES)
    throw new Error("The selected file is too large to compare safely.");
  const result = new Uint8Array(await file.arrayBuffer());
  if (result.length > MAX_FILE_BYTES)
    throw new Error("The selected file is too large to compare safely.");
  return result;
}

function encode(source: string): Uint8Array {
  readSource(source);
  // TextEncoder replaces unpaired surrogates. Refuse instead of silently changing source.
  const encoded = new TextEncoder().encode(source);
  if (new TextDecoder("utf-8", { ignoreBOM: true }).decode(encoded) !== source)
    throw new Error(
      "This text contains an incomplete Unicode character. Finish composing it before saving.",
    );
  return encoded;
}

/**
 * A session-only file connection. Call disconnect before replacing the document.
 * Invoke saves directly from a user gesture; no permission requests run in the background.
 * Bytes are compared before writing and before close. The OS offers no atomic compare-and-swap:
 * another application can still race the final close, so this is conflict detection, not a lock.
 */
export class LocalFileController {
  private generation = 0;
  private pending = false;
  private connection: { handle: LocalFileHandle; baseline: Uint8Array } | null = null;

  constructor(private readonly picker: LocalFilePicker | null = browserPicker()) {}

  get available(): boolean {
    return this.picker !== null;
  }

  get busy(): boolean {
    return this.pending;
  }

  get filename(): string | null {
    return this.connection?.handle.name ?? null;
  }

  disconnect(): void {
    this.generation += 1;
    this.connection = null;
  }

  saveAs(exactSource: string, suggestedName: string): Promise<LocalFileResult> {
    return this.perform(exactSource, suggestedName);
  }

  save(exactSource: string): Promise<LocalFileResult> {
    return this.perform(exactSource);
  }

  private async perform(source: string, suggestedName?: string): Promise<LocalFileResult> {
    if (this.pending) return { status: "busy" };
    if (!this.picker) return { status: "unsupported" };
    const saveAs = suggestedName !== undefined;
    const linked = this.connection;
    if (!saveAs && !linked) return { status: "unlinked" };
    let encoded: Uint8Array;
    try {
      encoded = encode(source);
    } catch (error) {
      return {
        status: "error",
        reason: "invalid-source",
        message: error instanceof Error ? error.message : "This source cannot be saved safely.",
        mayHaveWritten: false,
      };
    }
    this.pending = true;
    const generation = this.generation;
    const current = () => generation === this.generation;
    let stream: Awaited<ReturnType<LocalFileHandle["createWritable"]>> | undefined;
    let commitStarted = false;
    let complete = false;
    let picking = saveAs;
    try {
      const handle = saveAs
        ? await this.picker({
            suggestedName: fountainName(suggestedName),
            types: [
              { description: "Fountain screenplay", accept: { "text/plain": [".fountain"] } },
            ],
          })
        : linked?.handle;
      picking = false;
      if (!current()) return { status: "stale", mayHaveWritten: false };
      if (!handle) return { status: "unlinked" };
      const baseline = saveAs ? await bytes(handle) : linked?.baseline;
      if (!baseline) return { status: "unlinked" };
      if (!current()) return { status: "stale", mayHaveWritten: false };
      const conflict = async (): Promise<boolean> => !equalBytes(await bytes(handle), baseline);
      const changed = await conflict();
      if (!current()) return { status: "stale", mayHaveWritten: false };
      if (changed) {
        this.connection = null;
        return { status: "conflict", filename: handle.name };
      }
      stream = await handle.createWritable({ keepExistingData: false, mode: "exclusive" });
      if (!current()) return { status: "stale", mayHaveWritten: false };
      await stream.write(encoded);
      if (!current()) return { status: "stale", mayHaveWritten: false };
      const changedWhileWriting = await conflict();
      if (!current()) return { status: "stale", mayHaveWritten: false };
      if (changedWhileWriting) {
        this.connection = null;
        return { status: "conflict", filename: handle.name };
      }
      commitStarted = true;
      await stream.close();
      complete = true;
      if (!current()) return { status: "stale", mayHaveWritten: true };
      this.connection = { handle, baseline: encoded };
      return { status: "saved", filename: handle.name };
    } catch (error) {
      if (!current()) return { status: "stale", mayHaveWritten: commitStarted };
      // A failed close may have committed. Never trust an uncertain baseline on the next save.
      if (commitStarted) this.connection = null;
      const name = error instanceof Error ? error.name : "";
      if (picking && name === "AbortError") return { status: "cancelled" };
      const reason =
        name === "NotAllowedError" ||
        name === "SecurityError" ||
        name === "NoModificationAllowedError"
          ? "permission"
          : name === "NotFoundError"
            ? "missing"
            : name === "InvalidStateError"
              ? "locked"
              : name === "QuotaExceededError"
                ? "quota"
                : "io";
      return {
        status: "error",
        reason,
        message: commitStarted
          ? "The browser did not confirm the file was saved. Check the file, then use Save As."
          : "The file could not be saved. Your screenplay is still in the editor; use Download or Save As.",
        mayHaveWritten: commitStarted,
      };
    } finally {
      if (stream && !complete) {
        try {
          await stream.abort();
        } catch {
          // Preserve the original result; closing/aborting a failed stream may itself reject.
        }
      }
      this.pending = false;
    }
  }
}
