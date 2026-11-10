// Checks the built playground in a real browser: every example, every tab, no errors.
// Run after `pnpm site:build`: node scripts/check-site.mjs
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const dist = resolve(fileURLToPath(new URL("../site/dist", import.meta.url)));
if (!existsSync(join(dist, "index.html"))) {
  console.error("No site/dist/index.html: run `pnpm site:build` first.");
  process.exit(2);
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".json": "application/json",
};
const server = createServer((request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname));
  let file = join(dist, path);
  if (!file.startsWith(dist)) return response.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) return response.writeHead(404).end();
  response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(response);
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const problems = [];
const watch = (page, where) => {
  page.on("pageerror", (error) => problems.push(`${where}: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`${where}: ${message.text()}`);
  });
};

const TABS = {
  script: async (page) => (await page.locator("#output .vxd-script .vxd-speech").count()) > 0,
  book: async (page) => (await page.locator("#output .vxd-book .vxd-p").count()) > 0,
  lines: async (page) => (await page.locator("#output tbody tr").count()) > 0,
  csv: async (page) =>
    (await page.textContent("#output pre"))?.startsWith("kind,speaker,direction,text,scene,page"),
  sides: async (page) => (await page.locator("#output .side").count()) > 0,
};

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
watch(page, "playground");
await page.goto(`${base}/index.html`);
await page.waitForSelector(".example");
const names = await page.$$eval(".example", (buttons) =>
  buttons.map((button) => button.dataset.name),
);
for (const name of names) {
  await page.click(`.example[data-name="${name}"]`);
  const text = await page.locator(".cm-content").innerText();
  if (text.trim().length < 20) problems.push(`${name}: the editor is empty`);
  for (const [tab, check] of Object.entries(TABS)) {
    await page.click(`.tab[data-tab="${tab}"]`);
    if (!(await check(page))) problems.push(`${name}: the ${tab} tab shows nothing`);
  }
  const status = await page.textContent("#status");
  if (status !== "No warnings") problems.push(`${name}: ${status}`);
  console.log(`${name}: editor, ${Object.keys(TABS).join(", ")}: ok`);
}

// Typing updates the right page.
await page.click(`.example[data-name="${names[0]}"]`);
await page.click('.tab[data-tab="script"]');
await page.click(".cm-content");
await page.keyboard.press("Control+End");
await page.keyboard.type("\n\n@Zelda “Hello there.”");
await page.waitForFunction(() =>
  [...document.querySelectorAll("#output .vxd-speech")].some((el) =>
    el.textContent?.includes("Hello there."),
  ),
);
console.log("typing: the script follows: ok");

const element = await browser.newPage();
watch(element, "element.html");
await element.goto(`${base}/element.html`);
await element.waitForFunction(() =>
  document.querySelector("voxdown-editor")?.shadowRoot?.querySelector(".cm-content"),
);
console.log("element.html: <voxdown-editor> mounts: ok");

for (const doc of ["spec.html", "cheatsheet.html"]) {
  const docPage = await browser.newPage();
  watch(docPage, doc);
  const response = await docPage.goto(`${base}/${doc}`);
  if (!response?.ok()) problems.push(`${doc}: ${response?.status()}`);
  else if ((await docPage.locator("main h2").count()) < 3) problems.push(`${doc}: no sections`);
  else console.log(`${doc}: ok`);
}

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("\nThe playground works for every example.");
