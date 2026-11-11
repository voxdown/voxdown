/**
 * `vxd mcp`: VoxDown's tools for an AI app that takes local MCP servers (Claude, ChatGPT and
 * Codex, Cursor, VS Code, Zed…), over standard input and output. The app's own model, on the
 * writer's own plan, reads the cheat sheet, lists a story's quotes that no one is marked to say
 * (a passage at a time, numbered), and gives them to speakers; every gift is the core's
 * `giveQuotes`, read back so that no word changes. Only `.vxd` and `.md` files are read or
 * written, and a story is written whole or not at all.
 *
 * Quotes are numbered in reading order; the numbers stay while only marks change. A list comes
 * with a `revision` (a hash of the printed text, which marks don't change): giving quotes with an
 * older revision is refused, as the words have changed since and the numbers may have too.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import {
  type Story,
  applyChanges,
  bookText,
  castMemberNamed,
  giveQuotes,
  isName,
  parse,
  quotesOf,
  setAbout,
  setFullName,
} from "voxdown";
import * as z from "zod";
import { CHEATSHEET } from "./cheatsheet";
import { passagesOf, shortName, speakersOf } from "./tagging";

/** How a model goes about tagging, with these tools. */
export const PROCEDURE = `# Tagging speakers in a VoxDown story

1. Call voxdown_story to see the cast and how many quotes wait for a speaker.
2. If the cast is thin, skim the story and add the speaking characters with voxdown_add_character (a one-word short name, their full name, and a few words about them).
3. Call voxdown_unattributed_quotes: it gives one passage, each waiting quote marked ⟦n⟧, with the passage before it for context.
4. Decide who says each numbered quote: dialogue tags ("said Mara"), who a pronoun refers to, turn-taking (two people alternate), names used to address someone (usually not the speaker), action beats, and voice. A quote no character says aloud (a sign, a title) belongs to the narrator; a character's quoted thought is theirs.
5. Call voxdown_assign_speakers with the answers and the revision you were given. Use the cast's short names; for someone new, give their name and they join the cast. Leave out quotes you can't tell.
6. Read what was refused and why, fix what you can, then call voxdown_unattributed_quotes again with after set to the last quote number, until none remain.
7. Tell the writer what you gave, and list the quotes you left out or weren't sure of, with their lines.

Never edit the story file yourself: these tools only add marks, and refuse anything that would change a word.`;

/** What the tools read and write: the disk, or a stand-in in tests. */
export type Files = {
  read(path: string): Promise<string>;
  /** Writes the whole text, or nothing. */
  write(path: string, text: string): Promise<void>;
  cwd: string;
};

export const diskFiles = (cwd = process.cwd()): Files => ({
  cwd,
  read: async (path) =>
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await readFile(path)),
  async write(path, text) {
    // Beside it first, then in its place: never half a story.
    const temporary = `${path}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      await writeFile(temporary, text, "utf8");
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  },
});

/** A story's revision: its printed text, which giving speakers leaves as it was. */
export function revisionOf(story: Story): string {
  return createHash("sha256").update(bookText(story)).digest("hex").slice(0, 16);
}

class ToolError extends Error {}

function storyPath(files: Files, file: string): string {
  const path = isAbsolute(file) ? file : resolve(files.cwd, file);
  if (!/^\.(vxd|md|markdown)$/i.test(extname(path)))
    throw new ToolError(`${file} isn't a story: give a .vxd or .md file`);
  return path;
}

async function load(files: Files, file: string): Promise<{ path: string; story: Story }> {
  const path = storyPath(files, file);
  try {
    return { path, story: parse(await files.read(path)) };
  } catch (error) {
    const code = (error as { code?: string }).code;
    throw new ToolError(
      code === "ENOENT"
        ? `no such file: ${path} (give the full path)`
        : code === "ERR_ENCODING_INVALID_ENCODED_DATA"
          ? `${path} isn't UTF-8 text`
          : `can't read ${path}: ${(error as Error).message}`,
    );
  }
}

function result(value: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function failure(error: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: error instanceof ToolError ? error.message : `unexpected error: ${String(error)}`,
      },
    ],
    isError: true,
  };
}

const FILE = z.string().describe("The story's path: a .vxd or .md file, best given in full.");

function castOf(story: Story) {
  return speakersOf(story).map((member) => ({
    name: member.name,
    fullName: member.fullName,
    ...(member.about ? { about: member.about } : {}),
  }));
}

function waitingIn(story: Story): number[] {
  return quotesOf(story)
    .filter((quote) => quote.narrated)
    .map((quote) => quote.number);
}

/** The server, its tools registered: one for each connection. */
export function createVoxdownServer(files: Files, version: string): McpServer {
  const server = new McpServer({ name: "voxdown", version });

  server.registerTool(
    "voxdown_guide",
    {
      title: "How VoxDown works, and how to tag speakers",
      description:
        "The VoxDown cheat sheet (every mark on one page) and the steps for giving quotes to their speakers with these tools. Read it first.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => ({ content: [{ type: "text", text: `${CHEATSHEET}\n\n${PROCEDURE}` }] }),
  );

  server.registerTool(
    "voxdown_story",
    {
      title: "A story's cast and quotes",
      description:
        "A VoxDown story's title, narrator and cast, how many quotes it has and how many wait for a speaker, and how many warnings it has.",
      inputSchema: z.object({ file: FILE }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ file }) => {
      try {
        const { path, story } = await load(files, file);
        return result({
          file: path,
          revision: revisionOf(story),
          ...(story.meta.title ? { title: story.meta.title } : {}),
          ...(story.meta.author ? { author: story.meta.author } : {}),
          ...(story.meta.language ? { language: story.meta.language } : {}),
          narrator: story.meta.narrator,
          cast: castOf(story),
          quotes: quotesOf(story).length,
          waiting: waitingIn(story).length,
          warnings: story.warnings.filter((warning) => warning.severity === "warning").length,
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "voxdown_unattributed_quotes",
    {
      title: "The next quotes waiting for a speaker",
      description:
        "One passage of the story (about 2,500 words) with each quote no one is marked to say numbered ⟦n⟧, the paragraphs before it for context, the cast, and the revision to give back with the answers. Pass after (the last quote number you were given) to go on.",
      inputSchema: z.object({
        file: FILE,
        after: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Start after this quote number (0 or left out: from the start)."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ file, after }) => {
      try {
        const { path, story } = await load(files, file);
        const waiting = waitingIn(story).filter((number) => number > (after ?? 0));
        const [passage] = passagesOf(story, { only: new Set(waiting) });
        const remaining = passage ? waiting.length - passage.numbers.length : 0;
        return result({
          file: path,
          revision: revisionOf(story),
          narrator: story.meta.narrator,
          cast: castOf(story),
          ...(passage
            ? {
                passage: {
                  ...(passage.heading ? { heading: passage.heading } : {}),
                  line: passage.line,
                  quotes: passage.numbers,
                  before: passage.before,
                  text: passage.text,
                },
                remaining,
                ...(remaining > 0 ? { next: { after: passage.numbers.at(-1) } } : {}),
              }
            : { passage: null, remaining: 0, done: "No quote waits for a speaker." }),
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "voxdown_assign_speakers",
    {
      title: "Give quotes to their speakers",
      description:
        "Marks who says each numbered quote, and writes the story. Speakers are the cast's short names; someone new is given by name and joins the cast. Each mark is read back: one that would change a word heard or printed, or give the quote to someone else, is refused with the reason. dryRun shows what would happen and writes nothing.",
      inputSchema: z.object({
        file: FILE,
        revision: z.string().describe("The revision voxdown_unattributed_quotes gave."),
        answers: z
          .array(
            z.object({
              quote: z.number().int().min(1).describe("The quote's number, from ⟦n⟧."),
              speaker: z
                .string()
                .describe(
                  "A short name from the cast, or a new character's name (they join the cast).",
                ),
            }),
          )
          .max(300),
        dryRun: z.boolean().optional().describe("Show what would happen; write nothing."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ file, revision, answers, dryRun }) => {
      try {
        const { path, story } = await load(files, file);
        if (revision !== revisionOf(story))
          throw new ToolError(
            "The story's words have changed since those quotes were listed: call voxdown_unattributed_quotes again.",
          );
        const known = speakersOf(story);
        const refusedEarly: Array<{ quote: number; why: string }> = [];
        const gifts = answers.flatMap(({ quote, speaker }) => {
          const name = speaker.trim();
          const member =
            castMemberNamed(story, name) ??
            known.find((other) => other.name.toLowerCase() === name.toLowerCase())?.name;
          if (member) return [{ quote, speaker: member }];
          const short = isName(name) ? name : shortName(name);
          if (!short) {
            refusedEarly.push({ quote, why: `“${speaker}” can't be written as a name` });
            return [];
          }
          return [{ quote, speaker: short, ...(short !== name ? { fullName: name } : {}) }];
        });
        const given = giveQuotes(story, gifts);
        const text = applyChanges(story.source, given.changes);
        if (!dryRun && text !== story.source) await files.write(path, text);
        const after = parse(text);
        return result({
          file: path,
          ...(dryRun ? { dryRun: true } : {}),
          given: given.given,
          refused: [...refusedEarly, ...given.refused],
          carried: given.carried,
          joined: given.joined,
          waiting: waitingIn(after).length,
          revision: revisionOf(after),
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "voxdown_add_character",
    {
      title: "Add a character to the cast",
      description:
        "Adds a character to the story's cast, or sets their full name and a few words about who they are and how they sound. name is the one word written after @.",
      inputSchema: z.object({
        file: FILE,
        name: z.string().describe("One word, as written after @: Mara, OldTom, O’Brien."),
        fullName: z.string().optional(),
        about: z.string().optional().describe("Who they are and how they sound, in plain words."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ file, name, fullName, about }) => {
      try {
        const { path, story } = await load(files, file);
        if (!isName(name))
          throw new ToolError(
            `“${name}” isn't one word: try ${shortName(name) || "a single word"}`,
          );
        let text = story.source;
        const named = setFullName(story, name, fullName?.trim() || name);
        text = applyChanges(text, named);
        if (about?.trim()) text = applyChanges(text, setAbout(parse(text), name, about.trim()));
        if (text !== story.source) await files.write(path, text);
        return result({ file: path, cast: castOf(parse(text)) });
      } catch (error) {
        return failure(error instanceof RangeError ? new ToolError(error.message) : error);
      }
    },
  );

  server.registerTool(
    "voxdown_check",
    {
      title: "Check a story",
      description: "The story's warnings, each with its line, column, code and message.",
      inputSchema: z.object({ file: FILE }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ file }) => {
      try {
        const { path, story } = await load(files, file);
        return result({
          file: path,
          warnings: story.warnings.slice(0, 200).map((warning) => ({
            line: warning.line,
            column: warning.column,
            level: warning.severity,
            code: warning.code,
            message: warning.message,
          })),
          ...(story.warnings.length > 200 ? { more: story.warnings.length - 200 } : {}),
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerResource(
    "cheatsheet",
    "voxdown://cheatsheet",
    { title: "VoxDown cheat sheet", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, text: CHEATSHEET }] }),
  );

  server.registerPrompt(
    "tag_speakers",
    {
      title: "Tag the speakers in a story",
      description: "Gives every quote in a VoxDown story its speaker, with VoxDown's tools.",
      argsSchema: z.object({ file: z.string().describe("The story's path") }),
    },
    ({ file }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Tag the speakers in the VoxDown story ${file}, with the voxdown tools.\n\n${PROCEDURE}`,
          },
        },
      ],
    }),
  );

  return server;
}

/** Serves the tools over this process's standard input and output, until the app closes them. */
export async function serveMcp(version: string): Promise<void> {
  const { serveStdio } = await import("@modelcontextprotocol/server/stdio");
  const files = diskFiles();
  serveStdio(() => createVoxdownServer(files, version), {
    onerror: (error) => process.stderr.write(`vxd mcp: ${error.message}\n`),
  });
}
