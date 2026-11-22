// Browser checks for VoxDown Composer. Run after pnpm site:build.
import assert from "node:assert/strict";
import {
  createReadStream,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { deflateRawSync } from "node:zlib";
import { chromium } from "playwright";

const dist = resolve("site/dist");
const served = new Map();
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://local").pathname);
  let file = resolve(dist, `.${path}`);
  if (!file.startsWith(`${dist}/`)) return res.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) file = resolve(file, "index.html");
  if (!existsSync(file)) return res.writeHead(404).end();
  // Only what the browser asks for counts: other programs on the machine probing local ports
  // (user agent "node", no referer) sometimes fetch "/" too.
  if (/Chrome/.test(req.headers["user-agent"] ?? "")) served.set(path, statSync(file).size);
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
// --expose-gc: the import timing check starts its import from a clean heap.
const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required", "--js-flags=--expose-gc"],
});
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
    if (await p.locator('[data-menu="help"]').isVisible())
      await p.locator('[data-menu="help"]').click();
    else {
      await p.locator("#more-menus").click();
      await p.locator(".workspace-dropdown").getByRole("menuitem", { name: "Help" }).click();
    }
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
// Sprint B: the MusicXML converter loads on first use, never in the first view.
assert(
  ![...served.keys()].some((path) => /musicxml/i.test(path)),
  "the MusicXML converter is not in the first view",
);
// Sprint D: melody search, the MIDI keyboard and MIDI import load when first used.
assert(
  ![...served.keys()].some((path) => /melody|midi-input|midifile/i.test(path)),
  "melody search and MIDI are not in the first view",
);
assert(firstView < 720 * 1024, `the first view stays light (${(firstView / 1024).toFixed(0)} KB)`);
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
// Undo with nothing to undo after the reload says why, once (round 8, item 10).
await page.locator(".cm-content").focus();
await page.keyboard.press("Control+z");
await page.waitForFunction(() =>
  /Undo history starts again after a reload/.test(document.getElementById("notice").textContent),
);
assert.equal(await docText(), edited, "nothing undone");
await page.locator("#notice").getByRole("button", { name: "Dismiss" }).click();
console.log(
  "Composer: reload recovers this tab's draft; another tab keeps a separate draft; Undo says its history starts again: passed",
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
  ["B c d2 | B c d2", "!mp!G, A, B, G, | G, A, B, G,"],
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
  ["!mp!G A B G | G A B G"],
  "Shift Alt → adds the next note, stopping before the bar line",
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

// Tidy 2. Drags that start or end 2–10 px either side of a bar line, in one voice and in two
// (Frère Jacques: voice 2 rests a whole bar, drawn mid-bar).
await openExample("Frère Jacques");
await drawn();
await settle(300);
{
  const geo = await geometry();
  const line = Math.min(...geo.notes.map((note) => note.line));
  const onLine = (voice) =>
    geo.notes
      .filter((note) => note.voice === voice && note.line === line)
      .sort((a, b) => a.time - b.time);
  const top = onLine(0);
  const bars = [
    ...new Set(geo.bars.filter((bar) => bar.line === line).map((bar) => Math.round(bar.x))),
  ]
    .filter((x) => x > top[0].head)
    .sort((a, b) => a - b);
  const [bar1, bar2] = bars;
  const inBar = (voice, left, right) =>
    onLine(voice).filter((note) => note.head > left && note.head < right);
  const bar1Notes = [...inBar(0, 0, bar1), ...inBar(1, 0, bar1)].map((note) => note.start);
  const bar2Top = inBar(0, bar1, bar2);
  const y0 = staffMiddle(geo, line, 0);
  const y1 = staffMiddle(geo, line, 1);
  const drag = async (from, to) => {
    await page.mouse.move(from[0], from[1]);
    await page.mouse.down();
    await page.mouse.move(to[0], to[1], { steps: 6 });
    await page.mouse.up();
    return new Set(await selectedStarts());
  };
  const endOfBar2 = bar2Top.at(-1).head + 3;
  for (const offset of [2, 6, 10]) {
    for (const [label, from, to] of [
      ["forward, one voice", [bar1 + offset, y0], [endOfBar2, y0]],
      ["backward, one voice", [endOfBar2, y0], [bar1 + offset, y0]],
      ["forward, two voices", [bar1 + offset, y0], [endOfBar2, y1]],
      ["backward, two voices", [endOfBar2, y1], [bar1 + offset, y0]],
    ]) {
      const selected = await drag(from, to);
      assert(
        !bar1Notes.some((start) => selected.has(start)),
        `${label}, ${offset} px past bar line 1: nothing of bar 1`,
      );
      assert(selected.has(bar2Top[0].start), `${label}, ${offset} px: bar 2 from its start`);
    }
  }
  // Ending 2–10 px either side of bar line 2 keeps bar 2 and takes nothing of bar 3.
  const bar3 = [
    ...inBar(0, bar2, bars[2] ?? Number.POSITIVE_INFINITY),
    ...inBar(1, bar2, bars[2] ?? Number.POSITIVE_INFINITY),
  ];
  for (const offset of [-10, -2, 2, 10]) {
    const x = bar2 + offset;
    if (bar3.some((note) => note.head <= x)) continue;
    for (const [label, y] of [
      ["one voice", y0],
      ["two voices", y1],
    ]) {
      const selected = await drag([bar1 + 6, y0], [x, y]);
      assert(
        selected.has(bar2Top.at(-1).start),
        `${label}, ending ${offset} px from bar line 2: bar 2 whole`,
      );
      assert(
        !bar3.some((note) => selected.has(note.start)),
        `${label}, ending ${offset} px from bar line 2: nothing of bar 3`,
      );
    }
  }
}
console.log(
  "Composer: drags starting or ending 2–10 px either side of a bar line take whole bars, one voice and two: passed",
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
  for (const name of ["file", "edit", "tunes", "insert", "view", "play", "help"]) {
    await page.locator(`[data-menu="${name}"]`).click();
    // Edit's note commands are in its Notes submenu.
    if (name === "edit") await page.getByRole("menuitem", { name: "Notes" }).click();
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
  await page.locator("#cheatsheet[open]").waitFor();
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
  // 10. The transport is a slim empty state until there is music.
  const slim = await start.locator("#transport").evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    text: element.querySelector(".transport-empty").checkVisibility()
      ? element.querySelector(".transport-empty").textContent
      : "",
    play: document.getElementById("play").checkVisibility(),
  }));
  assert(slim.height <= 40, `slim transport on the start screen (${slim.height}px)`);
  assert.match(slim.text, /Playback starts when there’s music/);
  assert(!slim.play, "no disabled controls across the start screen");
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
    /2nd time, played bar \d+ of \d+, \d:\d\d$/,
  );
  // 5. The timeline starts at the pickup, marks the 2nd time, bands only what is played again,
  // and its value, maximum and text agree.
  const timelineState = await page.evaluate(() => {
    const shown = [
      ...document.querySelectorAll("#timeline-ticks .timeline-tick span:not([hidden])"),
    ];
    const labels = shown.map((label) => label.textContent);
    const boxes = [
      ...document.querySelectorAll(
        "#timeline-ticks .timeline-tick span:not([hidden]), #timeline-ticks .timeline-pass-tag:not([hidden])",
      ),
    ].map((label) => label.getBoundingClientRect());
    const touching = boxes.some((a, i) =>
      boxes.some(
        (b, j) =>
          i < j && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom,
      ),
    );
    const tags = [...document.querySelectorAll(".timeline-pass-tag:not([hidden])")].map(
      (tag) => tag.textContent,
    );
    const rulerWidth = document.getElementById("timeline").getBoundingClientRect().width;
    const bands = [...document.querySelectorAll("#timeline-passes .timeline-pass.repeat")].map(
      (band) => (band.getBoundingClientRect().width / rulerWidth) * 100,
    );
    const slider = document.getElementById("timeline");
    return {
      labels,
      touching,
      tags,
      bands,
      ticks: document.querySelectorAll("#timeline-ticks .timeline-tick").length,
      max: Number(slider.getAttribute("aria-valuemax")),
      now: Number(slider.getAttribute("aria-valuenow")),
    };
  });
  assert.equal(timelineState.labels[0], "Pickup", `first label: ${timelineState.labels}`);
  // 8. Labels never touch, the last bar is always named, the repeat band says "2nd".
  assert(!timelineState.touching, `no two labels touch: ${timelineState.labels}`);
  assert.equal(
    timelineState.labels.at(-1),
    "16",
    `the final bar is named: ${timelineState.labels}`,
  );
  assert.deepEqual(timelineState.tags, ["2nd"], "the band carries a 2nd tag");
  assert(
    timelineState.labels.filter((label) => label === "4").length <= 1,
    "a repeat never names a bar twice",
  );
  // Hovering the ruler names the bar there, with its time through and its time.
  const ruler = await page.locator("#timeline").boundingBox();
  await page.mouse.move(ruler.x + ruler.width * 0.45, ruler.y + ruler.height / 2);
  await page.locator("#timeline-tip").waitFor();
  assert.match(await page.locator("#timeline-tip").textContent(), /^Bar \d+ · 2nd time · \d:\d\d$/);
  await page.mouse.move(ruler.x + ruler.width * 0.45, ruler.y - 200);
  await page.waitForFunction(() => document.getElementById("timeline-tip").hidden);
  assert.equal(timelineState.bands.length, 1, "one band for the repeated part");
  assert(
    timelineState.bands[0] < 45,
    `the band covers part A's repeat only (${timelineState.bands[0]}%)`,
  );
  assert.equal(timelineState.max, timelineState.ticks, "the maximum counts played bars");
  assert(
    timelineState.now >= 1 && timelineState.now <= timelineState.max,
    "the value is within it",
  );
  await page.locator("#stop").click();
}
console.log(
  "Composer: long bars come back after typing; overfull first bar is bar 1; lines follow phrases; written bars with passes: passed",
);

{
  // 6. The browser's own Print: beforeprint fills the print score in the screen's fonts,
  // afterprint clears it.
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  const printed = await page.evaluate(() => {
    const root = document.getElementById("print-score");
    const texts = [...root.querySelectorAll("svg text")];
    const title = texts.find((text) => text.textContent === "Greensleeves");
    const lyric = root.querySelector("svg .abcjs-lyric");
    return {
      tunes: root.querySelectorAll(".print-tune svg").length,
      notes: root.querySelectorAll(".abcjs-note").length,
      titleFont: title
        ? getComputedStyle(title).fontFamily || title.getAttribute("font-family")
        : "",
      lyricWeight: lyric ? getComputedStyle(lyric).fontWeight : "400",
    };
  });
  assert.equal(printed.tunes, 1, "one tune in the print score");
  assert(printed.notes > 20, `the print score has the notes (${printed.notes})`);
  assert.match(printed.titleFont, /Literata/, `print title font: ${printed.titleFont}`);
  assert(Number(printed.lyricWeight) < 600, `print lyrics weight ${printed.lyricWeight}`);
  await page.emulateMedia({ media: "print" });
  assert(
    await page.locator("#print-score svg").first().isVisible(),
    "the print score shows in print",
  );
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  assert.equal(await page.locator("#print-score > *").count(), 0, "afterprint clears it");
}
console.log(
  "Composer: the browser's Print fills the score in the screen's fonts and clears after: passed",
);

{
  // 7. Focus: a quiet way out at the top right, Escape leaves; without the score, a centred column.
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+Shift+F");
  await page.waitForFunction(() => document.body.classList.contains("focus-mode"));
  const controls = page.locator("#focus-controls");
  assert(await controls.isVisible(), "the Exit focus control shows");
  const box = await controls.boundingBox();
  assert(box.y < 60 && box.x + box.width > 1440 - 40, `top right: ${JSON.stringify(box)}`);
  assert(await page.locator("#score svg").first().isVisible(), "with the score, Focus keeps it");
  assert(!(await page.locator(".documentbar").isVisible()), "and hides the chrome");
  await page.mouse.move(700, 400);
  await page.mouse.move(720, 420);
  await page.waitForFunction(() =>
    document.getElementById("focus-controls").classList.contains("awake"),
  );
  await page.waitForFunction(
    () => getComputedStyle(document.getElementById("focus-controls")).opacity === "1",
  );
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.body.classList.contains("focus-mode"));
  assert(!(await controls.isVisible()), "the control goes with Focus");
  // Without the score.
  await page.keyboard.press("Control+Shift+F");
  await page.locator("#focus-score").click();
  await page.waitForFunction(() => document.body.classList.contains("focus-text"));
  const column = await page.evaluate(() => {
    const line = [...document.querySelectorAll(".cm-line")].reduce((a, b) =>
      b.getBoundingClientRect().width > a.getBoundingClientRect().width ? b : a,
    );
    const rect = line.getBoundingClientRect();
    const score = document.getElementById("score-panel").getBoundingClientRect();
    const ch = Number.parseFloat(getComputedStyle(line).fontSize) * 0.6;
    return { left: rect.left, right: rect.right, width: rect.width, ch, score: score.width };
  });
  assert.equal(column.score, 0, "the score is hidden");
  assert(column.width < 90 * column.ch, `a comfortable measure (${column.width}px)`);
  assert(
    Math.abs((column.left + column.right) / 2 - 720) < 60,
    `centred: ${column.left}–${column.right}`,
  );
  await page.locator("#focus-exit").click();
  await page.waitForFunction(() => !document.body.classList.contains("focus-mode"));
  assert(!(await page.evaluate(() => document.body.classList.contains("focus-text"))));
  // Leave the preference as it was.
  await page.keyboard.press("Control+Shift+F");
  await page.locator("#focus-score").click();
  await page.locator("#focus-exit").click();
}
console.log(
  "Composer: Focus hides the chrome, shows a quiet way out, leaves with Escape; text alone sits centred: passed",
);

{
  // 2. The selection status counts from the text, at once, even before the score redraws.
  const doc = await docText();
  const at = doc.indexOf("e>fe");
  await page.evaluate(
    ([from, to]) => window.composer.view.dispatch({ selection: { anchor: from, head: to } }),
    [at, at + 4],
  );
  await page.waitForFunction(() =>
    /^3 notes selected/.test(document.getElementById("explain").textContent),
  );
  assert.match(
    await page.locator("#explain").textContent(),
    /^3 notes selected · Ctrl\+Alt\+Enter plays it$/,
  );
  // Typed into the selection's bar and selected again before any redraw.
  await page.evaluate((from) => {
    const view = window.composer.view;
    view.dispatch({ changes: { from, insert: "ab" }, selection: { anchor: from, head: from + 6 } });
  }, at);
  await page.waitForFunction(
    () => /^5 notes selected/.test(document.getElementById("explain").textContent),
    null,
    { timeout: 300 },
  );
  await page.evaluate(
    (from) => window.composer.view.dispatch({ changes: { from, to: from + 2 } }),
    at,
  );
  await drawn();
  // 3. A selected region colours its beam only when all the beam's notes are in it.
  await page.waitForTimeout(400);
  const beamState = async () =>
    page.evaluate(() => {
      const beams = [...document.querySelectorAll("#score .abcjs-beam-elem")];
      return beams.filter((beam) => beam.classList.contains("is-selected")).length;
    });
  await page.evaluate(
    ([from, to]) => window.composer.view.dispatch({ selection: { anchor: from, head: to } }),
    [at, at + 4],
  );
  await page.waitForFunction(() => document.querySelector("#score .abcjs-beam-elem.is-selected"));
  assert.equal(await beamState(), 1, "the beam of e>fe takes the selection colour");
  await page.evaluate(
    ([from, to]) => window.composer.view.dispatch({ selection: { anchor: from, head: to } }),
    [at, at + 2],
  );
  await page.waitForTimeout(300);
  assert.equal(await beamState(), 0, "a beam half selected keeps the ink colour");
  // 4. "^2nd time p" is drawn as a dynamic, and the second time through is softer from there.
  const lineStart = doc.indexOf('"Am"c2 d e>fe | "G"d2 B G>AB | "Am"c>BA');
  await page.evaluate(
    (from) => window.composer.view.dispatch({ changes: { from, insert: '"^2nd time p"' } }),
    lineStart,
  );
  await page.waitForFunction(() => document.querySelector("#score .abc-dyn"));
  const glyph = await page.evaluate(() => {
    const element = document.querySelector("#score .abc-dyn");
    const style = getComputedStyle(element);
    return { text: element.textContent, italic: style.fontStyle, weight: Number(style.fontWeight) };
  });
  assert.equal(glyph.text, "p");
  assert.equal(glyph.italic, "italic");
  assert(glyph.weight >= 600, `bold dynamic letter (${glyph.weight})`);
  await page.waitForFunction((start) => {
    const notes = window.composer.player.timeline?.notes ?? [];
    return notes.filter((note) => note.start === start).length === 2;
  }, lineStart);
  const passes = await page.evaluate((start) => {
    const notes = window.composer.player.timeline.notes;
    const marked = notes.filter((note) => note.start === start).map((note) => note.velocity);
    const after = notes
      .filter((note) => note.start > start && note.start < start + 30)
      .map((note) => note.velocity);
    return { marked, after };
  }, lineStart);
  assert(passes.marked[1] < passes.marked[0] * 0.8, `second time softer: ${passes.marked}`);
  await page.evaluate(
    (from) => window.composer.view.dispatch({ changes: { from, to: from + 13 } }),
    lineStart,
  );
  await drawn();
}
console.log(
  'Composer: selection counts from the text at once; beams take the selection colour when whole; "^2nd time p" drawn and played softer the 2nd time: passed',
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
{
  // 9. Two-voice scores (with a subtitle) start as close below the composer line as Ode does.
  const gapBelowComposer = () =>
    page.evaluate(() => {
      const svg = document.querySelector("#score svg");
      const composer = svg.querySelector(".abcjs-composer").getBoundingClientRect();
      // The first system begins with its tempo mark, above any chord symbols.
      const system = svg.querySelector(".abcjs-tempo").getBoundingClientRect();
      return Math.round(system.top - composer.bottom);
    });
  await openExample("Ode to Joy");
  await drawn();
  const ode = await gapBelowComposer();
  await openExample("Frère Jacques");
  await drawn();
  const frere = await gapBelowComposer();
  assert(Math.abs(frere - ode) <= 8, `composer to first system: Ode ${ode}px, Frère ${frere}px`);
}
console.log(
  "Composer: two-voice scores start as close below the title block as one-voice ones: passed",
);

// 1 and 2. Every cell of the cheat sheet and the shortcut list shows whole, at three widths and
// on both platforms; punctuation keys read as keys ("Alt+,", "⌥,"), never as separators.
for (const mac of [false, true]) {
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [390, 844],
  ]) {
    const sized = await browser.newContext({ viewport: { width, height } });
    watch(sized);
    if (mac)
      await sized.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel" });
      });
    const help = await sized.newPage();
    await help.goto(url);
    await help.getByRole("button", { name: "Ode to Joy" }).click();
    await help.waitForFunction(() => (window.composer.state().timeline?.notes ?? 0) > 0);
    const clipped = async () =>
      help.evaluate(() =>
        [...document.querySelectorAll("dialog[open] td")]
          .filter((cell) => cell.scrollWidth > cell.clientWidth + 1)
          .map((cell) => `${cell.textContent} (${cell.scrollWidth} > ${cell.clientWidth})`),
      );
    for (const name of ["cheatsheet", "shortcuts"]) {
      if (name === "cheatsheet") await help.keyboard.press("F1");
      else {
        // A phone keeps Help under ⋯.
        if (await help.locator('[data-menu="help"]').isVisible())
          await help.locator('[data-menu="help"]').click();
        else {
          await help.locator("#more-menus").click();
          await help.locator(".workspace-dropdown").getByRole("menuitem", { name: "Help" }).click();
        }
        await help.getByRole("menuitem", { name: "Keyboard shortcuts" }).click();
      }
      await help.locator(`#${name}[open] td`).first().waitFor();
      const bad = await clipped();
      assert.deepEqual(bad, [], `${name} at ${width}${mac ? " (Mac)" : ""}: clipped ${bad}`);
      const keys = await help.locator(`#${name}[open] kbd`).allTextContents();
      if (name === "shortcuts") {
        assert(keys.includes(mac ? "⌥," : "Alt+,"), `remove a dot reads ${mac ? "⌥," : "Alt+,"}`);
        assert(keys.includes(mac ? "⌥." : "Alt+."), "add a dot reads as a key");
        assert(keys.includes(mac ? "⌘\\" : "Ctrl+\\"), "score beside or below");
        assert(!keys.some((key) => /^(Alt|⌥)$/.test(key)), `no lone modifier: ${keys}`);
      }
      await help.keyboard.press("Escape");
    }
    if (width === 1440) {
      await help.locator('[data-menu="edit"]').click();
      await help.getByRole("menuitem", { name: "Notes" }).click();
      const item = help.getByRole("menuitem", { name: /Remove a dot/ });
      assert.equal(
        (await item.locator(".menu-shortcut").textContent()).trim(),
        mac ? "⌥," : "Alt+,",
      );
      assert.equal(await item.getAttribute("aria-keyshortcuts"), "Alt+,");
      await help.keyboard.press("Escape");
      assert.match(
        await help.locator('[data-command="undot"]').getAttribute("title"),
        mac ? /\(⌥,\)$/ : /\(Alt\+,\)$/,
      );
    }
    await sized.close();
  }
}
console.log(
  "Composer: cheat sheet and shortcuts never clip at 1440, 1024 and 390, Mac and Ctrl; punctuation keys read as keys: passed",
);

{
  // 3. The Tab hint stays on screen after the first Tab, and is said once.
  const fresh = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  watch(fresh);
  const tab = await fresh.newPage();
  await tab.goto(url);
  await tab.getByRole("button", { name: "Start a new tune" }).click();
  await tab.locator(".cm-content").focus();
  await tab.keyboard.press("Tab");
  await tab.locator("#notice", { hasText: "Tab indents" }).waitFor();
  await tab.keyboard.type("C");
  await tab.waitForTimeout(4000);
  assert(
    await tab.locator("#notice", { hasText: "Tab indents" }).isVisible(),
    "the Tab hint is still there after 4 s, through typing",
  );
  assert.equal(await tab.evaluate(() => localStorage.getItem("vxd-composer-tab-hint")), "1");

  // 4. A blank line in the body: a problem with a gutter mark, one click puts it right.
  await tab.evaluate(() => {
    const view = window.composer.view;
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: "X:1\nT:Air\nM:4/4\nL:1/4\nK:C\n\nCDEF|GABc|\n",
      },
      selection: { anchor: 0 },
    });
  });
  await tab.locator("#problems").waitFor();
  assert.match(await tab.locator("#problems").textContent(), /1 problem/);
  // The problems can show before the new tune is drawn: its summary, once it is.
  await tab.waitForFunction(() =>
    /^Air/.test(document.getElementById("score-summary").textContent),
  );
  assert.match(
    await tab.locator("#score-summary").textContent(),
    /0 bars · music below a blank line left out/,
  );
  await tab.evaluate(() => {
    const view = window.composer.view;
    view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf("CDEF") + 1 } });
  });
  await tab.waitForFunction(() =>
    /A blank line ends the tune: the music below isn't part of X:1 “Air”\./.test(
      document.getElementById("explain").textContent,
    ),
  );
  const mark = tab.locator('.abc-gutter-mark.warning[title*="blank line"]');
  await mark.click();
  const fix = tab.getByRole("button", { name: "Remove the empty line" });
  await fix.waitFor();
  assert.match(await tab.locator(".problems-popover").textContent(), /isn't part of X:1 “Air”/);
  await fix.click();
  await tab.waitForFunction(() =>
    / · 2 bars$/.test(document.getElementById("score-summary").textContent),
  );
  assert.equal(
    await tab.evaluate(() => window.composer.view.state.doc.toString()),
    "X:1\nT:Air\nM:4/4\nL:1/4\nK:C\nCDEF|GABc|\n",
  );
  await tab.waitForFunction(() => document.getElementById("problems").hidden);

  // 5. Problems in plain words.
  await tab.evaluate(() => {
    const view = window.composer.view;
    const at = view.state.doc.toString().indexOf("GABc");
    view.dispatch({ changes: { from: at, insert: "!fermat " } });
  });
  await tab.waitForFunction(() => /problem/.test(document.getElementById("problems").textContent));
  await tab.locator("#problems").click();
  assert.match(
    await tab.locator(".problems-popover").textContent(),
    /!fermat… is missing its closing\s!\./,
  );
  await tab.keyboard.press("Escape");

  // 6. A selection with no notes counts characters and offers no playing.
  await tab.evaluate(() => {
    const view = window.composer.view;
    const from = view.state.doc.toString().indexOf("T:Air");
    view.dispatch({ selection: { anchor: from, head: from + 5 } });
  });
  await tab.waitForFunction(
    () => document.getElementById("explain").textContent === "5 characters selected",
  );
  await fresh.close();

  // 7. An example opens with the caret at its first line of music, not on %%MIDI.
  await openExample("Ode to Joy");
  const caretLine = await page.evaluate(() => {
    const view = window.composer.view;
    return view.state.doc.lineAt(view.state.selection.main.head).text;
  });
  assert(!/^%%|^[A-Za-z]:/.test(caretLine), `the caret starts on music: ${caretLine}`);

  // 12. Desktop transport buttons are at least 36 px.
  const small36 = await page.evaluate(() =>
    [...document.querySelectorAll("#transport button")]
      .filter((button) => button.getClientRects().length && !button.closest(".tempo"))
      .map((button) => ({ id: button.id, box: button.getBoundingClientRect() }))
      .filter(({ box }) => box.width < 36 || box.height < 36)
      .map(({ id, box }) => `${id} ${box.width}×${box.height}`),
  );
  assert.deepEqual(small36, [], "desktop transport buttons are 36 px");
}
console.log(
  "Composer: Tab hint stays; a blank line's music is a problem with a one-click fix; plain-word problems; characters selected; caret on music; 36 px transport: passed",
);

{
  // Tidy 1. Paused, nothing glows: a hollow place marker shows where the music will go on, and
  // follows every seek; Stop clears it.
  await openExample("Greensleeves");
  await page.locator("#play").click();
  await page.waitForFunction(() => document.querySelectorAll("#score .is-playing").length > 0);
  await page.waitForTimeout(1500);
  await page.locator("#play").click();
  await page.waitForFunction(() => window.composer.player.status === "paused");
  const state = () =>
    page.evaluate(() => {
      const marker = document.getElementById("score-place");
      return {
        glow: document.querySelectorAll("#score .is-playing, .cm-content .abc-playing").length,
        marker: !marker.hidden,
        left: marker.style.left,
      };
    });
  let now = await state();
  assert.equal(now.glow, 0, "paused: no glow");
  assert(now.marker, "paused: the hollow place marker shows");
  let previous = now.left;
  await page.locator("#timeline").focus();
  for (const keys of [["End"], ["Home", "ArrowRight", "ArrowRight", "ArrowRight"]]) {
    for (const key of keys) await page.keyboard.press(key);
    now = await state();
    assert.equal(now.glow, 0, `after ${keys.join(" ")}: no glow`);
    assert(now.marker && now.left !== previous, `after ${keys.join(" ")}: the marker moved`);
    previous = now.left;
  }
  const ruler = await page.locator("#timeline").boundingBox();
  await page.mouse.click(ruler.x + ruler.width * 0.6, ruler.y + ruler.height / 2);
  now = await state();
  assert.equal(now.glow, 0, "after a click at 60%: no glow");
  assert(now.marker && now.left !== previous, "after a click at 60%: the marker moved");
  await page.locator("#stop").click();
  now = await state();
  assert.equal(now.glow, 0, "stopped: no glow");
  assert(!now.marker, "stopped: no marker");
}
console.log(
  "Composer: paused or stopped, nothing glows; the hollow marker follows seeks and Stop clears it: passed",
);

// Tidy 3 and 4. A new tune is named from its first T: until renamed; the bar check's grace
// covers only the bar being typed, not the empty line below it.
await page.locator('[data-menu="file"]').click();
await page.getByRole("menuitem", { name: "New tune file" }).click();
await page.waitForFunction(() => document.getElementById("name").value === "Untitled.abc");
await page.evaluate(() => {
  const view = window.composer.view;
  const at = view.state.doc.toString().indexOf("Untitled tune");
  view.dispatch({
    changes: { from: at, to: at + "Untitled tune".length, insert: "Evening Song" },
  });
});
await page.waitForFunction(() => document.getElementById("name").value === "Evening Song.abc");
await page.locator("#name").fill("My copy");
await page.locator("#name").press("Enter");
await page.evaluate(() => {
  const view = window.composer.view;
  const at = view.state.doc.toString().indexOf("Evening Song");
  view.dispatch({ changes: { from: at, to: at + "Evening Song".length, insert: "Night Song" } });
});
await page.waitForTimeout(200);
assert.equal(await page.locator("#name").inputValue(), "My copy.abc", "renamed: the name stays");
// An overfull last bar, then Enter: flagged while the caret sits on the empty line below.
await page.locator(".cm-content").focus();
await page.evaluate(() => {
  const view = window.composer.view;
  view.dispatch({ selection: { anchor: view.state.doc.length } });
});
await page.keyboard.type("C D E F G A B c d");
await page.waitForTimeout(1000);
assert(await page.locator("#problems").isHidden(), "the bar being typed is not flagged yet");
await page.keyboard.press("Enter");
await page.locator("#problems").waitFor({ timeout: 1500 });
assert.match(await page.locator("#problems").textContent(), /1 bar to check/);
console.log(
  "Composer: a new tune is named from its title until renamed; the bar check's grace is the bar being typed: passed",
);

{
  // Tidy 9. Typing . over selected music puts staccato on every note, again removes it; over
  // lyrics it is typed as usual.
  await openExample("Twinkle, Twinkle, Little Star");
  const doc = await docText();
  const bars = '"C"C C | G G |';
  const from = doc.indexOf(bars);
  await page.locator(".cm-content").focus();
  await page.evaluate(
    ([a, b]) => window.composer.view.dispatch({ selection: { anchor: a, head: b } }),
    [from, from + bars.length - 2],
  );
  const dots = () =>
    page.evaluate(() => {
      const text = window.composer.view.state.doc.toString();
      return (text.slice(0, text.indexOf("\nw:")).match(/\./g) ?? []).length;
    });
  const drawnDecorations = () =>
    page.evaluate(() => document.querySelectorAll('#score [data-name="scripts.staccato"]').length);
  const before = await drawnDecorations();
  await page.keyboard.type(".");
  assert.equal(await dots(), 4, "four staccato marks written");
  assert(
    (await docText()).includes('"C".C .C | .G .G |'),
    "placed before each note, after the chord symbol",
  );
  assert.match(
    await page.locator("#explain").textContent(),
    /^Staccato on 4 notes · type \. again to remove$/,
  );
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll('#score [data-name="scripts.staccato"]').length >= count + 4,
    before,
  );
  // One undo step takes them all back; type again to remove them too.
  await page.keyboard.press("Control+z");
  assert.equal(await dots(), 0, "one undo step");
  await page.keyboard.press("Control+Shift+z");
  assert.equal(await dots(), 4);
  await page.keyboard.type(".");
  assert.equal(await dots(), 0, "typing . again removes them");
  await page.waitForFunction(
    (count) => document.querySelectorAll('#score [data-name="scripts.staccato"]').length === count,
    before,
  );
  // Over lyrics, . is typed.
  const lyric = (await docText()).indexOf("Twin-kle");
  await page.evaluate(
    (a) => window.composer.view.dispatch({ selection: { anchor: a, head: a + 4 } }),
    lyric,
  );
  await page.keyboard.type(".");
  assert((await docText()).includes("w: .-kle"), "a lyric selection is replaced");
}
console.log(
  "Composer: typing . over selected music marks staccato and again removes it; over lyrics it types: passed",
);
// Tidy 8. F10 goes to the menu bar; Edit has Cut, Copy, Paste and Select all.
await page.locator(".cm-content").focus();
await page.keyboard.press("F10");
assert.equal(await page.evaluate(() => document.activeElement.id), "file-menu");
await page.locator('[data-menu="edit"]').click();
for (const [name, keys] of [
  ["Cut", "Ctrl+X"],
  ["Copy", "Ctrl+C"],
  ["Paste", "Ctrl+V"],
  ["Select all", "Ctrl+A"],
])
  assert.equal(
    (
      await page
        .getByRole("menuitem", { name: new RegExp(`^${name}`) })
        .locator(".menu-shortcut")
        .textContent()
    ).trim(),
    keys,
  );
await page.getByRole("menuitem", { name: /^Select all/ }).click();
assert.equal(
  await page.evaluate(() => {
    const view = window.composer.view;
    return view.state.selection.main.to - view.state.selection.main.from;
  }),
  (await docText()).length,
  "Select all selects the text",
);
console.log("Composer: F10 goes to the menus; Edit has Cut, Copy, Paste, Select all: passed");

{
  // Sprint A 1. > and < over selected music: pairs dotted-short or short-dotted, again removes.
  await openExample("Twinkle, Twinkle, Little Star");
  const original = await docText();
  const bars = '"C"C C | G G |';
  const from = original.indexOf(bars);
  await page.locator(".cm-content").focus();
  await page.evaluate(
    ([a, b]) => window.composer.view.dispatch({ selection: { anchor: a, head: b } }),
    [from, from + bars.length - 2],
  );
  await page.keyboard.type(">");
  assert((await docText()).includes('"C"C>C | G>G |'), "each pair in each bar, not across it");
  assert.match(
    await page.locator("#explain").textContent(),
    /^Dotted-then-short on 2 pairs · type > again to remove$/,
  );
  await page.keyboard.type("<");
  assert((await docText()).includes('"C"C<C | G<G |'), "< turns them round");
  await page.keyboard.type("<");
  assert.equal(await docText(), original.replace('"C"C C | G G |', '"C"C C | G G |'));
  await page.keyboard.press("Control+z");
  assert((await docText()).includes('"C"C<C | G<G |'), "one undo step");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  assert.equal(await docText(), original, "back to the start");
}
console.log(
  "Composer: > and < make pairs dotted-short and short-dotted, bar by bar; again removes: passed",
);

{
  // Sprint A 2. A selection in several places: Ctrl click three notes in different bars, type .
  const original = await docText();
  const geo = await geometry();
  const line = Math.min(...geo.notes.map((note) => note.line));
  const notes = geo.notes
    .filter((note) => note.line === line && note.voice === 0)
    .sort((a, b) => a.time - b.time);
  const picks = [notes[0], notes[3], notes[6]];
  await page.evaluate(() => window.composer.view.dispatch({ selection: { anchor: 0 } }));
  const ctrlClick = async (x, y) => {
    await page.keyboard.down("Control");
    await page.mouse.click(x, y);
    await page.keyboard.up("Control");
  };
  for (const note of picks) await ctrlClick(note.head + 3, note.y);
  const chosen = await selectedStarts();
  assert.deepEqual(
    chosen,
    picks.map((note) => note.start),
    `three notes selected: ${chosen}`,
  );
  await page.waitForFunction(() =>
    /^3 notes selected in 3 places · /.test(document.getElementById("explain").textContent),
  );
  assert.equal(
    await page.locator("#score-bands .score-band.selection").count(),
    3,
    "one band per place",
  );
  await page.keyboard.type(".");
  const marked = await docText();
  assert.equal(marked.length, original.length + 3, "three marks and nothing else");
  assert.equal(marked.replaceAll(".", ""), original.replaceAll(".", ""), "nothing else changed");
  await page.waitForFunction(
    () => document.querySelectorAll('#score [data-name="scripts.staccato"]').length === 3,
  );
  assert.deepEqual(
    (await selectedStarts()).length,
    3,
    "the selection stays on the same three notes",
  );
  // Ctrl click again takes one out.
  const again = (await geometry()).notes.find(
    (note) => note.voice === 0 && Math.abs(note.time - picks[1].time) < 1e-6,
  );
  await ctrlClick(again.head + 3, again.y);
  assert.equal((await selectedStarts()).length, 2, "Ctrl click again removes it");
  // The keyboard: Ctrl arrows move the cursor, Ctrl Space toggles; the selection is untouched.
  await page.locator("#score-scroll").focus();
  const before = await selection();
  await page.keyboard.press("Control+ArrowRight");
  await page.keyboard.press("Control+ArrowRight");
  assert.deepEqual(await selection(), before, "Ctrl arrows leave the selection");
  assert(await page.locator("#score-cursor").isVisible(), "the cursor shows");
  await page.keyboard.press("Control+Space");
  assert.equal((await selectedStarts()).length, 3, "Ctrl Space adds the note at the cursor");
  await page.keyboard.press("Control+Space");
  assert.equal((await selectedStarts()).length, 2, "and takes it out again");
  await page.keyboard.press("Control+z");
  await page.evaluate(() => {
    const view = window.composer.view;
    view.dispatch({ selection: { anchor: 0 } });
  });
  assert.equal(await docText(), original, "undo takes the three marks back");
}
{
  // Two Ctrl drags across both voices: two places, every voice, one band each per staff.
  await openExample("Frère Jacques");
  await drawn();
  await settle(300);
  const geo = await geometry();
  const line = Math.min(...geo.notes.map((note) => note.line));
  const top = geo.notes
    .filter((note) => note.line === line && note.voice === 0)
    .sort((a, b) => a.time - b.time);
  const bottom = staffMiddle(geo, line, 1);
  await page.evaluate(() => window.composer.view.dispatch({ selection: { anchor: 0 } }));
  for (const [first, last] of [
    [top[0], top[3]],
    [top[8], top[11]],
  ]) {
    await page.mouse.move(first.head + 3, first.y);
    await page.keyboard.down("Control");
    await page.mouse.down();
    await page.mouse.move(last.head + 3, bottom, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up("Control");
  }
  const parts = await selection();
  assert.equal(parts.length, 4, `two places in two voices: ${JSON.stringify(parts)}`);
  await page.waitForFunction(() =>
    /selected in 2 places/.test(document.getElementById("explain").textContent),
  );
  assert.equal(await page.locator("#score-bands .score-band.selection").count(), 4);
}
console.log(
  "Composer: Ctrl click and Ctrl drag select in several places; . marks only them; Ctrl arrows and Ctrl Space: passed",
);

{
  // Sprint A 3. Typing helpers, off until chosen: a bar line on Space after a full bar, and the
  // nearest octave for a typed letter. Each says once what it did; undo returns what was typed.
  await page.locator('[data-menu="file"]').click();
  await page.getByRole("menuitem", { name: "New tune file" }).click();
  await page.waitForFunction(() => document.getElementById("name").value === "Untitled.abc");
  const typeAtEnd = async (keys) => {
    await page.locator(".cm-content").focus();
    await page.evaluate(() => {
      const view = window.composer.view;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });
    await page.keyboard.type(keys);
  };
  const lastLine = async () => (await docText()).trimEnd().split("\n").at(-1);
  await typeAtEnd("L:1/4\nC D E F ");
  assert.equal(await lastLine(), "C D E F", "off by default");
  for (const name of ["Bar line on Space when the bar is full", "Automatic octave"]) {
    await page.locator('[data-menu="edit"]').click();
    await page.getByRole("menuitem", { name: "Typing helpers" }).click();
    await page.getByRole("menuitemcheckbox", { name }).click();
  }
  await page.evaluate(() => {
    const view = window.composer.view;
    view.dispatch({
      changes: { from: view.state.doc.length - 1, to: view.state.doc.length, insert: "" },
    });
  });
  await typeAtEnd(" ");
  assert.equal(
    await docText().then((text) => text.endsWith("C D E F | ")),
    true,
    "Space wrote the bar line",
  );
  await page.locator("#notice", { hasText: "Space wrote a bar line" }).waitFor();
  await page.keyboard.press("Control+z");
  assert((await docText()).endsWith("C D E F "), "undo takes just the bar line back");
  // After F, a typed "a" is the A just above it; undo keeps the "a" as typed.
  await page.keyboard.type("| a");
  assert((await docText()).endsWith("C D E F | A"), `nearest octave: ${await lastLine()}`);
  await page.locator("#notice", { hasText: "the octave nearest the note before" }).waitFor();
  await page.keyboard.press("Control+z");
  assert((await docText()).endsWith("| a"), "undo returns what was typed");
  // From that a (A5), g is the G just below, whatever its case; ' moves a note up, and the
  // next letter follows from there.
  await page.keyboard.type(" g G c' d");
  // (c after g is the c' above; the typed ' pushes it to c''; d follows it there.)
  assert(
    // (After four quarters the bar helper, also on, writes its bar line.)
    (await docText()).endsWith("| a g g c'' | d''"),
    `case ignored, ' kept: ${await lastLine()}`,
  );
  // Off again, for what follows.
  for (const name of ["Bar line on Space when the bar is full", "Automatic octave"]) {
    await page.locator('[data-menu="edit"]').click();
    await page.getByRole("menuitem", { name: "Typing helpers" }).click();
    await page.getByRole("menuitemcheckbox", { name }).click();
  }
}
console.log(
  "Composer: typing helpers write a bar line on Space and the nearest octave; undo returns the typing: passed",
);

{
  // Sprint A 4. Zoom per pane, by keys on the focused pane; the score re-wraps and every hit,
  // band and highlight stays exact at 50%, 100% and 200%.
  await openExample("Greensleeves");
  await drawn();
  const zoom = () => page.evaluate(() => window.composer.state().zoom);
  const redrawn = async (level) => {
    await page.waitForFunction((want) => window.composer.state().zoom.score === want, level);
    await settle(900);
  };
  await page.locator("#score-scroll").focus();
  await page.keyboard.press("Control+Equal");
  await redrawn(1.1);
  await page.locator("#score-zoom.shown", { hasText: "Score 110%" }).waitFor();
  for (const [keys, level] of [
    [
      [
        "Control+Minus",
        "Control+Minus",
        "Control+Minus",
        "Control+Minus",
        "Control+Minus",
        "Control+Minus",
      ],
      0.5,
    ],
    [["Control+0"], 1],
    [
      [
        "Control+Equal",
        "Control+Equal",
        "Control+Equal",
        "Control+Equal",
        "Control+Equal",
        "Control+Equal",
        "Control+Equal",
      ],
      2,
    ],
  ]) {
    await page.locator("#score-scroll").focus();
    for (const key of keys) await page.keyboard.press(key);
    await redrawn(level);
    // Bring the first system into view.
    const first = (await geometry()).notes.sort((a, b) => a.y - b.y)[0];
    await page.evaluate((y) => {
      const scroll = document.getElementById("score-scroll");
      scroll.scrollTop += y - scroll.getBoundingClientRect().top - 160;
    }, first.y);
    await settle(200);
    // Measure again after scrolling, and test the hits on what is in view.
    const fresh = (await geometry()).notes;
    const frame = await page.locator("#score-scroll").boundingBox();
    const visible = fresh
      .filter((note) => note.y > frame.y + 30 && note.y < frame.y + frame.height - 30)
      .slice(0, 6);
    assert(visible.length >= 2, `notes in view at ${level}`);
    for (const note of visible) {
      const hit = await page.evaluate(
        ([x, y]) => window.composer.hit(x, y),
        [note.head + 2, note.y],
      );
      assert.equal(hit?.start, note.start, `hit at ${level * 100}%: note at ${note.time}`);
    }
    // A selected note's band sits on its head.
    const one = visible[0];
    await page.evaluate(
      ([from, to]) => window.composer.view.dispatch({ selection: { anchor: from, head: to } }),
      [one.start, one.end],
    );
    await page.waitForFunction(() => document.querySelector("#score-bands .score-band.selection"));
    const band = await page.locator("#score-bands .score-band.selection").first().boundingBox();
    assert(
      band.x <= one.head + 1 && band.x + band.width >= one.head + 2,
      `band on the note at ${level * 100}%: ${JSON.stringify(band)} vs ${one.head}`,
    );
  }
  await page.locator("#score-scroll").focus();
  await page.keyboard.press("Control+0");
  await redrawn(1);
  // The text: its own zoom, 80–160%.
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+Equal");
  await page.keyboard.press("Control+Equal");
  assert.equal((await zoom()).editor, 1.2);
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.querySelector(".cm-editor")).fontSize),
    "18px",
  );
  await page.locator("#editor-zoom.shown", { hasText: "Text 120%" }).waitFor();
  await page.keyboard.press("Control+0");
  assert.equal((await zoom()).editor, 1);
  // Outside the two panes, the keys are left to the browser.
  await page.locator("#tempo").focus();
  await page.mouse.move(5, 880);
  const before = await zoom();
  const prevented = await page.evaluate(() => {
    const event = new KeyboardEvent("keydown", {
      key: "=",
      code: "Equal",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.getElementById("tempo").dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert(!prevented, "Ctrl + outside the panes is the browser's");
  assert.deepEqual(await zoom(), before);
}
console.log(
  "Composer: zoom per pane by keys; hits and bands exact at 50%, 100% and 200%; page zoom left alone: passed",
);

{
  // Sprint A fixes 1 and 6. Every global shortcut works with the score focused, and undo and
  // redo too, keeping the score's selection on the same notes.
  await openExample("Greensleeves");
  await drawn();
  const score = page.locator("#score-scroll");
  const status = () => page.evaluate(() => window.composer.player.status);
  const focusedScore = () => page.evaluate(() => document.activeElement?.id === "score-scroll");
  await score.focus();
  await page.keyboard.press("Control+Enter");
  await page.waitForFunction(() => window.composer.player.status === "playing");
  assert(await focusedScore(), "Ctrl Enter plays and the score keeps focus");
  await page.keyboard.press("Control+Enter");
  await page.waitForFunction(() => window.composer.player.status === "paused");
  await page.keyboard.press("Control+Period");
  await page.waitForFunction(() => window.composer.player.status === "stopped");
  await page.keyboard.press("Control+Shift+Enter");
  await page.waitForFunction(() => window.composer.player.status === "playing");
  await page.keyboard.press("Control+Period");
  const doc = await docText();
  const bar = doc.indexOf("e>fe");
  await page.evaluate(
    ([from, to]) => window.composer.view.dispatch({ selection: { anchor: from, head: to } }),
    [bar, bar + 4],
  );
  await score.focus();
  await page.keyboard.press("Control+Alt+Enter");
  await page.waitForFunction(() => window.composer.state().region);
  await page.keyboard.press("Control+Period");
  await page.waitForFunction(() => window.composer.player.status === "stopped");
  await page.keyboard.press("Control+Shift+L");
  assert.equal(
    await page.locator("#loop").getAttribute("aria-pressed"),
    "true",
    "Ctrl Shift L loops",
  );
  await page.keyboard.press("Control+Shift+L");
  await page.keyboard.press("Control+Period");
  assert(await focusedScore(), "the score keeps focus through playback keys");
  assert.equal(await status(), "stopped");
  // Transpose, lengths, undo and redo from the score.
  const chosen = await selectedStarts();
  await page.keyboard.press("Alt+ArrowUp");
  assert.notEqual(await docText(), doc, "Alt ↑ transposes from the score");
  await page.keyboard.press("Control+z");
  assert.equal(await docText(), doc, "Ctrl Z undoes from the score");
  assert.deepEqual(await selectedStarts(), chosen, "the selection stays on the same notes");
  await page.keyboard.press("Control+Shift+z");
  assert.notEqual(await docText(), doc, "Ctrl Shift Z redoes from the score");
  await page.keyboard.press("Control+z");
  // (Halved, since 2× past the bar's length is refused in one voice too: round 8, rule (e).)
  await page.keyboard.press("Alt+BracketLeft");
  assert.notEqual(await docText(), doc, "Alt [ halves from the score");
  await page.keyboard.press("Control+z");
  assert.equal(await docText(), doc);
  assert(await focusedScore(), "the score keeps focus through editing keys");
  // F8 goes to the problem; Ctrl F opens Find; Ctrl S reaches the page's save.
  await page.evaluate((at) => {
    window.composer.view.dispatch({ changes: { from: at, insert: "c " } });
  }, doc.indexOf('| "G"d2 B G>AB | "Am"c2 A'));
  await page.waitForFunction(() => !document.getElementById("problems").hidden);
  await page.evaluate(() => window.composer.view.dispatch({ selection: { anchor: 0 } }));
  await score.focus();
  await page.keyboard.press("F8");
  await page.waitForFunction(() => window.composer.view.state.selection.main.from > 0);
  await page.evaluate(() => {
    const view = window.composer.view;
    view.dispatch({ selection: { anchor: 0 } });
  });
  await page.keyboard.press("Control+z");
  await page.waitForFunction(
    (original) => window.composer.view.state.doc.toString() === original,
    doc,
  );
  await score.focus();
  await page.keyboard.press("Control+f");
  await page.locator(".cm-search").waitFor();
  await page.keyboard.press("Escape");
  const reached = await page.evaluate(() => {
    let seen = false;
    const spy = (event) => {
      if (event.key === "s" && event.ctrlKey) {
        seen = true;
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    };
    document.addEventListener("keydown", spy, true);
    const scroll = document.getElementById("score-scroll");
    scroll.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    document.removeEventListener("keydown", spy, true);
    return seen;
  });
  assert(reached, "Ctrl S from the score reaches the page's keys");
  // A bare Enter still goes to the text.
  await score.focus();
  await page.keyboard.press("Enter");
  assert(await page.evaluate(() => window.composer.view.hasFocus), "Enter goes to the text");
}
console.log(
  "Composer: from the score, play, from caret, play selection, loop, stop, transpose, lengths, F8, Find, save, undo and redo all work: passed",
);

{
  // Sprint A fixes 2. Rests in a selection are skipped, never typed over.
  await openExample("Frère Jacques");
  await drawn();
  const original = await docText();
  const notes = original.indexOf("!mp!G A B G | G A B");
  const rests = original.indexOf("z4 | z4 |");
  const region = [
    [notes, notes + "!mp!G A B G | G A B".length],
    [rests, rests + "z4 | z4 |".length],
  ];
  const choose = (list) =>
    page.evaluate((spans) => {
      const view = window.composer.view;
      const Selection = view.state.selection.constructor;
      view.dispatch({
        selection: Selection.create(spans.map(([anchor, head]) => Selection.range(anchor, head))),
      });
    }, list);
  const explain = () => page.locator("#explain").textContent();
  // From the score.
  await choose(region);
  await page.locator("#score-scroll").focus();
  await page.keyboard.type(".");
  let marked = await docText();
  assert.equal(marked.length, original.length + 7, "seven notes marked from the score");
  assert(marked.includes("z4 | z4 |"), "the rests are untouched");
  await page.keyboard.press("Control+z");
  assert.equal(await docText(), original);
  // From the text.
  await page.locator(".cm-content").focus();
  await choose(region);
  await page.keyboard.type(".");
  marked = await docText();
  assert.equal(
    marked.length,
    original.length + 7,
    "seven notes marked from the text, nothing replaced",
  );
  assert(marked.includes("z4 | z4 |"));
  await page.keyboard.press("Control+z");
  assert.equal(await docText(), original);
  // A note and a rest, then >: nothing to pair, said, not typed.
  await choose([
    [notes + 4, notes + 5],
    [rests, rests + 2],
  ]);
  await page.keyboard.type(">");
  assert.equal(await docText(), original, "> with one note changes nothing");
  assert.match(await explain(), /Broken rhythm needs two notes/);
  // Rests alone, then .: said why, not typed.
  await choose([[rests, rests + "z4 | z4 |".length]]);
  await page.keyboard.type(".");
  assert.equal(await docText(), original, ". on rests changes nothing");
  assert.match(await explain(), /Rests can't be staccato/);
}
console.log(
  "Composer: rests in a selection are skipped; music is never typed over by a mark: passed",
);

{
  // Sprint A fixes 5 and 7. No ( is paired in music; endings, chords, chord symbols and inline
  // fields type as written; broken rhythm comes off with the gap it replaced.
  await page.locator('[data-menu="file"]').click();
  await page.getByRole("menuitem", { name: "New tune file" }).click();
  await page.waitForFunction(() => document.getElementById("name").value === "Untitled.abc");
  await page.locator(".cm-content").focus();
  await page.evaluate(() => {
    const view = window.composer.view;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
  });
  await page.keyboard.type('(3cde f2 |\n[CEG]2 [K:G] "Am"A2 |[1 A4 :|');
  await page.keyboard.press("Escape");
  const lines = (await docText()).trimEnd().split("\n").slice(-2);
  assert.deepEqual(
    lines,
    ["(3cde f2 |", '[CEG]2 [K:G] "Am"A2 |[1 A4 :|'],
    `typed as written: ${JSON.stringify(lines)}`,
  );
  // Broken rhythm on beamed notes, two spaces and a tab: off again restores each gap.
  const original = await docText();
  // Pairs AB (no gap), c  d (two spaces) and e	f (a tab).
  const line = "AB c  d e\tf |";
  await page.evaluate((text) => {
    const view = window.composer.view;
    view.dispatch({ changes: { from: view.state.doc.length, insert: `\n${text}\n` } });
  }, line);
  const from = (await docText()).lastIndexOf(line);
  await page.evaluate(
    ([a, b]) => window.composer.view.dispatch({ selection: { anchor: a, head: b } }),
    [from, from + line.length - 2],
  );
  await page.keyboard.type(">");
  assert(
    (await docText()).includes("A>B c>d e>f |"),
    `dotted-short on each pair: ${JSON.stringify((await docText()).split("\n").slice(-3))} ${await page.locator("#explain").textContent()}`,
  );
  await page.keyboard.type(">");
  assert(
    (await docText()).includes(line),
    `the gaps come back: ${(await docText()).split("\n").at(-2)}`,
  );
  assert.equal((await docText()).length, original.length + line.length + 2);
}
console.log(
  "Composer: ( is not paired in music; endings and fields type as written; broken rhythm restores its gaps: passed",
);

{
  // Sprint B. MusicXML in: an .mxl and a .musicxml with two parts and lyrics open as new drafts
  // that draw, play and have no problems, with a report; a malformed file says why.
  const fixtures = resolve("site/test/fixtures/musicxml");
  const importFile = async (name) => {
    await page.locator("#file").setInputFiles(resolve(fixtures, name));
  };
  for (const name of ["twinkle-two-parts.mxl", "twinkle-two-parts.musicxml"]) {
    await importFile(name);
    const dialog = page.locator("#import-report[open]");
    await dialog.waitFor();
    assert.match(
      await dialog.textContent(),
      /Imported “Twinkle, Twinkle, Little Star”: 2 parts, 8 bars\. Left out: page layout\./,
    );
    assert.match(await dialog.textContent(), /Page layout \(margins, spacing, fonts, credits\)/);
    await dialog.getByRole("button", { name: "OK" }).click();
    assert.match(await docText(), /^X:1\nT:Twinkle, Twinkle, Little Star\n/);
    assert.equal(await page.locator("#name").inputValue(), "Twinkle, Twinkle, Little Star.abc");
    await drawn();
    await settle(600);
    assert.equal(
      await page.evaluate(() => window.composer.scoreIndex().voices.length),
      2,
      `${name}: two voices`,
    );
    assert(
      (await page.locator("#score .abcjs-lyric").count()) >= 14,
      `${name}: the lyrics are drawn`,
    );
    await page.waitForFunction(() => document.getElementById("problems").hidden, null, {
      timeout: 3000,
    });
    await page.locator("#score-scroll").focus();
    await page.keyboard.press("Control+Enter");
    await page.waitForFunction(() => window.composer.state().lit > 0);
    await page.keyboard.press("Control+Period");
  }
  assert(
    [...served.keys()].some((path) => /musicxml/i.test(path)),
    "the converter loaded when it was needed",
  );
  // A malformed file: a plain error, and the draft that was open stays.
  const before = await docText();
  await importFile("malformed.musicxml");
  await page.locator("#notice", { hasText: "could not be imported" }).waitFor();
  assert.match(
    await page.locator("#notice").textContent(),
    /malformed\.musicxml could not be imported\. This file is not well-formed XML/,
  );
  assert.equal(await docText(), before, "nothing replaced");
  await page.locator(".notice-close").click();
}
console.log(
  "Composer: .mxl and .musicxml open as drafts that draw, play and pass the checks, with a report; a malformed file says why: passed",
);

{
  // Sprint B. MusicXML out: File › Export MusicXML › This tune, and the file opens again as the
  // same music.
  await openExample("Greensleeves");
  await drawn();
  const notes = async () =>
    page.evaluate(() =>
      window.composer
        .scoreIndex()
        .notes.map((note) => `${note.voice}:${note.time.toFixed(4)}:${note.duration.toFixed(4)}`),
    );
  const original = await notes();
  const summary = await page.locator("#score-summary").textContent();
  await page.locator('[data-menu="file"]').click();
  await page.getByRole("menuitem", { name: "Export MusicXML" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "This tune (.musicxml)…" }).click(),
  ]);
  assert.equal(download.suggestedFilename(), "Greensleeves.musicxml");
  const saved = resolve(process.env.TMPDIR ?? "/tmp", `composer-export-${Date.now()}.musicxml`);
  await download.saveAs(saved);
  assert.match(readFileSync(saved, "utf8"), /<score-partwise version="4.0">/);
  await page.locator("#file").setInputFiles(saved);
  await page.locator("#import-report[open]").waitFor();
  await page.locator("#import-report").getByRole("button", { name: "OK" }).click();
  await drawn();
  await settle(500);
  assert.deepEqual(await notes(), original, "the same notes, voices, times and lengths");
  assert.equal(await page.locator("#score-summary").textContent(), summary);
  unlinkSync(saved);
}
console.log("Composer: a tune exported as MusicXML opens again as the same music: passed");

let largeTimes = { report: 0, drawn: 0 };
const bombTimes = [];
{
  // Sprint B. A large score (12 parts × 300 bars, about 5 MB) imports with a progress line and
  // without holding the page: no task while importing runs as long as a quarter second.
  const steps = "CDEFGAB";
  const parts = Array.from({ length: 12 }, (_, part) => {
    const measures = Array.from({ length: 300 }, (_, m) => {
      const head =
        m === 0
          ? `<attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>${part % 4 === 3 ? "F" : "G"}</sign><line>${part % 4 === 3 ? 4 : 2}</line></clef></attributes>`
          : "";
      const notes = Array.from(
        { length: 8 },
        (_, n) =>
          `<note><pitch><step>${steps[(m * 3 + n + part) % 7]}</step><octave>${part % 4 === 3 ? 3 : 4}</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type>${part === 0 ? `<lyric number="1"><syllabic>single</syllabic><text>la</text></lyric>` : ""}</note>`,
      ).join("");
      return `<measure number="${m + 1}">${head}${notes}</measure>`;
    }).join("");
    return `<part id="P${part + 1}">${measures}</part>`;
  });
  const big = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><work><work-title>Large Score</work-title></work><part-list>${parts.map((_, part) => `<score-part id="P${part + 1}"><part-name>Part ${part + 1}</part-name></score-part>`).join("")}</part-list>${parts.join("")}</score-partwise>`;
  // One import of the large score, measured: the tasks that ran, the status lines, when the report
  // was painted and when the score was drawn.
  const importLarge = async () => {
    await page.evaluate(() => {
      window.__tasks = [];
      window.__lines = [];
      window.__reportPainted = 0;
      window.__drawn = 0;
      if (window.__watching) return;
      window.__watching = true;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          window.__tasks.push([entry.startTime, entry.duration]);
      }).observe({ type: "longtask" });
      const status = document.getElementById("explain");
      new MutationObserver(() =>
        window.__lines.push([performance.now(), status.textContent]),
      ).observe(status, { childList: true, characterData: true, subtree: true });
      // When the report has been painted (a frame after it opens), and when the score is drawn.
      const report = document.getElementById("import-report");
      new MutationObserver(() => {
        if (report.open && !window.__reportPainted)
          requestAnimationFrame(() =>
            setTimeout(() => {
              window.__reportPainted = performance.now();
            }, 0),
          );
      }).observe(report, { attributes: true, attributeFilter: ["open"] });
      const summary = document.getElementById("score-summary");
      new MutationObserver(() => {
        if (/^Large Score/.test(summary.textContent) && !window.__drawn)
          window.__drawn = performance.now();
      }).observe(summary, { childList: true, characterData: true, subtree: true });
    });
    // A fresh draft first, so the summary changes when the large score is drawn.
    await page.evaluate(() => {
      const view = window.composer.view;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "X:1\nT:Before\nK:C\nC|\n" },
      });
    });
    await page.waitForFunction(() =>
      /^Before/.test(document.getElementById("score-summary").textContent),
    );
    // A clean heap first: the page has run every check before this one, and a collection of all
    // that during the import would be counted against it.
    await page.evaluate(() => window.gc?.());
    // How fast the machine is right now: the same kind of work as the importer's (building,
    // parsing and walking XML), timed just before it. About 45 ms on an idle machine.
    const reference = await page.evaluate(() => {
      const start = performance.now();
      let text = "";
      for (let n = 0; n < 6000; n++)
        text += `<note><pitch><step>${"CDEFGAB"[n % 7]}</step><octave>${n % 5}</octave></pitch><duration>${(n % 3) + 1}</duration></note>`;
      const doc = new DOMParser().parseFromString(`<r>${text}</r>`, "application/xml");
      let sum = 0;
      for (const node of doc.getElementsByTagName("step")) sum += node.textContent.charCodeAt(0);
      return performance.now() - start + sum * 0;
    });
    await page.evaluate(() => {
      window.__tasks = [];
      window.__lines = [];
      window.__reportPainted = 0;
      window.__drawn = 0;
    });
    await page.locator("#file").setInputFiles({
      name: "large.musicxml",
      mimeType: "application/xml",
      buffer: Buffer.from(big),
    });
    await page.locator("#import-report[open]").waitFor({ timeout: 60000 });
    await page.waitForFunction(() => window.__drawn > 0, null, { timeout: 60000 });
    await page.locator("#import-report").getByRole("button", { name: "OK" }).click();
    const run = await page.evaluate(() => ({
      tasks: window.__tasks,
      lines: window.__lines,
      reportPainted: window.__reportPainted,
      drawnAt: window.__drawn,
    }));
    const shown = run.lines.filter(([, text]) => /^Importing large\.musicxml: \d+%$/.test(text));
    assert(shown.length >= 5, `a progress line while importing: ${shown.length} updates`);
    const finished = shown.at(-1)[0];
    const longest = Math.max(
      0,
      ...run.tasks.filter(([start]) => start < finished).map(([, ms]) => ms),
    );
    return { ...run, finished, longest, reference };
  };
  // On an idle machine, from a clean heap, the longest task is about 190 ms of a 640 ms conversion
  // (about 4 times the reference work), every run; an import that stopped yielding would hold the
  // page for its whole conversion (some 14 times the reference), every run, loaded or not. A busy
  // machine (other browsers running) stretches every task alike: the budget is 250 ms, or 7 times
  // the reference timed just before, and the best of up to three runs counts.
  const held = (run) => run.longest >= Math.max(250, 7 * run.reference);
  let measured = await importLarge();
  for (let run = 2; run <= 3 && held(measured); run++) {
    console.log(
      `  (a ${Math.round(measured.longest)} ms task while importing, the reference ${Math.round(measured.reference)} ms; measuring again)`,
    );
    const again = await importLarge();
    if (again.longest / again.reference < measured.longest / measured.reference) measured = again;
  }
  const { reportPainted, drawnAt, finished, longest, reference } = measured;
  assert(
    !held(measured),
    `the page is not held while importing: longest task ${Math.round(longest)} ms (the reference ${Math.round(reference)} ms)`,
  );
  if (longest >= 250)
    console.log(
      `  (a busy machine: the longest task, ${Math.round(longest)} ms, is ${(longest / reference).toFixed(1)} times the reference work, as on an idle one)`,
    );
  // 12. The report shows as soon as the conversion is done; the score draws behind it.
  assert(
    reportPainted > 0 && reportPainted < drawnAt,
    `the report was painted (${Math.round(reportPainted - finished)} ms after converting) before the score was drawn (${Math.round(drawnAt - finished)} ms)`,
  );
  largeTimes = {
    report: Math.round(reportPainted - finished),
    drawn: Math.round(drawnAt - finished),
  };
  await page.waitForFunction(
    () => /^Large Score .* 300 bars/.test(document.getElementById("score-summary").textContent),
    null,
    { timeout: 60000 },
  );
}
console.log(
  `Composer: a 12-part, 300-bar score imports with a progress line, the page free; the report is painted ${largeTimes.report} ms after converting, the score drawn behind it at ${largeTimes.drawn} ms: passed`,
);

{
  // Sprint B fixes 1. Octave instruments play where they sound: what the player schedules for
  // tenor, guitar, piccolo and double bass (an octave clef, or an octave transposition).
  await page
    .locator("#file")
    .setInputFiles(resolve("site/test/fixtures/musicxml/octave-instruments.musicxml"));
  await page.locator("#import-report[open]").waitFor();
  await page.locator("#import-report").getByRole("button", { name: "OK" }).click();
  await page.waitForFunction(() =>
    /^Octave Instruments/.test(document.getElementById("score-summary").textContent),
  );
  await drawn();
  assert.match(
    await docText(),
    /V:1 name="Tenor" clef=treble-8\nV:2 name="Guitar" clef=treble-8\nV:3 name="Piccolo" clef=treble transpose=12\n/,
  );
  const first = await page.evaluate(() => {
    const byTrack = new Map();
    for (const note of window.composer.timelineNotes())
      if (!byTrack.has(note.track)) byTrack.set(note.track, note.pitch);
    return [...byTrack.entries()].sort((a, b) => a[0] - b[0]).map(([, pitch]) => pitch);
  });
  // E4 tenor, E3 guitar, E6 piccolo (both ways), E2 double bass (both ways): the sounding E of each.
  assert.deepEqual(first, [64, 52, 88, 88, 40, 40], `the first notes as played: ${first}`);
  await page.waitForFunction(() => document.getElementById("problems").hidden, null, {
    timeout: 3000,
  });
}
console.log(
  "Composer: tenor, guitar, piccolo and double bass import and play at their sounding pitch: passed",
);

{
  // Sprint B fixes 6. A lone whole-bar rest is a rest of the bar, not a "1" bar rest; the
  // player times it, and two bars of rest in another meter, as written.
  await page
    .locator("#file")
    .setInputFiles(resolve("site/test/fixtures/musicxml/bar-rests.musicxml"));
  await page.locator("#import-report[open]").waitFor();
  await page.locator("#import-report").getByRole("button", { name: "OK" }).click();
  await page.waitForFunction(() =>
    /^Bar Rests/.test(document.getElementById("score-summary").textContent),
  );
  await drawn();
  assert.match(await docText(), /c d e f \| z4 \| \[M:3\/4\] z3 \| z3 \|\nV:1\nz3 \| g f e \|\]/);
  const length = await page.evaluate(() => window.composer.state().timeline.length);
  assert(
    Math.abs(length - 5) < 1e-9,
    `two bars of 4/4 and four of 3/4 last five whole notes: ${length}`,
  );
  assert.equal(await page.locator("#score .abcjs-mmrest").count(), 0, "no multi-bar rest drawn");
  await page.waitForFunction(() => document.getElementById("problems").hidden, null, {
    timeout: 3000,
  });
}
console.log("Composer: a whole-bar rest imports as a rest of the bar and plays its length: passed");

{
  // Sprint B fixes 3. Archives that would unpack to too much are refused plainly and quickly: by
  // the sizes their directory gives, and while unpacking whatever the header claims.
  const zipOf = (files) => {
    const parts = [];
    const central = [];
    let offset = 0;
    for (const { name, data, method = 0, claims = data.length } of files) {
      const nameBytes = Buffer.from(name);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(method, 8);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(claims, 22);
      local.writeUInt16LE(nameBytes.length, 26);
      const record = Buffer.alloc(46);
      record.writeUInt32LE(0x02014b50, 0);
      record.writeUInt16LE(20, 4);
      record.writeUInt16LE(20, 6);
      record.writeUInt16LE(method, 10);
      record.writeUInt32LE(data.length, 20);
      record.writeUInt32LE(claims, 24);
      record.writeUInt16LE(nameBytes.length, 28);
      record.writeUInt32LE(offset, 42);
      parts.push(local, nameBytes, data);
      central.push(record, nameBytes);
      offset += 30 + nameBytes.length + data.length;
    }
    const size = central.reduce((sum, buffer) => sum + buffer.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(size, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...parts, ...central, end]);
  };
  const container = {
    name: "META-INF/container.xml",
    data: Buffer.from(
      '<container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>',
    ),
  };
  const bombs = [
    // Honest: says it unpacks to 2 GB.
    [
      "honest.mxl",
      zipOf([
        container,
        {
          name: "score.musicxml",
          data: deflateRawSync(Buffer.from("<x/>")),
          method: 8,
          claims: 2 ** 31,
        },
      ]),
    ],
    // Lying: says 1,000 bytes, unpacks to 80 MB.
    [
      "lying.mxl",
      zipOf([
        container,
        {
          name: "score.musicxml",
          data: deflateRawSync(Buffer.alloc(80 * 1024 * 1024)),
          method: 8,
          claims: 1000,
        },
      ]),
    ],
  ];
  const before = await docText();
  for (const [name, buffer] of bombs) {
    const started = Date.now();
    await page
      .locator("#file")
      .setInputFiles({ name, mimeType: "application/octet-stream", buffer });
    await page.locator("#notice", { hasText: `${name} could not be imported` }).waitFor();
    const took = Date.now() - started;
    assert(
      (await page.locator("#notice").textContent()).includes(
        `${name} could not be imported. This .mxl unpacks to more than 64 MB, too large to open here.`,
      ),
      `${name}: the plain message: ${await page.locator("#notice").textContent()}`,
    );
    assert(took < 5000, `${name} refused in ${took} ms`);
    bombTimes.push(`${name} (${(buffer.length / 1024).toFixed(0)} KB) ${took} ms`);
    assert.equal(await docText(), before, "the open draft stays");
    await page.locator(".notice-close").click();
  }
}
console.log(`Composer: zip bombs are refused plainly (${bombTimes.join(", ")}): passed`);

{
  // Sprint C 1. Playback follows D.S. al Coda: the order scheduled, the notes lit as they play,
  // and the clock saying "D.S." and "Coda"; Play › Follow D.C./D.S. jumps turns it off.
  await setText(
    'X:1\nT:Jumps\nM:1/4\nL:1/4\nQ:1/4=300\nK:C\nC|!segno!D|"^To Coda"E|!D.S.alcoda!F|!coda!G|]\n',
    "Jumps",
  );
  const letters = () =>
    page.evaluate(() =>
      window.composer
        .timelineNotes()
        .filter((note) => note.track === 0)
        .map((note) => ({ 60: "C", 62: "D", 64: "E", 65: "F", 67: "G" })[note.pitch])
        .join(""),
    );
  assert.equal(
    await letters(),
    "CDEFDEG",
    "the order scheduled: back to the segno, on to the coda",
  );
  await setCaret(0);
  await page.locator("#play").click();
  const lit = [];
  const clocks = new Set();
  const started = Date.now();
  while (Date.now() - started < 4000) {
    const now = await page.evaluate(() => ({
      status: window.composer.state().status,
      note: [...document.querySelectorAll(".cm-content .abc-playing")]
        .map((element) => element.textContent)
        .join(""),
      clock: document.getElementById("clock").textContent,
    }));
    const letter = /[A-G](?=[^A-G]*$)/.exec(now.note)?.[0];
    if (letter && lit[lit.length - 1] !== letter) lit.push(letter);
    clocks.add(now.clock.replace(/ · \d+:\d+$/, ""));
    if (now.status === "stopped" && lit.length) break;
    await settle(30);
  }
  assert.equal(lit.join(""), "CDEFDEG", `the notes lit as they play: ${lit.join("")}`);
  assert(clocks.has("Bar 2 · D.S."), `the clock after the jump: ${[...clocks].join(", ")}`);
  assert(clocks.has("Bar 5 · Coda"), `the clock in the coda: ${[...clocks].join(", ")}`);
  await page.locator('[data-menu="play"]').click();
  await page.getByRole("menuitemcheckbox", { name: "Follow D.C./D.S. jumps" }).click();
  assert.equal(await letters(), "CDEFG", "as written, for practice");
  await page.locator('[data-menu="play"]').click();
  await page.getByRole("menuitemcheckbox", { name: "Follow D.C./D.S. jumps" }).click();
  assert.equal(await letters(), "CDEFDEG");
}
console.log(
  "Composer: a D.S. al Coda plays in order, lit and named on the clock; the setting turns it off: passed",
);

{
  // Sprint C 2. Tune book: sort and renumber a three-tune file, each one undo step; line up bars.
  const book =
    "%abc-2.1\n% three tunes\n\nX:7\nT:The Swallowtail\nM:6/8\nL:1/8\nK:Em\nGEE BEE|dBA BAG|\n\n% a note on the next tune\nX:3\nT:Banish Misfortune\nM:6/8\nL:1/8\nK:Dmix\nfed cAG|A2d cAG|\n\nX:12\nT:Àfter the Fair\nM:3/4\nL:1/4\nK:D\nDFA|d2c|\n";
  await setText(book, "The Swallowtail");
  const titles = async () => (await docText()).match(/^T:.*$/gm).join(" / ");
  const undoOnce = async () => {
    await page.evaluate(() => window.composer.view.focus());
    await page.keyboard.press("Control+z");
    await settle(150);
  };
  await menu("tunes", "Sort tunes…");
  const sortDialog = page.locator("#sort-tunes[open]");
  await sortDialog.waitFor();
  assert.match(
    await sortDialog.textContent(),
    /text between two tunes move with the tune after them/,
  );
  await sortDialog.getByRole("button", { name: "Sort" }).click();
  await page.waitForFunction(() =>
    /^%abc-2\.1\n% three tunes\n\nX:12\nT:Àfter/.test(window.composer.view.state.doc.toString()),
  );
  assert.equal(await titles(), "T:Àfter the Fair / T:Banish Misfortune / T:The Swallowtail");
  assert.match(await docText(), /% a note on the next tune\nX:3\nT:Banish Misfortune/);
  await undoOnce();
  assert.equal(await docText(), book, "one undo puts the old order back");
  // Renumber from the rail's menu.
  await page.locator(".tune-item").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Renumber X: 1…n" }).click();
  await page.waitForFunction(() => /^X:1$/m.test(window.composer.view.state.doc.toString()));
  assert.deepEqual((await docText()).match(/^X:.*$/gm), ["X:1", "X:2", "X:3"]);
  assert.equal(
    (await docText()).replace(/^X:.*$/gm, ""),
    book.replace(/^X:.*$/gm, ""),
    "only the numbers",
  );
  await undoOnce();
  assert.equal(await docText(), book, "one undo puts the numbers back");
  // Line up bars: the bar lines of the lines below each other, the music the same.
  const tune =
    "X:1\nT:Lined\nM:4/4\nL:1/8\nK:G\n|:GABc d2B2|c2A2 B4|AGFE D2D2|G8:|\ngfed B2B2|cdcB A4|BAGF E2E2|D8|]\n";
  await setText(tune, "Lined");
  const notesBefore = await page.evaluate(() =>
    window.composer.scoreIndex().notes.map((note) => `${note.voice}:${note.time}:${note.duration}`),
  );
  await menu("tunes", "Line up bars");
  await page.waitForFunction(
    (before) => window.composer.view.state.doc.toString() !== before,
    tune,
  );
  const lines = (await docText()).split("\n");
  const columns = (line) => [...line.matchAll(/\|/g)].map((match) => match.index);
  assert.deepEqual(
    columns(lines[5]).slice(1, 4),
    columns(lines[6]).slice(0, 3),
    "the bar lines line up",
  );
  // On screen too: the editor's font is monospaced, so the bar lines stand in columns.
  const lefts = await page.evaluate(() => {
    const view = window.composer.view;
    const doc = view.state.doc;
    return [6, 7].map((number) => {
      const line = doc.line(number);
      return [...line.text.matchAll(/\|/g)].map((match) =>
        Math.round(view.coordsAtPos(line.from + match.index).left),
      );
    });
  });
  assert.deepEqual(
    lefts[0].slice(1, 4),
    lefts[1].slice(0, 3),
    `bar lines in columns on screen: ${JSON.stringify(lefts)}`,
  );
  await drawn();
  await settle(300);
  assert.deepEqual(
    await page.evaluate(() =>
      window.composer
        .scoreIndex()
        .notes.map((note) => `${note.voice}:${note.time}:${note.duration}`),
    ),
    notesBefore,
    "the same notes",
  );
  await undoOnce();
  assert.equal(await docText(), tune, "one undo");
}
console.log(
  "Composer: tune book: sort and renumber, one undo each; bars lined up, the music the same: passed",
);

{
  // Sprint C 3. Exports: an SVG of this tune, the HTML tune book (opened offline, every tune shown)
  // and every tune's MIDI in one .zip.
  await setText(
    'X:1\nT:The Swallowtail\nM:6/8\nL:1/8\nK:Em\nGEE BEE|dBA BAG|\n\nX:2\nT:Banish Misfortune\nM:6/8\nL:1/8\nK:Dmix\nfed cAG|A2d cAG|\n\nX:3\nT:Jumps\nM:1/4\nL:1/4\nK:C\nC|!segno!D|"^To Coda"E|!D.S.alcoda!F|!coda!G|]\n',
    "The Swallowtail",
  );
  const exportVia = async (item, kind, setup) => {
    await page.locator('[data-menu="file"]').click();
    await page.getByRole("menuitem", { name: "Export", exact: true }).click();
    await page.getByRole("menuitem", { name: item, exact: true }).click();
    const dialog = page.locator(`#export-${kind}[open]`);
    await dialog.waitFor();
    if (setup) await setup(dialog);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      dialog.getByRole("button", { name: "Export" }).click(),
    ]);
    const path = resolve(
      process.env.TMPDIR ?? "/tmp",
      `composer-${Date.now()}-${download.suggestedFilename()}`,
    );
    await download.saveAs(path);
    return { name: download.suggestedFilename(), path };
  };
  const svg = await exportVia("SVG of this tune…", "svg");
  assert.equal(svg.name, "The Swallowtail.svg");
  const svgText = readFileSync(svg.path, "utf8");
  assert.match(svgText, /^<\?xml version="1\.0" encoding="UTF-8" standalone="no"\?>\n<svg /);
  assert.match(svgText, / viewBox="-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+"/);
  assert(!/\sclass=|currentColor|is-caret|is-selected/.test(svgText), "no classes or highlights");
  const svgDrawn = await page.evaluate(async (markup) => {
    const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
    if (parsed.querySelector("parsererror")) return { valid: false, width: 0 };
    const image = new Image();
    image.src = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
    await image.decode();
    return { valid: true, width: image.naturalWidth };
  }, svgText);
  assert.deepEqual(svgDrawn.valid, true, "valid SVG");
  assert(svgDrawn.width > 300, `the SVG draws on its own: ${svgDrawn.width} px wide`);
  unlinkSync(svg.path);
  const html = await exportVia("HTML tune book…", "html", (dialog) =>
    dialog.getByRole("checkbox").check(),
  );
  assert.match(html.name, /\.html$/);
  const offline = await browser.newContext({
    offline: true,
    viewport: { width: 1440, height: 900 },
  });
  const reader = await offline.newPage();
  const requests = [];
  reader.on("request", (request) => {
    if (!request.url().startsWith("file:") && !request.url().startsWith("data:"))
      requests.push(request.url());
  });
  await reader.goto(`file://${html.path}`);
  const shown = await reader.evaluate(() => ({
    contents: [...document.querySelectorAll("nav a")].map((link) => link.textContent),
    tunes: [...document.querySelectorAll("section.tune")].map((section) => ({
      title: section.querySelector("h2").textContent,
      drawn: section.querySelector("svg")?.getBoundingClientRect().height ?? 0,
      abc: Boolean(section.querySelector("details pre")),
      play: Boolean(section.querySelector("button.play")),
    })),
  }));
  assert.deepEqual(shown.contents, ["The Swallowtail", "Banish Misfortune", "Jumps"]);
  assert.equal(shown.tunes.length, 3);
  for (const tune of shown.tunes) {
    assert(tune.drawn > 60, `${tune.title} is drawn (${tune.drawn} px)`);
    assert(tune.abc && tune.play, `${tune.title} has its ABC and a Play button`);
  }
  assert.deepEqual(requests, [], "the book needs nothing from the network");
  await offline.close();
  unlinkSync(html.path);
  const midi = await exportVia("MIDI…", "midi", (dialog) =>
    dialog.getByLabel(/Every tune/).check(),
  );
  assert.equal(
    midi.name,
    "Untitled MIDI.zip".replace(
      "Untitled",
      (await page.locator("#name").inputValue()).replace(/\.abc$/, ""),
    ),
  );
  const zip = readFileSync(midi.path);
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const entries = [];
  for (let at = zip.readUInt32LE(end + 16), n = 0; n < zip.readUInt16LE(end + 10); n++) {
    const nameLength = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString();
    const data = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    entries.push({ name, head: zip.subarray(data, data + 4).toString() });
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  assert.deepEqual(entries, [
    { name: "The Swallowtail.mid", head: "MThd" },
    { name: "Banish Misfortune.mid", head: "MThd" },
    { name: "Jumps.mid", head: "MThd" },
  ]);
  unlinkSync(midi.path);
}
console.log(
  "Composer: SVG and HTML book exported (the book opens offline with every tune), every tune's MIDI in one .zip: passed",
);

{
  // Sprint C fixes 1. A subtitle (or %% lines among the header) never makes bar 1 a pickup.
  const rulerLabels = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("#timeline-ticks .timeline-tick span:not([hidden])")].map(
        (label) => label.textContent,
      ),
    );
  for (const [text, title, bars] of [
    ["X:1\nT:Waltz\nT:A subtitle\nM:3/4\nL:1/4\nK:C\nC D E|F G A|\n", "Waltz", "2 bars"],
    [
      "X:1\nT:Élan\n%%titlefont Times 20\nT:Second title\nM:6/8\nL:1/8\nK:Am\nV:1\nV:2 clef=bass\n[V:1] A2B c2d|e2f g3|a2g f2e|d6|\n[V:2] A,,3 E,3|A,,3 C,3|D,3 A,,3|D,6|\n",
      "Élan",
      "4 bars",
    ],
    ["X:1\nT:Slip\nT:jig\nM:9/8\nL:1/8\nK:G\nGAB c2B AGE|DGG GAB d3|\n", "Slip", "2 bars"],
  ]) {
    await setText(text, title);
    const summary = await page.locator("#score-summary").textContent();
    assert(summary.includes(` · ${bars}`) && !/pickup/.test(summary), `${title}: ${summary}`);
    const labels = await rulerLabels();
    assert.equal(labels[0], "1", `${title}'s ruler starts at bar 1: ${labels}`);
    assert.equal(labels.at(-1), bars.split(" ")[0], `${title}'s ruler ends on its last bar`);
  }
  await setText("X:1\nT:Real\nT:pickup\nM:3/4\nL:1/4\nK:C\nC|D E F|G A B|\n", "Real");
  assert.match(await page.locator("#score-summary").textContent(), /2 bars and a pickup/);
}
console.log("Composer: a subtitle or %% lines never make the first bar a pickup: passed");

{
  // Sprint C fixes 2. Line up bars: [V:1] |: and !segno!|: lead their lines; the voices of each
  // system stand in the same columns (the monospaced editor shows them so; see Sprint C 2).
  const tune =
    'X:3\nT:Élan\nM:6/8\nL:1/8\nK:Am\nV:1 name="Fiddle"\nV:2 clef=bass\n[V:1] A2B c2d|e2f g3|a2g f2e|d6|\n[V:2] A,,3 E,3|A,,3 C,3|D,3 A,,3|D,6|\n[V:1] |:e2e d2B|c3 A3:|\n[V:2] |:A,3 G,3|A,6:|\n';
  await setText(tune, "Élan");
  await menu("tunes", "Line up bars");
  await page.locator("#notice", { hasText: /Lined up \d+ lines? in 1 tune\./ }).waitFor();
  const columns = await page.evaluate(() => {
    const view = window.composer.view;
    const doc = view.state.doc;
    return [8, 9, 10, 11].map((number) => {
      const line = doc.line(number);
      const lead = line.text.indexOf("|:");
      return [...line.text.matchAll(/\|/g)]
        .filter((match) => lead < 0 || match.index > lead + 1)
        .map((match) => match.index);
    });
  });
  assert.deepEqual(columns[0], columns[1], `the first system lines up: ${JSON.stringify(columns)}`);
  assert.deepEqual(
    columns[2],
    columns[3],
    `the second system lines up: ${JSON.stringify(columns)}`,
  );
  await page.locator(".notice-close").click();
  await menu("tunes", "Line up bars");
  await page.locator("#notice", { hasText: "Bars already line up." }).waitFor();
  await page.locator(".notice-close").click();
}
console.log("Composer: lined-up bars stand in columns per system, [V:1] |: leading: passed");

{
  // Sprint C fixes 3. The ruler with jumps: every band's first bar numbered, the Coda chip
  // always there, a gap between bands; at 1440, 1024 and 390.
  const DS =
    'X:1\nT:D.S. al Coda\nM:4/4\nL:1/4\nK:C\nC D E F|!segno!G A B c|d e "^To Coda"f g|a g f e|!D.S.alcoda!d c B A||!coda!G F E D|C4|]\n';
  const DC =
    "X:1\nT:D.C. al Fine\nM:3/4\nL:1/4\nK:G\nG A B|c B A|!fine!G3||d e f|g f e|!D.C.alfine!d3|]\n";
  const rulerOf = (p) =>
    p.evaluate(() => {
      const shown = (element) =>
        !element.hidden &&
        getComputedStyle(element).display !== "none" &&
        element.getBoundingClientRect().width > 0;
      const ticks = [...document.querySelectorAll("#timeline-ticks .timeline-tick")];
      return {
        starts: [...document.querySelectorAll("#timeline-ticks span[data-band-start]")].map(
          (label) => shown(label),
        ),
        chips: [...document.querySelectorAll(".timeline-pass-tag")]
          .filter(shown)
          .map((chip) => chip.textContent),
        bands: [...document.querySelectorAll("#timeline-passes .timeline-pass")]
          .map((band) => band.getBoundingClientRect())
          .map((box) => [box.left, box.right]),
        ticks: ticks.length,
      };
    });
  for (const width of [1440, 1024, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 900 },
    });
    watch(context);
    const p = await context.newPage();
    await p.goto(url);
    await p.getByRole("button", { name: "Ode to Joy" }).first().click();
    await p.waitForFunction(() => (window.composer.state().timeline?.notes ?? 0) > 0);
    for (const [text, title, chips] of [
      [DS, "D.S. al Coda", ["D.S.", ["Coda", "𝄌"]]],
      [DC, "D.C. al Fine", ["D.C."]],
    ]) {
      await p.evaluate((value) => {
        const view = window.composer.view;
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
      }, text);
      await p.waitForFunction(
        (name) => document.getElementById("score-summary").textContent.startsWith(name),
        title,
      );
      await p.waitForTimeout(500);
      const ruler = await rulerOf(p);
      assert(
        ruler.starts.length >= 1 && ruler.starts.every(Boolean),
        `${title} at ${width}: every band's first bar is numbered`,
      );
      assert.equal(ruler.chips.length, chips.length, `${title} at ${width}: ${ruler.chips}`);
      chips.forEach((chip, at) =>
        assert([chip].flat().includes(ruler.chips[at]), `${title} at ${width}: ${ruler.chips}`),
      );
      for (let at = 1; at < ruler.bands.length; at++)
        assert(
          ruler.bands[at][0] - ruler.bands[at - 1][1] >= 1.5,
          `${title} at ${width}: a gap between bands ${JSON.stringify(ruler.bands)}`,
        );
    }
    await context.close();
  }
}
console.log(
  "Composer: rulers with jumps number each band, keep the Coda chip and a gap at 1440, 1024 and 390: passed",
);

{
  // Sprint C fixes 5 and 6. Tune-book commands say what they did; Enter confirms a dialog.
  const book =
    "X:7\nT:The Swallowtail\nK:Em\nGEE BEE|\n\nX:3\nT:Banish Misfortune\nK:Dmix\nfed cAG|\n\nX:12\nT:Àfter the Fair\nK:D\nDFA|\n";
  await setText(book, "The Swallowtail");
  await menu("tunes", "Sort tunes…");
  await page.locator("#sort-tunes[open]").waitFor();
  await page.keyboard.press("Enter");
  await page.locator("#notice", { hasText: "Sorted 3 tunes by title." }).waitFor();
  assert.match(await docText(), /^X:12\nT:Àfter the Fair/);
  await page.locator(".notice-close").click();
  await menu("tunes", "Renumber X: 1…n");
  await page.locator("#notice", { hasText: "Renumbered 3 tunes (X:1–3)." }).waitFor();
  await page.locator(".notice-close").click();
  await page.evaluate(() => {
    const view = window.composer.view;
    view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf("Banish") } });
  });
  await menu("tunes", "Duplicate tune");
  await page.locator("#notice", { hasText: "Duplicated Banish Misfortune as X:4." }).waitFor();
  await page.locator(".notice-close").click();
  await menu("tunes", "Incipits…");
  await page.locator("#incipits[open]").waitFor();
  await page.keyboard.press("Enter");
  await page.locator("#notice", { hasText: "Made incipits of 4 tunes" }).waitFor();
  await page.locator(".notice-close").click();
}
console.log(
  "Composer: tune-book commands say what they did; Enter confirms Sort and Incipits: passed",
);

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
// Sprint C fixes 12. Menu titles, editing buttons and the Text/Score switch are 44 × 44.
const small44 = await small.evaluate(() =>
  [...document.querySelectorAll(".workspace-menus button, .toolbar button, .view-switch button")]
    .filter((element) => element.getClientRects().length)
    .map((element) => ({
      id: element.id || element.getAttribute("aria-label") || element.textContent.trim(),
      box: element.getBoundingClientRect(),
    }))
    .filter(({ box }) => box.height < 44 - 0.5 || box.width < 44 - 0.5)
    .map(({ id, box }) => `${id} ${Math.round(box.width)}×${Math.round(box.height)}`),
);
assert.deepEqual(small44, [], "menus, editing buttons and Text/Score are 44 px");
// File, Edit, Tunes and ⋯ (Insert, View, Play, Help) on a phone.
assert.deepEqual(
  await small.evaluate(() =>
    [...document.querySelectorAll(".workspace-menus button")]
      .filter((element) => element.getClientRects().length)
      .map((element) => element.textContent),
  ),
  ["File", "Edit", "Tunes", "⋯"],
);
await small.locator("#more-menus").click();
await small.locator(".workspace-dropdown").getByRole("menuitem", { name: "Play" }).click();
assert(await small.getByRole("menuitemcheckbox", { name: "Follow D.C./D.S. jumps" }).isVisible());
await small.keyboard.press("Escape");
await small.keyboard.press("Escape");
await small.locator("#more-tools").click();
for (const name of ["Focus", "ABC cheat sheet", "Tie or untie", "Up an octave"])
  assert(await small.getByRole("menuitem", { name }).isVisible(), `More has ${name}`);
await small.keyboard.press("Escape");
// The phone header keeps the file name beside the menus; the tunes panel opens from More.
const chip = await small.evaluate(() => {
  const name = document.getElementById("name").getBoundingClientRect();
  const menus = document.querySelector(".workspace-menus").getBoundingClientRect();
  // How many of the name's characters show: at least twelve.
  const input = document.getElementById("name");
  const style = getComputedStyle(input);
  const context = document.createElement("canvas").getContext("2d");
  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const room =
    input.clientWidth -
    Number.parseFloat(style.paddingLeft) -
    Number.parseFloat(style.paddingRight);
  let shown = 0;
  while (
    shown < input.value.length &&
    context.measureText(input.value.slice(0, shown + 1)).width <= room
  )
    shown += 1;
  return {
    sameRow: Math.abs(name.top - menus.top) < 8,
    width: name.width,
    height: name.height,
    shown,
    value: input.value,
  };
});
assert(
  chip.sameRow && chip.shown >= Math.min(12, chip.value.length) && chip.height >= 44,
  `file name chip ${JSON.stringify(chip)}`,
);
await small.locator("#more-tools").click();
await small
  .getByRole("menuitem", { name: "Tunes panel" })
  .or(small.getByRole("menuitemcheckbox", { name: "Tunes panel" }))
  .first()
  .click();
assert(await small.locator("#rail-close").isVisible(), "the tunes panel has a close button");
const row = await small.locator(".tune-item").first().boundingBox();
assert(row.height >= 40, "tune rows are at least 40 px tall");
await small.locator("#rail-close").click();
assert.equal(
  await small.locator("#workspace").getAttribute("data-rail"),
  "closed",
  "the close button closes it",
);
{
  // 9. Frère Jacques on a phone: two bars a line wherever they fit, the header kept whole.
  await openExample("Frère Jacques", small);
  await small.waitForFunction(() => (window.composer.state().timeline?.notes ?? 0) > 0);
  await small.locator("#show-score").click();
  await small.waitForTimeout(400);
  const layout = await small.evaluate(() => {
    const svg = document.querySelector("#score svg");
    const perLine = {};
    for (const bar of svg.querySelectorAll(".abcjs-bar.abcjs-v0")) {
      const line = /abcjs-l(\d+)/.exec(bar.getAttribute("class"))?.[1];
      perLine[line] = (perLine[line] ?? 0) + 1;
    }
    const summary = document.getElementById("score-summary");
    const box = summary.getBoundingClientRect();
    const parts = [...summary.querySelectorAll("span")].map((span) => {
      const rect = span.getBoundingClientRect();
      return { text: span.textContent, whole: rect.right <= box.right + 1 && rect.height < 24 };
    });
    return {
      perLine: Object.values(perLine),
      width: svg.getBoundingClientRect().right,
      parts,
    };
  });
  const paired = layout.perLine.filter((count) => count >= 2).length;
  assert(
    paired >= layout.perLine.length - 2 && layout.perLine.length <= 6,
    `bars per line on a phone: ${layout.perLine}`,
  );
  assert(layout.width <= 390, `the score fits the phone (${layout.width})`);
  assert(
    layout.parts.some((part) => part.text === "2 voices") &&
      layout.parts.every((part) => part.whole),
    `the header keeps its parts whole: ${JSON.stringify(layout.parts)}`,
  );
}
{
  // 10. The phone transport: labelled icons on one row with Play, Voices in the Sound sheet,
  // and a file name field tall enough to tap.
  const transport = await small.evaluate(() => {
    const middle = (id) => {
      const box = document.getElementById(id).getBoundingClientRect();
      return box.top + box.height / 2;
    };
    return {
      oneRow: Math.abs(middle("play") - middle("sound-button")) < 8,
      labels: [
        ...document.querySelectorAll(
          "#from-caret .transport-label, #loop .transport-label, #sound-button .phone-label",
        ),
      ].map((label) => (label.checkVisibility() ? label.textContent : "")),
      size: Number.parseFloat(
        getComputedStyle(document.querySelector("#loop .transport-label")).fontSize,
      ),
      name: document.getElementById("name").getBoundingClientRect().height,
    };
  });
  assert(transport.oneRow, "Play and Sound share a row on a phone");
  // 12. Every transport button is a 44 px target on a phone.
  const small44 = await small.evaluate(() =>
    [...document.querySelectorAll("#transport button")]
      .filter((button) => button.getClientRects().length)
      .map((button) => ({ id: button.id, box: button.getBoundingClientRect() }))
      .filter(({ box }) => box.width < 44 || box.height < 44)
      .map(({ id, box }) => `${id} ${box.width}×${box.height}`),
  );
  assert.deepEqual(small44, [], "phone transport buttons are 44 px");
  // 9. Scrubbing on a phone: a large readout above the finger, snapped to bars; a 44 px ruler.
  const ruler = await small.locator("#timeline").boundingBox();
  assert(ruler.height >= 44, `ruler ${ruler.height}px tall`);
  await small.evaluate(
    ([x, y]) => {
      const target = document.getElementById("timeline");
      const fire = (type, cx) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 7,
            pointerType: "touch",
            clientX: cx,
            clientY: y,
            isPrimary: true,
          }),
        );
      fire("pointerdown", x);
      fire("pointermove", x + 40);
    },
    [ruler.x + 20, ruler.y + ruler.height / 2],
  );
  const readout = await small.evaluate(() => {
    const tip = document.getElementById("timeline-tip");
    return {
      text: tip.textContent,
      visible: !tip.hidden,
      size: Number.parseFloat(getComputedStyle(tip).fontSize),
    };
  });
  assert(readout.visible && readout.size >= 16, `scrub readout ${JSON.stringify(readout)}`);
  assert.match(readout.text, /^(Bar \d+|Pickup)( · \d\w\w time)? · \d:\d\d$/);
  await small.evaluate(() =>
    document
      .getElementById("timeline")
      .dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 7 })),
  );
  assert.deepEqual(transport.labels, ["From caret", "Loop", "Sound"]);
  assert(transport.size >= 11 && transport.size <= 12, `label size ${transport.size}`);
  assert(transport.name >= 40, `file name field ${transport.name}px tall`);
  await small.locator("#sound-button").click();
  const voices = small.getByRole("button", { name: /^Voices: mute and solo/ });
  await voices.click();
  assert(
    await small
      .getByRole("button", { name: /^Mute / })
      .first()
      .isVisible(),
    "voices from Sound",
  );
  await small.keyboard.press("Escape");
}
{
  // Sprint A fixes 10. On a phone, More › Select more makes taps add notes.
  await small.locator("#more-tools").click();
  await small
    .getByRole("menuitemcheckbox", { name: "Select more" })
    .or(small.getByRole("menuitem", { name: "Select more" }))
    .first()
    .click();
  const tapped = await small.evaluate(() => window.composer.geometry());
  const firstLine = Math.min(...tapped.notes.map((note) => note.line));
  const two = tapped.notes
    .filter((note) => note.line === firstLine && note.voice === 0)
    .sort((a, b) => a.time - b.time);
  await small.evaluate(() => window.composer.view.dispatch({ selection: { anchor: 0 } }));
  for (const note of [two[0], two[2]]) await small.mouse.click(note.head + 2, note.y);
  const picked = await small.evaluate(
    () => window.composer.view.state.selection.ranges.filter((range) => !range.empty).length,
  );
  assert.equal(picked, 2, "two taps, two notes selected");
  await small.locator("#more-tools").click();
  await small
    .getByRole("menuitemcheckbox", { name: "Select more" })
    .or(small.getByRole("menuitem", { name: "Select more" }))
    .first()
    .click();
}
console.log(
  "Composer: Frère Jacques on a phone pairs its bars; the score header wraps whole: passed",
);
console.log(
  "Composer: phone transport labels its icons on one row, voices in Sound, a 40 px file name: passed",
);
await phone.close();
console.log(
  "Composer: phone layout switches Text and Score; 40 px targets, More menu, closable tunes panel: passed",
);

/* 24. Sprint D: finding a melody, a MIDI keyboard (faked), and MIDI files. */
{
  // A Web MIDI keyboard for the page: window.__midi plays notes, the pedal, and plugs it in and out.
  const fakeMidi = () => {
    const input = {
      id: "fake-1",
      name: "Fake Keys 49",
      type: "input",
      state: "connected",
      onmidimessage: null,
    };
    const access = {
      inputs: new Map([[input.id, input]]),
      outputs: new Map(),
      sysexEnabled: false,
      onstatechange: null,
    };
    navigator.requestMIDIAccess = async (options) => {
      window.__midiAsked = options;
      return access;
    };
    const send = (bytes) => input.onmidimessage?.({ data: new Uint8Array(bytes) });
    window.__midi = {
      play: (notes) => {
        for (const note of notes) send([0x90, note, 90]);
        for (const note of notes) send([0x80, note, 0]);
      },
      pedal: () => {
        send([0xb0, 64, 127]);
        send([0xb0, 64, 0]);
      },
      unplug: () => {
        access.inputs.delete(input.id);
        input.state = "disconnected";
        access.onstatechange?.({ port: input });
      },
      plug: () => {
        access.inputs.set(input.id, input);
        input.state = "connected";
        access.onstatechange?.({ port: input });
      },
    };
  };
  const sd = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  watch(sd);
  await sd.addInitScript(fakeMidi);
  const p = await sd.newPage();
  await p.goto(url);
  await openExample("Ode to Joy", p);
  const setDoc = async (text, at) => {
    await p.evaluate(
      ([t, a]) => {
        const view = window.composer.view;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: t },
          selection: { anchor: a },
        });
      },
      [text, at],
    );
    await drawn(p);
  };

  // Melody search: the Kesh's opening, found again a tone up in a third tune.
  const book =
    "X:1\nT:The Kesh\nM:6/8\nL:1/8\nK:G\n|:G3 GAB|A3 ABd|edd gdd|edB dBA:|\n\n" +
    "X:2\nT:Drowsy Maggie\nM:4/4\nL:1/8\nK:Edor\n|:E2BE dEBE|E2BE AFDF|E2BE dEBE|BABc dAFD:|\n\n" +
    "X:3\nT:Up a tone\nM:6/8\nL:1/8\nK:A\n|:A3 ABc|B3 Bce|fee aee|fec ecB:|\n";
  await setDoc(book, 40);
  await p.locator(".cm-content").focus();
  await p.keyboard.press("Control+Shift+M");
  await p.locator("#melody-panel").waitFor();
  await p.locator("#melody-query").fill("GGGAB AAABd");
  await p.waitForFunction(() =>
    /2 matches/.test(document.querySelector(".melody-count")?.textContent ?? ""),
  );
  const rows = await p.locator(".melody-result .melody-where").allInnerTexts();
  assert.deepEqual(
    rows,
    ["The Kesh · bar 1", "Up a tone · bar 1"],
    "the melody is found as written and a tone up",
  );
  await p.locator(".melody-result").nth(1).click();
  assert.deepEqual(await selection(p), ["A3 ABc|B3 Bce"], "choosing a match selects its notes");
  await p.waitForFunction(() => document.querySelectorAll("#score .is-selected").length >= 8);
  await p.keyboard.press("F3");
  assert.deepEqual(await selection(p), ["G3 GAB|A3 ABd"], "F3 steps to the next match");
  console.log("Composer: a melody found a tone up across a 3-tune file, and selected: passed");

  // The keyboard plays a melody into the search.
  await p.locator("#melody-query").fill("");
  await p.getByRole("button", { name: "From the keyboard" }).click();
  await p.locator('#melody-panel button[aria-pressed="true"]').waitFor();
  await p.evaluate(() => {
    for (const note of [67, 67, 67, 69, 71]) window.__midi.play([note]);
  });
  await p.waitForFunction(() => document.getElementById("melody-query").value === "G G G A B");
  await p.waitForFunction(() =>
    /match/.test(document.querySelector(".melody-count")?.textContent ?? ""),
  );
  await p.getByRole("button", { name: "From the keyboard" }).click();
  await p.locator(".melody-close").click();

  // Step entry: spelled for the key and bar, chords, lengths, rests, bar lines, octave clefs.
  const steps =
    "X:1\nT:Steps\nM:4/4\nL:1/8\nK:D\n\n\nX:2\nT:Low\nM:3/4\nL:1/4\nK:F clef=treble-8\n\n";
  await setDoc(steps, "X:1\nT:Steps\nM:4/4\nL:1/8\nK:D\n".length);
  await menu("play", "MIDI keyboard…", p);
  await p.locator("#midi-panel").waitFor();
  await p.waitForFunction(() =>
    /Listening to Fake Keys 49/.test(document.querySelector(".midi-status")?.textContent ?? ""),
  );
  assert.deepEqual(
    await p.evaluate(() => window.__midiAsked),
    { sysex: false },
    "MIDI is asked for without SysEx",
  );
  await p.getByLabel("Write it at the caret (step entry)").check();
  await p.locator("#midi-panel").focus();
  const play = async (notes) => {
    await p.evaluate((list) => window.__midi.play(list), notes);
    await settle(30);
  };
  await p.keyboard.press("3");
  for (const note of [62, 66, 69, 65]) await play([note]);
  await p.keyboard.press("4");
  await play([62, 66, 69]);
  await play([70]);
  await p.evaluate(() => window.__midi.pedal());
  await p.keyboard.press("2");
  await play([74]);
  await p.keyboard.press("3");
  await p.keyboard.press(".");
  await play([76]);
  const lineOf = async (from) =>
    (await docText(p)).split("\n").find((line) => line.startsWith(from)) ?? "";
  assert.equal(
    await lineOf("DF"),
    "DF A=F [D^FA]2 ^A2 | z2 d/e3/2",
    "notes spelled for D major and the bar, a chord, lengths, a bar line, the pedal's rest",
  );
  // A flat key, on a voice an octave down (treble-8): written an octave up, so it sounds as played.
  const low = (await docText(p)).indexOf("K:F clef=treble-8\n") + "K:F clef=treble-8\n".length;
  await p.evaluate((at) => window.composer.view.dispatch({ selection: { anchor: at } }), low);
  // Dotted stays on until turned off, as in notation programs.
  assert.equal(await p.locator(".midi-dotted").getAttribute("aria-pressed"), "true");
  await p.keyboard.press(".");
  await p.keyboard.press("4");
  for (const note of [70, 71, 63]) await play([note]);
  assert.equal(await lineOf("b "), "b =b _e |", "B♭ from the key, B natural, E♭; a full bar");
  await p.locator(".cm-content").focus();
  await p.keyboard.press("Control+z");
  assert.equal(await lineOf("b "), "b =b", "undo takes back one note (and its bar line)");
  await p.keyboard.press("Control+z");
  assert.equal(await lineOf("b"), "b", "and the next undo one more");
  // Plugged out and in again.
  await p.evaluate(() => window.__midi.unplug());
  await p.waitForFunction(() =>
    /disconnected/.test(document.querySelector(".midi-status")?.textContent ?? ""),
  );
  assert.equal(await p.locator("#midi-device option").count(), 0, "no keyboard to choose");
  await p.evaluate(() => window.__midi.plug());
  await p.waitForFunction(() =>
    /Fake Keys 49 connected/.test(document.querySelector(".midi-status")?.textContent ?? ""),
  );
  console.log(
    "Composer: step entry from a MIDI keyboard spells, chords, rests, bars, octave clefs and undoes per note: passed",
  );
  await p.locator(".midi-close").click();

  // MIDI files: a song with lyrics, a bass, chords and drums.
  const vlq = (v) => {
    const out = [v & 0x7f];
    for (let r = v >> 7; r; r >>= 7) out.unshift((r & 0x7f) | 0x80);
    return out;
  };
  const utf = (text) => [...Buffer.from(text, "utf8")];
  const metaEvent = (type, data) => [0xff, type, ...vlq(data.length), ...data];
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const trackBytes = (events) => {
    const sorted = events
      .map((event, index) => ({ event, index }))
      .sort(
        (a, b) =>
          a.event[0] - b.event[0] ||
          Number(a.event[1][0] >> 4 === 9) - Number(b.event[1][0] >> 4 === 9) ||
          a.index - b.index,
      );
    const body = [];
    let tick = 0;
    for (const { event } of sorted) {
      body.push(...vlq(event[0] - tick), ...event[1]);
      tick = event[0];
    }
    body.push(0, 0xff, 0x2f, 0);
    return [...utf("MTrk"), ...u32(body.length), ...body];
  };
  const noteEvents = (channel, list) =>
    list.flatMap(([start, length, pitch]) => [
      [start * 480, [0x90 | channel, pitch, 80]],
      [(start + length) * 480, [0x80 | channel, pitch, 0]],
    ]);
  const melody = [
    [0, 1, 64],
    [1, 1, 64],
    [2, 1, 65],
    [3, 1, 67],
    [4, 1, 67],
    [5, 1, 65],
    [6, 1, 64],
    [7, 1, 62],
    [8, 1, 60],
    [9, 1, 60],
    [10, 1, 62],
    [11, 1, 64],
    [12, 1.5, 64],
    [13.5, 0.5, 62],
    [14, 2, 62],
  ];
  const words = "Here |we |go |a-|long |the |riv-|er |road |and |on |to |the |sea |now ".split("|");
  const bass = [];
  const drums = [];
  for (let bar = 0; bar < 4; bar++) {
    const root = [48, 43, 45, 43][bar];
    bass.push([bar * 4, 2, root], [bar * 4 + 2, 2, root + 7]);
    for (let beat = 0; beat < 4; beat++) drums.push([bar * 4 + beat, 0.5, beat % 2 ? 38 : 36]);
  }
  const song = Buffer.from([
    ...utf("MThd"),
    ...u32(6),
    0,
    1,
    0,
    4,
    480 >> 8,
    480 & 255,
    ...trackBytes([
      [0, metaEvent(3, utf("River Road"))],
      [0, metaEvent(0x58, [4, 2, 24, 8])],
      [0, metaEvent(0x59, [0, 0])],
      [0, metaEvent(0x51, [0x09, 0x89, 0x68])],
    ]),
    ...trackBytes([
      [0, metaEvent(3, utf("Melody"))],
      ...melody.map(([start], index) => [start * 480, metaEvent(5, utf(words[index]))]),
      ...noteEvents(0, melody),
    ]),
    ...trackBytes([[0, metaEvent(3, utf("Bass"))], [0, [0xc1, 32]], ...noteEvents(1, bass)]),
    ...trackBytes([[0, metaEvent(3, utf("Kit"))], ...noteEvents(9, drums)]),
  ]);
  await p
    .locator("#file")
    .setInputFiles({ name: "River Road.mid", mimeType: "audio/midi", buffer: song });
  await p.locator("#midi-report").waitFor({ state: "visible" });
  const report = await p.locator("#midi-report .dialog-body").innerText();
  for (const said of [
    "from MIDI: 2 parts, 2 voices, 4 bars",
    "A format 1 MIDI file: 3 tracks with notes became 2 parts.",
    "15 lyric syllables from the file are under Melody.",
    "Drums (channel 10, 16 notes) were left out",
    "1 program changes",
  ])
    assert(report.includes(said), `the import report says: ${said}`);
  await p.getByRole("button", { name: "OK" }).click();
  await p.waitForFunction(() => document.getElementById("name").value === "River Road.abc");
  await drawn(p);
  const imported = await docText(p);
  assert.match(imported, /^K:C$/m, "the key from the file");
  assert.match(imported, /^V:1 name="Melody" clef=treble$/m, "the melody's track name");
  assert.match(imported, /^V:2 name="Bass" clef=bass$/m, "the bass on a bass clef");
  assert.match(imported, /^w: ?Here we go a- \| long the riv-er/m, "lyrics under the notes");
  assert.match(
    imported,
    /^L:1\/4$[\s\S]*^E E F G \| G F E D \| C C D E \| E>D D2 \|\]$/m,
    "the melody's notes, in quarters",
  );
  // Import again with the drums, at another grid: the same draft, now with a percussion staff.
  await p
    .locator("#file")
    .setInputFiles({ name: "River Road.mid", mimeType: "audio/midi", buffer: song });
  await p.locator("#midi-report").waitFor({ state: "visible" });
  await p.locator("#midi-grid").selectOption("16");
  await p.locator("#midi-drums").selectOption("staff");
  await p.getByRole("button", { name: "Import again" }).click();
  await p.waitForFunction(() =>
    /3 parts/.test(document.querySelector("#midi-report .dialog-body p")?.textContent ?? ""),
  );
  assert.match(
    await p.locator("#midi-report .dialog-body").innerText(),
    /sixteenths \(as chosen\)/,
    "the report names the grid chosen",
  );
  await p.getByRole("button", { name: "OK" }).click();
  await drawn(p);
  assert.match(await docText(p), /^V:3 name="Kit" clef=perc$/m, "drums on a percussion staff");
  console.log(
    "Composer: a .mid opens as ABC with a report, and imports again at another grid: passed",
  );
  await sd.close();

  // Without Web MIDI, the panel says so plainly.
  const plain = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  watch(plain);
  await plain.addInitScript(() => {
    Object.defineProperty(navigator, "requestMIDIAccess", { value: undefined, configurable: true });
  });
  const q = await plain.newPage();
  await q.goto(url);
  await openExample("Ode to Joy", q);
  await menu("play", "MIDI keyboard…", q);
  await q.locator("#midi-panel").waitFor();
  assert.match(
    await q.locator("#midi-panel").innerText(),
    /MIDI keyboards need Chrome or Edge/,
    "a browser without Web MIDI is told so",
  );
  assert.equal(await q.locator("#midi-device").count(), 0, "and offered no devices");
  await plain.close();
  console.log(
    "Composer: without Web MIDI, the keyboard panel says it needs Chrome or Edge: passed",
  );
}

/* 25. Sprint D fixes, 1: key signatures, clefs and meters drawn right across the score's reflow. */
{
  const KEY_TUNES = [
    {
      name: "C to G mid-line",
      text: "X:1\nT:C to G\nM:6/8\nL:1/8\nK:C\nEFG BGE | [K:G] DEF AFD |\nEFG Bde |\ncde dBG |]\n",
      keys: [0, 1, 1, 1],
      changes: [1],
    },
    {
      name: "E minor to G",
      text: "X:1\nT:Em to G\nM:6/8\nL:1/8\nK:Em\nEFG BGE | [K:G] DEF AFD |\nEFG Bde |\ncde dBG |]\n",
      keys: [1, 1, 1, 1],
      changes: [],
    },
    {
      name: "D to F",
      text: "X:1\nT:D to F\nM:4/4\nL:1/8\nK:D\nDEFG ABcd | [K:F] FGAB cdef |\nfedc BAGF |\nFGAB cdef |]\n",
      keys: [2, 1, 1, 1],
      changes: [1],
    },
    {
      name: "a change at a line start",
      text: "X:1\nT:Line start\nM:6/8\nL:1/8\nK:C\nEFG BGE | DEF AFD |\nK:G\nEFG Bde |\ncde dBG |]\n",
      keys: [0, 0, 1, 1],
      changes: [2],
    },
    {
      name: "two voices",
      text: "X:1\nT:Two voices\nM:6/8\nL:1/8\nK:C\nV:1\nEFG BGE | [K:G] DEF AFD |\nV:2\nC3 E3 | [K:G] D3 B,3 |\nV:1\nEFG Bde | cde dBG |]\nV:2\nC3 E3 | D3 G3 |]\n",
      keys: [0, 1, 1, 1],
      changes: [1],
    },
    {
      name: "a clef in [K:]",
      text: "X:1\nT:Clef\nM:4/4\nL:1/8\nK:C\nCDEF GABc | [K:G clef=bass] G,A,B,C DEFG |\nG,A,B,C DEFG |\nG,A,B,C DEFG |]\n",
      keys: [0, 1, 1, 1],
      changes: [1],
      clef: { from: 1, name: "clefs.F" },
    },
    {
      name: "a meter change",
      text: "X:1\nT:Meter\nM:4/4\nL:1/8\nK:G\nGABc d4 | [M:3/4][L:1/4][Q:1/4=90] G A B |\nG A B |\nG A B |]\n",
      keys: [1, 1, 1, 1],
      changes: [],
      meters: [0, 1],
    },
  ];
  /** What the score draws: key signatures, clefs and time signatures by line and bar, and note accidentals. */
  const drawnMarks = (p) =>
    p.evaluate(() => {
      const at = (g) => ({
        line: Number(/abcjs-l(\d+)/.exec(g.getAttribute("class"))?.[1]),
        m: Number(/abcjs-m(\d+)/.exec(g.getAttribute("class"))?.[1]),
        mm: Number(/abcjs-mm(\d+)/.exec(g.getAttribute("class"))?.[1]),
        staff: g.closest("svg") ? 0 : 0,
        v: Number(/abcjs-v(\d+)/.exec(g.getAttribute("class"))?.[1] ?? 0),
      });
      const svg = document.querySelector("#score svg");
      return {
        keys: [...svg.querySelectorAll(".abcjs-key-signature")].map((g) => ({
          ...at(g),
          shown: [...g.querySelectorAll("path")]
            .map((path) => path.dataset.name)
            .filter((n) => n !== "accidentals.nat").length,
        })),
        clefs: [...svg.querySelectorAll(".abcjs-clef")].map((g) => ({
          ...at(g),
          name: g.querySelector("path")?.dataset.name ?? g.dataset.name,
        })),
        meters: [...svg.querySelectorAll(".abcjs-time-signature")].map((g) => at(g)),
        lines: [
          ...new Set(
            [...svg.querySelectorAll(".abcjs-staff-extra")].map(
              (g) => /abcjs-l(\d+)/.exec(g.getAttribute("class"))?.[1],
            ),
          ),
        ].length,
        noteAccidentals: svg.querySelectorAll(".abcjs-note path[data-name^='accidentals.']").length,
        lineStarts: [...svg.querySelectorAll(".abcjs-clef")]
          .filter((g) => /abcjs-m0\b/.test(g.getAttribute("class")))
          .map((g) => ({
            line: Number(/abcjs-l(\d+)/.exec(g.getAttribute("class"))[1]),
            mm: Number(/abcjs-mm(\d+)/.exec(g.getAttribute("class"))?.[1]),
          })),
      };
    });
  const checkKeys = async (p, where) => {
    for (const tune of KEY_TUNES) {
      await p.evaluate((t) => {
        const v = window.composer.view;
        v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t } });
      }, tune.text);
      await p.waitForFunction(
        (title) => document.getElementById("score-summary").textContent.startsWith(title),
        tune.text.split("\n")[1].slice(2),
      );
      await p.waitForTimeout(700);
      const drawn = await drawnMarks(p);
      const say = `${tune.name} at ${where}`;
      assert.equal(drawn.noteAccidentals, 0, `${say}: no accidental appears on a note`);
      const seen = new Set();
      for (const key of drawn.keys) {
        const spot = `${key.line}:${key.m}:${key.v}`;
        assert(
          !seen.has(spot),
          `${say}: one key signature per place (line ${key.line}, bar ${key.mm})`,
        );
        seen.add(spot);
        if (key.m === 0)
          assert.equal(
            key.shown,
            tune.keys[key.mm],
            `${say}: line ${key.line} starts in the key of bar ${key.mm + 1}`,
          );
        else {
          assert(
            tune.changes.includes(key.mm),
            `${say}: a key signature mid-line only where a change is written (bar ${key.mm + 1})`,
          );
          assert.equal(key.shown, tune.keys[key.mm], `${say}: the change shows its own signature`);
        }
      }
      // Every line that starts in a key with sharps or flats shows it.
      for (const start of drawn.lineStarts)
        if (tune.keys[start.mm])
          assert(
            drawn.keys.some((key) => key.line === start.line && key.m === 0),
            `${say}: line ${start.line} shows its key`,
          );
      if (tune.clef)
        for (const clef of drawn.clefs) {
          if (clef.m === 0)
            assert.equal(
              clef.name,
              clef.mm >= tune.clef.from ? tune.clef.name : "clefs.G",
              `${say}: line ${clef.line} starts in its clef`,
            );
          else
            assert.equal(
              clef.mm,
              tune.clef.from,
              `${say}: the clef change is drawn once, where it is written`,
            );
        }
      if (tune.meters)
        assert.deepEqual(
          drawn.meters.map((m) => m.mm),
          tune.meters,
          `${say}: time signatures only where written`,
        );
    }
  };
  const wide = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  watch(wide);
  const w = await wide.newPage();
  await w.goto(url);
  await openExample("Ode to Joy", w);
  await checkKeys(w, "1440 beside");
  await w.keyboard.press("Control+Backslash");
  await w.waitForFunction(() => document.getElementById("workspace")?.dataset.layout === "below");
  await checkKeys(w, "1440 below");
  await wide.close();
  const narrow = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  watch(narrow);
  const n = await narrow.newPage();
  await n.goto(url);
  await n.getByRole("button", { name: "Ode to Joy" }).click();
  await drawn(n);
  await n.locator("#show-score").click();
  await checkKeys(n, "390");
  await narrow.close();
  console.log(
    "Composer: key changes, clefs and meters are drawn once, and every line starts in its key, at 1440 beside, below and 390: passed",
  );
}

/* 26. Sprint D fixes, 6–13: the start screen, step entry's caret, docked panels, melody search. */
{
  const overlaps = (a, b) =>
    a &&
    b &&
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height;
  const fresh = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  watch(fresh);
  await fresh.addInitScript(() => {
    const input = {
      id: "k",
      name: "Fake Keys 49",
      type: "input",
      state: "connected",
      onmidimessage: null,
    };
    const access = { inputs: new Map([["k", input]]), outputs: new Map(), onstatechange: null };
    navigator.requestMIDIAccess = async () => access;
    const send = (bytes) => input.onmidimessage?.({ data: new Uint8Array(bytes) });
    window.__midi = {
      play: (notes) => {
        for (const note of notes) send([0x90, note, 90]);
        for (const note of notes) send([0x80, note, 0]);
      },
      unplug: () => {
        access.inputs.delete("k");
        input.state = "disconnected";
        access.onstatechange?.({ port: input });
      },
      plug: () => {
        access.inputs.set("k", input);
        input.state = "connected";
        access.onstatechange?.({ port: input });
      },
    };
  });
  const p = await fresh.newPage();
  await p.goto(url);
  // 6. The start screen: Tab never reaches the editor behind it, and typing changes nothing.
  await p.getByRole("heading", { name: /Write music/ }).waitFor();
  assert.equal(
    await p.locator("#writing").getAttribute("inert"),
    "",
    "the text is inert under the start screen",
  );
  assert.equal(
    await p.locator("#writing").getAttribute("aria-hidden"),
    "true",
    "and hidden from screen readers",
  );
  const startText = await docText(p);
  for (let index = 0; index < 40; index++) {
    await p.keyboard.press("Tab");
    assert(
      !(await p.evaluate(() =>
        Boolean(document.activeElement?.closest("#writing, #score-panel, #rail")),
      )),
      "Tab never lands in the hidden editor, score or tunes panel",
    );
  }
  await p.keyboard.type("abc");
  assert.equal(await docText(p), startText, "typing on the start screen edits nothing");
  await openExample("Ode to Joy", p);
  assert.equal(
    await p.locator("#writing").getAttribute("inert"),
    null,
    "the text is back in reach",
  );
  assert.equal(await p.locator("#writing").getAttribute("aria-hidden"), null);
  console.log("Composer: the start screen keeps Tab and typing out of the hidden editor: passed");

  // 7 and 10. Step entry: a steady caret and a pill; closing goes back to Hear it.
  const steps = "X:1\nT:Steps\nM:3/4\nL:1/4\nK:D\n";
  await p.evaluate((t) => {
    const view = window.composer.view;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: `${t}\n` },
      selection: { anchor: t.length },
    });
  }, steps);
  await drawn(p);
  await menu("play", "MIDI keyboard…", p);
  await p.locator("#midi-panel").waitFor();
  assert.equal(await p.locator("#step-pill").count(), 0, "no pill before step entry");
  await p.getByLabel("Write it at the caret (step entry)").check();
  await p.locator("#midi-panel").focus();
  await p.keyboard.press("5");
  for (const note of [62, 66]) {
    await p.evaluate((n) => window.__midi.play([n]), note);
    await settle(40);
  }
  assert.equal(
    (await docText(p)).split("\n")[5],
    "D2 F- | F",
    "a half note over the bar line is tied, and the count goes on",
  );
  const caret = await p.locator(".cm-step-caret").boundingBox();
  assert(caret && caret.height > 10, "a caret marks where the next note goes");
  const lastNote = await p.evaluate(() => {
    const view = window.composer.view;
    const rect = view.coordsAtPos(view.state.selection.main.head);
    return rect ? { x: rect.left, y: rect.top } : null;
  });
  assert(
    Math.abs(caret.x - lastNote.x) < 4 && Math.abs(caret.y - lastNote.y) < 6,
    "at the caret's place",
  );
  assert(await p.locator("#step-pill").isVisible(), "a Step entry pill in the status line");
  // The score shows the caret's note once it has redrawn.
  await p.waitForFunction(() => document.querySelectorAll("#score .is-caret").length > 0);
  // Docked: the panel covers neither the text nor the score.
  const panelBox = await p.locator("#midi-panel").boundingBox();
  assert(
    !overlaps(panelBox, await p.locator("#writing").boundingBox()),
    "the keyboard panel leaves the text clear",
  );
  assert(!overlaps(panelBox, await p.locator("#score-panel").boundingBox()), "and the score");
  // No keyboard: only the message and Retry.
  await p.evaluate(() => window.__midi.unplug());
  await p.locator(".midi-empty").waitFor();
  assert(await p.getByRole("button", { name: "Retry" }).isVisible(), "Retry is offered");
  assert(!(await p.locator(".midi-body").isVisible()), "and nothing else");
  await p.evaluate(() => window.__midi.plug());
  await p.locator(".midi-body").waitFor();
  await p.locator(".midi-close").click();
  assert.equal(await p.locator("#step-pill").count(), 0, "closing the panel ends step entry");
  assert.equal(await p.locator(".cm-step-caret").count(), 0, "and its caret");
  await menu("play", "MIDI keyboard…", p);
  assert(await p.getByLabel("Hear it").isChecked(), "it opens again in Hear it");
  await p.locator(".midi-close").click();
  console.log(
    "Composer: step entry shows its caret and a pill, ties over bar lines, and ends when closed: passed",
  );

  // 8 and 9. Find melody, docked: never over the text or the lit match; ranked and complete.
  const book =
    "X:1\nT:The Kesh\nM:6/8\nL:1/8\nK:G\n|:G3 GAB|A3 ABd|edd gdd|edB dBA:|\n\n" +
    "X:2\nT:Scale\nM:4/4\nL:1/4\nK:C\nV:1\nC D E F | G A B c |\nV:2\nC D E F | G A B c |\n\n" +
    "X:3\nT:Up a tone\nM:6/8\nL:1/8\nK:A\n|:A3 ABc|B3 Bce|fee aee|fec ecB:|\n";
  await p.evaluate((t) => {
    const view = window.composer.view;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: t },
      selection: { anchor: 40 },
    });
  }, book);
  await drawn(p);
  await p.locator(".cm-content").focus();
  await p.keyboard.press("Control+Shift+M");
  await p.locator("#melody-query").fill("G3 GAB A3 ABd");
  await p.waitForFunction(() =>
    /2 matches/.test(document.querySelector(".melody-count")?.textContent ?? ""),
  );
  await p.locator(".melody-result").nth(1).click();
  await p.waitForFunction(() => document.querySelectorAll("#score .is-selected").length >= 8);
  const melodyBox = await p.locator("#melody-panel").boundingBox();
  const lit = await p.evaluate(() =>
    [...document.querySelectorAll("#score .is-selected")].map((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }),
  );
  assert(
    lit.every((box) => !overlaps(melodyBox, box)),
    "the panel never covers the lit match in the score",
  );
  const frame = await p.locator("#score-panel").boundingBox();
  assert(
    lit.every((box) => box.y >= frame.y && box.y + box.height <= frame.y + frame.height),
    "the match is in view",
  );
  const marked = await p.evaluate(() =>
    [...document.querySelectorAll(".cm-selectionBackground")].map((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }),
  );
  assert(
    marked.length && marked.every((box) => !overlaps(melodyBox, box)),
    "nor the match in the text",
  );
  // Overlapping matches, unnamed voices, and the hint as the options change.
  await p.locator("#melody-mode").selectOption("contour");
  await p.locator("#melody-query").fill("C D E");
  await p.waitForFunction(() =>
    /18 matches/.test(document.querySelector(".melody-count")?.textContent ?? ""),
  );
  const where = await p.locator(".melody-result .melody-where").allInnerTexts();
  // Each voice of the scale goes up twice running six times over: every one is found.
  assert.equal(
    where.filter((each) => each.startsWith("Scale · V:1")).length,
    6,
    "overlapping matches",
  );
  assert.equal(where.filter((each) => each.startsWith("Scale · V:2")).length, 6, "in each voice");
  assert(where.includes("Scale · V:2 · bar 1"), "a voice with no name is called V:2");
  assert.match(await p.locator("#melody-reading").innerText(), /only the ups and downs count\.$/);
  await p.locator("#melody-mode").selectOption("intervals");
  await p.locator("#melody-rhythm").check();
  await p.waitForFunction(() =>
    /same relative lengths/.test(document.getElementById("melody-reading")?.textContent ?? ""),
  );
  await p.locator("#melody-rhythm").uncheck();
  // Matches that needed repeated notes folded say so (the Kesh has two G's, the query three);
  // the query is read in the key of the tune the caret is in: the Kesh's G major.
  await p.evaluate(() => window.composer.view.dispatch({ selection: { anchor: 40 } }));
  await p.locator("#melody-query").fill("GGGAB AAABd");
  await p.waitForFunction(() => {
    const rows = [...document.querySelectorAll(".melody-where")].map((row) => row.textContent);
    return rows.length === 2 && rows[0].startsWith("The Kesh");
  });
  assert.equal(
    await p.locator(".melody-folded").count(),
    2,
    "matches that needed repeats folded say so",
  );
  // Tab stays in the panel; Escape closes it and gives focus back to the text.
  await p.locator("#melody-query").focus();
  for (let index = 0; index < 30; index++) {
    await p.keyboard.press("Tab");
    assert(
      await p.evaluate(() =>
        document.getElementById("melody-panel").contains(document.activeElement),
      ),
      "Tab stays in the panel",
    );
  }
  await p.keyboard.press("Escape");
  assert.equal(await p.locator("#melody-panel").count(), 0, "Escape closes it");
  assert(
    await p.evaluate(() => Boolean(document.activeElement?.closest(".cm-editor"))),
    "focus is back in the text",
  );
  await fresh.close();

  // On a phone: a chosen result folds the panel to one line, and the match is in view above it.
  const pocket = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  watch(pocket);
  const q = await pocket.newPage();
  await q.goto(url);
  await q.getByRole("button", { name: "Ode to Joy" }).click();
  await drawn(q);
  await q.evaluate((t) => {
    const view = window.composer.view;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: t },
      selection: { anchor: 40 },
    });
  }, book);
  await drawn(q);
  await q.locator("#show-score").click();
  await q.locator('[data-menu="edit"]').click();
  await q.getByRole("menuitem", { name: "Find melody…" }).click();
  await q.locator("#melody-query").fill("G3 GAB A3 ABd");
  await q.waitForFunction(() => document.querySelectorAll(".melody-result").length === 2);
  await q.locator(".melody-result").nth(1).click();
  await q.locator(".melody-bar").waitFor();
  assert.equal(
    await q.locator(".melody-bar-count").innerText(),
    "2 of 2",
    "one line: where we are",
  );
  const bar = await q.locator("#melody-panel").boundingBox();
  assert(bar.height <= 60, `the panel folds to one line (${bar.height} px)`);
  await q.waitForFunction(() => document.querySelectorAll("#score .is-selected").length >= 8);
  const shown = await q.evaluate(() =>
    [...document.querySelectorAll("#score .is-selected")].map(
      (element) => element.getBoundingClientRect().bottom,
    ),
  );
  assert(shown.length && shown.every((bottom) => bottom < bar.y), "the match shows above it");
  await q.getByRole("button", { name: "Next match" }).click();
  assert.equal(await q.locator(".melody-bar-count").innerText(), "1 of 2", "› steps to the next");
  await q.locator(".melody-bar").getByRole("button", { name: "Close" }).click();
  // 13. The status line folds away on a phone (about 40 px back), stays folded, and comes back.
  await q.evaluate(() => window.composer.view.dispatch({ selection: { anchor: 33 } }));
  await settle(300);
  const lineHeight = (await q.locator("#app > footer").boundingBox()).height;
  const transportTop = async () => (await q.locator("#transport").boundingBox()).y;
  const transportBefore = await transportTop();
  await q.locator("#explain-toggle").click();
  assert(!(await q.locator("#app > footer").isVisible()), "folded, the status line is gone");
  const gained = (await transportTop()) - transportBefore;
  assert(
    gained >= Math.min(lineHeight, 36) - 1,
    `folding gives ${gained} px back (the line was ${lineHeight} px)`,
  );
  console.log(`Composer: folding the status line on a phone gives ${gained} px back`);
  await q.reload();
  await drawn(q);
  assert(!(await q.locator("#app > footer").isVisible()), "folded after a reload");
  await q.locator("#more-menus").click();
  await q.locator(".workspace-dropdown").getByRole("menuitem", { name: "View" }).click();
  await q.getByRole("menuitemcheckbox", { name: "Status line" }).click();
  assert(await q.locator("#app > footer").isVisible(), "View › Status line brings it back");
  await pocket.close();
  console.log(
    "Composer: Find melody docked clear of the match, overlapping, ranked, trapped focus; a one-line bar and a folding status line on a phone: passed",
  );
}

/* 27. Sprint D fixes, 14 and 15: a note never gets two staccatos; Shift+click takes the note. */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  watch(ctx);
  const p = await ctx.newPage();
  await p.goto(url);
  await openExample("Twinkle, Twinkle, Little Star", p);
  await p.waitForTimeout(400);
  // 15. Shift+click takes the note clicked: on its head, its stem, or the middle of its box.
  const notes = p.locator("#score .abcjs-note");
  const at = (index, where) =>
    notes.nth(index).evaluate((element, spot) => {
      const box = element.getBoundingClientRect();
      const head = element.querySelector("path").getBoundingClientRect();
      if (spot === "head") return { x: head.x + head.width / 2, y: head.y + head.height / 2 };
      if (spot === "stem") return { x: head.x + head.width - 1, y: head.y - 18 };
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }, where);
  const shiftClick = async (point) => {
    await p.keyboard.down("Shift");
    await p.mouse.click(point.x, point.y);
    await p.keyboard.up("Shift");
  };
  for (const where of ["head", "stem", "middle"]) {
    const first = await at(0, "head");
    await p.mouse.click(first.x, first.y);
    await shiftClick(await at(3, where));
    assert.deepEqual(
      await selection(p),
      ['"C"C C | G G'],
      `Shift+click on the 4th note's ${where} takes it`,
    );
    await p.waitForFunction(() =>
      document.getElementById("explain").textContent.startsWith("4 notes selected"),
    );
    // And back the other way.
    const fourth = await at(3, "head");
    await p.mouse.click(fourth.x, fourth.y);
    await shiftClick(await at(0, where));
    assert.deepEqual(await selection(p), ['"C"C C | G G'], `and back to the 1st note's ${where}`);
  }
  console.log(
    "Composer: Shift+click in the score takes the note clicked, head, stem or middle: passed",
  );

  // 14. Typing . over a mixed selection: added where missing, then removed from all; never twice.
  const music = '.C "Am".D E !staccato!F | . G A B c |';
  const marked = '.C "Am".D .E !staccato!F | . G .A .B .c |';
  const bare = 'C "Am"D E F |  G A B c |';
  const head = "X:1\nT:Marks\nM:4/4\nL:1/4\nK:C\n";
  const line = async () => (await docText(p)).split("\n")[5];
  const selectLine = () =>
    p.evaluate((from) => {
      const view = window.composer.view;
      view.dispatch({ selection: { anchor: from, head: view.state.doc.line(6).to } });
    }, head.length);
  await p.evaluate((t) => {
    const view = window.composer.view;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t } });
  }, `${head}${music}\n`);
  await drawn(p);
  await selectLine();
  await p.locator(".cm-content").focus();
  await p.keyboard.press(".");
  assert.equal(await line(), marked, "the text: staccato added only where missing");
  await p.keyboard.press(".");
  assert.equal(await line(), bare, "and removed from all the second time");
  // A held key acts once.
  await p.evaluate((t) => {
    const view = window.composer.view;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t } });
  }, `${head}${music}\n`);
  await selectLine();
  await p.keyboard.down(".");
  await p.keyboard.down(".");
  await p.keyboard.down(".");
  await p.keyboard.up(".");
  assert.equal(await line(), marked, "a held . marks once");
  // The score: the same, from notes selected there.
  await p.evaluate((t) => {
    const view = window.composer.view;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t } });
  }, `${head}${music}\n`);
  await drawn(p);
  await p.waitForTimeout(400);
  const firstNote = await at(0, "head");
  const lastNote = await at(7, "head");
  await p.mouse.click(firstNote.x, firstNote.y);
  await shiftClick(lastNote);
  await p.keyboard.press(".");
  assert.equal(await line(), marked, "the score: staccato added only where missing");
  await p.keyboard.press(".");
  assert.equal(await line(), bare, "and removed from all the second time");
  // The decoration menu keeps to the same rule.
  await p.evaluate((t) => {
    const view = window.composer.view;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t } });
  }, `${head}${music}\n`);
  await selectLine();
  await p.locator('[data-command="decoration"]').click();
  await p.getByRole("menuitem", { name: /^Staccato/ }).click();
  assert.equal(await line(), marked, "Staccato from the menu adds only where missing");
  await ctx.close();
  console.log(
    "Composer: . over a mixed selection, in the text, the score and the menu, adds once then removes; never two staccatos: passed",
  );
}

/* 28. Selection sweep: drags between many note pairs in tunes with several voices, lyrics and
   comments, each checked against what any selection must be. */
{
  const tunes = {
    "two voices on one staff":
      "X:1\nT:Two on one\nM:4/4\nL:1/8\n%%score (1 2)\nK:C\nV:1\ncdef gabc'|c'bag fedc|cegc' e'c'ge|c8|\nV:2\nC4 E4|G,8|C2E2 G2c2|C8|\n",
    "inline voices":
      "X:1\nT:Inline switches\nM:3/4\nL:1/4\n%%score (1 2)\nK:G\n[V:1] B c d|[V:2] G,2 D|[V:1] e d c|[V:2] C2 E|\n[V:1] B A G|[V:2] D3|[V:1] A3|[V:2] D,3|\n",
    "interleaved blocks":
      "X:1\nT:Interleaved blocks\nM:4/4\nL:1/8\n%%score {(1 2) | 3}\nK:C\nV:1\nc2 d2 e2 f2|g4 e4|\nV:2\nE4 G4|c4 G4|\nV:3 clef=bass\nC,8|G,,8|\nV:1\na2 g2 f2 e2|d8|\nV:2\nF4 E4|D8|\nV:3\nF,,8|G,,8|\nV:1\ne2 d2 c2 B2|c8|]\nV:2\nG4 F4|E8|]\nV:3\nG,,8|C,8|]\n",
    "lyrics, comments and parts":
      "X:1\nT:Words between\nM:4/4\nL:1/8\nK:D\nP:A\n|:dfaf gfed|cdeg fedc:|\nw: one two three four five six sev-en eight\n% a comment between the lines\nP:B\n|:d2fd ad fd|e2ge be ge:|\nw: nine ten e-le-ven twelve\n%%vskip 6\nK:G\nG2 AB c2 BA|G8|]\n",
    "a grand staff with a spacer voice (as the Moonlight sonata imports)":
      'X:1\nT:Grand staff excerpt\nM:4/4\nL:1/8\n%%score {1 (2 3 4)}\nV:1 name="Piano" clef=treble\nV:2 clef=bass\nV:3 clef=bass\nV:4 clef=bass\nK:E\nV:1\n(3G,CE (3G,CE (3G,CE (3G,CE | (3G,CE (3G,CE (3A,CE (3A,CE | z4 z2 !pp!G>G | G6 G>G |\nV:2\nx8 | x8 | ((3E,G,C) ((3G,CE) (3G,CE (3G,CE | (3G,DF (3G,DF (3G,DF (3G,DF |\nV:3\n[C,,C,]8 | [B,,,B,,]4 [A,,,A,,]4 | [C,,G,,C,]8 | [^B,,,G,,^B,,]8 |\nV:4\nx8 | x8 | x8 | x8 |\nV:1\n(G4 A4 | G4 F2 B2) | E2 z2 z4 |]\nV:2\n(3G,CE (3G,CE (3A,CF (3A,CF | (3G,B,E (3G,B,E (3A,B,D (3A,B,D | (3G,B,E (3G,B,E (3G,B,E (3G,B,E |]\nV:3\n([C,,C,]4 [F,,,F,,]4) | [B,,,B,,]4 [B,,,B,,]4 | [E,,E,]8 |]\nV:4\nx8 | x8 | x8 |]\n',
    "a multi-bar rest in one voice":
      "X:1\nT:Waiting\nM:4/4\nL:1/4\n%%score 1 2\nK:C\nV:1\nZ4|c d e f|g4|]\nV:2\nC D E F|G A B c|c B A G|F E D C|E4|D4|]\n",
  };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  watch(ctx);
  const p = await ctx.newPage();
  await p.goto(url);
  await openExample("Ode to Joy", p);
  let total = 0;
  let backward = 0;
  let mirrored = 0;
  for (const [name, tune] of Object.entries(tunes)) {
    await p.evaluate((t) => {
      window.__before = window.composer.scoreIndex();
      const view = window.composer.view;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: t },
        selection: { anchor: 0 },
      });
    }, tune);
    await p.waitForFunction(() => window.composer.scoreIndex() !== window.__before);
    await p.waitForTimeout(500);
    const geometry = await p.evaluate(() => window.composer.geometry());
    const index = await p.evaluate(() =>
      window.composer.scoreIndex().notes.map((note) => ({
        start: note.start,
        end: note.end,
        voice: note.voice,
        staff: note.staff,
        drawn: note.elements.length > 0,
      })),
    );
    const frame = await p.locator("#score-scroll").boundingBox();
    const inView = (y) => y > frame.y + 50 && y < frame.y + frame.height - 50;
    const heads = geometry.notes.filter((box) => inView(box.y));
    const staffOf = (box) =>
      geometry.staves.find((staff) => staff.line === box.line && staff.staff === box.staff);
    // Targets: on each head, just before it, and either side of each bar line.
    const targets = [];
    for (const box of heads) {
      const staff = staffOf(box);
      const y = (staff.top + staff.bottom) / 2;
      targets.push({ x: box.head + 2, y, line: box.line, staff: box.staff });
      targets.push({ x: box.head - 3, y, line: box.line, staff: box.staff });
    }
    for (const bar of geometry.bars)
      for (const staff of geometry.staves.filter((each) => each.line === bar.line)) {
        const y = (staff.top + staff.bottom) / 2;
        if (!inView(y)) continue;
        targets.push({ x: bar.x - 4, y, line: bar.line, staff: staff.staff });
        targets.push({ x: bar.x + 4, y, line: bar.line, staff: staff.staff });
      }
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const anchors = heads.filter((_, at) => at % Math.max(1, Math.ceil(heads.length / 8)) === 0);
    const text = tune;
    for (const anchorBox of anchors) {
      // Pressed on the note itself: its head, at its height (mid-staff is ambiguous between two
      // voices sharing the staff).
      const from = { x: anchorBox.head + 3, y: anchorBox.y };
      for (const target of targets.filter(() => random() < 5 / targets.length)) {
        if (Math.hypot(target.x - from.x, target.y - from.y) < 8) continue;
        await p.evaluate(() => window.composer.view.dispatch({ selection: { anchor: 0 } }));
        await p.mouse.move(from.x, from.y);
        await p.mouse.down();
        await p.mouse.move(target.x, target.y, { steps: 3 });
        await p.mouse.up();
        total += 1;
        const { selected, lit } = await p.evaluate(() => {
          const view = window.composer.view;
          return {
            selected: view.state.selection.ranges
              .filter((range) => range.to > range.from)
              .map((range) => ({ from: range.from, to: range.to })),
            lit: window.composer
              .scoreIndex()
              .notes.filter((note) =>
                note.elements.some((each) => each.classList.contains("is-selected")),
              )
              .map((note) => note.start),
          };
        });
        const say = `${name}: a drag from ${anchorBox.start} to (${Math.round(target.x)}, ${Math.round(target.y)})`;
        const chosen = index.filter((note) =>
          selected.some((range) => note.start < range.to && note.end > range.from),
        );
        // The notes lit are the notes selected in the text.
        assert.deepEqual(
          [...lit].sort((a, b) => a - b),
          chosen
            .filter((note) => note.drawn)
            .map((note) => note.start)
            .sort((a, b) => a - b),
          `${say}: the notes lit are the notes selected`,
        );
        for (const range of selected) {
          const inside = index.filter((note) => note.start < range.to && note.end > range.from);
          assert(
            new Set(inside.map((note) => note.voice)).size <= 1,
            `${say}: one voice per range`,
          );
          const lines = text.slice(range.from, range.to).split("\n").slice(1);
          for (const line of lines)
            assert(
              !/^\s*(?:[A-Za-z]:|%|$)/.test(line),
              `${say}: no header, V:, w:, %% or comment line inside a range ("${line}")`,
            );
          assert(
            !/\[V:/.test(text.slice(range.from, range.to)),
            `${say}: no voice change inside a range`,
          );
        }
        // Nothing past the pointer's reach, nothing before the drag's start; nothing skipped.
        // (On or back, as the score decides: left of its own head, the drag goes back.)
        const lineHeads = geometry.notes.filter((box) => box.line === target.line);
        const firstX = Math.min(...lineHeads.map((box) => box.head));
        const reachX = Math.max(target.x, firstX);
        const forward =
          target.line > anchorBox.line ||
          (target.line === anchorBox.line && reachX >= anchorBox.head);
        const upTo = (box) =>
          box.line < target.line || (box.line === target.line && box.head <= reachX + 1);
        const fromOn = (box) =>
          box.line > anchorBox.line ||
          (box.line === anchorBox.line && box.head >= anchorBox.head - 7);
        if (forward)
          for (const note of chosen) {
            const box = geometry.notes.find(
              (each) => each.start === note.start && each.voice === note.voice,
            );
            if (!box) continue;
            assert(
              upTo(box),
              `${say}: takes only what the pointer reached (note at ${note.start})`,
            );
            assert(
              fromOn(box),
              `${say}: takes nothing before the drag's start (note at ${note.start})`,
            );
          }
        const voices = new Set(
          target.staff === anchorBox.staff
            ? index
                .filter((note) => note.staff === anchorBox.staff && note.drawn)
                .map((note) => note.voice)
            : index.filter((note) => note.drawn).map((note) => note.voice),
        );
        if (forward)
          for (const box of geometry.notes)
            if (
              voices.has(box.voice) &&
              fromOn({ ...box, head: box.head - 8 }) &&
              (box.line < target.line || (box.line === target.line && box.head <= reachX - 8))
            )
              assert(
                chosen.some((note) => note.start === box.start),
                `${say}: takes every note dragged over (missed the note at ${box.start})`,
              );
        if (!forward) {
          backward += 1;
          // Dragging back mirrors dragging on: from the first head the pointer is on or left of
          // (a head is 10 px wide) to the drag's start, every voice dragged over.
          const lowX = target.x - 10;
          const fromPointer = (box) =>
            box.line > target.line || (box.line === target.line && box.head >= lowX - 1);
          const toAnchor = (box) =>
            box.line < anchorBox.line ||
            (box.line === anchorBox.line && box.head <= Math.max(from.x, anchorBox.head) + 1);
          for (const note of chosen) {
            const box = geometry.notes.find(
              (each) => each.start === note.start && each.voice === note.voice,
            );
            if (!box) continue;
            assert(
              fromPointer(box),
              `${say}: dragging back takes nothing the pointer hasn't reached (note at ${note.start})`,
            );
            assert(toAnchor(box), `${say}: dragging back takes nothing past its start`);
          }
          for (const box of geometry.notes)
            if (
              voices.has(box.voice) &&
              (box.line > target.line || (box.line === target.line && box.head >= lowX + 8)) &&
              (box.line < anchorBox.line ||
                (box.line === anchorBox.line && box.head <= anchorBox.head - 8))
            )
              assert(
                chosen.some((note) => note.start === box.start),
                `${say}: dragging back takes every note dragged over (missed the note at ${box.start})`,
              );
        }
      }
      // Symmetry: back from this head to an earlier one selects what on from that one to this does.
      const earlier = heads.filter(
        (box) =>
          box !== anchorBox &&
          (box.line < anchorBox.line ||
            (box.line === anchorBox.line && box.head < anchorBox.head - 12)),
      );
      for (const other of earlier.filter(() => random() < 2 / Math.max(1, earlier.length))) {
        const drag = async (a, b) => {
          await p.evaluate(() => window.composer.view.dispatch({ selection: { anchor: 0 } }));
          await p.mouse.move(a.x, a.y);
          await p.mouse.down();
          await p.mouse.move(b.x, b.y, { steps: 3 });
          await p.mouse.up();
          return p.evaluate(() =>
            window.composer.view.state.selection.ranges
              .filter((range) => range.to > range.from)
              .map((range) => `${range.from}-${range.to}`)
              .sort(),
          );
        };
        // Where the two heads are drawn now (a late redraw under load moves them).
        const now = await p.evaluate(() => window.composer.geometry());
        const find = (box) =>
          now.notes.find((each) => each.start === box.start && each.voice === box.voice) ?? box;
        const [fromBox, toBox] = [find(anchorBox), find(other)];
        const here = { x: fromBox.head + 4, y: fromBox.y };
        const there = { x: toBox.head + 4, y: toBox.y };
        assert.deepEqual(
          await drag(here, there),
          await drag(there, here),
          `${name}: a drag back from ${anchorBox.start} to ${other.start} selects what a drag on from ${other.start} to ${anchorBox.start} does`,
        );
        mirrored += 1;
      }
    }
  }
  await ctx.close();
  console.log(
    `Composer: ${total} drags (${backward} of them back, and ${mirrored} pairs dragged both ways alike) across 6 tunes (voices on one staff, inline and interleaved voices, lyrics, comments, parts, a grand staff with a spacer voice, a multi-bar rest) select only music, voice by voice, as far as the pointer reached: passed`,
  );
}

/* 29. Selection hardening, round 1: each finding, as the reviewers found it. */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  watch(ctx);
  const p = await ctx.newPage();
  await p.goto(url);
  await openExample("Ode to Joy", p);
  // Puts a tune in and waits until the score drawn is that tune.
  const put = async (t) => {
    await p.evaluate((x) => {
      const view = window.composer.view;
      if (view.state.doc.toString() !== x)
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: x } });
      view.dispatch({ selection: { anchor: 0 } });
    }, t);
    await p.waitForFunction((x) => window.composer.scoreIndex()?.source === x, t);
    await p.waitForTimeout(400);
    return p.evaluate(() => window.composer.geometry());
  };
  const pull = async (a, b, steps = 6) => {
    await p.mouse.move(a.x, a.y);
    await p.mouse.down();
    await p.mouse.move(b.x, b.y, { steps });
    await p.mouse.up();
  };
  const texts = async () => (await selection(p)).filter((each) => each.length > 0);
  // 1. A drag across a part's P: line takes only music; ., Ctrl/⌘ X and Backspace leave P:B.
  const reel =
    "X:1\nT:Reel with parts\nM:4/4\nL:1/8\nK:D\nP:A\n|:dfaf gfed|cdeg fedc:|\nP:B\n|:d2fd ad fd|e2ge be ge:|\n";
  let geo = await put(reel);
  const systems = [...new Set(geo.notes.map((box) => box.line))];
  const on = (line) => geo.notes.filter((box) => box.line === line).sort((a, b) => a.head - b.head);
  const sixth = on(systems[0])[5];
  const third = on(systems.at(-1))[2];
  const span = [
    { x: sixth.head + 3, y: sixth.y },
    { x: third.head + 3, y: third.y },
  ];
  await pull(...span);
  assert.deepEqual(
    await texts(),
    ["fed|cdeg fedc", "d2fd"],
    "a drag stops at P:B and goes on after",
  );
  await p.keyboard.press(".");
  assert.equal(
    (await docText(p)).split("\n").slice(6, 9).join("\n"),
    "|:dfaf g.f.e.d|.c.d.e.g .f.e.d.c:|\nP:B\n|:.d2.f.d ad fd|e2ge be ge:|",
    "a mark typed in the score marks the notes, P:B as it was",
  );
  await p.keyboard.press("Control+z");
  // Ctrl/⌘ X and Delete in the score take the whole bar out (the repeat's end kept), and the
  // part of a bar only its notes; Delete and Backspace in the text (after Enter) keep every bar
  // line, an emptied bar kept apart from the next bar line. P:B stays either way.
  // Round 6: the part of a bar taken (fed, d2fd) leaves rests, so every bar keeps its length;
  // the whole bar (cdeg fedc) goes, its repeat's end kept.
  for (const [keys, left] of [
    // (The rests by the beat: an eighth to finish beat 3, a quarter for beat 4; round 8.)
    [["Control+x"], "|:dfaf gz z2:|"],
    [["Delete"], "|:dfaf gz z2:|"],
    // Round 5: the text's Delete and Backspace are the score's Delete (one plan).
    [["Enter", "Delete"], "|:dfaf gz z2:|"],
    [["Enter", "Backspace"], "|:dfaf gz z2:|"],
  ]) {
    await put(reel);
    await pull(...span);
    for (const key of keys) await p.keyboard.press(key);
    assert.equal(
      await docText(p),
      `X:1\nT:Reel with parts\nM:4/4\nL:1/8\nK:D\nP:A\n${left}\nP:B\n|:z4 ad fd|e2ge be ge:|\n`,
      `${keys.join(" then ")} on a score selection deletes its music and leaves P:B`,
    );
  }
  // Codex's case: lyrics and a comment between two lines of music, deleted with Backspace.
  const words =
    "X:1\nT:Words\nM:4/4\nL:1/4\nK:C\nC D E F |\nw: one two three four\n% important comment\nG A B c |\nw: five six se-ven eight\n";
  geo = await put(words);
  const all = geo.notes.sort((a, b) => a.line - b.line || a.head - b.head);
  await pull({ x: all[0].head + 3, y: all[0].y }, { x: all.at(-1).head + 3, y: all.at(-1).y });
  assert.deepEqual(
    await texts(),
    ["C D E F", "G A B c"],
    "the lyric and comment lines aren't taken",
  );
  await p.keyboard.press("Enter");
  await p.keyboard.press("Backspace");
  assert.equal(
    await docText(p),
    // Round 5: Backspace is the score's Delete: the music's lines go, with the w: lines under
    // them (their syllables were those notes'); the comment stays.
    "X:1\nT:Words\nM:4/4\nL:1/4\nK:C\n% important comment\n",
    "Backspace deletes the music, not the words, the comment or the bar lines",
  );
  // Ctrl/⌘ A in the score: every voice's music, no header.
  await put(reel);
  await p.locator("#score-scroll").focus();
  await p.keyboard.press("Control+a");
  assert.deepEqual(
    await texts(),
    ["dfaf gfed|cdeg fedc", "d2fd ad fd|e2ge be ge"],
    "Ctrl A in the score takes the music only",
  );
  // A selection made in the text across P:B: . marks the notes and leaves P:B.
  await p.evaluate(() => {
    const view = window.composer.view;
    const doc = view.state.doc.toString();
    view.dispatch({ selection: { anchor: doc.indexOf("gfed"), head: doc.indexOf("d2fd") + 4 } });
  });
  await p.locator(".cm-content").focus();
  await p.keyboard.press(".");
  assert.match(
    await docText(p),
    /\nP:B\n\|:\.d2\.f\.d ad fd/,
    "typed in the text, . marks the notes too",
  );
  // 2. A multi-bar rest: a drag takes what the pointer went over in each voice; bars counted right.
  geo = await put(
    "X:1\nT:Waiting\nM:4/4\nL:1/4\n%%score 1 2\nK:C\nV:1\nZ4|c d e f|g4|]\nV:2\nC D E F|G A B c|c B A G|F E D C|E4|D4|]\n",
  );
  const lowG = geo.notes.find((box) => box.voice === 1 && Math.abs(box.time - 1) < 1e-6);
  const highC = geo.notes.find((box) => box.voice === 0 && Math.abs(box.time - 4) < 1e-6);
  await pull({ x: lowG.head + 3, y: lowG.y }, { x: highC.head + 3, y: highC.y });
  assert.deepEqual(await texts(), ["c", "G"], "from V:2's G up to V:1's c: just those");
  await p.mouse.click(highC.head + 3, highC.y);
  await p.keyboard.press("ArrowRight");
  assert.match(
    await p.locator("#score-live").textContent(),
    /Bar 5/,
    "V:1's d is in bar 5, after Z4",
  );
  // 5. Shift Alt ←/→: an anchor and a moving end.
  geo = await put("X:1\nT:Five\nM:4/4\nL:1/8\nK:D\nf2 e2 d2 c2|B4 A4|G2 F2 E2 D2|\n");
  const d2 = geo.notes.find((box) => Math.abs(box.time - 0.5) < 1e-6);
  await p.mouse.click(d2.head + 3, d2.y);
  for (let step = 0; step < 3; step++) await p.keyboard.press("Shift+Alt+ArrowRight");
  assert.deepEqual(await texts(), ["d2 c2|B4 A4"], "three steps right");
  for (let step = 0; step < 4; step++) await p.keyboard.press("Shift+Alt+ArrowLeft");
  assert.deepEqual(await texts(), [], "four back: at the anchor, a caret again (as in text)");
  await p.keyboard.press("Shift+Alt+ArrowLeft");
  assert.deepEqual(await texts(), ["e2"], "one more: grows left from the anchor");
  // 6. A spacer voice isn't selected or counted.
  geo = await put(
    "X:1\nT:Six\nM:4/4\nL:1/4\n%%score {1 (2 3)}\nK:C\nV:1\nc d e f|\nV:2 clef=bass\nC, D, E, F,|\nV:3 clef=bass\nx4|\n",
  );
  const bass = geo.notes.filter((box) => box.voice === 1).sort((a, b) => a.head - b.head);
  await pull({ x: bass[0].head + 3, y: bass[0].y }, { x: bass[1].head + 3, y: bass[1].y });
  assert.deepEqual(await texts(), ["C, D,"], "the spacer voice isn't taken");
  // Nor counted: "2 notes selected", not "in 2 voices".
  await p.waitForFunction(() =>
    /^2 notes selected ·/.test(document.getElementById("explain").textContent),
  );
  // 7. Redo after a typed mark: the selection it left, every mark in it.
  geo = await put("X:1\nT:Seven\nM:4/4\nL:1/4\nK:C\nC D E F|\n");
  const row = geo.notes.sort((a, b) => a.head - b.head);
  await pull({ x: row[0].head + 3, y: row[0].y }, { x: row[3].head + 3, y: row[3].y });
  await p.keyboard.press(".");
  await p.keyboard.press("Control+z");
  await p.keyboard.press("Control+y");
  await p.waitForFunction(
    () =>
      window.composer.view.state.sliceDoc(
        window.composer.view.state.selection.main.from,
        window.composer.view.state.selection.main.to,
      ) === ".C .D .E .F",
  );
  // 4. A drag held by the bottom edge scrolls on its own, and a wheel scroll moves its end.
  const long = Array.from(
    { length: 80 },
    (_, at) => ["CDEF GABc", "cBAG FEDC", "EGce gecG", "FAcf afcA"][at % 4],
  ).join("|");
  geo = await put(`X:1\nT:Long\nM:4/4\nL:1/8\nK:C\n${long}|]\n`);
  const start = geo.notes.sort((a, b) => a.line - b.line || a.head - b.head)[0];
  const frame = await p.locator("#score-scroll").boundingBox();
  const top = () => p.evaluate(() => document.getElementById("score-scroll").scrollTop);
  const length = async () => (await texts()).join("").length;
  await p.mouse.move(start.head + 3, start.y);
  await p.mouse.down();
  await p.mouse.move(start.head + 300, frame.y + frame.height / 2, { steps: 6 });
  const before = await length();
  await p.mouse.wheel(0, 400);
  await p.waitForFunction(
    (was) => document.getElementById("score-scroll").scrollTop > was + 300,
    0,
  );
  await settle(200);
  const wheeled = await length();
  assert(wheeled > before, `a wheel scroll mid-drag moves its end (${before} → ${wheeled})`);
  await p.mouse.move(start.head + 300, frame.y + frame.height - 10, { steps: 3 });
  const atEdge = await top();
  await settle(600);
  assert((await top()) > atEdge + 100, "held by the bottom edge, the drag scrolls on its own");
  await p.mouse.up();
  assert((await length()) > wheeled, "and the selection follows to where it was let go");
  // A %%vskip inside a tune no longer stops the score redrawing.
  await put(
    "X:1\nT:Spaced\nM:4/4\nL:1/8\nK:D\n|:dfaf gfed|cdeg fedc:|\n%%vskip 6\nG2 AB c2 BA|G8|]\n",
  );
  assert.match(
    await p.locator("#score-summary").textContent(),
    /^Spaced/,
    "a tune with %%vskip draws",
  );
  await ctx.close();

  // 3. On a phone: a finger's drag scrolls (the tap's note stays selected); a long press selects.
  const phoneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  watch(phoneContext);
  const q = await phoneContext.newPage();
  await q.goto(url);
  await q.getByRole("button", { name: "Ode to Joy" }).click();
  await drawn(q);
  await q.evaluate(() => {
    window.__before = window.composer.scoreIndex();
    const view = window.composer.view;
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: "X:1\nT:Phone\nM:4/4\nL:1/8\nK:D\ndefg abag|fedc BAGF|\n",
      },
    });
  });
  await q.waitForFunction(() => window.composer.scoreIndex() !== window.__before);
  await q.locator("#show-score").click();
  await q.waitForTimeout(500);
  const heads = (await q.evaluate(() => window.composer.geometry())).notes
    .filter((box) => box.line === 0)
    .sort((a, b) => a.head - b.head);
  const a = { x: heads[0].head + 4, y: heads[0].y };
  const b = { x: heads[4].head + 4, y: heads[4].y };
  const cdp = await phoneContext.newCDPSession(q);
  const touch = (type, points) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map((point) => ({ x: point.x, y: point.y })),
    });
  const slide = async () => {
    for (let step = 1; step <= 10; step++) {
      await touch("touchMove", [{ x: a.x + ((b.x - a.x) * step) / 10, y: a.y }]);
      await q.waitForTimeout(16);
    }
    await touch("touchEnd", []);
    await q.waitForTimeout(300);
  };
  const picked = () =>
    q.evaluate(() => {
      const view = window.composer.view;
      return view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
    });
  // A tap selects its note; a quick drag (a scroll) then leaves that selection as it was, even
  // starting from another note.
  await touch("touchStart", [a]);
  await touch("touchEnd", []);
  await q.waitForTimeout(200);
  assert.equal(await picked(), "d", "a tap selects its note");
  const c = { x: heads[2].head + 4, y: heads[2].y };
  await touch("touchStart", [c]);
  for (let step = 1; step <= 10; step++) {
    await touch("touchMove", [{ x: c.x + ((b.x - c.x) * step) / 10, y: c.y }]);
    await q.waitForTimeout(16);
  }
  await touch("touchEnd", []);
  await q.waitForTimeout(300);
  assert.equal(await picked(), "d", "a quick drag scrolls: the selection stays as it was");
  await touch("touchStart", [a]);
  await q.waitForTimeout(600);
  assert.equal(await q.locator("#score-scroll.pressing").count(), 1, "a long press is shown");
  await slide();
  assert.equal(await picked(), "defg a", "and then a drag selects what it goes over");
  await phoneContext.close();
  console.log(
    "Composer: selection hardening round 1: music only across parts and lyrics, a multi-bar rest, Shift Alt arrows, spacer voices, redo, edge and wheel scrolling, phone long press: passed",
  );
}

/* 30. The one rule: whatever text is selected, the notes lit, the notes counted and the notes a
   command changes are the same notes. */
{
  const hard =
    'X:1\nT:Hard\nM:4/4\nL:1/8\n%%score (1 2)\nK:G\nV:1\n!trill!"G"d2 {a}g>f "Em"e2 [Bd]2 | (3cde !fermata!f-f [CE]G "^ad lib."A2 | =F^Fe\'c, B,4 |]\nw: one two three four five six se-ven eight nine ten e-le-ven twelve\n% a comment\nV:2\nG,4 D,2 [G,B,]2 | C2 z2 D2 E2 | F2 G2 A,4 |]\n';
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  watch(ctx);
  const p = await ctx.newPage();
  await p.goto(url);
  await openExample("Ode to Joy", p);
  await p.evaluate((t) => {
    const view = window.composer.view;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t } });
  }, hard);
  await p.waitForFunction((t) => window.composer.scoreIndex()?.source === t, hard);
  await p.waitForTimeout(400);
  // The music's items, in order: a chord is one item; grace notes, chord symbols, annotations and
  // decorations are left out (they go with their note); rests are not notes.
  const items = (text) =>
    text
      .split("\n")
      .filter((line) => line && !/^(?:[A-Za-z]:|%)/.test(line))
      .join(" ")
      .replace(/"[^"]*"|![^!]*!|\{[^}]*\}/g, " ")
      .match(/\[[^\]]*\][\d/]*|(?:\^\^?|__?|=)?[A-Ga-g][,']*[\d/]*/g);
  const body = hard.indexOf("V:1\n") + 4;
  let seed = 11;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  let checked = 0;
  for (let run = 0; run < 60; run++) {
    const a = body + Math.floor(random() * (hard.length - body));
    const length = 1 + Math.floor(random() * 24);
    const from = Math.min(a, hard.length - 1);
    const to = Math.min(hard.length - 1, from + length);
    if (to <= from) continue;
    await p.evaluate(
      ([anchor, head]) => {
        document.getElementById("explain").textContent = "";
        window.composer.view.dispatch({ selection: { anchor, head } });
      },
      [from, to],
    );
    // The status line follows the selection a moment later.
    await p.waitForFunction(() => /selected/.test(document.getElementById("explain").textContent));
    const { lit, said } = await p.evaluate(() => ({
      lit: window.composer
        .scoreIndex()
        .notes.filter(
          (note) =>
            !note.rest && note.elements.some((each) => each.classList.contains("is-selected")),
        ).length,
      said: document.getElementById("explain").textContent,
    }));
    const counted = [...said.matchAll(/(\d+) (?:note|chord tone)/g)].reduce(
      (sum, match) => sum + Number(match[1]),
      0,
    );
    const what = `"${hard.slice(from, to).replace(/\n/g, "⏎")}"`;
    assert.equal(lit, counted, `${what}: the status counts what is lit (${said})`);
    if (!counted) continue;
    await p.locator(".cm-content").focus();
    await p.keyboard.press("Alt+Shift+ArrowUp");
    const after = await docText(p);
    const before = items(hard);
    const moved = items(after).filter((item, at) => item !== before[at]).length;
    assert.equal(moved, counted, `${what}: an octave up moves what is lit and counted`);
    await p.keyboard.press("Control+z");
    await p.waitForFunction((t) => window.composer.view.state.doc.toString() === t, hard);
    checked += 1;
  }
  await ctx.close();
  console.log(
    `Composer: ${checked} random text selections over a hard tune light, count and move the same notes: passed`,
  );
}

/* 31. Selection hardening, round 2: each finding, as the reviewers found it. */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  watch(ctx);
  const p = await ctx.newPage();
  await p.goto(url);
  await openExample("Ode to Joy", p);
  const put = async (t) => {
    await p.evaluate((x) => {
      const view = window.composer.view;
      if (view.state.doc.toString() !== x)
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: x } });
      view.dispatch({ selection: { anchor: 0 } });
    }, t);
    await p.waitForFunction((x) => window.composer.scoreIndex()?.source === x, t);
    await p.waitForTimeout(400);
    return p.evaluate(() => window.composer.geometry());
  };
  const pull = async (a, b) => {
    await p.mouse.move(a.x, a.y);
    await p.mouse.down();
    await p.mouse.move(b.x, b.y, { steps: 6 });
    await p.mouse.up();
  };
  const select = (from, to) =>
    p.evaluate(
      ([anchor, head]) => window.composer.view.dispatch({ selection: { anchor, head } }),
      [from, to],
    );
  // 1. A copy of two voices' bar 1, pasted over their bar 3: each voice gets its own part.
  const paste =
    "X:1\nT:Paste\nM:4/4\nL:1/4\n%%score (1 2)\nK:C\nV:1\nc d e f|g a b c'|c' b a g|f e d c|]\nV:2\nC D E F|G A B c|c B A G|F E D C|]\n";
  let geo = await put(paste);
  const bar = (voice, from) =>
    geo.notes
      .filter((box) => box.voice === voice && box.time >= from - 1e-6 && box.time < from + 1 - 1e-6)
      .sort((a, b) => a.head - b.head);
  const across = async (from) => {
    const top = bar(0, from);
    const low = bar(1, from);
    await pull({ x: top[0].head + 3, y: top[0].y }, { x: low.at(-1).head + 3, y: low.at(-1).y });
  };
  await across(0);
  await p.keyboard.press("Control+c");
  assert.equal(
    await p.evaluate(() => navigator.clipboard.readText()),
    "V:1\nc d e f|\nV:2\nC D E F|\n",
    "a two-voice copy keeps each voice under its V: line",
  );
  await across(2);
  await p.keyboard.press("Enter");
  await p.keyboard.press("Control+v");
  // The voiced paste loads with the first voiced copy; wait for the text to change.
  await p
    .waitForFunction((was) => window.composer.view.state.doc.toString() !== was, paste)
    .catch(() => {});
  assert.equal(
    await docText(p),
    "X:1\nT:Paste\nM:4/4\nL:1/4\n%%score (1 2)\nK:C\nV:1\nc d e f|g a b c'|c d e f|f e d c|]\nV:2\nC D E F|G A B c|C D E F|F E D C|]\n",
    "pasted over two voices' bar 3, each voice gets its own part",
  );
  await p.keyboard.press("Control+z");
  assert.equal(await docText(p), paste, "the paste is one undo step");
  // 2. A double-clicked note, and one chord tone, move with Alt ↑.
  await put("X:1\nT:Double\nM:4/4\nL:1/8\nK:C\nF/G/ [C,,C,]8 =G6 |\n");
  await p.locator(".cm-content").focus();
  const at = async (part) => (await docText(p)).indexOf(part);
  await select(await at("F/"), (await at("F/")) + 1);
  await p.keyboard.press("Alt+ArrowUp");
  assert.match(await docText(p), /\n\^F\/G\/ /, "a double-clicked F (no length) moves up");
  await select((await at("[C,,")) + 1, (await at("[C,,")) + 4);
  await p.waitForFunction(() =>
    /^1 chord tone selected/.test(document.getElementById("explain").textContent),
  );
  await p.keyboard.press("Alt+Shift+ArrowUp");
  assert.match(await docText(p), /\[C,C,\]8/, "one chord tone moves an octave, the other stays");
  // 4. Play the selection: exactly the notes selected, the pieces back to back.
  geo = await put(paste);
  const d = bar(0, 0)[1];
  const e = bar(0, 3)[1];
  await p.mouse.click(d.head + 3, d.y);
  await p.keyboard.down("Control");
  await p.mouse.click(e.head + 3, e.y);
  await p.keyboard.up("Control");
  await p.keyboard.press("Control+Alt+Enter");
  await p.waitForFunction(() => window.composer.player.timeline?.pieces?.length === 2);
  assert.deepEqual(
    await p.evaluate(() => window.composer.player.timeline.notes.map((note) => note.pitch)),
    [74, 76],
    "a note (d) and another three bars on (e) play just those two",
  );
  await p.keyboard.press("Control+Period");
  // 5. Find this melody from a selection reads the notes, not the text.
  await put("X:1\nT:Sharp\nM:4/4\nL:1/8\nK:C\n^F2 GA F4 |\n");
  await select(await at("GA F4"), (await at("GA F4")) + 5);
  await p.locator(".cm-content").focus();
  await p.keyboard.press("Control+Shift+M");
  await p.waitForFunction(() => document.getElementById("melody-query")?.value === "G A ^F4");
  await p.keyboard.press("Escape");
  // 6. Insert › Triplet goes by the notes, whichever way the selection was dragged.
  const plain = "X:1\nT:Insert\nM:4/4\nL:1/8\nK:C\nC d e f g4 |\n";
  for (const backwards of [false, true]) {
    await put(plain);
    const from = await at("d e f");
    if (backwards) await select(from + 5, from);
    else await select(from, from + 5);
    await menu("insert", "Triplet", p);
    // Triplet, Repeat and Chord symbol load on first use.
    await p
      .waitForFunction((was) => window.composer.view.state.doc.toString() !== was, plain)
      .catch(() => {});
    assert.match(
      await docText(p),
      /\nC \(3d e f g4 \|/,
      `Triplet over d e f, dragged ${backwards ? "backwards" : "forwards"}`,
    );
  }
  await ctx.close();
  console.log(
    "Composer: selection hardening round 2: voiced paste, double-clicked notes and chord tones, exactly the selected notes played, melodies from notes, Insert by the notes: passed",
  );
}

/* 32. Selection hardening, round 3: each finding, as the reviewers found it. */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  watch(ctx);
  await ctx.addInitScript(() => {
    const input = { id: "fake-1", name: "Fake Keys 49", type: "input", state: "connected" };
    const access = {
      inputs: new Map([[input.id, input]]),
      outputs: new Map(),
      sysexEnabled: false,
    };
    navigator.requestMIDIAccess = async () => access;
    const send = (bytes) => input.onmidimessage?.({ data: new Uint8Array(bytes) });
    window.__midi = {
      play: (notes) => {
        for (const n of notes) send([0x90, n, 90]);
        for (const n of notes) send([0x80, n, 0]);
      },
    };
  });
  const p = await ctx.newPage();
  await p.goto(url);
  await openExample("Ode to Joy", p);
  const put = async (t) => {
    await p.evaluate((x) => {
      const view = window.composer.view;
      if (view.state.doc.toString() !== x)
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: x } });
      view.dispatch({ selection: { anchor: 0 } });
    }, t);
    // One tune drawn (of two, maybe): its text is in the file's.
    await p.waitForFunction((x) => x.includes(window.composer.scoreIndex()?.source ?? "\u0000"), t);
    await p.waitForTimeout(400);
    return p.evaluate(() => window.composer.geometry());
  };
  const pull = async (a, b) => {
    await p.mouse.move(a.x, a.y);
    await p.mouse.down();
    await p.mouse.move(b.x, b.y, { steps: 6 });
    await p.mouse.up();
  };
  /** Selects text ranges ([from, to] pairs), the last one main unless said. */
  const choose = (list, main = list.length - 1) =>
    p.evaluate(
      ([list, main]) => {
        const view = window.composer.view;
        const S = view.state.selection.constructor;
        view.dispatch({
          selection: S.create(
            list.map(([a, b]) => S.range(a, b)),
            main,
          ),
        });
        view.focus();
      },
      [list, main],
    );
  const texts = () =>
    p.evaluate(() => {
      const view = window.composer.view;
      return view.state.selection.ranges
        .filter((range) => !range.empty)
        .map((range) => view.state.sliceDoc(range.from, range.to));
    });
  const changed = (was) =>
    p.waitForFunction((w) => window.composer.view.state.doc.toString() !== w, was).catch(() => {});
  const statusSays = (pattern) =>
    p.waitForFunction(
      (source) => new RegExp(source).test(document.getElementById("explain").textContent),
      pattern.source,
    );
  const noticeSays = (pattern) =>
    p.waitForFunction(
      (source) => new RegExp(source).test(document.getElementById("notice").textContent),
      pattern.source,
    );
  const of = (text, part, nth = 0) => {
    let at = text.indexOf(part);
    for (let n = 0; n < nth; n++) at = text.indexOf(part, at + 1);
    return [at, at + part.length];
  };
  const two =
    "X:1\nT:Bars\nM:4/4\nL:1/4\n%%score 1 2\nK:C\nV:1\nc d e f|g a b c'|c' b a g|f e d c|]\nV:2\nC D E F|G A B c|c B A G|F E D C|]\n";
  let geo = await put(two);
  const box = (voice, time) =>
    geo.notes.find((each) => each.voice === voice && Math.abs(each.time - time) < 1e-6);
  // 1. A selection stops before the bar line; typing, Delete and Cut keep the bars.
  const f = box(0, 0.75);
  await p.mouse.click(f.head + 3, f.y);
  assert.deepEqual(await texts(), ["f"], "a click on f takes f, not its bar line");
  await p.keyboard.press("Backspace");
  // (Round 5: in one voice of two, a rest as long, so the voices stay in step.)
  assert.match(
    await docText(p),
    /\nc d e z\|g a b c'\|/,
    "Backspace in the score of one voice's note leaves a rest, bar 1's bar line kept",
  );
  await p.keyboard.press("Control+z");
  await pull(
    { x: box(0, 0.25).head + 3, y: box(0, 0.25).y },
    { x: box(1, 0.75).head + 3, y: box(1, 0.75).y },
  );
  assert.deepEqual(
    await texts(),
    ["d e f", "D E F"],
    "a drag across two voices stops before the bar line",
  );
  await p.keyboard.press("Control+x");
  assert.match(
    await docText(p),
    // (By the beat since round 8: a quarter rest on beat 2, a half on beats 3 and 4.)
    /\nc z z2\|g a b c'\|[^\n]*\nV:2\nC z z2\|G A B c\|/,
    "Cut of part of a bar keeps its bar lines (round 6: rests in its notes' place)",
  );
  await p.keyboard.press("Control+z");
  await pull(
    { x: box(0, 0).head + 3, y: box(0, 0).y },
    { x: box(1, 0.75).head + 3, y: box(1, 0.75).y },
  );
  await p.keyboard.press("Enter");
  await p.keyboard.type("z4");
  assert.match(
    await docText(p),
    /\nz4\|g a b c'\|[^\n]*\nV:2\nz4\|G A B c\|/,
    "typing z4 over bar 1 keeps its bar lines",
  );
  geo = await put(two);
  await choose([of(two, "g a b c'")]);
  await p.keyboard.press("Control+x");
  assert.match(
    await docText(p),
    /\nc d e f\|z4\|c' b a g\|f e d c\|\]\n/,
    "Cut of a whole bar in one voice of two leaves rests (round 5: voices in step)",
  );
  assert.equal(
    await p.evaluate(() => navigator.clipboard.readText()),
    "g a b c'|",
    "a whole bar copies with its bar line",
  );
  let doc = await docText(p);
  await p.evaluate(
    (at) => window.composer.view.dispatch({ selection: { anchor: at } }),
    doc.indexOf("f e d c"),
  );
  await p.keyboard.press("Control+v");
  await changed(doc);
  assert.match(
    await docText(p),
    /\nc d e f\|z4\|c' b a g\|g a b c'\|f e d c\|\]\n/,
    "pasted back at a bar's start: a whole bar, no double bar line",
  );
  // 2. A copy of four parts in interleaved blocks: a voice's parts joined; a header caret refused.
  const blocks =
    "X:1\nT:Blocks\nM:4/4\nL:1/4\n%%score 1 2\nK:C\nV:1\nc d e f|g a b c'|\nV:2\nC D E F|G A B c|\nV:1\nc' b a g|e f g a|]\nV:2\nc B A G|E F G A|]\n";
  geo = await put(blocks);
  await choose([
    of(blocks, "g a b c'"),
    of(blocks, "G A B c"),
    of(blocks, "e f g a"),
    of(blocks, "E F G A"),
  ]);
  await p.keyboard.press("Control+c");
  await p.evaluate(
    (at) => window.composer.view.dispatch({ selection: { anchor: at } }),
    blocks.indexOf("c d e f"),
  );
  await p.keyboard.press("Control+v");
  await changed(blocks);
  assert.match(
    await docText(p),
    // (And, since round 8, V:2 rests as long: every voice in step.)
    /\nV:1\ng a b c'\| e f g a\| ?c d e f\|g a b c'\|\nV:2\nz4 \| z4 \| ?C D E F/,
    "at a V:1 caret: both of V:1's parts, in order",
  );
  geo = await put(blocks);
  await p.evaluate(
    (at) => window.composer.view.dispatch({ selection: { anchor: at } }),
    blocks.indexOf("M:4/4"),
  );
  await p.locator(".cm-content").focus();
  await p.keyboard.press("Control+v");
  await statusSays(/click in a voice's music/);
  assert.equal(await docText(p), blocks, "at a header caret: refused, the header as it was");
  // 3. Dragging back takes only what the pointer reached.
  geo = await put("X:1\nT:Back\nM:4/4\nL:1/4\nK:C\nC D E F|G A B c|]\n");
  const c = geo.notes.find((each) => Math.abs(each.time - 1.75) < 1e-6);
  const a = geo.notes.find((each) => Math.abs(each.time - 1.25) < 1e-6);
  await pull({ x: c.head + 3, y: c.y }, { x: a.head - 4, y: a.y });
  assert.deepEqual(
    await texts(),
    ["A B c"],
    "4 px left of A's head, dragged back from c: A B c, not G",
  );
  // 4. Plain music over places in two voices goes into the main place only.
  geo = await put(two);
  await p.evaluate(() => navigator.clipboard.writeText("e e e e"));
  await choose([of(two, "c' b a g"), of(two, "c B A G")]);
  await p.keyboard.press("Control+v");
  await changed(two);
  assert.match(
    await docText(p),
    /\|c' b a g\|[^\n]*\nV:2\nC D E F\|G A B c\|e e e e\|/,
    "only V:2, the main place, takes it",
  );
  await noticeSays(/main selection only \(V:2\)/);
  // 5. Duplicate copies the notes: a chord tone's whole chord.
  const chord = "X:1\nT:Chord\nM:4/4\nL:1/8\nK:C\n[CEG]2 A2 B4|\n";
  geo = await put(chord);
  await choose([[chord.indexOf("E"), chord.indexOf("E") + 1]]);
  await p.keyboard.press("Control+Shift+D");
  assert.match(
    await docText(p),
    /\n\[CEG\]2 \[CEG\]2 A2 B4\|/,
    "a chord tone duplicates its chord",
  );
  // 6. A loop goes on through an edit before it.
  const loop = "X:1\nT:Loop\nM:4/4\nL:1/4\nK:C\nC D E F|G A B c|]\n";
  geo = await put(loop);
  await choose([of(loop, "G A B c")]);
  await p.keyboard.press("Control+Alt+Enter");
  await p.waitForFunction(() => window.composer.player.status === "playing");
  await p.keyboard.press("Control+Shift+L");
  await p.waitForFunction(() => window.composer.player.loopingRegion);
  for (const [where, at] of [
    ["before", loop.indexOf("C D")],
    ["inside", loop.indexOf("A B")],
    ["after", loop.indexOf("|]")],
  ]) {
    const before = await docText(p);
    await p.evaluate(
      (pos) => window.composer.view.dispatch({ changes: { from: pos, insert: "!p!" } }),
      at + (before.length - loop.length),
    );
    await p.waitForFunction((was) => window.composer.scoreIndex()?.source !== was, before);
    await p.waitForTimeout(300);
    assert.deepEqual(
      await p.evaluate(() => [
        window.composer.player.status,
        window.composer.player.timeline.notes.map((note) => note.pitch),
      ]),
      ["playing", [67, 69, 71, 72]],
      `an edit ${where} the loop: it goes on playing G A B c`,
    );
  }
  await p.keyboard.press("Control+Shift+L");
  await p.keyboard.press("Control+Period");
  // 7. A triplet over a voice across V: blocks: never two. (Round 4: a triplet takes 3 notes in
  // one bar, so f and g across the bar line are refused, saying why.)
  geo = await put(blocks);
  await choose([of(blocks, "f"), [blocks.indexOf("g a b c'"), blocks.indexOf("g a b c'") + 1]]);
  await menu("insert", "Triplet", p);
  await statusSays(/A triplet takes exactly 3 notes/);
  assert.equal(await docText(p), blocks, "no triplet across the blocks' bar line");
  // 8. ", [ and { over selected music act on its notes.
  const eighths = "X:1\nT:Keys\nM:4/4\nL:1/8\nK:C\nc2 d2 e2 f2|g a b c' d'4|]\n";
  geo = await put(eighths);
  await choose([of(eighths, "d2 e2")]);
  await p.keyboard.type('"');
  assert.match(
    await docText(p),
    /\nc2 ""d2 e2 f2\|/,
    '" writes a chord symbol before the first note',
  );
  await p.keyboard.type("G");
  assert.match(await docText(p), /\nc2 "G"d2 e2 f2\|/, "the caret is inside it");
  geo = await put(eighths);
  await choose([of(eighths, "c2 d2 e2")]);
  await p.keyboard.type("[");
  assert.match(
    await docText(p),
    /\n\[cde\]2 f2\|/,
    "[ makes one chord with the first note's length",
  );
  geo = await put(eighths);
  await choose([of(eighths, "f2|g")]);
  await p.keyboard.type("[");
  await statusSays(/one bar of one voice/);
  assert.equal(await docText(p), eighths, "[ across a bar line is refused, the text as it was");
  await choose([of(eighths, "g a b")]);
  await p.keyboard.type("{");
  assert.match(
    await docText(p),
    /\|\{g a b\} c' d'4\|/,
    "{ makes grace notes of notes without lengths",
  );
  geo = await put(eighths);
  await choose([of(eighths, "c2 d2")]);
  await p.keyboard.type("(");
  assert.match(await docText(p), /\n\(c2 d2\) e2/, "( slurs them");
  geo = await put(eighths);
  await choose([of(eighths, "c2 d2")]);
  await p.keyboard.type("!");
  assert.doesNotMatch(await docText(p), /!c2 d2!/, "! is typed, never wrapped around the notes");
  // 9. A bar from L:1/8 K:D pasted into L:1/4 K:C sounds the same.
  const tunes2 =
    "X:1\nT:From\nM:4/4\nL:1/8\nK:D\nf2 g2 a2 c'2|]\n\nX:2\nT:To\nM:4/4\nL:1/4\nK:C\nC D E F|]\n";
  geo = await put(tunes2);
  await choose([of(tunes2, "f2 g2 a2 c'2")]);
  await p.keyboard.press("Control+c");
  await p.evaluate(
    (at) => window.composer.view.dispatch({ selection: { anchor: at } }),
    tunes2.indexOf("C D E F"),
  );
  await p.keyboard.press("Control+v");
  await changed(tunes2);
  assert.match(
    await docText(p),
    /\nK:C\n\^f g a \^c'\|C D E F\|\]\n/,
    "lengths for L:1/4, F♯ and C♯ spelled for C",
  );
  await noticeSays(/Pasted from L:1\/8, K:D: lengths and accidentals rewritten\./);
  // 10. The status after a cut, and its undo, says the voices.
  geo = await put(two);
  await pull(
    { x: box(0, 1).head + 3, y: box(0, 1).y },
    { x: box(1, 1.75).head + 3, y: box(1, 1.75).y },
  );
  await statusSays(/in 2 voices/);
  await p.keyboard.press("Control+x");
  await p.keyboard.press("Control+z");
  await statusSays(/^(Undone\. )?(4|8) notes selected in 2 voices/);
  // 11. A selection across two tunes says so.
  geo = await put(tunes2);
  await choose([[tunes2.indexOf("g2"), tunes2.indexOf("E F")]]);
  await statusSays(/in 2 tunes/);
  // 12. A resize mid-drag: the anchor is found again in the new drawing.
  geo = await put(two);
  const start = box(0, 0.25);
  await p.mouse.move(start.head + 3, start.y);
  await p.mouse.down();
  await p.mouse.move(box(0, 1.25).head + 3, box(0, 1.25).y, { steps: 4 });
  await p.setViewportSize({ width: 900, height: 900 });
  await p.waitForTimeout(600);
  geo = await p.evaluate(() => window.composer.geometry());
  await p.mouse.move(box(0, 1.5).head + 3, box(0, 1.5).y, { steps: 4 });
  await p.mouse.up();
  await p.setViewportSize({ width: 1440, height: 900 });
  assert.deepEqual(await texts(), ["d e f|g a b"], "after the reflow, the drag still starts at d");
  // 13. Shift Alt arrows from a caret, and back to it.
  geo = await put("X:1\nT:Steps\nM:4/4\nL:1/4\nK:C\nc d e f|]\n");
  await p.evaluate(() => {
    const view = window.composer.view;
    view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf("d e") } });
    view.focus();
  });
  const steps = [];
  for (const key of ["Right", "Right", "Left", "Left", "Left"]) {
    await p.keyboard.press(`Shift+Alt+Arrow${key}`);
    steps.push((await texts()).join(","));
  }
  assert.deepEqual(steps, ["d", "d e", "d", "", "c"], "→ d, → d e, ← d, ← the caret again, ← c");
  // 14. MIDI step entry over a selection replaces its notes, and says so.
  geo = await put(two);
  await menu("play", "MIDI keyboard…", p);
  await p.waitForFunction(() =>
    /Listening to Fake Keys 49/.test(document.querySelector(".midi-status")?.textContent ?? ""),
  );
  await p.getByLabel("Write it at the caret (step entry)").check();
  await choose([of(two, "c B A G"), of(two, "c' b a g")]);
  await p.evaluate(() => window.__midi.play([72]));
  // (Since round 8: forward from the selection's first note, the selection left as rests.)
  await p.waitForFunction(() =>
    /Wrote c\/ over the selection, from its first note; .*The other place selected was left/.test(
      document.querySelector(".midi-status")?.textContent ?? "",
    ),
  );
  doc = await docText(p);
  assert.match(
    doc,
    /\nc d e f\|g a b c'\|c\/ z\/ z z2\|f e d c\|\]\n/,
    "V:1's bar 3 is the step, its bar lines kept",
  );
  assert.match(doc, /\|c B A G\|/, "V:2's place is left as it was");
  await p
    .locator(".midi-close, #midi-panel button[aria-label^='Close']")
    .first()
    .click()
    .catch(() => {});
  // 15. A drag over a 220-bar score: pointer moves arriving several to a frame (as a fast mouse
  // sends them) make one selection update a frame, not one each (the old way: ~55 ms a batch).
  const big = `X:1\nT:Big\nM:4/4\nL:1/8\nK:G\n${Array.from({ length: 220 }, (_, at) => ["GABc dBAG", "FGAB cAGF", "EFGA BGFE", "DEFG AFED"][at % 4]).join("|")}|]\n`;
  geo = await put(big);
  const heads = geo.notes
    .filter((each) => each.y > 150 && each.y < 800)
    .sort((x, y) => x.line - y.line || x.head - y.head);
  await p.mouse.move(heads[0].head + 3, heads[0].y);
  await p.mouse.down();
  await p.waitForTimeout(300);
  const points = heads.slice(0, 160).map((each) => [each.head + 3, each.y]);
  const batches = await p.evaluate(async (list) => {
    const scroll = document.getElementById("score-scroll");
    const took = [];
    for (let at = 0; at + 8 <= list.length; at += 8) {
      const t = performance.now();
      for (const [x, y] of list.slice(at, at + 8))
        scroll.dispatchEvent(
          new PointerEvent("pointermove", { pointerId: 1, clientX: x, clientY: y, bubbles: true }),
        );
      took.push(performance.now() - t);
      await new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0)));
    }
    return took;
  }, points);
  const reached = (await texts()).join("");
  const last = points.at(-1);
  await p.mouse.move(last[0], last[1]);
  await p.mouse.up();
  const longest = Math.max(...batches);
  assert(longest < 20, `8 pointer moves in one task take ${Math.round(longest)} ms (under 20)`);
  assert(reached.length > 120, "the selection followed the moves, frame by frame");
  await ctx.close();
  console.log(
    `Composer: selection hardening round 3: bar lines kept by typing, Delete, Cut, Copy and Paste; voiced copies from interleaved blocks; drags back; plain paste over voices; Duplicate by notes; loops through edits; one triplet over blocks; " [ { over notes; paste between keys and units; status after cut, across tunes; a resize mid-drag; Shift Alt back to the caret; step entry over a selection; a 220-bar drag (8 moves in ${Math.round(longest)} ms): passed`,
  );
}

/* 33. Selection hardening, round 4: every edit keeps the music's structure. */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  watch(ctx);
  const p = await ctx.newPage();
  await p.goto(url);
  await openExample("Ode to Joy", p);
  const put = async (t) => {
    await p.evaluate((x) => {
      const view = window.composer.view;
      if (view.state.doc.toString() !== x)
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: x } });
      view.dispatch({ selection: { anchor: 0 } });
    }, t);
    await p.waitForFunction((x) => x.includes(window.composer.scoreIndex()?.source ?? "\u0000"), t);
    await p.waitForTimeout(400);
    return p.evaluate(() => window.composer.geometry());
  };
  const choose = (list, main = list.length - 1) =>
    p.evaluate(
      ([list, main]) => {
        const view = window.composer.view;
        const S = view.state.selection.constructor;
        view.dispatch({
          selection: S.create(
            list.map(([a, b]) => S.range(a, b)),
            main,
          ),
        });
        view.focus();
      },
      [list, main],
    );
  const of = (text, part, nth = 0) => {
    let at = text.indexOf(part);
    for (let n = 0; n < nth; n++) at = text.indexOf(part, at + 1);
    return [at, at + part.length];
  };
  const settled = (was) =>
    p.waitForFunction((w) => window.composer.view.state.doc.toString() !== w, was).catch(() => {});
  const statusSays = (pattern) =>
    p.waitForFunction(
      (source) => new RegExp(source).test(document.getElementById("explain").textContent),
      pattern.source,
    );
  const noticeSays = (pattern) =>
    p.waitForFunction(
      (source) => new RegExp(source).test(document.getElementById("notice").textContent),
      pattern.source,
    );
  const jumps =
    "X:1\nT:Jumps\nM:4/4\nL:1/4\nK:C\n|: C D E F |1 G A B c :|2 c B A G |]\nS d e f g | a b c' d' !D.S.alcoda! |\nO e f g a | g f e d |]\n";
  const tunes = {
    jumps,
    fields:
      "X:1\nT:Fields\nM:4/4\nL:1/8\nK:G\nG2 A2 B2 c2 | [K:Bb][L:1/4] B c d e | [M:2/4] f g | [M:3/4] a b c' | B A G |]\n",
    endings:
      "X:1\nT:Endings\nM:3/4\nL:1/4\nK:D\n|: D E F | G A B |1 c d e | f g a :|2 B c d | A3 |]\n",
    triplets: "X:1\nT:Triplets\nM:4/4\nL:1/8\nK:C\n(3cde (3fga b2 c'2 | d'2 (c'2 b2) a2 | g8 |]\n",
    // Round 5: repeats and endings across line breaks.
    morrison:
      "X:3\nT:Morrison's\nM:6/8\nL:1/8\nK:Edor\n|:E3 B3|EBE AFD|EDE B3|dcB AFD|\nE3 B3|EBE AFD|G3 FGA|1 BAG FED:|2 BAG FE2||\n",
  };
  /** The drawn bars of voice 1: each bar's first and last note. */
  const barsOf = async () =>
    p.evaluate(() => {
      const index = window.composer.scoreIndex();
      const bars = new Map();
      for (const note of index.byVoice[0]) {
        const bar = bars.get(note.measure) ?? [];
        bar.push(note);
        bars.set(note.measure, bar);
      }
      return [...bars.values()].map((bar) => ({
        first: bar[0].start,
        last: bar.at(-1).start,
        end: bar.at(-1).end,
      }));
    });
  const headOf = (geo, start) => geo.notes.find((each) => each.start === start);
  const pick = async (geo, first, last) => {
    const a = headOf(geo, first);
    const b = headOf(geo, last);
    await p.mouse.click(a.head + 3, a.y);
    await p.keyboard.down("Shift");
    await p.mouse.click(b.head + 3, b.y);
    await p.keyboard.up("Shift");
  };
  // 1. The property: Cut then Paste at the caret gives back the text exactly, for every bar and
  // run of bars (up to 3), through the score and the keys, in tunes with repeats, endings,
  // D.S. al Coda, inline fields, tuplets and slurs.
  let cycles = 0;
  for (const [name, tune] of Object.entries(tunes)) {
    let geo = await put(tune);
    const bars = await barsOf();
    for (let a = 0; a < bars.length; a++)
      for (let b = a; b < Math.min(bars.length, a + 3); b++) {
        await pick(geo, bars[a].first, bars[b].last);
        await p.keyboard.press("Control+x");
        const cut = await docText(p);
        if (cut === tune) {
          // Refused (a cut across part of a repeat's signs): it says why, and nothing changed.
          await statusSays(/repeat|ending|tuplet/);
          continue;
        }
        assert.deepEqual(
          await p.evaluate(() =>
            window.composer.view.state.selection.ranges.map((r) => r.to - r.from),
          ),
          [0],
          `${name}: after Cut of bars ${a + 1}–${b + 1}, a plain caret`,
        );
        await p.keyboard.press("Control+v");
        await settled(cut);
        assert.equal(
          await docText(p),
          tune,
          `${name}: Cut then Paste of bars ${a + 1}–${b + 1} gives the text back`,
        );
        cycles += 1;
        geo = await put(tune);
      }
  }
  // 2. Delete in the score of each bar of the D.S. tune: the play order loses just that bar.
  for (const key of ["Delete", "Control+x"]) {
    let geo = await put(jumps);
    const bars = await barsOf();
    for (const bar of bars) {
      geo = await put(jumps);
      await p.waitForFunction(() => window.composer.timelineNotes().length > 0);
      const before = await p.evaluate(() => window.composer.timelineNotes());
      await pick(geo, bar.first, bar.last);
      const was = await docText(p);
      await p.keyboard.press(key);
      await settled(was);
      if ((await docText(p)) === was) continue;
      await p.waitForFunction((n) => window.composer.timelineNotes().length !== n, before.length);
      const after = await p.evaluate(() =>
        window.composer.timelineNotes().map((note) => note.pitch),
      );
      assert.deepEqual(
        after,
        before
          .filter((note) => note.start < bar.first || note.start >= bar.end)
          .map((note) => note.pitch),
        `${key} of the bar at ${bar.first}: the play order loses just its notes`,
      );
    }
  }
  // 3. Cut of a bar opening with fields keeps them; its D.S. bar duplicates as one bar.
  let geo = await put(tunes.fields);
  await choose([of(tunes.fields, "B c d e")]);
  await p.keyboard.press("Control+x");
  assert.match(
    await docText(p),
    /\[K:Bb\]\s*\[L:1\/4\]\s*\[M:2\/4\] f g/,
    "the fields move to the next bar",
  );
  geo = await put(jumps);
  await choose([of(jumps, "a b c' d'")]);
  await p.keyboard.press("Control+Shift+D");
  assert.match(
    await docText(p),
    /\| a b c' d' \| a b c' d' !D\.S\.alcoda! \|/,
    "a D.S. bar duplicates as a bar",
  );
  // 4. Cut of the 1st ending: its marker goes, said so, and the 2nd ending still plays.
  geo = await put(jumps);
  await choose([of(jumps, "G A B c")]);
  await p.keyboard.press("Control+x");
  assert.match(await docText(p), /\|: C D E F :\| c B A G \|\]/, "the endings' numbers go");
  await noticeSays(/1st ending went with its only bar/);
  // 5. A two-voice copy over V:1 in two places and V:2 in one: V:1's other place as it was.
  const two =
    "X:1\nT:Two\nM:4/4\nL:1/4\n%%score 1 2\nK:C\nV:1\nc d e f|g a b c'|c' b a g|\nV:2 clef=bass\nC, D, E, F,|G, A, B, C|C B, A, G,|\n";
  geo = await put(two);
  await choose([of(two, "c d e f"), of(two, "C, D, E, F,")]);
  await p.keyboard.press("Control+c");
  await choose([of(two, "g a b c'"), of(two, "c' b a g"), of(two, "G, A, B, C")]);
  await p.keyboard.press("Control+v");
  await settled(two);
  let doc = await docText(p);
  assert.match(
    doc,
    /\nc d e f\|c d e f\|c' b a g\|\n/,
    "V:1's first place takes it, the second is as it was",
  );
  assert.match(doc, /\|C, D, E, F,\|C B, A, G,\|\n/, "V:2's place takes V:2's part");
  await noticeSays(/V:1 into the first of its 2 places \(the other was left as it was\)/);
  // 6. The copy pasted into a third voice it lacks: the part in that voice's clef.
  const three = `${two.replace("%%score 1 2", "%%score 1 2 3")}V:3 clef=bass\nz4|z4|z4|\n`;
  geo = await put(three);
  await choose([of(three, "c d e f"), of(three, "C, D, E, F,")]);
  await p.keyboard.press("Control+c");
  await p.evaluate(
    (at) => window.composer.view.dispatch({ selection: { anchor: at } }),
    three.lastIndexOf("z4"),
  );
  await p.keyboard.press("Control+v");
  await settled(three);
  assert.match(
    await docText(p),
    // (At a bar's start every voice keeps in step since round 8: V:1 and V:2 rest as long.)
    /\nV:1\nc d e f\|g a b c'\|z4 \| c' b a g\|\n[\s\S]*\nV:3 clef=bass\nz4\|z4\|C, D, E, F,\| ?z4\|/,
    "the bass part goes into the bass voice",
  );
  await noticeSays(
    /Pasted V:2's part into V:3 as a whole bar here, in step;.* The copy also had V:1\./,
  );
  // 7. Repeat over e…a goes to the bar lines; a triplet inside a triplet is refused.
  geo = await put(tunes.triplets);
  await choose([of(tunes.triplets, "e (3fga")]);
  await menu("insert", "Repeat", p);
  await settled(tunes.triplets);
  assert.match(
    await docText(p),
    /\n\|: \(3cde \(3fga b2 c'2 :\| d'2/,
    "the repeat goes round the bar",
  );
  assert.doesNotMatch(
    await p.evaluate(() => {
      const view = window.composer.view;
      return view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
    }),
    /\|/,
    "the selection after it holds no bar line",
  );
  geo = await put(tunes.triplets);
  await choose([of(tunes.triplets, "fga")]);
  await menu("insert", "Triplet", p);
  await statusSays(/already in a tuplet/);
  // 8. Duplicate after the tuplet, and no half slur.
  geo = await put(tunes.triplets);
  await choose([of(tunes.triplets, "e (3f")]);
  await p.keyboard.press("Control+Shift+D");
  assert.match(await docText(p), /\(3cde \(3fga e f b2/, "after the tuplet the last note is in");
  geo = await put(tunes.triplets);
  await choose([[tunes.triplets.indexOf("c'2 |"), tunes.triplets.indexOf("(c'2") + 4]]);
  await p.keyboard.press("Control+Shift+D");
  doc = await docText(p);
  assert.equal(doc.split("(").length, tunes.triplets.split("(").length, "no stray ( copied");
  // 9. A bar line over three voices goes into each; a second voice in step and in %%score.
  const voices3 =
    "X:1\nT:Three\nM:4/4\nL:1/4\n%%score 1 2 3\nK:C\nV:1\nc d e f g a b c'|]\nV:2\nC D E F G A B c|]\nV:3\nC,2 D,2 E,2 F,2|]\n";
  geo = await put(voices3);
  await choose([of(voices3, "c d e f"), of(voices3, "C D E F"), of(voices3, "C,2 D,2")], 0);
  await menu("insert", "Bar line", p);
  await settled(voices3);
  assert.match(
    await docText(p),
    /c d e f \| g[^\n]*\nV:2\nC D E F \| G[^\n]*\nV:3\nC,2 D,2 \| E,2/,
    "one in each voice",
  );
  const pickup = "X:1\nT:Pickup\nM:4/4\nL:1/8\n%%score 1\nK:C\nV:1\nG2|c2 d2 e2 f2|g8|]\n";
  geo = await put(pickup);
  await menu("insert", "Second voice", p);
  await settled(pickup);
  assert.match(
    await docText(p),
    /%%score 1 2\n[\s\S]*\nV:2 clef=bass\nz2 \| z8 \| z8 \|\n$/,
    "rests bar for bar, in %%score",
  );
  // 10. Shift+End in the score grows the selection to the line's end.
  geo = await put("X:1\nT:Ends\nM:4/4\nL:1/4\nK:C\nC D E F | G A B c |]\n");
  const d = geo.notes.find((each) => Math.abs(each.time - 0.25) < 1e-6);
  await p.mouse.click(d.head + 3, d.y);
  await p.keyboard.press("Shift+End");
  assert.deepEqual(
    await p.evaluate(() => {
      const view = window.composer.view;
      return view.state.selection.ranges.map((r) => view.state.sliceDoc(r.from, r.to));
    }),
    ["D E F | G A B c"],
    "Shift End takes the rest of the line",
  );
  // 11. Play selection over the endings alone: as written, said so.
  geo = await put(jumps);
  await choose([[jumps.indexOf("G A B c"), jumps.indexOf("c B A G") + 7]]);
  await p.keyboard.press("Control+Alt+Enter");
  await statusSays(/as written/);
  await p.keyboard.press("Control+Period");
  await ctx.close();
  console.log(
    `Composer: selection hardening round 4: Cut then Paste gives the text back over ${cycles} bars and runs (repeats, endings, D.S. al Coda, fields, tuplets); Delete and Cut keep the play order; fields, D.S. and endings kept; voiced paste leaves other places and picks by clef; Repeat, Triplet, Duplicate, Bar line, Second voice, Shift End and Play selection keep the structure: passed`,
  );
}

/* 34. Selection hardening, round 5: what a musician expects. */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  watch(ctx);
  const p = await ctx.newPage();
  await p.goto(url);
  await openExample("Ode to Joy", p);
  const put = async (t) => {
    await p.evaluate((x) => {
      const view = window.composer.view;
      if (view.state.doc.toString() !== x)
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: x } });
      view.dispatch({ selection: { anchor: 0 } });
    }, t);
    await p.waitForFunction((x) => x.includes(window.composer.scoreIndex()?.source ?? "\u0000"), t);
    await p.waitForTimeout(400);
    return p.evaluate(() => window.composer.geometry());
  };
  const choose = (list, main = list.length - 1) =>
    p.evaluate(
      ([list, main]) => {
        const view = window.composer.view;
        const S = view.state.selection.constructor;
        view.dispatch({
          selection: S.create(
            list.map(([a, b]) => S.range(a, b)),
            main,
          ),
        });
        view.focus();
      },
      [list, main],
    );
  const of = (text, part, nth = 0) => {
    let at = text.indexOf(part);
    for (let n = 0; n < nth; n++) at = text.indexOf(part, at + 1);
    return [at, at + part.length];
  };
  const settled = (was) =>
    p.waitForFunction((w) => window.composer.view.state.doc.toString() !== w, was).catch(() => {});
  const says = (id, pattern) =>
    p.waitForFunction(
      ([id, source]) => new RegExp(source).test(document.getElementById(id).textContent),
      [id, pattern.source],
    );
  const selected = () =>
    p.evaluate(() => {
      const view = window.composer.view;
      return view.state.selection.ranges
        .filter((r) => !r.empty)
        .map((r) => view.state.sliceDoc(r.from, r.to));
    });
  // 1. Backspace over a repeat's notes in the text: no fused signs, the repeat goes as one.
  const reel = "X:1\nT:Reel\nM:3/4\nL:1/8\nK:G\nGAB|:EBE AFD:|G3 G3|]\n";
  await put(reel);
  await choose([of(reel, "EBE AFD")]);
  await p.keyboard.press("Backspace");
  let doc = await docText(p);
  assert.doesNotMatch(doc, /\|::\||\|:\||::\|/, "no bar lines fused into new signs");
  assert.match(doc, /\nGAB\|G3 G3\|\]\n/, "the repeat went with its notes");
  // 2. Copy in the score keeps the keys there: Delete then acts as the score's Delete.
  const two = "X:1\nT:Two\nM:4/4\nL:1/4\nK:C\nc d e f|g a b c'|c' b a g|f e d c|]\n";
  let geo = await put(two);
  const g = geo.notes.find((each) => Math.abs(each.time - 1) < 1e-6);
  await p.mouse.click(g.head + 3, g.y);
  await p.keyboard.down("Shift");
  const c = geo.notes.find((each) => Math.abs(each.time - 1.75) < 1e-6);
  await p.mouse.click(c.head + 3, c.y);
  await p.keyboard.up("Shift");
  await p.keyboard.press("Control+c");
  assert.equal(
    await p.evaluate(() => document.activeElement?.id),
    "score-scroll",
    "after Ctrl C the score still has the keys",
  );
  await p.keyboard.type("A");
  assert.equal(await docText(p), two, "a letter typed in the score doesn't replace the notes");
  await p.keyboard.press("Delete");
  await settled(two);
  assert.match(
    await docText(p),
    /\nc d e f\|c' b a g\|f e d c\|\]\n/,
    "Delete is the score's: the bar goes whole",
  );
  await says("score-live", /Deleted 4 notes/);
  // 8. The live region says the new state once the score is redrawn.
  await p.waitForFunction(() =>
    /Deleted 4 notes\. /.test(document.getElementById("score-live").textContent),
  );
  // 3. Crescendo then f over twelve notes: one hairpin and one f, said so.
  const twelve = "X:1\nT:Marks\nM:4/4\nL:1/8\nK:G\nGABc dBAG|FGAB cAGF|EFGA BGFE|]\n";
  await put(twelve);
  for (const label of ["Crescendo — over the selection", "f — loud"]) {
    await choose([[twelve.indexOf("GABc"), twelve.indexOf("|]")]]);
    doc = await docText(p);
    await p.keyboard.press("Alt+d");
    await p.getByRole("menuitem", { name: label }).click();
    await settled(doc);
  }
  doc = await docText(p);
  assert.deepEqual(
    ["!f!", "!<(!", "!<)!"].map((mark) => doc.split(mark).length - 1),
    [1, 1, 1],
    "one f, one hairpin's start and end",
  );
  await says("explain", /^f on the first note\./);
  // 4. Insert › Repeat inside a repeat is refused, saying where it is.
  const ended =
    "X:1\nT:Ends\nM:4/4\nL:1/4\nK:C\n|: C D E F | G A B c |[1 d e f g :|[2 c B A G | C4 |]\n";
  await put(ended);
  await choose([of(ended, "C D E F")]);
  await menu("insert", "Repeat", p);
  await says("explain", /Already inside a repeat \(bars 1–5\)/);
  assert.equal(await docText(p), ended, "nothing nested");
  // 5. Moving the Kesh's B part before its A part: Cut, then Paste at the start.
  const kesh =
    "X:2\nT:Kesh\nM:6/8\nL:1/8\nK:G\n|:GAG GAB|ABA ABd|edd gdd|edB dBA|\nGAG GAB|ABA ABd|edd gdB|AGF G3:|\n|:BAB dBd|ege dBA|BAB dBG|ABA AGA|\nBAB dBd|ege dBd|gfg aga|bgf g3:|\n";
  await put(kesh);
  await choose([[kesh.indexOf("BAB dBd"), kesh.lastIndexOf("g3") + 2]]);
  await p.keyboard.press("Control+x");
  doc = await docText(p);
  assert.equal(
    doc,
    kesh.slice(0, kesh.indexOf("|:BAB")),
    "the B part goes whole, its signs with it",
  );
  await p.evaluate(
    (at) => window.composer.view.dispatch({ selection: { anchor: at } }),
    doc.indexOf("|:GAG"),
  );
  await p.keyboard.press("Control+v");
  await settled(doc);
  doc = await docText(p);
  assert.match(
    doc,
    /K:G\n\|:BAB dBd\|[\s\S]*bgf g3::GAG GAB\|/,
    "B now before A, the repeats joined as ::",
  );
  // 6. In the chorale, Delete in the tenor only leaves rests; the bar check finds nothing.
  const hymn =
    "X:1\nT:Old Hundredth\nM:2/2\nL:1/4\n%%score (S A) (T B)\nV:S clef=treble\nV:A clef=treble\nV:T clef=bass\nV:B clef=bass\nK:G\n[V:S] G2 | G F E D | G2 A2 | B2 B2 |]\nw: All peo-ple that on earth do dwell,\n[V:A] D2 | D D C B, | D2 D2 | D2 D2 |]\n[V:T] B,2 | B, A, G, G, | B,2 C2 | B,2 G,2 |]\n[V:B] G,2 | G, D, E, G, | G,2 F,2 | G,2 G,2 |]\n";
  await put(hymn);
  await choose([of(hymn, "B, A, G, G,")]);
  await p.keyboard.press("Backspace");
  assert.match(await docText(p), /\[V:T\] B,2 \| z4 \| B,2 C2/, "the tenor's bar becomes rests");
  await says("notice", /Rests in place of the notes, so V:T stays in step/);
  await p.waitForTimeout(1000);
  assert.equal(
    await p.locator("#problems").isHidden(),
    true,
    "no problems: the voices are in step",
  );
  // 7. and 9. A bar pasted over part of a bar overwrites forward from its first note (round 7,
  // finding 1: MuseScore's way), the bar lines where they were; what was pasted is selected.
  await put(two);
  await p.evaluate(() => navigator.clipboard.writeText("e e e e|"));
  await choose([of(two, "a b")]);
  await p.keyboard.press("Control+v");
  await settled(two);
  assert.match(
    await docText(p),
    /\|g e e e\|e b a g\|f e d c\|\]/,
    "forward from the first note, every bar its length",
  );
  assert.deepEqual(await selected(), ["e e e", "e"], "the pasted notes are selected");
  // 10. Duplicate selects only the copy.
  await put(two);
  await choose([of(two, "c' b a g")]);
  await p.keyboard.press("Control+Shift+D");
  await settled(two);
  assert.deepEqual(await selected(), ["c' b a g"], "the copy is selected");
  assert.match(await docText(p), /\|c' b a g\|c' b a g\|f e d c/, "after the bar it copies");
  // 11. A tune pasted right after music gets its blank line.
  await put(two);
  await p.evaluate(() => navigator.clipboard.writeText("X:2\nT:Next\nK:C\nG A B c|]\n"));
  await p.evaluate(() => {
    const view = window.composer.view;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    view.focus();
  });
  await p.keyboard.press("Control+v");
  await settled(two);
  assert.equal(
    await docText(p),
    `${two}\nX:2\nT:Next\nK:C\nG A B c|]\n`,
    "a blank line keeps the tunes apart",
  );
  // 12. While a selection loops, clicking a note keeps the loop in sight.
  geo = await put(two);
  await choose([of(two, "g a b c'")]);
  await p.keyboard.press("Control+Alt+Enter");
  await p.waitForFunction(() => window.composer.player.status === "playing");
  await p.keyboard.press("Control+Shift+L");
  await p.waitForFunction(() => window.composer.player.loopingRegion);
  const d = geo.notes.find((each) => Math.abs(each.time - 0.25) < 1e-6);
  await p.mouse.click(d.head + 3, d.y);
  await p.waitForFunction(() => document.querySelectorAll(".score-band.loop").length > 0);
  await p.keyboard.press("Control+Shift+L");
  await p.keyboard.press("Control+Period");
  await p.waitForFunction(() => document.querySelectorAll(".score-band.loop").length === 0);
  await ctx.close();
  console.log(
    "Composer: selection hardening round 5: Backspace over a repeat, the score keeping its keys, marks placed by kind, no nested repeats, the Kesh's parts swapped, the chorale's voices in step, bars pasted after a part-bar selection, pasted and duplicated notes selected, tunes kept apart, the loop in sight: passed",
  );
}

/* 35. Selection hardening, round 6: paste, lyrics and selections across voices. */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  watch(ctx);
  const p = await ctx.newPage();
  await p.goto(url);
  await openExample("Ode to Joy", p);
  const put = async (t) => {
    await p.evaluate((x) => {
      const view = window.composer.view;
      if (view.state.doc.toString() !== x)
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: x } });
      view.dispatch({ selection: { anchor: 0 } });
    }, t);
    await p.waitForFunction((x) => x.includes(window.composer.scoreIndex()?.source ?? "\u0000"), t);
    await p.waitForTimeout(400);
    return p.evaluate(() => window.composer.geometry());
  };
  const choose = (list) =>
    p.evaluate((list) => {
      const view = window.composer.view;
      const S = view.state.selection.constructor;
      view.dispatch({ selection: S.create(list.map(([a, b]) => S.range(a, b))) });
      view.focus();
    }, list);
  const of = (text, part, nth = 0) => {
    let at = text.indexOf(part);
    for (let n = 0; n < nth; n++) at = text.indexOf(part, at + 1);
    return [at, at + part.length];
  };
  const settled = (was) =>
    p.waitForFunction((w) => window.composer.view.state.doc.toString() !== w, was).catch(() => {});
  const says = (id, pattern) =>
    p.waitForFunction(
      ([id, source]) => new RegExp(source).test(document.getElementById(id).textContent),
      [id, pattern.source],
    );
  // The rule: Backspace over part of a bar leaves rests, said the first time only.
  const plain = "X:1\nT:Rests\nM:4/4\nL:1/4\nK:C\nC D E F | G A B c |]\n";
  await put(plain);
  await choose([of(plain, "D E")]);
  await p.keyboard.press("Backspace");
  assert.match(
    await docText(p),
    // (By the beat, round 8: a half rest doesn't start on beat 2.)
    /\nC z z F \| G A B c \|\]\n/,
    "part of a bar: rests as long, by the beat",
  );
  await says("notice", /Notes replaced by rests/);
  await p.locator("#notice").getByRole("button", { name: "Dismiss" }).click();
  let doc = await docText(p);
  await choose([of(doc, "A B")]);
  await p.keyboard.press("Backspace");
  assert.match(await docText(p), /\| G z z c \|\]/, "again: rests");
  assert(
    await p.evaluate(() => {
      const notice = document.getElementById("notice");
      return (
        notice.hidden ||
        notice.classList.contains("leaving") ||
        !/Notes replaced by rests/.test(notice.textContent)
      );
    }),
    "said only the first time",
  );
  // 1. The Kesh's B part moved before its A part by a click on A's first note.
  const kesh =
    "X:2\nT:Kesh\nM:6/8\nL:1/8\nK:G\n|:GAG GAB|ABA ABd|edd gdd|edB dBA|\nGAG GAB|ABA ABd|edd gdB|AGF G3:|\n|:BAB dBd|ege dBA|BAB dBG|ABA AGA|\nBAB dBd|ege dBd|gfg aga|bgf g3:|\n";
  await put(kesh);
  await choose([[kesh.indexOf("BAB dBd"), kesh.lastIndexOf("g3") + 2]]);
  await p.keyboard.press("Control+x");
  doc = await docText(p);
  const geo = await p.evaluate(() => window.composer.geometry());
  const first = geo.notes.sort((a, b) => a.start - b.start)[0];
  await p.mouse.click(first.head + 3, first.y);
  await p.keyboard.press("Control+v");
  await settled(doc);
  doc = await docText(p);
  assert(doc.indexOf("BAB dBd") < doc.indexOf("GAG GAB"), "B now comes before A");
  assert.match(doc, /bgf g3::GAG GAB/, "the B part's end and the A part's start join as ::");
  // 3. In the chorale, Backspace over a text selection from the soprano into the tenor clears
  // each voice's notes only; typing over it is refused.
  const hymn =
    "X:1\nT:Old Hundredth\nM:2/2\nL:1/4\n%%score (S A) (T B)\nV:S clef=treble\nV:A clef=treble\nV:T clef=bass\nV:B clef=bass\nK:G\n[V:S] G2 | G F E D | G2 A2 | B2 B2 |]\nw: All peo-ple that on earth do dwell,\n[V:A] D2 | D D C B, | D2 D2 | D2 D2 |]\n[V:T] B,2 | B, A, G, G, | B,2 C2 | B,2 G,2 |]\n[V:B] G,2 | G, D, E, G, | G,2 F,2 | G,2 G,2 |]\n";
  await put(hymn);
  await choose([[hymn.indexOf("B2 B2"), hymn.indexOf("B,2 C2")]]);
  await p.keyboard.type("A");
  await says("explain", /Typing replaces notes in one voice/);
  assert.equal(await docText(p), hymn, "typing across voices is refused");
  await p.keyboard.press("Backspace");
  doc = await docText(p);
  for (const kept of ["[V:A]", "[V:T]", "[V:B]", "w: All", "V:S clef=treble"])
    assert(doc.includes(kept), `${kept} is kept`);
  // 4. and 7. In the duet, a paste at a caret in one voice puts rests in the other; a two-voice
  // copy on one note of the staff holding both pastes both.
  const duet =
    "X:1\nT:Duet\nM:2/4\nL:1/8\n%%score (1 2)\nK:D\n[V:1] d2 fd | ed cB |]\n[V:2] F2 AF | GF ED |]\n";
  await put(duet);
  await p.evaluate(() => navigator.clipboard.writeText("a2 a2|"));
  await p.evaluate((at) => {
    const view = window.composer.view;
    view.dispatch({ selection: { anchor: at } });
    view.focus();
  }, duet.indexOf("ed cB"));
  await p.keyboard.press("Control+v");
  await settled(duet);
  doc = await docText(p);
  assert.match(doc, /\[V:1\] d2 fd \| a2 a2\| ?ed cB/, "pasted in V:1");
  assert.match(doc, /\[V:2\] F2 AF \|[^\n]*z4[^\n]*GF ED/, "a bar's rest in V:2, in step");
  await says("notice", /rests in V:2 keep it in step/);
  await put(duet);
  await p.evaluate(() => navigator.clipboard.writeText("V:1\na2 a2|\nV:2\nA2 A2|\n"));
  await p.evaluate((at) => {
    const view = window.composer.view;
    view.dispatch({ selection: { anchor: at } });
    view.focus();
  }, duet.indexOf("ed cB"));
  await p.keyboard.press("Control+v");
  await settled(duet);
  doc = await docText(p);
  assert.match(doc, /\[V:1\] d2 fd \| a2 a2\| ?ed cB/, "V:1's part");
  assert.match(doc, /\[V:2\] F2 AF \| A2 A2\| ?GF ED/, "and V:2's, at the same point");
  // 5. Nothing to paste: an empty clipboard over a note changes nothing.
  await put(duet);
  await p.evaluate(() => navigator.clipboard.writeText(""));
  await choose([of(duet, "fd")]);
  await p.keyboard.press("Control+v");
  await p.waitForTimeout(300);
  assert.equal(await docText(p), duet, "nothing pasted, nothing lost");
  // 8. A deleted note's chord symbol stays, on its rest.
  const lead = 'X:1\nT:Lead\nM:4/4\nL:1/4\nK:C\n"C"E E "G7"F F | "C"E4 |]\n';
  await put(lead);
  await choose([of(lead, '"G7"F')]);
  await p.keyboard.press("Delete");
  assert.match(await docText(p), /"C"E E "G7"z F \|/, "the chord symbol is on the rest");
  // 9. Second voice: its first rest selected; a note typed shrinks the bar's rest.
  const solo = "X:1\nT:Solo\nM:4/4\nL:1/8\n%%score 1\nK:C\nV:1\nc2 d2 e2 f2|g8|]\n";
  await put(solo);
  await menu("insert", "Second voice", p);
  await settled(solo);
  assert.deepEqual(
    await p.evaluate(() => {
      const view = window.composer.view;
      return view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
    }),
    "z8",
    "the first placeholder rest is selected",
  );
  await p.keyboard.type("c2");
  await p.waitForFunction(() =>
    /V:2 clef=bass\nc2z6 \| z8 \|/.test(window.composer.view.state.doc.toString()),
  );
  // 10. Transpose to key: the whole tune to F, its key signature with it.
  const tune = 'X:1\nT:Up\nM:4/4\nL:1/4\nK:C\n"C"C E G c |]\n';
  await put(tune);
  await menu("edit", "Notes", p);
  await p.getByRole("menuitem", { name: "Transpose to key…" }).click();
  await p.locator("#transpose-dialog select").selectOption("F");
  await p.locator("#transpose-dialog button.primary").click();
  await p.waitForFunction(() =>
    /K:F\n"F"F A c f \|\]/.test(window.composer.view.state.doc.toString()),
  );
  // 11. Escape in the decoration menu gives the keys back to the text.
  await choose([of(tune.replace("K:C", "K:F"), "F A")]);
  await p.keyboard.press("Alt+d");
  await p.getByRole("menuitem").first().waitFor();
  await p.keyboard.press("Escape");
  assert(
    await p.evaluate(() => window.composer.view.hasFocus),
    "after Alt D then Escape, the text has the keys again",
  );
  // A selection of rests is said as rests.
  const rests = "X:1\nT:Rests\nM:4/4\nL:1/4\nK:C\nC z z z |]\n";
  await put(rests);
  await choose([of(rests, "z z z")]);
  await says("explain", /^3 rests selected/);
  await ctx.close();
  // 5. On a phone with only the score shown, Edit › Copy copies.
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  await phone.grantPermissions(["clipboard-read", "clipboard-write"]);
  watch(phone);
  const q = await phone.newPage();
  await q.goto(url);
  await openExample("Ode to Joy", q);
  await q.locator("#show-score").click();
  // (Round 7: a note tapped first, as a musician does, and the clipboard's own text read back.)
  const tapNote = async (index) => {
    const point = await q
      .locator("#score .abcjs-note")
      .nth(index)
      .evaluate((element) => {
        const head = element.querySelector("path").getBoundingClientRect();
        return { x: head.x + head.width / 2, y: head.y + head.height / 2 };
      });
    await q.touchscreen.tap(point.x, point.y);
  };
  await tapNote(2);
  await q.waitForFunction(() => !window.composer.view.state.selection.main.empty);
  const tapped = await q.evaluate(() => {
    const { state } = window.composer.view;
    return state.sliceDoc(state.selection.main.from, state.selection.main.to);
  });
  await q.evaluate(() => navigator.clipboard.writeText("nothing yet"));
  await menu("edit", "Copy", q);
  await q.waitForFunction(async () => (await navigator.clipboard.readText()) !== "nothing yet");
  assert.equal(
    (await q.evaluate(() => navigator.clipboard.readText())).trim(),
    tapped.trim(),
    "Edit › Copy after a tap copies the tapped note",
  );
  // Cut too: the note goes (a rest in its place), the clipboard has it.
  const before = await docText(q);
  await tapNote(3);
  await q.waitForFunction(() => !window.composer.view.state.selection.main.empty);
  const cutNote = await q.evaluate(() => {
    const { state } = window.composer.view;
    return state.sliceDoc(state.selection.main.from, state.selection.main.to);
  });
  await q.evaluate(() => navigator.clipboard.writeText("nothing yet"));
  await menu("edit", "Cut", q);
  await q.waitForFunction(async () => (await navigator.clipboard.readText()) !== "nothing yet");
  assert.equal((await q.evaluate(() => navigator.clipboard.readText())).trim(), cutNote.trim());
  assert.notEqual(await docText(q), before, "Edit › Cut after a tap cuts");
  await phone.close();
  console.log(
    "Composer: selection hardening round 6: rests where part of a bar goes (said once), the Kesh's parts moved by a click, the chorale across voices, the duet pasted in step, nothing to paste, chord symbols kept, a second voice typed over, Transpose to key, focus given back, rests counted, Copy on a phone: passed",
  );
}

/* 36. Selection hardening, round 7: what the regression replay found. */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  watch(ctx);
  const p = await ctx.newPage();
  await p.goto(url);
  await openExample("Ode to Joy", p);
  const put = async (t) => {
    await p.evaluate((x) => {
      const view = window.composer.view;
      if (view.state.doc.toString() !== x)
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: x } });
      view.dispatch({ selection: { anchor: 0 } });
    }, t);
    await p.waitForFunction((x) => x.includes(window.composer.scoreIndex()?.source ?? "\u0000"), t);
    await p.waitForTimeout(400);
  };
  const choose = (list) =>
    p.evaluate((list) => {
      const view = window.composer.view;
      const S = view.state.selection.constructor;
      view.dispatch({ selection: S.create(list.map(([a, b]) => S.range(a, b))) });
      view.focus();
    }, list);
  const of = (text, part, nth = 0) => {
    let at = text.indexOf(part);
    for (let n = 0; n < nth; n++) at = text.indexOf(part, at + 1);
    return [at, at + part.length];
  };
  const says = (id, pattern) =>
    p.waitForFunction(
      ([id, source]) => new RegExp(source).test(document.getElementById(id).textContent),
      [id, pattern.source],
    );
  const changed = (was) =>
    p.waitForFunction((w) => window.composer.view.state.doc.toString() !== w, was);
  const toScore = () => p.evaluate(() => document.getElementById("score-scroll").focus());
  // 9. Ctrl+Shift+D on a jig with figures repeated duplicates (the search's Ctrl+D doesn't).
  const jig = "X:1\nT:Jig\nM:6/8\nL:1/8\nK:D\n|:dAF DFA|BGB AFA|dAF DFA|GBE FED:|\n";
  await put(jig);
  await choose([of(jig, "dAF DFA")]);
  await p.keyboard.press("Control+Shift+D");
  await changed(jig);
  assert.match(
    await docText(p),
    /\|:dAF DFA\|dAF DFA\|BGB AFA\|/,
    "Ctrl+Shift+D duplicates the bar",
  );
  assert.equal(
    await p.evaluate(() => window.composer.view.state.selection.ranges.length),
    1,
    "not the next match selected",
  );
  // 7. A repeat's body with its 1st ending, Delete in the score: the 2nd ending plays once.
  const sr = "X:1\nT:SR\nM:6/8\nL:1/8\nK:G\nGAG GAB|:E3 B3|EBE AFD|1 G3 FGA:|2 BAG FE2|d3 d3|]\n";
  await put(sr);
  await choose([[sr.indexOf("E3 B3"), sr.indexOf("FGA") + 3]]);
  await toScore();
  await p.keyboard.press("Delete");
  await changed(sr);
  assert.equal(await docText(p), "X:1\nT:SR\nM:6/8\nL:1/8\nK:G\nGAG GAB| BAG FE2|d3 d3|]\n");
  await says("notice", /2nd ending's bars now play once/);
  // 11. A note letter in the score says where notes are typed; 13. Escape leaves no stale count.
  await choose([of(sr, "GAG GAB")]);
  await toScore();
  await p.keyboard.press("c");
  await says("explain", /Press Enter to edit in the text/);
  await p.keyboard.press("Escape");
  await p.waitForFunction(
    () => !/selected/.test(document.getElementById("score-live").textContent),
  );
  // 4. A text selection across the hymn's four voices: each voice's line its own, in step.
  const hymn =
    "X:1\nT:Old Hundredth\nM:2/2\nL:1/4\n%%score (S A) (T B)\nV:S clef=treble\nV:A clef=treble\nV:T clef=bass\nV:B clef=bass\nK:G\n[V:S] G2 | G F E D | G2 A2 | B2 B2 | B A G c | B2 A2 | G2 |]\n[V:A] D2 | D D C B, | D2 D2 | D2 D2 | G F G E | D2 D2 | D2 |]\n[V:T] B,2 | B, A, G, G, | B,2 C2 | B,2 G,2 | D D B, C | D2 C2 | B,2 |]\n[V:B] G,2 | G, D, E, G, | G,2 F,2 | G,2 G,2 | G, D, E, C, | D,2 D,2 | G,,2 |]\n";
  await put(hymn);
  await choose([[hymn.indexOf("G2 A2"), hymn.indexOf("| G,2 G,2") + 1]]);
  await p.keyboard.press("Delete");
  await changed(hymn);
  const voiced = (await docText(p)).split("\n").filter((line) => line.includes("[V:"));
  assert.deepEqual(
    voiced.map((line) => line.slice(0, 5)),
    ["[V:S]", "[V:A]", "[V:T]", "[V:B]"],
    "every voice marker first on its own line",
  );
  assert.equal(new Set(voiced.map((line) => line.split("|").length)).size, 1, "voices in step");
  // 1. A copy longer than the notes it's pasted over: forward, the other voice as it was.
  const trio =
    "X:1\nT:t\nM:3/4\nL:1/8\n%%score 1 2\nK:F\nV:1\nc4 f2|e4 g2|f2 a2 c'2|\nV:2\nA4 c2|c4 e2|c2 f2 a2|\n";
  await put(trio);
  await p.evaluate(() => navigator.clipboard.writeText("f4 g2|"));
  await choose([[trio.indexOf("A4 c2") + 3, trio.indexOf("A4 c2") + 5]]);
  await p.keyboard.press("Control+v");
  await changed(trio);
  assert.match(
    await docText(p),
    /V:1\nc4 f2\|e4 g2\|f2 a2 c'2\|\nV:2\nA4 f2-\|f2 g2 e2\|c2 f2 a2\|/,
  );
  await says("notice", /ran on over 1 more note, replaced/);
  // 5. A two-voice copy on a clicked note of the duet (%%score after K:): both voices.
  const duet =
    'X:1\nT:Fiddle Duet\nM:2/4\nL:1/8\nK:D\n%%score (1 2)\nV:1 name="Fiddle 1"\nV:2 name="Fiddle 2"\n[V:1] d2 fd | ed cB | A2 FA | d4 :|\n[V:2] F2 AF | GF ED | C2 DC | D4 :|\n';
  await put(duet);
  await p.evaluate(() => navigator.clipboard.writeText("V:1\ned cB |\nV:2\nGF ED |\n"));
  await choose([of(duet, "d4")]);
  await toScore();
  await p.keyboard.press("Control+v");
  await changed(duet);
  assert.match(await docText(p), /\| A2 FA \| ed cB \|\s*d4 :\|/);
  assert.match(await docText(p), /\| C2 DC \| GF ED \|\s*D4 :\|/);
  // 12. Halved in one voice of two: a rest, in step.
  const two = "X:1\nT:t\nM:4/4\nL:1/4\n%%score 1 2\nK:C\nV:1\nc2 d2|e4|]\nV:2\nC2 D2|E4|]\n";
  await put(two);
  await choose([of(two, "c2 d2")]);
  await p.keyboard.press("Alt+BracketLeft");
  await changed(two);
  assert.match(await docText(p), /V:1\nc d z2\|e4\|\]/);
  // 13. Undo says so, in place of what the edit said.
  await p.keyboard.press("Control+z");
  await says("explain", /^Undone\./);
  // 6. Bar lines typed into a second voice's placeholders: no bars of nothing.
  const solo = "X:1\nT:Solo\nM:4/4\nL:1/8\n%%score 1\nK:C\nV:1\nc2 d2 e2 f2|g8|]\n";
  await put(solo);
  await menu("insert", "Second voice", p);
  await changed(solo);
  await p.keyboard.type("c2 d2 e2 f2 | g8 |");
  await p.waitForTimeout(300);
  const second = (await docText(p)).split("V:2")[1]?.split("\n")[1] ?? "";
  assert(!/\|\s*\|/.test(second), `no bar of nothing: ${second}`);
  assert.match(second, /^c2 d2 e2 f2 ?\| ?g8 ?\|/, second);
  await ctx.close();
  console.log(
    "Composer: selection hardening round 7: Duplicate on a jig, a repeat's body and 1st ending deleted, the score's typing hint and Escape, the hymn's voices across a text delete, a paste overwriting forward, the duet's voices pasted, halved in step, Undone said, bar lines typed into a second voice: passed",
  );
}

/* 37. Selection hardening, round 8: the editing rules as a musician judges them. */
{
  const fakeMidi = () => {
    const input = { id: "fake-1", name: "Fake Keys 49", type: "input", state: "connected" };
    const access = {
      inputs: new Map([[input.id, input]]),
      outputs: new Map(),
      sysexEnabled: false,
    };
    navigator.requestMIDIAccess = async () => access;
    const send = (bytes) => input.onmidimessage?.({ data: new Uint8Array(bytes) });
    window.__midi = {
      play: (notes) => {
        for (const note of notes) send([0x90, note, 90]);
        for (const note of notes) send([0x80, note, 0]);
      },
    };
  };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  watch(ctx);
  await ctx.addInitScript(fakeMidi);
  const p = await ctx.newPage();
  await p.goto(url);
  await openExample("Ode to Joy", p);
  const put = async (t) => {
    await p.evaluate((x) => {
      const view = window.composer.view;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: x } });
      view.dispatch({ selection: { anchor: 0 } });
    }, t);
    await p.waitForFunction((x) => x.includes(window.composer.scoreIndex()?.source ?? "\u0000"), t);
    await p.waitForTimeout(400);
  };
  const choose = (list) =>
    p.evaluate((list) => {
      const view = window.composer.view;
      const S = view.state.selection.constructor;
      view.dispatch({ selection: S.create(list.map(([a, b]) => S.range(a, b))) });
      view.focus();
    }, list);
  const of = (text, part) => [text.indexOf(part), text.indexOf(part) + part.length];
  const changed = (was) =>
    p.waitForFunction((w) => window.composer.view.state.doc.toString() !== w, was);
  const ranges = () =>
    p.evaluate(() =>
      window.composer.view.state.selection.ranges.map((range) => [range.from, range.to]),
    );
  // 1. Tunes › Sort with a selection: never a crossed range, the next key replaces nothing more.
  const book = "X:1\nT:Zebra\nK:C\nC D E F|]\n\nX:2\nT:Apple\nK:G\nG A B c|]\n";
  await put(book);
  await choose([of(book, "D E")]);
  await menu("tunes", "Sort tunes…", p);
  await p
    .locator("#sort-tunes[open]")
    .getByLabel("Title")
    .check()
    .catch(() => {});
  await p.locator("#sort-tunes[open]").getByRole("button", { name: "Sort" }).click();
  await changed(book);
  for (const [from, to] of await ranges()) assert(from <= to, `no crossed range: ${from}–${to}`);
  const sorted = await docText(p);
  assert.match(sorted, /^X:1\nT:Apple|^X:2\nT:Apple/, sorted);
  await p.keyboard.type("A");
  assert.equal((await docText(p)).length, sorted.length + 1, "the next key types one letter");
  // (a) A pitch typed over one note keeps its length and marks.
  const one = 'X:1\nT:t\nM:4/4\nL:1/8\nK:C\n"Am"!f!G6 z2|]\n';
  await put(one);
  await choose([of(one, '"Am"!f!G6')]);
  await p.keyboard.type("A");
  await changed(one);
  assert.match(await docText(p), /\n"Am"!f!A6 z2\|\]/, "re-pitched in place");
  // 5. Melody search after an edit: F3 goes on to the next match, never outside the text.
  const tune = "X:1\nT:t\nM:4/4\nL:1/4\nK:C\nC D E F | G F E D | C D E F | C D E F |]\n";
  await put(tune);
  await p.locator(".cm-content").focus();
  await p.keyboard.press("Control+Shift+M");
  await p.locator("#melody-query").fill("C D E F");
  await p.waitForFunction(() =>
    /3 matches/.test(document.querySelector(".melody-count")?.textContent ?? ""),
  );
  await p.locator(".melody-result").first().click();
  await p.evaluate(() => {
    const view = window.composer.view;
    view.dispatch({ changes: { from: 0, to: 0, insert: "% a note\n" } });
    const doc = view.state.doc.toString();
    const at = doc.indexOf("C D E F");
    view.dispatch({ changes: { from: at + 6, to: at + 7, insert: "G2" } });
  });
  await p.keyboard.press("F3");
  const picked = await p.evaluate(() => {
    const { state } = window.composer.view;
    return state.sliceDoc(state.selection.main.from, state.selection.main.to);
  });
  assert.equal(picked, "C D E F", "F3 after the edit selects the next match, moved with the text");
  await p.locator(".melody-close").click();
  // 2. MIDI step entry over a selection: forward, the next note selected; across voices refused.
  const steps =
    "X:1\nT:Midi\nM:4/4\nL:1/8\n%%score (1 2)\nK:C\nV:1\nc2 d2 e2 f2 | g4 a4 |]\nV:2\nC4 E4 | G,4 C4 |]\n";
  await put(steps);
  await menu("play", "MIDI keyboard…", p);
  await p.locator("#midi-panel").waitFor();
  await p.getByLabel("Write it at the caret (step entry)").check();
  await p.locator("#midi-panel").focus();
  await p.keyboard.press("4");
  await choose([of(steps, "g4 a4")]);
  await p.evaluate(() => window.__midi.play([64]));
  await changed(steps);
  assert.match(
    await docText(p),
    /V:1\nc2 d2 e2 f2 \| E2 z2 z4 \|\]/,
    "a quarter from g4: the selection left as rests, by the beat",
  );
  assert.equal(
    await p.evaluate(() => {
      const { state } = window.composer.view;
      return state.sliceDoc(state.selection.main.from, state.selection.main.to);
    }),
    "z2",
    "the next note selected",
  );
  const now = await docText(p);
  await choose([[now.indexOf("a4 |]"), now.indexOf("C4 E4") + 5]]);
  await p.evaluate(() => window.__midi.play([69]));
  await p.waitForFunction(() =>
    /writes in one voice/.test(document.querySelector(".midi-status")?.textContent ?? ""),
  );
  assert.equal(await docText(p), now, "no voices merged");
  await ctx.close();
  console.log(
    "Composer: selection hardening round 8: Sort with a selection, a note re-pitched, melody results after an edit, MIDI steps over a selection: passed",
  );
}

/* 38. Selection hardening, round 9: the conformance sweep's cases that need the UI. */
{
  const fakeMidi = () => {
    const input = { id: "fake-1", name: "Fake Keys 49", type: "input", state: "connected" };
    const access = {
      inputs: new Map([[input.id, input]]),
      outputs: new Map(),
      sysexEnabled: false,
    };
    navigator.requestMIDIAccess = async () => access;
    const send = (bytes) => input.onmidimessage?.({ data: new Uint8Array(bytes) });
    window.__midi = {
      play: (notes) => {
        for (const note of notes) send([0x90, note, 90]);
        for (const note of notes) send([0x80, note, 0]);
      },
    };
  };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  watch(ctx);
  await ctx.addInitScript(fakeMidi);
  const p = await ctx.newPage();
  await p.goto(url);
  await openExample("Ode to Joy", p);
  const put = async (t) => {
    await p.evaluate((x) => {
      const view = window.composer.view;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: x } });
      view.dispatch({ selection: { anchor: 0 } });
    }, t);
    await p.waitForFunction((x) => x.includes(window.composer.scoreIndex()?.source ?? "\u0000"), t);
    await p.waitForTimeout(400);
  };
  const choose = (list) =>
    p.evaluate((list) => {
      const view = window.composer.view;
      const S = view.state.selection.constructor;
      view.dispatch({ selection: S.create(list.map(([a, b]) => S.range(a, b))) });
      view.focus();
    }, list);
  const of = (text, part) => [text.indexOf(part), text.indexOf(part) + part.length];
  const says = (id, pattern) =>
    p.waitForFunction(
      ([id, source]) => new RegExp(source).test(document.getElementById(id).textContent),
      [id, pattern.source],
    );
  // 7. Typing over a range in each of two voices is refused, saying why; nothing changes.
  const duo =
    "X:1\nT:Duo\nM:4/4\nL:1/8\n%%score (1 2)\nK:C\nV:1\nC2 D2 E2 F2 | G8 |]\nV:2\nC,4 E,4 | G,8 |]\n";
  await put(duo);
  await choose([of(duo, "C2 D2 E2 F2"), of(duo, "C,4 E,4")]);
  await p.keyboard.type("A");
  await says("explain", /Typing replaces notes in one voice/);
  assert.equal(await docText(p), duo, "typing over two voices changes nothing");
  // 8. MIDI step entry over a range in each of two voices: refused too.
  await menu("play", "MIDI keyboard…", p);
  await p.locator("#midi-panel").waitFor();
  await p.getByLabel("Write it at the caret (step entry)").check();
  await choose([of(duo, "D2"), of(duo, "E,4")]);
  await p.evaluate(() => window.__midi.play([69]));
  await p.waitForFunction(() =>
    /writes in one voice/.test(document.querySelector(".midi-status")?.textContent ?? ""),
  );
  assert.equal(await docText(p), duo, "no step written in either voice");
  await p
    .locator(".midi-close, #midi-panel button[aria-label^='Close']")
    .first()
    .click()
    .catch(() => {});
  // Selecting only a grace group, then Delete: just it goes, never the note.
  const graces = "X:1\nT:G\nM:4/4\nL:1/8\nK:D\n{g}A2 B2 c2 d2 | e8 |]\n";
  await put(graces);
  await choose([of(graces, "{g}")]);
  await p.keyboard.press("Delete");
  await p.waitForFunction(() => !window.composer.view.state.doc.toString().includes("{g}"));
  assert.match(await docText(p), /\nA2 B2 c2 d2 \| e8 \|\]/, "the grace group alone went");
  // Duplicate of part of a bar: after it, the bar over-full, said so.
  const part = "X:1\nT:P\nM:4/4\nL:1/8\nK:C\nC2 D2 E2 F2 | G8 |]\n";
  await put(part);
  await choose([of(part, "D2")]);
  await p.keyboard.press("Control+Shift+D");
  await says("notice", /Bar 1 now has 10 eighths, 8 expected \(M:4\/4\)\. F8 goes to it/);
  assert.match(await docText(p), /\nC2 D2 D2 E2 F2 \| G8 \|\]/);
  // 19. A spacer selected with notes is never counted.
  const spaced = "X:1\nT:S\nM:4/4\nL:1/8\nK:C\nC2 D2 x4 | G8 |]\n";
  await put(spaced);
  await choose([[spaced.indexOf("C2"), spaced.indexOf("x4") + 2]]);
  await says("explain", /^2 notes selected/);
  // 18. A press just left of a mid-triplet note starts the drag on it, not on the note before.
  const trip = "X:1\nT:T\nM:4/4\nL:1/8\nK:C\nc4 (3def g2 | a8 |]\n";
  await put(trip);
  const heads = await p.evaluate(() =>
    [...document.querySelectorAll("#score .abcjs-note")].map((element) => {
      const head = element.querySelector("path").getBoundingClientRect();
      return { x: head.x, y: head.y + head.height / 2, width: head.width };
    }),
  );
  const e = heads[2];
  const g = heads[4];
  await p.mouse.move(e.x - 3, e.y);
  await p.mouse.down();
  await p.mouse.move(g.x + g.width + 3, g.y, { steps: 6 });
  await p.mouse.up();
  const picked = (await selection(p)).join(" ");
  assert.match(picked, /^ef g2/, `the drag starts on e: ${picked}`);
  await ctx.close();
  console.log(
    "Composer: selection hardening round 9: typing and MIDI over two voices refused, a grace group deleted alone, a bar over-full after Duplicate said, spacers not counted, a drag from beside a triplet note: passed",
  );
}

assert.deepEqual(errors, [], "no console errors");
assert.deepEqual(external, [], "no request leaves the site");
console.log("Composer: no console errors and no requests leaving the site: passed");
await browser.close();
await new Promise((done) => server.close(done));
