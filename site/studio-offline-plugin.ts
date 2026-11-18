import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { Plugin } from "vite";

/** Cache only the Studio entry's reachable graph, including lazy PDF and worker assets. */
export function studioOffline(): Plugin {
  let publicDir = "";
  return {
    name: "voxdown-studio-offline",
    apply: "build",
    enforce: "post",
    config() {
      return {
        worker: {
          rollupOptions: {
            output: {
              entryFileNames(chunk) {
                return chunk.facadeModuleId?.includes("/src/studio/")
                  ? "studio/assets/[name]-[hash].js"
                  : "assets/[name]-[hash].js";
              },
            },
          },
        },
      };
    },
    configResolved(config) {
      publicDir = config.publicDir;
    },
    generateBundle(_options, bundle) {
      const shell = bundle["studio/index.html"];
      if (!shell || shell.type !== "asset") throw new Error("Studio offline shell is missing.");
      const content = (file: string): string => {
        const output = bundle[file];
        return output?.type === "chunk"
          ? output.code
          : output?.type === "asset"
            ? typeof output.source === "string"
              ? output.source
              : Buffer.from(output.source).toString("utf8")
            : "";
      };
      const reachable = new Set<string>(["studio/index.html"]);
      const pending = ["studio/index.html"];
      const candidates = Object.keys(bundle).filter((file) => !file.endsWith(".html"));
      while (pending.length) {
        const file = pending.pop() as string;
        const output = bundle[file];
        const references =
          output?.type === "chunk"
            ? [...output.imports, ...output.dynamicImports, ...output.referencedFiles]
            : [];
        const source = content(file);
        // Vite workers and CSS font URLs are emitted as URL literals, outside Rollup imports.
        for (const candidate of candidates)
          if (source.includes(candidate) || source.includes(basename(candidate)))
            references.push(candidate);
        for (const reference of references) {
          if (bundle[reference] && !reachable.has(reference)) {
            reachable.add(reference);
            pending.push(reference);
          }
        }
      }
      const files = [...reachable].sort();
      const digest = createHash("sha256");
      for (const file of files) digest.update(file).update(content(file));
      digest.update(readFileSync(resolve(publicDir, "icon.svg")));
      const version = digest.digest("hex").slice(0, 24);
      shell.source = content("studio/index.html").replace(
        "</head>",
        `<meta name="studio-offline-build" content="${version}">\n</head>`,
      );
      const resources = [...files.map((file) => `../${file}`), "../icon.svg"];
      const fontHashes: Record<string, string> = {};
      for (const file of files.filter((file) => file.endsWith(".ttf"))) {
        const output = bundle[file];
        if (output?.type !== "asset") throw new Error("Studio font asset is missing.");
        fontHashes[`../${file}`] = createHash("sha256").update(output.source).digest("hex");
      }
      this.emitFile({
        type: "asset",
        fileName: "studio/offline-worker.js",
        source: workerSource(version, resources, fontHashes),
      });
      this.emitFile({
        type: "asset",
        fileName: "studio/offline-manifest.json",
        source: JSON.stringify({ version, resources, fontHashes }, null, 2),
      });
    },
  };
}

function workerSource(
  version: string,
  resources: string[],
  fontHashes: Record<string, string>,
): string {
  return `"use strict";\nconst VERSION = ${JSON.stringify(version)};\nconst RESOURCE_PATHS = ${JSON.stringify(resources)};\nconst FONT_PATH_HASHES = ${JSON.stringify(fontHashes)};\n${String.raw`
const SCOPE = self.registration.scope;
const PREFIX = "voxdown-studio-offline:" + new URL(SCOPE).pathname + ":";
const CACHE = PREFIX + VERSION;
const STAGING = CACHE + ":preparing";
const SHELL = new URL("index.html", SCOPE).href;
const URLS = RESOURCE_PATHS.map(path => new URL(path, SCOPE).href);
const ASSETS = new Set(URLS);
const READY = new URL("offline-ready", SCOPE).href;
const FONT_INDEX = new URL("offline-font-integrity", SCOPE).href;
const FONT_HASHES = Object.fromEntries(Object.entries(FONT_PATH_HASHES).map(([path, hash]) => [new URL(path, SCOPE).href, hash]));

async function verifiedFont(response, hash) {
  if (!response?.ok || !hash) return false;
  try {
    const digest = await crypto.subtle.digest("SHA-256", await response.clone().arrayBuffer());
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("") === hash;
  } catch { return false; }
}
async function cacheIntact(cache) {
  if (!await cache.match(READY) || !await cache.match(FONT_INDEX)) return false;
  for (const url of URLS) {
    const response = await cache.match(url);
    if (!response || (FONT_HASHES[url] && !await verifiedFont(response, FONT_HASHES[url]))) return false;
  }
  return true;
}

let preparing;
function prepare() {
  if (preparing) return preparing;
  preparing = (async () => {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 90000);
    let existed = true;
    try {
      existed = await caches.has(CACHE);
      const cache = await caches.open(CACHE);
      // A completed version is immutable. Never damage its fallback during a retry.
      if (!await cacheIntact(cache)) {
        // Stage complete responses separately so repair failure preserves the existing shell.
        await caches.delete(STAGING);
        const staging = await caches.open(STAGING);
        for (const url of URLS) {
          const response = await fetch(url, { cache: "reload", credentials: "same-origin", redirect: "error", signal: abort.signal });
          if (!response.ok || response.type === "opaque") throw new Error("An offline resource could not be downloaded.");
          const mime = response.headers.get("content-type") || "";
          if (url !== SHELL && /text\/html/.test(mime)) throw new Error("An offline resource returned a fallback page.");
          if (url.endsWith(".js") && !/javascript/.test(mime)) throw new Error("Offline script response was not JavaScript.");
          if (url.endsWith(".css") && !/text\/css/.test(mime)) throw new Error("Offline stylesheet response was not CSS.");
          if (FONT_HASHES[url] && !await verifiedFont(response, FONT_HASHES[url])) throw new Error("An offline font did not match this Studio build.");
          if (url === SHELL && !(await response.clone().text()).includes('name="studio-offline-build" content="' + VERSION + '"')) throw new Error("Studio changed while preparing offline. Retry when the update finishes.");
          await staging.put(url, response);
        }
        for (const url of URLS) await cache.put(url, await staging.match(url));
        await cache.put(FONT_INDEX, new Response(JSON.stringify(FONT_HASHES), { headers: { "Content-Type": "application/json" } }));
        await cache.put(READY, new Response(VERSION));
      }

    } catch (error) {
      if (!existed) { try { await caches.delete(CACHE); } catch {} }
      throw error;
    } finally {
      try { await caches.delete(STAGING); } catch {}
      finally {
        clearTimeout(timeout);
        preparing = undefined;
      }
    }
  })();
  return preparing;
}
self.addEventListener("install", event => event.waitUntil(prepare().then(() => self.skipWaiting())));
function clientVersion(client) {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => finish(null), 1200);
    const finish = version => {
      clearTimeout(timeout);
      channel.port1.close();
      channel.port2.close();
      resolve(typeof version === "string" && /^[a-f0-9]{24}$/.test(version) ? version : null);
    };
    channel.port1.onmessage = event => finish(event.data?.version);
    try { client.postMessage({ type: "STUDIO_OFFLINE_CLIENT_VERSION" }, [channel.port2]); }
    catch { finish(null); }
  });
}
let retiring;
function retireUnusedVersions() {
  if (retiring) return retiring;
  retiring = (async () => {
    const clients = (await self.clients.matchAll({ type: "window", includeUncontrolled: true })).filter(client => client.url.startsWith(SCOPE));
    const versions = await Promise.all(clients.map(clientVersion));
    // An unknown or still-loading editor might need any prior version. Be conservative.
    if (versions.some(version => version === null)) return;
    const complete = [];
    for (const name of await caches.keys()) {
      if (name.startsWith(PREFIX) && await (await caches.open(name)).match(READY)) complete.push(name);
    }
    const keep = new Set([CACHE, ...versions.map(version => PREFIX + version)]);
    const fallback = complete.filter(name => name !== CACHE).at(-1);
    if (fallback) keep.add(fallback);
    for (const name of complete) if (!keep.has(name)) await caches.delete(name);
  })().finally(() => { retiring = undefined; });
  return retiring;
}
self.addEventListener("activate", event => event.waitUntil((async () => {
  await self.clients.claim();
  await retireUnusedVersions();
})()));

self.addEventListener("message", event => {
  if (!["STUDIO_OFFLINE_STATUS", "STUDIO_OFFLINE_PREPARE"].includes(event.data?.type) || !event.ports[0]) return;
  event.waitUntil((async () => {
    if (event.data.type === "STUDIO_OFFLINE_PREPARE") {
      try {
        const cache = await caches.open(CACHE);
        // A partially evicted cache is not a completed version.
        const intact = await cacheIntact(cache);
        if (!intact) await cache.delete(READY);
        await prepare();
      } catch (error) {
        event.ports[0].postMessage({ version: VERSION, ready: false, error: "Offline resources could not be saved. Check your connection and available device storage, then retry." });
        return;
      }
    }
    const cache = await caches.open(CACHE);
    // Browser eviction may remove a cache independently of its worker registration.
    const intact = await cacheIntact(cache);
    event.ports[0].postMessage({ version: VERSION, ready: intact, count: URLS.length });
    await retireUnusedVersions();
  })());
});

async function fontResponse(request) {
  const url = request.url;
  let hash = FONT_HASHES[url];
  const names = (await caches.keys()).filter(name => name.startsWith(PREFIX) && !name.endsWith(":preparing"));
  names.sort((a, b) => Number(b === CACHE) - Number(a === CACHE));
  const targets = [];
  for (const name of names) {
    const cache = await caches.open(name);
    const response = await cache.match(request);
    if (!hash) {
      try {
        const recorded = await (await cache.match(FONT_INDEX))?.json();
        if (typeof recorded?.[url] === "string" && /^[a-f0-9]{64}$/.test(recorded[url])) hash = recorded[url];
      } catch {}
    }
    if (!response) continue;
    targets.push({ name, cache, response });
  }
  if (request.cache !== "reload") {
    for (const target of targets) {
      // Legacy active clients may predate font-integrity metadata. Their exact
      // hashed URLs retain their prior fallback behavior; new versions verify.
      if (!hash || await verifiedFont(target.response, hash)) return target.response;
    }
  }
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 15000);
  try {
    const response = await fetch(request, { cache: "reload", mode: "same-origin", credentials: "same-origin", redirect: "error", signal: abort.signal });
    if (!response.ok) throw new Error("Font response failed.");
    await response.clone().arrayBuffer();
    if (hash && !await verifiedFont(response, hash)) throw new Error("Font response did not match its build.");
    // Preserve fallback bytes until a complete, verified replacement is ready.
    // A cache-write failure must not prevent this online PDF from using valid bytes.
    if (hash) for (const target of targets) {
      try { if (await caches.has(target.name)) await target.cache.put(request, response.clone()); } catch {}
    }
    return response;
  } catch {
    // The caller explicitly rejected its prior bytes, or verification found bad
    // bytes. Replaying them would turn retry into a permanently failing loop.
    return new Response("Reconnect and retry the screenplay font download.", { status: 503, headers: { "Content-Type": "text/plain" } });
  } finally { clearTimeout(timeout); }
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const isShell = request.mode === "navigate" && (url.origin + url.pathname === SCOPE || url.origin + url.pathname === SHELL);
  if (isShell) {
    event.respondWith((async () => {
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 2500);
      try {
        const response = await fetch(request, { signal: abort.signal });
        if (response.ok) {
          // Headers alone are not success: a stalled HTML body must meet the same deadline.
          await response.clone().arrayBuffer();
          return response;
        }
      } catch {}
      finally { clearTimeout(timeout); }
      const cached = await (await caches.open(CACHE)).match(SHELL);
      return cached || new Response("Studio is not prepared for offline use. Reconnect and prepare it again.", { status: 503, headers: { "Content-Type": "text/plain" } });
    })());
    return;
  }
  // Verify cached fonts and respect an explicit retry's rejected prior bytes.
  const assetRoot = new URL("../assets/", SCOPE).href;
  const workerRoot = new URL("assets/", SCOPE).href;
  if (url.origin === self.location.origin && url.pathname.endsWith(".ttf") && (ASSETS.has(url.href) || url.href.startsWith(assetRoot))) {
    event.respondWith(fontResponse(request));
    return;
  }
  // Exact immutable asset URLs only. Never cache imported scripts, documents or downloads.
  if (ASSETS.has(url.href) && url.href !== SHELL) {
    event.respondWith((async () => (await (await caches.open(CACHE)).match(request)) || fetch(request))());
    return;
  }
  // An already-open editor may still use a prior version's hashed lazy chunks.
  if ((url.href.startsWith(assetRoot) || url.href.startsWith(workerRoot)) && url.origin === self.location.origin) {
    event.respondWith((async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith(PREFIX) && !name.endsWith(":preparing")) {
          const cached = await (await caches.open(name)).match(request);
          if (cached) return cached;
        }
      }
      return fetch(request);
    })());
  }
});
`}`;
}
