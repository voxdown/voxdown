// Checks the built playground in a real browser: every example, every tab, no errors.
// Run after `pnpm site:build`: node scripts/check-site.mjs
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const site = resolve(fileURLToPath(new URL("../site", import.meta.url)));
const dist = join(site, "dist");
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

// With every mark shown raw, a direction reads in line, not squeezed by the views' stylesheet.
await page.click(`.example[data-name="${names[0]}"]`);
await page.check("#show-marks");
const widths = await page.$$eval(".cm-content .vxd-direction", (marks) =>
  marks.map((mark) => mark.getBoundingClientRect().width),
);
if (widths.length === 0) problems.push("show marks: no raw direction drawn");
const squeezed = widths.filter((width) => width < 8).length;
if (squeezed) problems.push(`show marks: ${squeezed} raw direction(s) squeezed`);
await page.uncheck("#show-marks");
console.log("show marks: raw directions read in line: ok");

// The two pages are linked: a click on the right page moves the cursor there, and the cursor marks
// its place on the right page.
const cursorLine = () =>
  page.evaluate(() => {
    const node = window.getSelection()?.anchorNode;
    const element = node instanceof Element ? node : node?.parentElement;
    return element?.closest(".cm-line")?.textContent ?? "";
  });
await page.click(`.example[data-name="${names[0]}"]`);
await page.click('.tab[data-tab="script"]');
if (await page.locator("#output .linked").count())
  problems.push("linking: a story just opened already has a marked place");
const speech = page.locator("#output .vxd-speech:not(.vxd-narration)").nth(3);
await speech.scrollIntoViewIfNeeded();
// The words alone, without the direction label drawn above them.
const said = await speech.evaluate((element) => {
  const words = element.cloneNode(true);
  for (const label of words.querySelectorAll(".vxd-direction")) label.remove();
  return words.textContent.replace(/[“”"]/g, "").trim().split(/\s+/).slice(0, 3).join(" ");
});
await speech.click();
const active = await cursorLine();
if (!active.includes(said))
  problems.push(`linking: a click on “${said}” put the cursor on “${active}”`);
if (!(await speech.evaluate((element) => element.classList.contains("linked"))))
  problems.push("linking: the clicked speech isn't marked as the cursor's place");
await page.keyboard.press("ArrowDown");
await page.keyboard.press("ArrowDown");
const moved = await page.evaluate(() => document.querySelectorAll("#output .linked").length);
if (moved !== 1) problems.push(`linking: after moving the cursor, ${moved} places are marked`);
await page.click('.tab[data-tab="lines"]');
const row = page.locator("#output tbody tr").nth(5);
const rowText = (await row.locator(".text").innerText()).split(/\s+/).slice(0, 3).join(" ");
await row.click();
const rowLine = await cursorLine();
if (!rowLine.includes(rowText))
  problems.push(`linking: a click on row 6 put the cursor on “${rowLine}”`);
if (!(await row.evaluate((element) => element.classList.contains("linked"))))
  problems.push("linking: the clicked row isn't marked");
// A click far down the right page glides the editor to that place, and it ends up in view.
await page.click('.tab[data-tab="script"]');
const far = page.locator("#output .vxd-speech:not(.vxd-narration)").last();
await far.scrollIntoViewIfNeeded();
await far.click();
await page.waitForTimeout(1200);
const inView = await page.evaluate(() => {
  const node = window.getSelection()?.anchorNode;
  const line = (node instanceof Element ? node : node?.parentElement)?.closest(".cm-line");
  const frame = document.querySelector(".cm-scroller")?.getBoundingClientRect();
  const box = line?.getBoundingClientRect();
  return Boolean(box && frame && box.top >= frame.top && box.bottom <= frame.bottom);
});
if (!inView)
  problems.push("linking: after a click far down the right page, the editor's place isn't in view");
console.log("linking: right page to editor and back: ok");

// The listening page: each recording was made from the story as it is now, and every part it
// plays has its place on the page.
const listen = await browser.newPage({ viewport: { width: 1440, height: 900 } });
watch(listen, "listen.html");
await listen.goto(`${base}/listen.html`);
await listen.waitForSelector(".vxd-script");
for (const story of await listen.$$eval(".story", (buttons) =>
  buttons.map((button) => button.dataset.name),
)) {
  const manifestFile = join(site, "src", "recordings", story.replace(/\.vxd$/, ".json"));
  await listen.click(`.story[data-name="${story}"]`);
  await listen.waitForTimeout(400);
  if (!existsSync(manifestFile)) {
    console.log(`listen.html: ${story}: not recorded yet, plays from a clock`);
    continue;
  }
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  const source = createHash("sha256")
    .update(readFileSync(join(site, "..", "examples", story)))
    .digest("hex");
  if (manifest.source !== source)
    problems.push(
      `listen.html: ${story} changed since it was recorded; run scripts/speak.mjs again`,
    );
  const placed = await listen.locator(".listen-sheet .cue").count();
  if (placed !== manifest.cues.length)
    problems.push(
      `listen.html: ${story}: ${placed} of ${manifest.cues.length} recorded parts found on the page`,
    );
  if (await listen.locator(".mock-note").isVisible())
    problems.push(`listen.html: ${story} is recorded but the page says it's a mockup`);
  console.log(`listen.html: ${story}: recorded, ${placed} parts placed`);
}

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
