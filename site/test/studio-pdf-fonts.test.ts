import { readFileSync } from "node:fs";
import { type Server, createServer } from "node:http";
import { type Browser, type Page, chromium } from "playwright";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Execute the actual loader in Chromium with native fetch/AbortController against
// a real HTTP server. PDF composition dependencies are inert: these tests exercise
// transport, body consumption and caching, never font shaping or PDF generation.
const code = transpileModule(
  readFileSync(new URL("../src/studio/pdf.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ES2022 } },
).outputText.replace(/from ["'][^"']+["']/g, 'from "/stub.js"');
let server: Server;
let browser: Browser;
let page: Page;
let origin: string;
let mode: "ok" | "headers" | "body" | "error" | "redirect" = "ok";
let requests = 0;
let closed = 0;
beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === "/pdf.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(code);
    } else if (request.url === "/stub.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(
        'export default "/font";export const PDFDocument={},rgb=()=>{},SCREENPLAY_FONT_SIZE=12,SCREENPLAY_PITCH=10,printedTypographyProblem=()=>undefined;',
      );
    } else if (request.url?.startsWith("/font")) {
      requests++;
      response.on("close", () => {
        closed++;
      });
      if (mode === "headers") return;
      if (mode === "body") {
        response.writeHead(200, { "content-type": "font/ttf" });
        response.write(Buffer.from([0, 1]));
        return;
      }
      if (mode === "error") {
        response.writeHead(503);
        response.end("Unavailable");
        return;
      }
      if (mode === "redirect") {
        response.writeHead(302, { location: "/redirected-font" });
        response.end();
        return;
      }
      response.writeHead(200, {
        "content-type": "font/ttf",
        ...(request.url === "/font-cache" ? { "cache-control": "public, max-age=3600" } : {}),
      });
      response.end(Buffer.from([0, 1, 2, 3]));
    } else {
      response.writeHead(200, { "content-type": "text/html" });
      response.end('<!doctype html><html lang="en"><body>Font transport test</body></html>');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No server address");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch();
});
beforeEach(async () => {
  await page?.close();
  mode = "ok";
  requests = closed = 0;
  page = await browser.newPage();
  await page.goto(origin);
  await page.addScriptTag({
    type: "module",
    content:
      'import {createFontLoader} from "/pdf.js";window.loadTestFont=createFontLoader(120);window.newFontLoader=createFontLoader;',
  });
  await page.waitForFunction(() => Reflect.get(window, "loadTestFont"));
});
afterAll(async () => {
  await browser?.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const load = () =>
  page.evaluate(async () => {
    try {
      return { bytes: [...(await Reflect.get(window, "loadTestFont")("/font"))] };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });
describe("bounded screenplay PDF font transport", () => {
  it.each(["headers", "body"] as const)(
    "aborts stalled %s, settles all callers and retries with a fresh request",
    async (stall) => {
      mode = stall;
      const first = load();
      const second = load();
      expect(await first).toMatchObject({ error: expect.stringContaining("timed out") });
      expect(await second).toMatchObject({ error: expect.stringContaining("timed out") });
      expect(requests).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(closed).toBe(1);
      mode = "ok";
      expect(await load()).toEqual({ bytes: [0, 1, 2, 3] });
      expect(requests).toBe(2);
      expect(await load()).toEqual({ bytes: [0, 1, 2, 3] });
      expect(requests).toBe(2);
    },
  );
  it.each(["error", "redirect"] as const)(
    "evicts a failed %s response without a poisoned retry cache",
    async (failure) => {
      mode = failure;
      expect(await load()).toMatchObject({ error: expect.stringContaining("could not be loaded") });
      mode = "ok";
      expect(await load()).toEqual({ bytes: [0, 1, 2, 3] });
      expect(requests).toBe(2);
    },
  );
  it("settles every simultaneous font request on the body deadline", async () => {
    mode = "body";
    const results = await page.evaluate(async () =>
      Promise.allSettled(
        ["/font-regular", "/font-bold", "/font-italic", "/font-bold-italic"].map((path) =>
          Reflect.get(window, "loadTestFont")(path),
        ),
      ),
    );
    expect(results.map((value) => value.status)).toEqual([
      "rejected",
      "rejected",
      "rejected",
      "rejected",
    ]);
    expect(requests).toBe(4);
    mode = "ok";
    expect(await load()).toEqual({ bytes: [0, 1, 2, 3] });
  });
  it("deduplicates successful concurrent reads and rejects cross-origin URLs before fetch", async () => {
    expect(await Promise.all([load(), load()])).toEqual([
      { bytes: [0, 1, 2, 3] },
      { bytes: [0, 1, 2, 3] },
    ]);
    expect(requests).toBe(1);
    const message = await page.evaluate(async () => {
      try {
        await Reflect.get(window, "loadTestFont")("https://outside.invalid/font");
        return "unexpected";
      } catch (error) {
        return String(error);
      }
    });
    expect(message).toContain("from this site");
    expect(requests).toBe(1);
  });
  it("evicts even a synchronous transport failure before an explicit retry", async () => {
    await page.evaluate(() => {
      Reflect.set(window, "originalFontFetch", window.fetch);
      window.fetch = (() => {
        throw new Error("Transport unavailable");
      }) as typeof fetch;
    });
    expect(await load()).toMatchObject({ error: expect.stringContaining("could not be loaded") });
    await page.evaluate(() => {
      window.fetch = Reflect.get(window, "originalFontFetch");
    });
    expect(await load()).toEqual({ bytes: [0, 1, 2, 3] });
    expect(requests).toBe(1);
  });
  it("bypasses the HTTP cache after rejected bytes and ignores late invalidation by an old consumer", async () => {
    const result = await page.evaluate(async () => {
      const loader = Reflect.get(window, "loadTestFont");
      const [first, otherConsumer] = await Promise.all([
        loader("/font-cache"),
        loader("/font-cache"),
      ]);
      loader.invalidate("/font-cache", first);
      const retry = loader("/font-cache");
      // Another export can report the same corrupt bytes while the retry is pending.
      loader.invalidate("/font-cache", otherConsumer);
      const repaired = await retry;
      // It can also finish after the retry succeeds. Neither may evict the new bytes.
      loader.invalidate("/font-cache", otherConsumer);
      return {
        shared: first === otherConsumer,
        fresh: repaired !== first,
        kept: repaired === (await loader("/font-cache")),
      };
    });
    expect(result).toEqual({ shared: true, fresh: true, kept: true });
    expect(requests).toBe(2);
  });
  it("rejects invalid timeout configuration", async () => {
    expect(
      await page.evaluate(() =>
        [0, -1, Number.POSITIVE_INFINITY, Number.NaN].map((timeout) => {
          try {
            Reflect.get(window, "newFontLoader")(timeout);
            return false;
          } catch {
            return true;
          }
        }),
      ),
    ).toEqual([true, true, true, true]);
  });
});
