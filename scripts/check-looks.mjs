// Checks every look of the Writer (View › Page and text) in a real browser: the ink, the quiet
// text, the links, the warnings, each kind of mark, the buttons and every character's chip read at
// 4.5:1 or better on that look's paper.
// Run after `pnpm site:build`: node scripts/check-looks.mjs
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// The characters' colours, read from the source (the site may be built without the packages).
const colors = readFileSync(new URL("../packages/core/src/colors.ts", import.meta.url), "utf8");
const PALETTE = [
  ...(/PALETTE = \[([^\]]*)\]/.exec(colors)?.[1] ?? "").matchAll(/"(#[0-9a-f]{6})"/gi),
].map((match) => match[1]);
if (PALETTE.length < 8) throw new Error("The characters' colours weren't found in colors.ts.");
const dist = resolve(fileURLToPath(new URL("../site/dist", import.meta.url)));
if (!existsSync(join(dist, "writer", "index.html"))) {
  console.error("No site/dist/writer/index.html: run `pnpm site:build` first.");
  process.exit(2);
}
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((request, response) => {
  let file = join(
    dist,
    normalize(decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname)),
  );
  if (!file.startsWith(dist)) return response.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) return response.writeHead(404).end();
  response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(response);
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`;

const rgb = (hex) => {
  const h = hex.trim().replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16));
};
const mix = (a, b, share) => a.map((value, i) => value * share + b[i] * (1 - share));
const luminance = (color) => {
  const [r, g, b] = color.map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

// Each look as its two keys set it, and the system's own light or dark.
const LOOKS = {
  auto: { scheme: "light" },
  "auto, dark computer": { scheme: "dark" },
  paper: { theme: "light" },
  sepia: { theme: "light", paper: "sepia" },
  night: { theme: "dark" },
  slate: { theme: "dark", paper: "slate" },
  contrast: { theme: "light", paper: "contrast" },
};
const TOKENS = [
  "--ink",
  "--quiet",
  "--pencil",
  "--warning",
  "--mark-direction",
  "--mark-sound",
  "--mark-page",
  "--mark-note",
];

const browser = await chromium.launch();
const failures = [];
for (const [name, look] of Object.entries(LOOKS)) {
  const context = await browser.newContext({ colorScheme: look.scheme ?? "light" });
  await context.addInitScript((keys) => {
    if (keys.theme) localStorage.setItem("vxd-theme", keys.theme);
    if (keys.paper) localStorage.setItem("vxd-writer-paper", keys.paper);
  }, look);
  const page = await context.newPage();
  await page.goto(`${base}/writer/`);
  const values = await page.evaluate((tokens) => {
    const style = getComputedStyle(document.documentElement);
    const read = (token) => style.getPropertyValue(token).trim();
    return Object.fromEntries(
      [...tokens, "--paper", "--brand", "--brand-ink"].map((t) => [t, read(t)]),
    );
  }, TOKENS);
  const paper = rgb(values["--paper"]);
  const ink = rgb(values["--ink"]);
  const check = (what, color, ground = paper) => {
    const ratio = contrast(color, ground);
    if (ratio < 4.5) failures.push(`${name}: ${what} at ${ratio.toFixed(2)}:1`);
    return ratio;
  };
  for (const token of TOKENS) check(token, rgb(values[token]));
  // White on the teal is too faint in the dark: the dark looks give the button dark ink.
  const brandInk =
    (await page.evaluate(() =>
      getComputedStyle(document.querySelector(".writer")).getPropertyValue("--brand-ink").trim(),
    )) || values["--brand-ink"];
  check("a button's words", rgb(brandInk), rgb(values["--brand"]));
  // A character's chip: their colour mixed with the ink, on a tint of their colour.
  for (const color of PALETTE) {
    const speaker = rgb(color);
    check(`the chip of ${color}`, mix(speaker, ink, 0.42), mix(speaker, paper, 0.18));
  }
  console.log(`${name}: checked (paper ${values["--paper"]}, ink ${values["--ink"]})`);
  await context.close();
}
await browser.close();
server.close();
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Every look reads at 4.5:1 or better.");
