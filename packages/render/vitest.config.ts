import { defineProject } from "vitest/config";
import { workspaceAliases } from "../../vitest.shared";

export default defineProject({
  resolve: { alias: workspaceAliases },
  test: { name: "render", include: ["test/**/*.test.ts"] },
});
