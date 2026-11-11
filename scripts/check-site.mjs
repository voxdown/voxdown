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
console.log("writer: recovering a draft, going back to a version: ok");

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
await edge.keyboard.type("\n@Bob “Hi.”");
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
await edges.close();
console.log("writer: drop, bar width, welcome, rename, Ctrl+K: ok");

// Typing in a long book stays quick: no key held up for long, with the script beside it.
const long = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const corpusDir = join(site, "..", "corpus");
const bodies = readdirSync(corpusDir)
  .filter((name) => name.endsWith(".vxd"))
  .map((name) =>
    readFileSync(join(corpusDir, name), "utf8")
      .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
      .replace(/\r\n/g, "\n"),
  )
  .join("\n\n");
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
await longPage.waitForTimeout(600);
const slowest = await longPage.evaluate(() => Math.max(0, ...window.__keys));
if (slowest > 400)
  problems.push(`writer: in a 100,000-word book, a key took ${slowest} ms (budget 400 ms)`);
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
await auto.close();
console.log("writer: saving automatically: ok");

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
await author.click('.side-tab[data-tab="cast"]');
const king = author.locator('.cast-handle input[value="King"]');
await king.fill("Monarch");
await king.press("Enter");
await settled();
const renamed = await kept();
if (!renamed.includes("@Monarch") || renamed.includes("@King"))
  problems.push("writer: renaming King in the cast didn't rename every mark");
await author.click("#file-menu-button");
await author.click('[data-command="new"]');
await author.click('#ask-buttons button[value="discard"]');
await author.click(".cm-content");
await author.keyboard.press("Control+End");
await author.keyboard.type("\n@ Wanda “Hi there.”\n");
await settled();
await author.click('.side-tab[data-tab="warnings"]');
const mend = author.locator("#side-sheet .fix").first();
if ((await mend.count()) === 0) problems.push("writer: no fix offered for “@ Wanda”");
else {
  await mend.click();
  await settled();
  if (!(await kept()).includes("@Wanda “Hi there.”"))
    problems.push("writer: the fix didn't close the gap in “@ Wanda”");
}
await authoring.close();
console.log("writer: speaker, direction, undo, search, move, cast, fix: ok");

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
await maker.click(".cm-line >> text=Once upon a time");
await maker.keyboard.press("End");
await maker.click("#insert-menu-button");
await maker.click('[data-command="insert-sound"]');
await maker.fill("#ask-input", "an owl hoots");
await maker.keyboard.press("Enter");
await maker.click("#insert-menu-button");
await maker.click('[data-command="insert-break"]');
await maker.click("#insert-menu-button");
await maker.click('[data-command="insert-page"]');
await maker.waitForTimeout(900);
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
}
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
await first.keyboard.type(" Last words.");
await second.click("#edit-here");
await second.waitForSelector("#elsewhere", { state: "hidden" });
await second.waitForTimeout(300);
if (!(await second.locator(".cm-content").innerText()).includes("Last words."))
  problems.push("writer: taking the story to a second tab lost the first tab's last words");
await first.waitForSelector("#elsewhere:not([hidden])");
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
