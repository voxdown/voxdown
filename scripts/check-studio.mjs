// Browser regression checks for the experimental Studio. Run after pnpm site:build.
import assert from "node:assert/strict";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, resolve } from "node:path";
import { chromium, firefox, webkit } from "playwright";
import { clickWorkspaceAction, openPreferences, selectPaper } from "./studio-ui.mjs";

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
const recentDownloads = new WeakMap();
context.on("page", (page) => {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("download", () => {
    const now = Date.now();
    recentDownloads.set(page, [
      ...(recentDownloads.get(page) ?? []).filter((at) => now - at < 1100),
      now,
    ]);
  });
});
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
  // This suite downloads after nearly every edit. Blink silently throttles bursts
  // of 10 downloads within one second (LocalFrame::ShouldThrottleDownload).
  // Pace the test's inspection downloads, keeping real browser download coverage.
  const recent = (recentDownloads.get(p) ?? []).filter((at) => Date.now() - at < 1100);
  if (recent.length >= 7)
    await new Promise((done) => setTimeout(done, Math.max(0, 1100 - (Date.now() - recent[0]))));
  const event = p.waitForEvent("download");
  void event.catch(() => {});
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
  await clickWorkspaceAction(page, "preferences");
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
  await clickWorkspaceAction(page, "preferences");
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
  await clickWorkspaceAction(page, "preferences");
  await page.locator("#screenplay-keys").check();
  await page.locator("#page-guides").check();
  await page.keyboard.press("Escape");
  await open(page, "INT. ROOM - DAY", "Screenplay-keys.fountain");
  await content.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  assert.equal(await save(page), "INT. ROOM - DAY\n\n");
  await content.focus();
  await page.keyboard.press("Control+z");
  assert.equal(await save(page), "INT. ROOM - DAY");
  await open(page, "", "Element-cycle.fountain");
  await content.focus();
  await page.keyboard.press("Tab");
  assert.equal(await save(page), "@");
  await content.focus();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");
  assert.equal(await content.evaluate((node) => node === document.activeElement), false);
  await open(page, "INT. ROOM\n\nAction.\n\n===\n\nEXT. PARK\n\nRain.", "Page-guides.fountain");
  assert.equal(await page.locator(".studio-page-guides span[title]").count(), 2);
  await openPreferences(page);
  await page.locator("#paper").evaluate((paper) => {
    paper.addEventListener(
      "change",
      () => {
        window.guideCountOnChange = document.querySelectorAll(
          ".studio-page-guides span[title]",
        ).length;
      },
      { once: true },
    );
  });
  await page.locator("#paper").selectOption("a4");
  assert.equal(await page.evaluate(() => window.guideCountOnChange), 0);
  await page.getByRole("button", { name: "Close preferences", exact: true }).click();
  await ready(page);
  assert.equal(await page.locator(".studio-page-guides span[title]").count(), 2);
  await selectPaper(page, "letter");
  await page.reload();
  await ready(page);
  await clickWorkspaceAction(page, "preferences");
  assert(await page.locator("#screenplay-keys").isChecked());
  assert(await page.locator("#page-guides").isChecked());
  await page.locator("#screenplay-keys").uncheck();
  await page.locator("#page-guides").uncheck();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 800, height: 844 });
  // The resize controller clamps saved panel widths on the next animation frame.
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  const tablet = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    editor: document.querySelector(".writing").getBoundingClientRect().height,
  }));
  assert.equal(tablet.overflow, false);
  assert(tablet.editor >= 560, `Tablet writing area too small: ${tablet.editor}`);
  await page.setViewportSize({ width: 1440, height: 1000 });
  console.log(
    "Studio: screenplay keys, focus escape, page guides, persistent preferences and tablet writing space: passed",
  );
  const renameSource =
    "INT. ROOM - DAY\n\nMARA (V.O.)\nHello, Mara. [[private]]\n\nJONAH ^\nHello.\n\nMARA\nAgain.";
  await open(page, renameSource, "Rename.fountain");
  await content.focus();
  await page.keyboard.press("Control+Home");
  await page.locator("#line-help").click();
  assert.equal(
    await page.getByRole("heading", { name: "Line 1: Scene heading", exact: true }).isVisible(),
    true,
  );
  await page.getByRole("button", { name: "Back to writing", exact: true }).click();
  await page.waitForFunction(
    () => document.activeElement === document.querySelector(".cm-content"),
  );
  await page.keyboard.press("Control+k");
  await page.getByRole("searchbox", { name: "Find a command" }).fill("Rename a character");
  await page.keyboard.press("Enter");
  const renameDialog = page.getByRole("dialog", { name: "Rename a character", exact: true });
  await renameDialog.getByLabel("Character", { exact: true }).selectOption("MARA");
  await renameDialog.getByLabel("New name", { exact: true }).fill("JONAH");
  await renameDialog.getByRole("button", { name: "Preview rename", exact: true }).click();
  assert.equal(
    await renameDialog.getByRole("button", { name: "Apply rename", exact: true }).isEnabled(),
    false,
  );
  await renameDialog
    .getByLabel("Merge these cues with the existing character of this name", { exact: true })
    .check();
  await renameDialog.getByRole("button", { name: "Apply rename", exact: true }).click();
  assert.equal(
    await save(page),
    renameSource.replace("MARA (V.O.)", "JONAH (V.O.)").replace("\nMARA\n", "\nJONAH\n"),
  );
  await content.focus();
  await page.keyboard.press("Control+z");
  assert.equal(await save(page), renameSource);
  console.log(
    "Studio: contextual line help, previewed cast merge, preserved private dialogue and atomic rename undo: passed",
  );
  const firstScene = "INT. ROOM - DAY #1#\n\n= A difficult choice\n\nMARA\nStay. [[private]]";
  const lastScene = "EXT. BEACH - NIGHT #2#\n\nJONAH\nGo.";
  const sceneSource = `Title: A Choice\n\n${firstScene}\n\n${lastScene}`;
  await open(page, sceneSource, "Scenes.fountain");
  await page.keyboard.press("Control+k");
  await page.getByRole("searchbox", { name: "Find a command" }).fill("Scene cards");
  await page.keyboard.press("Enter");
  const board = page.getByRole("dialog", { name: "Scene cards", exact: true });
  await board.getByRole("button", { name: "Move this scene…", exact: true }).first().click();
  await board.getByRole("combobox", { name: "Place scene", exact: true }).selectOption("after");
  await board.getByRole("combobox", { name: "Destination scene", exact: true }).selectOption("1");
  await board.getByRole("button", { name: "Preview move", exact: true }).click();
  await board.getByRole("button", { name: "Apply scene move", exact: true }).click();
  assert.equal(await save(page), `Title: A Choice\n\n${lastScene}\n\n${firstScene}`);
  await content.focus();
  await page.keyboard.press("Control+z");
  assert.equal(await save(page), sceneSource);
  console.log(
    "Studio: scene cards, exact scene move with notes/synopsis/title/numbering, EOF safety and atomic undo: passed",
  );
  const reviseSource =
    "INT. ROOM - DAY\n\nStay in the room.\n\nMARA\nStay. [[private Stay.]]\n\nJONAH\nStay.";
  await open(page, reviseSource, "Revisions.fountain");
  const runCommand = async (label) => {
    await page.locator("#commands").click();
    await page.getByRole("searchbox", { name: "Find a command" }).fill(label);
    await page.keyboard.press("Enter");
  };
  const locationSource =
    "Title: Locations\n\nINT. ROOM - DAY #1#\n\nROOM stays in action. [[ROOM private]]\n\nEXT. ROOM - NIGHT #2#\n\nA light.\n\n.MYSTERY\n\nUnqualified heading.";
  await open(page, locationSource, "Locations.fountain");
  await runCommand("Locations and location rename");
  await page.getByLabel("New location name", { exact: true }).fill("HALL");
  await page.getByRole("button", { name: "Preview location rename", exact: true }).click();
  await page.getByRole("button", { name: "Apply location rename", exact: true }).click();
  assert.equal(
    await save(page),
    locationSource.replace("INT. ROOM", "INT. HALL").replace("EXT. ROOM", "EXT. HALL"),
  );
  await content.focus();
  await page.keyboard.press("Control+z");
  assert.equal(await save(page), locationSource);
  await open(page, reviseSource, "Revisions.fountain");
  await runCommand("Scene cards and rearrangement");
  await page.getByRole("button", { name: "Add synopsis…", exact: true }).first().click();
  await page.getByLabel("Scene synopsis", { exact: true }).fill("Mara makes a decision.");
  await page.getByRole("button", { name: "Preview synopsis", exact: true }).click();
  await page.getByRole("button", { name: "Apply synopsis", exact: true }).click();
  assert.equal(
    await save(page),
    reviseSource.replace("INT. ROOM - DAY", "INT. ROOM - DAY\n= Mara makes a decision."),
  );
  await content.focus();
  await page.keyboard.press("Control+z");
  assert.equal(await save(page), reviseSource);
  await runCommand("Character dialogue");
  await page.locator(".workbench-content details").first().locator("summary").click();
  await page.getByRole("button", { name: "Edit this speech…", exact: true }).first().click();
  await page
    .getByRole("textbox", { name: "Speech source", exact: true })
    .fill("Go. [[private Stay.]]");
  await page.getByRole("button", { name: "Preview speech edit", exact: true }).click();
  await page.getByRole("button", { name: "Apply speech edit", exact: true }).click();
  assert.equal(await save(page), reviseSource.replace("Stay. [[", "Go. [["));
  await content.focus();
  await page.keyboard.press("Control+z");
  assert.equal(await save(page), reviseSource);
  await runCommand("Scoped find and replace");
  await page.getByLabel("Find text", { exact: true }).fill("Stay.");
  await page.getByLabel("Replacement text", { exact: true }).fill("Go.");
  await page.getByLabel("Search scope", { exact: true }).selectOption("dialogue");
  await page.getByRole("button", { name: "Preview replacements", exact: true }).click();
  await page.getByRole("button", { name: "Apply replacements", exact: true }).click();
  assert.equal(
    await save(page),
    reviseSource.replace("Stay. [[", "Go. [[").replace("JONAH\nStay.", "JONAH\nGo."),
  );
  await content.focus();
  await page.keyboard.press("Control+z");
  assert.equal(await save(page), reviseSource);
  await runCommand("Actor sides PDF");
  const sidesDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download actor sides PDF", exact: true }).click();
  const sidesPdf = await PDFDocument.load(readFileSync(await (await sidesDownload).path()));
  assert.match(sidesPdf.getTitle(), /MARA.*actor sides/);
  assert(sidesPdf.getPageCount() >= 2);
  await page
    .getByRole("dialog", { name: "Actor sides", exact: true })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  assert.equal(await save(page), reviseSource);
  await runCommand("Storage and backups");
  assert.equal(
    await page.getByRole("heading", { name: "Storage and backups", exact: true }).isVisible(),
    true,
  );
  await page.keyboard.press("Escape");
  await runCommand("Export Final Draft XML (FDX)");
  const fdxDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download FDX", exact: true }).click();
  const fdx = readFileSync(await (await fdxDownload).path(), "utf8");
  assert.match(fdx, /<FinalDraft /);
  assert.match(fdx, /<Paragraph Type="Scene Heading">/);
  assert(!fdx.includes("private Stay."));
  await page.keyboard.press("Escape");
  assert.equal(await save(page), reviseSource);
  await runCommand("Open text reference beside screenplay");
  const referenceSource = "<script>literal text only</script>\n[[private reference]]";
  await page.locator('.studio-reference input[type="file"]').setInputFiles({
    name: "Research.md",
    mimeType: "text/plain",
    buffer: Buffer.from(referenceSource),
  });
  await page.waitForFunction(() =>
    document.querySelector(".studio-reference textarea").value.includes("private reference"),
  );
  assert.equal(
    await page
      .getByRole("textbox", { name: "Reference text (read only)", exact: true })
      .inputValue(),
    referenceSource,
  );
  assert.equal(await save(page), reviseSource);
  await page.getByRole("tab", { name: "Page preview", exact: true }).click();
  await runCommand("Rehearsal cue cards");
  await page.getByRole("button", { name: "Start rehearsing", exact: true }).click();
  assert.equal(await page.locator(".rehearsal-answer").textContent(), "");
  await page.getByRole("button", { name: "Reveal speech", exact: true }).click();
  assert.match(await page.locator(".rehearsal-answer").textContent(), /Stay\./);
  assert(!(await page.locator(".rehearsal-dialog").textContent()).includes("private Stay."));
  await page.keyboard.press("Escape");
  assert.equal(await save(page), reviseSource);
  await runCommand("Practice Fountain step by step");
  await page.getByLabel("Practice text", { exact: true }).fill("INT. STUDY - DAY");
  assert.equal(
    await page.getByRole("button", { name: "Next lesson", exact: true }).isEnabled(),
    true,
  );
  await page.getByRole("button", { name: "Close practice", exact: true }).click();
  assert.equal(await save(page), reviseSource);
  await runCommand("Import Final Draft XML (FDX)");
  await page.getByLabel("FDX file", { exact: true }).setInputFiles({
    name: "Revisions.fdx",
    mimeType: "application/xml",
    buffer: Buffer.from(fdx),
  });
  await page.getByRole("button", { name: "Open as new screenplay", exact: true }).click();
  await ready(page);
  const imported = await save(page);
  assert(imported.includes("MARA"));
  assert.match(await page.locator("#page").innerText(), /Stay\./);
  assert(!imported.includes("private Stay."));
  await open(page, reviseSource, "Revisions-after-import.fountain");
  await runCommand("Number scenes");
  await page.getByRole("button", { name: "Preview scene numbering", exact: true }).click();
  await page.getByRole("button", { name: "Apply scene numbering", exact: true }).click();
  assert.equal(await save(page), reviseSource.replace("INT. ROOM - DAY", "INT. ROOM - DAY #1#"));
  await content.focus();
  await page.keyboard.press("Control+z");
  assert.equal(await save(page), reviseSource);
  await runCommand("Compare with local Fountain file");
  await page.getByLabel("Baseline Fountain or text file", { exact: true }).setInputFiles({
    name: "Previous.fountain",
    mimeType: "text/plain",
    buffer: Buffer.from(reviseSource.replaceAll("Stay.", "Wait.")),
  });
  await page.getByRole("button", { name: "Compare source", exact: true }).click();
  assert(
    (await page.locator(".comparison-word-added").allTextContents()).some((text) =>
      text.includes("Stay"),
    ),
  );
  await page.keyboard.press("Escape");
  await runCommand("Adapt screenplay to VoxDown");
  const adaptedDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download adapted .vxd", exact: true }).click();
  const adapted = readFileSync(await (await adaptedDownload).path(), "utf8");
  assert(adapted.includes("Cast1"));
  assert(!adapted.includes("private Stay."));
  await page.keyboard.press("Escape");
  assert.equal(await save(page), reviseSource);
  await runCommand("Scene and cast breakdown");
  const breakdownDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download filtered CSV", exact: true }).click();
  const csv = readFileSync(await (await breakdownDownload).path(), "utf8");
  assert(csv.includes("MARA"));
  assert(!csv.includes("private Stay."));
  await page.keyboard.press("Escape");
  assert.equal(await save(page), reviseSource);
  // A real File/DataTransfer drop follows the same source/recovery guards as Open.
  const dropSource = "\uFEFFINT. DROP - DAY\r\n\r\nA safe landing.\r\n";
  await page.evaluate((source) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([source], "Dropped.fountain", { type: "text/plain" }));
    document
      .querySelector(".cm-content")
      .dispatchEvent(
        new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
  }, dropSource);
  await page.waitForFunction(() => document.getElementById("name").value === "Dropped.fountain");
  await ready(page);
  assert.equal(await save(page), dropSource);
  await open(page, reviseSource, "Revisions-after-drop.fountain");
  console.log(
    "Studio: location rename, speech editing, scoped replacement, performer PDF, storage information and separate literal reference: passed",
  );
  const nestedPrivate = "INT. ROOM - DAY\n\nMARA\nHello. [[private [[inner]] still private]]";
  await open(page, nestedPrivate, "Ambiguous.fountain");
  let ambiguousDownloads = 0;
  const countAmbiguous = () => {
    ambiguousDownloads++;
  };
  page.on("download", countAmbiguous);
  await page.locator("#pdf").click();
  await page.waitForFunction(() =>
    document.getElementById("notice").textContent.includes("Nested private"),
  );
  assert.equal(ambiguousDownloads, 0);
  page.off("download", countAmbiguous);
  assert.equal(await save(page), nestedPrivate);
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
  await clickWorkspaceAction(page, "preferences");
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
  await clickWorkspaceAction(page, "preferences");
  await page.locator("#theme").selectOption("light");
  await page.locator("#text-size").selectOption("16");
  await page.locator("#typewriter").uncheck();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  await page.getByRole("searchbox", { name: "Find a command" }).fill("Writing statistics");
  await page.keyboard.press("Enter");
  assert.equal(await page.getByRole("heading", { name: "Screenplay workbench" }).isVisible(), true);
  await page.keyboard.press("Escape");
  await clickWorkspaceAction(page, "example");
  await page.waitForFunction(() => document.getElementById("scene-count").textContent === "2");
  await ready(page);
  await page.locator("#scene-search").fill("HARBOR");
  assert.equal(await page.locator("#scene-list button").count(), 1);
  await page.locator("#scene-list button").click();
  await clickWorkspaceAction(page, "caret-page");
  assert.match(await page.locator("#page").innerText(), /HARBOR/);
  await page.locator("#scene-search").fill("");
  await clickWorkspaceAction(page, "workbench");
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
  await clickWorkspaceAction(page, "recent");
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
  await openPreferences(page);
  await page.locator("#margins").uncheck();
  assert.equal(await page.locator(".f-character").count(), 0);
  await page.locator("#margins").check();
  assert.equal((await page.locator(".f-character").count()) > 0, true);
  await page.getByRole("button", { name: "Close preferences", exact: true }).click();
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
  await selectPaper(page, "a4");
  await ready(page);
  const a4Event = page.waitForEvent("download");
  await page.locator("#pdf").click();
  const a4 = await PDFDocument.load(readFileSync(await (await a4Event).path()));
  assert.deepEqual(a4.getPage(1).getSize(), { width: 595.276, height: 841.89 });
  await selectPaper(page, "letter");
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
  await clickWorkspaceAction(recovery, "new");
  assert.equal(await recovery.locator("#app").evaluate((app) => app.inert), true);
  await ready(recovery);
  assert.equal(await save(recovery), "");
  await clickWorkspaceAction(recovery, "recent");
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
    // WebKit can replace the indexedDB host wrapper and lose an instance override.
    // Patch the prototype so storage remains unavailable throughout this scenario.
    Object.defineProperty(IDBFactory.prototype, "open", {
      configurable: true,
      writable: true,
      value() {
        throw new Error("Storage disabled");
      },
    });
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
  await clickWorkspaceAction(degraded, "new");
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
  // JSON can losslessly carry a lone UTF-16 surrogate; UTF-8 text files cannot.
  // A rejected text download must never satisfy the recovery-loss escape hatch.
  const incompleteUnicode = "INT. ROOM\n\n!A\ud800B";
  const unicodeBackup = {
    format: "voxdown-studio-project",
    version: 1,
    draft: { name: "Unicode.fountain", source: incompleteUnicode },
    snapshots: [],
  };
  await degraded.locator("#commands").click();
  await degraded.getByRole("button", { name: "Portable backup and restore", exact: true }).click();
  await degraded.getByLabel("Open Studio backup file").setInputFiles({
    name: "unicode.studio.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(unicodeBackup)),
  });
  await degraded
    .getByRole("button", { name: "Open selected item as a new draft", exact: true })
    .click();
  await degraded.waitForFunction(
    () => document.getElementById("name").value === "Unicode.fountain",
  );
  let lossyDownloads = 0;
  const countLossy = () => lossyDownloads++;
  degraded.on("download", countLossy);
  await degraded.locator("#download").click();
  assert.match(await degraded.locator("#notice").textContent(), /incomplete Unicode character/);
  const cancelLoss = degraded.waitForEvent("dialog").then((dialog) => dialog.dismiss());
  await clickWorkspaceAction(degraded, "new");
  await cancelLoss;
  assert.equal(await degraded.locator("#name").inputValue(), "Unicode.fountain");
  assert.equal(lossyDownloads, 0);
  degraded.off("download", countLossy);
  await degraded.locator("#commands").click();
  await degraded.getByRole("button", { name: "Portable backup and restore", exact: true }).click();
  const exactBackup = degraded.waitForEvent("download");
  await degraded.getByRole("button", { name: "Download backup", exact: true }).click();
  const preserved = JSON.parse(readFileSync(await (await exactBackup).path(), "utf8"));
  assert.equal(preserved.draft.source, incompleteUnicode);
  await degraded.keyboard.press("Escape");
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
  await mobile.locator("#commands").click();
  await mobile.getByRole("searchbox", { name: "Find a command" }).fill("Fountain guide");
  await mobile.keyboard.press("Enter");
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
