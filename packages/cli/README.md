# @voxdown/cli

The `vxd` command for [VoxDown](https://voxdown.github.io/voxdown/), a plain-text format for stories read aloud. It checks stories for problems, tidies them, renders them as HTML, exports the spoken script for speech tools and performers, and imports Fountain screenplays.

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

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Done. |
| 1 | Problems found: `check` found a warning (or, with `--strict`, an info), or `fmt --check` found files to format. |
| 2 | The command couldn't run: a usage error, or a file that can't be read or written. |

An error is one line on standard error, such as `vxd: no such file: story.vxd`.

## License

MIT
