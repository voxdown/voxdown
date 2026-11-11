import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toWav } from "@voxdown/produce";
import { chaptersOf, hasFfmpeg } from "@voxdown/produce/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Machine } from "../src/ai";
import { nodeIo } from "../src/node-io";
import { chapterList, fileName } from "../src/produce";
import { run } from "../src/run";

const ffmpegHere = await hasFfmpeg();

const STORY = `---
title: The Owl
author: A. Teller
language: en-GB
cast:
  Mara: Mara Stone, a fisherwoman
  Tom:
    name: Tom Hale
    about: An old ferryman.
---

# One

“Who’s there?” @Mara (softly) “Who’s there?” {pause 1s}

# Two

@Tom “Only me.” [door creaks]
`;

/** Kokoro, as its server answers: its voices, and a tone for each line. */
function kokoro(asked: Array<Record<string, unknown>>): Machine {
  return {
    env: {},
    platform: "linux",
    find: async () => undefined,
    run: async () => ({ code: 0, stdout: "", stderr: "" }),
    inFolder: async (work) => work(tmpdir()),
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      const address = String(url);
      if (address.endsWith("/v1/audio/voices"))
        return new Response(
          JSON.stringify({ voices: ["af_bella", "bf_emma", "bm_george", "am_adam"] }),
        );
      if (address.endsWith("/v1/audio/speech")) {
        const body = JSON.parse(String(init?.body)) as { input: string };
        asked.push(body);
        const samples = new Float32Array(24000 * 0.4 * Math.max(1, body.input.split(" ").length));
        for (let index = 0; index < samples.length; index++)
          samples[index] = 0.3 * Math.sin((2 * Math.PI * 180 * index) / 24000);
        return new Response(new Uint8Array(toWav({ samples, rate: 24000 })));
      }
      throw new TypeError("fetch failed");
    }) as typeof fetch,
  };
}

let folder = "";
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "vxd-produce-cli-"));
  await writeFile(join(folder, "owl.vxd"), STORY);
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

async function vxd(args: string[], machine: Machine) {
  let stdout = "";
  let stderr = "";
  const io = nodeIo({
    cwd: folder,
    machine,
    interactive: false,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });
  const code = await run(args, io);
  return { code, stdout, stderr };
}

describe("vxd produce", () => {
  it("casts the voices, says what it would cost, and makes nothing on a dry run", async () => {
    const asked: Array<Record<string, unknown>> = [];
    const result = await vxd(["produce", "owl.vxd", "--dry-run"], kokoro(asked));
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("Casting (");
    expect(result.stderr).toMatch(/Narrator +\S+/);
    expect(result.stderr).toContain("Kokoro: 5 requests");
    expect(result.stderr).toContain("free");
    expect(result.stderr).toContain("Left out: 1 sound; 1 direction (Kokoro can't follow them)");
    expect(asked).toEqual([]);
    const casting = JSON.parse(
      await readFile(join(folder, "owl.audiobook", "casting.json"), "utf8"),
    );
    // Mara, a fisherwoman, and Tom, a ferryman, get voices of their own of their gender.
    expect(casting.kokoro.Mara).toMatch(/^(Bella|Emma)$/);
    expect(casting.kokoro.Tom).toMatch(/^(George|Adam)$/);
    expect(new Set(Object.values(casting.kokoro)).size).toBe(3);
    expect(existsSync(join(folder, "owl.audiobook", "script.json"))).toBe(true);
  });

  it.runIf(ffmpegHere)("makes the book: an M4B with chapters, an MP3 each, timings", async () => {
    const asked: Array<Record<string, unknown>> = [];
    const result = await vxd(["produce", "owl.vxd", "--yes"], kokoro(asked));
    expect(result.stderr).not.toContain("vxd:");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("The Owl: 2 chapters");
    expect(result.stdout).toContain("5 lines asked of Kokoro, 0 already made.");
    const out = join(folder, "owl.audiobook");
    expect(readdirSync(join(out, "chapters")).sort()).toEqual(["01-one.mp3", "02-two.mp3"]);
    const marks = await chaptersOf(join(out, "the-owl.m4b"));
    expect(marks.map((mark) => mark.title)).toEqual(["One", "Two"]);
    const timings = JSON.parse(await readFile(join(out, "timings", "01-one.json"), "utf8"));
    expect(timings.audio).toBe("chapters/01-one.mp3");
    expect(timings.cues.map((cue: { kind: string }) => cue.kind)).toEqual([
      "speech",
      "speech",
      "speech",
      "pause",
    ]);
    const about = JSON.parse(await readFile(join(out, "about.json"), "utf8"));
    expect(about.disclosure).toContain("synthetic (AI) voices from Kokoro");
    // Again: nothing asked, everything from before.
    const again = await vxd(["produce", "owl.vxd", "--yes"], kokoro(asked));
    expect(again.stdout).toContain("0 lines asked of Kokoro, 5 already made.");
    expect(asked.length).toBe(5);
  });

  it("writes the production script and SSML with no service", async () => {
    const result = await vxd(["produce", "owl.vxd", "--script-only"], kokoro([]));
    expect(result.code).toBe(0);
    const out = join(folder, "owl.audiobook");
    expect(readdirSync(join(out, "ssml")).sort()).toEqual(["01-one.ssml", "02-two.ssml"]);
    const script = JSON.parse(await readFile(join(out, "script.json"), "utf8"));
    expect(script.format).toBe("voxdown-production/1");
  });

  it("says how to get a voice service when there is none", async () => {
    const none: Machine = {
      ...kokoro([]),
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    };
    const result = await vxd(["produce", "owl.vxd"], none);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("no voice service found: set ELEVENLABS_API_KEY");
    const named = await vxd(["produce", "owl.vxd", "--with", "kokoro"], none);
    expect(named.stderr).toContain("Kokoro isn't running: docker run -p 8880:8880");
  });

  it("sends the book to ElevenLabs Studio", async () => {
    const asked: string[] = [];
    const eleven: Machine = {
      ...kokoro([]),
      env: { ELEVENLABS_API_KEY: "k" },
      fetch: (async (url: string | URL | Request) => {
        const address = String(url);
        asked.push(address);
        if (address.includes("/v2/voices"))
          return new Response(
            JSON.stringify({
              voices: [
                {
                  voice_id: "g1",
                  name: "George",
                  labels: { gender: "male", descriptive: "narration" },
                },
                { voice_id: "l1", name: "Lily", labels: { gender: "female" } },
                { voice_id: "b1", name: "Bill", labels: { gender: "male" } },
              ],
              has_more: false,
            }),
          );
        if (address.endsWith("/v1/studio/projects"))
          return new Response(JSON.stringify({ project: { project_id: "p7" } }));
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    };
    const result = await vxd(
      ["produce", "owl.vxd", "--with", "elevenlabs", "--studio", "--yes"],
      eleven,
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("https://elevenlabs.io/app/studio/p7");
    expect(asked.some((url) => url.includes("text-to-speech"))).toBe(false);
    const wrong = await vxd(["produce", "owl.vxd", "--with", "kokoro", "--studio"], kokoro([]));
    expect(wrong.stderr).toContain("use it with --with elevenlabs");
  });

  it("takes chapters and names files as stores want them", () => {
    expect(chapterList("1,3-5")).toEqual([1, 3, 4, 5]);
    expect(() => chapterList("one")).toThrow("--chapters takes numbers");
    expect(fileName(3, "L’Été — à Paris!")).toBe("03-l-ete-a-paris");
  });
});
