import { execFileSync } from "node:child_process";
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

/** Match static hosting's directory redirect before Vite's index.html fallback. */
function studioSecurity(): Plugin {
  return {
    name: "voxdown-studio-security",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        "<!--studio-csp-->",
        `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self'; font-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'">`,
      );
    },
  };
}
function studioDirectory(): Plugin {
  return {
    name: "voxdown-studio-directory",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/studio(\?.*)?$/.exec(request.url ?? "");
        if (!match) return next();
        response.writeHead(302, { Location: `/studio/${match[1] ?? ""}` });
        response.end();
      });
    },
  };
}

/**
 * The playground is a static site: relative paths, so it works from any folder on GitHub Pages,
 * and the workspace packages read from source.
 */
/** Which build this is, for the Writer's About: the commit, and the day it was built. */
function buildOf(): { commit: string; date: string } {
  let commit = "";
  try {
    commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: here,
      encoding: "utf8",
    }).trim();
  } catch {}
  return { commit, date: new Date().toISOString().slice(0, 10) };
}

export default defineConfig({
  base: "./",
  define: { __WRITER_BUILD__: JSON.stringify(buildOf()) },
  plugins: [studioDirectory(), studioSecurity(), markdownPages()],
  resolve: { alias: workspaceAliases },
  server: { fs: { allow: [".."] } },
  // The Writer draws a long story's script and book in a worker, which imports the packages.
  worker: { format: "es" },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(here, "index.html"),
        playground: resolve(here, "playground.html"),
        element: resolve(here, "element.html"),
        spec: resolve(here, "spec.html"),
        cheatsheet: resolve(here, "cheatsheet.html"),
        listen: resolve(here, "listen.html"),
        writer: resolve(here, "writer/index.html"),
        screenplayStudio: resolve(here, "studio/index.html"),
        // The landing page directions not chosen, built but not linked (site/landing/*).
        stage: resolve(here, "landing/stage/index.html"),
        manuscript: resolve(here, "landing/manuscript/index.html"),
        // The chosen one is the front page; its old address sends links shared to it there.
        studio: resolve(here, "landing/studio/index.html"),
      },
    },
  },
});
