// The Writer's pictures on the front page (site/public/front/), in the light look and the dark one:
// the dragon story open, its scenes on the left and its script on the right. Run after `pnpm site:build`, then build again:
//   node scripts/front-shots.mjs
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const dist = resolve(fileURLToPath(new URL("../site/dist", import.meta.url)));
const out = resolve(fileURLToPath(new URL("../site/public/front", import.meta.url)));
if (!existsSync(join(dist, "writer", "index.html"))) {
  console.error("No site/dist/writer/index.html: run `pnpm site:build` first.");
  process.exit(2);
}
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
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

const browser = await chromium.launch();
for (const theme of ["light", "dark"]) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 864 },
    deviceScaleFactor: 1.5,
    colorScheme: theme,
  });
  await context.addInitScript((look) => {
    if (sessionStorage.getItem("shot")) return;
    sessionStorage.setItem("shot", "1");
    localStorage.setItem("vxd-theme", look);
    // As a writer comes to see it: marks as written, the workbench's scenes on the left and the
    // script on the right, the one-time word about drawn marks already read.
    localStorage.setItem(
      "vxd-writer-view",
      JSON.stringify({ drawnTipDone: true, bench: true, benchTab: "scenes" }),
    );
  }, theme);
  const page = await context.newPage();
  await page.goto(`${base}/writer/#example=the-dragon-who-would-not-roar`);
  await page.waitForSelector(".cm-content");
  await page.waitForTimeout(800);
  // The mountain, where the knight meets the dragon: its heading at the top of the page, and the
  // cursor on a plain line, so every mark shows as the Writer draws it.
  // (The line may not be drawn yet, far down a long page: the cursor put there through the editor.)
  await page.evaluate(() => {
    const view = document.querySelector(".cm-content")?.cmTile?.view;
    if (!view) return;
    const at = view.state.doc.toString().indexOf("Sir Percival stopped.");
    view.dispatch({ selection: { anchor: at + 5 }, scrollIntoView: true });
  });
  await page.waitForTimeout(400);
  const stopped = page.locator(".cm-line", { hasText: "Sir Percival stopped." }).first();
  await stopped.click({ position: { x: 300, y: 8 } });
  await page.evaluate(() => {
    const heading = [...document.querySelectorAll(".cm-line")].find((each) =>
      /mountain/i.test(each.textContent ?? ""),
    );
    const scroller = document.querySelector(".cm-scroller");
    if (heading && scroller)
      scroller.scrollTop +=
        heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 64;
  });
  await page.waitForTimeout(600);
  // The pointer off the page, so no passage's bar shows.
  await page.mouse.move(700, 860);
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    for (const notice of document.querySelectorAll("#notice")) notice.hidden = true;
  });
  await page.screenshot({
    path: join(out, `writer-${theme}.jpg`),
    type: "jpeg",
    quality: 82,
  });
  await context.close();
  console.log(`site/public/front/writer-${theme}.jpg`);
}
await browser.close();
server.close();
