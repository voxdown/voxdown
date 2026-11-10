# VoxDown cheat sheet

Every mark on one page. VoxDown 1.0; the full rules are in [SPEC.md](SPEC.md).

**The one rule:** on each line, the quotes after a name belong to it, and everything else belongs to the narrator.

## Who speaks

| Write | It means |
| --- | --- |
| `@Gerald “Could you not?”` | Gerald says the quote after his name. |
| `@Gerald “I’m tired,” said the dragon.` | Only the quote is Gerald’s; “said the dragon” is the narrator’s. |
| `@Baker “A little flame,” he said. “Gently.”` | A quote later on the same line carries the speech on: “Gently.” is the baker’s too. |
| `@Wanda “Fine!” @Marmalade “Hm.”` | Two characters on one line, each with their own mark. |
| `@Gerald Could you not?` | No quote: Gerald says the rest of the line. |
| `“Stop thief!” cried Mr. McGregor.` | No mark: the narrator reads it all, quotes included. |
| `\@Gerald`, `\“` | A backslash makes a sign literal: an `@` that isn’t a mark, a quote the narrator reads. |

## How it is said

| Write | It means |
| --- | --- |
| `@Gerald (yawning) “I’m tired.”` | A direction, straight after the name. Never read aloud or printed. |
| `@(warmly) Once upon a time…` | A direction for whoever is speaking: here, the narrator, to the end of the line. |
| `@Gerald “I know. @(yawning) I’m tired.”` | A new direction partway through. |
| `@(nervously) He looked around, @() and relaxed.` | `@()` ends a direction early. |
| `::: whispering` … `:::` | A direction for every line between the colons. |
| `::: @Wanda reading the letter` … `:::` | Several lines and paragraphs for one character. |

## What is heard

| Write | It means |
| --- | --- |
| `The broom fell over. [wooden clatter]` | A sound, where it is written. |
| `@Gerald [snores]` | A sound Gerald makes. Inside his speech: `@[sneezes]`. |
| `{pause}`, `{pause 2s}`, `{pause 500ms}` | A pause: a beat, or a length. |
| `%% Leave a pause after this. %%` | A note for the performer. Never read aloud or printed. |
| `{recorder:take 3}` | A tool’s own instruction: kept in place, ignored by other tools. |

## The page

| Write | It means |
| --- | --- |
| `{page}`, `{page 12}` | A page turn, optionally naming the page that begins. |
| `# Title`, `## The cave` | Headings, read aloud by the narrator. |
| `## The cave {hidden}` | A heading that is a label only: not read, not printed. |
| `---` | A scene break. Use `***` to start a file with one. |
| `{book only} First published 1902.` | Printed, not read aloud. |
| `{audio only} Turn the page at the bell.` | Read aloud, not printed. |
| `*stressed*`, `**bold**` | Emphasis, printed and kept in the spoken script. |

## The file

```yaml
---
voxdown: 1.0
title: The Tale of Peter Rabbit
author: Beatrix Potter
language: en-GB
cast:
  Peter: Peter Rabbit
  Mother:
    name: Mrs. Rabbit
    about: Kind, brisk, and firm about gardens.
---
```

Files end in `.vxd` (`.md` works too). A name is one word: `@SillyClown`, `@O’Brien`, `@花子`; the cast gives the full name. Names ignore case. A line break inside a paragraph is kept in print and heard as a space. A file never fails to read: problems are warnings.
