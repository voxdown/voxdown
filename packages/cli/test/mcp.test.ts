import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { StdioServerTransport, serveStdio } from "@modelcontextprotocol/server/stdio";
import { afterEach, describe, expect, it } from "vitest";
import { type Files, createVoxdownServer } from "../src/mcp";

const STORY = `---
cast:
  Tom: Tom Hale
---
“Who’s there?” asked Tom.

“Only me,” said the woman at the door.
`;

/** An app talking to the server over its standard input and output, as a 2025 client does. */
function connect(disk: Map<string, string>) {
  const input = new PassThrough();
  const output = new PassThrough();
  const files: Files = {
    cwd: "/work",
    read: async (path) => {
      const text = disk.get(path);
      if (text === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return text;
    },
    write: async (path, text) => {
      disk.set(path, text);
    },
  };
  const handle = serveStdio(() => createVoxdownServer(files, "9.9.9"), {
    transport: new StdioServerTransport(input, output),
  });
  const waiting = new Map<number, (message: Record<string, unknown>) => void>();
  let buffer = "";
  output.on("data", (chunk) => {
    buffer += String(chunk);
    for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line) as { id?: number };
      if (typeof message.id === "number") waiting.get(message.id)?.(message);
    }
  });
  let next = 1;
  const request = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<Record<string, unknown>>((done) => {
      const id = next++;
      waiting.set(id, done);
      input.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const call = async (name: string, args: Record<string, unknown>) => {
    const reply = (await request("tools/call", { name, arguments: args })) as {
      result?: {
        structuredContent?: Record<string, unknown>;
        isError?: boolean;
        content?: Array<{ text: string }>;
      };
      error?: unknown;
    };
    return reply;
  };
  const open = async () => {
    const reply = await request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    return reply;
  };
  return { request, call, open, close: () => handle.close() };
}

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

describe("vxd mcp", () => {
  it("opens as a 2025 server, with VoxDown's tools", async () => {
    const app = connect(new Map());
    close = app.close;
    const opened = (await app.open()) as { result?: { serverInfo?: { name: string } } };
    expect(opened.result?.serverInfo?.name).toBe("voxdown");
    const listed = (await app.request("tools/list")) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(listed.result.tools.map((tool) => tool.name)).toEqual([
      "voxdown_guide",
      "voxdown_story",
      "voxdown_unattributed_quotes",
      "voxdown_assign_speakers",
      "voxdown_add_character",
      "voxdown_check",
    ]);
  });

  it("also answers a 2026 app, which opens with no handshake", async () => {
    const app = connect(new Map());
    close = app.close;
    const meta = {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {},
      "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
    };
    const discovered = (await app.request("server/discover", { _meta: meta })) as {
      result?: Record<string, unknown>;
      error?: unknown;
    };
    expect(discovered.error).toBeUndefined();
    const listed = (await app.request("tools/list", { _meta: meta })) as {
      result?: { tools: Array<{ name: string }> };
    };
    expect(listed.result?.tools.length).toBe(6);
  });

  it("lists the quotes waiting for a speaker, and gives them, someone new joining the cast", async () => {
    const path = resolve("/work", "story.vxd");
    const disk = new Map([[path, STORY]]);
    const app = connect(disk);
    close = app.close;
    await app.open();
    const listed = await app.call("voxdown_unattributed_quotes", { file: "story.vxd" });
    const found = listed.result?.structuredContent as {
      revision: string;
      passage: { quotes: number[]; text: string };
      remaining: number;
    };
    expect(found.passage.quotes).toEqual([1, 2]);
    expect(found.passage.text).toContain("⟦2⟧“Only me,”");
    expect(found.remaining).toBe(0);
    const given = await app.call("voxdown_assign_speakers", {
      file: "story.vxd",
      revision: found.revision,
      answers: [
        { quote: 1, speaker: "Tom" },
        { quote: 2, speaker: "The Woman" },
      ],
    });
    expect(given.result?.structuredContent).toMatchObject({
      given: [1, 2],
      refused: [],
      joined: ["Woman"],
      waiting: 0,
    });
    expect(disk.get(path)).toContain("@Tom “Who’s there?” asked Tom.");
    expect(disk.get(path)).toContain("@Woman “Only me,”");
    expect(disk.get(path)).toContain("  Woman: The Woman");
  });

  it("refuses answers to an older revision, files that aren't stories, and changes nothing", async () => {
    const path = resolve("/work", "story.vxd");
    const disk = new Map([
      [path, STORY],
      [resolve("/work", "notes.txt"), "secret"],
    ]);
    const app = connect(disk);
    close = app.close;
    await app.open();
    const stale = await app.call("voxdown_assign_speakers", {
      file: "story.vxd",
      revision: "0000",
      answers: [{ quote: 1, speaker: "Tom" }],
    });
    expect(stale.result?.isError).toBe(true);
    expect(stale.result?.content?.[0]?.text).toMatch(/words have changed/);
    const other = await app.call("voxdown_story", { file: "notes.txt" });
    expect(other.result?.content?.[0]?.text).toMatch(/isn't a story/);
    expect(disk.get(path)).toBe(STORY);
  });

  it("adds a character, and checks a story", async () => {
    const path = resolve("/work", "story.vxd");
    const disk = new Map([[path, STORY]]);
    const app = connect(disk);
    close = app.close;
    await app.open();
    const added = await app.call("voxdown_add_character", {
      file: path,
      name: "Nan",
      fullName: "Old Nan",
      about: "Tom's grandmother; slow, kind.",
    });
    expect(added.result?.structuredContent?.cast).toEqual([
      { name: "Tom", fullName: "Tom Hale" },
      { name: "Nan", fullName: "Old Nan", about: "Tom's grandmother; slow, kind." },
    ]);
    const checked = await app.call("voxdown_check", { file: path });
    expect(checked.result?.structuredContent?.warnings).toEqual(expect.any(Array));
  });
});
