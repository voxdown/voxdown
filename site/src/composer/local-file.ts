/**
 * Saving to a file on disk where the browser allows it (File System Access), adapted from
 * Studio's controller: bytes on disk are compared with what was opened before writing, so a file
 * changed by another program is never silently overwritten.
 */
type Writable = {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
};
export type FileHandleLike = {
  readonly name: string;
  getFile(): Promise<{ readonly size: number; arrayBuffer(): Promise<ArrayBuffer> }>;
  createWritable(options?: { keepExistingData?: boolean }): Promise<Writable>;
};
type SavePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileHandleLike>;
type OpenPicker = (options: {
  multiple?: boolean;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileHandleLike[]>;

export type SaveResult =
  | { status: "saved"; name: string }
  | { status: "cancelled" | "unsupported" | "busy" }
  | { status: "conflict"; name: string }
  | { status: "error"; message: string };

const TYPES = [{ description: "ABC music", accept: { "text/plain": [".abc", ".txt"] } }];

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false;
  return true;
}

export class LocalFiles {
  private handle: FileHandleLike | null = null;
  private baseline: Uint8Array | null = null;
  private pending = false;

  constructor(
    private readonly savePicker: SavePicker | null = typeof window !== "undefined" &&
    window.isSecureContext &&
    "showSaveFilePicker" in window
      ? ((window as unknown as { showSaveFilePicker: SavePicker }).showSaveFilePicker.bind(
          window,
        ) as SavePicker)
      : null,
    private readonly openPicker: OpenPicker | null = typeof window !== "undefined" &&
    window.isSecureContext &&
    "showOpenFilePicker" in window
      ? ((window as unknown as { showOpenFilePicker: OpenPicker }).showOpenFilePicker.bind(
          window,
        ) as OpenPicker)
      : null,
  ) {}

  get canSave(): boolean {
    return this.savePicker !== null;
  }
  get canOpen(): boolean {
    return this.openPicker !== null;
  }
  get linked(): string | null {
    return this.handle?.name ?? null;
  }

  disconnect() {
    this.handle = null;
    this.baseline = null;
  }

  connect(handle: FileHandleLike, bytes: Uint8Array) {
    this.handle = handle;
    this.baseline = bytes;
  }

  /** Asks for a file to open; null when cancelled or unsupported. */
  async pick(): Promise<{ handle: FileHandleLike; bytes: Uint8Array; name: string } | null> {
    if (!this.openPicker) return null;
    try {
      const [handle] = await this.openPicker({ multiple: false, types: TYPES });
      if (!handle) return null;
      const file = await handle.getFile();
      return { handle, bytes: new Uint8Array(await file.arrayBuffer()), name: handle.name };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return null;
      throw error;
    }
  }

  async save(bytes: Uint8Array, suggestedName: string, saveAs = false): Promise<SaveResult> {
    if (this.pending) return { status: "busy" };
    if (!this.savePicker) return { status: "unsupported" };
    this.pending = true;
    let stream: Writable | null = null;
    try {
      let handle = saveAs ? null : this.handle;
      let baseline = saveAs ? null : this.baseline;
      if (!handle) {
        try {
          handle = await this.savePicker({ suggestedName, types: TYPES });
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") return { status: "cancelled" };
          throw error;
        }
      } else if (baseline) {
        const current = new Uint8Array(await (await handle.getFile()).arrayBuffer());
        if (!equal(current, baseline)) return { status: "conflict", name: handle.name };
      }
      stream = await handle.createWritable({ keepExistingData: false });
      await stream.write(bytes);
      await stream.close();
      stream = null;
      this.handle = handle;
      this.baseline = bytes;
      baseline = bytes;
      return { status: "saved", name: handle.name };
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      return {
        status: "error",
        message:
          name === "NotAllowedError" || name === "SecurityError"
            ? "The browser did not allow saving to that file. Use Save as or Download."
            : "The file could not be saved. Your music is still here; use Save as or Download.",
      };
    } finally {
      if (stream) {
        try {
          await stream.abort();
        } catch {
          /* Keep the first error. */
        }
      }
      this.pending = false;
    }
  }
}

/** Downloads bytes as a file, for browsers without file access. */
export function download(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
