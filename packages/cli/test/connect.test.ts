import { mkdtemp, readFile, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toWav } from "@voxdown/produce";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyChanges } from "voxdown";
import type { Machine } from "../src/ai";
import { type Helper, startHelper } from "../src/connect";

const STORY = `---
cast:
  Tom: Tom Hale
  Mara:
---
“Who’s there?” asked Tom.

“Only me,” said Mara.
`;

/** The same story, its speakers marked. */
const MARKED = `---
cast:
  Tom: Tom Hale
  Mara:
---
@Tom “Who’s there?” he asked.

@Mara “Only me,” she said.
`;

const ANSWER = {
  answers: [
    { quote: 1, cue: "tag", speaker: "Tom", newName: "", confidence: "high" },
    { quote: 2, cue: "tag", speaker: "Mara", newName: "", confidence: "high" },
  ],
};

/** A computer with Claude Code and Kokoro. */
const machine: Machine = {
  env: {},
  platform: "linux",
  find: async (program) => (program === "claude" ? "/usr/bin/claude" : undefined),
  run: async () => ({ code: 0, stdout: JSON.stringify({ structured_output: ANSWER }), stderr: "" }),
  inFolder: async (work) => work(tmpdir()),
  fetch: (async (url: string | URL | Request) => {
    const address = String(url);
    if (address.endsWith("/v1/audio/voices"))
      return new Response(JSON.stringify({ voices: ["af_bella", "bm_george"] }));
    if (address.endsWith("/v1/audio/speech"))
      return new Response(new Uint8Array(toWav({ samples: new Float32Array(2400), rate: 24000 })));
    throw new TypeError("fetch failed");
  }) as typeof fetch,
};

let helper: Helper;
let folder = "";
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "vxd-connect-"));
  helper = await startHelper({
    machine,
    folder,
    version: "9.9.9",
    origins: ["https://voxdown.github.io"],
    port: 0,
  });
});
afterEach(async () => {
  await helper.close();
  await rm(folder, { recursive: true, force: true });
});

/** A request as a browser page would make it (or another site, or a rebound name). */
function ask(
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
}> {
  return new Promise((done, fail) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const sent = httpRequest(
      {
        host: "127.0.0.1",
        port: helper.port,
        path,
        method: options.method ?? (body ? "POST" : "GET"),
        headers: {
          host: `127.0.0.1:${helper.port}`,
          origin: "https://voxdown.github.io",
          authorization: `Bearer ${helper.token}`,
          ...(body ? { "content-type": "application/json" } : {}),
          ...options.headers,
        },
      },
      (response) => {
        let text = "";
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () =>
          done({ status: response.statusCode ?? 0, headers: response.headers, text }),
        );
      },
    );
    sent.on("error", fail);
    sent.end(body);
  });
}

const events = (text: string) =>
  text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

describe("vxd connect", () => {
  it("pairs the Writer with a key in the address's fragment", () => {
    expect(helper.pairUrl()).toBe(
      `https://voxdown.github.io/writer/#pair=127.0.0.1:${helper.port}:${helper.token}`,
    );
    expect(helper.token.length).toBeGreaterThanOrEqual(32);
  });

  it("says what is here, to the Writer with its key", async () => {
    const hello = await ask("/v1/hello");
    expect(hello.status).toBe(200);
    expect(hello.headers["access-control-allow-origin"]).toBe("https://voxdown.github.io");
    const data = JSON.parse(hello.text);
    expect(data.ais.map((ai: { id: string }) => ai.id)).toEqual(["claude", "tags"]);
    expect(data.speech.map((service: { id: string }) => service.id)).toEqual(["kokoro"]);
  });

  it("answers nothing without the key, to other sites, or to another name for this computer", async () => {
    expect((await ask("/v1/hello", { headers: { authorization: "Bearer wrong" } })).status).toBe(
      401,
    );
    expect((await ask("/v1/hello", { headers: { origin: "https://evil.example" } })).status).toBe(
      403,
    );
    expect((await ask("/v1/hello", { headers: { host: "evil.example" } })).status).toBe(421);
  });

  it("lets the Writer ask first, as browsers do", async () => {
    const preflight = await ask("/v1/tag", {
      method: "OPTIONS",
      headers: { authorization: "", "access-control-request-method": "POST" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers["access-control-allow-headers"]).toBe("authorization, content-type");
    expect(preflight.headers["access-control-allow-private-network"]).toBe("true");
  });

  it("names the speakers, saying how it goes, and sends back the changes", async () => {
    const reply = await ask("/v1/tag", { body: { text: STORY, with: "claude" } });
    expect(reply.status).toBe(200);
    expect(reply.headers["content-type"]).toBe("application/x-ndjson");
    const said = events(reply.text);
    expect(said.map((event) => event.type)).toEqual(["start", "passage", "passage", "done"]);
    const done = said.at(-1) as { changes: Array<{ from: number; to: number; insert: string }> };
    const tagged = applyChanges(STORY, done.changes);
    expect(tagged).toContain("@Tom “Who’s there?” asked Tom.");
    expect(tagged).toContain("@Mara “Only me,” said Mara.");
  });

  it("casts and prices an audiobook, in a folder where it was started", async () => {
    const reply = await ask("/v1/audiobook", {
      body: { text: STORY, name: "owl.vxd", with: "kokoro", mode: "estimate" },
    });
    const said = events(reply.text);
    expect(said.map((event) => event.type)).toEqual(["casting", "estimate", "done"]);
    expect(said[0]?.file).toBe(join(folder, "owl.audiobook", "casting.json"));
    expect(said.at(-1)?.result).toBe("estimated");
  });

  it("offers the service's voices, and each character's first words to hear them in", async () => {
    const reply = await ask("/v1/audiobook", {
      body: { text: MARKED, name: "owl.vxd", with: "kokoro", mode: "estimate" },
    });
    const casting = events(reply.text)[0] as {
      people: Array<{ name: string; id: string; sample?: string }>;
      voices: Array<{ id: string }>;
    };
    expect(casting.voices.map((voice) => voice.id)).toEqual(["af_bella", "bm_george"]);
    const tom = casting.people.find((person) => person.name === "Tom");
    expect(tom?.sample).toBe("Who’s there?");
    expect(["af_bella", "bm_george"]).toContain(tom?.id);
  });

  it("keeps the voices the Writer chose in casting.json, and refuses one the service hasn't", async () => {
    const reply = await ask("/v1/audiobook", {
      body: {
        text: MARKED,
        name: "owl.vxd",
        with: "kokoro",
        mode: "estimate",
        voices: { Tom: "af_bella", Mara: "bm_george", Nobody: "af_bella" },
      },
    });
    const casting = events(reply.text)[0] as { people: Array<{ name: string; id: string }> };
    expect(casting.people.find((person) => person.name === "Tom")?.id).toBe("af_bella");
    expect(casting.people.find((person) => person.name === "Mara")?.id).toBe("bm_george");
    const kept = JSON.parse(
      await readFile(join(folder, "owl.audiobook", "casting.json"), "utf8"),
    ) as Record<string, Record<string, string>>;
    expect(kept.kokoro).toMatchObject({ Tom: "af_bella", Mara: "bm_george" });
    expect(kept.kokoro?.Nobody).toBeUndefined();
    const wrong = await ask("/v1/audiobook", {
      body: { text: MARKED, name: "owl.vxd", with: "kokoro", voices: { Tom: "am_nobody" } },
    });
    expect(wrong.status).toBe(400);
    expect(JSON.parse(wrong.text).error).toContain("am_nobody");
  });

  it("says a character's words in a voice, to hear it before choosing it", async () => {
    const heard = await ask("/v1/listen", {
      body: { with: "kokoro", voice: "bm_george", words: "Who’s there?" },
    });
    expect(heard.status).toBe(200);
    expect(heard.headers["content-type"]).toBe("audio/wav");
    expect(heard.text.startsWith("RIFF")).toBe(true);
    const none = await ask("/v1/listen", { body: { with: "kokoro", voice: "bm_george" } });
    expect(none.status).toBe(400);
    const wrong = await ask("/v1/listen", {
      body: { with: "kokoro", voice: "am_nobody", words: "Hello." },
    });
    expect(wrong.status).toBe(400);
    expect(JSON.parse(wrong.text).error).toContain("am_nobody");
  });

  it("says plainly what went wrong", async () => {
    const missing = await ask("/v1/tag", { body: { with: "claude" } });
    expect(missing.status).toBe(400);
    expect(JSON.parse(missing.text).error).toBe("no story was sent");
    const nobody = await ask("/v1/tag", { body: { text: STORY, with: "codex" } });
    expect(JSON.parse(nobody.text).error).toBe("codex isn't here");
  });
});
