import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { type Server, createServer } from "node:http";
import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { studioOffline } from "../studio-offline-plugin";

const font = readFileSync(new URL("../src/studio/fonts/CourierPrime-Regular.ttf", import.meta.url));
const fontPath = "assets/regular-Test.ttf";
const expectedHash = createHash("sha256").update(font).digest("hex");
let server: Server;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let origin: string;
let mode: "ok" | "corrupt" | "headers" | "body" = "ok";
let fontRequests = 0;
let closedRequests = 0;
let prefix = "";
let version = "";
const files = new Map<string, { body: string | Uint8Array; mime: string }>();

beforeAll(async () => {
  const plugin = studioOffline();
  if (typeof plugin.configResolved !== "function" || typeof plugin.generateBundle !== "function")
    throw new Error("Expected callable build hooks");
  await Reflect.apply(plugin.configResolved, undefined, [
    { publicDir: new URL("../public", import.meta.url).pathname },
  ]);
  const shell = {
    type: "asset",
    source:
      '<!doctype html><html lang="en"><head><title>Offline font check</title></head><body><script type="module" src="../assets/app-Test.js"></script></body></html>',
  };
  const app = {
    type: "chunk",
    code: `export const font="${fontPath}";`,
    imports: [],
    dynamicImports: [],
    referencedFiles: [],
  };
  const bundle = {
    "studio/index.html": shell,
    "assets/app-Test.js": app,
    [fontPath]: { type: "asset", source: font },
  };
  await Reflect.apply(
    plugin.generateBundle,
    {
      emitFile(asset: { fileName: string; source: string }) {
        files.set(asset.fileName, {
          // Shorten only the worker's font-network deadline; keep native fetch and bodies.
          body: asset.source.replaceAll("abort.abort(), 15000)", "abort.abort(), 180)"),
          mime: asset.fileName.endsWith(".js") ? "text/javascript" : "application/json",
        });
      },
    },
    [{}, bundle],
  );
  const manifest = JSON.parse(String(files.get("studio/offline-manifest.json")?.body));
  expect(manifest.fontHashes).toEqual({ [`../${fontPath}`]: expectedHash });
  version = manifest.version;
  files.set("studio/index.html", { body: shell.source, mime: "text/html" });
  files.set("assets/app-Test.js", { body: app.code, mime: "text/javascript" });
  files.set(fontPath, { body: font, mime: "font/ttf" });
  files.set("icon.svg", {
    body: readFileSync(new URL("../public/icon.svg", import.meta.url)),
    mime: "image/svg+xml",
  });
  server = createServer((request, response) => {
    let path = new URL(request.url ?? "/", "http://local").pathname;
    path = path.replace(/^\/nested\/project/, "").slice(1);
    if (path === "studio/") path = "studio/index.html";
    if (path === fontPath) {
      fontRequests++;
      response.on("close", () => closedRequests++);
      if (mode === "headers") return;
      if (mode === "body") {
        response.writeHead(200, { "content-type": "font/ttf" });
        response.write(font.subarray(0, 16));
        return;
      }
      if (mode === "corrupt") {
        response.writeHead(200, { "content-type": "font/ttf" });
        response.end(font.subarray(0, 256));
        return;
      }
    }
    const file = files.get(path);
    if (!file) return void response.writeHead(404).end();
    response.writeHead(200, { "content-type": file.mime, "cache-control": "no-store" });
    response.end(file.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No server address");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch();
});
beforeEach(async () => {
  await context?.close();
  context = await browser.newContext();
  page = await context.newPage();
  await page.addInitScript(() => {
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "STUDIO_OFFLINE_CLIENT_VERSION")
        event.ports[0]?.postMessage({
          version: document
            .querySelector('meta[name="studio-offline-build"]')
            ?.getAttribute("content"),
        });
    });
  });
  mode = "ok";
  prefix = "";
  fontRequests = closedRequests = 0;
});
afterAll(async () => {
  await browser?.close();
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});
async function install() {
  await page.goto(`${origin}${prefix}/studio/`);
  const state = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register("offline-worker.js");
    const worker = registration.installing ?? registration.waiting ?? registration.active;
    if (!worker) throw new Error("Worker not created");
    if (["activated", "redundant"].includes(worker.state)) return worker.state;
    return new Promise<string>((resolve) => {
      worker.addEventListener("statechange", () => {
        if (["activated", "redundant"].includes(worker.state)) resolve(worker.state);
      });
    });
  });
  if (state === "activated") await page.waitForFunction(() => navigator.serviceWorker.controller);
  return state;
}
function status(prepare = false) {
  return page.evaluate(async (prepare) => {
    const channel = new MessageChannel();
    const result = new Promise<{ ready: boolean; error?: string }>((resolve) => {
      channel.port1.onmessage = (event) => {
        channel.port1.close();
        resolve(event.data);
      };
    });
    navigator.serviceWorker.controller?.postMessage(
      { type: prepare ? "STUDIO_OFFLINE_PREPARE" : "STUDIO_OFFLINE_STATUS" },
      [channel.port2],
    );
    return result;
  }, prepare);
}
function fetchFont(reload = false) {
  return page.evaluate(
    async ({ path, reload }) => {
      const response = await fetch(new URL(`../${path}`, location.href), {
        cache: reload ? "reload" : "default",
      });
      const digest = await crypto.subtle.digest("SHA-256", await response.arrayBuffer());
      return {
        status: response.status,
        hash: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
          "",
        ),
      };
    },
    { path: fontPath, reload },
  );
}
async function cachedFont() {
  return page.evaluate(
    async ({ path, version }) => {
      const name = (await caches.keys()).find((name) => name.endsWith(version));
      if (!name) return null;
      const response = await (await caches.open(name)).match(new URL(`../${path}`, location.href));
      if (!response) return null;
      const digest = await crypto.subtle.digest("SHA-256", await response.arrayBuffer());
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
        "",
      );
    },
    { path: fontPath, version },
  );
}
async function corruptCache() {
  await page.evaluate(
    async ({ path, version }) => {
      const name = (await caches.keys()).find((name) => name.endsWith(version));
      if (!name) throw new Error("Cache not found");
      await (await caches.open(name)).put(
        new URL(`../${path}`, location.href),
        new Response("corrupt font", { headers: { "content-type": "font/ttf" } }),
      );
    },
    { path: fontPath, version },
  );
}

describe("verified offline fonts", () => {
  it.each([true, false])(
    "retains an old-only font URL with integrity metadata: %s",
    async (recordHash) => {
      expect(await install()).toBe("activated");
      const oldPath = "assets/regular-Old.ttf";
      const oldBytes = readFileSync(
        new URL("../src/studio/fonts/CourierPrime-Bold.ttf", import.meta.url),
      );
      const oldHash = createHash("sha256").update(oldBytes).digest("hex");
      files.set(oldPath, { body: oldBytes, mime: "font/ttf" });
      await page.evaluate(
        async ({ oldPath, oldHash, oldBytes, recordHash }) => {
          const scope = new URL("./", location.href).href;
          const cache = await caches.open(
            `voxdown-studio-offline:${new URL(scope).pathname}:${"a".repeat(24)}`,
          );
          const url = new URL(`../${oldPath}`, scope).href;
          await cache.put(url, new Response(new Uint8Array(oldBytes)));
          await cache.put(new URL("offline-ready", scope), new Response("a".repeat(24)));
          if (recordHash)
            await cache.put(
              new URL("offline-font-integrity", scope),
              new Response(JSON.stringify({ [url]: oldHash })),
            );
        },
        { oldPath, oldHash, oldBytes: [...oldBytes], recordHash },
      );
      await context.setOffline(true);
      const hash = await page.evaluate(async (path) => {
        const response = await fetch(new URL(`../${path}`, location.href));
        const digest = await crypto.subtle.digest("SHA-256", await response.arrayBuffer());
        return Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
      }, oldPath);
      expect(hash).toBe(oldHash);
    },
  );

  it.each(["", "/nested/project"])(
    "verifies build hashes, offline reads and repaired cached bytes at %s",
    async (base) => {
      prefix = base;
      expect(await install()).toBe("activated");
      expect(await status()).toMatchObject({ ready: true });
      await context.setOffline(true);
      expect(await fetchFont()).toEqual({ status: 200, hash: expectedHash });
      await context.setOffline(false);
      await corruptCache();
      expect(await status()).toMatchObject({ ready: false });
      mode = "corrupt";
      expect((await fetchFont(true)).status).toBe(503);
      expect(await cachedFont()).not.toBe(expectedHash);
      mode = "ok";
      expect(await fetchFont(true)).toEqual({ status: 200, hash: expectedHash });
      expect(await cachedFont()).toBe(expectedHash);
      expect(await status()).toMatchObject({ ready: true });
      await context.setOffline(true);
      expect(await fetchFont()).toEqual({ status: 200, hash: expectedHash });
    },
  );

  it("rejects a corrupt first prepare despite a font MIME and retries without a partial cache", async () => {
    mode = "corrupt";
    expect(await install()).toBe("redundant");
    expect(await page.evaluate(() => caches.keys())).toEqual([]);
    mode = "ok";
    expect(await install()).toBe("activated");
    expect(await status()).toMatchObject({ ready: true });
  });

  it("keeps valid offline bytes when explicit online refresh returns a bad font", async () => {
    expect(await install()).toBe("activated");
    mode = "corrupt";
    expect((await fetchFont(true)).status).toBe(503);
    expect(await cachedFont()).toBe(expectedHash);
    expect(await status()).toMatchObject({ ready: true });
    await context.setOffline(true);
    expect((await fetchFont(true)).status).toBe(503);
    expect(await fetchFont()).toEqual({ status: 200, hash: expectedHash });
  });

  it.each(["headers", "body"] as const)(
    "bounds a fresh font request stalled at %s and preserves fallback",
    async (stall) => {
      expect(await install()).toBe("activated");
      const previous = closedRequests;
      mode = stall;
      expect((await fetchFont(true)).status).toBe(503);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(closedRequests).toBeGreaterThan(previous);
      expect(await cachedFont()).toBe(expectedHash);
      mode = "ok";
      expect(await fetchFont(true)).toEqual({ status: 200, hash: expectedHash });
    },
  );

  it("fails repair honestly and preserves the shell before a verified prepare succeeds", async () => {
    expect(await install()).toBe("activated");
    await corruptCache();
    mode = "corrupt";
    expect(await status(true)).toMatchObject({ ready: false, error: expect.any(String) });
    expect(
      await page.evaluate(async () => {
        const name = (await caches.keys()).find((name) => !name.endsWith(":preparing"));
        return !!(
          name && (await (await caches.open(name)).match(new URL("index.html", location.href)))
        );
      }),
    ).toBe(true);
    mode = "ok";
    expect(await status(true)).toMatchObject({ ready: true });
    expect(await cachedFont()).toBe(expectedHash);
    expect(fontRequests).toBeGreaterThan(1);
  });
});
