# VoxDown

**Version 1.0, 9 November 2026.** This specification is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Its examples are also published as [conformance.json](conformance.json) (§15). What changed since the drafts is in [CHANGELOG.md](CHANGELOG.md), and every mark fits on one page in [CHEATSHEET.md](CHEATSHEET.md).

VoxDown is a plain-text format for stories that are read aloud. It records:

- who says each line, and how they say it;
- the sounds a listener hears;
- where the pages turn and where the reader pauses;
- what is printed but not read aloud, and what is read aloud but not printed;
- notes for whoever performs or produces the story.

A file in this format is a Markdown story with light marks in it. Take the marks out and you have the printed story. Leave them in and you have a script that a narrator, a cast, or a speech engine can perform.

```
## The cave
Then he heard a deep rumble. [deep rumbling, from inside a cave]
The dragon was snoring. @Gerald [snores]
::: whispering
Sir Percival crept inside.
Clank.
{page}
The dragon opened one eye.
:::
@Gerald (deep, polite and utterly unbothered) “Could you not?”
Sir Percival stopped.
@Gerald “I’ve only just got to sleep,” said the dragon.
```

## Contents

1. [Goals](#1-goals)
2. [The marks at a glance](#2-the-marks-at-a-glance)
3. [How to read this spec](#3-how-to-read-this-spec)
4. [The file](#4-the-file)
5. [Who speaks](#5-who-speaks)
6. [How it is said](#6-how-it-is-said)
7. [Groups](#7-groups)
8. [Sounds](#8-sounds)
9. [Pages, pauses and what is printed](#9-pages-pauses-and-what-is-printed)
10. [Notes](#10-notes)
11. [Markdown inside the story](#11-markdown-inside-the-story)
12. [The two readings](#12-the-two-readings)
13. [Tools that edit files](#13-tools-that-edit-files)
14. [Rendering](#14-rendering)
15. [Conformance](#15-conformance)
16. [Versions](#16-versions)
17. [Beyond 1.0](#17-beyond-10)

## 1. Goals

- **The raw text reads like the book.** Someone who has never seen the format can read a file and follow the story. The marks look like pencil notes in a manuscript.
- **One sign for each kind of mark.** `@` means a voice, `( )` means how something is said, `[ ]` is a sound, `{ }` is a page or a timing instruction, and `%% %%` is a note.
- **Every Markdown story is already valid.** A story with no marks is read by one narrator from start to finish. Marks are added one at a time, wherever they help.
- **One line at a time.** What a mark does ends with its line, so a writer can check each line on its own (§5.3).
- **Readable anywhere.** Any Markdown viewer still shows a readable story. Nothing breaks if a file is opened in a plain text editor.
- **No errors, only warnings.** Every file means something. A missing closing quote or an unknown name produces a warning, never a refusal.
- **Edits stay small.** A tool that changes who says a line, or adds a direction, rewrites only that mark. The author's spacing, quote style and line breaks are never touched (§13).
- **Story-level only.** The format names characters, not voices, engines or providers. Casting, voice choices, takes, timings and mixing belong to the tools that produce the audio. Tools may keep their own data in the front matter (§4.2) or in instructions (§9.5).

## 2. The marks at a glance

| You want | You write |
| --- | --- |
| A character's line | `@Gerald “Could you not?”` |
| A line inside narration | `@Gerald “I’ve only just got to sleep,” said the dragon.` |
| How it is said | `@Gerald (yawning) “I’m tired.”` |
| A direction for the narrator | `@(warmly) Once upon a time…` |
| A change of direction mid-line | `@Gerald “I know. @(yawning) I’m tired.”` |
| Back to no direction | `@(nervously) The fox looked around, @() and then relaxed.` |
| A direction over several lines | `::: whispering` … `:::` |
| Several lines by one character | `::: @Wanda reading the letter` … `:::` |
| A sound | `The broom fell over. [wooden clatter]` |
| A sound a character makes | `@Gerald [snores]`, or `@[sneezes]` inside his line |
| A page turn | `{page}` |
| A pause | `{pause}` or `{pause 2s}` |
| Printed, not read aloud | `{book only} First published 1902.` |
| Read aloud, not printed | `{audio only} Turn the page when you hear the bell.` |
| A note for the performer | `%% Leave a clear pause after this line. %%` |
| Title, chapter, scene | `# Title`, `## Scene` |
| A scene break | `---` |
| The cast | Front matter: `cast:` (§4.3) |

The one rule to remember: **on each line, the quotes after a name belong to it, and everything else belongs to the narrator.**

## 3. How to read this spec

Each rule comes with examples. An example shows the input, then a line with a single dot, and then **the spoken script**: what a listener hears, in order (§12.1). Some examples add a second dot and **the book text**: what a reader sees in print (§12.2).

The spoken script has one line per thing heard. A line is either:

- `Character: text` for something said, or `Character (direction): text` when it has a direction;
- `[description]` for a sound;
- `Character [description]` for a sound made by a character;
- `{page}`, `{pause}` or another instruction;
- `%% text %%` for a note.

A new line in the file starts a new line in the script. A blank line separates paragraphs. Headings start with `#` and scene breaks are `---`. §12.1 gives the details.

```example
@Gerald (yawning) “I’ve only just got to sleep,” said the dragon.
.
Gerald (yawning): I’ve only just got to sleep,
Narrator: said the dragon.
```

The examples are also the conformance tests: a parser follows this spec when it produces every example's output.

## 4. The file

### 4.1 Overall shape

A file is UTF-8 text. It starts with optional front matter, followed by the story. Line endings may be LF or CRLF. Tools keep whichever a file uses.

Files use the `.vxd` extension. Every VoxDown file is also a Markdown file, so a file may use `.md` instead where it is mostly read in Markdown tools; tools that read VoxDown accept both. The suggested media type is `text/markdown; variant=VoxDown` ([RFC 7763](https://www.rfc-editor.org/rfc/rfc7763)).

### 4.2 Front matter

Front matter is YAML between two `---` lines at the very top of the file. It is metadata: none of it is read aloud.

```yaml
---
voxdown: 1.0
title: The Tale of Peter Rabbit
author: Beatrix Potter
language: en-GB
cast:
  Narrator:
  Peter: Peter Rabbit
  Mother:
    name: Mrs. Rabbit
    about: Peter’s mother. Kind, brisk, and firm about gardens.
  McGregor: Mr. McGregor
---
```

| Key | Meaning |
| --- | --- |
| `voxdown` | The version of this spec the file follows, such as `1.0` (§16). Recommended. |
| `title`, `subtitle`, `author` | The book's details. |
| `language` | The story's main language, as a [BCP 47](https://www.rfc-editor.org/info/bcp47) tag such as `en-GB` or `de`. |
| `narrator` | Which cast member reads everything not marked otherwise. Defaults to `Narrator` (§5.1). |
| `cast` | The characters, in the order a tool should list them (§4.3). |

Any other key is allowed and must be kept by tools that rewrite the file. A tool's own data should sit under one key named after the tool, for example `recorder:`.

Front matter is YAML, and a reader understands at least this part of it: maps nested by indentation; plain, single-quoted and double-quoted values, including ones continued on more indented lines; block values (`|`, `>` and their `-` and `+` forms); lists written as `- item` or `[a, b]`; and comments. A tool that writes front matter keeps to that part. Anything else (anchors, aliases, tags, `{…}` maps) may be read as plain text, with a warning.

```example
---
title: The Tale of Peter Rabbit
author: Beatrix Potter
---
Once upon a time there were four little Rabbits.
.
Narrator: Once upon a time there were four little Rabbits.
```

### 4.3 The cast

`cast` maps each character's **name**, the one word written after `@`, to one of:

- nothing, when that word is all there is: `Gerald:`;
- their full name: `Clown: The Silly Clown`;
- a map with `name` (full name, defaults to the word), `about` (who they are and how they sound, in plain words) and any other keys.

A character does not need to be in the cast to speak. An undeclared name is a character whose full name is that word (and a tool may warn about it). The cast exists for full names, descriptions, ordering, and characters who never speak but still matter, such as a silent broom.

```example
---
cast:
  Clown: The Silly Clown
---
@Clown “Honk!”
.
Clown: Honk!
```

```example
@Shepherd “Just count the sheep,” said the shepherd.
.
Shepherd: Just count the sheep,
Narrator: said the shepherd.
```

### 4.4 The story

After the front matter comes the story, made of:

- **paragraphs**: one or more lines, ended by a blank line;
- **headings**: `#` to `######` followed by a space;
- **scene breaks**: a line of three or more `-`, `*` or `_`;
- **groups**: `:::` … `:::` (§7).

Notes (§10) can sit anywhere, even across blank lines.

Blank lines around headings, scene breaks and group lines are optional. Each of them is always on a line of its own and ends the paragraph before it. (Markdown viewers show the line above a `---` with no blank line as a heading, so leave blank lines there if the file will also be read in one.)

Inside a paragraph, a line break is kept: a reader sees it in the book text, and it is heard as an ordinary space. This differs from Markdown, which joins lines. Picture books, verse, letters and signs all depend on their line breaks, and story writers rarely wrap lines by hand. Marks also work line by line (§5.3).

```example
And their names were—
Flopsy,
Mopsy,
Cotton-tail,
and Peter.
.
Narrator: And their names were—
Narrator: Flopsy,
Narrator: Mopsy,
Narrator: Cotton-tail,
Narrator: and Peter.
.
And their names were—
Flopsy,
Mopsy,
Cotton-tail,
and Peter.
```

Spaces at the start of a line are ignored.

A file that starts with a `---` line has front matter only if a second `---` line closes it. To start a story with a scene break, use `***`.

Headings are part of the story: they are read aloud by the narrator unless marked `{book only}` or `{hidden}` (§9.3). By convention `#` is the title, or a chapter in a longer book, and `##` names a scene. The spec gives the levels no other meaning.

```example
# The Tale of Peter Rabbit

Once upon a time there were four little Rabbits.
.
# Narrator: The Tale of Peter Rabbit

Narrator: Once upon a time there were four little Rabbits.
```

```example
Until Tuesday.

---

On Tuesday morning, the king summoned him.
.
Narrator: Until Tuesday.

---

Narrator: On Tuesday morning, the king summoned him.
```

The same story written without blank lines means the same thing:

```example
Until Tuesday.
---
On Tuesday morning, the king summoned him.
.
Narrator: Until Tuesday.

---

Narrator: On Tuesday morning, the king summoned him.
```

```example
Mount Mumble was very tall.
## The cave
Then he heard a deep rumble.
.
Narrator: Mount Mumble was very tall.

## Narrator: The cave

Narrator: Then he heard a deep rumble.
```

## 5. Who speaks

### 5.1 The narrator

Everything is read by the narrator unless it is marked. The narrator is the cast member named `Narrator`, or the one the front matter's `narrator:` key names, for example in a story told in the first person. That includes quotations: an unmarked quote is the narrator reading it, as in a single-narrator audiobook.

```example
“Stop thief!” cried Mr. McGregor.
.
Narrator: “Stop thief!” cried Mr. McGregor.
```

```example
---
narrator: Peter
---
I ran. @Mother “Peter!”
.
Peter: I ran.
Mother: Peter!
```

### 5.2 Names

`@` followed by a name is a **character mark**. A name is one word: it starts with a letter and continues with letters, digits, `-` and `_`, and apostrophes between two letters, as in `@O’Brien`. Any script's letters count, so `@Zoë` and `@花子` are both names.

A character with a longer name gets a short one in the cast (`Clown: The Silly Clown`, then `@Clown`), or the words are joined (`@SillyClown`). Tools show the full name; the short one only appears in the raw text.

```example
@SillyClown “Honk!”
.
SillyClown: Honk!
```

Names ignore case: `@clown`, `@Clown` and `@CLOWN` are the same character. The spoken script uses the cast's spelling, or else the spelling the file uses first. The narrator is written as the cast or the `narrator:` key spells it, or else `Narrator`.

```example
---
cast:
  Clown: The Silly Clown
---
@clown “Honk!” @CLOWN “Honk honk!”
.
Clown: Honk!
Clown: Honk honk!
```

```example
@clown “Honk!”
@Clown “Honk honk!”
.
clown: Honk!
clown: Honk honk!
```

```example
@narrator (warmly) Once upon a time.
.
Narrator (warmly): Once upon a time.
```

`@` is only a mark when it is not preceded by a letter or digit, and when it is followed by a name, `(` or `[`. So email addresses and a lone `@` are just text. In a script written without spaces between words (Chinese, Japanese, Thai, Lao, Khmer, Burmese), a mark may follow a letter directly: `最怕打雷的雷公@雷公 [笑]`. Write `\@` for a literal `@` anywhere.

```example
Write to tom@example.com, or meet me @ noon.
.
Narrator: Write to tom@example.com, or meet me @ noon.
```

```example
雷公听见了@雷公 [笑]
.
Narrator: 雷公听见了
雷公 [笑]
```

```example
\@Gerald is my username.
.
Narrator: @Gerald is my username.
```

### 5.3 One line at a time

A paragraph can have several lines. Marks work line by line: who speaks and how end at the end of the line. Two things run longer:

- a **group** runs until it is closed (§7);
- a **quote** runs to its closing mark, even over several lines (§5.7), and its speech can be carried on along the line where it closes (§5.6).

So the one rule to remember is: **on each line, the quotes after a name belong to it, and everything else belongs to the narrator.**

A quote that runs over several lines keeps its character and direction until it closes.

### 5.4 Quoted speech

A character mark gives the character **the quotes after it on its line**. The character says everything inside the first quote after the mark, up to the matching closing mark, unless another character mark comes between them. Everything outside the quotes is narration. Between the mark and the quote there may be a direction (§6), then a sound the character makes (§8.2), then narration.

```example
@Gerald “Could you not?”
.
Gerald: Could you not?
```

```example
@Gerald “I’ve only just got to sleep,” said the dragon.
.
Gerald: I’ve only just got to sleep,
Narrator: said the dragon.
```

The mark can sit directly before the quote, or at the start of the line. Both mean the same.

```example
Gerald put on his spectacles. @Gerald “I thought perhaps librarian.”
.
Narrator: Gerald put on his spectacles.
Gerald: I thought perhaps librarian.
```

```example
@Gerald Gerald put on his spectacles. “I thought perhaps librarian.”
.
Narrator: Gerald put on his spectacles.
Gerald: I thought perhaps librarian.
```

```example
@Baker And out of the blue, “Just a little flame,” said the baker. “Gently.”
.
Narrator: And out of the blue,
Baker: Just a little flame,
Narrator: said the baker.
Baker: Gently.
```

A direction on the mark goes with the character's speech, not with the narration before it.

```example
@Baker (nervously) And out of the blue, “Just a little flame,” said the baker.
.
Narrator: And out of the blue,
Baker (nervously): Just a little flame,
Narrator: said the baker.
```

A mark never reaches back to a quote before it. It is not a word, either: it disappears from the printed text, so `said @Gerald` prints as "said".

```example
“Could you not?” said @Gerald.
.
Narrator: “Could you not?” said
.
“Could you not?” said .
```

Several characters can speak on one line, each with their own mark.

```example
@Wanda “Fine!” @Marmalade “Hm.”
.
Wanda: Fine!
Marmalade: Hm.
```

The quotation marks are printed but not spoken: the spoken script leaves out the speech's own opening and closing marks. Quotes inside a speech are kept.

```example
@Gerald “‘But you are a chicken,’ said the duke.”
.
Gerald: ‘But you are a chicken,’ said the duke.
```

### 5.5 Quotation marks

Each opening mark has its own closing marks:

| Opening | Closes with | Used in |
| --- | --- | --- |
| `“` | `”` | English |
| `‘` | `’` | British English |
| `"` | `"` | Plain text |
| `'` | `'` | Plain text |
| `„` | `“` or `”` | German, Polish, Dutch |
| `‚` | `‘` or `’` | German (inner) |
| `«` | `»` | French, Italian, Spanish, Russian |
| `»` | `«` or `»` | Danish, Swedish |
| `‹` | `›` | French (inner) |
| `「` | `」` | Japanese, Chinese |
| `『` | `』` | Japanese, Chinese (inner) |

Some marks double as apostrophes and measurements, so three rules keep them apart:

- When no quote is open, a `'`, `‘` or `"` straight after a letter or digit is not a quote: `rock'n'roll`, `6" nail`.
- A straight `'` opens a quote only if a closing `'` follows on the same line. So `'cause` and `'em` stay apostrophes, and a straight `'` quote never runs over a line break or into the next paragraph.
- Inside a quote, the first matching closing mark closes it, except a `’` or `'` followed by a letter or digit, so `don’t` never ends a speech.

A quotation mark with nothing after it on its line opens nothing; it stays in the text as an ordinary character.

```example
@Mother ‘Now run along, and don’t get into mischief.’
.
Mother: Now run along, and don’t get into mischief.
```

```example
@Gerald "Could you not?" said the dragon.
.
Gerald: Could you not?
Narrator: said the dragon.
```

```example
@Anna „Guten Morgen“, sagte Anna.
.
Anna: Guten Morgen
Narrator: , sagte Anna.
```

A plural possessive inside single quotes, such as `rabbits’ burrow`, looks like a closing mark. Write `\’` for it.

```example
@Mother ‘Mind the rabbits\’ burrow.’
.
Mother: Mind the rabbits’ burrow.
```

```example
@Gerald "Fine," he said, 'cause he was tired.
.
Gerald: Fine,
Narrator: he said, 'cause he was tired.
```

A mark straight after a letter is not a mark (§5.2), so in languages written without spaces, put the mark at the start of the line. It still claims the quote after it.

```example
@Hanako 花子は「はい」と言った。
.
Narrator: 花子は
Hanako: はい
Narrator: と言った。
.
花子は「はい」と言った。
```

### 5.6 A speech interrupted by narration

On the line where a character's speech ends, an unmarked quote that comes after it carries that speech on, as if the narration had only interrupted it. It keeps the same character, and the direction the speech had when it was interrupted. This is how books write a line broken by "said the baker".

```example
@Baker “Just a little flame,” said the baker. “Gently.”
.
Baker: Just a little flame,
Narrator: said the baker.
Baker: Gently.
```

```example
@Advisor (urgent, formal whisper) “Sire,” whispered his advisor. “This is where you shout ‘Attack!’”
.
Advisor (urgent, formal whisper): Sire,
Narrator: whispered his advisor.
Advisor (urgent, formal whisper): This is where you shout ‘Attack!’
```

```example
@Gerald “I know. @(yawning) I’m tired,” he said. “Very.”
.
Gerald: I know.
Gerald (yawning): I’m tired,
Narrator: he said.
Gerald (yawning): Very.
```

A carried-on quote follows the most recent speech on the line.

```example
@Wanda “Fine,” she said. @Marmalade “Good,” said the cat. “Very good.”
.
Wanda: Fine,
Narrator: she said.
Marmalade: Good,
Narrator: said the cat.
Marmalade: Very good.
```

A closed speech is never carried on to the next line, so a quote on a new line with no mark is narration. A new speaker always needs a mark. A forgotten mark falls back to the narrator, where it is easy to hear, rather than to the wrong character.

```example
@Percival “Aren’t you going to roar?”
The dragon sighed.
“Rooooar.”
.
Percival: Aren’t you going to roar?
Narrator: The dragon sighed.
Narrator: “Rooooar.”
```

```example
@Percival “Aren’t you going to roar?”
The dragon sighed.
@Gerald “Rooooar.”
.
Percival: Aren’t you going to roar?
Narrator: The dragon sighed.
Gerald: Rooooar.
```

```example
@Wanda “Fine.”

“Fine,” said someone else.
.
Wanda: Fine.

Narrator: “Fine,” said someone else.
```

The cost falls on text wrapped by hand, where an interrupted speech goes on after a line break. Join the lines, or mark the speaker again.

```example
@Mother ‘Now my dears,’ said old Mrs. Rabbit one
morning, ‘you may go into the fields.’
.
Mother: Now my dears,
Narrator: said old Mrs. Rabbit one
Narrator: morning, ‘you may go into the fields.’
```

To keep a quote in narration as narration, put a backslash before its opening mark.

```example
@Wanda “Fine,” she said, in her \‘polite’ voice.
.
Wanda: Fine,
Narrator: she said, in her ‘polite’ voice.
```

### 5.7 A speech over several lines or paragraphs

A quote runs to its closing mark, even over several lines of a paragraph, as a song or a poem does. (A straight `'` quote is the exception: it always closes on its own line, §5.5.)

```example
@Gerald (softly) “Twinkle, twinkle, little star,
How I wonder what you are.”
He yawned.
.
Gerald (softly): Twinkle, twinkle, little star,
Gerald (softly): How I wonder what you are.
Narrator: He yawned.
```

The speech ends on its second line, so a quote later on that line carries it on (§5.6).

```example
@Gerald “Twinkle, twinkle, little star,
How I wonder what you are,” he sang. “Up above the world so high.”
.
Gerald: Twinkle, twinkle, little star,
Gerald: How I wonder what you are,
Narrator: he sang.
Gerald: Up above the world so high.
```

A quote with no closing mark ends with its paragraph. If the next paragraph begins with the same opening mark, that paragraph carries the speech on, with the same character and direction. This is the book convention for one character speaking over several paragraphs. Paragraphs holding only page turns, pauses, other instructions or notes are skipped when looking for the next paragraph.

```example
@Gerald “Oh no, I’m going to
.
Gerald: Oh no, I’m going to
```

```example
@Gerald “Once upon a time there was a chicken.

“He believed he was the king of France.”

Twenty children laughed.
.
Gerald: Once upon a time there was a chicken.

Gerald: He believed he was the king of France.

Narrator: Twenty children laughed.
```

```example
@Gerald “Once upon a time there was a chicken.

{page}

“He believed he was the king of France.”
.
Gerald: Once upon a time there was a chicken.

{page}

Gerald: He believed he was the king of France.
```

### 5.8 Speech without quotes

When a mark has no quote of its own (no quote after it on its line before the next character mark), the character says the rest of the line, up to that next mark, unless the mark is followed by a sound, directly or after its direction (§8.2). This suits scripts written without quotation marks. Directions, sounds, instructions, notes and images inside it don't end it.

```example
@Gerald Could you not? I’ve only just got to sleep.
.
Gerald: Could you not? I’ve only just got to sleep.
```

```example
@Gerald Could you not? @Percival Sorry.
.
Gerald: Could you not?
Percival: Sorry.
```

```example
@Gerald Well, @Percival “Sorry.”
.
Gerald: Well,
Percival: Sorry.
```

```example
@Gerald Could you not? @(yawning) I’m tired.
.
Gerald: Could you not?
Gerald (yawning): I’m tired.
```

```example
@Gerald Could you not? [a distant clang] I’m tired.
.
Gerald: Could you not?
[a distant clang]
Gerald: I’m tired.
```

Like everything else, it ends with the line.

```example
@Gerald Could you not?
I’ve only just got to sleep.
.
Gerald: Could you not?
Narrator: I’ve only just got to sleep.
```

A script line without outer quotes but with a quote inside it gives that quote to the character, and the rest to the narrator. Give such a line its outer quotes, or put it in a group (§7.2).

```example
@Gerald They charge into my cave shouting, ‘PREPARE TO MEET THY DOOM!’
.
Narrator: They charge into my cave shouting,
Gerald: PREPARE TO MEET THY DOOM!
```

```example
@Gerald “They charge into my cave shouting, ‘PREPARE TO MEET THY DOOM!’”
.
Gerald: They charge into my cave shouting, ‘PREPARE TO MEET THY DOOM!’
```

`@Narrator` is a character mark like any other, so it claims the quotes on its line too. To give narration a direction, `@(…)` (§6.2) is usually what you want.

```example
@Narrator (warmly) Once upon a time, “Hello,” said the cat.
.
Narrator: Once upon a time,
Narrator (warmly): Hello,
Narrator: said the cat.
```

```example
@(warmly) Once upon a time, “Hello,” said the cat.
.
Narrator (warmly): Once upon a time, “Hello,” said the cat.
```

## 6. How it is said

### 6.1 Directions

A direction is free text in parentheses straight after a character mark. It says how the speech is performed, in the author's own words. Directions are never read aloud or printed.

```example
@Gerald (deep, polite and utterly unbothered) “Could you not?”
.
Gerald (deep, polite and utterly unbothered): Could you not?
```

```example
@Narrator (warmly) Sir Percival had been training his entire life.
.
Narrator (warmly): Sir Percival had been training his entire life.
```

Parentheses anywhere else are part of the story, read aloud and printed. Stories use them all the time, so only the `@` makes a direction.

```example
Her broom (which was old) creaked. @Wanda (sighing) “Come on.”
.
Narrator: Her broom (which was old) creaked.
Wanda (sighing): Come on.
```

```example
@Clown (happily) "Just you wait!" said the clown, (sadly) "I've been waiting for you".
.
Clown (happily): Just you wait!
Narrator: said the clown, (sadly)
Clown (happily): I've been waiting for you
```

Without parentheses, words after a name are story text.

```example
@Gerald yawning “I’m tired.”
.
Narrator: yawning
Gerald: I’m tired.
```

A direction ends at its matching closing parenthesis. Parentheses inside it must balance, or be written `\(` and `\)`.

```example
@Gerald (deep (very deep)) “Hello.”
.
Gerald (deep (very deep)): Hello.
```

### 6.2 A direction for whoever is speaking

`@` followed straight away by a direction, with no name, gives a direction to whoever is speaking at that point. It never changes who speaks. In narration, that is the narrator.

```example
@(warmly) Sir Percival had been training his entire life.
.
Narrator (warmly): Sir Percival had been training his entire life.
```

Inside a speech, it changes the direction from that point.

```example
@Gerald “I know. @(yawning) I’m tired.”
.
Gerald: I know.
Gerald (yawning): I’m tired.
```

When only spaces separate it from a quote, it belongs to that quote, ahead of any direction the quote would carry over. This is how a speech carried on after narration (§5.6) gets a new direction.

```example
@King “Those poor children!” cried the king. @(quieter) “Oh dear.”
.
King: Those poor children!
Narrator: cried the king.
King (quieter): Oh dear.
```

```example
@Clown (happily) "Just you wait!" said the clown, @(sadly) "I've been waiting for you".
.
Clown (happily): Just you wait!
Narrator: said the clown,
Clown (sadly): I've been waiting for you
```

If no character claims that quote, the quote is narration, and the direction is the narrator's until the line ends or a speech begins.

```example
@(quieter) “Oh dear,” he said.
.
Narrator (quieter): “Oh dear,” he said.
```

After a speech ends on a line, the narrator is speaking, so `@(…)` there directs the narration. The narrator's direction ends where the next speech begins, and the speech carried on keeps its own direction.

```example
@Clown (happily) "Just you wait!" @(frostily) said the clown, "I've been waiting for you", he smirked.
.
Clown (happily): Just you wait!
Narrator (frostily): said the clown,
Clown (happily): I've been waiting for you
Narrator: , he smirked.
```

A stray quotation mark at the end of a line opens nothing (§5.5). It stays in the narration as an ordinary character, and the next line is unaffected.

```example
@Clown (happily) "Just you wait!" @(frostily) said the clown, "I've been waiting for you", he smirked."
.
Clown (happily): Just you wait!
Narrator (frostily): said the clown,
Clown (happily): I've been waiting for you
Narrator: , he smirked."
```

```example
@Clown "Just you wait!" he smirked."
The children giggled.
.
Clown: Just you wait!
Narrator: he smirked."
Narrator: The children giggled.
```

### 6.3 Back to no direction

`@()`, an empty direction, ends the current direction early. From there, the stretch has no direction of its own.

```example
@(nervously) The big fox looked around, @() and then relaxed.
.
Narrator (nervously): The big fox looked around,
Narrator: and then relaxed.
```

```example
@Clown (happily) "Just you wait! @() I mean it."
.
Clown (happily): Just you wait!
Clown: I mean it.
```

Inside a group, the group's direction applies again (§7). To be plain inside a group, name it, for example `@(normal voice)`.

```example
::: whispering
@(nervously) The big fox looked around, @() and then relaxed.
:::
.
Narrator (nervously): The big fox looked around,
Narrator (whispering): and then relaxed.
```

### 6.4 How long a direction lasts

A direction belongs to one stretch of speech or narration, and lasts until that stretch ends:

- a quoted speech ends at its closing mark;
- narration and speech without quotes end at the end of the line, or where another speaker's speech begins.

A later `@(…)` replaces a direction and `@()` removes it. Directions are never combined.

```example
@(nervously) The big fox looked around.
He relaxed.
.
Narrator (nervously): The big fox looked around.
Narrator: He relaxed.
```

For any stretch, the direction is the first of these that exists:

1. its own direction: from the nearest `@(…)` directly before it or earlier inside it; else carried over from the speech it carries on; else from its mark;
2. the direction of the innermost group around it that applies to that character and has a direction (§7);
3. none.

## 7. Groups

A group gives a direction, a character, or both, to several lines and paragraphs at once. It opens with a line of three or more colons followed by what applies, and closes with a line of three or more colons.

```
::: whispering
…
:::
```

The opening line holds no story text, only what applies to the group:

- a character mark;
- instructions such as `{book only}` (§9.4);
- the direction: everything else on the line. Parentheses around it are optional, so `::: whispering` and `::: (whispering)` mean the same.

### 7.1 A direction for everyone

A group with a direction and no character gives that direction to everyone inside it who has no direction of their own.

```example
::: whispering
Sir Percival crept inside.

Clank.
:::

The dragon opened one eye.
.
Narrator (whispering): Sir Percival crept inside.

Narrator (whispering): Clank.

Narrator: The dragon opened one eye.
```

```example
::: (softly)
The knight stopped.

@Knight “Who goes there?”

@Percival (barely a whisper) “He’s only just got to sleep.”
:::
.
Narrator (softly): The knight stopped.

Knight (softly): Who goes there?

Percival (barely a whisper): He’s only just got to sleep.
```

Blank lines are optional here too. This is the same kind of passage, written one sentence to a line:

```example
::: whispering
Sir Percival crept inside.
Clank.
{page}
The dragon opened one eye.
:::
@Gerald (deep, polite and utterly unbothered) “Could you not?”
Sir Percival stopped.
@Gerald (yawning) “I’ve only just got to sleep,” said the dragon.
@Percival “Aren’t you going to roar?”
The dragon sighed.
.
Narrator (whispering): Sir Percival crept inside.
Narrator (whispering): Clank.
{page}
Narrator (whispering): The dragon opened one eye.

Gerald (deep, polite and utterly unbothered): Could you not?
Narrator: Sir Percival stopped.
Gerald (yawning): I’ve only just got to sleep,
Narrator: said the dragon.
Percival: Aren’t you going to roar?
Narrator: The dragon sighed.
```

### 7.2 One character for several lines

A group with a character mark gives everything unmarked inside it to that character instead of the narrator. Its direction is that character's direction; other characters who speak inside the group do not get it.

```example
::: @Wanda reading the letter
Dear Management,

Due to unacceptable working conditions, I am officially refusing to fly.
:::
.
Wanda (reading the letter): Dear Management,

Wanda (reading the letter): Due to unacceptable working conditions, I am officially refusing to fly.
```

Inside such a group, quotes in the character's own text are read as written, just as the narrator reads them outside a group.

```example
::: @Gerald
They charge into my cave shouting, ‘PREPARE TO MEET THY DOOM!’
:::
.
Gerald: They charge into my cave shouting, ‘PREPARE TO MEET THY DOOM!’
```

Another character's speech still carries on along its line (§5.6), so an interruption is best on a line of its own.

```example
::: @Gerald reading aloud
‘But you are a chicken,’ said the duke. @Wanda “Ha!” ‘I’m aware,’ said the chicken.
:::
.
Gerald (reading aloud): ‘But you are a chicken,’ said the duke.
Wanda: Ha!
Wanda: I’m aware,
Gerald (reading aloud): said the chicken.
```

```example
::: @Gerald reading aloud
‘But you are a chicken,’ said the duke.
@Wanda “Ha!”
‘I’m aware,’ said the chicken.
:::
.
Gerald (reading aloud): ‘But you are a chicken,’ said the duke.
Wanda: Ha!
Gerald (reading aloud): ‘I’m aware,’ said the chicken.
```

### 7.3 Nesting and closing

Groups can be nested. A line of colons closes the innermost open group. A group left open runs to the end of the file, and a line of colons with no group open is ignored (a tool may warn about either).

```example
::: softly, close to a whisper
At midnight, something came up the mountain.

::: @Gerald sleepy
Very heroic.
:::

And he went back to sleep.
:::
.
Narrator (softly, close to a whisper): At midnight, something came up the mountain.

Gerald (sleepy): Very heroic.

Narrator (softly, close to a whisper): And he went back to sleep.
```

An inner group that gives no direction leaves the outer one in place.

```example
::: whispering
::: @Gerald
Could you not?
:::
:::
.
Gerald (whispering): Could you not?
```

## 8. Sounds

### 8.1 Sounds

Text in square brackets is a sound the listener hears at that point. It is not read aloud or printed. The description is free text. By convention, a short name comes first and details follow a semicolon.

```example
The broom fell over. [wooden clatter; one broom handle dropping flat onto flagstones]
.
Narrator: The broom fell over.
[wooden clatter; one broom handle dropping flat onto flagstones]
```

```example
The broom shot sideways into a hedge. [crash through leaves] Only its bristles stuck out.
.
Narrator: The broom shot sideways into a hedge.
[crash through leaves]
Narrator: Only its bristles stuck out.
.
The broom shot sideways into a hedge. Only its bristles stuck out.
```

```example
On Tuesday morning, the king summoned him.

[royal trumpet fanfare]

@King “Sir Percival!”
.
Narrator: On Tuesday morning, the king summoned him.

[royal trumpet fanfare]

King: Sir Percival!
```

A sound mark records where a sound starts. How long it lasts, how loud it is, and whether it overlaps the words are decisions for production.

A sound inside a character's speech is still a sound in the world, not the character's.

```example
@Wanda “Come in— [door slams] oh.”
.
Wanda: Come in—
[door slams]
Wanda: oh.
```

### 8.2 Sounds a character makes

A character mark followed by a sound, directly or after its direction, gives that one sound to the character: a snore, a gasp, a sigh. A second sound straight after it is a sound in the world; mark the character again for another of theirs. If the line has a quote after the sound, that quote is the character's, as in §5.4. Text that isn't in quotes stays with the narrator; after its own sound, a mark never makes the character say unquoted text. A sound further along, after some narration, is a sound in the world.

```example
The dragon was snoring. @Gerald [snores]
.
Narrator: The dragon was snoring.
Gerald [snores]
```

```example
@Wanda [gasp] “My broom is on strike!”
.
Wanda [gasp]
Wanda: My broom is on strike!
```

```example
@Wanda [gasp] She stared at the broom.
.
Wanda [gasp]
Narrator: She stared at the broom.
```

```example
@Wanda [gasp] She stared at the broom. “On strike?”
.
Wanda [gasp]
Narrator: She stared at the broom.
Wanda: On strike?
```

```example
@Pickle [tiny peep] [a brief tumble] @Pickle [yawn]
.
Pickle [tiny peep]
[a brief tumble]
Pickle [yawn]
```

```example
@Wanda She stared at the broom. [gasp] “On strike?”
.
Narrator: She stared at the broom.
[gasp]
Wanda: On strike?
```

```example
@Gerald (softly) [snores]
.
Gerald (softly) [snores]
```

`@` followed straight away by a sound gives the sound to whoever is speaking: inside a speech, the character; in narration, the narrator.

```example
@Gerald “Oh no. I’m going to— @[sneezes]”
.
Gerald: Oh no. I’m going to—
Gerald [sneezes]
```

```example
The fox froze. @[gasps]
.
Narrator: The fox froze.
Narrator [gasps]
```

### 8.3 Square brackets that are not sounds

A Markdown link, `[text](address)`, stays a link: its text is read aloud and printed. So a sound followed directly by a parenthesis would become a link. Leave a space between them.

```example
Read more at [our website](https://example.com).
.
Narrator: Read more at our website.
```

The same holds straight after an `@`: `@[text](address)` is an `@` and a link, not a sound the speaker makes.

```example
@Gerald “Read [this](https://example.com) @[now](https://example.com).”
.
Gerald: Read this @now.
```

An image, `![description](file)`, is shown in the book and not heard.

```example
![Peter squeezing under the gate](peter-gate.png)
.
![Peter squeezing under the gate](peter-gate.png)
```

Write `\[` for a literal square bracket.

## 9. Pages, pauses and what is printed

Instructions in curly braces shape the book and the timing. Each is a name, optionally followed by a value.

### 9.1 Page turns

`{page}` marks a page turn. It can stand on a line of its own or sit inside a line, where a page ends mid-sentence. An optional value labels the page that begins, such as `{page 12}` or `{page 8–9}` for a spread.

```example
He slipped underneath the gate.

{page}

Mr. McGregor hung up the little jacket.
.
Narrator: He slipped underneath the gate.

{page}

Narrator: Mr. McGregor hung up the little jacket.
```

```example
He went back to his work. {page} Peter sat down to rest.
.
Narrator: He went back to his work.
{page}
Narrator: Peter sat down to rest.
.
He went back to his work. Peter sat down to rest.
```

```example
{page 8–9}
.
{page 8–9}
```

How a page turn sounds (a chime, a rest, or nothing) is up to the player.

### 9.2 Pauses

`{pause}` is a pause. A beat's length is up to the performer. A value sets the length in seconds or milliseconds: `{pause 2s}`, `{pause 500ms}`.

```example
@Wanda “Could you perhaps be in love somewhat more urgently?”

{pause 2s}

He went on being in love at exactly the same speed.
.
Wanda: Could you perhaps be in love somewhat more urgently?

{pause 2s}

Narrator: He went on being in love at exactly the same speed.
```

### 9.3 Printed or read aloud

`{book only}` in a paragraph or heading means it is printed and not read aloud. `{audio only}` means it is read aloud and not printed. `{hidden}` means neither: a label for tools, such as the name of a scene. Each applies to its whole paragraph or heading wherever it sits. By convention it goes at the start of a paragraph and at the end of a heading.

```example
{book only} First published 1902.

Once upon a time…
.
{book only} First published 1902.

Narrator: Once upon a time…
.
First published 1902.

Once upon a time…
```

```example
{book only} First published 1902.
Frederick Warne & Co.
.
{book only} First published 1902.
{book only} Frederick Warne & Co.
```

```example
{audio only} Turn the page when you hear the bell.

Once upon a time…
.
Narrator: Turn the page when you hear the bell.

Narrator: Once upon a time…
.
Once upon a time…
```

```example
## The cave {hidden}

Mount Mumble was very tall.
.
## The cave {hidden}

Narrator: Mount Mumble was very tall.
.
Mount Mumble was very tall.
```

### 9.4 On a group

Visibility instructions on a group's opening line apply to every paragraph inside it.

```example
::: {book only}
First published 1902.

Printed in Great Britain.
:::
.
{book only} First published 1902.

{book only} Printed in Great Britain.
```

### 9.5 Other instructions

An instruction with any other name is kept in place, never read or printed, and ignored by tools that don't know it. This is how tools add their own marks. A tool's instructions should start with its name and a colon, such as `{recorder:take 3}`.

```example
The broom fell over. {recorder:take 3}
.
Narrator: The broom fell over.
{recorder:take 3}
```

Write `\{` for a literal curly brace.

## 10. Notes

Text between `%%` and `%%` is a note for whoever performs or produces the story. It is kept in place and never read aloud or printed. A note can sit inside a line, on its own line, or run over several lines and paragraphs. A note on its own line is usually about what follows.

```example
%% Leave a clear pause after this line. %%

He went on being in love at exactly the same speed.
.
%% Leave a clear pause after this line. %%

Narrator: He went on being in love at exactly the same speed.
.
He went on being in love at exactly the same speed.
```

```example
@Marmalade “Clause five.” %% Clause and claws sound the same. %%
.
Marmalade: Clause five.
%% Clause and claws sound the same. %%
```

```example
%%
Hushed from here to the end, because Gerald is asleep.

The knight’s cry is the only loud line.
%%
.
%% Hushed from here to the end, because Gerald is asleep. The knight’s cry is the only loud line. %%
```

Write `\%` for a literal percent sign where it would otherwise start a note.

## 11. Markdown inside the story

Emphasis works as in Markdown. `*a word*` or `_a word_` is printed in italics and stressed when read; `**words**` or `__words__` is printed in bold. The spoken script keeps emphasis as written, so a speech engine can use it.

```example
@Gerald “I don’t *even* like treasure.”
.
Gerald: I don’t *even* like treasure.
```

```example
The page said: **JOBS AVAILABLE**
.
Narrator: The page said: **JOBS AVAILABLE**
```

A backslash before any ASCII punctuation character, or before a quotation mark, makes it literal. The backslash itself is neither printed nor read.

```example
She wrote \[sic\] and \{page\} on the board.
.
Narrator: She wrote [sic] and {page} on the board.
```

Links and images work as in Markdown (§8.3). Other Markdown blocks (lists, block quotes, tables, code, HTML) are not part of version 1.0. Their lines are treated as ordinary paragraph text.

## 12. The two readings

A file has two readings. Tools derive both from the same text, so they cannot drift apart.

### 12.1 The spoken script

The spoken script is everything heard, in order, each with its voice: speech and narration, sounds characters make, sounds, page turns and pauses. It also keeps notes and unknown instructions in place, and marks headings, scene breaks and paragraphs. Paragraphs marked `{book only}` or `{hidden}` are listed but not heard.

The examples write it like this:

| Line | Meaning |
| --- | --- |
| `Character: text` | Speech or narration. |
| `Character (direction): text` | The same, with a direction. |
| `Character [description]`, `Character (direction) [description]` | A sound made by a character. |
| `[description]` | A sound. |
| `{page}`, `{page 12}`, `{pause}`, `{pause 2s}`, `{name value}` | An instruction. |
| `%% text %%` | A note. |
| `![description](file)` | An image. |
| `# Character: text` | A heading read aloud, with as many `#` as its level. |
| `## text {hidden}`, `## text {book only}` | A heading that is not read aloud. |
| `{book only} text`, `{hidden} text` | A paragraph that is not read aloud. |
| `---` | A scene break. |
| A blank line | Between paragraphs, and around headings and breaks. |

How lines are formed:

- A stretch of speech or narration is one line. A line break in the file starts a new line in the script, even when the voice stays the same; it is still heard as a space.
- A change of direction, and a sound, instruction, note or image inside a stretch, also start a new line.
- Marks, directions and escapes are removed from the text, and a link is replaced by its text.
- Runs of spaces become one space, and each line is trimmed.
- A quoted speech loses its own opening and closing quotation marks.
- Emphasis stays as written.
- Speech or narration with no letters or digits left, such as a full stop after a closing quote, is not spoken. It is still printed.
- Characters are written with the cast's spelling, or else the spelling the file uses first. The narrator is written as the cast or the `narrator:` key spells it, or else `Narrator`.
- A note is one line, with its spaces and line breaks run together.

Group boundaries are not shown; their effect is visible in each line's character and direction.

### 12.2 The book text

The book text is the printed story as plain Markdown. It is the file with these removed:

- front matter;
- character marks, directions and sounds;
- notes, page turns, pauses and other instructions;
- group lines;
- paragraphs and headings marked `{audio only}` or `{hidden}`.

What remains keeps its line breaks, quotation marks, emphasis, links and images, and `{book only}` text without its instruction. Where a removed mark leaves two spaces, one remains. Spaces left at the start or end of a line are removed, and paragraphs left empty are dropped.

```example
@Percival (muffled, echoing) “I meant to do that,” said Sir Percival, from inside the vase. [armor wobbles]
.
Percival (muffled, echoing): I meant to do that,
Narrator: said Sir Percival, from inside the vase.
[armor wobbles]
.
“I meant to do that,” said Sir Percival, from inside the vase.
```

```example
@Wanda (strained and extremely polite) “Could we perhaps travel somewhat more urgently?”

%% The broom considers this. %%

{pause}

The broom considered this.
.
Wanda (strained and extremely polite): Could we perhaps travel somewhat more urgently?

%% The broom considers this. %%

{pause}

Narrator: The broom considered this.
.
“Could we perhaps travel somewhat more urgently?”

The broom considered this.
```

### 12.3 Warnings

A parser never rejects a file. It should report these warnings, each with its line and column. The codes are stable: tools may match on them, and a later version adds codes but never changes what one means.

| Code | When | Level |
| --- | --- | --- |
| `unclosed-quote` | A quote is never closed. | warning |
| `quote-over-line-break` | A quote runs over a line break (fine for verse, but often a missing closing mark). | warning |
| `unclosed-group` | A group is never closed. | warning |
| `stray-group-close` | A line of colons closes no group. | warning |
| `idle-mark` | A character mark gives its character nothing to say or do. | warning |
| `stray-quote` | A quotation mark has nothing after it on its line. | warning |
| `unknown-character` | A name is not in the cast, when the file has a cast. | warning |
| `name-case` | A name is written with different capitals in different places. | warning |
| `silent-cast-member` | A cast member never speaks. | info |
| `unknown-instruction` | An instruction this spec does not know has no tool prefix. | warning |
| `pause-value` | `{pause}` has a value that is not a length. | warning |
| `sound-looks-like-link` | A sound is followed directly by `(`, which Markdown reads as a link. | warning |
| `unclosed-note` | A `%%` is never closed, so it is read as text. | warning |
| `front-matter` | The front matter uses YAML outside the part a reader must understand (§4.2), or its cast is not a map. | warning |

## 13. Tools that edit files

The format is meant to be edited both by hand and through a visual editor. A visual editor works on the rendered story and writes the change back into the text. The rules below keep the text the author's own.

1. **Round trip.** Reading a file and writing it back without changes produces identical bytes.
2. **Small edits.** An edit changes only the characters it must. Tools never reflow text, change quotation styles, normalize spacing or reorder front matter, unless the author asks them to (rule 8).
3. **New marks are written in one way:**
   - a character mark and direction go directly before the speech's opening quote, with the cast's spelling: `@Gerald (yawning) “…`;
   - a direction for narration goes before its first word: `@(warmly) Once…`;
   - a sound follows the word it belongs to, after one space: `fell over. [clatter]`;
   - a page turn, pause or note between lines goes on a line of its own.
4. **Changing who says a line.** Replace the name in its mark. If the speech had no mark because it carried on an earlier one (§5.6), add a mark to it. If a later quote on the same line carried this one on, add a mark to that quote too, so its speaker stays the same.
5. **Removing a direction.** Delete the parentheses, their content and one space. If the remaining character mark is not needed, remove it too.
6. **Renaming a character.** Changing a full name touches only the front matter. Changing a short name replaces it in the cast and in every mark.
7. **A tool's own divisions are never line breaks or words.** How a tool cuts the spoken script into pieces of its own, such as one audio recording per sentence, is the tool's business. A tool that keeps such a division in the file writes its own instruction (§9.5), such as a recording tool's `{recorder:join}` between two sentences it records as one; it never adds a line break or changes the words to make one.
8. **Formatting is asked for.** A formatter tidies a file only when its author runs it, and never changes who says what, how, or in what order: words change only in their spaces and, when asked, their quotation marks. It may remove spaces at the start and end of lines, make runs of spaces and of blank lines one, put one blank line after the front matter and around headings and scene breaks, end the file with one line break, and write each name as the cast spells it. It keeps the front matter, line endings and group lines as they are. Changing straight quotation marks to curly ones is a separate choice, made for the story's language; an apostrophe becomes `’`, and a mark after a digit, such as `6"`, stays as it is.

## 14. Rendering

*This section is advice, not a rule.*

A renderer can show the file in two ways. The **book view** is the book text, typeset. The **script view** is a script for reading aloud, in which:

- each character has a color, assigned in cast order;
- a character's full name appears where the speaker changes, and their words carry a light tint or underline in their color;
- a direction appears as a small italic marking above its first word, with a bar beside the lines a group covers;
- sounds appear as small chips in the text, and a character's sounds in the character's color;
- a page turn between lines is a rule across the page, and one inside a line is a small marker;
- pauses are small gaps labeled with their length;
- notes sit in the margin beside the text they are about;
- `{book only}` text is dimmed and labeled, and `{hidden}` headings appear only as labels.

The quotation marks stay visible in both views. They are part of the story.

## 15. Conformance

A tool can follow this spec at two levels.

**A reader** reads VoxDown files: a player, a speech pipeline, a converter, a viewer. A reader

1. accepts every file, never refusing one (§1);
2. produces the spoken script of every example in this spec, line for line (§12.1): who says each stretch, with which direction, and every sound, instruction, note and image in its place;
3. produces the book text of every example that gives one (§12.2);
4. ignores, without failing, instructions and front matter keys it does not know (§4.2, §9.5).

A reader should also report the warnings in §12.3, with their codes. A viewer that only shows the printed story may stop at the book text and say so.

**A writer** changes VoxDown files: an editor, a formatter, a tool that adds its own marks. A writer is a reader that also

1. writes an unchanged file back byte for byte (§13, rule 1), keeping its line endings and any byte order mark;
2. keeps every front matter key, instruction, note and escape it does not change, where it was written;
3. writes new marks in the one way §13 rule 3 gives, and edits as rules 4 to 7 say;
4. changes spacing or quotation marks only when its author asks (§13, rule 8).

**The conformance file.** Every example in this spec is also in [conformance.json](conformance.json), so an implementation can test itself without reading this document. It is a list with one entry per example:

| Field | Meaning |
| --- | --- |
| `example` | The example's number, from 1, in the order this spec gives them. |
| `section` | The section it is in, such as `5.6`. |
| `line` | The line of this file its fence opens on. |
| `input` | The file. |
| `script` | The spoken script, as written in the examples (§3). Required of every reader. |
| `book` | The book text, when the example gives one. Required of every reader. |
| `lines` | The spoken script as data: one object per line heard, as the reference parser exports them. |
| `warnings` | The warnings the reference parser reports: `code`, `line` and `column`. Recommended, not required. |

The examples are the tests, and the spec is the authority: if the file and this document ever disagree, this document is right and the file has a bug.

## 16. Versions

This spec has a version, `major.minor`, separate from the version of any tool. A file says which it follows with the `voxdown` front matter key (§4.2).

- A **minor** version (1.1, 1.2) only adds: new instructions, new front matter keys, new warnings, or meaning for something that used to be plain text and that a 1.0 file would rarely contain. A 1.0 file means the same under every 1.x. A 1.x reader reads any 1.y file, ignoring what it doesn't know as §9.5 says.
- A **major** version (2.0) may change what existing files mean. A reader that meets a file of a later major version should still read it, and may warn.
- Corrections that change no example's output (wording, clearer explanations, new examples of existing rules) don't change the version.

A file without a `voxdown` key is read by the latest version the reader knows.

## 17. Beyond 1.0

Questions for later versions. None of them changes a 1.0 file.

- **Dialogue with dashes.** Spanish, French and other languages often mark speech with dashes instead of quotes. A rule for where a dash speech ends.
- **Speaking together.** A chorus line said by two characters at once: perhaps `@Wanda @Marmalade “Fine.”`.
- **Pronunciation.** A front matter list of how to say names and invented words.
- **Language changes.** A way to mark a phrase in another language.
- **Sound timing.** Lengths, overlaps and background sounds that run under the words, if they belong in the story file at all.
- **Verse and letters.** Whether block quotes should carry meaning for letters, signs and poems.
- **Headings.** Whether a file should be able to set all headings of one level to `{hidden}` at once.
- **Sounds before unquoted speech.** Whether `@Gerald [yawns] Could you not?` should keep Gerald speaking after the sound, as a script writer would expect, rather than return to the narrator.
