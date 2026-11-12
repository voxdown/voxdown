import { defineProject } from "vitest/config";
import { setupFiles, testTimeout, workspaceAliases } from "../../vitest.shared";

export default defineProject({
  resolve: { alias: workspaceAliases },
  test: { name: "render", testTimeout, setupFiles, include: ["test/**/*.test.ts"] },
});
