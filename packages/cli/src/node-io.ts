/** The command's `io` on a real disk and the process's own streams. */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { type Io, VERSION } from "./run";

/** Where vxd keeps what it remembers, such as the AI chosen last time. */
function configFile(): string {
  const base =
    process.platform === "win32"
      ? (process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"))
      : (process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"));
  return join(base, "voxdown", "vxd.json");
}

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
    interactive: Boolean(process.stdin.isTTY && process.stderr.isTTY),
    question: async (text) => {
      const lines = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return await lines.question(text);
      } finally {
        lines.close();
      }
    },
    configFile: configFile(),
    serveMcp: async () => (await import("./mcp")).serveMcp(VERSION),
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
