// Browser regression checks for the experimental Studio. Run after pnpm site:build.
import assert from "node:assert/strict";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, resolve } from "node:path";
import { chromium, firefox, webkit } from "playwright";

const { PDFDocument } = createRequire(resolve("site/package.json"))("pdf-lib");

const dist = resolve("site/dist");
const server = createServer((req, res) => {
  let file = resolve(dist, `.${decodeURIComponent(new URL(req.url, "http://local").pathname)}`);
  if (!file.startsWith(`${dist}/`)) return res.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) file = resolve(file, "index.html");
  if (!existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, {
    "Content-Type":
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".ttf": "font/ttf",
        ".svg": "image/svg+xml",
      }[extname(file)] ?? "application/octet-stream",
  });
  createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const engine = process.env.STUDIO_BROWSER ?? "chromium";
const browserType = { chromium, webkit, firefox }[engine];
if (!browserType) throw new Error(`Unknown browser ${engine}`);
const browser = await browserType.launch({
  ...(process.env.STUDIO_BROWSER_EXECUTABLE
    ? { executablePath: process.env.STUDIO_BROWSER_EXECUTABLE }
    : {}),
});
const errors = [];
const external = [];
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
context.on("request", (request) => {
  if (!request.url().startsWith(base) && !request.url().startsWith("blob:"))
    external.push(request.url());
});
const page = await context.newPage();
const ready = async (p) => {
  await p.waitForFunction(
    () =>
      !document.getElementById("app").inert &&
      !document.getElementById("counts").textContent.includes("Updating"),
  );
};
const open = async (p, source, name = "Test.fountain") => {
  await p
    .locator("#file")
    .setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(source) });
  await p.waitForFunction((name) => document.getElementById("name").value === name, name);
  await ready(p);
};
const save = async (p) => {
  const event = p.waitForEvent("download");
  await p.locator("#download").click();
  return readFileSync(await (await event).path(), "utf8");
};
try {
  await page.goto(`${base}/studio/`);
  await ready(page);
  assert.equal(await page.locator("#pdf").isEnabled(), true);
  await open(page, "", "Typing.fountain");
  const content = page.locator(".cm-content");
  await content.focus();
  await page.keyboard.type("[[");
  assert.equal(await save(page), "[[]]");
  await content.focus();
  await page.keyboard.type("a note]] after");
  assert.equal(await save(page), "[[a note]] after");
  await open(page, "", "Empty-pair.fountain");
  await content.focus();
  await page.keyboard.type("[[");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  assert.equal(await save(page), "");
  await open(page, "words", "Formatting.fountain");
  await content.focus();
  await page.keyboard.press("Control+a");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  assert.equal(await save(page), "**words**");
  await content.focus();
  await page.keyboard.press("Control+i");
  assert.equal(await save(page), "***words***");
  await content.focus();
  await page.keyboard.press("Control+z");
  assert.equal(await save(page), "**words**");
  await open(page, "before [[private]] after", "Private.fountain");
  await content.focus();
  await page.keyboard.press("Control+a");
  await page.locator('[data-writing-mark="note"]').click();
  assert.equal(await save(page), "before [[private]] after");
  await page.locator("#preferences").click();
  await page.locator("#smart-pairs").uncheck();
  await page.keyboard.press("Escape");
  await open(page, "", "Pairs-off.fountain");
  await content.focus();
  await page.keyboard.type("[[");
  assert.equal(await save(page), "[[");
  await page.reload();
  await ready(page);
  await open(page, "", "Still-off.fountain");
  await content.focus();
  await page.keyboard.type("(");
  assert.equal(await save(page), "(");
  await page.locator("#preferences").click();
  await page.locator("#smart-pairs").check();
  await page.keyboard.press("Escape");
  await open(page, "", "Paste.fountain");
  await content.focus();
  await content.evaluate((node) => {
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    // Firefox intentionally strips data from synthetic ClipboardEvents; provide a deterministic
    // clipboard fixture while still exercising CodeMirror's actual paste handler.
    Object.defineProperty(event, "clipboardData", {
      value: { getData: (type) => (type === "text/plain" ? "[[pasted" : "") },
    });
    node.dispatchEvent(event);
  });
  assert.equal(await save(page), "[[pasted");
  console.log(
    "Studio: pairing, overtyping, selection formatting, undo, safe notes, pasted text and persistent opt-out: passed",
  );
  await open(page, "/*secret tail*/", "Partial-private.fountain");
  await content.focus();
  await page.keyboard.press("Control+Home");
  for (let i = 0; i < 8; i++) await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.type("[[");
  assert.equal(await save(page), "/*secret tail*/");
  await open(page, "words", "Note-button.fountain");
  await content.focus();
  await page.keyboard.press("Control+a");
  await page.locator('[data-writing-mark="note"]').click();
  await content.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("]]");
  assert.equal(await save(page), "[[words]]");
  await open(page, "a room", "Element.fountain");
  await content.focus();
  await page.keyboard.press("Control+Home");
  await page.locator("#element-action").selectOption("scene");
  assert.equal(await save(page), ".a room");
  await content.focus();
  await page.keyboard.press("Control+z");
  assert.equal(await save(page), "a room");
  await page.locator("#preferences").click();
  await page.locator("#theme").selectOption("dark");
  await page.locator("#text-size").selectOption("20");
  await page.locator("#typewriter").check();
  await page.keyboard.press("Escape");
  await page.reload();
  await ready(page);
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  assert.equal(
    await page.locator(".cm-editor").evaluate((el) => getComputedStyle(el).fontSize),
    "20px",
  );
  await page.locator("#focus-mode").click();
  assert.equal(await page.locator("#preview").isVisible(), false);
  await page.locator("#focus-mode").click();
  await page.locator("#preferences").click();
  await page.locator("#theme").selectOption("light");
  await page.locator("#text-size").selectOption("16");
  await page.locator("#typewriter").uncheck();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  await page.getByRole("searchbox", { name: "Find a command" }).fill("Writing statistics");
  await page.keyboard.press("Enter");
  assert.equal(await page.getByRole("heading", { name: "Screenplay workbench" }).isVisible(), true);
  await page.keyboard.press("Escape");
  await page.locator("#example").click();
  await page.waitForFunction(() => document.getElementById("scene-count").textContent === "2");
  await ready(page);
  await page.locator("#scene-search").fill("HARBOR");
  assert.equal(await page.locator("#scene-list button").count(), 1);
  await page.locator("#scene-list button").click();
  await page.locator("#caret-page").click();
  assert.match(await page.locator("#page").innerText(), /HARBOR/);
  await page.locator("#scene-search").fill("");
  await page.locator("#workbench").click();
  await page.getByRole("combobox", { name: "Workbench view" }).selectOption("notes");
  assert.match(await page.locator(".workbench-content").innerText(), /This note stays out/);
  await page.getByRole("combobox", { name: "Workbench view" }).selectOption("characters");
  assert.match(await page.locator(".workbench-content").innerText(), /MARA/);
  await page.locator(".workbench-content summary").filter({ hasText: "MARA" }).click();
  await page.waitForFunction(() =>
    document
      .querySelector(".character-speeches")
      ?.textContent.includes("Someone is still out there."),
  );
  assert.doesNotMatch(
    await page.locator(".character-speeches").first().innerText(),
    /This note stays out/,
  );
  await page.keyboard.press("Escape");
  await page.locator("#recent").click();
  await page.getByLabel("Snapshot name").fill("Before revision");
  await page.getByRole("button", { name: "Save snapshot of current draft" }).click();
  await page.getByRole("button", { name: "Compare Before revision with current draft" }).click();
  await page.waitForFunction(() =>
    document.querySelector(".library-comparison").textContent.includes("texts are identical"),
  );
  await page.keyboard.press("Escape");
  await page.locator("#commands").click();
  await page.getByRole("button", { name: "Portable backup and restore", exact: true }).click();
  const backupEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download backup", exact: true }).click();
  const backupData = readFileSync(await (await backupEvent).path(), "utf8");
  assert.match(JSON.parse(backupData).draft.source, /This note stays out/);
  await page.getByLabel("Open Studio backup file").setInputFiles({
    name: "test.studio.json",
    mimeType: "application/json",
    buffer: Buffer.from(backupData),
  });
  await page.getByRole("button", { name: "Open selected item as a new draft" }).click();
  await ready(page);
  await page.locator("#commands").click();
  await page.getByRole("button", { name: "Portable backup and restore", exact: true }).click();
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      const bytes = await original.call(this);
      if (this.name === "abandoned.studio.json")
        await new Promise((resolve) => {
          window.finishBackupRead = resolve;
        });
      return bytes;
    };
  });
  await page.getByLabel("Open Studio backup file").setInputFiles({
    name: "abandoned.studio.json",
    mimeType: "application/json",
    buffer: Buffer.from(backupData),
  });
  await page.waitForFunction(() => Boolean(window.finishBackupRead));
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    window.finishBackupRead();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.locator("#commands").click();
  await page.getByRole("button", { name: "Portable backup and restore", exact: true }).click();
  assert.equal(await page.getByLabel("Draft or snapshot to open").isVisible(), false);
  await page.keyboard.press("Escape");
  console.log(
    "Studio: element undo, preference persistence, palette, navigator, workbench, snapshot comparison and portable backup: passed",
  );
  assert.equal((await page.locator(".f-character").count()) > 0, true);
  await page.locator("#margins").uncheck();
  assert.equal(await page.locator(".f-character").count(), 0);
  await page.locator("#margins").check();
  assert.equal((await page.locator(".f-character").count()) > 0, true);
  await page.locator("#next").click();
  assert.match(await page.locator("#page").innerText(), /Someone is still out there/);
  assert.doesNotMatch(await page.locator("#page").innerText(), /This note/);
  await mkdir("/tmp/voxdown-studio", { recursive: true });
  await page.screenshot({ path: "/tmp/voxdown-studio/desktop.png" });
  const pdfEvent = page.waitForEvent("download");
  await page.locator("#pdf").click();
  const pdf = await pdfEvent;
  await pdf.saveAs("/tmp/voxdown-studio/screenplay.pdf");
  assert.equal(
    readFileSync(await pdf.path())
      .subarray(0, 5)
      .toString(),
    "%PDF-",
  );
  const letter = await PDFDocument.load(readFileSync(await pdf.path()));
  assert.equal(letter.getPageCount(), 2);
  assert.deepEqual(letter.getPage(1).getSize(), { width: 612, height: 792 });
  await page.locator("#paper").selectOption("a4");
  await ready(page);
  const a4Event = page.waitForEvent("download");
  await page.locator("#pdf").click();
  const a4 = await PDFDocument.load(readFileSync(await (await a4Event).path()));
  assert.deepEqual(a4.getPage(1).getSize(), { width: 595.276, height: 841.89 });
  await page.locator("#paper").selectOption("letter");
  await ready(page);
  const exact =
    "\uFEFFTitle: Café\r\n\r\nINT. ROOM - DAY #1A#\n\nADA\r\nA line.\r\n\r\n/* omitted */\r\n";
  await open(page, exact, "Exact.fountain");
  assert.equal(await save(page), exact);
  await page.reload();
  await ready(page);
  assert.equal(await save(page), exact);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nNew action.");
  await ready(page);
  assert.match(await save(page), /New action/);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+z");
  await page.waitForFunction(
    () => !document.querySelector(".cm-content").textContent.includes("New action"),
  );
  console.log("Studio: exact source roundtrip, recovery, undo, live margins, scenes, PDF: passed");

  const peer = await context.newPage();
  await peer.goto(`${base}/studio/`);
  await ready(peer);
  await open(peer, "INT. PEER ROOM - DAY\n\nPeer only.\n", "Peer.fountain");
  await open(page, "INT. FIRST ROOM - NIGHT\n\nFirst only.\n", "First.fountain");
  await peer.reload();
  await ready(peer);
  assert.match(await save(peer), /Peer only/);
  await page.reload();
  await ready(page);
  assert.match(await save(page), /First only/);
  console.log("Studio: independent tabs retain their own drafts: passed");

  await open(
    page,
    "INT. ROOM - DAY\n\nA <img src=x onerror=alert(1)> sign.\n\n[[private",
    "Hostile.fountain",
  );
  assert.equal(await page.locator("#pdf").isDisabled(), true);
  assert.match(await page.locator("#issues").innerText(), /Unclosed note/);
  await save(page);
  assert.match(await page.locator("#issues").innerText(), /Unclosed note/);
  assert.equal(await page.locator("#page img, #scene-list img").count(), 0);
  await open(page, "INT. ROOM - DAY\n\nA smiling 😀 face.\n", "Unicode.fountain");
  await page.locator("#pdf").click();
  await page.waitForFunction(() =>
    document.getElementById("notice").textContent.includes("cannot print"),
  );
  assert.match(await save(page), /😀/);
  console.log(
    "Studio: malformed comments block export, hostile text stays inert, unsupported glyphs reported: passed",
  );

  const long = Array.from(
    { length: 250 },
    (_, i) =>
      `INT. ROOM ${i} - DAY\n\n${"The light sweeps the room. ".repeat(18)}\n\nMARA\n${"Do you hear that? ".repeat(12)}\n`,
  ).join("\n");
  const started = Date.now();
  await open(page, long, "Long.fountain");
  assert.equal(await page.locator("#scene-count").textContent(), "250");
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1),
    true,
    "Long editor stays inside the workspace",
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 8000, `Long script took ${elapsed}ms`);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nLast word.");
  await ready(page);
  console.log(`Studio: ${long.length.toLocaleString()}-character screenplay layout: ${elapsed}ms`);

  await open(page, Array.from({ length: 501 }, (_, i) => `INT. ROOM ${i} - DAY\n`).join("\n"));
  assert.equal(await page.locator("#scene-count").textContent(), "501");
  assert.equal(await page.locator("#scene-list button").count(), 500);
  assert.match(await page.locator("#scene-list p").innerText(), /Showing 500/);

  const recovery = await context.newPage();
  await recovery.addInitScript(() => {
    const original = indexedDB.open;
    indexedDB.open = function (...args) {
      const request = original.apply(this, args);
      Object.defineProperty(request, "onsuccess", {
        set(callback) {
          request.addEventListener("success", (event) => setTimeout(() => callback(event), 800));
        },
      });
      return request;
    };
    const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, "oncomplete");
    Object.defineProperty(IDBTransaction.prototype, "oncomplete", {
      ...descriptor,
      set(callback) {
        descriptor.set.call(this, (event) => {
          if (window.delayStudioWrites) setTimeout(() => callback(event), 800);
          else callback(event);
        });
      },
    });
  });
  await recovery.goto(`${base}/studio/`);
  await recovery.waitForSelector(".cm-content");
  assert.equal(await recovery.locator("#app").evaluate((app) => app.inert), true);
  await ready(recovery);
  await open(recovery, "INT. SAFE ROOM - DAY\n\nKeep this draft.\n", "Safe.fountain");
  await recovery.evaluate(() => {
    window.delayStudioWrites = true;
  });
  await recovery.locator("#new").click();
  assert.equal(await recovery.locator("#app").evaluate((app) => app.inert), true);
  await ready(recovery);
  assert.equal(await save(recovery), "");
  await recovery.locator("#recent").click();
  await recovery.getByRole("button", { name: /Open Safe.fountain/ }).click();
  await ready(recovery);
  assert.match(await save(recovery), /Keep this draft/);
  console.log(
    "Studio: startup and replacement locks, recovery after replacement, bounded outline: passed",
  );

  const degradedContext = await browser.newContext({ acceptDownloads: true });
  const degraded = await degradedContext.newPage();
  await degraded.addInitScript(() => {
    window.Worker = class {
      constructor() {
        throw new Error("Worker blocked");
      }
    };
    indexedDB.open = () => {
      throw new Error("Storage disabled");
    };
  });
  await degraded.goto(`${base}/studio/`);
  await ready(degraded);
  assert.match(await degraded.locator("#recovery").innerText(), /Recovery unavailable/);
  assert.match(await degraded.locator("#notice").innerText(), /worker could not start/);
  assert.equal(await degraded.locator("#pdf").isDisabled(), true);
  await degraded.locator(".cm-content").fill("INT. SAFE - DAY\n\nStill editable.");
  assert.match(await save(degraded), /Still editable/);
  await degraded.locator(".cm-content").fill("INT. SAFE - DAY\n\nUndownloaded change.");
  const confirm = degraded.waitForEvent("dialog").then((dialog) => dialog.dismiss());
  await degraded.locator("#new").click();
  await confirm;
  assert.match(await save(degraded), /Undownloaded change/);
  await degraded.locator(".cm-content").fill("Keep this unsaved screenplay.");
  await degraded.locator("#commands").click();
  await degraded.getByRole("button", { name: "Portable backup and restore", exact: true }).click();
  await degraded.getByLabel("Open Studio backup file").setInputFiles({
    name: "cancel.studio.json",
    mimeType: "application/json",
    buffer: Buffer.from(backupData),
  });
  const cancelRestore = degraded.waitForEvent("dialog").then((dialog) => dialog.dismiss());
  await degraded.getByRole("button", { name: "Open selected item as a new draft" }).click();
  await cancelRestore;
  await degraded.getByLabel("Draft or snapshot to open").waitFor({ state: "visible" });
  assert.equal(
    await degraded.getByRole("button", { name: "Open selected item as a new draft" }).isVisible(),
    true,
  );
  await degraded.keyboard.press("Escape");
  assert.equal(await save(degraded), "Keep this unsaved screenplay.");
  await degradedContext.close();
  console.log("Studio: blocked worker and unavailable storage preserve editing/download: passed");

  const stale = await context.newPage();
  await stale.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      postMessage(value) {
        if (value.source.includes("STALE")) {
          window.studioDelayedMessage = true;
          setTimeout(() => super.postMessage(value), 700);
        } else super.postMessage(value);
      }
    };
  });
  await stale.goto(`${base}/studio/`);
  await ready(stale);
  await stale.locator("#file").setInputFiles({
    name: "Stale.fountain",
    mimeType: "text/plain",
    buffer: Buffer.from("INT. STALE ROOM - DAY\n"),
  });
  await stale.waitForFunction(() => document.getElementById("name").value === "Stale.fountain");
  await stale.waitForFunction(() => window.studioDelayedMessage === true);
  await open(stale, "EXT. CURRENT ROOM - NIGHT\n", "Current.fountain");
  // Allow the intentionally delayed old worker reply to arrive.
  await stale.waitForTimeout(1000);
  assert.match(await stale.locator("#scene-list").innerText(), /CURRENT/);
  assert.doesNotMatch(await stale.locator("#page").innerText(), /STALE/);
  console.log("Studio: delayed stale worker results cannot replace the current preview: passed");

  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 393, height: 852 });
  await mobile.goto(`${base}/studio/`);
  await ready(mobile);
  await open(mobile, "INT. ROOM - DAY\n\nMARA\nA line on the phone.\n", "Mobile.fountain");
  assert.equal(await mobile.locator(".writing").isVisible(), true);
  assert.equal(
    await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await mobile.locator("#preview-toggle").click();
  assert.equal(await mobile.locator("#preview").isVisible(), true);
  await mobile.screenshot({ path: "/tmp/voxdown-studio/mobile-preview.png" });
  await mobile.locator("#zoom").click();
  assert.equal(await mobile.locator("#page").evaluate((p) => p.clientWidth), 816);
  assert.equal(
    await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await mobile.locator("#zoom").click();
  await mobile.locator("#preview-toggle").click();
  await mobile.locator("#outline-toggle").click();
  await mobile.locator("#scene-list button").click();
  assert.equal(await mobile.locator("#outline-toggle").getAttribute("aria-expanded"), "false");
  await mobile.screenshot({ path: "/tmp/voxdown-studio/mobile-editor.png" });
  await mobile.locator("#help").click();
  await mobile.keyboard.press("Escape");
  assert.equal(await mobile.locator("#guide").isVisible(), false);
  await context.setOffline(true);
  await mobile.locator(".cm-content").click();
  await mobile.keyboard.press("Control+End");
  await mobile.keyboard.type("\nOffline line.");
  await ready(mobile);
  assert.match(await save(mobile), /Offline line/);
  await context.setOffline(false);
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  console.log(
    "Studio: phone layout, keyboard dialogs, offline editing and source download, no external requests: passed",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
