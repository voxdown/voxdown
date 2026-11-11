// Checks the built playground in a real browser: every example, every tab, no errors.
// Run after `pnpm site:build`: node scripts/check-site.mjs
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

// Undo takes typing back.
await page.click(`.example[data-name="${names[0]}"]`);
await page.click(".cm-content");
await page.keyboard.press("Control+End");
await page.keyboard.type(" Zebra.");
await page.keyboard.press("Control+z");
await page.waitForTimeout(200);
if ((await page.locator(".cm-content").innerText()).includes("Zebra."))
  problems.push("playground: Ctrl+Z doesn't undo typing");

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
// The view is drawn again a moment after a story opens: wait until it stays as it is.
const settle = async () => {
  let last = "";
  for (let tries = 0; tries < 30; tries++) {
    const now = await page.evaluate(() => document.querySelector("#output")?.innerHTML ?? "");
    if (now === last) return;
    last = now;
    await page.waitForTimeout(150);
  }
};
await settle();
if (await page.locator("#output .linked").count())
  problems.push("linking: a story just opened already has a marked place");
const speech = page.locator("#output .vxd-speech:not(.vxd-narration)").nth(3);
// The words alone, without the direction label drawn above them; tried again should the view
// be drawn anew meanwhile.
let said = "";
for (let tries = 0; ; tries++) {
  try {
    await speech.scrollIntoViewIfNeeded();
    said = await speech.evaluate((element) => {
      const words = element.cloneNode(true);
      for (const label of words.querySelectorAll(".vxd-direction")) label.remove();
      return words.textContent.replace(/[“”"]/g, "").trim().split(/\s+/).slice(0, 3).join(" ");
    });
    break;
  } catch (error) {
    if (tries >= 3) throw error;
    await settle();
  }
}
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

// Every recorded story has its Listen beside it on the shelf, opening the listening page on it.
const recorded = readdirSync(join(site, "src", "recordings")).filter((file) =>
  file.endsWith(".json"),
);
const chips = await page.$$eval(".listen-chip", (links) =>
  links.map((link) => link.getAttribute("href")),
);
for (const file of recorded) {
  if (!chips.includes(`./listen.html#${file.replace(/\.json$/, "")}`))
    problems.push(`playground: no Listen beside ${file.replace(/\.json$/, ".vxd")}`);
}
console.log(`shelf: Listen beside ${chips.length} recorded stories: ok`);

// The pages fill the window between the shelf and the colophon, and never cover the colophon:
// at a wide window, one where the shelf wraps, and a short one.
for (const [width, height] of [
  [1640, 760],
  [1280, 720],
  [1024, 560],
]) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(150);
  const layout = await page.evaluate(() => {
    const pages = [...document.querySelectorAll(".page")].map((p) => p.getBoundingClientRect());
    const colophon = document.querySelector(".colophon")?.getBoundingClientRect();
    return {
      bottom: Math.max(...pages.map((p) => p.bottom)),
      colophon: colophon?.top ?? 0,
      tall: Math.min(...pages.map((p) => p.height)),
    };
  });
  if (layout.bottom > layout.colophon + 0.5)
    problems.push(`layout at ${width}×${height}: the pages cover the colophon`);
  if (layout.tall < 300) problems.push(`layout at ${width}×${height}: the pages are too short`);
}
await page.setViewportSize({ width: 1440, height: 900 });
console.log("layout: the pages never cover the colophon: ok");

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

/** The text of the story the Writer keeps as the open one, from the page's IndexedDB. */
const draftIn = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.open("voxdown-writer");
        request.onsuccess = () => {
          const transaction = request.result.transaction(["drafts", "documents"]);
          const pointer = transaction.objectStore("drafts").get("current");
          pointer.onsuccess = () => {
            const id = pointer.result?.id;
            if (!id) return resolve("");
            const draft = transaction.objectStore("documents").get(id);
            draft.onsuccess = () => resolve(draft.result?.text ?? "");
          };
        };
      }),
  );

/** The real books, one after another: long stories to try the Writer on. */
const corpusDir = join(site, "..", "corpus");
const bodies = readdirSync(corpusDir)
  .filter((name) => name.endsWith(".vxd"))
  .map((name) =>
    readFileSync(join(corpusDir, name), "utf8")
      .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
      .replace(/\r\n/g, "\n"),
  )
  .join("\n\n");

// The Writer: the welcome, an example with its scenes on the rail, a jump to a scene, typing,
// saving to a file (a stand-in for the one Chrome gives pages), the draft brought back after a
// reload, asking before putting changes aside, and the warnings.
const writerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await writerContext.addInitScript(() => {
  const files = {};
  window.__files = files;
  const handle = (name) => ({
    kind: "file",
    name,
    getFile: async () => new File([files[name] ?? ""], name),
    createWritable: async () => {
      let written = "";
      return {
        write: async (text) => {
          written += text;
        },
        close: async () => {
          files[name] = written;
        },
      };
    },
    isSameEntry: async (other) => other.name === name,
    queryPermission: async () => "granted",
    requestPermission: async () => "granted",
  });
  window.showSaveFilePicker = async ({ suggestedName }) => handle(suggestedName);
  window.showOpenFilePicker = async () => {
    files["opened.vxd"] ??= "# Opened\n\n@Ann “Hi.” @Bob\n\n* * *\n\nThe end.\n";
    return [handle("opened.vxd")];
  };
});
const writer = await writerContext.newPage();
watch(writer, "writer");
await writer.goto(`${base}/writer/`);
await writer.waitForSelector("#welcome:not([hidden])");
// With no story open, what needs one waits for it.
if ((await writer.getAttribute('.menus [data-command="save"]', "aria-disabled")) !== "true")
  problems.push("writer: Save can be chosen on the welcome, with no story open");
const dragonName = "the-dragon-who-would-not-roar.vxd";
const dragon = readFileSync(join(site, "..", "examples", dragonName), "utf8");
await writer.click(`.welcome-example[data-name="${dragonName}"]`);
await writer.waitForSelector("#welcome", { state: "hidden" });
const railNames = await writer.$$eval("#rail-scenes .scene-rail-name", (names) =>
  names.map((name) => name.textContent),
);
const headings = dragon.match(/^#{1,6} .+$|^\* \* \*$|^\*\*\*$/gm) ?? [];
if (railNames.length !== headings.length)
  problems.push(`writer: ${railNames.length} scenes on the rail, ${headings.length} in the story`);
await writer.click("#rail-scenes li:nth-child(4) button");
await writer.waitForTimeout(300);
const current = await writer
  .$eval("#rail-scenes button[aria-current=true] .scene-rail-name", (name) => name.textContent)
  .catch(() => null);
if (current !== railNames[3])
  problems.push(`writer: after a jump to “${railNames[3]}”, the rail marks “${current}”`);
// The outline: the last chapter or scene found by typing its name, gone to with Enter.
const lastScene = railNames.at(-1) ?? "";
const headingLines = dragon
  .split("\n")
  .flatMap((line, index) =>
    /^#{1,6} .+$|^\* \* \*$|^\*\*\*$/.test(line.trimEnd()) ? [index + 1] : [],
  );
await writer.keyboard.press("Control+Shift+O");
await writer.waitForSelector("#outline[open]");
await writer.keyboard.type(lastScene);
await writer.keyboard.press("Enter");
await writer.waitForSelector("#outline", { state: "hidden" });
await writer.waitForTimeout(200);
const outlinePlace = await writer.textContent("#cursor-place");
if (!outlinePlace?.startsWith(`Line ${headingLines.at(-1)},`))
  problems.push(`writer: going to “${lastScene}” from the outline went to ${outlinePlace}`);
await writer.click("#rail-scenes li:nth-child(4) button");
await writer.waitForTimeout(300);
await writer.keyboard.type("New words. ");
await writer.waitForTimeout(250);
if ((await writer.getAttribute("#save-state", "data-state")) !== "unsaved")
  problems.push("writer: typing doesn't show changes to save");
await writer.keyboard.press("Control+s");
await writer.waitForFunction(
  () => document.querySelector("#save-state")?.getAttribute("data-state") === "saved",
);
const savedText = await writer.evaluate(() => Object.values(window.__files)[0] ?? "");
if (!savedText.includes("New words."))
  problems.push("writer: Save didn't write the story to its file");
// Saving automatically is for later: here the draft alone must bring the words back.
await writer.click("#file-menu-button");
await writer.click('[data-view="autosave"]');
await writer.keyboard.press("Escape");
await writer.click(".cm-content");
await writer.keyboard.press("Control+End");
await writer.keyboard.type("Not saved yet. ");
await writer.waitForTimeout(1200);
await writer.reload();
await writer.waitForSelector(".cm-content");
await writer.waitForTimeout(300);
const restored = await draftIn(writer);
if (!restored.includes("Not saved yet."))
  problems.push("writer: the draft wasn't kept in the browser");
if (!(await writer.textContent("#draft-state"))?.startsWith("Brought back"))
  problems.push("writer: after a reload, it doesn't say it brought back the unsaved changes");
await writer.keyboard.press("Control+o");
await writer.waitForSelector("#ask[open]");
await writer.click('#ask-buttons button[value="discard"]');
await writer.waitForFunction(
  () => document.querySelector("#file-name")?.textContent === "opened.vxd",
);
await writer.click('.side-tab[data-tab="warnings"]');
if ((await writer.locator("#side-sheet .warning").count()) === 0)
  problems.push("writer: the warnings tab lists nothing for a story with an idle mark");
await writer.click("#side-sheet .warning");
await writer.waitForTimeout(100);
await writer.click("#view-menu-button");
await writer.click('[data-view="names"]');
if ((await writer.getAttribute('[data-view="names"]', "aria-checked")) !== "false")
  problems.push("writer: View › Names doesn't switch off");
await writer.setViewportSize({ width: 900, height: 760 });
await writer.waitForTimeout(200);
const fits = await writer.evaluate(
  () => document.body.getBoundingClientRect().height === window.innerHeight,
);
if (!fits) problems.push("writer: at 900×760, the page doesn't fill the window");
await writerContext.close();
console.log("writer: welcome, rail, save, draft, open, warnings, view: ok");

// Never losing the last words: typed and the page reloaded at once, they come back, with the
// writer's place; a file saved under a new name comes back under that name; the side closes.
const safety = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await safety.addInitScript(() => {
  window.showSaveFilePicker = async ({ suggestedName }) => ({
    kind: "file",
    name: suggestedName === "Untitled.vxd" ? "renamed.vxd" : suggestedName,
    getFile: async () => new File([""], "renamed.vxd", { lastModified: 1 }),
    createWritable: async () => ({ write: async () => {}, close: async () => {} }),
    isSameEntry: async () => false,
    queryPermission: async () => "granted",
    requestPermission: async () => "granted",
  });
});
const safe = await safety.newPage();
watch(safe, "writer safety");
await safe.goto(`${base}/writer/`);
await safe.click(`.welcome-example[data-name="${dragonName}"]`);
await safe.waitForTimeout(600);
await safe.click(".cm-content");
await safe.keyboard.press("Control+End");
await safe.keyboard.type("Typed just before a reload.");
const placeBefore = await safe.textContent("#cursor-place");
await safe.reload();
await safe.waitForSelector(".cm-content");
await safe.waitForTimeout(400);
if (!(await safe.locator(".cm-content").innerText()).includes("Typed just before a reload."))
  problems.push("writer: words typed just before a reload were lost");
if ((await safe.textContent("#cursor-place")) !== placeBefore)
  problems.push("writer: after a reload, the cursor isn't where the writer left it");
await safe.click("#file-menu-button");
await safe.click('[data-command="new"]');
// The example has changes to save: putting it aside asks first.
await safe.waitForSelector("#ask[open]");
await safe.click('#ask-buttons button[value="discard"]');
await safe.waitForFunction(
  () => document.querySelector("#file-name")?.textContent === "Untitled.vxd",
);
await safe.keyboard.press("Control+Shift+s");
await safe.waitForFunction(
  () => document.querySelector("#file-name")?.textContent === "renamed.vxd",
);
await safe.waitForTimeout(500);
await safe.reload();
await safe.waitForSelector(".cm-content");
await safe.waitForTimeout(300);
if ((await safe.textContent("#file-name")) !== "renamed.vxd")
  problems.push("writer: after Save as and a reload, the story has its old name");
await safe.setViewportSize({ width: 390, height: 844 });
if (!(await safe.isVisible("#side")))
  await safe.click("#view-menu-button").then(() => safe.click('[data-view="side"]'));
await safe.click("#side-close");
if (await safe.isVisible("#side"))
  problems.push("writer: the side's close button doesn't close it");
await safety.close();
console.log("writer: last words, place, Save as name, closing the side: ok");

// The last words neither kept yet nor written down as the page goes (the storage full): leaving
// asks first.
const fullStorage = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const full = await fullStorage.newPage();
watch(full, "writer storage full");
await full.goto(`${base}/writer/`);
await full.click(`.welcome-example[data-name="${dragonName}"]`);
await full.waitForSelector("#welcome", { state: "hidden" });
await full.waitForTimeout(2500);
await full.evaluate(() => {
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (String(key).startsWith("vxd-writer-rescue"))
      throw new DOMException("full", "QuotaExceededError");
    return set.call(this, key, value);
  };
});
await full.click(".cm-content");
await full.keyboard.press("Control+End");
let askedFirst = false;
full.on("dialog", (dialog) => {
  askedFirst ||= dialog.type() === "beforeunload";
  void dialog.dismiss();
});
await full.keyboard.type(" LAST WORDS");
await full.close({ runBeforeUnload: true });
await full.waitForTimeout(500);
if (!askedFirst)
  problems.push("writer: leaving with the last words neither kept nor written down didn't ask");
await fullStorage.close();

// A file in Windows-1252 opens with its letters, as a new story, and nothing saves over it.
const western = await browser.newContext({ viewport: { width: 1366, height: 657 } });
await western.addInitScript(() => {
  window.__writes = 0;
  Object.defineProperty(navigator, "platform", { get: () => "Win32" });
  const bytes = new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x20, 0x63, 0x72, 0xe8, 0x6d, 0x65, 0x2e]);
  const handle = {
    kind: "file",
    name: "old.txt",
    getFile: async () => new File([bytes], "old.txt", { lastModified: 1 }),
    createWritable: async () => {
      window.__writes++;
      return { write: async () => {}, close: async () => {} };
    },
    isSameEntry: async () => false,
    queryPermission: async () => "granted",
    requestPermission: async () => "granted",
  };
  window.showOpenFilePicker = async () => [handle];
});
const west = await western.newPage();
watch(west, "writer Windows-1252 file");
await west.goto(`${base}/writer/`);
await west.click('.welcome [data-command="open"]');
await west.waitForFunction(() => document.querySelector("#file-name")?.textContent === "old.vxd");
if (!(await west.locator(".cm-content").innerText()).includes("Café crème."))
  problems.push("writer: a Windows-1252 file lost its letters");
if (!(await west.textContent("#notice"))?.includes("wasn't UTF-8"))
  problems.push("writer: a file that wasn't UTF-8 opened without a word");
await west.click(".cm-content");
await west.keyboard.press("Control+End");
await west.keyboard.type(" More.");
await west.waitForTimeout(2600);
if ((await west.evaluate(() => window.__writes)) > 0)
  problems.push("writer: a file that wasn't UTF-8 was saved over by itself");
// Redo on Ctrl+Shift+Z, as the menu says, on Windows too.
await west.keyboard.press("Control+z");
await west.waitForTimeout(200);
await west.keyboard.press("Control+Shift+Z");
await west.waitForTimeout(600);
if (!(await west.locator(".cm-content").innerText()).includes("More."))
  problems.push("writer: Ctrl+Shift+Z doesn't redo on Windows");
// On a laptop's short window, the File menu's last item can still be reached.
await west.click("#file-menu-button");
const fileMenu = await west.evaluate(
  () => document.querySelector("#file-menu")?.getBoundingClientRect().bottom ?? 0,
);
if (fileMenu > 657)
  problems.push(`writer: the File menu runs ${Math.round(fileMenu - 657)} px past a short window`);
await west.locator('[data-command="format-curly"]').scrollIntoViewIfNeeded();
if (!(await west.locator('[data-command="format-curly"]').isVisible()))
  problems.push("writer: the File menu's last item can't be reached on a short window");
await west.keyboard.press("Escape");
await western.close();

// Drafts and versions: a story put aside unsaved is kept and opens again from Recover a draft;
// a saved version can be gone back to, and Undo takes that back.
const keeping = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await keeping.addInitScript(() => {
  window.showSaveFilePicker = async ({ suggestedName }) => ({
    kind: "file",
    name: suggestedName,
    getFile: async () => new File([""], suggestedName, { lastModified: 1 }),
    createWritable: async () => ({ write: async () => {}, close: async () => {} }),
    isSameEntry: async () => false,
    queryPermission: async () => "granted",
    requestPermission: async () => "granted",
  });
});
const keeper = await keeping.newPage();
watch(keeper, "writer drafts and versions");
await keeper.goto(`${base}/writer/`);
await keeper.click(`.welcome-example[data-name="${dragonName}"]`);
await keeper.click(".cm-content");
await keeper.keyboard.press("Control+End");
await keeper.keyboard.type(" Kept for later.");
await keeper.click("#file-menu-button");
await keeper.click('[data-command="new"]');
await keeper.waitForSelector("#ask[open]");
await keeper.click('#ask-buttons button[value="discard"]');
await keeper.waitForFunction(
  () => document.querySelector("#file-name")?.textContent === "Untitled.vxd",
);
await keeper.click("#file-menu-button");
await keeper.click('[data-command="recover"]');
await keeper.waitForSelector("#list-dialog[open]");
const putAside = keeper.locator("#list-items li", { hasText: dragonName });
if ((await putAside.count()) === 0)
  problems.push("writer: a story put aside unsaved isn't in Recover a draft");
else {
  await putAside.locator("button.primary").click();
  await keeper.waitForFunction(
    (name) => document.querySelector("#file-name")?.textContent === name,
    dragonName,
  );
  await keeper.waitForTimeout(300);
  if (!(await draftIn(keeper)).includes("Kept for later."))
    problems.push("writer: a recovered draft came back without its unsaved words");
}
await keeper.keyboard.press("Control+s");
await keeper.waitForFunction(
  () => document.querySelector("#save-state")?.getAttribute("data-state") === "saved",
);
await keeper.click(".cm-content");
await keeper.keyboard.press("Control+End");
await keeper.keyboard.type(" Written after saving.");
await keeper.click("#file-menu-button");
await keeper.click('[data-command="versions"]');
await keeper.waitForSelector("#list-dialog[open]");
const savedVersion = keeper.locator("#list-items li", { hasText: "Saved" }).first();
if ((await savedVersion.count()) === 0)
  problems.push("writer: saving keeps no version to go back to");
else {
  await savedVersion.locator("button.primary").click();
  await keeper.waitForTimeout(900);
  if ((await draftIn(keeper)).includes("Written after saving."))
    problems.push("writer: going back to a version kept the words written since");
  await keeper.click(".cm-content");
  await keeper.keyboard.press("Control+z");
  await keeper.waitForTimeout(900);
  if (!(await draftIn(keeper)).includes("Written after saving."))
    problems.push("writer: Undo doesn't take back going back to a version");
}
await keeping.close();

// Many stories: beyond the drafts kept, saved ones are let go, never one with unsaved changes.
const many = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const manyPage = await many.newPage();
watch(manyPage, "writer many drafts");
await manyPage.goto(`${base}/writer/`);
await manyPage.waitForSelector("#welcome:not([hidden])");
await manyPage.evaluate(
  () =>
    new Promise((resolve) => {
      const request = indexedDB.open("voxdown-writer");
      request.onsuccess = () => {
        const transaction = request.result.transaction("documents", "readwrite");
        const documents = transaction.objectStore("documents");
        for (let i = 0; i < 106; i++)
          documents.put({
            id: `old-${i}`,
            name: `story-${i}.vxd`,
            text: i % 2 ? `Story ${i}, changed.` : `Story ${i}.`,
            saved: `Story ${i}.`,
            changedAt: 1000 + i,
          });
        transaction.oncomplete = () => resolve(undefined);
      };
    }),
);
await manyPage.click("#file-menu-button");
await manyPage.click('[data-command="recover"]');
await manyPage.waitForSelector("#list-dialog[open]");
const keptIds = await manyPage.evaluate(
  () =>
    new Promise((resolve) => {
      const request = indexedDB.open("voxdown-writer");
      request.onsuccess = () => {
        const all = request.result.transaction("documents").objectStore("documents").getAllKeys();
        all.onsuccess = () => resolve(all.result);
      };
    }),
);
const lostUnsaved = Array.from({ length: 106 }, (_, i) => i).filter(
  (i) => i % 2 && !keptIds.includes(`old-${i}`),
);
if (lostUnsaved.length)
  problems.push(`writer: ${lostUnsaved.length} drafts with unsaved changes were let go`);
if (keptIds.length >= 106) problems.push("writer: saved drafts beyond the limit are never let go");
await many.close();
console.log("writer: recovering a draft, going back to a version: ok");

// Round two: two tabs write two stories; saving
// automatically says when it stops; a long file name never pushes the bar off the window; the
// side follows a jump from the rail in a long story; an insert never lands inside another mark.
const two = await browser.newContext({ viewport: { width: 1280, height: 800 } });
// Two tabs, two stories: each writes its own. A new tab opens the story written last, to read
// while the other tab writes it; a new story there is its own, written there, with nothing asked.
const firstTab = await two.newPage();
watch(firstTab, "writer two stories, tab 1");
await firstTab.goto(`${base}/writer/`);
await firstTab.click(`.welcome-example[data-name="${dragonName}"]`);
await firstTab.waitForSelector("#welcome", { state: "hidden" });
await firstTab.click(".cm-content");
await firstTab.keyboard.press("Control+End");
await firstTab.keyboard.type(" Written in the first tab.");
await firstTab.waitForTimeout(900);
const secondTab = await two.newPage();
watch(secondTab, "writer two stories, tab 2");
await secondTab.goto(`${base}/writer/`);
await secondTab.waitForSelector("#elsewhere:not([hidden])");
await secondTab.click("#file-menu-button");
await secondTab.click('[data-command="new"]');
await secondTab.waitForFunction(
  () => document.querySelector("#file-name")?.textContent === "Untitled.vxd",
);
if (await secondTab.isVisible("#ask[open]"))
  problems.push("writer: a new story in a tab that reads another asks before it opens");
if (!(await secondTab.isHidden("#elsewhere")))
  problems.push("writer: a new story in a second tab can't be written there");
await secondTab.click(".cm-content");
await secondTab.keyboard.press("Control+End");
await secondTab.keyboard.type("Written in the second tab.");
await firstTab.keyboard.type(" And more in the first.");
await secondTab.waitForTimeout(1200);
if (!(await firstTab.isHidden("#elsewhere")))
  problems.push("writer: a story opened in a second tab took the first tab's story from it");
const bothKept = await secondTab.evaluate(
  () =>
    new Promise((resolve) => {
      const request = indexedDB.open("voxdown-writer");
      request.onsuccess = () => {
        const all = request.result.transaction("documents").objectStore("documents").getAll();
        all.onsuccess = () => resolve(all.result.map((draft) => draft.text));
      };
    }),
);
if (
  !bothKept.some((text) => text.includes("Written in the first tab. And more in the first.")) ||
  !bothKept.some((text) => text.includes("Written in the second tab."))
)
  problems.push("writer: two tabs writing two stories didn't each keep their own");
// Reloaded, each tab opens its own story again.
await secondTab.reload();
await secondTab.waitForFunction(
  () => document.querySelector("#file-name")?.textContent === "Untitled.vxd",
);
if (!(await secondTab.isHidden("#elsewhere")))
  problems.push("writer: a tab reloaded doesn't write its own story again");
await two.close();

const stops = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await stops.addInitScript(() => {
  const name = "a-rather-long-name-for-a-story-file.vxd";
  window.showOpenFilePicker = async () => [
    {
      kind: "file",
      name,
      getFile: async () => new File(["# A story\n\nIt begins.\n"], name, { lastModified: 1 }),
      createWritable: async () => ({ write: async () => {}, close: async () => {} }),
      isSameEntry: async () => false,
      queryPermission: async ({ mode }) => (mode === "readwrite" ? "prompt" : "granted"),
      requestPermission: async () => "granted",
    },
  ];
});
const stop = await stops.newPage();
watch(stop, "writer autosave stops");
await stop.goto(`${base}/writer/`);
await stop.click('.welcome [data-command="open"]');
await stop.waitForFunction(() =>
  document.querySelector("#file-name")?.textContent?.startsWith("a-rather"),
);
await stop.click(".cm-content");
await stop.keyboard.press("Control+End");
await stop.keyboard.type(" More.");
await stop.waitForTimeout(2800);
if (
  (await stop.getAttribute("#save-state", "data-state")) !== "error" ||
  (await stop.isHidden("#notice"))
)
  problems.push("writer: saving automatically stopped without saying so");
for (const width of [760, 860, 1000, 1100]) {
  await stop.setViewportSize({ width, height: 800 });
  await stop.waitForTimeout(100);
  const over = await stop.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (over > 0)
    problems.push(`writer: with a long file name at ${width} px, the page runs ${over} px wide`);
}
await stops.close();

const follow = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const followBook = Array.from({ length: 4 }, () => bodies).join("\n\n");
await follow.addInitScript((text) => {
  window.showOpenFilePicker = async () => [
    {
      kind: "file",
      name: "follow.vxd",
      getFile: async () => new File([text], "follow.vxd"),
      queryPermission: async () => "granted",
      requestPermission: async () => "granted",
      isSameEntry: async () => false,
    },
  ];
}, followBook);
const follower = await follow.newPage();
watch(follower, "writer side follows");
await follower.goto(`${base}/writer/`);
await follower.click('.welcome [data-command="open"]');
await follower.waitForFunction(
  () => document.querySelector("#file-name")?.textContent === "follow.vxd",
);
if (!(await follower.isVisible("#side"))) {
  await follower.click("#view-menu-button");
  await follower.click('[data-view="side"]');
}
await follower.click('.side-tab[data-tab="script"]');
await follower.waitForTimeout(1500);
const scenes = await follower.locator("#rail-scenes button").count();
await follower
  .locator("#rail-scenes button")
  .nth(Math.floor(scenes * 0.7))
  .click({ force: true });
await follower.waitForTimeout(1200);
const linked = await follower.evaluate(() => {
  const mark = document.querySelector("#side-sheet .linked")?.getBoundingClientRect();
  const frame = document.querySelector("#side-sheet")?.getBoundingClientRect();
  return Boolean(mark && frame && mark.top >= frame.top - 1 && mark.bottom <= frame.bottom + 1);
});
if (!linked) problems.push("writer: after a jump from the rail, the side doesn't show the place");
// An insert inside a mark goes after it.
await follower.click("#file-menu-button");
await follower.click('[data-command="new"]');
if (await follower.isVisible("#ask[open]"))
  await follower.click('#ask-buttons button[value="discard"]');
await follower.waitForFunction(
  () => document.querySelector("#file-name")?.textContent === "Untitled.vxd",
);
await follower.keyboard.type("She waved.");
await follower.click("#insert-menu-button");
await follower.click('[data-command="insert-pause"]');
await follower.click("#insert-menu-button");
await follower.click('[data-command="insert-note"]');
await follower.waitForTimeout(900);
if (!/\{pause 1s\}\s*%% note %%/.test(await draftIn(follower)))
  problems.push("writer: a note inserted inside a pause went into it");
await follow.close();
console.log("writer: second tab, autosave stops, long names, side follows, inserts: ok");

// Slow saves: words typed while a save before leaving is under way are asked about again, not
// left behind; a save that ends after another story was opened leaves that story alone.
const slow = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await slow.addInitScript(() => {
  window.__written = {};
  window.showSaveFilePicker = async ({ suggestedName }) => ({
    kind: "file",
    name: suggestedName,
    getFile: async () =>
      new File([window.__written[suggestedName] ?? ""], suggestedName, { lastModified: 1 }),
    createWritable: async () => {
      let text = "";
      return {
        write: async (chunk) => {
          text += chunk;
        },
        close: () =>
          new Promise((done) =>
            setTimeout(() => {
              window.__written[suggestedName] = text;
              done();
            }, 800),
          ),
      };
    },
    isSameEntry: async () => false,
    queryPermission: async () => "granted",
    requestPermission: async () => "granted",
  });
});
const racer = await slow.newPage();
watch(racer, "writer slow saves");
await racer.goto(`${base}/writer/`);
await racer.click(`.welcome-example[data-name="${dragonName}"]`);
await racer.click("#file-menu-button");
await racer.click('[data-command="new"]');
await racer.waitForSelector("#ask[open]");
await racer.click('#ask-buttons button[value="save"]');
await racer.waitForTimeout(150);
await racer.click(".cm-content");
await racer.keyboard.press("Control+End");
await racer.keyboard.type(" LAST WORDS WHILE SAVING");
await racer.waitForSelector("#ask[open]", { timeout: 5_000 }).catch(() => {});
const askedAgain = await racer.isVisible("#ask[open]");
const stillThere = await draftIn(racer);
if (!askedAgain && !stillThere.includes("LAST WORDS WHILE SAVING"))
  problems.push("writer: words typed while saving before leaving were left behind");
if (askedAgain) await racer.click('#ask-buttons button[value="cancel"]');
// A save still under way when another story opens.
await racer.keyboard.press("Control+s");
await racer.waitForTimeout(100);
await racer.click("#file-menu-button");
await racer.click('[data-command="new"]');
if (await racer.isVisible("#ask[open]")) await racer.click('#ask-buttons button[value="discard"]');
await racer.waitForFunction(
  () => document.querySelector("#file-name")?.textContent === "Untitled.vxd",
);
await racer.waitForTimeout(1500);
if ((await racer.getAttribute("#save-state", "data-state")) !== "unsaved")
  problems.push("writer: a save of the story before marked the new story as saved");
await slow.close();
console.log("writer: slow saves: ok");

// Edges: a file dropped on the text opens rather than going into it; the bar never runs off the
// page; the welcome shows nothing behind it; renaming to a name in use says why; Ctrl+K picks who.
const edges = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const edge = await edges.newPage();
watch(edge, "writer edges");
await edge.goto(`${base}/writer/`);
await edge.waitForSelector("#welcome:not([hidden])");
if (await edge.isVisible("#side")) problems.push("writer: the welcome shows the side behind it");
await edge.click(`.welcome-example[data-name="${dragonName}"]`);
await edge.waitForTimeout(500);
await edge.evaluate(() => {
  const data = new DataTransfer();
  data.items.add(new File(["DROPPED FILE TEXT\n"], "other.vxd", { type: "text/markdown" }));
  const target = document.querySelector(".cm-content");
  target?.dispatchEvent(
    new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }),
  );
});
await edge.waitForSelector("#ask[open]");
await edge.click('#ask-buttons button[value="discard"]');
await edge.waitForFunction(() => document.querySelector("#file-name")?.textContent === "other.vxd");
const droppedText = await edge.locator(".cm-content").innerText();
if (!droppedText.startsWith("DROPPED FILE TEXT") || droppedText.includes("Sir Percival"))
  problems.push("writer: a file dropped on the text went into the story instead of opening");
await edge.click(".welcome-example").catch(() => {});
await edge.click("#file-menu-button");
await edge.click('[data-command="new"]');
await edge.waitForFunction(
  () => document.querySelector("#file-name")?.textContent === "Untitled.vxd",
);
for (const width of [800, 960, 1100]) {
  await edge.setViewportSize({ width, height: 800 });
  await edge.waitForTimeout(150);
  const wide = await edge.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const save = await edge.evaluate(
    () => document.querySelector("#save-button")?.getBoundingClientRect().right ?? 0,
  );
  if (wide > 0 || save > width)
    problems.push(`writer: at ${width} px wide, the page runs ${wide} px past the window`);
}
await edge.setViewportSize({ width: 1440, height: 900 });
await edge.click('.side-tab[data-tab="cast"]').catch(async () => {
  await edge.click("#view-menu-button");
  await edge.click('[data-view="side"]');
  await edge.click('.side-tab[data-tab="cast"]');
});
await edge.click(".cm-content");
await edge.keyboard.press("Control+End");
await edge.keyboard.type("@Wanda “Hello.”\n\n@Bob “Hi.”");
await edge.waitForTimeout(400);
const wanda = edge.locator('.cast-handle input[value="Wanda"]');
await wanda.fill("Bob");
await wanda.press("Enter");
await edge.waitForSelector("#notice:not([hidden])");
if (!(await edge.textContent("#notice"))?.includes("Bob"))
  problems.push("writer: renaming to a name in use doesn't say why it can't");
await edge.click(".cm-line >> text=Hi.");
await edge.keyboard.press("Control+k");
await edge.waitForSelector(".popover:not([hidden]) .speaker-choice");
// Bob, the last in the list, has the focus: up goes to the name before.
const before = await edge.evaluate(() => document.activeElement?.textContent ?? "");
await edge.keyboard.press("ArrowUp");
const after = await edge.evaluate(() => ({
  name: document.activeElement?.textContent ?? "",
  choice: document.activeElement?.classList.contains("speaker-choice") ?? false,
}));
if (!after.choice || after.name === before)
  problems.push("writer: arrow keys don't move in the speaker picker");
await edge.keyboard.press("Escape");
if (await edge.isVisible(".popover"))
  problems.push("writer: Escape doesn't close the speaker picker");
// Typing finds a name: two letters and Enter give Bob's line to Wanda.
await edge.click(".cm-line >> text=Hi.");
await edge.keyboard.press("Control+k");
await edge.waitForSelector(".popover:not([hidden]) .speaker-choice");
await edge.keyboard.type("wa");
await edge.keyboard.press("Enter");
await edge.waitForTimeout(900);
if (!/@Wanda “Hi\.”/.test(await draftIn(edge)))
  problems.push("writer: typing a name's first letters in the speaker picker doesn't find it");
await edges.close();
console.log("writer: drop, bar width, welcome, rename, Ctrl+K: ok");

// Typing in a long book stays quick: no key held up for long, with the script beside it.
const long = await browser.newContext({ viewport: { width: 1440, height: 900 } });

const book = `---\ntitle: Long\n---\n\n${Array.from({ length: Math.ceil(100_000 / bodies.split(/\s+/).length) }, () => bodies).join("\n\n")}`;
await long.addInitScript((text) => {
  window.showOpenFilePicker = async () => [
    {
      kind: "file",
      name: "long.vxd",
      getFile: async () => new File([text], "long.vxd"),
      queryPermission: async () => "granted",
      requestPermission: async () => "granted",
      isSameEntry: async () => false,
    },
  ];
}, book);
const longPage = await long.newPage();
watch(longPage, "writer long book");
await longPage.goto(`${base}/writer/`);
await longPage.click('.welcome [data-command="open"]');
await longPage.waitForFunction(
  () => document.querySelector("#file-name")?.textContent === "long.vxd",
);
await longPage.waitForTimeout(800);
await longPage.click(".cm-content");
await longPage.keyboard.press("Control+End");
await longPage.waitForTimeout(800);
await longPage.evaluate(() => {
  window.__keys = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      if (entry.name === "keydown") window.__keys.push(entry.duration);
  }).observe({ type: "event", durationThreshold: 16 });
});
for (const char of "the quick brown fox jumps") {
  await longPage.keyboard.press(char === " " ? "Space" : char);
  await longPage.waitForTimeout(80);
}
for (const key of ["Enter", "Shift+Quote", "Enter"]) {
  await longPage.keyboard.press(key);
  await longPage.waitForTimeout(120);
}
await longPage.waitForTimeout(600);
const slowest = await longPage.evaluate(() => Math.max(0, ...window.__keys));
if (slowest > 150)
  problems.push(`writer: in a 100,000-word book, a key took ${slowest} ms (budget 150 ms)`);
await long.close();
console.log(`writer: a 100,000-word book, slowest key ${slowest} ms: ok`);

// Offline: opened once, the Writer opens again with no network, its story with it.
const offline = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const off = await offline.newPage();
watch(off, "writer offline");
await off.goto(`${base}/writer/`);
await off.click(`.welcome-example[data-name="${dragonName}"]`);
await off.evaluate(() => navigator.serviceWorker.ready);
await off.waitForTimeout(1500);
await offline.setOffline(true);
await off.reload();
await off.waitForSelector(".cm-content", { timeout: 10_000 }).catch(() => {});
if (
  !(
    await off
      .locator(".cm-content")
      .innerText()
      .catch(() => "")
  ).includes("Sir Percival")
)
  problems.push("writer: with no network, the Writer doesn't open again with its story");
await offline.close();
console.log("writer: offline: ok");

// Saving automatically: a file opened, typed in, and two seconds later it is on disk.
const auto = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await auto.addInitScript(() => {
  const files = { "auto.vxd": "# Auto\n\nThe start.\n" };
  window.__files = files;
  const handle = (name) => ({
    kind: "file",
    name,
    getFile: async () => new File([files[name] ?? ""], name, { lastModified: 1 }),
    createWritable: async () => {
      let written = "";
      return {
        write: async (text) => {
          written += text;
        },
        close: async () => {
          files[name] = written;
        },
      };
    },
    isSameEntry: async (other) => other.name === name,
    queryPermission: async () => "granted",
    requestPermission: async () => "granted",
  });
  window.showOpenFilePicker = async () => [handle("auto.vxd")];
  window.showSaveFilePicker = async ({ suggestedName }) => handle(suggestedName);
});
const autoPage = await auto.newPage();
watch(autoPage, "writer autosave");
await autoPage.goto(`${base}/writer/`);
await autoPage.click('.welcome [data-command="open"]');
await autoPage.waitForFunction(
  () => document.querySelector("#file-name")?.textContent === "auto.vxd",
);
await autoPage.click(".cm-content");
await autoPage.keyboard.press("Control+End");
await autoPage.keyboard.type("Saved by itself.");
await autoPage.waitForTimeout(2800);
if (!(await autoPage.evaluate(() => window.__files["auto.vxd"].includes("Saved by itself."))))
  problems.push("writer: Save automatically didn't save the file");
if ((await autoPage.getAttribute("#save-state", "data-state")) !== "saved")
  problems.push("writer: after saving automatically, it still shows changes to save");
// Switched off just after typing, the save that was waiting doesn't happen, and nothing says it
// failed.
await autoPage.keyboard.type(" Not this.");
await autoPage.click("#file-menu-button");
await autoPage.click('[data-view="autosave"]');
await autoPage.keyboard.press("Escape");
await autoPage.waitForTimeout(2800);
if (await autoPage.evaluate(() => window.__files["auto.vxd"].includes("Not this.")))
  problems.push("writer: switched off, Save automatically still saved");
if (
  (await autoPage.getAttribute("#save-state", "data-state")) !== "unsaved" ||
  !(await autoPage.isHidden("#notice"))
)
  problems.push("writer: switching Save automatically off shows it failing");
// What the cast says, typed and saved without leaving the field, is in the file; typed and the
// page reloaded at once, it is in the draft.
await autoPage.click(".cm-content");
await autoPage.keyboard.press("Control+End");
await autoPage.keyboard.type("\n\n@Ann “Hello.”");
await autoPage.waitForTimeout(600);
await autoPage.click('.side-tab[data-tab="cast"]');
const firstAbout = autoPage.locator(".cast-about").first();
await firstAbout.fill("Reads it all, warmly.");
await autoPage.keyboard.press("Control+s");
await autoPage.waitForTimeout(600);
if (!(await autoPage.evaluate(() => window.__files["auto.vxd"].includes("Reads it all, warmly."))))
  problems.push("writer: Save left out what was typed in the cast without leaving the field");
await autoPage.locator(".cast-about").first().fill("Reads it all, gently.");
await autoPage.reload();
await autoPage.waitForFunction(
  () => document.querySelector("#file-name")?.textContent === "auto.vxd",
);
await autoPage.waitForTimeout(400);
if (!(await draftIn(autoPage)).includes("Reads it all, gently."))
  problems.push("writer: a reload lost what was typed in the cast without leaving the field");
await auto.close();
console.log("writer: saving automatically: ok");

// A file changed elsewhere: read again in place, the same story with its versions, the cursor
// where it was, Undo to take it back; and after a restart, when the browser must ask before the
// page writes again, Save still asks before writing over changes made elsewhere.
const synced = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await synced.addInitScript(() => {
  const paragraphs = Array.from({ length: 60 }, (_, i) => `Paragraph ${i}.`).join("\n\n");
  const disk = { text: `# Synced\n\n${paragraphs}\n`, at: 1 };
  window.__disk = disk;
  let granted = true;
  window.__restart = () => {
    granted = false;
  };
  const handle = {
    kind: "file",
    name: "synced.vxd",
    getFile: async () => new File([disk.text], "synced.vxd", { lastModified: disk.at }),
    createWritable: async () => {
      let written = "";
      return {
        write: async (text) => {
          written += text;
        },
        close: async () => {
          disk.text = written;
          disk.at += 1;
        },
      };
    },
    isSameEntry: async (other) => other.name === "synced.vxd",
    queryPermission: async () => (granted ? "granted" : "prompt"),
    requestPermission: async () => {
      granted = true;
      return "granted";
    },
  };
  window.showOpenFilePicker = async () => [handle];
  window.showSaveFilePicker = async ({ suggestedName }) => {
    window.__suggested = suggestedName;
    return handle;
  };
});
const sync = await synced.newPage();
watch(sync, "writer file changed elsewhere");
await sync.goto(`${base}/writer/`);
await sync.click('.welcome [data-command="open"]');
await sync.waitForFunction(
  () => document.querySelector("#file-name")?.textContent === "synced.vxd",
);
await sync.click(".cm-content");
await sync.keyboard.press("Control+End");
const syncPlace = await sync.textContent("#cursor-place");
await sync.evaluate(() => {
  window.__disk.text = window.__disk.text.replace("Paragraph 3.", "Paragraph 3, from the laptop.");
  window.__disk.at += 5;
  window.dispatchEvent(new Event("focus"));
});
await sync.waitForTimeout(1200);
if (!(await draftIn(sync)).includes("from the laptop"))
  problems.push("writer: a file changed elsewhere wasn't read again");
if ((await sync.textContent("#cursor-place")) !== syncPlace)
  problems.push("writer: reading the file again lost the writer's place");
const storiesKept = () =>
  sync.evaluate(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.open("voxdown-writer");
        request.onsuccess = () => {
          const all = request.result.transaction("documents").objectStore("documents").count();
          all.onsuccess = () => resolve(all.result);
        };
      }),
  );
await sync.waitForTimeout(500);
if ((await storiesKept()) !== 1)
  problems.push("writer: reading the file again made it a new story in Recover a draft");
await sync.keyboard.press("Control+z");
await sync.waitForTimeout(900);
if ((await draftIn(sync)).includes("laptop"))
  problems.push("writer: Undo doesn't take back the file read again");
await sync.keyboard.press("Control+Shift+z");
// A restart: the browser must ask before the page writes again. The file changes elsewhere,
// words are typed here, and Save asks first.
await sync.keyboard.press("Control+End");
await sync.keyboard.type(" Mine.");
await sync.evaluate(() => {
  window.__restart();
  window.__disk.text = window.__disk.text.replace(
    "Paragraph 5.",
    "Paragraph 5, a whole new chapter.",
  );
  window.__disk.at += 5;
});
await sync.keyboard.press("Control+s");
await sync.waitForSelector("#ask[open]");
if (!(await sync.textContent("#ask-message"))?.includes("changed outside"))
  problems.push("writer: after a restart, Save wrote over changes made elsewhere without asking");
await sync.click('#ask-buttons button[value="theirs"]');
await sync.waitForTimeout(500);
if (!(await sync.evaluate(() => window.__disk.text.includes("a whole new chapter"))))
  problems.push("writer: Open it as it is now wrote over the file");
if ((await draftIn(sync)).includes("Mine."))
  problems.push("writer: Open it as it is now kept the words typed here in the text");
// What was here is kept as a version, and compares with the story now.
await sync.click("#file-menu-button");
await sync.click('[data-command="versions"]');
await sync.waitForSelector("#list-dialog[open]");
const keptBefore = sync
  .locator("#list-items li", { hasText: "Before the file was read again" })
  .first();
if ((await keptBefore.count()) === 0)
  problems.push("writer: what was written here wasn't kept before the file was read again");
else {
  await keptBefore.locator("button", { hasText: "Compare" }).click();
  await sync.waitForSelector("#compare[open]");
  const gone = await sync
    .locator("#compare-lines .compare-gone, #compare-lines .compare-changed del")
    .allInnerTexts();
  if (!gone.some((line) => line.includes("Mine.")))
    problems.push("writer: comparing a version doesn't show what it had that is gone now");
  await sync.click('#compare button[value="close"]');
}
// Read again with other line endings: Undo still takes it back.
await sync.evaluate(() => {
  window.__disk.text = window.__disk.text
    .replace("Paragraph 7.", "Paragraph 7, on Windows.")
    .replace(/\n/g, "\r\n");
  window.__disk.at += 5;
  window.dispatchEvent(new Event("focus"));
});
await sync.waitForTimeout(1200);
if (!(await draftIn(sync)).includes("on Windows.\r\n"))
  problems.push("writer: a file read again with CRLF line endings wasn't read as it is");
await sync.click(".cm-content");
await sync.keyboard.press("Control+z");
await sync.waitForTimeout(900);
if ((await draftIn(sync)).includes("on Windows."))
  problems.push("writer: Undo doesn't take back a file read again with other line endings");
// Changed elsewhere with its date kept (a sync, a copy): Save still asks, by what the file says.
await sync.click(".cm-content");
await sync.keyboard.press("Control+End");
await sync.keyboard.type(" Before the quiet change.");
await sync.keyboard.press("Control+s");
await sync.waitForTimeout(500);
if (await sync.isVisible("#ask[open]")) await sync.click('#ask-buttons button[value="mine"]');
await sync.waitForTimeout(500);
await sync.evaluate(() => {
  window.__disk.text = window.__disk.text.replace("Paragraph 9.", "Paragraph 9, changed quietly.");
});
await sync.keyboard.type(" Mine again.");
await sync.keyboard.press("Control+s");
await sync
  .waitForSelector("#ask[open]", { timeout: 3000 })
  .catch(() =>
    problems.push("writer: a file changed elsewhere with its date kept was saved over unasked"),
  );
// Keep both: a new name is offered, and the file itself is refused.
if (await sync.isVisible("#ask[open]")) await sync.click('#ask-buttons button[value="both"]');
await sync.waitForTimeout(400);
if (!(await sync.evaluate(() => window.__suggested))?.endsWith("(2).vxd"))
  problems.push("writer: Keep both doesn't offer a name of its own");
if (await sync.isVisible("#ask[open]")) {
  if (!(await sync.textContent("#ask-message"))?.includes("itself"))
    problems.push("writer: Keep both took the file it was to be kept beside");
  await sync.click('#ask-buttons button[value="ok"]');
}
if (!(await sync.evaluate(() => window.__disk.text.includes("changed quietly"))))
  problems.push("writer: a file changed elsewhere with its date kept lost its change");
// Save as, the same file chosen: a Save, asking first about changes made elsewhere.
await sync.evaluate(() => {
  window.__disk.text += "\nWritten on another computer.\n";
  window.__disk.at += 3;
});
await sync.click(".cm-content");
await sync.keyboard.type(" Saved as.");
await sync.keyboard.press("Control+Shift+S");
await sync
  .waitForSelector("#ask[open]", { timeout: 3000 })
  .catch(() =>
    problems.push("writer: Save as onto the story's own file wrote over changes made elsewhere"),
  );
if (await sync.isVisible("#ask[open]")) await sync.click('#ask-buttons button[value="cancel"]');
if (!(await sync.evaluate(() => window.__disk.text.includes("another computer"))))
  problems.push("writer: Save as onto the story's own file lost changes made elsewhere");
// Saving by itself stops when the file changed on disk, and says so beside the name until saved.
await sync.keyboard.press("Control+End");
await sync.keyboard.type(" More here.");
await sync.evaluate(() => {
  window.__disk.text += "\nAdded on the laptop.\n";
  window.__disk.at += 5;
});
await sync.waitForTimeout(2800);
if (!(await sync.textContent("#save-state"))?.includes("changed on disk"))
  problems.push("writer: saving by itself stopped for a change on disk without saying so for long");
await synced.close();
console.log("writer: a file changed elsewhere, read again, compared: ok");

// Writing in the Writer: who says a passage and how, from the bar over it; undo; search; moving
// a paragraph; renaming in the cast; and a warning's fix. Each change is read back from the
// draft the Writer keeps.
const authoring = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const author = await authoring.newPage();
watch(author, "writer authoring");
const kept = () => draftIn(author);
const settled = () => author.waitForTimeout(900);
await author.goto(`${base}/writer/`);
await author.click(`.welcome-example[data-name="${dragonName}"]`);
await author.waitForSelector("#welcome", { state: "hidden" });
const passage = author.locator(".cm-line", { hasText: "He had polished his armor" }).first();
await passage.hover({ position: { x: 60, y: 8 } });
await author.waitForSelector(".stretch-tools:not([hidden])");
await author.click(".stretch-tools .who");
await author.click('.speaker-choice:has-text("Gerald")');
await settled();
if (!/@Gerald[^\n]*He had polished his armor/.test(await kept()))
  problems.push("writer: the speaker picker didn't give the passage to Gerald");
await author.keyboard.press("Control+z");
await settled();
if (/@Gerald[^\n]*He had polished his armor/.test(await kept()))
  problems.push("writer: undo didn't take the new speaker back");
await passage.hover({ position: { x: 60, y: 8 } });
await author.waitForSelector(".stretch-tools:not([hidden])");
await author.click(".stretch-tools .how");
await author.keyboard.type("proudly");
await author.keyboard.press("Enter");
await settled();
if (!/@\(proudly\) He had polished/.test(await kept()))
  problems.push("writer: the direction picker didn't set “proudly”");
// Ctrl+K from the start of a line with a mark on it opens the picker for that mark's passage.
await author.locator(".cm-line", { hasText: "Most of them" }).first().click();
await author.keyboard.press("Home");
await author.keyboard.press("Control+k");
if (!(await author.isVisible(".speaker-choice")))
  problems.push("writer: Ctrl+K at the start of a line with a mark finds no passage");
await author.keyboard.press("Escape");
// Italics never go inside a direction: the word found and selected, Ctrl+I says why not.
const beforeItalics = await kept();
await author.click(".cm-content");
await author.keyboard.press("Control+f");
await author.keyboard.type("proudly");
await author.keyboard.press("Enter");
await author.keyboard.press("Escape");
await author.keyboard.press("Control+i");
await settled();
if (
  (await kept()) !== beforeItalics ||
  !(await author.textContent("#notice"))?.includes("can’t go inside")
)
  problems.push("writer: Ctrl+I put italics inside a direction");
await author.keyboard.press("Control+Home");
await author.keyboard.press("Control+f");
if (!(await author.isVisible(".cm-search")))
  problems.push("writer: Ctrl+F doesn't open search and replace");
await author.keyboard.press("Escape");
await author.click(".cm-line >> text=He had polished his armor");
const order = (text) => text.indexOf("He had polished") < text.indexOf("“Whoever brings back");
const wasFirst = order(await kept());
await author.keyboard.press("Alt+ArrowDown");
await settled();
if (order(await kept()) === wasFirst) problems.push("writer: Alt+↓ didn't move the paragraph");
// A whole scene moved past the next with Alt+Shift+↓, and back with Undo.
const sceneOrder = (text) => text.indexOf("## The mountain") < text.indexOf("## The battle");
await author.locator(".cm-line", { hasText: "The mountain" }).first().click();
const sceneBefore = sceneOrder(await kept());
await author.keyboard.press("Alt+Shift+ArrowDown");
await settled();
if (sceneOrder(await kept()) === sceneBefore)
  problems.push("writer: Alt+Shift+↓ didn't move the scene");
await author.keyboard.press("Control+z");
await settled();
if (sceneOrder(await kept()) !== sceneBefore)
  problems.push("writer: Undo didn't move the scene back");
await author.click('.side-tab[data-tab="cast"]');
const king = author.locator('.cast-handle input[value="King"]');
await king.fill("Monarch");
await king.press("Enter");
await settled();
const renamed = await kept();
if (!renamed.includes("@Monarch") || renamed.includes("@King"))
  problems.push("writer: renaming King in the cast didn't rename every mark");
// A full name changed and Tab: the change made, and the focus where Tab sent it.
const geraldName = author.locator('.cast-name[data-focus="Gerald:name"]');
await geraldName.fill("Gerald the Dragon");
await author.keyboard.press("Tab");
await settled();
if (!(await kept()).includes("Gerald the Dragon"))
  problems.push("writer: a full name changed in the cast wasn't written");
const tabbedTo = await author.evaluate(() => document.activeElement?.getAttribute("data-focus"));
if (tabbedTo !== "Gerald:find")
  problems.push(`writer: Tab from a full name in the cast went to ${tabbedTo}, not the next field`);
// What the cast says about a character, written without YAML.
const geraldAbout = author.locator('.cast-about[data-focus="Gerald:about"]');
await geraldAbout.fill("A dragon who would rather cook.");
await geraldAbout.press("Enter");
await settled();
if (!/about: A dragon who would rather cook\./.test(await kept()))
  problems.push("writer: what the cast says about a character wasn't written");
// The story's details, from a form.
await author.click("#file-menu-button");
await author.click('[data-command="details"]');
await author.waitForSelector("#details[open]");
await author.fill("#detail-author", "A. Teller");
await author.click('#details button[value="done"]');
await settled();
if (!(await kept()).includes("author: A. Teller"))
  problems.push("writer: Story details didn't write the author");
// Enter in a field of Story details is Done.
await author.click("#file-menu-button");
await author.click('[data-command="details"]');
await author.waitForSelector("#details[open]");
await author.fill("#detail-subtitle", "A tale told twice");
await author.press("#detail-subtitle", "Enter");
await settled();
if (!(await kept()).includes("subtitle: A tale told twice"))
  problems.push("writer: Enter in Story details threw the change away");
// Escape from a dialog gives the keyboard back to the text.
await author.click("#file-menu-button");
await author.click('[data-command="details"]');
await author.waitForSelector("#details[open]");
await author.keyboard.press("Escape");
await author.waitForTimeout(200);
if (!(await author.evaluate(() => document.activeElement?.classList.contains("cm-content"))))
  problems.push("writer: after a dialog closes, the keyboard isn't back in the text");
// The first scene of its chapter stays below the chapter's heading.
await author.locator(".cm-line", { hasText: "Sir Percival had been training" }).first().click();
const beforeMove = await kept();
await author.keyboard.press("Alt+Shift+ArrowUp");
await settled();
if ((await kept()) !== beforeMove)
  problems.push("writer: a scene was moved above its chapter's heading");
// A quote no one is marked to say, found, and given to the name its tag gives.
await author.click(".cm-content");
await author.keyboard.press("Control+End");
await author.keyboard.insertText("\n\n“Is anyone there?” asked Mara.\n");
await settled();
await author.keyboard.press("Control+Home");
await author.keyboard.press("Control+Shift+k");
await author.waitForTimeout(200);
await author.keyboard.press("Control+k");
await author.waitForSelector(".speaker-choice");
const firstChoice = await author.locator(".speaker-choice").first().textContent();
if (!firstChoice?.includes("Mara"))
  problems.push("writer: the speaker picker doesn't offer the name the dialogue tag gives first");
await author.keyboard.press("Enter");
await settled();
const marked = await kept();
if (!/@Mara “Is anyone there\?”/.test(marked))
  problems.push("writer: Ctrl+Shift+K and Ctrl+K didn't give the quote to its tag's name");
// Someone new is added to the cast with the give, so the name raises no warning.
if (!/^ {2}Mara:/m.test(marked))
  problems.push("writer: a passage given to someone new didn't add them to the cast");
// Two quotes in the narrator's words: Ctrl+K in the second gives the second, to its tag's name.
await author.keyboard.press("Control+End");
await author.keyboard.insertText("\n\n“Hello,” said Alice. “Goodbye,” said Bob.\n");
await settled();
await author.keyboard.press("Control+f");
await author.keyboard.type("Goodbye");
await author.keyboard.press("Enter");
await author.keyboard.press("Escape");
await author.keyboard.press("Control+k");
await author.waitForSelector(".speaker-choice");
if (!(await author.locator(".speaker-choice").first().textContent())?.includes("Bob"))
  problems.push("writer: in a line of two quotes, the picker offers the first quote's tag");
await author.keyboard.press("Enter");
await settled();
const twoQuotes = await kept();
if (!twoQuotes.includes("“Hello,” said Alice. @Bob “Goodbye,” said Bob."))
  problems.push("writer: Ctrl+K in a line's second quote gave the wrong quote");
// A name picked from the list has its space: the one typed after it out of habit isn't doubled.
await author.keyboard.press("Control+End");
await author.keyboard.type("\n\n@Ger");
await author.waitForSelector(".cm-tooltip-autocomplete");
await author.keyboard.press("Enter");
await author.keyboard.type(" “Hi.”");
await settled();
if (!(await kept()).includes("@Gerald “Hi.”"))
  problems.push("writer: a space typed after a picked name was doubled");
// A fix clicked straight after typing elsewhere fixes its own warning, where it is now.
await author.click(".cm-content");
await author.keyboard.press("Control+End");
await author.keyboard.insertText("\n\nThe gate [creaks\n");
await settled();
await author.click('.side-tab[data-tab="warnings"]');
await author.keyboard.press("Control+Home");
await author.evaluate(() => document.querySelector(".cm-content")?.focus());
await author.keyboard.press("Control+Home");
await author.keyboard.insertText("PREFIX");
await author.locator("#side-sheet .fix", { hasText: "Close it" }).first().click();
await settled();
const fixedLate = await kept();
if (
  !fixedLate.includes("[creaks]") ||
  /\][^\n]*\[creaks/.test(fixedLate.split("The gate")[1] ?? "")
)
  problems.push("writer: a fix clicked just after typing landed in the wrong place");
await author.keyboard.press("Control+Home");
for (let i = 0; i < 6; i++) await author.keyboard.press("Delete");
await author.click("#file-menu-button");
await author.click('[data-command="new"]');
await author.click('#ask-buttons button[value="discard"]');
await author.click(".cm-content");
await author.keyboard.press("Control+End");
await author.keyboard.type("\n@ Wanda “Hi there.”\n");
// Pasted, so that the bracket stays open (typed, the editor closes it).
await author.keyboard.insertText("\nThe door [creaks\n");
await settled();
// F8 goes to a warning and says it; Ctrl+. puts it right.
await author.keyboard.press("Control+Home");
await author.keyboard.press("F8");
await author.waitForTimeout(200);
if (!(await author.textContent("#notice"))?.includes("(1 of 2)"))
  problems.push("writer: F8 doesn't go to the first warning and say it");
await author.keyboard.press("F8");
await author.keyboard.press("Control+.");
await settled();
if (!(await kept()).includes("[creaks]"))
  problems.push("writer: Ctrl+. didn't put the warning at the cursor right");
await author.click('.side-tab[data-tab="warnings"]');
const mend = author.locator("#side-sheet .fix").first();
if ((await mend.count()) === 0) problems.push("writer: no fix offered for “@ Wanda”");
else {
  await mend.click();
  await settled();
  if (!(await kept()).includes("@Wanda “Hi there.”"))
    problems.push("writer: the fix didn't close the gap in “@ Wanda”");
}
// What is being typed about a character stays while the side is drawn again behind it.
await author.click(".cm-content");
await author.keyboard.type(" More.");
await author.click('.side-tab[data-tab="cast"]');
const typingAbout = author.locator(".cast-about").nth(1);
await typingAbout.fill("Still being typed.");
await author.waitForTimeout(900);
if ((await typingAbout.inputValue()) !== "Still being typed.")
  problems.push("writer: the side drawn again lost what was being typed about a character");
await author.keyboard.press("Escape");
// A warning clicked in a list drawn before the story changed goes where it is now, or says so.
await author.click('.side-tab[data-tab="warnings"]');
await author.click(".cm-content");
await author.keyboard.press("Control+a");
await author.keyboard.press("Delete");
const stale = author.locator("#side-sheet .warning").first();
if (await stale.count()) await stale.click();
await author.waitForTimeout(300);
await authoring.close();
console.log("writer: speaker, direction, undo, search, move, cast, fix: ok");

// On a phone, going from the side to the text closes the side over it, and the text has the keys.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
const phonePage = await phone.newPage();
watch(phonePage, "writer on a phone");
await phonePage.goto(`${base}/writer/`);
await phonePage.click(`.welcome-example[data-name="${dragonName}"]`);
await phonePage.waitForSelector("#welcome", { state: "hidden" });
await phonePage.click("#preview-toggle");
await phonePage.click('.side-tab[data-tab="cast"]');
await phonePage.locator(".cast-find").first().click();
await phonePage.waitForTimeout(300);
if (
  await phonePage.evaluate(
    () =>
      document.querySelector(".manuscript")?.inert ||
      !document.activeElement?.classList.contains("cm-content"),
  )
)
  problems.push("writer: on a phone, a jump from the side to the text leaves the side over it");
// Every menu stays inside a phone's width.
for (const menu of ["file", "edit", "insert", "view", "help"]) {
  await phonePage.click(`#${menu}-menu-button`);
  const right = await phonePage.evaluate(
    (id) => document.querySelector(`#${id}-menu`)?.getBoundingClientRect().right ?? 0,
    menu,
  );
  if (right > 390)
    problems.push(
      `writer: on a phone, the ${menu} menu runs ${Math.round(right - 390)} px past the window`,
    );
  await phonePage.keyboard.press("Escape");
}
await phone.close();

// Insert and export: a sound, a page turn and a scene break put in where the cursor is; the book,
// the script and the lines downloaded; the shortcuts listed.
const making = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
});
const maker = await making.newPage();
watch(maker, "writer insert and export");
const draftOf = () => draftIn(maker);
await maker.goto(`${base}/writer/`);
await maker.click('.welcome [data-command="new"]');
await maker.keyboard.type("Once upon a time, there was a witch.");
await maker.click("#insert-menu-button");
await maker.click('[data-command="insert-sound"]');
await maker.fill("#ask-input", "an owl hoots");
await maker.keyboard.press("Enter");
await maker.click("#insert-menu-button");
await maker.click('[data-command="insert-break"]');
await maker.click("#insert-menu-button");
await maker.click('[data-command="insert-page"]');
await maker.waitForTimeout(300);
// After a command from a menu, the keyboard is back in the text.
if (!(await maker.evaluate(() => document.activeElement?.classList.contains("cm-content"))))
  problems.push("writer: after Insert › A page turn, the focus stays on the menu");
// A pause put in mid-word goes after the word.
await maker.keyboard.type(" Then the training began.");
for (let i = 0; i < 10; i++) await maker.keyboard.press("ArrowLeft");
await maker.click("#insert-menu-button");
await maker.click('[data-command="insert-pause"]');
await maker.waitForTimeout(900);
if (!(await draftOf()).includes("training {pause 1s}"))
  problems.push("writer: Insert › A pause split a word");
// A note put in with words selected goes after them, never over them.
await maker.keyboard.press("End");
await maker.keyboard.press("Shift+Home");
await maker.click("#insert-menu-button");
await maker.click('[data-command="insert-note"]');
await maker.waitForTimeout(900);
if (!(await draftOf()).includes("the training {pause 1s} began."))
  problems.push("writer: Insert › A note replaced the words selected");
const made = await draftOf();
if (!made.includes("[an owl hoots]")) problems.push("writer: Insert › A sound… put nothing in");
if (!/\n\* \* \*\n/.test(made)) problems.push("writer: Insert › A scene break put nothing in");
if (!made.includes("{page}")) problems.push("writer: Insert › A page turn put nothing in");
for (const [command, name] of [
  ["export-book", "Untitled.html"],
  ["export-script", "Untitled-script.html"],
  ["export-csv", "Untitled.csv"],
]) {
  await maker.click("#file-menu-button");
  const [download] = await Promise.all([
    maker.waitForEvent("download"),
    maker.click(`[data-command="${command}"]`),
  ]);
  if (download.suggestedFilename() !== name)
    problems.push(`writer: ${command} downloaded ${download.suggestedFilename()}, not ${name}`);
  // The cue sheet has the sounds and the pauses, in plain words.
  if (command === "export-csv") {
    const sheet = readFileSync(await download.path(), "utf8");
    if (!/^sound,/m.test(sheet) || !/^pause,/m.test(sheet))
      problems.push("writer: the CSV leaves out the sounds or the pauses");
  }
}
// F9 reads it aloud from the cursor, and says how to stop.
await maker.click(".cm-content");
await maker.keyboard.press("Control+Home");
const placeBeforeF9 = await maker.textContent("#cursor-place");
await maker.keyboard.press("F9");
await maker.waitForTimeout(1800);
if (
  !(await maker.textContent("#notice"))?.match(
    /Reading aloud|can’t read aloud|Nothing to hear|no voices/,
  )
)
  problems.push("writer: F9 doesn't read aloud or say why not");
// With no voices (as here), nothing is read and the cursor stays where it was.
if (
  (await maker.textContent("#notice"))?.includes("no voices") &&
  (await maker.textContent("#cursor-place")) !== placeBeforeF9
)
  problems.push("writer: F9 with no voices moved the cursor");
await maker.keyboard.press("Escape");
// The side made wider with the keyboard on its edge; the text larger from Page and text.
const sideBefore = await maker.evaluate(
  () => document.querySelector("#side")?.getBoundingClientRect().width ?? 0,
);
await maker.focus("#side-resize");
for (let i = 0; i < 4; i++) await maker.keyboard.press("ArrowLeft");
await maker.waitForTimeout(200);
const sideAfter = await maker.evaluate(
  () => document.querySelector("#side")?.getBoundingClientRect().width ?? 0,
);
if (sideAfter <= sideBefore + 20)
  problems.push("writer: the side's edge doesn't widen it from the keyboard");
const sizeBefore = await maker.evaluate(
  () => getComputedStyle(document.querySelector(".cm-content")).fontSize,
);
await maker.click("#view-menu-button");
await maker.click('[data-command="page"]');
await maker.waitForSelector("#page-settings[open]");
await maker.fill("#page-size", "21");
await maker.dispatchEvent("#page-size", "input");
await maker.click('#page-settings button[value="done"]');
const sizeAfter = await maker.evaluate(
  () => getComputedStyle(document.querySelector(".cm-content")).fontSize,
);
if (sizeAfter === sizeBefore || sizeAfter !== "21px")
  problems.push(`writer: Page and text set the text to ${sizeAfter}, not 21px`);
// A writing goal: the words written since opening, out of it, and a word when it is reached.
await maker.click("#view-menu-button");
await maker.click('[data-command="goal"]');
await maker.fill("#ask-input", "3");
await maker.keyboard.press("Enter");
await maker.click(".cm-content");
await maker.keyboard.press("Control+End");
await maker.keyboard.type(" Three more words.");
await maker.waitForTimeout(900);
if (!(await maker.textContent("#counts"))?.includes("of 3)"))
  problems.push("writer: the writing goal isn't shown with the words written");
if (!(await maker.textContent("#notice"))?.includes("goal is reached"))
  problems.push("writer: reaching the writing goal says nothing");
// Cancel leaves the goal as it was.
await maker.click("#view-menu-button");
await maker.click('[data-command="goal"]');
await maker.click('#ask-buttons button[value="cancel"]');
await maker.waitForTimeout(300);
if (!(await maker.textContent("#counts"))?.includes("of 3)"))
  problems.push("writer: Cancel took the writing goal away");
// A title that would close the print page's style and open a script stays words: nothing runs.
await maker.click("#file-menu-button");
await maker.click('[data-command="details"]');
await maker.waitForSelector("#details[open]");
await maker.fill("#detail-title", "</style><script>parent.__ran = true</script><style>");
await maker.click('#details button[value="done"]');
await maker.waitForTimeout(300);
for (const command of ["print", "print-script", "print-sides"]) {
  await maker.click("#file-menu-button");
  await maker.click(`[data-command="${command}"]`);
  await maker.waitForTimeout(400);
}
if (await maker.evaluate(() => "__ran" in window))
  problems.push("writer: a story's title ran as a script in the print page");
// Sides give each line with its cue, the end of the line before.
await maker.click(".cm-content");
await maker.keyboard.press("Control+End");
await maker.keyboard.type("\n\n@Ann “Where were you all night?”\n\n@Bob “Out.”");
await maker.click("#file-menu-button");
const [sidesFile] = await Promise.all([
  maker.waitForEvent("download"),
  maker.click('[data-command="export-sides"]'),
]);
const sidesText = readFileSync(await sidesFile.path(), "utf8");
if (!/…Where were you all night\? \(Ann\)\nBob: Out\./.test(sidesText))
  problems.push("writer: the sides give Bob's line without Ann's cue before it");
// Focus: the rail and side away, the paragraph being written in full ink, and back.
await maker.keyboard.press("Control+Shift+f");
if (
  !(await maker.evaluate(() => document.body.hasAttribute("data-focus"))) ||
  (await maker.isVisible("#scene-rail"))
)
  problems.push("writer: Ctrl+Shift+F doesn't focus on the writing");
if ((await maker.locator(".cm-line.in-focus").count()) === 0)
  problems.push("writer: in focus, the paragraph being written isn't set apart");
await maker.keyboard.press("Control+Shift+f");
if (await maker.evaluate(() => document.body.hasAttribute("data-focus")))
  problems.push("writer: Ctrl+Shift+F doesn't leave focus");
await maker.keyboard.press("Control+/");
if ((await maker.locator("#shortcut-list dt").count()) < 8)
  problems.push("writer: Ctrl+/ doesn't list the shortcuts");
await making.close();
console.log("writer: insert, export, shortcuts: ok");

// Two tabs: the second reads only, until it takes the story, with the first tab's last words;
// the first then reads only. A file changed on disk since it was opened isn't saved over unasked.
const tabs = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await tabs.addInitScript(() => {
  const handle = (name) => ({
    kind: "file",
    name,
    getFile: async () => {
      const disk = JSON.parse(localStorage.getItem("__disk") ?? "{}");
      return new File([disk[name]?.text ?? ""], name, { lastModified: disk[name]?.at ?? 1 });
    },
    createWritable: async () => {
      let written = "";
      return {
        write: async (text) => {
          written += text;
        },
        close: async () => {
          const disk = JSON.parse(localStorage.getItem("__disk") ?? "{}");
          disk[name] = { text: written, at: (disk[name]?.at ?? 1) + 1 };
          localStorage.setItem("__disk", JSON.stringify(disk));
        },
      };
    },
    isSameEntry: async (other) => other.name === name,
    queryPermission: async () => "granted",
    requestPermission: async () => "granted",
  });
  window.showOpenFilePicker = async () => {
    const disk = JSON.parse(localStorage.getItem("__disk") ?? "{}");
    disk["tale.vxd"] ??= { text: "# A tale\n\n@Ann “Hi.”\n", at: 1 };
    localStorage.setItem("__disk", JSON.stringify(disk));
    return [handle("tale.vxd")];
  };
  window.showSaveFilePicker = async ({ suggestedName }) => handle(suggestedName);
});
const first = await tabs.newPage();
watch(first, "writer tab 1");
await first.goto(`${base}/writer/`);
await first.click('.welcome [data-command="open"]');
await first.waitForFunction(() => document.querySelector("#file-name")?.textContent === "tale.vxd");
await first.click(".cm-content");
await first.keyboard.press("Control+End");
// The file changes on disk; saving asks first, and Cancel leaves it as it is.
await first.evaluate(() => {
  const disk = JSON.parse(localStorage.getItem("__disk") ?? "{}");
  disk["tale.vxd"] = { text: "# Changed elsewhere\n", at: (disk["tale.vxd"]?.at ?? 1) + 5 };
  localStorage.setItem("__disk", JSON.stringify(disk));
});
await first.keyboard.type("Typed in the first tab.");
await first.keyboard.press("Control+s");
await first.waitForSelector("#ask[open]");
if (!(await first.textContent("#ask-message"))?.includes("changed outside"))
  problems.push("writer: saving over a file changed on disk didn't ask first");
await first.click('#ask-buttons button[value="cancel"]');
const onDiskNow = await first.evaluate(
  () => JSON.parse(localStorage.getItem("__disk") ?? "{}")["tale.vxd"]?.text,
);
if (onDiskNow !== "# Changed elsewhere\n")
  problems.push("writer: a file changed on disk was saved over after Cancel");
await first.waitForTimeout(900);
const second = await tabs.newPage();
watch(second, "writer tab 2");
await second.goto(`${base}/writer/`);
await second.waitForSelector("#elsewhere:not([hidden])");
if (
  !(await second.evaluate(() => document.querySelector(".cm-content")?.contentEditable === "false"))
)
  problems.push("writer: a second tab can write over the first tab's story");
await first.keyboard.type(" Followed.");
await second
  .waitForFunction(
    () => document.querySelector(".cm-content")?.textContent?.includes("Followed."),
    undefined,
    { timeout: 5000 },
  )
  .catch(() => problems.push("writer: a tab that only reads doesn't follow the one that writes"));
await first.keyboard.type(" Last words.");
// What is typed about a character, the field not left, goes with the story to the other tab.
await first.click('.side-tab[data-tab="cast"]');
await first.locator(".cast-about").first().fill("Typed in the first tab, field not left.");
await second.click("#edit-here");
await second.waitForSelector("#elsewhere", { state: "hidden" });
await second.waitForTimeout(300);
if (!(await second.locator(".cm-content").innerText()).includes("Last words."))
  problems.push("writer: taking the story to a second tab lost the first tab's last words");
await second.waitForTimeout(600);
if (!(await draftIn(second)).includes("field not left"))
  problems.push("writer: taking the story to another tab lost what was typed in the cast");
await first.waitForSelector("#elsewhere:not([hidden])");
// The tab that writes, reloaded, writes its story again; the one that reads goes on reading.
await second.reload();
await second.waitForFunction(
  () => document.querySelector("#file-name")?.textContent === "tale.vxd",
);
await second.waitForTimeout(800);
if (!(await second.isHidden("#elsewhere")))
  problems.push("writer: a reloaded tab handed its story to a tab that only read it");
if (await first.isHidden("#elsewhere"))
  problems.push("writer: a tab that only read took the story while the other reloaded");
// The first tab, now reading only, saves nothing over what the second writes: it asks.
const diskBefore = await first.evaluate(() => localStorage.getItem("__disk"));
await first.keyboard.press("Control+s");
await first.waitForSelector("#ask[open]");
if (!(await first.textContent("#ask-message"))?.includes("another tab"))
  problems.push("writer: a tab that only reads saves without asking");
await first.click('#ask-buttons button[value="cancel"]');
await first.waitForTimeout(300);
if ((await first.evaluate(() => localStorage.getItem("__disk"))) !== diskBefore)
  problems.push("writer: a tab that only reads saved over the file");
// The tab that writes closes: the one that reads writes the story from then on, its last words.
await second.keyboard.type(" Written in the second tab before it closed.");
await second.waitForTimeout(900);
await second.close();
await first
  .waitForSelector("#elsewhere", { state: "hidden", timeout: 8000 })
  .catch(() => problems.push("writer: the tab that reads doesn't write when the other closes"));
await first.waitForTimeout(300);
if (!(await first.locator(".cm-content").innerText()).includes("before it closed."))
  problems.push("writer: taking over from a closed tab lost its last words");
await tabs.close();
console.log("writer: two tabs, a file changed on disk: ok");

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
