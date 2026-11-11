/**
 * Files on the writer's computer. Where the browser lets a page keep a file (Chrome and Edge), Save
 * writes back to the file that was opened. Elsewhere a file is opened through the usual picker and
 * saved as a download.
 */
import { fromFountain } from "voxdown";

type PickerType = { description: string; accept: Record<string, string[]> };
type PermissionMode = { mode: "read" | "readwrite" };

declare global {
  interface Window {
    showOpenFilePicker?: (options: {
      types?: PickerType[];
      excludeAcceptAllOption?: boolean;
      multiple?: boolean;
    }) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (options: {
      suggestedName?: string;
      types?: PickerType[];
    }) => Promise<FileSystemFileHandle>;
  }
  interface FileSystemHandle {
    queryPermission?: (options: PermissionMode) => Promise<PermissionState>;
    requestPermission?: (options: PermissionMode) => Promise<PermissionState>;
  }
}

const TYPES: PickerType[] = [
  {
    description: "Stories, Word documents and ebooks",
    accept: {
      "text/markdown": [".vxd", ".md"],
      "text/plain": [".txt", ".fountain"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "application/epub+zip": [".epub"],
    },
  },
];
const SAVE_TYPES: PickerType[] = [
  { description: "VoxDown story", accept: { "text/markdown": [".vxd", ".md"] } },
];

/** Whether Save can write back to the file that was opened. */
export const keepsFiles =
  typeof window.showOpenFilePicker === "function" &&
  typeof window.showSaveFilePicker === "function";

export type Opened = {
  name: string;
  text: string;
  /** The file to save back to: none for a screenplay, which opens as a new story. */
  handle?: FileSystemFileHandle;
  /** A screenplay turned into a story, or a file in another encoding: never saved as a story yet. */
  imported?: boolean;
  /** The encoding the file was in, when it wasn't UTF-8: it opens as a new story. */
  encoding?: string;
  /** A Word document or an ebook, opened as a new story. */
  document?: "docx" | "epub";
  /** When the file was last changed on disk, to tell if something else changes it. */
  modified?: number;
};

/**
 * A file's text as a story: a Fountain screenplay is imported, and saved as a new `.vxd`; so is a
 * file that wasn't UTF-8 (`encoding`), read as what it was, so that nothing writes over the
 * original by itself.
 */
export function asStory(
  name: string,
  text: string,
  handle?: FileSystemFileHandle,
  modified?: number,
  encoding = "utf-8",
): Opened {
  if (/\.fountain$/i.test(name)) {
    return { name: name.replace(/\.fountain$/i, ".vxd"), text: fromFountain(text), imported: true };
  }
  if (encoding !== "utf-8")
    return { name: `${name.replace(/\.[^.]*$/, "")}.vxd`, text, imported: true, encoding };
  return {
    name,
    text,
    ...(handle ? { handle } : {}),
    ...(handle && modified !== undefined ? { modified } : {}),
  };
}

/**
 * A file's text as written, a byte order mark included (`file.text()` drops it), and the encoding
 * it was in: UTF-8; UTF-16, by its byte order mark; or else, where the bytes aren't UTF-8, the
 * Western encoding Windows wrote for years (Windows-1252), never read as UTF-8 with its letters
 * lost.
 */
export function decode(bytes: ArrayBuffer): { text: string; encoding: string } {
  const view = new Uint8Array(bytes);
  if (view[0] === 0xff && view[1] === 0xfe)
    return { text: new TextDecoder("utf-16le").decode(view), encoding: "utf-16le" };
  if (view[0] === 0xfe && view[1] === 0xff)
    return { text: new TextDecoder("utf-16be").decode(view), encoding: "utf-16be" };
  try {
    return {
      text: new TextDecoder("utf-8", { ignoreBOM: true, fatal: true }).decode(view),
      encoding: "utf-8",
    };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(view), encoding: "windows-1252" };
  }
}

export async function readFile(file: Blob): Promise<{ text: string; encoding: string }> {
  return decode(await file.arrayBuffer());
}

/** A file's text, as `readFile` reads it. */
export async function readText(file: Blob): Promise<string> {
  return (await readFile(file)).text;
}

/**
 * A file opened as a story: a Word document or an ebook read in as a new one (its converter loaded
 * only then), anything else read as text.
 */
export async function openedFile(file: File, handle?: FileSystemFileHandle): Promise<Opened> {
  const document = /\.(docx|epub)$/i.exec(file.name)?.[1]?.toLowerCase();
  if (document === "docx" || document === "epub") {
    const bytes = await file.arrayBuffer();
    const text =
      document === "docx"
        ? await (await import("./docx")).storyOfDocx(bytes)
        : await (await import("./epub")).storyOfEpub(bytes);
    return {
      name: file.name.replace(/\.(docx|epub)$/i, ".vxd"),
      text,
      imported: true,
      document,
    };
  }
  const { text, encoding } = await readFile(file);
  return asStory(file.name, text, handle, file.lastModified, encoding);
}

/** Asks for a file to open; undefined if the writer changes their mind. */
export async function pickFile(input: HTMLInputElement): Promise<Opened | undefined> {
  if (keepsFiles && window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: TYPES });
      if (!handle) return undefined;
      return openedFile(await handle.getFile(), handle);
    } catch (error) {
      if (cancelled(error)) return undefined;
      throw error;
    }
  }
  return new Promise((resolve) => {
    const chosen = async () => {
      input.removeEventListener("cancel", gone);
      const file = input.files?.[0];
      input.value = "";
      resolve(file ? await openedFile(file) : undefined);
    };
    const gone = () => {
      input.removeEventListener("change", chosen);
      resolve(undefined);
    };
    input.addEventListener("change", chosen, { once: true });
    input.addEventListener("cancel", gone, { once: true });
    input.click();
  });
}

/** Opens a file kept from before, asking to read it again if the browser wants that. */
export async function reopen(handle: FileSystemFileHandle): Promise<Opened> {
  if (!(await allowed(handle, "read"))) throw new Error(`${handle.name} can't be read.`);
  return openedFile(await handle.getFile(), handle);
}

/** The file as it is on disk now, if the browser lets the page read it without asking. */
export async function onDisk(
  handle: FileSystemFileHandle,
): Promise<{ text: string; modified: number } | undefined> {
  try {
    if (handle.queryPermission && (await handle.queryPermission({ mode: "read" })) !== "granted")
      return undefined;
    const file = await handle.getFile();
    return { text: await readText(file), modified: file.lastModified };
  } catch {
    return undefined;
  }
}

/** Asks where to save; undefined if the writer changes their mind. */
export async function pickSaveTarget(name: string): Promise<FileSystemFileHandle | undefined> {
  if (!window.showSaveFilePicker) return undefined;
  try {
    return await window.showSaveFilePicker({ suggestedName: name, types: SAVE_TYPES });
  } catch (error) {
    if (cancelled(error)) return undefined;
    throw error;
  }
}

/**
 * Writes the story to its file, asking for permission first if the browser wants that. Returns when
 * the file was last changed, now.
 */
export async function writeFile(handle: FileSystemFileHandle, text: string): Promise<number> {
  if (!(await allowed(handle, "readwrite"))) {
    throw new Error(`The browser didn't allow saving to ${handle.name}.`);
  }
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
  try {
    return (await handle.getFile()).lastModified;
  } catch {
    return Date.now();
  }
}

/** Saves a copy as a download. */
export function download(text: string | Uint8Array, name: string, type = "text/markdown"): void {
  const url = URL.createObjectURL(
    new Blob([typeof text === "string" ? text : new Uint8Array(text)], { type }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Whether the page may write the file now without asking (the browser asks only on a click). */
export async function mayWriteNow(handle: FileSystemFileHandle): Promise<boolean> {
  try {
    return (
      !handle.queryPermission || (await handle.queryPermission({ mode: "readwrite" })) === "granted"
    );
  } catch {
    return false;
  }
}

export async function allowed(handle: FileSystemFileHandle, mode: "read" | "readwrite") {
  if (!handle.queryPermission || !handle.requestPermission) return true;
  if ((await handle.queryPermission({ mode })) === "granted") return true;
  return (await handle.requestPermission({ mode })) === "granted";
}

function cancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
