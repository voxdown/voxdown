import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Machine, backendNamed, findBackends } from "../src/ai";
import { vxd } from "./memory";

type Call = { program: string; args: readonly string[]; input: string; cwd: string };

/** A computer with the programs, servers and keys given, its programs answering with `answer`. */
function standIn(
  options: {
    programs?: string[];
    env?: Record<string, string>;
    /** JSON a local server answers with, by URL. */
    servers?: Record<string, unknown>;
    answer?: (call: Call) => Promise<{ code?: number; stdout?: string; stderr?: string }>;
  } = {},
) {
  const calls: Call[] = [];
  const requests: Array<{ url: string; body?: unknown }> = [];
  const machine: Machine = {
    env: options.env ?? {},
    platform: "linux",
    find: async (program) =>
      options.programs?.includes(program) ? `/usr/bin/${program}` : undefined,
    async run(program, args, run) {
      const call = { program, args, input: run.input, cwd: run.cwd };
      calls.push(call);
      const answer = (await options.answer?.(call)) ?? {};
      return { code: answer.code ?? 0, stdout: answer.stdout ?? "", stderr: answer.stderr ?? "" };
    },
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      const address = String(url);
      requests.push({
        url: address,
        ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      });
      const found = options.servers?.[address];
      if (found === undefined) throw new Error("connection refused");
      return new Response(JSON.stringify(found), { status: 200 });
    }) as typeof fetch,
    async inFolder(work) {
      const folder = await mkdtemp(join(tmpdir(), "vxd-test-"));
      try {
        return await work(folder);
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    },
  };
  return { machine, calls, requests };
}

const ASK = {
  instructions: "Name the speakers.",
  prompt: "⟦1⟧“Hi,” said Tom.",
  schema: { type: "object" },
};

const STORY = `---
cast:
  Tom: Tom Hale
  Mara:
---
“Who’s there?” asked Tom.

“Only me,” said Mara.
`;

const ANSWER = JSON.stringify({
  answers: [
    { quote: 1, cue: "tag", speaker: "Tom", newName: "", confidence: "high" },
    { quote: 2, cue: "tag", speaker: "Mara", newName: "", confidence: "high" },
  ],
});

describe("finding the AIs on a computer", () => {
  it("lists them the best first: plans, keys, local models, then the rest", async () => {
    const { machine } = standIn({
      programs: ["claude", "codex", "cursor-agent"],
      env: { OPENROUTER_API_KEY: "key" },
      servers: {
        "http://127.0.0.1:11434/api/tags": {
          models: [{ name: "qwen3:14b" }, { name: "llama3.2:1b" }],
        },
        "http://127.0.0.1:1234/v1/models": { data: [{ id: "mistral-small" }] },
      },
    });
    const found = await findBackends(machine);
    expect(found.map((backend) => backend.id)).toEqual([
      "claude",
      "codex",
      "openrouter",
      "ollama:qwen3:14b",
      "ollama:llama3.2:1b",
      "lmstudio:mistral-small",
      "cursor",
    ]);
    expect(found.find((backend) => backend.id === "ollama:llama3.2:1b")?.note).toMatch(/small/);
    expect(backendNamed(found, "ollama")?.id).toBe("ollama:qwen3:14b");
    expect(backendNamed(found, "LMSTUDIO:mistral-small")?.id).toBe("lmstudio:mistral-small");
  });
});

describe("asking an AI", () => {
  it("runs Claude Code on its own, with no tools or settings, held to the schema", async () => {
    const { machine, calls } = standIn({
      programs: ["claude"],
      answer: async () => ({ stdout: JSON.stringify({ structured_output: { answers: [] } }) }),
    });
    const [claude] = await findBackends(machine);
    expect(await claude?.ask(ASK)).toBe('{"answers":[]}');
    const call = calls[0] as Call;
    expect(call.program).toBe("/usr/bin/claude");
    expect(call.input).toBe(ASK.prompt);
    const args = [...call.args];
    expect(args).toEqual(expect.arrayContaining(["-p", "--safe-mode", "--strict-mcp-config"]));
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args[args.indexOf("--json-schema") + 1]).toBe(JSON.stringify(ASK.schema));
    expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
    // The instructions from a file, in the empty folder it runs in.
    expect(args[args.indexOf("--system-prompt-file") + 1]?.startsWith(call.cwd)).toBe(true);
  });

  it("says what to do when an agent program isn't signed in", async () => {
    const { machine } = standIn({
      programs: ["codex"],
      answer: async () => ({ code: 1, stderr: "Error: not logged in. Run codex login." }),
    });
    const [codex] = await findBackends(machine);
    await expect(codex?.ask(ASK)).rejects.toThrow(/isn't signed in: run it once on its own/);
  });

  it("reads Codex's answer from the file it writes, its schema in a file beside it", async () => {
    const { machine, calls } = standIn({
      programs: ["codex"],
      answer: async ({ args }) => {
        const out = args[args.indexOf("-o") + 1] as string;
        await writeFile(out, '{"answers":[1]}');
        return {};
      },
    });
    const [codex] = await findBackends(machine);
    expect(await codex?.ask(ASK)).toBe('{"answers":[1]}');
    const args = [...(calls[0] as Call).args];
    expect(args).toEqual(
      expect.arrayContaining(["exec", "--sandbox", "read-only", "--ephemeral", "-"]),
    );
    expect((calls[0] as Call).input).toContain(ASK.instructions);
  });

  it("asks a local model with the schema as its format", async () => {
    const { machine, requests } = standIn({
      servers: {
        "http://127.0.0.1:11434/api/tags": { models: [{ name: "qwen3:14b" }] },
        "http://127.0.0.1:11434/api/chat": { message: { content: '{"answers":[]}' } },
        "http://127.0.0.1:1234/v1/models": { data: [{ id: "gemma" }] },
        "http://127.0.0.1:1234/v1/chat/completions": {
          choices: [{ message: { content: '{"answers":[2]}' } }],
        },
      },
    });
    const found = await findBackends(machine);
    expect(await backendNamed(found, "ollama")?.ask(ASK)).toBe('{"answers":[]}');
    expect(await backendNamed(found, "lmstudio")?.ask(ASK)).toBe('{"answers":[2]}');
    const ollama = requests.find((request) => request.url.endsWith("/api/chat"))?.body as Record<
      string,
      unknown
    >;
    expect(ollama).toMatchObject({ model: "qwen3:14b", format: ASK.schema, stream: false });
    const lmstudio = requests.find((request) => request.url.endsWith("/chat/completions"))
      ?.body as Record<string, unknown>;
    expect(lmstudio.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "speakers", strict: true, schema: ASK.schema },
    });
  });
});

describe("vxd tag", () => {
  const claudeAnswering = (stdout = JSON.stringify({ structured_output: JSON.parse(ANSWER) })) =>
    standIn({ programs: ["claude"], answer: async () => ({ stdout }) });

  it("gives the quotes their speakers and writes the story", async () => {
    const { machine } = claudeAnswering();
    const result = await vxd(["tag", "story.vxd"], { "story.vxd": STORY }, { io: { machine } });
    expect(result.code).toBe(0);
    expect(result.file("story.vxd")).toContain("@Tom “Who’s there?” asked Tom.");
    expect(result.file("story.vxd")).toContain("@Mara “Only me,” said Mara.");
    expect(result.stdout).toContain("story.vxd: 2 speakers given.");
    expect(result.stderr).toContain("Asking Claude Code (your Claude plan) who says 2 quotes");
  });

  it("asks before writing when someone is there, and writes nothing on no", async () => {
    const { machine } = claudeAnswering();
    const asked: string[] = [];
    const result = await vxd(
      ["tag", "story.vxd"],
      { "story.vxd": STORY },
      {
        io: {
          machine,
          interactive: true,
          question: async (text) => {
            asked.push(text);
            return "n";
          },
        },
      },
    );
    expect(asked).toEqual(["Write them to story.vxd? [Y/n] "]);
    expect(result.written).toEqual([]);
  });

  it("asks which AI when there are several, and remembers the choice", async () => {
    const { machine } = standIn({
      programs: ["claude", "codex"],
      answer: async ({ program, args }) => {
        if (program.endsWith("codex")) {
          await writeFile(args[args.indexOf("-o") + 1] as string, ANSWER);
          return {};
        }
        return { stdout: JSON.stringify({ structured_output: JSON.parse(ANSWER) }) };
      },
    });
    const files = { "story.vxd": STORY };
    const first = await vxd(["tag", "story.vxd", "--yes"], files, {
      io: {
        machine,
        interactive: true,
        question: async () => "2",
        configFile: "/work/vxd.json",
      },
    });
    expect(first.stderr).toContain("1. Claude Code (your Claude plan) (recommended)");
    expect(first.stderr).toContain("Asking Codex (your ChatGPT plan)");
    expect(first.file("vxd.json")).toBe('{\n  "ai": "codex"\n}\n');
    const second = await vxd(
      ["tag", "story.vxd", "--dry-run"],
      { ...files, "vxd.json": '{ "ai": "codex" }' },
      { io: { machine, interactive: true, configFile: "/work/vxd.json" } },
    );
    expect(second.stderr).toContain("Using Codex (your ChatGPT plan), as last time");
    expect(second.written).toEqual([]);
  });

  it("with several AIs and no one to ask, says how to choose", async () => {
    const { machine } = standIn({ programs: ["claude", "codex"] });
    const result = await vxd(["tag", "story.vxd"], { "story.vxd": STORY }, { io: { machine } });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("several AIs are here: choose one with --with claude|codex");
  });

  it("with no AI, says how to get one, or to use the dialogue tags", async () => {
    const { machine } = standIn();
    const none = await vxd(["tag", "story.vxd"], { "story.vxd": STORY }, { io: { machine } });
    expect(none.code).toBe(2);
    expect(none.stderr).toContain("no AI found");
    const tags = await vxd(
      ["tag", "story.vxd", "--with", "tags"],
      { "story.vxd": STORY },
      {
        io: { machine },
      },
    );
    expect(tags.code).toBe(0);
    expect(tags.file("story.vxd")).toContain("@Tom “Who’s there?”");
  });

  it("lists the AIs found", async () => {
    const { machine } = standIn({ programs: ["claude"], env: { OPENAI_API_KEY: "k" } });
    const result = await vxd(["tag", "--list"], {}, { io: { machine } });
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^claude +Claude Code \(your Claude plan\)$/m);
    expect(result.stdout).toMatch(
      /^openai +OpenAI API \(OPENAI_API_KEY\) \(billed to that key\)$/m,
    );
  });

  it("measures an AI against the story's own marks", async () => {
    const marked = STORY.replace("“Who’s", "@Tom “Who’s").replace("“Only", "@Mara “Only");
    const { machine } = claudeAnswering();
    const result = await vxd(
      ["tag", "story.vxd", "--eval"],
      { "story.vxd": marked },
      {
        io: { machine },
      },
    );
    expect(result.stdout).toContain("2 of 2 speakers put back as story.vxd has them (100%).");
    expect(result.written).toEqual([]);
  });

  it("stops with a clear message when the AI fails, keeping nothing half-done unsaid", async () => {
    const { machine } = standIn({
      programs: ["claude"],
      answer: async () => ({ code: 1, stdout: "", stderr: "Please run /login" }),
    });
    const result = await vxd(["tag", "story.vxd"], { "story.vxd": STORY }, { io: { machine } });
    expect(result.code).toBe(2);
    expect(result.stdout).toContain("Stopped early: Claude Code isn't signed in");
    expect(result.written).toEqual([]);
  });
});
