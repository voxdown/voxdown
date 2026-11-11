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
    description: "VoxDown stories",
    accept: { "text/markdown": [".vxd", ".md"], "text/plain": [".txt", ".fountain"] },
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
  /** A screenplay turned into a story: it has never been saved as one. */
  imported?: boolean;
};

/** A file's text as a story: a Fountain screenplay is imported, and saved as a new `.vxd`. */
export function asStory(name: string, text: string, handle?: FileSystemFileHandle): Opened {
  if (/\.fountain$/i.test(name)) {
    return { name: name.replace(/\.fountain$/i, ".vxd"), text: fromFountain(text), imported: true };
  }
  return { name, text, ...(handle ? { handle } : {}) };
}

/** Asks for a file to open; undefined if the writer changes their mind. */
export async function pickFile(input: HTMLInputElement): Promise<Opened | undefined> {
  if (keepsFiles && window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: TYPES });
      if (!handle) return undefined;
      const file = await handle.getFile();
      return asStory(file.name, await file.text(), handle);
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
      resolve(file ? asStory(file.name, await file.text()) : undefined);
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
  const file = await handle.getFile();
  return asStory(file.name, await file.text(), handle);
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

/** Writes the story to its file, asking for permission first if the browser wants that. */
export async function writeFile(handle: FileSystemFileHandle, text: string): Promise<void> {
  if (!(await allowed(handle, "readwrite"))) {
    throw new Error(`The browser didn't allow saving to ${handle.name}.`);
  }
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

/** Saves a copy as a download. */
export function download(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function allowed(handle: FileSystemFileHandle, mode: "read" | "readwrite") {
  if (!handle.queryPermission || !handle.requestPermission) return true;
  if ((await handle.queryPermission({ mode })) === "granted") return true;
  return (await handle.requestPermission({ mode })) === "granted";
}

function cancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
