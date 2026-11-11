# Naming who speaks, with an AI you already have

A story written as ordinary prose has quotes no one is marked to say: `“Who’s there?” asked Tom.` VoxDown reads those with the narrator. To give each one its character, an AI can read the story and say who speaks; VoxDown then writes the marks itself (`@Tom “Who’s there?” asked Tom.`), and reads each one back so that **no word of the story ever changes**. A mark that would change a word heard or printed, or give the quote to someone else, is refused.

There are three ways to do it, all with an AI you already have, and no new account:

- **In the Writer**, with **Edit › Name the speakers with AI…**, once `vxd connect` runs on your computer;
- **`vxd tag`**, the command, which finds the AIs on your computer and asks one;
- **`vxd mcp`**, which lets the AI app you already use (Claude, ChatGPT, Codex, Cursor, VS Code…) use VoxDown's tools itself.

Both need [Node.js](https://nodejs.org) 20 or later.

## In the Writer: `vxd connect`

```sh
npx -y @voxdown/cli connect
```

Run it in a terminal and leave it running: it opens [the Writer](https://voxdown.github.io/writer/), connected to your computer. Then **Edit › Name the speakers with AI…** names the speakers with any AI `vxd tag` would find (choose one from the list; the choice is remembered), and gives them as one step to undo, listing the quotes it held back with their lines. **File › Make an audiobook…** does what `vxd produce` does, in the folder where `vxd connect` was started.

The Writer is a web page, and pages can't run programs: `vxd connect` is the small helper that can. It listens only on your own computer (127.0.0.1), answers only the Writer, and only with the key it opened the Writer with, a new one each time it starts. Chrome, Edge and Firefox ask once to let the page reach apps on your computer: allow it. Safari doesn't let pages reach them; use the commands, or one of the other browsers.

## `vxd tag`

```sh
npx -y @voxdown/cli tag story.vxd
```

It looks for:

| What | How it's paid for |
| --- | --- |
| [Claude Code](https://code.claude.com) (`claude`), signed in | your Claude plan |
| [Codex](https://developers.openai.com/codex) (`codex`), signed in | your ChatGPT plan |
| Antigravity (`agy`), Cursor (`cursor-agent`), GitHub Copilot CLI (`copilot`), Gemini CLI (`gemini`) | their plans |
| A model in [Ollama](https://ollama.com), [LM Studio](https://lmstudio.ai), llama.cpp, Jan or vLLM | free, on your computer |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `OPENROUTER_API_KEY` | that key |

With one, it uses it. With several, it asks which, and remembers. `vxd tag --list` shows what it found; `--with codex` (or `--with ollama:qwen3:14b`) chooses. It goes through the story a passage at a time (about 2,500 words), each passage read with the speakers already given before it, and shows what it gave, then asks before writing the file.

- Speakers the AI is unsure of are held back and listed with their lines, for you to check; `--min low` gives them too.
- `--dry-run` shows what it would give and writes nothing; `--json` lists every proposal with the AI's clue.
- `--with tags` needs no AI: it gives quotes to the names their dialogue tags give (`“…” asked Mara`).
- `--eval` measures an AI on a story that's already marked: it takes the speaker marks out, has the AI put them back, and scores it. On the chapters in [corpus/](../corpus), Claude Code put back 100% of the speakers in *Alice* (149 of 149) and in *A Scandal in Bohemia* (113 of 113), and Codex 22 of 23 in *The Last Lamp* (November 2026).

Agent programs run in an empty folder of their own, with their tools and settings off where they allow it: they see only the passage they're asked about.

## `vxd mcp`

`vxd mcp` serves VoxDown's tools over [MCP](https://modelcontextprotocol.io), the way AI apps take tools. Add it to yours once, then ask, for example: *“Tag the speakers in ~/books/owl.vxd”*. The app's own model does the work, on your plan.

The command to give an app is `npx -y @voxdown/cli mcp`.

| App | How to add it |
| --- | --- |
| **Claude Code** | `claude mcp add --scope user voxdown -- npx -y @voxdown/cli mcp` |
| **Claude Desktop** | Settings › Developer › Edit Config, then add the JSON below. |
| **Codex**, and the **ChatGPT desktop app** | `codex mcp add voxdown -- npx -y @voxdown/cli mcp`, or in ChatGPT: Settings › MCP servers › Add server › STDIO. They share `~/.codex/config.toml`. |
| **VS Code** (Copilot) | `code --add-mcp '{"name":"voxdown","type":"stdio","command":"npx","args":["-y","@voxdown/cli","mcp"]}'` |
| **Cursor** | `~/.cursor/mcp.json`, with the JSON below. |
| **Zed** | Settings › AI › MCP Servers › Add Server, with the command above. |
| **GitHub Copilot CLI** | `~/.copilot/mcp-config.json`, with the JSON below. |

The JSON, for apps that take a file:

```json
{
  "mcpServers": {
    "voxdown": { "command": "npx", "args": ["-y", "@voxdown/cli", "mcp"] }
  }
}
```

For Codex and ChatGPT, a first start can take longer than the 10 seconds they wait while npm fetches the package. Run `npx -y @voxdown/cli --version` once first, or add `startup_timeout_sec = 60` under `[mcp_servers.voxdown]` in `~/.codex/config.toml`.

The tools:

| Tool | What it does |
| --- | --- |
| `voxdown_guide` | The cheat sheet, and the steps for tagging speakers. |
| `voxdown_story` | A story's title, narrator and cast, and how many quotes wait for a speaker. |
| `voxdown_unattributed_quotes` | One passage with its waiting quotes numbered `⟦n⟧`, the paragraphs before it, and a revision to answer with. |
| `voxdown_assign_speakers` | Gives quotes to speakers and writes the story, refusing (with the reason) anything that would change a word. `dryRun` writes nothing. |
| `voxdown_add_character` | Adds a character to the cast, with their full name and a few words about them. |
| `voxdown_check` | The story's warnings. |

They read and write only `.vxd` and `.md` files, and a story is written whole or not at all. Giving speakers with a revision from before the story's words changed is refused, so an app working while you write can't put a mark in the wrong place.

## Where your words go

Only to the AI you choose, and only when you run `vxd tag` or ask your app to: VoxDown itself sends nothing anywhere. A local model keeps everything on your computer.
