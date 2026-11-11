# @voxdown/cli

The `vxd` command for [VoxDown](https://voxdown.github.io/), a plain-text format for stories read aloud. It checks stories for problems, tidies them, renders them as HTML, exports the spoken script for speech tools and performers, imports Fountain screenplays, names who says each quote with an AI you already have, and makes audiobooks with the voice service you have.

## Install

```sh
npm install -g @voxdown/cli
```

You need Node 20 or later. The command is `vxd`. To try it without installing, `npx @voxdown/cli check story.vxd`.

## Commands

Every command reads its files as UTF-8. A file can end in `.vxd` or `.md`, and `-` reads standard input. Run `vxd --help`, or `vxd <command> --help`, for every option.

The examples use this story, `story.vxd`:

```
---
title: The Dragon Who Wanted to Sleep
cast:
  Gerald: Gerald the dragon
  Percival: Sir Percival
  Wanda:
---

## The cave

The dragon was snoring. @Gerald [snores]

@Gerald (deep, polite) “Could you not?”

@Percival “I meant to do that,” said Sir Percival. [armor wobbles]

@Gerlad “Go away.”
```

### `vxd check`: find problems

```sh
vxd check story.vxd
```

```
story.vxd:6:3  info  silent-cast-member  Wanda is in the cast but never speaks.
story.vxd:17:2  warning  unknown-character  “Gerlad” is not in the cast.
1 warning, 1 info in story.vxd.
```

Each line is `file:line:column  level  code  message`. The codes are listed in the spec, §12.3. A warning fails the check; info doesn't, unless you add `--strict`. `--json` prints the same problems as a JSON array, for editors and scripts.

### `vxd fmt`: tidy files

```sh
vxd fmt story.vxd chapters/*.vxd
```

Formats each file in place and prints the names of the files it changed. It trims and collapses spaces, makes runs of blank lines one, puts a blank line around headings and scene breaks, and writes each name as the cast spells it (`@gerald` becomes `@Gerald`). It never changes who says what. A file that is already formatted isn't written at all, so its modification time stays the same.

- `--check` writes nothing. It lists the files that would change and exits 1 if there are any, which suits a CI step.
- `--stdout` prints the result instead of writing it.
- `--quotes curly` turns straight quotation marks into curly ones, in the story's language, or in the one you give with `--language de`.
- `--no-names` leaves names as written. `--no-spacing` leaves spaces and blank lines as written.

### `vxd render`: HTML

```sh
vxd render story.vxd --out story.html
```

Writes a whole HTML page with its stylesheet. The default script view shows who says what, how, and every sound, pause and page turn. `--view book` shows the printed story, and `--pages` adds page numbers in its margin. `--fragment` writes only the story's `<article>`, for a page of your own, and `--no-header` leaves out the title, author and cast.

### `vxd export`: the spoken script as data

```sh
vxd export story.vxd --format csv
```

```
kind,speaker,direction,text,scene,page
speech,Narrator,,The cave,1,1
speech,Narrator,,The dragon was snoring.,1,1
vocal,Gerald,,snores,1,1
speech,Gerald,"deep, polite",Could you not?,1,1
speech,Percival,,"I meant to do that,",1,1
speech,Narrator,,said Sir Percival.,1,1
sound,,,armor wobbles,1,1
speech,Gerlad,,Go away.,1,1
```

The default `--format json` gives the same rows with more fields, such as each row's line and column in the file. `--speech-only` keeps only what characters say: speech and the sounds they make.

`--format text` gives each character's lines, for a performer's script:

```sh
vxd export story.vxd --format text
```

```
== Gerald ==
[snores]
(deep, polite) Could you not?

== Percival ==
I meant to do that,

== Narrator ==
The cave
The dragon was snoring.
said Sir Percival.

== Gerlad ==
Go away.
```

With `--out sides/`, it writes one file per character instead: `sides/Gerald.txt`, `sides/Percival.txt` and so on. `--out` takes a folder that exists or a path ending in `/`.

### `vxd text`: the two readings

```sh
vxd text story.vxd --spoken
```

```
## Narrator: The cave

Narrator: The dragon was snoring.
Gerald [snores]

Gerald (deep, polite): Could you not?

Percival: I meant to do that,
Narrator: said Sir Percival.
[armor wobbles]

Gerlad: Go away.
```

`--spoken` prints the spoken script, everything heard in order with its voice. `--book` prints the book text, the printed story as plain Markdown without the marks.

### `vxd import`: from Fountain

```sh
vxd import screenplay.fountain --out story.vxd
```

Turns a [Fountain](https://fountain.io) screenplay into a VoxDown story. Character cues become marks, parentheticals become directions, action becomes narration, and the cast is gathered from the cues. Scene headings become hidden headings, which aren't read aloud; `--read-scene-headings` has them read.

### `vxd tag`: name who says each quote, with an AI you already have

```sh
vxd tag story.vxd
```

Asks an AI who says each quote that no mark gives to anyone, a passage at a time, and marks it: `“Hello,” said Tom.` becomes `@Tom “Hello,” said Tom.` The words never change: each mark is read back, and refused if anything heard or printed would change. Someone new joins the cast.

The AI is one you already have, found on your computer:

- **Claude Code** or **Codex**, signed in to your Claude or ChatGPT plan (also Antigravity, Cursor, GitHub Copilot CLI and Gemini CLI);
- a model running in **Ollama**, **LM Studio**, llama.cpp, Jan or vLLM;
- an API key in `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `OPENROUTER_API_KEY`.

`vxd tag --list` shows what it finds. With several, it asks which and remembers; `--with codex` chooses one (`--with ollama:qwen3:14b` a model). Speakers the AI is unsure of are held back and listed with their lines; `--min low` gives them too. `--dry-run` writes nothing, `--yes` doesn't ask before writing, and `--out` writes another file. `--with tags` uses the dialogue tags alone (`“…” asked Mara`), with no AI.

`--eval` measures an AI on a story that's already marked: it takes the speaker marks out, has the AI put them back, and scores it.

### `vxd produce`: an audiobook

```sh
vxd produce story.vxd --dry-run
vxd produce story.vxd --with elevenlabs
```

Reads the story aloud, each character in a voice of their own, with a voice service you have: ElevenLabs (`ELEVENLABS_API_KEY`), Azure (`AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`), Kokoro running on your computer (free), OpenAI (`OPENAI_API_KEY`), or any OpenAI-compatible speech server (`--with http://host:port --model name`). The first run writes a casting to change, `casting.json`; `--dry-run` shows it and what the book would cost. The book goes to `story.audiobook/`: an M4B with its chapters marked and an MP3 a chapter (with ffmpeg), and when each line is heard. Lines already made are kept, so making it again only pays for what changed. `--chapters 1` makes one chapter; `--sounds` makes sounds with the service's sound effects; `--studio` sends the book to ElevenLabs Studio as a project instead, to convert and publish there; `--script-only` writes the production script and SSML for other tools. [docs/produce.md](https://github.com/voxdown/voxdown/blob/main/docs/produce.md) has more.

### `vxd connect`: the Writer, with this computer's AIs and voices

```sh
vxd connect
```

Lets [VoxDown Writer](https://voxdown.github.io/writer/), in your browser, name speakers with the AIs on your computer and make audiobooks with its voice services, as `vxd tag` and `vxd produce` do. It opens the Writer, connected; leave it running while you use it. It listens only on 127.0.0.1, and answers only the Writer, with a key made each time it starts.

### `vxd mcp`: VoxDown's tools for AI apps

```sh
claude mcp add --scope user voxdown -- npx -y @voxdown/cli mcp
```

Serves VoxDown's tools over [MCP](https://modelcontextprotocol.io), so the AI app you use (Claude, ChatGPT and Codex, Cursor, VS Code, Zed…) can read the format's cheat sheet, list a story's quotes that no one is marked to say, and give them to speakers, with the same checks as `vxd tag`. [docs/ai.md](https://github.com/voxdown/voxdown/blob/main/docs/ai.md) has the line for each app.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Done. |
| 1 | Problems found: `check` found a warning (or, with `--strict`, an info), or `fmt --check` found files to format. |
| 2 | The command couldn't run: a usage error, a file that can't be read or written, or (`tag`) an AI that couldn't be asked. |

An error is one line on standard error, such as `vxd: no such file: story.vxd`.

## License

MIT
