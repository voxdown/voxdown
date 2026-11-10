// Builds the playground mockup into one self-contained HTML file (fonts, script and styles
// inlined), for sharing a design before it is built: node mockup/build.mjs <out.html>
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(site, "dist-mockup");
await build({
  root: site,
  configFile: join(site, "vite.config.ts"),
  logLevel: "warn",
  build: {
    outDir,
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: { input: join(site, "index.html") },
  },
});
let html = readFileSync(join(outDir, "index.html"), "utf8");
html = html.replace(
  /<script type="module" crossorigin src="\.\/([^"]+)"><\/script>/g,
  (_m, file) => {
    const js = readFileSync(join(outDir, file), "utf8").replace(/<\/script/g, "<\\/script");
    return `<script type="module">${js}</script>`;
  },
);
html = html.replace(/<link rel="stylesheet" crossorigin href="\.\/([^"]+)">/g, (_m, file) => {
  return `<style>${readFileSync(join(outDir, file), "utf8")}</style>`;
});
html = html.replace(/<link rel="icon" href="\.\/icon\.svg">/, () => {
  const svg = readFileSync(join(site, "public", "icon.svg"), "utf8");
  return `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(svg)}">`;
});
const out = resolve(process.argv[2] ?? join(site, "dist-mockup", "playground-mockup.html"));
writeFileSync(out, html);
console.log(`${out} (${Math.round(html.length / 1024)} KB)`);
