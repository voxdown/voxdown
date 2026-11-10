import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { type Io, run } from "../src/run";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const peter = readFileSync(join(root, "examples", "peter-rabbit.vxd"), "utf8");

/** The folder the in-memory command runs in. */
export const CWD = resolve("/work");

export type Result = {
  code: number;
  stdout: string;
  stderr: string;
  /** A file's text after the command, by its path from the working folder. */
  file: (path: string) => string | undefined;
  /** The paths written, from the working folder, in order. */
  written: string[];
};

function failure(code: string): Error {
  return Object.assign(new Error(code), { code });
}

/** Runs `vxd` on files held in memory, with `stdin` as standard input. */
export async function vxd(
  args: string[],
  files: Record<string, string> = {},
  options: { stdin?: string; io?: Partial<Io> } = {},
): Promise<Result> {
  const disk = new Map(Object.entries(files).map(([path, text]) => [resolve(CWD, path), text]));
  const folders = () => {
    const found = new Set([CWD]);
    for (const path of disk.keys()) {
      for (let folder = dirname(path); !found.has(folder); folder = dirname(folder)) {
        found.add(folder);
      }
    }
    return found;
  };
  let stdout = "";
  let stderr = "";
  const written: string[] = [];
  const io: Io = {
    cwd: CWD,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    readStdin: async () => options.stdin ?? "",
    readFile: async (path) => {
      if (folders().has(path)) throw failure("EISDIR");
      const text = disk.get(path);
      if (text === undefined) throw failure("ENOENT");
      return text;
    },
    writeFile: async (path, text) => {
      if (folders().has(path)) throw failure("EISDIR");
      disk.set(path, text);
      written.push(relative(CWD, path).split(sep).join("/"));
    },
    isDirectory: async (path) => folders().has(path),
    ...options.io,
  };
  const code = await run(args, io);
  return { code, stdout, stderr, file: (path) => disk.get(resolve(CWD, path)), written };
}
