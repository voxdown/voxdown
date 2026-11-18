// Desktop regression budgets, not a mobile benchmark. Run after pnpm site:build.
// STUDIO_PERF_URL=http://localhost:5173/studio/ uses an existing development server.
import assert from "node:assert/strict";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { chromium } from "playwright";
import { clickWorkspaceAction, ensurePreview } from "./studio-ui.mjs";

const budgets = { inputP95: 250, inputMax: 1500, commandP95: 500, commandMax: 2000, ready: 15000 };
const adaptationFrameBudget = 150;
const dist = resolve("site/dist");
let server;
let url = process.env.STUDIO_PERF_URL;
if (!url) {
  assert.ok(existsSync(resolve(dist, "studio/index.html")), "Run pnpm site:build first");
  server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    let file = resolve(dist, `.${path}`);
    if (!file.startsWith(`${dist}/`)) return response.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = resolve(file, "index.html");
    if (!existsSync(file)) return response.writeHead(404).end();
    response.writeHead(200, {
      "Content-Type":
        { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".ttf": "font/ttf" }[
          extname(file)
        ] ?? "application/octet-stream",
    });
    createReadStream(file).pipe(response);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  url = `http://127.0.0.1:${server.address().port}/studio/`;
}
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
const cpuRate = Number(process.env.STUDIO_PERF_CPU_RATE ?? 1);
assert.ok(
  Number.isFinite(cpuRate) && cpuRate >= 1 && cpuRate <= 20,
  "CPU rate must be between 1 and 20",
);
if (cpuRate !== 1) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
}
page.on("pageerror", (error) => errors.push(error.message));
const report = {
  passed: false,
  timestamp: new Date().toISOString(),
  browser: browser.version(),
  mode: process.env.STUDIO_PERF_URL ? "existing-server" : "production-build",
  budgets,
  cpuRate,
  adaptationFrameBudget,
  measurements: {},
  dom: {},
};
const ready = () =>
  page.waitForFunction(
    () =>
      !document.getElementById("app").inert &&
      !document.getElementById("counts").textContent.includes("Updating"),
    undefined,
    { timeout: budgets.ready },
  );
const open = async (source, name) => {
  const started = performance.now();
  await page
    .locator("#file")
    .setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(source) });
  await page.waitForFunction((name) => document.getElementById("name").value === name, name);
  await ready();
  return performance.now() - started;
};
const save = async () => {
  const downloaded = page.waitForEvent("download");
  await clickWorkspaceAction(page, "download");
  return readFileSync(await (await downloaded).path(), "utf8");
};
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0,
    max: sorted.at(-1) ?? 0,
  };
};
async function measure(label, action, command = false) {
  await page.evaluate(() => {
    window.__studioPerf.inputs = [];
    window.__studioPerf.longTasks = [];
    window.__studioPerf.events = [];
  });
  const started = performance.now();
  await action();
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  const metrics = await page.evaluate(() => window.__studioPerf);
  const input = stats(metrics.inputs);
  report.measurements[label] = {
    wallMs: performance.now() - started,
    keydownToNextFrameMs: input,
    longTasksMs: stats(metrics.longTasks),
    eventTimingMs: stats(metrics.events),
  };
  console.log(`${label}: ${JSON.stringify(report.measurements[label])}`);
  assert.ok(input.samples > 0, `${label} must record actual keydown events`);
  assert.ok(
    input.p95 <= (command ? budgets.commandP95 : budgets.inputP95),
    `${label} p95 ${input.p95.toFixed(1)}ms exceeds budget`,
  );
  assert.ok(
    input.max <= (command ? budgets.commandMax : budgets.inputMax),
    `${label} max ${input.max.toFixed(1)}ms exceeds budget`,
  );
}
try {
  await page.addInitScript(() => {
    window.__studioPerf = { inputs: [], longTasks: [], events: [] };
    // Delegate to native Worker; record lifecycle only, never replace its work.
    window.__studioAdaptationWorkers = [];
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        if (String(url).includes("adaptation-worker")) {
          this.adaptationRecord = { terminated: 0 };
          window.__studioAdaptationWorkers.push(this.adaptationRecord);
        }
      }
      terminate() {
        if (this.adaptationRecord) this.adaptationRecord.terminated++;
        super.terminate();
      }
    };
    addEventListener(
      "keydown",
      () => {
        const start = performance.now();
        requestAnimationFrame(() => window.__studioPerf.inputs.push(performance.now() - start));
      },
      true,
    );
    if (PerformanceObserver.supportedEntryTypes.includes("longtask"))
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__studioPerf.longTasks.push(entry.duration);
      }).observe({ type: "longtask", buffered: true });
    if (PerformanceObserver.supportedEntryTypes.includes("event"))
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__studioPerf.events.push(entry.duration);
      }).observe({ type: "event", buffered: true, durationThreshold: 16 });
  });
  await page.goto(url);
  await ready();
  await ensurePreview(page);
  // 19,950 physical lines, 499,500 UTF-16 characters: near both supported limits,
  // with 500 characters of headroom to verify sustained edits rather than rejected input.
  const block = (i) => [
    `INT. ROOM ${i} - DAY`,
    "",
    `@SPEAKER ${i}`,
    "A line of dialogue.",
    "",
    `[[Private note ${i}]]`,
    "",
    "A quiet action fills the room.",
    "",
    "",
  ];
  const lines = Array.from({ length: 1995 }, (_, i) => block(i)).flat();
  let source = lines.join("\n");
  source = `!${"A".repeat(499500 - source.length - 1)}${source}`;
  assert.equal(source.length, 499500);
  assert.equal(source.split("\n").length, 19950);
  report.source = {
    characters: source.length,
    lines: 19950,
    scenes: 1994,
    notes: 1995,
    charactersInCast: 1995,
  };
  report.measurements.openMs = await open(source, "Maximum-performance.fountain");
  assert.ok(
    await page.locator("#pdf").isEnabled(),
    "Maximum-size fixture must produce a valid page layout",
  );
  assert.equal(await save(), source);
  const content = page.locator(".cm-content");
  await content.focus();
  await page.keyboard.press("Control+End");
  const addition = "The room becomes quiet. The story continues without a pause. ";
  await measure("sustainedTyping", () => page.keyboard.type(addition.repeat(3), { delay: 20 }));
  source += addition.repeat(3);
  assert.equal(await save(), source, "Sustained input must preserve every character");
  await content.focus();
  await page.keyboard.press("Control+End");
  const burst = "More words. ";
  await measure("typingAcrossWorkerUpdates", async () => {
    for (let i = 0; i < 8; i++) {
      await page.keyboard.type(burst, { delay: 20 });
      // Exceed the preview debounce so worker results and decorations apply between bursts.
      await page.waitForTimeout(220);
    }
  });
  source += burst.repeat(8);
  assert.equal(await save(), source, "Worker updates must not lose interleaved typing");
  await content.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("(");
  assert.equal(await save(), `${source}()`, "Pairing must actually add a closer");
  await content.focus();
  await page.keyboard.press("Backspace");
  assert.equal(await save(), source);
  await content.focus();
  await measure(
    "bracketPairs",
    async () => {
      for (let i = 0; i < 12; i++) {
        await page.keyboard.type("(");
        await page.keyboard.press("Backspace");
      }
    },
    true,
  );
  assert.equal(await save(), source, "Paired deletion must exactly restore source");
  await content.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Control+Shift+ArrowLeft");
  await page.keyboard.press("Control+b");
  assert.notEqual(await save(), source, "Formatting must change the selected word");
  await content.focus();
  await page.keyboard.press("Control+b");
  assert.equal(await save(), source);
  await content.focus();
  await measure(
    "selectionFormatting",
    async () => {
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press("Control+b");
        await page.keyboard.press("Control+b");
      }
    },
    true,
  );
  assert.equal(await save(), source, "Formatting toggles must exactly restore source");
  await content.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n\n@");
  source += "\n\n@";
  await ready();
  const completionTimes = [];
  await measure(
    "characterCompletion",
    async () => {
      for (let i = 0; i < 8; i++) {
        const started = performance.now();
        await page.keyboard.press("Control+Space");
        await page.locator(".cm-tooltip-autocomplete").waitFor({ state: "visible" });
        completionTimes.push(performance.now() - started);
        await page.keyboard.press("Escape");
      }
    },
    true,
  );
  report.measurements.completionVisibleMs = stats(completionTimes);
  assert.ok(
    report.measurements.completionVisibleMs.p95 <= budgets.commandP95,
    "Completion popup must appear within the command budget",
  );
  assert.equal(await save(), source, "Opening/dismissing completion must not edit source");
  await ready();
  report.dom.editorLines = await page.locator(".cm-line").count();
  report.dom.outlineButtons = await page.locator("#scene-list button").count();
  assert.ok(report.dom.editorLines < 250, "CodeMirror must render a bounded viewport");
  assert.equal(report.dom.outlineButtons, 500, "Outline should cap rendering at 500 matches");
  await clickWorkspaceAction(page, "workbench");
  await page.getByLabel("Workbench view", { exact: true }).selectOption("characters");
  report.dom.characterRows = await page.locator(".workbench-content > details").count();
  assert.equal(report.dom.characterRows, 100);
  await page.getByLabel("Workbench view", { exact: true }).selectOption("notes");
  report.dom.noteRows = await page.locator(".workbench-content > article").count();
  assert.equal(report.dom.noteRows, 100);
  await page.keyboard.press("Escape");
  // Populate an isolated test browser database directly, then exercise real paginated UI.
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("voxdown-studio", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["snapshots", "snapshot-metadata"], "readwrite");
      for (let i = 0; i < 1200; i++) {
        const record = {
          id: `perf-${i}`,
          name: `Performance snapshot ${i}`,
          created: Date.now() + i,
        };
        tx.objectStore("snapshots").put({ ...record, source: "An independent recovery copy." });
        tx.objectStore("snapshot-metadata").put({ ...record, characters: 29 });
      }
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await clickWorkspaceAction(page, "recent");
  const library = page.locator(".studio-library");
  await library.locator("fieldset select").selectOption("snapshots");
  await page.waitForFunction(
    () => document.querySelector(".library-list").getAttribute("aria-busy") === "false",
  );
  for (let i = 0; i < 6; i++) {
    await library.getByRole("button", { name: "Load older saved work" }).click();
    await page.waitForFunction(
      () => document.querySelector(".library-list").getAttribute("aria-busy") === "false",
    );
  }
  report.dom.snapshotRows = await page.locator(".library-list > li").count();
  assert.equal(
    report.dom.snapshotRows,
    100,
    "Library DOM must stay bounded across repeated pagination",
  );
  await page.keyboard.press("Escape");
  // Exercise the actual maximum character boundary; one further printable key is rejected.
  const maximum = source.padEnd(500000, " ");
  await open(maximum, "Exact-limit.fountain");
  await content.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("x");
  assert.equal(await save(), maximum, "Maximum-source rejection must leave the original intact");
  const maximumLines = "\n".repeat(19999);
  await open(maximumLines, "Exact-line-limit.fountain");
  await content.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  assert.equal(await save(), maximumLines, "Maximum-line rejection must leave the original intact");

  // Separate explicit-operation regression: conversion must not recreate the
  // former 400–600 ms main-thread stalls at 4× CPU slowdown. Elapsed conversion
  // time is reported, not narrowly budgeted; frame availability is the contract.
  const adaptationSource = `INT. LANTERN ROOM\n\n${Array.from(
    { length: 4900 },
    (_, i) =>
      `@ROLE${i % 30}\nI found the small lantern beside the water. Keep it safe until we return at dawn.\n\n`,
  ).join("")}[[Private performance marker.]]\n`;
  assert.ok(adaptationSource.length > 440000 && adaptationSource.length < 500000);
  await open(adaptationSource, "Adaptation-performance.fountain");
  await page.waitForFunction(
    () => document.getElementById("recovery").textContent === "Draft kept in this browser",
  );
  const adaptationCommand = async () => {
    await page.locator("#commands").click();
    await page.getByLabel("Find a command", { exact: true }).fill("Adapt screenplay to VoxDown");
  };
  const adapted = () =>
    page.waitForFunction(
      () => {
        const dialog = document.querySelector(".adaptation-dialog");
        const status = dialog?.querySelector('[role="status"]')?.textContent ?? "";
        const download = dialog?.querySelector("button.primary");
        return (
          status.startsWith("Validated:") &&
          status.includes("4900 spoken lines") &&
          download &&
          !download.disabled
        );
      },
      undefined,
      { timeout: budgets.ready + 1000 },
    );
  // Warm the worker module/cache without relying on a first-load network duration.
  await adaptationCommand();
  await page.locator(".command-list button").click();
  await adapted();
  await page.locator('.adaptation-dialog button:text-is("Close")').click();
  await ready();
  await page.waitForTimeout(250);

  report.measurements.adaptation = {
    characters: adaptationSource.length,
    spokenRows: 4900,
    samples: [],
  };
  for (let sample = 0; sample < 3; sample++) {
    await adaptationCommand();
    await page.evaluate(() => {
      const state = { gaps: [], longTasks: [], started: 0, completed: 0, stopped: false };
      window.__studioAdaptationFrames = state;
      let previous;
      const frame = (now) => {
        if (previous !== undefined) state.gaps.push(now - previous);
        previous = now;
        if (!state.stopped) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      state.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          if (state.started && entry.startTime >= state.started)
            state.longTasks.push(entry.duration);
      });
      state.observer.observe({ type: "longtask" });
    });
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    await page.evaluate(() => {
      window.__studioAdaptationFrames.started = performance.now();
      document.querySelector(".command-list button").click();
    });
    await adapted();
    await page.evaluate(() => {
      window.__studioAdaptationFrames.completed = performance.now();
    });
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const sampleMetrics = await page.evaluate(() => {
      const state = window.__studioAdaptationFrames;
      state.stopped = true;
      state.observer.disconnect();
      return {
        elapsedMs: state.completed - state.started,
        frameGaps: state.gaps,
        longTasks: state.longTasks,
      };
    });
    const measurement = {
      elapsedMs: sampleMetrics.elapsedMs,
      frameGapMs: stats(sampleMetrics.frameGaps),
      longTasksMs: stats(sampleMetrics.longTasks),
    };
    report.measurements.adaptation.samples.push(measurement);
    console.log(`adaptation preparation ${sample + 1}: ${JSON.stringify(measurement)}`);
    assert.ok(measurement.frameGapMs.samples > 2, "Actual animation frames must be observed");
    assert.ok(
      measurement.frameGapMs.max <= adaptationFrameBudget,
      `Adaptation frame gap ${measurement.frameGapMs.max.toFixed(1)}ms exceeds ${adaptationFrameBudget}ms budget`,
    );
    await page.locator('.adaptation-dialog button:text-is("Close")').click();
  }
  // Opening and closing in the same task guarantees a pending request, without
  // artificial parser delays. A real worker is constructed and then terminated.
  await adaptationCommand();
  const cancellation = await page.evaluate(() => {
    const before = window.__studioAdaptationWorkers.length;
    document.querySelector(".command-list button").click();
    const dialog = document.querySelector(".adaptation-dialog");
    const pending = dialog.querySelector('[role="status"]').textContent.startsWith("Preparing");
    const started = performance.now();
    [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Close").click();
    return {
      pending,
      created: window.__studioAdaptationWorkers.length - before,
      terminated: window.__studioAdaptationWorkers.at(-1)?.terminated,
      closeMs: performance.now() - started,
      closed: !dialog.open,
      cleared: dialog.querySelector("textarea").value === "",
    };
  });
  report.measurements.adaptation.cancellation = cancellation;
  assert.equal(cancellation.pending, true);
  assert.equal(cancellation.created, 1, "Preparation uses an actual dedicated worker");
  assert.equal(cancellation.terminated, 1, "Close terminates pending native worker work");
  assert.equal(cancellation.closed && cancellation.cleared, true);
  assert.ok(cancellation.closeMs <= adaptationFrameBudget, "Cancellation remains responsive");
  assert.equal(
    await save(),
    adaptationSource,
    "Preparing/cancelling adaptation never edits source",
  );
  assert.equal(
    await page.evaluate(() =>
      window.__studioAdaptationWorkers.every((worker) => worker.terminated === 1),
    ),
    true,
    "Closing each adaptation dialog releases every worker",
  );
  assert.deepEqual(errors, [], "No page exceptions during maximum-source editing");
  report.passed = true;
  console.log(`Studio performance: passed; bounded DOM ${JSON.stringify(report.dom)}`);
} finally {
  const output = resolve(process.env.STUDIO_PERF_REPORT ?? "/tmp/voxdown-studio/performance.json");
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Performance report: ${output}`);
  await browser.close();
  if (server) await new Promise((done) => server.close(done));
}
