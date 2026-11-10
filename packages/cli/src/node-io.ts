/** The command's `io` on a real disk and the process's own streams. */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Io } from "./run";

/**
 * UTF-8 only: a file in another encoding fails rather than comes back with replacement characters
 * that `fmt` would then write over it. A byte order mark is kept, so it is written back.
 */
function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}

export function nodeIo(overrides: Partial<Io> = {}): Io {
  return {
    cwd: process.cwd(),
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
    readStdin: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Uint8Array));
      return decode(Buffer.concat(chunks));
    },
    readFile: async (path) => decode(await readFile(path)),
    writeFile: async (path, text) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text, "utf8");
    },
    isDirectory: async (path) => {
      try {
        return (await stat(path)).isDirectory();
      } catch {
        return false;
      }
    },
    ...overrides,
  };
}
