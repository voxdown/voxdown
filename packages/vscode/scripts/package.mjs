// Packs the extension into voxdown-<version>.vsix, after `pnpm build`.
//
// In the workspace this package is `voxdown-vscode`, because `voxdown` is the core's name there.
// The extension itself is named `voxdown`, so its manifest is written into a staging folder,
// dist/vsix, with only the files that ship, and vsce packs it from there. The bundle holds the core
// and the renderer, so nothing from node_modules is needed.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const stage = join(root, "dist", "vsix");
const SHIPPED = [
  ".vscodeignore",
  "README.md",
  "LICENSE",
  "language-configuration.json",
  "images/icon.png",
  "snippets/voxdown.code-snippets",
  "syntaxes/voxdown.tmLanguage.json",
  "syntaxes/voxdown.markdown.tmLanguage.json",
  "dist/extension.cjs",
  "dist/CHEATSHEET.md",
];

const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const { scripts, dependencies, devDependencies, private: _private, type, ...extension } = manifest;
extension.name = "voxdown";

rmSync(stage, { recursive: true, force: true });
for (const path of SHIPPED) {
  if (!existsSync(join(root, path))) throw new Error(`${path} is missing: run pnpm build first.`);
  mkdirSync(dirname(join(stage, path)), { recursive: true });
  cpSync(join(root, path), join(stage, path));
}
writeFileSync(join(stage, "package.json"), `${JSON.stringify(extension, null, 2)}\n`);

const require = createRequire(import.meta.url);
const vsce = join(dirname(require.resolve("@vscode/vsce/package.json")), "vsce");
const out = join(root, `${extension.name}-${extension.version}.vsix`);
const github = "https://github.com/voxdown/voxdown";
execFileSync(
  process.execPath,
  [
    vsce,
    "package",
    "--no-dependencies",
    "--baseContentUrl",
    `${github}/blob/main/packages/vscode`,
    "--baseImagesUrl",
    `${github}/raw/main/packages/vscode`,
    "--out",
    out,
  ],
  { cwd: stage, stdio: "inherit" },
);
