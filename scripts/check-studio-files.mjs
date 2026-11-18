// Built-site direct-save integration. Fake native picker/streams; no real OS file access.
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { chromium } from "playwright";
import { clickWorkspaceAction } from "./studio-ui.mjs";

const dist = resolve("site/dist");
const server = createServer((request, response) => {
  let file = resolve(dist, `.${decodeURIComponent(new URL(request.url, "http://local").pathname)}`);
  if (!file.startsWith(`${dist}/`)) return response.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) file = resolve(file, "index.html");
  if (!existsSync(file)) return response.writeHead(404).end();
  response.writeHead(200, {
    "Content-Type":
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".ttf": "font/ttf",
        ".svg": "image/svg+xml",
      }[extname(file)] ?? "application/octet-stream",
  });
  response.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = process.env.STUDIO_FILES_BASE_URL ?? `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const ready = (page) => page.waitForFunction(() => !document.getElementById("app").inert);
const open = async (page, source, name = "Source.fountain") => {
  await page.locator("#file").setInputFiles({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(source),
  });
  await page.waitForFunction((name) => document.getElementById("name").value === name, name);
  await ready(page);
};
const text = (page) =>
  page.locator(".cm-line").evaluateAll((nodes) => nodes.map((node) => node.textContent).join("\n"));
const save = async (page) => {
  await clickWorkspaceAction(page, "save-file");
  await page.waitForFunction(() => !document.getElementById("save-file").disabled);
};
const makeContext = async ({ blockedRecovery = false, supported = true } = {}) => {
  const context = await browser.newContext({ acceptDownloads: true });
  await context.addInitScript(
    ({ blockedRecovery, supported }) => {
      if (blockedRecovery)
        Object.defineProperty(indexedDB, "open", {
          value: () => {
            throw new DOMException("Recovery deliberately blocked for this test", "SecurityError");
          },
        });
      let bytes = new TextEncoder().encode("original");
      let staged;
      let finishClose;
      const test = {
        writes: 0,
        closes: 0,
        aborts: 0,
        picks: 0,
        delayClose: false,
        cancel: false,
        fail: null,
        get text() {
          return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
        },
        external(value) {
          bytes = new TextEncoder().encode(value);
        },
        release() {
          finishClose?.();
        },
      };
      window.studioFileTest = test;
      const handle = {
        name: "Chosen.fountain",
        async getFile() {
          const copy = bytes.slice();
          return { size: copy.length, arrayBuffer: async () => copy.buffer };
        },
        async createWritable() {
          if (test.fail) throw new DOMException("Simulated write failure", test.fail);
          return {
            async write(value) {
              test.writes++;
              staged = value.slice();
            },
            async close() {
              test.closes++;
              if (test.delayClose)
                await new Promise((resolve) => {
                  finishClose = resolve;
                });
              bytes = staged;
            },
            async abort() {
              test.aborts++;
            },
          };
        },
      };
      Object.defineProperty(window, "showSaveFilePicker", {
        configurable: true,
        value: supported
          ? async () => {
              test.picks++;
              if (test.cancel) throw new DOMException("Picker cancelled", "AbortError");
              return handle;
            }
          : undefined,
      });
    },
    { blockedRecovery, supported },
  );
  return context;
};
try {
  const context = await makeContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/studio/`);
  await ready(page);
  const source = "\uFEFFINT. CAFÉ - DAY\r\n\nADA\rHello 龍.\n";
  await open(page, source);
  await save(page);
  assert.equal(await page.evaluate(() => studioFileTest.text), source);
  assert.match(await page.locator("#file-status").textContent(), /File saved/);

  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("Earlier edit.");
  await page.evaluate(() => {
    studioFileTest.delayClose = true;
  });
  await clickWorkspaceAction(page, "save-file");
  await page.waitForFunction(() => studioFileTest.closes === 2);
  await page.locator(".cm-content").focus();
  await page.keyboard.type(" Newer edit.");
  await page.evaluate(() => studioFileTest.release());
  await page.waitForFunction(() => !document.getElementById("save-file").disabled);
  assert.match(await page.locator("#file-status").textContent(), /Edits not yet saved/);
  assert.ok(!(await page.evaluate(() => studioFileTest.text)).includes("Newer edit."));
  assert.match(await page.locator("#notice").textContent(), /earlier version/);

  await page.evaluate(() => {
    studioFileTest.delayClose = false;
    studioFileTest.external("External edit.");
  });
  await save(page);
  assert.equal(await page.evaluate(() => studioFileTest.text), "External edit.");
  assert.match(await page.locator("#notice").textContent(), /not overwritten/);
  assert.equal(await page.locator("#file-status").isVisible(), false);
  await page.evaluate(() => {
    studioFileTest.cancel = true;
  });
  await save(page);
  assert.equal(await page.evaluate(() => studioFileTest.text), "External edit.");
  assert.match(await page.locator("#notice").textContent(), /cancelled/);
  await page.evaluate(() => {
    studioFileTest.cancel = false;
    studioFileTest.fail = "QuotaExceededError";
  });
  await save(page);
  assert.equal(await page.evaluate(() => studioFileTest.text), "External edit.");
  assert.match(await text(page), /Newer edit/);
  assert.match(await page.locator("#notice").textContent(), /could not be saved/);

  await page.evaluate(() => {
    studioFileTest.fail = null;
    studioFileTest.delayClose = true;
  });
  await clickWorkspaceAction(page, "save-file");
  await page.waitForFunction(() => studioFileTest.closes === 3);
  await open(page, "INT. NEW - DAY\n\nReplacement.", "New.fountain");
  await page.evaluate(() => studioFileTest.release());
  await page.waitForFunction(() => !document.getElementById("save-file").disabled);
  assert.equal(await page.locator("#file-status").isVisible(), false);
  assert.equal(await text(page), "INT. NEW - DAY\n\nReplacement.");
  assert.deepEqual(errors, []);
  await context.close();

  const blocked = await makeContext({ blockedRecovery: true });
  const guarded = await blocked.newPage();
  await guarded.goto(`${base}/studio/`);
  await ready(guarded);
  await open(guarded, "A");
  await save(guarded);
  await guarded.evaluate(() => studioFileTest.external("B"));
  await save(guarded);
  assert.equal(await guarded.evaluate(() => studioFileTest.text), "B");
  assert.equal(
    await guarded.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
    true,
    "A previous direct save is not an independent backup after an external conflict",
  );
  let confirmations = 0;
  guarded.on("dialog", async (dialog) => {
    confirmations++;
    await dialog.dismiss();
  });
  await clickWorkspaceAction(guarded, "new");
  await guarded.waitForFunction(() => !document.getElementById("app").inert);
  assert.equal(confirmations, 1, "Replacing an unprotected draft requires confirmation");
  assert.equal(await text(guarded), "A");
  // A real download still provides the pre-existing independent-copy escape hatch.
  const download = guarded.waitForEvent("download");
  await guarded.locator("#download").click();
  assert.equal(readFileSync(await (await download).path(), "utf8"), "A");
  await clickWorkspaceAction(guarded, "new");
  await guarded.waitForFunction(
    () => document.getElementById("name").value === "Untitled.fountain",
  );
  assert.equal(confirmations, 1);
  await blocked.close();

  const unsupported = await makeContext({ supported: false });
  const fallback = await unsupported.newPage();
  await fallback.goto(`${base}/studio/`);
  await ready(fallback);
  await open(fallback, source);
  assert.equal(await fallback.locator("#save-file").isVisible(), false);
  const fallbackDownload = fallback.waitForEvent("download");
  await fallback.locator(".cm-content").focus();
  await fallback.keyboard.press("Control+s");
  assert.equal(readFileSync(await (await fallbackDownload).path(), "utf8"), source);
  await unsupported.close();
  console.log(
    "Studio files: exact bytes, delayed-edit status, conflict/cancel/quota, replacement race, unavailable-recovery guard and unsupported download fallback: passed",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
