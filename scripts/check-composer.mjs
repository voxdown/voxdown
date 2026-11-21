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
// Playback followed the music; start from the top so no drag begins at the score's scrolling edge.
await page.locator("#score-scroll").evaluate((element) => {
  element.scrollTop = 0;
});
await settle(100);
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
// Loop is a mode: pressing it lights it and does not start playing; Play starts the loop.
await page.locator("#loop").click();
assert.equal(await page.locator("#loop").getAttribute("aria-pressed"), "true", "Loop is lit");
await settle(200);
assert.equal((await state()).status, "stopped", "Loop alone does not start playback");
await page.locator("#play").click();
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
// Playback followed the music, so the score may have scrolled: measure again.
await page.locator("#score-scroll").evaluate((element) => {
  element.scrollTop = 0;
});
const a2 = await noteCenter(0, 2);
const b2 = await noteCenter(1, 3.75);
await page.mouse.move(a2.x, a2.y);
await page.mouse.down();
await page.mouse.move(b2.x, b2.y, { steps: 8 });
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

/* 8b. Dragging reads the pointer in time: a note joins only once the pointer reaches its head,
   and nothing from the next bar joins until the pointer has passed the bar line and its note. */
const geometry = () => page.evaluate(() => window.composer.geometry());
const selectedStarts = () =>
  page.evaluate(() => {
    const view = window.composer.view;
    const list = view.state.selection.ranges.filter((range) => !range.empty);
    return window.composer
      .scoreIndex()
      .notes.filter((note) =>
        list.some((range) => note.start >= range.from && note.end <= range.to),
      )
      .map((note) => note.start);
  });
const staffMiddle = (geo, line, staff) => {
  const box = geo.staves.find((each) => each.line === line && each.staff === staff);
  return (box.top + box.bottom) / 2;
};
/** Every note in the dragged voices on this system, from the region's start: in ⇔ head reached. */
const expectReached = async (geo, voices, from, line, x, label) => {
  const selected = new Set(await selectedStarts());
  for (const note of geo.notes) {
    if (!voices.includes(note.voice) || note.line !== line || note.time < from - 1e-6) continue;
    assert.equal(
      selected.has(note.start),
      note.head <= x,
      `${label}: note at ${note.time} (voice ${note.voice}, head ${note.head.toFixed(1)}, pointer ${x.toFixed(1)})`,
    );
  }
};
const barBetween = (geo, line, left, right) =>
  geo.bars.find((bar) => bar.line === line && bar.x > left && bar.x < right);

// Two voices: drag from voice 2's bar 3 up into voice 1's half note, then across the bar line.
{
  const geo = await geometry();
  const at = (voice, time) =>
    geo.notes.find((note) => note.voice === voice && Math.abs(note.time - time) < 1e-6);
  const start = at(1, 2);
  const half = at(0, 2.5);
  const lastQuarter = at(1, 2.75);
  const next = [at(0, 3), at(1, 3)];
  assert.equal(half.line, next[0].line, "bars 3 and 4 share a system");
  const line = half.line;
  const bar = barBetween(geo, line, half.head, Math.min(...next.map((note) => note.head)));
  const y = staffMiddle(geo, line, 0);
  await page.mouse.move(start.head + 3, start.y);
  await page.mouse.down();
  const steps = [
    ["inside the half note, before voice 2's last quarter", half.head + 3],
    ["at voice 2's last quarter", lastQuarter.head + 2],
    ["in the gap before the bar line", bar.x - 3],
    ["just past the bar line", bar.x + 3],
    ["at the next bar's first notes", Math.max(...next.map((note) => note.head)) + 2],
  ];
  for (const [label, x] of steps) {
    await page.mouse.move(x, y, { steps: 4 });
    await expectReached(geo, [0, 1], 2, line, x, `two voices, ${label}`);
    const inNext = (await selectedStarts()).some((each) =>
      next.some((note) => note.start === each),
    );
    assert.equal(
      inNext,
      x >= Math.min(...next.map((note) => note.head)),
      `two voices, ${label}: next bar`,
    );
  }
  await page.mouse.up();
}
console.log(
  "Composer: a two-voice drag takes notes only as the pointer reaches them, and no next bar before its bar line: passed",
);

// One voice with a long last note, the gap after it, Shift click, and a first press.
await page.evaluate(() => {
  const view = window.composer.view;
  view.dispatch({
    changes: {
      from: 0,
      to: view.state.doc.length,
      insert: "X:1\nT:Long notes\nM:4/4\nL:1/8\nK:G\nG2 AB c4 | d2 B2 G4 | A2 B2 c2 d2 | g8 |]\n",
    },
  });
});
await page.waitForFunction(() =>
  document.getElementById("score-summary").textContent.startsWith("Long notes"),
);
await drawn();
await settle(300);
{
  const geo = await geometry();
  const notes = geo.notes.filter((note) => note.voice === 0).sort((a, b) => a.time - b.time);
  const durations = await page.evaluate(() =>
    window.composer.scoreIndex().byVoice[0].map((note) => [note.start, note.duration]),
  );
  const length = new Map(durations);
  // A bar whose last note is at least a dotted quarter, followed by a bar on the same system.
  let pick;
  for (let i = 0; i + 1 < notes.length && !pick; i++) {
    const last = notes[i];
    const first = notes[i + 1];
    if (last.line !== first.line || length.get(last.start) < 0.375) continue;
    const bar = barBetween(geo, last.line, last.head, first.head);
    if (!bar) continue;
    // The bar's first note: walk back while no bar line separates the notes.
    let k = i;
    while (
      k > 0 &&
      notes[k - 1].line === last.line &&
      !barBetween(geo, last.line, notes[k - 1].head, notes[k].head)
    )
      k -= 1;
    pick = { last, first, bar, line: last.line, start: notes[k] };
  }
  assert(pick, "found a bar ending in a long note");
  const y = staffMiddle(geo, pick.line, 0);
  await page.mouse.move(pick.start.head + 3, y);
  await page.mouse.down();
  const steps = [
    ["on the long note", pick.last.head + 3],
    ["in the gap after it", (pick.last.head + pick.bar.x) / 2],
    ["just before the bar line", pick.bar.x - 2],
    ["just past the bar line", Math.min(pick.bar.x + 3, pick.first.head - 1)],
    ["at the next bar's first note", pick.first.head + 2],
  ];
  for (const [label, x] of steps) {
    await page.mouse.move(x, y, { steps: 4 });
    await expectReached(geo, [0], pick.start.time, pick.line, x, `long note, ${label}`);
    const inNext = (await selectedStarts()).includes(pick.first.start);
    assert.equal(inNext, x >= pick.first.head, `long note, ${label}: next bar`);
  }
  await page.mouse.up();
  // A first press in the gap after the long note selects that note, not the next bar's.
  await page.mouse.click((pick.last.head + pick.bar.x) / 2, y);
  assert.deepEqual(
    await selectedStarts(),
    [pick.last.start],
    "a press in the gap selects the note before it",
  );
  // Shift click in the gap extends to the long note and no further.
  await page.mouse.click(pick.start.head + 3, y);
  await page.keyboard.down("Shift");
  await page.mouse.click(pick.bar.x - 2, y);
  await page.keyboard.up("Shift");
  const extended = await selectedStarts();
  assert(
    extended.includes(pick.last.start) && !extended.includes(pick.first.start),
    "Shift click in the gap stops at the bar line",
  );
}
console.log(
  "Composer: drags, a first press and Shift click in a long note's gap never take the next bar: passed",
);

/* 8c. File › Examples, by keyboard: each opens as a new draft; the open tune keeps its own. */
await page.locator(".cm-content").focus();
await page.keyboard.press("Control+End");
await page.keyboard.type("\n% kept in its own draft");
const kept = await docText();
await page.locator("#file-menu").focus();
await page.keyboard.press("ArrowDown");
let guard = 0;
while (
  !(await page.evaluate(() => document.activeElement?.dataset.item === "examples")) &&
  guard++ < 20
)
  await page.keyboard.press("ArrowDown");
assert.equal(
  await page.getByRole("menuitem", { name: "Examples" }).getAttribute("aria-expanded"),
  "false",
);
await page.keyboard.press("ArrowRight");
const labels = await page.locator(".workspace-submenu [role=menuitem]").allTextContents();
assert(
  labels.some((label) => label.includes("Frère Jacques — a round in two voices")),
  `labels: ${labels}`,
);
assert(labels.length >= 4, "every example is listed");
await page.keyboard.press("ArrowLeft");
assert.equal(
  await page.evaluate(() => document.activeElement?.dataset.item),
  "examples",
  "← returns to Examples",
);
await page.keyboard.press("ArrowRight");
while (
  !(await page.evaluate(() => document.activeElement?.textContent ?? "")).startsWith("Twinkle") &&
  guard++ < 40
)
  await page.keyboard.press("ArrowDown");
await page.keyboard.press("Enter");
await page.waitForFunction(() =>
  document.getElementById("score-summary").textContent.startsWith("Twinkle"),
);
await drawn();
await settle(300);
const stored = await page.evaluate(
  () =>
    new Promise((done) => {
      const request = indexedDB.open("voxdown-composer");
      request.onsuccess = () => {
        const all = request.result.transaction("drafts").objectStore("drafts").getAll();
        all.onsuccess = () => done(all.result.map((draft) => draft.text));
      };
    }),
);
assert(stored.includes(kept), "the tune that was open keeps its draft");
assert((await docText()).includes("T:Twinkle"), "the example opened");
console.log(
  "Composer: File › Examples opens by keyboard, labelled, as a new draft beside the kept one: passed",
);

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
  /^1 bar to check$/,
  await page.locator("#problems").textContent(),
);
assert(await page.locator(".abc-bar-issue").count(), "the long bar is marked in the text");
// 4. The list names the bar, opens above its button without blocking the editor, and F8 steps.
await page.locator("#problems").click();
const popover = page.locator(".problems-popover");
assert.match(await popover.textContent(), /Line \d+, bar 2 — has 7 eighths, 6 expected/);
assert.equal(await page.locator("dialog[open]").count(), 0, "not a modal dialog");
const above = await page.evaluate(() => {
  const list = document.querySelector(".problems-popover").getBoundingClientRect();
  const button = document.getElementById("problems").getBoundingClientRect();
  return list.bottom <= button.top + 1;
});
assert(above, "the list sits above its button");
await page.keyboard.press("Escape");
await page.locator(".cm-content").focus();
await setCaret(0);
await page.keyboard.press("F8");
const stepped = await page.evaluate(() => {
  const view = window.composer.view;
  return view.state.doc.sliceString(view.state.selection.main.from, view.state.selection.main.to);
});
assert.match(stepped, /c "G"d2 B G>AB/, "F8 selects the long bar");
assert.match(await page.locator("#explain").textContent(), /bar 2 — has 7 eighths/);
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

/* 10b. Round 2 fixes: decorations, ties, menus, loop mode, count-in, shortcuts, score keys. */
await openExample("Ode to Joy");
{
  // 1. Dynamics are written !f!, never as a bare letter that would be a note.
  const at = (await docText()).indexOf("E E F D");
  await setCaret(at);
  await page.locator('[data-command="decoration"]').click();
  const hint = await page.getByRole("menuitem", { name: /f — loud/ }).textContent();
  assert.match(hint, /!f!/, "the menu shows !f!");
  await page.getByRole("menuitem", { name: /f — loud/ }).click();
  const decorated = await docText();
  assert(
    decorated.includes('"A"!f!E E F D') || decorated.includes("!f!E E F D"),
    "!f! goes before the note",
  );
  assert(!/[^!]fE E F D/.test(decorated), "no bare f note");
  await page.locator("#undo").click();
  // 2. A tie between different pitches is refused with a reason.
  const before = await docText();
  await setCaret((await docText()).indexOf("F G A |"));
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Alt+t");
  assert.equal(await docText(), before, "no tie between F and G");
  assert.match(await page.locator("#notice").textContent(), /different pitch/);
}
console.log(
  "Composer: dynamics are written !f!; ties between different pitches are refused with a reason: passed",
);

// 3. Menu bar: a click on another title switches; on the open title closes; Escape closes.
await page.locator("#file-menu").click();
await page.locator("#edit-menu").hover();
await page.locator("#edit-menu").click();
assert(
  await page.locator("#edit-dropdown").isVisible(),
  "Edit stays open after a click on its title",
);
assert.equal(await page.locator("#file-dropdown").count(), 0, "File closed");
await page.locator("#edit-menu").click();
assert.equal(
  await page.locator("#edit-dropdown").count(),
  0,
  "a click on the open title closes it",
);
await page.locator("#view-menu").click();
await page.keyboard.press("Escape");
assert.equal(await page.locator("#view-dropdown").count(), 0, "Escape closes a mouse-opened menu");
assert.equal(
  await page.evaluate(() => document.activeElement?.id),
  "view-menu",
  "focus returns to its title",
);
// Undo is disabled in the Edit menu when there is nothing to undo.
await openExample("Twinkle, Twinkle, Little Star");
await page.locator("#edit-menu").click();
assert(
  await page.getByRole("menuitem", { name: "Undo" }).isDisabled(),
  "Undo disabled without history",
);
await page.keyboard.press("Escape");
console.log("Composer: menu bar switches, closes and returns focus like a menu bar: passed");

// 5 and 14. Loop is a mode; count-in shows its beats.
await setCaret(0);
await page.locator("#play").click();
await page.waitForFunction(() => window.composer.state().scheduled > 0);
await page.locator("#loop").click();
await page.waitForFunction(() => window.composer.state().region);
assert.equal(
  (await state()).status,
  "playing",
  "turning Loop on while playing keeps playing, now looping",
);
await page.locator("#loop").click();
await page.locator("#stop").click();
await page.locator("#count-in").click();
await page.locator("#play").click();
await page.waitForFunction(() =>
  document.getElementById("clock").textContent.startsWith("Count-in"),
);
assert.equal(await page.locator("#clock .count.lit").count(), 1, "one beat is lit");
assert(
  !(await page.locator("#clock").textContent()).includes("Bar"),
  "no bar or time while counting in",
);
await page.waitForFunction(
  () => document.getElementById("clock").textContent.startsWith("Bar"),
  null,
  { timeout: 8000 },
);
await page.locator("#stop").click();
await page.locator("#count-in").click();
console.log("Composer: Loop is a mode; count-in shows its beats, not a bar and time: passed");

{
  // 11. Every shortcut named in a title is a real one: listed in a menu, and working.
  const titles = await page.evaluate(() =>
    [...document.querySelectorAll("[aria-keyshortcuts]")]
      .filter((element) => !element.closest(".workspace-dropdown"))
      .map((element) => element.getAttribute("aria-keyshortcuts")),
  );
  const listed = new Set();
  for (const name of ["file", "edit", "insert", "view", "play", "help"]) {
    await page.locator(`[data-menu="${name}"]`).click();
    for (const value of await page
      .locator(".workspace-dropdown [aria-keyshortcuts]")
      .evaluateAll((items) => items.map((item) => item.getAttribute("aria-keyshortcuts"))))
      for (const one of value.split(/\+\/\+|\s\/\s/)) listed.add(one);
    await page.keyboard.press("Escape");
  }
  const normal = (value) =>
    value
      .replace(/Meta/g, "Control")
      .replace(/↑/g, "ArrowUp")
      .replace(/↓/g, "ArrowDown")
      .replace(/←/g, "ArrowLeft")
      .replace(/→/g, "ArrowRight")
      .replace(/−/g, "-");
  const known = new Set([...listed].map(normal));
  for (const title of titles)
    assert(known.has(normal(title)), `the shortcut ${title} in a title is in a menu`);
  // And they work.
  const layout = await page.evaluate(() => document.body.dataset.layout);
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+\\");
  assert.notEqual(
    await page.evaluate(() => document.body.dataset.layout),
    layout,
    "Ctrl \\ moves the score",
  );
  await page.keyboard.press("Control+\\");
  await page.keyboard.press("Control+Shift+F");
  assert(
    await page.evaluate(() => document.body.classList.contains("focus-mode")),
    "Ctrl Shift F focuses",
  );
  await page.keyboard.press("Control+Shift+F");
  await page.keyboard.press("Control+Alt+M");
  assert.equal(
    await page.locator("#metronome").getAttribute("aria-pressed"),
    "true",
    "Ctrl Alt M: metronome",
  );
  await page.keyboard.press("Control+Alt+M");
  await page.keyboard.press("F1");
  assert(await page.locator("#cheatsheet").isVisible(), "F1: cheat sheet");
  await page.keyboard.press("Escape");
}
console.log("Composer: shortcuts in titles are listed in the menus and work: passed");

{
  // 16. The tune is a short Tab path away, and the toolbar is one stop.
  await page.reload();
  await page.waitForFunction(() => (window.composer?.state().timeline?.notes ?? 0) > 0);
  // Arriving by keyboard: the draft comes back without taking focus.
  assert(
    !(await page.evaluate(() => document.activeElement?.classList.contains("cm-content"))),
    "nothing steals focus on arrival",
  );
  await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(() => document.activeElement?.textContent),
    "Skip to the tune",
    "skip link first",
  );
  await page.keyboard.press("Enter");
  assert(
    await page.evaluate(() => document.activeElement?.classList.contains("cm-content")),
    "the skip link lands in the tune",
  );
  // Counted again from a fresh arrival.
  await page.reload();
  await page.waitForFunction(() => (window.composer?.state().timeline?.notes ?? 0) > 0);
  let stops = 0;
  while (stops < 40) {
    await page.keyboard.press("Tab");
    stops += 1;
    if (await page.evaluate(() => document.activeElement?.classList.contains("cm-content"))) break;
  }
  assert(stops <= 12, `the editor is ${stops} Tab stops in`);
  const toolbarStops = await page.evaluate(
    () =>
      [...document.querySelectorAll(".documentbar .toolbar button")].filter(
        (button) => button.tabIndex === 0,
      ).length,
  );
  assert.equal(toolbarStops, 1, "the toolbar is one Tab stop");
  await page.locator('.documentbar .toolbar button[tabindex="0"]').focus();
  const first = await page.evaluate(
    () => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent,
  );
  await page.keyboard.press("ArrowRight");
  const second = await page.evaluate(
    () => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent,
  );
  assert.notEqual(first, second, "arrows move along the toolbar");
}
console.log("Composer: skip to the tune, a short Tab path, one stop for the toolbar: passed");

{
  // 17. The score's keyboard says where it is; ↑/↓ change voice; Home/End go along the line.
  await openExample("Frère Jacques");
  const geo = await page.evaluate(
    () =>
      window.composer.scoreIndex().byVoice[0].find((note) => Math.abs(note.time - 2) < 1e-6).start,
  );
  await setCaret(geo);
  await page.locator("#score-scroll").focus();
  await page.keyboard.press("ArrowRight");
  assert.match(await page.locator("#score-live").textContent(), /Bar 3, First\./);
  await page.keyboard.press("ArrowDown");
  const voice = await page.evaluate(() => {
    const index = window.composer.scoreIndex();
    const head = window.composer.view.state.selection.main.head;
    return index.notes.find((note) => note.start <= head && head < note.end)?.voice;
  });
  assert.equal(voice, 1, "↓ goes to the second voice");
  assert.match(await page.locator("#score-live").textContent(), /Second/);
  await page.keyboard.press("End");
  const last = await page.evaluate(() => {
    const index = window.composer.scoreIndex();
    const head = window.composer.view.state.selection.main.head;
    const note = index.notes.find((each) => each.start <= head && head < each.end);
    const line = index.byVoice[note.voice].filter((each) => each.line === note.line);
    return note === line[line.length - 1];
  });
  assert(last, "End goes to the last note of the line");
}
console.log(
  "Composer: score keys announce note, bar and voice; ↑/↓ change voice; End goes along the line: passed",
);

{
  // 12. On the start screen the toolbar and transport rest.
  const fresh = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  watch(fresh);
  const start = await fresh.newPage();
  await start.goto(url);
  await start.getByRole("heading", { name: /Write music/ }).waitFor();
  assert(await start.locator("#transport").evaluate((element) => element.inert), "transport inert");
  assert(await start.locator(".documentbar").evaluate((element) => element.inert), "toolbar inert");
  assert.match(await start.locator(".start p").first().textContent(), /Type your tune/);
  // 4. Offline: prepare, go offline, reload, open an example and play.
  await start.locator("#view-menu").click();
  await start.getByRole("menuitem", { name: "Work offline…" }).click();
  await start.getByRole("button", { name: "Prepare for offline use" }).click();
  await start.waitForFunction(
    () => /kept too/.test(document.getElementById("offline-status")?.textContent ?? ""),
    null,
    { timeout: 30000 },
  );
  await start.keyboard.press("Escape");
  await fresh.setOffline(true);
  await start.reload();
  await start.getByRole("heading", { name: /Write music/ }).waitFor();
  await start.getByRole("button", { name: "Greensleeves" }).click();
  await start.waitForFunction(() => (window.composer.state().timeline?.notes ?? 0) > 0);
  await start.locator("#play").click();
  await start.waitForFunction(() => window.composer.state().scheduled > 0, null, {
    timeout: 10000,
  });
  await start.locator("#stop").click();
  await fresh.setOffline(false);
  await fresh.close();
}
console.log(
  "Composer: start screen rests the tools; prepared offline, it reloads, opens an example and plays: passed",
);

/* 10b2. Round 4, item 1: what the editor shows is what it keeps, whatever is typed. */
const keptDraft = () =>
  page.evaluate(
    () =>
      new Promise((done) => {
        const id = sessionStorage.getItem("voxdown-composer-draft");
        const request = indexedDB.open("voxdown-composer");
        request.onsuccess = () => {
          const get = request.result.transaction("drafts").objectStore("drafts").get(id);
          get.onsuccess = () => done(get.result?.text ?? null);
        };
      }),
  );
const shown = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".cm-content .cm-line")]
      .map((line) => line.textContent)
      .join("\n"),
  );
const agrees = async (label) => {
  await settle(900);
  const doc = await docText();
  assert.equal(await shown(), doc, `${label}: the screen shows the document`);
  assert.equal(await keptDraft(), doc, `${label}: the draft keeps the document`);
};
const freshTune = async () => {
  await page.locator("#file-menu").click();
  await page.getByRole("menuitem", { name: "New tune file" }).click();
  await page.waitForFunction(() => window.composer.view.state.doc.toString().startsWith("X:1"));
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+End");
};
const errorsBefore = errors.length;
await freshTune();
await page.keyboard.type("CDEF GABc|");
await page.keyboard.press("Enter");
await page.keyboard.type("V");
await settle(3200);
await page.keyboard.type(":2");
await page.keyboard.press("Enter");
await page.keyboard.type("G,4 C4|");
await agrees("V: typed after a pause");
assert(
  (await docText()).endsWith("CDEF GABc|\nV:2\nG,4 C4|"),
  "every keystroke reached the document",
);
await freshTune();
await page.keyboard.type("CDEF (");
await settle(3200);
await page.keyboard.type("GAB)c|");
await agrees("an open slur left to the checks");
await freshTune();
await page.keyboard.insertText("[CEG");
await settle(3200);
await page.keyboard.type("]2 c2|");
await agrees("a pasted open chord");
// Fuzz: 300 random edits with random pauses; the document, the screen and the draft never part.
{
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const pick = (list) => list[Math.floor(random() * list.length)];
  const snippets = [
    "C",
    "D2",
    "e/",
    "^f",
    "_B,",
    "z2",
    "|",
    "|:",
    ":|",
    "[CEG]",
    "(",
    ")",
    '"Am"',
    "!p!",
    "-",
    "(3abc",
    "{g}",
    "\n",
    "V:2\n",
    "w: la la\n",
    "[K:G]",
    " ",
    "x",
    "y",
  ];
  await freshTune();
  for (let step = 1; step <= 300; step++) {
    const action = random();
    if (action < 0.55) await page.keyboard.type(pick(snippets));
    else if (action < 0.7) await page.keyboard.press("Backspace");
    else if (action < 0.82)
      await page.keyboard.insertText(pick(["[CEG", "CDEF GABc|", '"G"d2 B', "!trill!A", "(ABc"]));
    else if (action < 0.9) await page.keyboard.press("Control+z");
    else if (action < 0.95) await page.keyboard.press("Control+End");
    else await page.keyboard.press(pick(["ArrowLeft", "ArrowUp", "Home"]));
    if (random() < 0.06) await settle(400 + random() * 2800);
    if (step % 50 === 0) await agrees(`fuzz step ${step}`);
  }
  await agrees("fuzz end");
}
assert.deepEqual(errors.slice(errorsBefore), [], "no page errors while editing");
console.log(
  "Composer: the screen, the document and the draft agree after the three reported triggers and 300 random edits: passed",
);

/* 10c. Round 3: checks come back after typing; pickups; phrase-aware lines; notices; written bars;
   transport state; lyrics never touch. */
const setText = async (value, title, withNotes = true) => {
  await page.evaluate((text) => {
    const view = window.composer.view;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  }, value);
  await page.waitForFunction(
    (name) => document.getElementById("score-summary").textContent.startsWith(name),
    title,
  );
  if (withNotes) await drawn();
  await settle(300);
};
const barsPerSystem = () =>
  page.evaluate(() => {
    const index = window.composer.scoreIndex();
    const lines = new Map();
    for (const note of index.byVoice[0]) {
      if (!lines.has(note.line)) lines.set(note.line, new Set());
      lines.get(note.line).add(note.measure);
    }
    return [...lines.values()].map((set) => set.size);
  });
// 1. A long bar typed and left: noted within about three seconds, with no further edit.
await setText("X:1\nT:Typed\nM:4/4\nL:1/8\nK:C\n", "Typed", false);
await page.evaluate(() => {
  const view = window.composer.view;
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  view.focus();
});
await page.keyboard.type("CDEF GABc d2|");
assert(await page.locator("#problems").isHidden(), "not while the bar is being typed");
await page.waitForFunction(() => !document.getElementById("problems").hidden, null, {
  timeout: 3500,
});
assert.match(await page.locator("#problems").textContent(), /^1 bar to check$/);
// 2. An overfull first bar is bar 1, not a pickup.
await setText("X:1\nT:Overfull\nM:4/4\nL:1/8\nQ:1/4=120\nK:C\nd2e2f2^F2 GABc|c8|]\n", "Overfull");
assert.match(await page.locator("#clock").textContent(), /^Bar 1 · 0:00$/);
await page.waitForFunction(() => !document.getElementById("problems").hidden);
await page.locator("#problems").click();
assert.match(
  await page.locator(".problems-popover").textContent(),
  /bar 1 — has 12 eighths, 8 expected/,
);
await page.keyboard.press("Escape");
// 7. Lines follow phrases: a typed 4-bar tune is one line; Twinkle's lines are equal.
await setText(
  "X:1\nT:Four bars\nM:4/4\nL:1/8\nK:G\nG2 AB c2 BA | G2 B2 d4 | e2 dc B2 AG | A8 |]\n",
  "Four bars",
);
assert.deepEqual(await barsPerSystem(), [4], "four bars on one line");
await openExample("Twinkle, Twinkle, Little Star");
{
  const systems = await barsPerSystem();
  assert(
    systems.every((count) => count === systems[0]),
    `Twinkle's lines are equal: ${systems}`,
  );
  assert(systems[0] >= 4, `Twinkle has at least 4 bars a line at 1440: ${systems}`);
}
await openExample("Greensleeves");
{
  const systems = await barsPerSystem();
  assert.equal(systems[0], 5, `the pickup rides with the first 4 bars: ${systems}`);
  assert(
    systems.slice(1).every((count) => count === 4),
    `then 4 bars a line: ${systems}`,
  );
  assert(
    systems.every((count) => count > 1),
    "no stranded bar",
  );
  // 10. Written bars, with the pass: the summary and the clock agree.
  assert.match(await page.locator("#score-summary").textContent(), /16 bars and a pickup/);
  await page.evaluate(() => {
    const line = window.composer.player.timeline;
    const second = line.passes.find((pass) => pass.repeat);
    window.composer.player.seek(second.from + 1.2);
  });
  await page.waitForFunction(() => /2nd time/.test(document.getElementById("clock").textContent));
  assert.match(await page.locator("#clock").textContent(), /^Bar [1-8] · 2nd time · \d:\d\d$/);
  assert.match(
    await page.locator("#timeline").getAttribute("aria-valuetext"),
    /2nd time, of 16 bars/,
  );
  await page.locator("#stop").click();
}
console.log(
  "Composer: long bars come back after typing; overfull first bar is bar 1; lines follow phrases; written bars with passes: passed",
);

{
  // 9. Notices sit above the transport, fade, close with Escape and with the next edit.
  await setCaret((await docText()).indexOf("c2 d e"));
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Alt+t");
  await page.locator("#notice").waitFor();
  const placed = await page.evaluate(() => {
    const note = document.getElementById("notice").getBoundingClientRect();
    const transport = document.getElementById("transport").getBoundingClientRect();
    const title = [...document.querySelectorAll("#score svg text")]
      .find((text) => text.textContent === "Greensleeves")
      .getBoundingClientRect();
    const overlaps = (a, b) =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    return { above: note.bottom <= transport.top, clearOfTitle: !overlaps(note, title) };
  });
  assert(placed.above && placed.clearOfTitle, `notice placement ${JSON.stringify(placed)}`);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.getElementById("notice").hidden);
  await page.keyboard.press("Alt+t");
  await page.locator("#notice").waitFor();
  await page.keyboard.type(" ");
  await page.waitForFunction(() => document.getElementById("notice").hidden);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Alt+t");
  await page.locator("#notice").waitFor();
  await page.waitForFunction(() => document.getElementById("notice").hidden, null, {
    timeout: 7500,
  });
}
console.log(
  "Composer: notices sit above the transport, clear of the title; Escape, an edit or six seconds close them: passed",
);

await openExample("Ode to Joy");
{
  // 12. Voices shows a mute; the stopped marker is hollow, not the playing colour; count-in keeps widths.
  await page.locator("#voices-button").click();
  await page
    .getByRole("button", { name: /^Mute / })
    .first()
    .click();
  assert.equal(await page.locator("#voices-button").getAttribute("aria-label"), "Voices: 1 muted");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: /^Mute / })
    .first()
    .click()
    .catch(() => {});
  await page.locator("#voices-button").click();
  await page
    .getByRole("button", { name: /^Mute / })
    .first()
    .click();
  await page.keyboard.press("Escape");
  const head = await page.evaluate(() => {
    const element = document.getElementById("timeline-head");
    const style = getComputedStyle(element);
    const probe = document.createElement("div");
    probe.style.color = "var(--play)";
    document.body.append(probe);
    const play = getComputedStyle(probe).color;
    probe.remove();
    return { background: style.backgroundColor, play };
  });
  assert.notEqual(head.background, head.play, "a stopped marker is not the playing colour");
  const width = await page
    .locator("#timeline")
    .evaluate((element) => element.getBoundingClientRect().width);
  await page.locator("#count-in").click();
  await setCaret(0);
  await page.locator("#play").click();
  await page.waitForFunction(() =>
    document.getElementById("clock").textContent.startsWith("Count-in"),
  );
  const during = await page
    .locator("#timeline")
    .evaluate((element) => element.getBoundingClientRect().width);
  assert(
    Math.abs(during - width) < 1,
    `the timeline keeps its width while counting in (${width} → ${during})`,
  );
  await page.locator("#stop").click();
  await page.locator("#count-in").click();
}
console.log(
  "Composer: Voices shows a mute; the stopped marker is hollow; count-in keeps the timeline's width: passed",
);

/* 23. Lyric words never touch, at any width the score can have. */
const lyricTune =
  "X:1\nT:Ten seconds\nM:4/4\nL:1/4\nK:C\nC D E F | G2 A G | F E D E | C D E2 |]\nw: I just love to play this song, for it's just ten sec-onds long.\n";
const lyricGaps = (p) =>
  p.evaluate(() => {
    const gapNeeded = 0.4 * 13;
    const words = [];
    for (const text of document.querySelectorAll("#score text.abcjs-lyric")) {
      const content = text.textContent;
      const first = content.search(/[^\s\u00a0\u202f]/);
      const last =
        content.length -
        1 -
        [...content]
          .reverse()
          .join("")
          .search(/[^\s\u00a0\u202f]/);
      if (first < 0) continue;
      const start = text.getStartPositionOfChar(first);
      const end = text.getEndPositionOfChar(last);
      const matrix = text.getScreenCTM();
      words.push({
        y: Math.round(start.y * matrix.d + matrix.f),
        left: start.x * matrix.a + matrix.e,
        right: end.x * matrix.a + matrix.e,
        word: content.trim(),
      });
    }
    const lines = new Map();
    for (const word of words) {
      if (!lines.has(word.y)) lines.set(word.y, []);
      lines.get(word.y).push(word);
    }
    let smallest = Number.POSITIVE_INFINITY;
    let pair = "";
    for (const line of lines.values()) {
      line.sort((a, b) => a.left - b.left);
      for (let i = 1; i < line.length; i++) {
        const gap = line[i].left - line[i - 1].right;
        if (gap < smallest) {
          smallest = gap;
          pair = `${line[i - 1].word} | ${line[i].word}`;
        }
      }
    }
    return { smallest, pair, needed: gapNeeded, count: words.length };
  });
{
  await setText(lyricTune, "Ten seconds");
  const wide = await lyricGaps(page);
  assert(wide.count >= 14 && wide.smallest >= wide.needed, `1440 beside: ${JSON.stringify(wide)}`);
  // Every width the splitter allows, down to the narrowest score (where the words used to meet).
  await page.locator("#splitter").focus();
  for (let step = 1; step <= 12; step++) {
    await page.keyboard.press("ArrowRight");
    await settle(650);
    const narrow = await lyricGaps(page);
    assert(narrow.smallest >= narrow.needed, `splitter step ${step}: ${JSON.stringify(narrow)}`);
  }
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowLeft");
  for (const [width, height] of [
    [1024, 768],
    [390, 844],
  ]) {
    const sized = await browser.newContext({
      viewport: { width, height },
      isMobile: width < 500,
      hasTouch: width < 500,
    });
    watch(sized);
    const other = await sized.newPage();
    await other.goto(url);
    await other.getByRole("button", { name: "Start a new tune" }).click();
    await other.evaluate((text) => {
      const view = window.composer.view;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    }, lyricTune);
    if (width < 500) await other.locator("#show-score").click();
    await other.waitForFunction(() =>
      document.getElementById("score-summary").textContent.startsWith("Ten seconds"),
    );
    await other.waitForTimeout(900);
    const measured = await lyricGaps(other);
    assert(measured.smallest >= measured.needed, `${width}: ${JSON.stringify(measured)}`);
    // Every example opens clean at this width: no warnings from how it is drawn.
    for (const title of [
      "Ode to Joy",
      "Greensleeves",
      "Twinkle, Twinkle, Little Star",
      "Frère Jacques",
    ]) {
      await other.locator("#file-menu").click();
      await other.getByRole("menuitem", { name: "Examples" }).click();
      await other.getByRole("menuitem", { name: new RegExp(`^${title}`) }).click();
      await other.waitForFunction(
        (name) => document.getElementById("score-summary").textContent.startsWith(name),
        title,
      );
      await other.waitForTimeout(1200);
      assert(
        await other.locator("#problems").isHidden(),
        `${title} opens without problems at ${width}`,
      );
    }
    await sized.close();
  }
}
console.log(
  "Composer: lyric words keep a clear gap at 1440 (every splitter position), 1024 and 390; examples open clean: passed",
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
// 19. The phone toolbar fits its row: nothing to scroll sideways.
const toolbarFits = await small
  .locator(".documentbar .toolbar")
  .evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
assert(toolbarFits, "the phone toolbar fits without scrolling");
// 18. Touch targets, the More menu and the tunes panel.
await small.locator("#show-text").click();
const small40 = await small.evaluate(() =>
  [
    ...document.querySelectorAll(
      "header button, .toolbar button, #transport button, #transport input",
    ),
  ]
    .filter(
      (element) =>
        element.getClientRects().length && getComputedStyle(element).visibility !== "hidden",
    )
    .map((element) => ({
      id: element.id || element.getAttribute("aria-label") || element.textContent.trim(),
      box: element.getBoundingClientRect(),
    }))
    .filter(({ box }) => box.height < 40 || box.width < 40)
    .map(({ id, box }) => `${id} ${Math.round(box.width)}×${Math.round(box.height)}`),
);
assert.deepEqual(small40, [], "every touch target is at least 40 px");
await small.locator("#more-tools").click();
for (const name of ["Focus", "ABC cheat sheet", "Tie or untie", "Up an octave"])
  assert(await small.getByRole("menuitem", { name }).isVisible(), `More has ${name}`);
await small.keyboard.press("Escape");
await small.locator("#rail-toggle").click();
assert(await small.locator("#rail-close").isVisible(), "the tunes panel has a close button");
const row = await small.locator(".tune-item").first().boundingBox();
assert(row.height >= 40, "tune rows are at least 40 px tall");
await small.locator("#rail-close").click();
assert.equal(
  await small.locator("#workspace").getAttribute("data-rail"),
  "closed",
  "the close button closes it",
);
await phone.close();
console.log(
  "Composer: phone layout switches Text and Score; 40 px targets, More menu, closable tunes panel: passed",
);

assert.deepEqual(errors, [], "no console errors");
assert.deepEqual(external, [], "no request leaves the site");
console.log("Composer: no console errors and no requests leaving the site: passed");
await browser.close();
await new Promise((done) => server.close(done));
