import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";
import { workspaceAliases } from "../../vitest.shared";

export default defineProject({
  resolve: {
    alias: [
      ...workspaceAliases,
      // The `vscode` module exists only inside VS Code; the tests run the extension on a stand-in.
      {
        find: /^vscode$/,
        replacement: fileURLToPath(new URL("./test/vscode-stub.ts", import.meta.url)),
      },
    ],
  },
  test: { name: "vscode", include: ["test/**/*.test.ts"] },
});
