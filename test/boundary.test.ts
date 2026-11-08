import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * This package grows up inside Kinu but must move out as a copy, not a rewrite. So nothing in it
 * may reach outside its own folder: no Kinu packages, no relative paths that leave the package,
 * and no workspace links in its manifest.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(?:[cm]?[jt]sx?)$/.test(name) ? [path] : [];
  });
}

const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;

describe("the package stands on its own", () => {
  it("imports nothing from Kinu or from outside its folder", () => {
    const offending: string[] = [];
    for (const file of sourceFiles(root)) {
      for (const match of readFileSync(file, "utf8").matchAll(SPECIFIER)) {
        const specifier = match[1] ?? "";
        const leaves =
          specifier.startsWith(".") &&
          relative(root, resolve(dirname(file), specifier)).startsWith("..");
        if (specifier.startsWith("@kinu/") || leaves) {
          offending.push(`${relative(root, file)}: ${specifier}`);
        }
      }
    }
    expect(offending).toEqual([]);
  });

  it("has no Kinu or workspace dependencies", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<
      string,
      Record<string, string> | undefined
    >;
    const links = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]
      .flatMap((field) => Object.entries(manifest[field] ?? {}))
      .filter(([name, version]) => name.startsWith("@kinu/") || version.startsWith("workspace:"));
    expect(links).toEqual([]);
  });

  it("keeps its own TypeScript settings", () => {
    const tsconfig = readFileSync(join(root, "tsconfig.json"), "utf8");
    expect(tsconfig).not.toMatch(/"extends"/);
  });
});
