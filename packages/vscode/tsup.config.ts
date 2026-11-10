import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { defineConfig } from "tsup";

/** Where the cheat sheet's link to the spec points, in the copy the extension ships. */
const SPEC_URL = "https://github.com/voxdown/voxdown/blob/main/spec/SPEC.md";

export default defineConfig({
  entry: { extension: "src/extension.ts" },
  // VS Code loads extensions as CommonJS. The core and the renderer go in the bundle, so the
  // extension needs no node_modules.
  format: ["cjs"],
  outExtension: () => ({ js: ".cjs" }),
  platform: "node",
  target: "node18",
  external: ["vscode"],
  noExternal: ["voxdown", "@voxdown/render"],
  sourcemap: true,
  clean: true,
  async onSuccess() {
    const sheet = readFileSync(new URL("../../spec/CHEATSHEET.md", import.meta.url), "utf8");
    mkdirSync(new URL("./dist/", import.meta.url), { recursive: true });
    writeFileSync(
      new URL("./dist/CHEATSHEET.md", import.meta.url),
      sheet.replaceAll("](SPEC.md", `](${SPEC_URL}`),
    );
  },
});
