// Runs the packed extension inside a real VS Code (downloaded into .vscode-test, apart from
// any VS Code you use) and checks it on the repository's examples. Needs a display: on Linux,
// run it under xvfb-run. Build the staging folder first with `pnpm package`.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const here = dirname(fileURLToPath(import.meta.url));
const extension = resolve(here, "../dist/vsix");
if (!existsSync(join(extension, "package.json"))) {
  console.error("No dist/vsix: run `pnpm --filter voxdown-vscode package` first.");
  process.exit(2);
}
await runTests({
  version: "stable",
  extensionDevelopmentPath: extension,
  extensionTestsPath: join(here, "suite.cjs"),
  launchArgs: [
    resolve(here, "../../../examples"),
    "--disable-extensions",
    "--disable-workspace-trust",
  ],
  extensionTestsEnv: { VOXDOWN_EXAMPLES: resolve(here, "../../../examples") },
});
