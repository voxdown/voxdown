import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Plugin, defineConfig } from "vite";
import { workspaceAliases } from "../vitest.shared";
import { markdownFile } from "./docs";

const here = dirname(fileURLToPath(import.meta.url));

/** `<!--markdown:../spec/SPEC.md-->` in a page becomes that file, as HTML. */
function markdownPages(): Plugin {
  return {
    name: "voxdown-markdown-pages",
    transformIndexHtml(html) {
      return html.replace(/<!--markdown:([^>]+?)-->/g, (_match, path: string) =>
        markdownFile(resolve(here, path.trim())),
      );
    },
  };
}

/**
 * The playground is a static site: relative paths, so it works from any folder on GitHub Pages,
 * and the workspace packages read from source.
 */
export default defineConfig({
  base: "./",
  plugins: [markdownPages()],
  resolve: { alias: workspaceAliases },
  server: { fs: { allow: [".."] } },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(here, "index.html"),
        element: resolve(here, "element.html"),
        spec: resolve(here, "spec.html"),
        cheatsheet: resolve(here, "cheatsheet.html"),
      },
    },
  },
});
