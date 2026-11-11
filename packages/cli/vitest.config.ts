import { defineProject } from "vitest/config";
import { testTimeout, workspaceAliases } from "../../vitest.shared";

export default defineProject({
  resolve: { alias: workspaceAliases },
  test: { name: "cli", testTimeout, include: ["test/**/*.test.ts"] },
});
