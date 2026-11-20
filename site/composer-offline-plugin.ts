import { createHash } from "node:crypto";
import { basename } from "node:path";
import type { Plugin } from "vite";

/**
 * Composer's offline worker, on Studio's pattern: the shell and the build files reachable from
 * composer/index.html are cached when the writer asks (never in the background), and instrument
 * samples are served from the cache Composer fills as each instrument is first chosen.
 */
export function composerOffline(): Plugin {
  return {
    name: "voxdown-composer-offline",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const shell = bundle["composer/index.html"];
      if (!shell || shell.type !== "asset") throw new Error("Composer offline shell is missing.");
      const content = (file: string): string => {
        const output = bundle[file];
        if (output?.type === "chunk") return output.code;
        if (output?.type === "asset")
          return typeof output.source === "string"
            ? output.source
            : Buffer.from(output.source).toString("utf8");
        return "";
      };
      const reachable = new Set<string>(["composer/index.html"]);
      const pending = ["composer/index.html"];
      // Other apps' own files (Studio's worker, for one) are never part of Composer.
      const all = Object.keys(bundle).filter(
        (file) => !file.endsWith(".html") && !/^(?:studio|writer|landing)\//.test(file),
      );
      // In scripts, text references only matter for what Rollup does not track as imports:
      // workers, fonts and CSS. The page itself names its scripts and styles as text.
      const untracked = all.filter((file) =>
        /(?:worker[^/]*\.js|\.css|\.woff2?|\.ttf)$/.test(file),
      );
      while (pending.length) {
        const file = pending.pop() as string;
        const output = bundle[file];
        const references =
          output?.type === "chunk"
            ? [...output.imports, ...output.dynamicImports, ...output.referencedFiles]
            : [];
        const text = content(file);
        // Workers and CSS font URLs are emitted as URL literals, outside Rollup's imports.
        for (const candidate of output?.type === "chunk" ? untracked : all)
          if (text.includes(basename(candidate))) references.push(candidate);
        for (const reference of references)
          if (bundle[reference] && !reachable.has(reference)) {
            reachable.add(reference);
            pending.push(reference);
          }
      }
      const files = [...reachable].sort();
      const digest = createHash("sha256");
      for (const file of files) digest.update(file).update(content(file));
      const version = digest.digest("hex").slice(0, 24);
      shell.source = content("composer/index.html").replace(
        "</head>",
        `<meta name="composer-offline-build" content="${version}">\n</head>`,
      );
      const resources = [
        ...files.map((file) => `../${file}`),
        "../icon.svg",
        "look.js",
        "sounds/LICENSE.md",
      ];
      this.emitFile({
        type: "asset",
        fileName: "composer/offline-worker.js",
        source: workerSource(version, resources),
      });
    },
  };
}

function workerSource(version: string, resources: string[]): string {
  return `"use strict";\nconst VERSION = ${JSON.stringify(version)};\nconst RESOURCE_PATHS = ${JSON.stringify(resources)};\n${String.raw`
const SCOPE = self.registration.scope;
const PREFIX = "voxdown-composer-offline:" + new URL(SCOPE).pathname + ":";
const CACHE = PREFIX + VERSION;
const SOUNDS = "voxdown-composer-sounds-v1";
const SHELL = new URL("index.html", SCOPE).href;
const URLS = RESOURCE_PATHS.map((path) => new URL(path, SCOPE).href);
const ASSETS = new Set(URLS);
const READY = new URL("offline-ready", SCOPE).href;

let preparing;
function prepare() {
  preparing ??= (async () => {
    const cache = await caches.open(CACHE);
    if (await cache.match(READY)) return;
    for (const url of URLS) {
      const response = await fetch(url, { cache: "reload", credentials: "same-origin", redirect: "error" });
      if (!response.ok) throw new Error("An offline file could not be downloaded.");
      await cache.put(url, response);
    }
    await cache.put(READY, new Response(VERSION));
  })().finally(() => { preparing = undefined; });
  return preparing;
}
self.addEventListener("install", (event) => event.waitUntil(prepare().then(() => self.skipWaiting())));
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  await self.clients.claim();
  for (const name of await caches.keys()) if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
})()));
self.addEventListener("message", (event) => {
  if (event.data?.type !== "COMPOSER_OFFLINE_STATUS" || !event.ports[0]) return;
  event.waitUntil((async () => {
    let ready = false;
    try {
      await prepare();
      ready = Boolean(await (await caches.open(CACHE)).match(READY));
    } catch {}
    event.ports[0].postMessage({ version: VERSION, ready });
  })());
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate" && (url.origin + url.pathname === SCOPE || url.origin + url.pathname === SHELL)) {
    event.respondWith((async () => {
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 2500);
      try {
        const response = await fetch(request, { signal: abort.signal });
        if (response.ok) return response;
      } catch {} finally { clearTimeout(timeout); }
      return (await (await caches.open(CACHE)).match(SHELL)) || new Response("Composer is not prepared for offline use.", { status: 503, headers: { "Content-Type": "text/plain" } });
    })());
    return;
  }
  if (url.pathname.includes("/composer/sounds/")) {
    event.respondWith((async () => {
      const sounds = await caches.open(SOUNDS);
      const cached = await sounds.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await sounds.put(request, response.clone());
      return response;
    })());
    return;
  }
  if (ASSETS.has(url.href)) event.respondWith((async () => (await (await caches.open(CACHE)).match(request)) || fetch(request))());
});
`}`;
}
