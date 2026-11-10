// Makes the README's animation (assets/demo.gif) and the repository's social preview
// (assets/social-preview.png) from the built site: node scripts/readme-media.mjs
// Run after `pnpm build` and `pnpm site:build`. Needs ffmpeg. The social preview is uploaded by hand,
// in the repository's Settings → General → Social preview.
import { execFileSync } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { chromium } from "playwright";
import { parse, tokens } from "../packages/core/dist/index.js";
import { escapeHtml, renderBook, renderScript, stylesheet } from "../packages/render/dist/index.js";

const root = join(import.meta.dirname, "..");
const dist = join(root, "site", "dist");
const assets = join(root, "assets");
if (!existsSync(join(dist, "index.html"))) {
  console.error("No site/dist: run `pnpm site:build` first.");
  process.exit(2);
}

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};
const server = createServer((request, response) => {
  let file = join(dist, decodeURIComponent(new URL(request.url, "http://x").pathname));
  if (file.endsWith("/")) file += "index.html";
  if (!existsSync(file)) return response.writeHead(404).end();
  response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(response);
});
await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();

// The animation: a line typed with its marks, then the script, the book and the lines it becomes.

const work = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "voxdown-demo-"));
const frames = [];
const page = await browser.newPage({
  viewport: { width: 1280, height: 720 },
  colorScheme: "light",
});
const frame = async (seconds) => {
  const file = join(work, `${String(frames.length).padStart(4, "0")}.png`);
  await page.screenshot({ path: file });
  frames.push({ file, seconds });
};
const hold = async (seconds) => {
  // A few frames across a pause, so the right page can catch up while it is shown.
  const steps = Math.max(1, Math.round(seconds / 0.25));
  for (let step = 0; step < steps; step++) {
    await page.waitForTimeout(250);
    await frame(seconds / steps);
  }
};
const type = async (text) => {
  for (const char of text) {
    await page.keyboard.type(char);
    await frame(0.055);
  }
};

await page.addInitScript(() => localStorage.clear());
await page.goto(`${base}/index.html`);
await page.waitForSelector(".cm-content");
await page.click("#new-story");
await page.waitForTimeout(500);
await hold(1.2);
await page.keyboard.press("Control+End");
await type("@Wanda");
await page.keyboard.press("Escape");
await type(" (whispering) ");
await type('"Is anyone there?"');
await hold(0.8);
await type(" [a door creaks]");
await hold(0.8);
// Up to Wanda's first line: the editor draws the new line's marks as chips, and the right page
// marks where the cursor is, in each view.
await page.keyboard.press("ArrowUp");
await hold(1.6);
await page.click('.tab[data-tab="book"]');
await hold(2);
await page.click('.tab[data-tab="lines"]');
await hold(2.2);
await page.close();

mkdirSync(assets, { recursive: true });
const list = join(work, "frames.txt");
writeFileSync(
  list,
  `${frames.map(({ file, seconds }) => `file '${file}'\nduration ${seconds.toFixed(3)}`).join("\n")}\nfile '${frames.at(-1).file}'\n`,
);
execFileSync("ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-y",
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  list,
  "-vf",
  "fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle",
  "-loop",
  "0",
  join(assets, "demo.gif"),
]);
rmSync(work, { recursive: true, force: true });
console.log(
  `assets/demo.gif: ${frames.length} frames, ${frames.reduce((sum, { seconds }) => sum + seconds, 0).toFixed(1)}s`,
);

// The social preview: the name, the line, and what a listener hears and a reader sees.

const line = "@Gerald (yawning) “Could you not?” [snores]";
const story = parse(line);
let written = "";
let at = 0;
for (const token of tokens(story)) {
  if (token.range.from < at) continue;
  written += escapeHtml(line.slice(at, token.range.from));
  written += `<span class="t-${token.kind}">${escapeHtml(line.slice(token.range.from, token.range.to))}</span>`;
  at = token.range.to;
}
written += escapeHtml(line.slice(at));
const css = readFileSync(join(dist, "index.html"), "utf8").match(
  /href="\.\/(assets\/[^"]+\.css)"/,
)?.[1];
const icon = readFileSync(join(assets, "icon.svg"), "utf8");
const card = await browser.newPage({ viewport: { width: 1280, height: 640 } });
await card.goto(`${base}/index.html`);
await card.setContent(`<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${base}/${css}">
<style>${stylesheet}</style>
<style>
  html, body { height: auto; }
  body { display: block !important; margin: 0; width: 1280px; height: 640px; overflow: hidden; background: #e7eaee; color: #25282d; }
  .card { box-sizing: border-box; height: 640px; padding: 64px 80px 0; }
  .name { display: flex; align-items: center; gap: 26px; }
  .name svg { width: 92px; height: 92px; flex: none; }
  .name h1 { margin: 0; font: 600 96px/1 var(--story); letter-spacing: -0.02em; }
  .tagline { margin: 14px 0 0 2px; font: italic 400 38px/1.2 var(--story); color: #646b75; }
  .rows { margin-top: 46px; background: #fff; border-radius: 12px; padding: 34px 40px 30px;
    box-shadow: 0 1px 2px rgb(30 40 60 / 0.08), 0 14px 40px -18px rgb(30 40 60 / 0.35);
    display: grid; grid-template-columns: 250px 1fr; row-gap: 22px; align-items: center; }
  .label { font: 600 17px/1 var(--ui); text-transform: uppercase; letter-spacing: 0.12em; color: #646b75; }
  .written { font: 500 30px/1.3 var(--mono); font-variation-settings: "MONO" 1; white-space: nowrap; }
  .t-mark, .t-quote { color: #646b75; } .t-name { color: #c2410c; font-weight: 700; }
  .t-direction { color: #7c3aed; font-style: italic; } .t-vocal, .t-sound { color: #0f766e; }
  .heard .vxd, .seen .vxd { --vxd-size: 34px; --vxd-story-font: var(--story); --vxd-interface-font: var(--ui); max-width: none; margin: 0; line-height: 1.5; }
  .heard .vxd-p, .seen .vxd-p { margin: 0; }
  .heard { padding-top: 14px; }
  .foot { display: flex; justify-content: space-between; margin: 30px 4px 0; font: 500 21px/1 var(--ui); color: #646b75; }
  .foot strong { color: #245f61; font-weight: 650; }
</style></head><body><div class="card">
  <div class="name">${icon}<h1>VoxDown</h1></div>
  <p class="tagline">Markdown for stories read aloud.</p>
  <div class="rows">
    <span class="label">You write</span><span class="written">${written}</span>
    <span class="label">A listener hears</span><div class="heard">${renderScript(story, { header: false, colors: { Gerald: "#c2410c" } })}</div>
    <span class="label">A reader sees</span><div class="seen">${renderBook(story, { header: false })}</div>
  </div>
  <div class="foot"><strong>voxdown.github.io</strong><span>Open source: a spec, a parser, an editor, a CLI and more</span></div>
</div></body></html>`);
await card.evaluate(() => document.fonts.ready);
await card.waitForTimeout(300);
await card.screenshot({ path: join(assets, "social-preview.png") });
console.log("assets/social-preview.png: 1280×640");

await browser.close();
server.close();
