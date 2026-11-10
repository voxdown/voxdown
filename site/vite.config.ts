import { defineConfig } from "vite";
import { workspaceAliases } from "../vitest.shared";

/**
 * The playground is a static site: relative paths, so it works from any folder on GitHub Pages,
 * and the workspace packages read from source.
 */
export default defineConfig({
  base: "./",
  resolve: { alias: workspaceAliases },
  server: { fs: { allow: [".."] } },
  build: { target: "es2022", outDir: "dist", emptyOutDir: true },
});
