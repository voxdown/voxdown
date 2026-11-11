/**
 * `vxd connect`: lets the Writer, in the browser, use the AIs and voice services on this computer.
 * A small server on 127.0.0.1 only, for as long as it runs. It opens the Writer with a one-time
 * key in the address's fragment (never sent to any server), and answers only requests that carry
 * that key, from the Writer's own address, to this computer's own name (so no other site, and no
 * site that renames itself to look local, can use it).
 *
 * It does three things: says which AIs and voice services are here; names the speakers in a
 * story with one of the AIs (`vxd tag`'s engine), sending back the changes; and makes an audiobook
 * with one of the voice services (`vxd produce`'s), in a folder beside where it was started.
 * Progress comes as it goes, one JSON object a line; closing the request stops the work.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { productionScript } from "@voxdown/produce";
import { diffChanges, parse } from "voxdown";
import { type Machine, backendNamed, findBackends } from "./ai";
import { Failure } from "./errors";
import { chooseService, fileName, makeAudiobook, speechServices } from "./produce";
import { tagStory } from "./tag";

/** Where the Writer is published. */
export const WRITER = "https://voxdown.github.io/writer/";

export type HelperOptions = {
  machine: Machine;
  /** Where books are made. */
  folder: string;
  version: string;
  /** The addresses whose pages may use it: the Writer's, and any given. */
  origins: readonly string[];
  /** Also any page served from this computer (http://localhost:…), for working on the Writer. */
  dev?: boolean;
  port?: number;
  /** The key requests must carry; a new one each run if not given. */
  token?: string;
};

export type Helper = {
  port: number;
  token: string;
  /** The Writer's address, with what it needs to connect in its fragment. */
  pairUrl(writer?: string): string;
  close(): Promise<void>;
};

/** The first free port from `from`, trying ten. */
const PORT = 47_110;

const same = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/** A request's body as JSON, up to 20 MB. */
async function bodyOf(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > 20 * 1024 * 1024) throw new Failure("that story is too long to send");
    chunks.push(chunk as Buffer);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (value && typeof value === "object") return value as Record<string, unknown>;
  } catch {}
  throw new Failure("the request wasn't JSON");
}

const text = (value: unknown) => (typeof value === "string" ? value : undefined);

export async function startHelper(options: HelperOptions): Promise<Helper> {
  const token = options.token ?? randomBytes(24).toString("base64url");
  const allowed = (origin: string) =>
    options.origins.includes(origin) ||
    Boolean(options.dev && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  let port = 0;

  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    // Only this computer's own name: a page that renames itself to look local can't get in.
    const host = request.headers.host ?? "";
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      response.writeHead(421).end();
      return;
    }
    if (origin !== undefined && !allowed(origin)) {
      response.writeHead(403).end();
      return;
    }
    if (origin) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type",
        "Access-Control-Allow-Private-Network": "true",
        "Access-Control-Max-Age": "600",
      });
      response.end();
      return;
    }
    const given = (request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (!same(given, token)) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not connected: run vxd connect again" }));
      return;
    }
    try {
      await route(request, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!response.headersSent) {
        response.writeHead(error instanceof Failure ? 400 : 500, {
          "content-type": "application/json",
        });
        response.end(JSON.stringify({ error: message }));
      } else {
        response.end(`${JSON.stringify({ type: "error", error: message })}\n`);
      }
    }
  });

  async function route(request: IncomingMessage, response: ServerResponse) {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (request.method === "GET" && path === "/v1/hello") {
      const [ais, speech] = await Promise.all([
        findBackends(options.machine),
        speechServices(options.machine),
      ]);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          name: "vxd connect",
          version: options.version,
          folder: options.folder,
          ais: [
            ...ais.map(({ id, label, kind, note }) => ({
              id,
              label,
              kind,
              ...(note ? { note } : {}),
            })),
            // Always there: the names dialogue tags give (“…” asked Mara), with no AI.
            {
              id: "tags",
              label: "Dialogue tags only (no AI)",
              kind: "local",
              note: "free and instant, but only for quotes tagged with a name in the cast",
            },
          ],
          speech: speech.map(({ id, label, note }) => ({ id, label, ...(note ? { note } : {}) })),
        }),
      );
      return;
    }
    if (request.method === "POST" && (path === "/v1/tag" || path === "/v1/audiobook")) {
      const body = await bodyOf(request);
      const story = text(body.text);
      if (story === undefined) throw new Failure("no story was sent");
      // The work stops when the Writer stops waiting.
      const stop = new AbortController();
      response.on("close", () => {
        if (!response.writableFinished) stop.abort();
      });
      const send = (event: Record<string, unknown>) => {
        if (!response.headersSent)
          response.writeHead(200, {
            "content-type": "application/x-ndjson",
            "cache-control": "no-store",
          });
        response.write(`${JSON.stringify(event)}\n`);
      };
      if (path === "/v1/tag") await tag(story, body, send, stop.signal);
      else await audiobook(story, body, send, stop.signal);
      response.end();
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "no such thing here" }));
  }

  async function tag(
    source: string,
    body: Record<string, unknown>,
    send: (event: Record<string, unknown>) => void,
    signal: AbortSignal,
  ) {
    const model = text(body.model);
    const found = await findBackends(options.machine, model ? { model } : {});
    const named = text(body.with);
    const backend = named === "tags" ? "tags" : named ? backendNamed(found, named) : found[0];
    if (!backend)
      throw new Failure(named ? `${named} isn't here` : "no AI was found on this computer");
    const minimum = text(body.min);
    send({ type: "start", ai: backend === "tags" ? "Dialogue tags" : backend.label });
    const tagged = await tagStory(parse(source), {
      backend,
      ...(minimum === "high" || minimum === "medium" || minimum === "low" ? { minimum } : {}),
      signal,
      onProgress: ({ passage, index, of, reading }) =>
        send({
          type: "passage",
          index,
          of,
          heading: passage.heading,
          asked: passage.numbers.length,
          ...(reading ? { named: reading.gifts.length } : {}),
        }),
    });
    send({
      type: "done",
      changes: diffChanges(source, tagged.source),
      proposals: tagged.proposals,
      unknown: tagged.unknown,
      carried: tagged.carried,
      joined: tagged.joined,
      problems: tagged.problems,
      ...(tagged.stopped ? { stopped: tagged.stopped } : {}),
    });
  }

  async function audiobook(
    source: string,
    body: Record<string, unknown>,
    send: (event: Record<string, unknown>) => void,
    signal: AbortSignal,
  ) {
    const story = parse(source);
    const script = productionScript(story);
    const name = text(body.name) ?? `${script.title}.vxd`;
    const mode = text(body.mode);
    const model = text(body.model);
    const service = await chooseService(
      options.machine,
      text(body.with),
      model,
      undefined,
      () => {},
    );
    const chapters = Array.isArray(body.chapters)
      ? body.chapters.filter((value): value is number => Number.isInteger(value))
      : undefined;
    const out = join(
      options.folder,
      `${fileName(0, name.replace(/\.[^.]+$/, "")).slice(3) || "story"}.audiobook`,
    );
    const result = await makeAudiobook({
      machine: options.machine,
      story,
      script,
      name,
      out,
      service,
      mode: mode === "make" || mode === "studio" ? mode : "estimate",
      sounds: body.sounds === true,
      ...(model ? { model } : {}),
      ...(chapters?.length ? { chapters } : {}),
      signal,
      onEvent: (event) => send(event),
    });
    send({ ...result, type: "done", result: result.type });
  }

  // The first free port.
  for (let tryPort = options.port ?? PORT; ; tryPort++) {
    try {
      await new Promise<void>((done, fail) => {
        server.once("error", fail);
        server.listen(tryPort, "127.0.0.1", () => {
          server.off("error", fail);
          done();
        });
      });
      break;
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "EADDRINUSE" ||
        tryPort >= (options.port ?? PORT) + 10
      )
        throw error;
    }
  }
  port = (server.address() as AddressInfo).port;
  return {
    port,
    token,
    pairUrl: (writer = WRITER) => `${writer.replace(/#.*$/, "")}#pair=127.0.0.1:${port}:${token}`,
    close: () => new Promise((done) => server.close(() => done())),
  };
}

/** Opens an address in the computer's browser; false if it can't. */
export async function openInBrowser(url: string, machine: Machine): Promise<boolean> {
  const attempts: Array<[string, string[]]> =
    machine.platform === "darwin"
      ? [["open", [url]]]
      : machine.platform === "win32"
        ? [["explorer.exe", [url]]]
        : machine.env.WSL_DISTRO_NAME
          ? [
              ["wslview", [url]],
              ["explorer.exe", [url]],
              ["xdg-open", [url]],
            ]
          : [["xdg-open", [url]]];
  for (const [program, args] of attempts) {
    const found = await machine.find(program);
    if (!found) continue;
    try {
      const { spawn } = await import("node:child_process");
      const child = spawn(found, args, { detached: true, stdio: "ignore" });
      child.on("error", () => {});
      child.unref();
      return true;
    } catch {}
  }
  return false;
}
