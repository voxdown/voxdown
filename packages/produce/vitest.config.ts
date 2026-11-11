import { defineProject } from "vitest/config";
import { testTimeout, workspaceAliases } from "../../vitest.shared";

export default defineProject({
  resolve: { alias: workspaceAliases },
  test: { name: "produce", testTimeout, include: ["test/**/*.test.ts"] },
});
