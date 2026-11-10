import { defineProject } from "vitest/config";
import { workspaceAliases } from "../../vitest.shared";

export default defineProject({
  resolve: { alias: workspaceAliases },
  test: { name: "core", include: ["test/**/*.test.ts"] },
});
