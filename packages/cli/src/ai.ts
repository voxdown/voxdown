/**
 * The AIs a writer already has, found and asked: the agent programs they're signed in to (Claude
 * Code, Codex, Antigravity, Cursor, Copilot, Gemini CLI), which run on their own plan; a model
 * server on this computer (Ollama, LM Studio, llama.cpp, Jan, vLLM); or an API key in the
 * environment. Each is asked the same way: instructions, a prompt, and the JSON schema its answer
 * must match. The answer comes back as text, read by the caller.
 *
 * The programs run without a shell, in an empty folder of their own, with their tools off where
 * they allow it, the prompt on standard input where they read it: they can read nothing of the
 * writer's but what they're given.
 */
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

/** What an AI is asked. */
export type Ask = {
  /** How to go about it: the same for every passage. */
  instructions: string;
  /** This passage. */
  prompt: string;
  /** The JSON schema the answer must match. */
  schema: Record<string, unknown>;
  signal?: AbortSignal;
};

/** An AI that can be asked. */
export type Backend = {
  /** What `--with` takes, such as `claude` or `ollama:qwen3:14b`. */
  id: string;
  /** As a writer knows it, such as "Claude Code (your Claude plan)". */
  label: string;
  /** How it is reached. */
  kind: "plan" | "local" | "key" | "plan-unchecked";
  /** Something worth knowing before choosing it. */
  note?: string;
  /** The answer, as text (JSON, perhaps with words around it). */
  ask(ask: Ask): Promise<string>;
};

/** What finding and asking AIs needs from the computer: tests give stand-ins. */
export type Machine = {
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  /** Where a program is on the PATH, if it is. */
  find(program: string): Promise<string | undefined>;
  /** Runs a program found by `find`, no shell, with `input` on its standard input. */
  run(
    program: string,
    args: readonly string[],
    options: { input: string; cwd: string; signal?: AbortSignal; timeoutMs: number },
  ): Promise<{ code: number | null; stdout: string; stderr: string }>;
  fetch: typeof fetch;
  /** An empty folder, removed after `work`. */
  inFolder<T>(work: (folder: string) => Promise<T>): Promise<T>;
};

/** The computer this runs on. */
export function thisMachine(): Machine {
  const env = process.env;
  return {
    env,
    platform: process.platform,
    async find(program) {
      const extensions =
        process.platform === "win32"
          ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)
          : [""];
      for (const folder of (env.PATH ?? "").split(delimiter)) {
        if (!folder) continue;
        for (const extension of extensions) {
          const path = join(folder, program + extension);
          try {
            await access(path, constants.X_OK);
            return path;
          } catch {}
        }
      }
      return undefined;
    },
    run(program, args, options) {
      return new Promise((resolve, reject) => {
        let command = program;
        let argv = [...args];
        let verbatim = false;
        // A program npm installed is a .cmd file on Windows, which only cmd.exe starts: given
        // nothing but plain words, so that no text of the story can be read as a command.
        if (process.platform === "win32" && /\.(cmd|bat)$/i.test(program)) {
          if (!argv.every((arg) => /^[\w\-.:\\/=@,+ ]*$/.test(arg))) {
            reject(
              new AiFailure(
                `${program} is a script that can't safely be given a passage on Windows: install its standalone version, or choose another AI`,
              ),
            );
            return;
          }
          command = env.ComSpec ?? "cmd.exe";
          argv = ["/d", "/s", "/c", `"${[program, ...args].map((arg) => `"${arg}"`).join(" ")}"`];
          verbatim = true;
        }
        const child = spawn(command, argv, {
          cwd: options.cwd,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          windowsVerbatimArguments: verbatim,
          ...(options.signal ? { signal: options.signal } : {}),
        });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => child.kill(), options.timeoutMs);
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve({ code, stdout, stderr });
        });
        child.stdin.on("error", () => {});
        child.stdin.end(options.input);
      });
    },
    fetch: globalThis.fetch.bind(globalThis),
    async inFolder(work) {
      const folder = await mkdtemp(join(tmpdir(), "vxd-ai-"));
      try {
        return await work(folder);
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    },
  };
}

/** A minute and a half for a passage: long enough for a slow local model, short enough to notice. */
const TIMEOUT = 180_000;

/** A failure the writer can act on, said in their terms. */
export class AiFailure extends Error {}

function failed(label: string, result: { code: number | null; stderr: string }): AiFailure {
  const said = result.stderr.trim().split("\n").slice(-3).join(" ").slice(0, 300);
  if (/log ?in|sign ?in|auth|credential|unauthori[sz]ed|401|403/i.test(said))
    return new AiFailure(`${label} isn't signed in: run it once on its own to sign in. (${said})`);
  return new AiFailure(
    `${label} stopped${result.code === null ? "" : ` (exit ${result.code})`}${said ? `: ${said}` : ""}`,
  );
}

const both = (ask: Ask) => `${ask.instructions}\n\n---\n\n${ask.prompt}`;

// Agent programs, signed in to the writer's own plan.

function claudeCode(machine: Machine, program: string, model: string | undefined): Backend {
  const label = "Claude Code";
  return {
    id: "claude",
    label: `${label} (your Claude plan)`,
    kind: "plan",
    async ask(ask) {
      return machine.inFolder(async (folder) => {
        const instructions = join(folder, "instructions.txt");
        await writeFile(instructions, ask.instructions);
        const args = [
          "-p",
          "Attribute the numbered quotes in the passage on standard input. Answer only with the JSON object.",
          // None of the writer's settings, hooks, skills or servers, and no tools: only the text.
          "--safe-mode",
          "--tools",
          "",
          "--strict-mcp-config",
          "--disable-slash-commands",
          "--no-session-persistence",
          "--system-prompt-file",
          instructions,
          "--output-format",
          "json",
          "--json-schema",
          JSON.stringify(ask.schema),
          "--model",
          model ?? "sonnet",
        ];
        const result = await machine.run(program, args, {
          input: ask.prompt,
          cwd: folder,
          timeoutMs: TIMEOUT,
          ...(ask.signal ? { signal: ask.signal } : {}),
        });
        let envelope: { structured_output?: unknown; result?: unknown; is_error?: boolean };
        try {
          envelope = JSON.parse(result.stdout);
        } catch {
          throw failed(label, result);
        }
        if (envelope.structured_output !== undefined)
          return JSON.stringify(envelope.structured_output);
        if (envelope.is_error || typeof envelope.result !== "string")
          throw failed(label, {
            code: result.code,
            stderr: String(envelope.result ?? result.stderr),
          });
        return envelope.result;
      });
    },
  };
}

function codex(machine: Machine, program: string, model: string | undefined): Backend {
  const label = "Codex";
  return {
    id: "codex",
    label: `${label} (your ChatGPT plan)`,
    kind: "plan",
    async ask(ask) {
      return machine.inFolder(async (folder) => {
        const schema = join(folder, "schema.json");
        const answer = join(folder, "answer.json");
        await writeFile(schema, JSON.stringify(ask.schema));
        const args = [
          "exec",
          "--skip-git-repo-check",
          "--ephemeral",
          "--ignore-rules",
          "--sandbox",
          "read-only",
          "-C",
          folder,
          "--color",
          "never",
          "--output-schema",
          schema,
          "-o",
          answer,
          ...(model ? ["-m", model] : []),
          "-",
        ];
        const result = await machine.run(program, args, {
          input: both(ask),
          cwd: folder,
          timeoutMs: TIMEOUT,
          ...(ask.signal ? { signal: ask.signal } : {}),
        });
        try {
          return await readFile(answer, "utf8");
        } catch {
          throw failed(label, result);
        }
      });
    },
  };
}

function antigravity(machine: Machine, program: string, model: string | undefined): Backend {
  const label = "Antigravity";
  return {
    id: "agy",
    label: `${label} (your Google plan)`,
    kind: "plan",
    async ask(ask) {
      return machine.inFolder(async (folder) => {
        const schema = join(folder, "schema.json");
        await writeFile(schema, JSON.stringify(ask.schema));
        const args = [
          "-p",
          both(ask),
          "--output-format",
          "json",
          "--json-schema",
          schema,
          ...(model ? ["--model", model] : []),
        ];
        const result = await machine.run(program, args, {
          input: "",
          cwd: folder,
          timeoutMs: TIMEOUT,
          ...(ask.signal ? { signal: ask.signal } : {}),
        });
        let envelope: { status?: string; structured_output?: unknown; result?: unknown };
        try {
          envelope = JSON.parse(result.stdout);
        } catch {
          throw failed(label, result);
        }
        if (envelope.structured_output !== undefined)
          return JSON.stringify(envelope.structured_output);
        if (typeof envelope.result === "string") return envelope.result;
        throw failed(label, result);
      });
    },
  };
}

/** An agent program with no way to hold its answer to a schema: asked for JSON, and read. */
function textAgent(
  machine: Machine,
  spec: {
    id: string;
    program: string;
    label: string;
    args: (prompt: string, folder: string) => string[];
    /** Where the answer is in its JSON output; undefined when it prints the answer itself. */
    field?: string;
  },
): Backend {
  return {
    id: spec.id,
    label: spec.label,
    kind: "plan-unchecked",
    note: "can't be held to the answer's shape, so a few answers may need asking again",
    async ask(ask) {
      return machine.inFolder(async (folder) => {
        const prompt = `${both(ask)}\n\nAnswer with only a JSON object matching this schema:\n${JSON.stringify(ask.schema)}`;
        const result = await machine.run(spec.program, spec.args(prompt, folder), {
          input: "",
          cwd: folder,
          timeoutMs: TIMEOUT,
          ...(ask.signal ? { signal: ask.signal } : {}),
        });
        if (!spec.field) {
          if (result.code !== 0 && !result.stdout.trim()) throw failed(spec.label, result);
          return result.stdout;
        }
        try {
          const value = (JSON.parse(result.stdout) as Record<string, unknown>)[spec.field];
          if (typeof value === "string") return value;
        } catch {}
        throw failed(spec.label, result);
      });
    },
  };
}

// Model servers on this computer.

type LocalServer = {
  id: string;
  name: string;
  base: string;
  /** Ollama's own API, or an OpenAI-compatible one. */
  api: "ollama" | "openai";
};

const LOCAL_SERVERS: readonly LocalServer[] = [
  { id: "ollama", name: "Ollama", base: "http://127.0.0.1:11434", api: "ollama" },
  { id: "lmstudio", name: "LM Studio", base: "http://127.0.0.1:1234", api: "openai" },
  { id: "llamacpp", name: "llama.cpp", base: "http://127.0.0.1:9931", api: "openai" },
  { id: "llamacpp", name: "llama.cpp", base: "http://127.0.0.1:8080", api: "openai" },
  { id: "jan", name: "Jan", base: "http://127.0.0.1:1337", api: "openai" },
  { id: "vllm", name: "vLLM", base: "http://127.0.0.1:8000", api: "openai" },
];

async function getJson(machine: Machine, url: string, timeoutMs: number): Promise<unknown> {
  const response = await machine.fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${response.status}`);
  return response.json();
}

/** The models a server on this computer offers, if it's running. */
async function localModels(machine: Machine, server: LocalServer): Promise<string[]> {
  try {
    if (server.api === "ollama") {
      const tags = (await getJson(machine, `${server.base}/api/tags`, 400)) as {
        models?: Array<{ name?: string }>;
      };
      return (tags.models ?? []).map((model) => model.name ?? "").filter(Boolean);
    }
    const list = (await getJson(machine, `${server.base}/v1/models`, 400)) as {
      data?: Array<{ id?: string }>;
    };
    return (list.data ?? []).map((model) => model.id ?? "").filter(Boolean);
  } catch {
    return [];
  }
}

/** A model's size from its name, in billions of parameters, if it says. */
function billions(model: string): number | undefined {
  const found = /(\d+(?:\.\d+)?)\s*b\b/i.exec(model.replace(/[-_:]/g, " "));
  return found ? Number(found[1]) : undefined;
}

function localBackend(machine: Machine, server: LocalServer, model: string): Backend {
  const size = billions(model);
  return {
    id: `${server.id}:${model}`,
    label: `${server.name} · ${model}`,
    kind: "local",
    ...(size !== undefined && size < 7
      ? { note: "a small model: expect more of its speakers to need checking" }
      : {}),
    async ask(ask) {
      const messages = [
        { role: "system", content: ask.instructions },
        { role: "user", content: ask.prompt },
      ];
      const response = await machine.fetch(
        server.api === "ollama" ? `${server.base}/api/chat` : `${server.base}/v1/chat/completions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            server.api === "ollama"
              ? {
                  model,
                  messages,
                  format: ask.schema,
                  stream: false,
                  options: { temperature: 0, num_ctx: 16384 },
                }
              : {
                  model,
                  messages,
                  temperature: 0,
                  response_format: {
                    type: "json_schema",
                    json_schema: { name: "speakers", strict: true, schema: ask.schema },
                  },
                },
          ),
          signal: ask.signal ?? AbortSignal.timeout(TIMEOUT),
        },
      );
      if (!response.ok)
        throw new AiFailure(
          `${server.name} answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
        );
      const data = (await response.json()) as {
        message?: { content?: string };
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.message?.content ?? data.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new AiFailure(`${server.name} gave no answer`);
      return content;
    },
  };
}

// API keys.

function openAiCompatible(
  machine: Machine,
  spec: { id: string; label: string; url: string; key: string; model: string; extra?: object },
): Backend {
  return {
    id: spec.id,
    label: spec.label,
    kind: "key",
    note: "billed to that key",
    async ask(ask) {
      const response = await machine.fetch(spec.url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${spec.key}` },
        body: JSON.stringify({
          model: spec.model,
          messages: [
            { role: "system", content: ask.instructions },
            { role: "user", content: ask.prompt },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: "speakers", strict: true, schema: ask.schema },
          },
          ...spec.extra,
        }),
        signal: ask.signal ?? AbortSignal.timeout(TIMEOUT),
      });
      if (!response.ok)
        throw new AiFailure(
          `${spec.label} answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
        );
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string; refusal?: string } }>;
      };
      const message = data.choices?.[0]?.message;
      if (message?.refusal) throw new AiFailure(`${spec.label} declined: ${message.refusal}`);
      if (typeof message?.content !== "string") throw new AiFailure(`${spec.label} gave no answer`);
      return message.content;
    },
  };
}

function anthropicApi(key: string, model: string | undefined): Backend {
  const label = "Claude API";
  return {
    id: "anthropic",
    label: `${label} (ANTHROPIC_API_KEY)`,
    kind: "key",
    note: "billed to that key",
    async ask(ask) {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: key });
      try {
        const response = await client.beta.messages.create(
          {
            model: model ?? "claude-opus-5-5",
            max_tokens: 16000,
            // A request one model declines is answered by the one Anthropic recommends instead.
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            system: ask.instructions,
            messages: [{ role: "user", content: ask.prompt }],
            output_config: {
              effort: "medium",
              format: { type: "json_schema", schema: ask.schema },
            },
          },
          ask.signal ? { signal: ask.signal } : {},
        );
        if (response.stop_reason === "refusal")
          throw new AiFailure(`${label} declined this passage`);
        if (response.stop_reason === "max_tokens")
          throw new AiFailure(`${label} ran out of room for its answer`);
        const text = response.content
          .map((block) => (block.type === "text" ? block.text : ""))
          .join("");
        if (!text) throw new AiFailure(`${label} gave no answer`);
        return text;
      } catch (error) {
        if (error instanceof AiFailure) throw error;
        if (error instanceof Anthropic.AuthenticationError)
          throw new AiFailure(`${label}: ANTHROPIC_API_KEY isn't accepted`);
        if (error instanceof Anthropic.RateLimitError)
          throw new AiFailure(`${label} is busy (rate limited): try again in a minute`);
        if (error instanceof Anthropic.APIError)
          throw new AiFailure(`${label} answered ${error.status}: ${error.message}`);
        throw error;
      }
    },
  };
}

// Finding them.

/** Every AI this computer offers, the best first. */
export async function findBackends(
  machine: Machine,
  options: { model?: string } = {},
): Promise<Backend[]> {
  const model = options.model;
  const env = machine.env;
  const [programs, servers] = await Promise.all([
    Promise.all(
      ["claude", "codex", "agy", "cursor-agent", "copilot", "gemini"].map((name) =>
        machine.find(name),
      ),
    ),
    Promise.all(LOCAL_SERVERS.map((server) => localModels(machine, server))),
  ]);
  const [claude, codexFound, agy, cursor, copilot, gemini] = programs;
  const found: Backend[] = [];
  // Agent programs that hold their answer to a schema, on the writer's own plan.
  if (claude) found.push(claudeCode(machine, claude, model));
  if (codexFound) found.push(codex(machine, codexFound, model));
  if (agy) found.push(antigravity(machine, agy, model));
  // API keys.
  if (env.ANTHROPIC_API_KEY) found.push(anthropicApi(env.ANTHROPIC_API_KEY, model));
  if (env.OPENAI_API_KEY)
    found.push(
      openAiCompatible(machine, {
        id: "openai",
        label: "OpenAI API (OPENAI_API_KEY)",
        url: "https://api.openai.com/v1/chat/completions",
        key: env.OPENAI_API_KEY,
        model: model ?? "gpt-5-mini",
      }),
    );
  if (env.OPENROUTER_API_KEY)
    found.push(
      openAiCompatible(machine, {
        id: "openrouter",
        label: "OpenRouter (OPENROUTER_API_KEY)",
        url: "https://openrouter.ai/api/v1/chat/completions",
        key: env.OPENROUTER_API_KEY,
        model: model ?? "openrouter/auto",
        // Only to providers that keep to the schema.
        extra: { provider: { require_parameters: true } },
      }),
    );
  // Model servers on this computer: one choice a model, the same server answering on two ports
  // counted once.
  const seen = new Set<string>();
  LOCAL_SERVERS.forEach((server, index) => {
    for (const name of servers[index] ?? []) {
      const key = `${server.id}:${name}`;
      if (seen.has(key) || (model && name !== model)) continue;
      seen.add(key);
      found.push(localBackend(machine, server, name));
    }
  });
  // Agent programs that can only be asked for JSON.
  if (cursor)
    found.push(
      textAgent(machine, {
        id: "cursor",
        program: cursor,
        label: "Cursor (your Cursor plan)",
        args: (prompt, folder) => [
          "-p",
          "--output-format",
          "json",
          "--mode",
          "ask",
          "--trust",
          "--workspace",
          folder,
          ...(model ? ["--model", model] : []),
          prompt,
        ],
        field: "result",
      }),
    );
  if (copilot)
    found.push(
      textAgent(machine, {
        id: "copilot",
        program: copilot,
        label: "GitHub Copilot CLI (your Copilot plan)",
        args: (prompt) => [
          "-p",
          prompt,
          "-s",
          "--no-ask-user",
          "--deny-tool=shell",
          "--deny-tool=write",
          "--deny-tool=url",
          ...(model ? ["--model", model] : []),
        ],
      }),
    );
  if (gemini)
    found.push(
      textAgent(machine, {
        id: "gemini",
        program: gemini,
        label: "Gemini CLI (your Gemini API key)",
        args: (prompt) => [
          "-p",
          prompt,
          "--output-format",
          "json",
          ...(model ? ["--model", model] : []),
        ],
        field: "response",
      }),
    );
  return found;
}

/** The backend `--with` names: its id, or its id's first part (`ollama` for the first Ollama model). */
export function backendNamed(found: readonly Backend[], name: string): Backend | undefined {
  const lower = name.toLowerCase();
  return (
    found.find((backend) => backend.id.toLowerCase() === lower) ??
    found.find((backend) => backend.id.toLowerCase().startsWith(`${lower}:`))
  );
}

/** Every name `--with` takes, for a message. */
export const KNOWN_BACKENDS = [
  "claude",
  "codex",
  "agy",
  "anthropic",
  "openai",
  "openrouter",
  "ollama[:model]",
  "lmstudio[:model]",
  "llamacpp",
  "jan",
  "vllm",
  "cursor",
  "copilot",
  "gemini",
  "tags",
];
