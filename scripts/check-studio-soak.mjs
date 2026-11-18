// Active-session regression, not proof of hours-long or physical-mobile stability.
// Run after pnpm site:build, or STUDIO_SOAK_URL=http://localhost:5173/studio/.
import assert from "node:assert/strict";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { chromium } from "playwright";

const budgets = {
  minimumCycles: 25,
  minimumActiveMs: 120_000,
  maximumActiveMs: 600_000,
  readyMs: 15_000,
  // A deliberately generous desktop regression ceiling: one retained current
  // document plus engine/JIT/cache variation is expected, 25 old documents is not.
  heapGrowthBytes: 24 * 1024 * 1024,
  heapGrowthRatio: 1.8,
  domNodeGrowth: 1200,
};
const dist = resolve("site/dist");
let server;
let url = process.env.STUDIO_SOAK_URL;
if (!url) {
  assert.ok(existsSync(resolve(dist, "studio/index.html")), "Run pnpm site:build first");
  server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    let file = resolve(dist, `.${pathname}`);
    if (!file.startsWith(`${dist}/`)) return response.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = resolve(file, "index.html");
    if (!existsSync(file)) return response.writeHead(404).end();
    response.writeHead(200, {
      "Content-Type":
        { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[extname(file)] ??
        "application/octet-stream",
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
const cdp = await context.newCDPSession(page);
await cdp.send("Performance.enable");
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("dialog", async (dialog) => {
  errors.push(`Unexpected dialog: ${dialog.message()}`);
  await dialog.dismiss();
});
const report = {
  passed: false,
  timestamp: new Date().toISOString(),
  browser: browser.version(),
  mode: process.env.STUDIO_SOAK_URL ? "existing-server" : "production-build",
  budgets,
  limitation: "CDP page heap excludes worker-process heap, GPU memory, and IndexedDB disk usage.",
  checkpoints: [],
  cycles: [],
};
const ready = async () => {
  await page.waitForFunction(
    () =>
      !document.getElementById("app").inert &&
      !document.getElementById("counts").textContent.includes("Updating"),
    undefined,
    { timeout: budgets.readyMs },
  );
  assert.equal(await page.locator("#retry-preview").isVisible(), false, "Preview must be healthy");
};
const save = async () => {
  const downloaded = page.waitForEvent("download");
  await page.locator("#download").click();
  const download = await downloaded;
  const source = readFileSync(await download.path(), "utf8");
  await download.delete();
  return source;
};
const open = async (source, name) => {
  await page
    .locator("#file")
    .setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(source) });
  await page.waitForFunction(
    (expected) => document.getElementById("name").value === expected,
    name,
  );
  await ready();
};
const sourceFor = (marker) => {
  const block = (i) =>
    `INT. ROOM ${i} - DAY\n\n@SPEAKER ${i}\nThe room is quiet.\n\n[[Private note ${i}]]\n\nA small light glows.\n\n\n`;
  let source = `INT. ${marker} - DAY\n\nA screenplay for sustained session checks.\n\n`;
  source += Array.from({ length: 1900 }, (_, i) => block(i)).join("");
  // Keep the opening page short and recognizable; pad an action at the end.
  source += `!${"A".repeat(499000 - source.length - 1)}`;
  assert.equal(source.length, 499000);
  assert.ok(source.split("\n").length < 20000);
  return source;
};
const baselineSource = sourceFor("SOAK BASELINE");
report.fixture = { characters: baselineSource.length, lines: baselineSource.split("\n").length };
const snapshotName = "Soak immutable baseline";
const libraryReady = () =>
  page.waitForFunction(
    () => document.querySelector(".library-list").getAttribute("aria-busy") === "false",
  );
const snapshotRestore = async () => {
  await page.locator("#recent").click();
  await libraryReady();
  await page.locator(".studio-library fieldset select").selectOption("snapshots");
  await libraryReady();
  await page
    .getByRole("button", { name: `Open ${snapshotName} as a new draft`, exact: true })
    .click();
  await page.locator(".studio-library").waitFor({ state: "hidden" });
  await ready();
  assert.match(await page.locator("#page").innerText(), /SOAK BASELINE/);
  assert.equal(await save(), baselineSource, "Restoring a snapshot must preserve exact source");
};
async function checkpoint(label) {
  await ready();
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  const metrics = Object.fromEntries(
    (await cdp.send("Performance.getMetrics")).metrics.map(({ name, value }) => [name, value]),
  );
  const workers = await page.evaluate(() => window.__studioSoak);
  const result = {
    label,
    heapBytes: metrics.JSHeapUsedSize,
    domNodes: metrics.Nodes,
    documents: metrics.Documents,
    workers,
  };
  report.checkpoints.push(result);
  assert.equal(
    workers.pending,
    0,
    "No worker messages may remain outstanding after a settled preview",
  );
  assert.equal(workers.maximumPending, 1, "Scheduler must post only one active worker calculation");
  assert.equal(workers.created, 1, "Ordinary editing must reuse its one worker");
  console.log(`Soak checkpoint: ${JSON.stringify(result)}`);
  return result;
}
async function cycle(index) {
  const started = performance.now();
  const marker = `SOAK CYCLE ${index}`;
  const source = sourceFor(marker);
  await open(source, `Soak-${index}.fountain`);
  assert.match(await page.locator("#page").innerText(), new RegExp(marker));
  const content = page.locator(".cm-content");
  await content.focus();
  await page.keyboard.press("Control+z");
  assert.equal(await save(), source, "Opening a file must start an isolated undo history");
  await content.focus();
  await page.keyboard.press("Control+End");
  // Several bursts fit inside the 180ms preview debounce. Then a pause forces
  // a worker update before another edit. Each edit is independently undoable.
  let expected = source;
  for (let burst = 0; burst < 3; burst++) {
    const addition = ` The story continues ${index}-${burst}.`;
    await page.keyboard.type(addition, { delay: 4 });
    expected += addition;
    await ready();
    // Separates CodeMirror history events (>500ms); also allows autosave work.
    await page.waitForTimeout(550);
  }
  assert.equal(await save(), expected, "Worker updates and autosave must not lose input");
  await content.focus();
  for (let undo = 0; undo < 3; undo++) await page.keyboard.press("Control+z");
  await ready();
  assert.equal(await save(), source, "Undo must exactly restore this document");
  await page.locator("#new").click();
  await ready();
  await content.focus();
  await page.keyboard.press("Control+z");
  assert.equal(await save(), "", "New must discard undo history from the prior screenplay");
  await snapshotRestore();
  // Exercise DOM creation/teardown and syntax cache lookups without retaining
  // historical source strings in test instrumentation inside the page.
  await page.locator("#workbench").click();
  await page.getByLabel("Workbench view", { exact: true }).selectOption("notes");
  assert.equal(await page.locator(".workbench-content > article").count(), 100);
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, [], "No uncaught exceptions or recovery-loss dialogs");
  return { index, elapsedMs: performance.now() - started };
}
try {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.__studioSoak = { created: 0, posted: 0, returned: 0, pending: 0, maximumPending: 0 };
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        const state = window.__studioSoak;
        state.created++;
        this.addEventListener("message", () => {
          state.returned++;
          state.pending--;
        });
      }
      postMessage(...args) {
        const state = window.__studioSoak;
        super.postMessage(...args);
        state.posted++;
        state.pending++;
        state.maximumPending = Math.max(state.maximumPending, state.pending);
      }
    };
  });
  await page.goto(url);
  await ready();
  await open(baselineSource, "Soak-baseline.fountain");
  await page.locator("#recent").click();
  await libraryReady();
  await page.getByLabel("Snapshot name").fill(snapshotName);
  await page.getByRole("button", { name: "Save snapshot of current draft", exact: true }).click();
  await page
    .getByRole("button", { name: `Open ${snapshotName} as a new draft`, exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  for (let warmup = 0; warmup < 3; warmup++) await cycle(`warmup-${warmup}`);
  const baseline = await checkpoint("warmed-baseline");
  const started = performance.now();
  while (
    report.cycles.length < budgets.minimumCycles ||
    performance.now() - started < budgets.minimumActiveMs
  ) {
    assert.ok(
      performance.now() - started < budgets.maximumActiveMs,
      "The active session exceeded the ten-minute regression timeout",
    );
    report.cycles.push(await cycle(report.cycles.length + 1));
    if (report.cycles.length % 5 === 0) await checkpoint(`cycle-${report.cycles.length}`);
  }
  report.activeDurationMs = performance.now() - started;
  const end = await checkpoint("final");
  report.heapGrowthBytes = end.heapBytes - baseline.heapBytes;
  report.heapGrowthRatio = end.heapBytes / baseline.heapBytes;
  assert.ok(
    report.heapGrowthBytes <= budgets.heapGrowthBytes,
    "Retained page heap exceeded the 24MiB growth ceiling",
  );
  assert.ok(
    report.heapGrowthRatio <= budgets.heapGrowthRatio,
    "Retained page heap exceeded the 1.8x warmed baseline ceiling",
  );
  assert.ok(
    end.domNodes - baseline.domNodes <= budgets.domNodeGrowth,
    "Detached DOM growth exceeded the regression ceiling",
  );
  assert.equal(
    end.documents,
    baseline.documents,
    "Document replacement must not leak browser documents",
  );
  assert.equal(await save(), baselineSource, "Final restored source remains exact");
  assert.match(await page.locator("#page").innerText(), /SOAK BASELINE/);
  assert.deepEqual(errors, []);
  report.passed = true;
  console.log(
    `Studio soak passed: ${report.cycles.length} measured cycles, ${(report.activeDurationMs / 1000).toFixed(1)}s active, ${(report.heapGrowthBytes / 1048576).toFixed(2)}MiB retained page-heap growth.`,
  );
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  report.errors = errors;
  const output = resolve(process.env.STUDIO_SOAK_REPORT ?? "/tmp/voxdown-studio/soak.json");
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Soak report: ${output}`);
  await browser.close();
  if (server) await new Promise((done) => server.close(done));
}
