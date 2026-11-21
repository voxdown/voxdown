// Browser checks for VoxDown Composer. Run after pnpm site:build.
import assert from "node:assert/strict";
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { chromium } from "playwright";

const dist = resolve("site/dist");
const served = new Map();
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://local").pathname);
  let file = resolve(dist, `.${path}`);
  if (!file.startsWith(`${dist}/`)) return res.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) file = resolve(file, "index.html");
  if (!existsSync(file)) return res.writeHead(404).end();
  served.set(path, statSync(file).size);
  res.writeHead(200, {
    "Content-Type":
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".woff2": "font/woff2",
        ".mp3": "audio/mpeg",
        ".md": "text/markdown",
      }[extname(file)] ?? "application/octet-stream",
  });
  createReadStream(file).pipe(res);
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`;
const url = `${base}/composer/`;
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const errors = [];
const external = [];
const watch = (context) => {
  context.on("page", (page) => {
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
  });
  context.on("request", (request) => {
    if (
      !request.url().startsWith(base) &&
      !request.url().startsWith("blob:") &&
      !request.url().startsWith("data:")
    )
      external.push(request.url());
  });
};
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
});
watch(context);
const page = await context.newPage();
const state = (p = page) => p.evaluate(() => window.composer.state());
const docText = (p = page) => p.evaluate(() => window.composer.view.state.doc.toString());
const selection = (p = page) =>
  p.evaluate(() => {
    const view = window.composer.view;
    return view.state.selection.ranges.map((range) =>
      view.state.doc.sliceString(range.from, range.to),
    );
  });
const drawn = (p = page) =>
  p.waitForFunction(() => (window.composer.state().timeline?.notes ?? 0) > 0);
const openExample = async (title, p = page) => {
  if (await p.locator("#start").isVisible())
    await p.getByRole("button", { name: title }).first().click();
  else {
    await p.locator('[data-menu="help"]').click();
    await p.getByRole("menuitem", { name: `Example: ${title}` }).click();
  }
  await p.waitForFunction(
    (name) => document.getElementById("score-summary").textContent.startsWith(name),
    title,
  );
  await drawn(p);
};
const setCaret = (offset, p = page) =>
  p.evaluate((at) => {
    const view = window.composer.view;
    view.dispatch({ selection: { anchor: at } });
  }, offset);
const menu = async (name, item, p = page) => {
  await p.locator(`[data-menu="${name}"]`).click();
  await p
    .getByRole("menuitem", { name: item })
    .or(p.getByRole("menuitemcheckbox", { name: item }))
    .first()
    .click();
};
const noteCenter = (voice, time, p = page) =>
  p.evaluate(
    ([v, t]) => {
      const note = window.composer
        .scoreIndex()
        .byVoice[v].find((each) => Math.abs(each.time - t) < 1e-6);
      const box = note.elements[0].getBoundingClientRect();
      return {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
        start: note.start,
        end: note.end,
      };
    },
    [voice, time],
  );
const settle = (ms) => page.waitForTimeout(ms);

/* 1. The start screen is light: no abcjs, no samples. */
await page.goto(url);
await page.getByRole("heading", { name: /Write music/ }).waitFor();
await settle(400);
const firstView = [...served.entries()].reduce((sum, [, size]) => sum + size, 0);
assert(![...served.keys()].some((path) => /sounds\//.test(path)), "no samples before listening");
const abcjsChunk = readdirSync(resolve(dist, "assets")).find(
  (file) =>
    file.endsWith(".js") &&
    readFileSync(resolve(dist, "assets", file), "utf8").includes("abcjs-basic v"),
);
assert(abcjsChunk, "abcjs is a chunk of its own");
assert(!served.has(`/assets/${abcjsChunk}`), "abcjs waits until there is a tune to draw");
console.log(
  `Composer: start screen, ${(firstView / 1024).toFixed(0)} KB served uncompressed, no abcjs or samples: passed`,
);

/* 2. Open → download is byte-identical (BOM, CRLF, a second tune), even after an edit is undone. */
const original =
  "\uFEFFX:1\r\nT:Café tune\r\nM:3/4\r\nL:1/8\r\nK:D\r\nA2 | d2 f2 a2 | g2 e2 c2 | d6 |]\r\n\r\nX:2\r\nT:Second\r\nK:G\r\nG4 |]\r\n";
await page
  .locator("#file")
  .setInputFiles({ name: "Exact.abc", mimeType: "text/plain", buffer: Buffer.from(original) });
await page.waitForFunction(() => document.getElementById("name").value === "Exact.abc");
await drawn();
const downloadBytes = async () => {
  const pending = page.waitForEvent("download");
  await menu("file", "Download .abc");
  const download = await pending;
  return readFileSync(await download.path());
};
assert.deepEqual(
  await downloadBytes(),
  Buffer.from(original),
  "unchanged file downloads byte for byte",
);
await page.locator(".cm-content").click();
await page.keyboard.press("End");
await page.keyboard.type("z");
await page.keyboard.press("Control+z");
await settle(200);
assert.deepEqual(await downloadBytes(), Buffer.from(original), "edit and undo keeps the bytes");
assert.equal(await page.locator(".tune-item").count(), 2, "rail lists both tunes");
console.log(
  "Composer: open and download byte-identical (BOM, CRLF, two tunes), rail lists tunes: passed",
);

/* 3. Recovery: the draft survives a reload; a second tab starts its own. */
await setCaret((await docText()).indexOf("d6"));
await page.keyboard.type("e2 ");
await settle(1200);
const edited = await docText();
await page.reload();
await page.waitForFunction((text) => window.composer?.view.state.doc.toString() === text, edited);
const second = await context.newPage();
await second.goto(url);
await second.getByRole("heading", { name: /Write music/ }).waitFor();
await second.getByRole("button", { name: "Start a new tune" }).click();
await second.keyboard.type("CDEF|");
await second.waitForTimeout(1200);
await second.close();
await page.reload();
await page.waitForFunction((text) => window.composer?.view.state.doc.toString() === text, edited);
console.log(
  "Composer: reload recovers this tab's draft; another tab keeps a separate draft: passed",
);

/* 4. Playback: sound is scheduled, and the lit note advances in the score and the text. */
await openExample("Frère Jacques");
await setCaret(0);
const pressed = Date.now();
await page.locator("#play").click();
await page.waitForFunction(() => window.composer.state().scheduled > 0);
const cold = Date.now() - pressed;
const keys = new Set();
for (let i = 0; i < 8; i++) {
  await settle(250);
  const now = await state();
  assert.equal(now.status, "playing");
  if (now.playingKey) keys.add(now.playingKey);
}
assert(keys.size >= 3, `the lit note advances (${keys.size} distinct)`);
assert(await page.locator("#score .is-playing").count(), "a note is lit in the score");
assert(await page.locator(".cm-content .abc-playing").count(), "a note is lit in the text");
await page.locator("#stop").click();
await settle(100);
const warmPress = Date.now();
await page.locator("#play").click();
await page.waitForFunction(() => window.composer.state().scheduled > 0);
const warm = Date.now() - warmPress;
const latency = (await state()).metrics.startLatency;
await page.locator("#stop").click();
console.log(
  `Composer: playback schedules audio and the lit note advances; first Play scheduled in ${cold} ms, a second in ${warm} ms (${latency.toFixed(0)} ms in the page): passed`,
);

/* 5. Play from the caret, and tempo. */
const fromCaret = await noteCenter(0, 2);
await setCaret(fromCaret.start);
await page.keyboard.press("Control+Shift+Enter").catch(() => {});
await page.locator("#from-caret").click();
await settle(150);
const started = await state();
assert(
  started.position >= 1.9 && started.position < 2.3,
  `play from caret starts at bar 3 (${started.position})`,
);
const speed = async () => {
  const a = await state();
  await settle(600);
  const b = await state();
  return (b.position - a.position) / 0.6;
};
const before = await speed();
await page.locator("#tempo").fill("208");
await page.locator("#tempo").press("Enter");
await settle(100);
const after = await speed();
assert(
  after > before * 1.6,
  `doubling the tempo nearly doubles the speed (${before.toFixed(3)} → ${after.toFixed(3)})`,
);
await page.locator("#stop").click();
await page.locator("#tempo").fill("");
await page.locator("#tempo").press("Enter");
console.log(
  "Composer: play from caret starts at the caret's note; tempo changes the speed: passed",
);

/* 6. Linking both ways: caret → lit note; click a note → its text; drag across staves → two ranges. */
await setCaret(fromCaret.start);
await settle(150);
assert(await page.locator("#score .is-caret").count(), "the caret's note is lit in the score");
const target = await noteCenter(1, 3);
await page.mouse.click(target.x, target.y);
await settle(150);
const clicked = await selection();
assert.equal(clicked.length, 1);
assert.equal(
  clicked[0],
  (await docText()).slice(target.start, target.end),
  "clicking a note selects its text",
);
const a = await noteCenter(0, 2);
const b = await noteCenter(1, 3.75);
await page.mouse.move(a.x, a.y);
await page.mouse.down();
await page.mouse.move(b.x, b.y, { steps: 8 });
await page.mouse.up();
await settle(150);
assert.deepEqual(
  await selection(),
  ["B c d2 | B c d2 |", "!mp!G, A, B, G, | G, A, B, G, |"],
  "a two-voice region selects one range per voice",
);
assert(
  (await page.locator(".score-band.selection").count()) >= 2,
  "the region has a band on each staff",
);
// Within one staff: that voice only.
const c = await noteCenter(0, 0);
const d = await noteCenter(0, 1.5);
await page.mouse.move(c.x, c.y);
await page.mouse.down();
await page.mouse.move(d.x, d.y, { steps: 6 });
await page.mouse.up();
assert.deepEqual(
  await selection(),
  ["!mp!G A B G | G A B"],
  "a drag in one staff selects that voice",
);
// Shift+Alt+→ extends by a note, in the score's terms.
await page.locator(".cm-content").focus();
await page.keyboard.press("Alt+Shift+ArrowRight");
assert.deepEqual(
  await selection(),
  ["!mp!G A B G | G A B G |"],
  "Shift Alt → adds the next note, with its bar line",
);
console.log(
  "Composer: caret lights its note; click selects text; drags select regions per voice or across voices; Shift Alt → extends: passed",
);

/* 7. Loop the region: only its notes sound. */
await page.mouse.move(a.x, a.y);
await page.mouse.down();
await page.mouse.move(b.x, b.y, { steps: 8 });
await page.mouse.up();
const ranges = await page.evaluate(() =>
  window.composer.view.state.selection.ranges.map((range) => [range.from, range.to]),
);
await page.locator("#loop").click();
await page.waitForFunction(() => window.composer.state().region);
const regionNotes = await page.evaluate(() =>
  window.composer.player.timeline.notes.map((note) => note.start),
);
assert(
  regionNotes.every((start) => ranges.some(([from, to]) => start >= from && start < to)),
  `the loop holds only the region's notes ${JSON.stringify({ regionNotes, ranges })}`,
);
const seen = new Set();
let maxPosition = 0;
for (let i = 0; i < 26; i++) {
  await settle(250);
  const now = await state();
  maxPosition = Math.max(maxPosition, now.position);
  for (const key of now.playingKey.split(",").filter(Boolean)) seen.add(Number(key));
}
const regionLength = await page.evaluate(() => window.composer.player.timeline.length);
assert.equal(regionLength, 2, "the region is bars 3 and 4");
assert(maxPosition <= regionLength + 0.05, `the loop wraps at the region's end (${maxPosition})`);
assert(
  [...seen].every((start) => ranges.some(([from, to]) => start >= from && start < to)),
  "only region notes light while looping",
);
await page.locator("#loop").click();
await page.locator("#stop").click();
console.log(
  "Composer: looping a two-voice region plays and lights only its notes, and wraps: passed",
);

/* 8. Musical commands on a region: one undo step. */
await page.mouse.move(a.x, a.y);
await page.mouse.down();
await page.mouse.move(b.x, b.y, { steps: 8 });
await page.mouse.up();
const beforeTranspose = await docText();
await page.locator('[data-command="transpose-up"]').click();
const transposed = await docText();
assert(
  transposed.includes("c ^c ^d2 | c ^c ^d2 |"),
  `the region moved up a semitone: ${transposed}`,
);
// B, becomes middle C; the sharp written on the first G, carries through the bar.
assert(
  transposed.includes("!mp!^G, ^A, C G, | ^G, ^A, C G, |"),
  `the second voice moved too: ${transposed}`,
);
await page.locator("#undo").click();
assert.equal(await docText(), beforeTranspose, "one undo restores both voices");
console.log("Composer: transpose applies to every range as one undoable step: passed");

/* 9. Redraws keep the reader's place; editing while playing keeps playing. */
await openExample("Greensleeves");
await page.locator("#score-scroll").evaluate((element) => {
  element.scrollTop = 260;
});
await settle(100);
const topBefore = await page.locator("#score-scroll").evaluate((element) => element.scrollTop);
const heightBefore = await page.locator("#score").evaluate((element) => element.offsetHeight);
// A change that redraws the score without changing its height (a note's length elsewhere).
await setCaret((await docText()).indexOf("e>fe") + 4);
await page.locator(".cm-content").focus();
await page.keyboard.press("Backspace");
await page.keyboard.type("d");
await settle(900);
const topAfter = await page.locator("#score-scroll").evaluate((element) => element.scrollTop);
assert(
  Math.abs(topAfter - topBefore) < 2,
  `the score stays where the reader left it (${topBefore} → ${topAfter})`,
);
assert.equal(
  await page.locator("#score").evaluate((element) => element.offsetHeight),
  heightBefore,
  "no layout shift",
);
await page.locator("#play").click();
await page.waitForFunction(() => window.composer.state().scheduled > 0);
await page.evaluate(() => {
  const view = window.composer.view;
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  view.focus();
});
await page.keyboard.type("% more");
await settle(1200);
assert.equal((await state()).status, "playing", "editing does not stop playback");
await page.locator("#stop").click();
console.log(
  "Composer: redraws keep the reader's place without layout shift; editing while playing keeps playing: passed",
);

/* 10. Help while writing: a long bar is noted after a pause; completion offers keys. */
await page.evaluate(() => {
  const view = window.composer.view;
  const text = view.state.doc.toString();
  const at = text.indexOf('| "G"d2 B G>AB |');
  view.dispatch({ changes: { from: at + 2, insert: "c " } });
  view.dispatch({ selection: { anchor: 0 } });
});
await page.waitForFunction(() => !document.getElementById("problems").hidden, null, {
  timeout: 5000,
});
assert.match(
  await page.locator("#problems").textContent(),
  /1 note to check/,
  await page.locator("#problems").textContent(),
);
assert(await page.locator(".abc-bar-issue").count(), "the long bar is marked in the text");
await page.locator("#problems").click();
assert.match(
  await page.locator("#problems-dialog").textContent(),
  /This bar has 7 eighths; M:6\/8 holds 6 eighths/,
);
await page.keyboard.press("Escape");
await page.evaluate(() => {
  const view = window.composer.view;
  const end = view.state.doc.length;
  const insert = "\nX:9\nT:New\nK:";
  view.dispatch({ changes: { from: end, insert }, selection: { anchor: end + insert.length } });
  view.focus();
});
await page.keyboard.type("E");
await page.locator(".cm-tooltip-autocomplete").waitFor();
assert.match(await page.locator(".cm-tooltip-autocomplete").textContent(), /Em/);
await page.keyboard.press("Escape");
console.log(
  "Composer: bar check notes a long bar after a pause, with a problems list; key completion: passed",
);

/* 11. Phone: Text | Score switch with the transport at hand. */
const phone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});
watch(phone);
const small = await phone.newPage();
await small.goto(url);
await small.getByRole("button", { name: "Ode to Joy" }).click();
await small.waitForFunction(() => (window.composer.state().timeline?.notes ?? 0) > 0);
assert(await small.locator("#show-score").isVisible(), "Score switch visible");
assert(await small.locator("#play").isVisible(), "Play visible on a phone");
await small.locator("#show-score").click();
await small.waitForTimeout(400);
assert(await small.locator("#score svg").isVisible(), "the score shows");
const overflow = await small.evaluate(
  () => document.documentElement.scrollWidth - window.innerWidth,
);
assert(overflow <= 0, "no sideways scroll on a phone");
await phone.close();
console.log("Composer: phone layout switches Text and Score with the transport visible: passed");

assert.deepEqual(errors, [], "no console errors");
assert.deepEqual(external, [], "no request leaves the site");
console.log("Composer: no console errors and no requests leaving the site: passed");
await browser.close();
await new Promise((done) => server.close(done));
