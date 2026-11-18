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
      this.emitFile({
        type: "asset",
        fileName: "studio/offline-worker.js",
        source: workerSource(version, resources),
      });
      this.emitFile({
        type: "asset",
        fileName: "studio/offline-manifest.json",
        source: JSON.stringify({ version, resources }, null, 2),
      });
    },
  };
}

function workerSource(version: string, resources: string[]): string {
  return `"use strict";\nconst VERSION = ${JSON.stringify(version)};\nconst RESOURCE_PATHS = ${JSON.stringify(resources)};\n${String.raw`
const SCOPE = self.registration.scope;
const PREFIX = "voxdown-studio-offline:" + new URL(SCOPE).pathname + ":";
const CACHE = PREFIX + VERSION;
const STAGING = CACHE + ":preparing";
const SHELL = new URL("index.html", SCOPE).href;
const URLS = RESOURCE_PATHS.map(path => new URL(path, SCOPE).href);
const ASSETS = new Set(URLS);
const READY = new URL("offline-ready", SCOPE).href;

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
      if (!await cache.match(READY)) {
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
          if (url === SHELL && !(await response.clone().text()).includes('name="studio-offline-build" content="' + VERSION + '"')) throw new Error("Studio changed while preparing offline. Retry when the update finishes.");
          await staging.put(url, response);
        }
        for (const url of URLS) await cache.put(url, await staging.match(url));
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
        const intact = (await Promise.all(URLS.map(url => cache.match(url)))).every(Boolean);
        if (!intact) await cache.delete(READY);
        await prepare();
      } catch (error) {
        event.ports[0].postMessage({ version: VERSION, ready: false, error: "Offline resources could not be saved. Check your connection and available device storage, then retry." });
        return;
      }
    }
    const cache = await caches.open(CACHE);
    // Browser eviction may remove a cache independently of its worker registration.
    const checks = await Promise.all([READY, ...URLS].map(url => cache.match(url)));
    event.ports[0].postMessage({ version: VERSION, ready: checks.every(Boolean), count: URLS.length });
    await retireUnusedVersions();
  })());
});

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
  // Exact immutable asset URLs only. Never cache imported scripts, documents or downloads.
  if (ASSETS.has(url.href) && url.href !== SHELL) {
    event.respondWith((async () => (await (await caches.open(CACHE)).match(request)) || fetch(request))());
    return;
  }
  // An already-open editor may still use a prior version's hashed lazy chunks.
  const assetRoot = new URL("../assets/", SCOPE).href;
  const workerRoot = new URL("assets/", SCOPE).href;
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
