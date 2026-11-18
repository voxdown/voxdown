// Built-site acceptance: scoped offline shell, first-use adaptation/PDF, repair and safe updates.
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, resolve } from "node:path";
import { chromium } from "playwright";
import { lines, parse } from "../packages/core/dist/index.js";

const { PDFDocument } = createRequire(resolve("site/package.json"))("pdf-lib");
const dist = resolve("site/dist");
const manifest = JSON.parse(readFileSync(resolve(dist, "studio/offline-manifest.json"), "utf8"));
assert.equal(manifest.resources.filter((path) => path.endsWith(".ttf")).length, 4);
assert.ok(
  manifest.resources.some((path) => /pdf-.*\.js$/.test(path)),
  "Lazy PDF chunk is cached",
);
const adaptationChunks = manifest.resources.filter((path) => /\/adaptation-.*\.js$/.test(path));
assert.ok(adaptationChunks.length, "Lazy adaptation chunk is cached");
assert.ok(
  manifest.resources.some((path) => /worker.*\.js$/.test(path)),
  "Parser worker is cached",
);
assert.equal(manifest.resources.filter((path) => path.endsWith(".html")).length, 1);
assert.equal(
  manifest.resources.some((path) => /\/writer[/-]|\/landing\//.test(path)),
  false,
);
let failAsset = false;
let nextVersion = "";
let holdShell = false;
let holdBody = false;
const oldLazyPath = "../assets/studio-offline-old-lazy.js";
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};
const server = createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://local").pathname);
  if (path.startsWith("/nested/project/")) path = path.slice("/nested/project".length);
  if (path === "/assets/studio-offline-old-lazy.js") {
    if (nextVersion) return res.writeHead(404).end();
    return res
      .writeHead(200, { "Content-Type": "text/javascript" })
      .end('export const marker = "old-only lazy asset";');
  }
  let file = resolve(dist, `.${path}`);
  if (!file.startsWith(`${dist}/`)) return res.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) file = resolve(file, "index.html");
  if (!existsSync(file)) return res.writeHead(404).end();
  if (failAsset && file.endsWith(".ttf"))
    return res.writeHead(503).end("Test offline download failure");
  if (holdShell && file.endsWith("studio/index.html")) return;
  if (holdBody && file.endsWith("studio/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.flushHeaders();
    res.write("<!doctype html><html>");
    return;
  }
  let body = readFileSync(file);
  if (!nextVersion && file.endsWith("studio/offline-worker.js"))
    body = Buffer.from(
      body
        .toString()
        .replace(
          `const RESOURCE_PATHS = ${JSON.stringify(manifest.resources)};`,
          `const RESOURCE_PATHS = ${JSON.stringify([...manifest.resources, oldLazyPath])};`,
        ),
    );
  if (
    nextVersion &&
    (file.endsWith("studio/index.html") || file.endsWith("studio/offline-worker.js"))
  )
    body = Buffer.from(body.toString().replaceAll(manifest.version, nextVersion));
  res.writeHead(200, {
    "Content-Type": mime[extname(file)] ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  res.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const source =
  "Title: Offline assurance\n\nINT. OFFLINE ROOM - DAY\n\nMARA\nA **bold**, *quiet* and ***strong*** offline line.\n\n[[Private offline marker 274816.]]\n";
const ready = (page) =>
  page.waitForFunction(
    () =>
      !document.getElementById("app").inert &&
      !document.getElementById("counts").textContent.includes("Updating"),
  );
const state = (page, expected) =>
  page
    .waitForFunction(
      (expected) => document.getElementById("offline-status").dataset.state === expected,
      expected,
      { timeout: 110000 },
    )
    .catch(async (error) => {
      console.error(
        "Offline state mismatch",
        expected,
        await page.locator("#offline-status").textContent(),
        await page.locator("#offline-status").getAttribute("data-state"),
      );
      throw error;
    });
const preferences = async (page) => {
  if (!(await page.locator("#preferences-dialog").isVisible()))
    await page.locator("#preferences").click();
};
const download = async (page, selector, expectedName) => {
  const pending = page.waitForEvent("download");
  void pending.catch(() => {});
  try {
    await page.locator(selector).click({ timeout: 10000 });
    const file = await pending;
    if (expectedName) assert.equal(file.suggestedFilename(), expectedName);
    return readFileSync(await file.path());
  } catch (error) {
    console.error(
      "Download failed",
      selector,
      await page.locator("#notice").textContent(),
      await page.locator("#issues").textContent(),
      await page.locator("#counts").textContent(),
      await page.locator("#pdf").getAttribute("disabled"),
    );
    throw error;
  }
};
try {
  for (const prefix of ["", "/nested/project"]) {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    const adaptationRequests = [];
    const adaptationWorkers = [];
    const adaptationURLs = new Set(
      adaptationChunks.map((path) => new URL(path, `${origin}${prefix}/studio/`).href),
    );
    // Worker cache population is not a page script import. Track executable page
    // script requests separately to prove adaptation was not warmed online.
    page.on("request", (request) => {
      if (request.resourceType() === "script" && adaptationURLs.has(request.url()))
        adaptationRequests.push(request.url());
    });
    page.on("worker", (worker) => {
      if (adaptationURLs.has(worker.url())) adaptationWorkers.push(worker.url());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}${prefix}/studio/`);
    await ready(page);
    assert.equal(
      await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
      0,
      "Loading Studio does not opt into offline storage",
    );
    await page.locator("#file").setInputFiles({
      name: "Offline.fountain",
      mimeType: "text/plain",
      buffer: Buffer.from(source),
    });
    await page.waitForFunction(() => document.getElementById("name").value === "Offline.fountain");
    await ready(page);
    await preferences(page);
    await state(page, "unprepared");
    if (!prefix) {
      failAsset = true;
      await page.locator("#offline-prepare").click();
      await state(page, "error");
      assert.equal(
        await page.evaluate(async () => (await caches.keys()).length),
        0,
        "A failed initial install leaves no partial cache",
      );
      failAsset = false;
    }
    await page.locator("#offline-prepare").click();
    await state(page, "ready");
    const scope = await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistration()).scope,
    );
    assert.equal(scope, `${origin}${prefix}/studio/`);
    const entries = await page.evaluate(async () => {
      const result = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys())
          result.push({ url: request.url, text: await (await cache.match(request)).text() });
      }
      return result;
    });
    assert.equal(entries.length, manifest.resources.length + 2);
    assert.equal(
      entries.some((entry) => entry.text.includes("Private offline marker 274816")),
      false,
      "Offline app caches do not contain the draft",
    );
    assert.equal(
      entries.every((entry) => entry.url.startsWith(`${origin}${prefix}/`)),
      true,
    );
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => document.getElementById("recovery").textContent === "Draft kept in this browser",
    );
    assert.deepEqual(adaptationRequests, [], "Adaptation has never been imported online");
    assert.deepEqual(adaptationWorkers, [], "Adaptation worker has never been started online");
    await context.setOffline(true);
    await page.reload();
    await ready(page);
    assert.equal((await download(page, "#download")).toString(), source);
    assert.deepEqual(adaptationRequests, [], "Offline reload does not eagerly import adaptation");
    assert.deepEqual(adaptationWorkers, [], "Offline reload does not start an adaptation worker");
    await page.locator("#commands").click();
    await page.getByLabel("Find a command", { exact: true }).fill("Adapt screenplay to VoxDown");
    await page.locator(".command-list button").click();
    await page.waitForFunction(() =>
      document
        .querySelector('.adaptation-dialog [role="status"]')
        ?.textContent?.startsWith("Validated"),
    );
    assert.ok(
      adaptationRequests.length || adaptationWorkers.length,
      "First adaptation module or worker starts while offline",
    );
    const adapted = (
      await download(
        page,
        '.adaptation-dialog button:text-is("Download adapted .vxd")',
        "Offline.vxd",
      )
    ).toString();
    assert.doesNotMatch(adapted, /Private offline marker 274816|Offline assurance/);
    const adaptedStory = parse(adapted);
    assert.deepEqual(adaptedStory.warnings, []);
    assert.deepEqual(adaptedStory.groups, []);
    assert.deepEqual(
      adaptedStory.cast.map(({ handle, name }) => ({ handle, name })),
      [{ handle: "Cast1", name: "MARA" }],
    );
    assert.deepEqual(
      lines(adaptedStory).map(({ kind, speaker, text, direction, heading, together }) => ({
        kind,
        speaker,
        text,
        direction,
        heading,
        together,
      })),
      [
        {
          kind: "speech",
          speaker: "Cast1",
          text: "A bold, quiet and strong offline line.",
          direction: null,
          heading: null,
          together: undefined,
        },
      ],
    );
    await page.locator('.adaptation-dialog button:text-is("Close")').click();
    assert.equal(
      (await download(page, "#download")).toString(),
      source,
      "Offline adaptation leaves exact Fountain source unchanged",
    );
    // PDF has never been opened online: lazy chunks and all four font faces must be ready.
    const pdf = await PDFDocument.load(await download(page, "#pdf"));
    assert.ok(pdf.getPageCount() > 0);
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\nOffline continuation.");
    await ready(page);
    assert.equal(
      (await download(page, "#download")).toString(),
      `${source}\nOffline continuation.`,
    );
    await context.setOffline(false);
    await page.waitForFunction(
      () => document.getElementById("recovery").textContent === "Draft kept in this browser",
    );
    // Simulate eviction of one resource without removing its service-worker registration.
    await page.evaluate(async () => {
      const cache = await caches.open((await caches.keys())[0]);
      const request = (await cache.keys()).find((request) => request.url.endsWith(".ttf"));
      await cache.delete(request);
    });
    await page.reload();
    await ready(page);
    await preferences(page);
    await state(page, "unprepared");
    failAsset = true;
    await page.locator("#offline-prepare").click();
    await state(page, "error");
    assert.equal(
      await page.evaluate(async () => {
        const cache = await caches.open(
          (await caches.keys()).find((name) => !name.endsWith(":preparing")),
        );
        return Boolean(await cache.match(new URL("index.html", location.href).href));
      }),
      true,
      "Failed repair preserves its still-usable offline shell",
    );
    failAsset = false;
    if (!prefix) {
      const workers = context
        .serviceWorkers()
        .filter((worker) => worker.url() === `${scope}offline-worker.js`);
      assert.ok(workers.length);
      for (const worker of workers)
        await worker.evaluate(() => {
          const has = caches.has.bind(caches);
          const remove = caches.delete.bind(caches);
          let failHas = true;
          let failCleanup = true;
          caches.has = async (name) => {
            if (failHas) {
              failHas = false;
              throw new DOMException("Injected storage failure", "QuotaExceededError");
            }
            return has(name);
          };
          caches.delete = async (name) => {
            const result = await remove(name);
            if (failCleanup && name.endsWith(":preparing")) {
              failCleanup = false;
              throw new DOMException("Injected cleanup failure", "InvalidStateError");
            }
            return result;
          };
        });
      await page.locator("#offline-prepare").click();
      await state(page, "error");
    }
    await page.locator("#offline-prepare").click();
    await state(page, "ready");
    console.log(
      `Studio offline: ${prefix || "/"} opt-in, isolated scope, offline reload/edit/download/first adaptation/first PDF, eviction repair: passed`,
    );
    if (!prefix) {
      const oldPage = await context.newPage();
      await oldPage.goto(`${origin}/studio/`);
      await ready(oldPage);
      const previousCaches = await page.evaluate(() => caches.keys());
      nextVersion = "a11111111111111111111111";
      failAsset = true;
      await page.reload();
      await ready(page);
      await preferences(page);
      await page.locator("#offline-prepare").click();
      await state(page, "error");
      assert.deepEqual(
        await page.evaluate(() => caches.keys()),
        previousCaches,
        "A failed update preserves the working fallback cache",
      );
      failAsset = false;
      let navigations = 0;
      page.on("framenavigated", () => {
        navigations++;
      });
      await page.locator("#offline-prepare").click();
      await state(page, "ready");
      assert.equal(navigations, 0, "Successful update never reloads the active editor");
      assert.equal(
        (await page.evaluate(() => caches.keys())).length,
        2,
        "Prior app assets remain available to already-open editors",
      );
      await page.keyboard.press("Escape");
      assert.match((await download(page, "#download")).toString(), /Offline continuation/);
      await context.setOffline(true);
      await page.reload();
      await ready(page);
      assert.equal(
        await page.locator('meta[name="studio-offline-build"]').getAttribute("content"),
        nextVersion,
      );
      assert.ok((await PDFDocument.load(await download(page, "#pdf"))).getPageCount() > 0);
      await context.setOffline(false);
      // Several successful updates retain a live older tab's assets, then retire them after it closes.
      for (const version of ["b22222222222222222222222", "c33333333333333333333333"]) {
        nextVersion = version;
        await page.reload();
        await ready(page);
        await preferences(page);
        await page.locator("#offline-prepare").click();
        await state(page, "ready");
        await page.keyboard.press("Escape");
      }
      await page.waitForFunction(() => caches.keys().then((names) => names.length === 3));
      assert.ok(
        (await page.evaluate(() => caches.keys())).some((name) => name.endsWith(manifest.version)),
        "Live old editor keeps its app assets across multiple updates",
      );
      const oldOnlyUrl = `${origin}/assets/studio-offline-old-lazy.js`;
      assert.equal(
        (await fetch(oldOnlyUrl)).status,
        404,
        "Latest deployment no longer serves the old asset",
      );
      await context.setOffline(true);
      assert.equal(
        await oldPage.evaluate(async (url) => (await import(url)).marker, oldOnlyUrl),
        "old-only lazy asset",
        "Old editor can first-load its retired deployment's lazy module offline",
      );
      assert.ok((await PDFDocument.load(await download(oldPage, "#pdf"))).getPageCount() > 0);
      await oldPage.close();
      await context.setOffline(false);
      await preferences(page);
      await page.locator("#offline-prepare").click();
      await state(page, "ready");
      await page.waitForFunction(() => caches.keys().then((names) => names.length === 2));
      assert.equal(
        (await page.evaluate(() => caches.keys())).some((name) => name.endsWith(manifest.version)),
        false,
        "Closed old tab releases its cache while keeping current and fallback",
      );
      await page.keyboard.press("Escape");
      holdShell = true;
      const started = Date.now();
      await page.reload({ waitUntil: "domcontentloaded", timeout: 10000 });
      await ready(page);
      assert.ok(
        Date.now() - started < 8000,
        "Stalled online navigation falls back within a bounded interval",
      );
      holdShell = false;
      holdBody = true;
      const bodyStarted = Date.now();
      await page.reload({ waitUntil: "domcontentloaded", timeout: 10000 });
      await ready(page);
      assert.ok(
        Date.now() - bodyStarted < 8000,
        "Headers arriving without a complete body also fall back within the deadline",
      );
      holdBody = false;
      nextVersion = "";
      failAsset = false;
      console.log(
        "Studio offline: failed update preserves fallback; successful update preserves editor, live-version cache retirement and bounded stalled-network fallback: passed",
      );
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
