import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The ground rules (CONTRIBUTING.md): the core has no dependencies and runs anywhere, every
 * package imports only what its manifest declares, nothing reaches into another package's folder,
 * and the project names no host application.
 */
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const packagesDir = join(repo, "packages");

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === "dist") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(?:[cm]?[jt]sx?)$/.test(name) ? [path] : [];
  });
}

const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;

function specifiers(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(SPECIFIER)].map((match) => match[1] ?? "");
}

type Manifest = {
  name: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const packages = readdirSync(packagesDir)
  .filter((name) => existsSync(join(packagesDir, name, "package.json")))
  .map((name) => {
    const dir = join(packagesDir, name);
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Manifest;
    return { dir, manifest };
  });

/** The package a bare specifier names: `@scope/name` or `name`, without a subpath. */
function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? "");
}

describe("the core stands on its own", () => {
  const core = packages.find((entry) => entry.manifest.name === "voxdown");

  it("has no runtime dependencies", () => {
    expect(core?.manifest.dependencies ?? {}).toEqual({});
    expect(core?.manifest.peerDependencies ?? {}).toEqual({});
  });

  it("imports nothing but its own files, so it runs in browsers and Node alike", () => {
    const offending = sourceFiles(join(core?.dir ?? "", "src")).flatMap((file) =>
      specifiers(file)
        .filter((specifier) => !specifier.startsWith("./") && !specifier.startsWith("../"))
        .map((specifier) => `${relative(repo, file)}: ${specifier}`),
    );
    expect(offending).toEqual([]);
  });
});

describe.each(packages.map((entry) => [entry.manifest.name, entry] as const))(
  "%s",
  (_name, { dir, manifest }) => {
    it("never reaches into another folder with a relative path", () => {
      const offending = sourceFiles(join(dir, "src")).flatMap((file) =>
        specifiers(file)
          .filter(
            (specifier) =>
              specifier.startsWith(".") &&
              relative(dir, resolve(dirname(file), specifier)).startsWith(".."),
          )
          .map((specifier) => `${relative(repo, file)}: ${specifier}`),
      );
      expect(offending).toEqual([]);
    });

    it("imports only Node built-ins and the packages its manifest declares", () => {
      const declared = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
      ]);
      const offending = sourceFiles(join(dir, "src")).flatMap((file) =>
        specifiers(file)
          .filter((specifier) => !specifier.startsWith(".") && !specifier.startsWith("node:"))
          .filter((specifier) => specifier !== "vscode" && !declared.has(packageName(specifier)))
          .map((specifier) => `${relative(repo, file)}: ${specifier}`),
      );
      expect(offending).toEqual([]);
    });
  },
);

describe("the project names no host application", () => {
  it("has no Kinu names in its packages, spec or examples", () => {
    const roots = [packagesDir, join(repo, "spec"), join(repo, "examples"), join(repo, "site")];
    const walk = (dir: string): string[] => {
      if (!existsSync(dir)) return [];
      return readdirSync(dir).flatMap((name) => {
        if (["node_modules", "dist", "dist-mockup", "CHANGELOG.md"].includes(name)) return [];
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return walk(path);
        return /\.(?:[cm]?[jt]sx?|md|vxd|json|css|html|ya?ml)$/.test(name) ? [path] : [];
      });
    };
    const files = roots.flatMap(walk);
    const offending = files.filter(
      (file) => !file.endsWith("boundary.test.ts") && /\bkinu\b/i.test(readFileSync(file, "utf8")),
    );
    expect(offending.map((file) => relative(repo, file))).toEqual([]);
    // It reads every file in the tree: more time than a test usually needs, on a busy machine.
  }, 60_000);
});
