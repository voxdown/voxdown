# Audiobook Markup

**Draft 0.1, 7 November 2026.** "Audiobook Markup" is a working name. The final name, file extension, licence and home are still to be chosen.

Audiobook Markup is a plain-text format for stories that are read aloud. It records:

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

::: (whispering)
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
15. [Open questions](#15-open-questions)

## 1. Goals

- **The raw text reads like the book.** Someone who has never seen the format can read a file and follow the story. The marks look like pencil notes in a manuscript.
- **One sign for each kind of mark.** `@` means a voice, `( )` means how something is said, `[ ]` is a sound, `{ }` is a page or a timing instruction, and `%% %%` is a note.
- **Every Markdown story is already valid.** A story with no marks is read by one narrator from start to finish. Marks are added one at a time, wherever they help.
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
| A direction for the narrator | `@Narrator (warmly) Once upon a time…` or `@(warmly) Once upon a time…` |
| A change of direction mid-line | `@Gerald “I know. @(yawning) I’m tired.”` |
| A direction over several paragraphs | `::: (whispering)` … `:::` |
| Several paragraphs by one character | `::: @Wanda (reading the letter)` … `:::` |
| A sound | `The broom fell over. [wooden clatter]` |
| A sound a character makes | `@Gerald [snores]`, or `@[sneezes]` inside his line |
| A page turn | `{page}` on its own line, or inside a paragraph |
| A pause | `{pause}` or `{pause 2s}` |
| Printed, not read aloud | `{book only} First published 1902.` |
| Read aloud, not printed | `{audio only} Turn the page when you hear the bell.` |
| A note for the performer | `%% Leave a clear pause after this line. %%` |
| Title, chapter, scene | `# Title`, `## Scene` |
| A scene break | `---` |
| The cast | Front matter: `cast:` (§4.2) |

## 3. How to read this spec

Each rule comes with examples. An example shows the input, then a line with a single dot, and then **the spoken script**: what a listener hears, in order (§12.1). Some examples add a second dot and **the book text**: what a reader sees in print (§12.2).

The spoken script has one line per thing heard. A line is either:

- `Character: text` for something said, or `Character (direction): text` when it has a direction;
- `[description]` for a sound;
- `Character [description]` for a sound made by a character;
- `{page}`, `{pause}` or another instruction;
- `%% text %%` for a note.

A blank line separates paragraphs. Headings start with `#` and scene breaks are `---`. §12.1 gives the details.

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

Files use the `.md` extension so that every Markdown tool opens them. (A dedicated double extension is an open question, §15.)

### 4.2 Front matter

Front matter is YAML between two `---` lines at the very top of the file. It is metadata: none of it is read aloud.

```yaml
---
audiobook-markup: 0.1
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
| `audiobook-markup` | The version of this spec the file follows. Recommended. |
| `title`, `subtitle`, `author` | The book's details. |
| `language` | The story's main language, as a [BCP 47](https://www.rfc-editor.org/info/bcp47) tag such as `en-GB` or `de`. |
| `narrator` | Which cast member reads everything not marked otherwise. Defaults to `Narrator` (§5.1). |
| `cast` | The characters, in the order a tool should list them (§4.3). |

Any other key is allowed and must be kept by tools that rewrite the file. A tool's own data should sit under one key named after the tool, for example `kinu:`.

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

`cast` maps each character's **handle**, the short name written after `@`, to one of:

- nothing, when the handle is the character's name: `Gerald:`;
- their full name: `Percival: Sir Percival`;
- a map with `name` (full name, defaults to the handle), `about` (who they are and how they sound, in plain words) and any other keys.

A character does not need to be in the cast to speak. An undeclared handle names a character whose full name is the handle (and a tool may warn about it). The cast exists for full names, descriptions, ordering, and characters who never speak but still matter, such as a silent broom.

```example
---
cast:
  Percival: Sir Percival
---
@Percival “Behold!”
.
Percival: Behold!
```

```example
@Shepherd “Just count the sheep,” said the shepherd.
.
Shepherd: Just count the sheep,
Narrator: said the shepherd.
```

### 4.4 The story

After the front matter comes the story, in blocks separated by blank lines:

- **paragraphs**;
- **headings**: `#` to `######` followed by a space;
- **scene breaks**: a line of three or more `-`, `*` or `_`, with blank lines around it;
- **groups**: `:::` … `:::` (§7);
- **notes**: `%%` … `%%` (§10).

Inside a paragraph, a line break is kept: a reader sees it in the book text, and it is heard as an ordinary space. This differs from Markdown, which joins lines. Picture books, verse, letters and signs all depend on their line breaks, and story writers rarely wrap lines by hand.

```example
And their names were—
Flopsy,
Mopsy,
Cotton-tail,
and Peter.
.
Narrator: And their names were— Flopsy, Mopsy, Cotton-tail, and Peter.
.
And their names were—
Flopsy,
Mopsy,
Cotton-tail,
and Peter.
```

Spaces at the start of a line are ignored.

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

### 5.2 Character marks

`@` followed by a handle marks where a character starts to speak. A handle starts with a letter and continues with letters, digits, `-` and `_`, and apostrophes between two letters, as in `@O’Brien`. Any script's letters count, so `@Zoë` and `@花子` are both handles. Handles are case-sensitive.

`@` is only a mark when it is not preceded by a letter or digit, and when it is followed by a handle, `(` or `[`. So email addresses and a lone `@` are just text. Write `\@` for a literal `@` anywhere.

```example
Write to tom@example.com, or meet me @ noon.
.
Narrator: Write to tom@example.com, or meet me @ noon.
```

```example
\@Gerald is my username.
.
Narrator: @Gerald is my username.
```

### 5.3 Quoted speech

When a character mark is followed by an opening quotation mark, the character says everything up to the matching closing mark. After it, the narrator takes over again. Optional parts may come between the mark and the quote: a direction (§6) and sounds the character makes (§8.2).

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

```example
Gerald put on his spectacles. @Gerald “I thought perhaps librarian.”
.
Narrator: Gerald put on his spectacles.
Gerald: I thought perhaps librarian.
```

Several characters can speak in one paragraph, each with their own mark.

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

### 5.4 Quotation marks

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

An opening mark preceded by a letter or digit is an apostrophe, not a quote. A closing `’` or `'` followed by a letter or digit is also an apostrophe, so `don’t` never ends a speech.

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

### 5.5 A speech interrupted by narration

Within a paragraph, an unmarked quote that comes after a quoted speech continues that speech, as if the narration had only interrupted it. It keeps the same character and direction. This is how books write a line broken by "said the baker".

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

A continued quote follows the most recent speech in the paragraph.

```example
@Wanda “Fine,” she said. @Marmalade “Good,” said the cat. “Very good.”
.
Wanda: Fine,
Narrator: she said.
Marmalade: Good,
Narrator: said the cat.
Marmalade: Very good.
```

Continuation never crosses into the next paragraph, because a new paragraph usually means a new speaker.

```example
@Wanda “Fine.”

“Fine,” said someone else.
.
Wanda: Fine.

Narrator: “Fine,” said someone else.
```

To keep a quote in narration as narration, put a backslash before its opening mark.

```example
@Wanda “Fine,” she said, in her \‘polite’ voice.
.
Wanda: Fine,
Narrator: she said, in her ‘polite’ voice.
```

### 5.6 A speech over several paragraphs

When a quoted speech reaches the end of its paragraph without a closing mark, the speech ends there. If the next paragraph begins with the same opening mark, that paragraph continues the speech, with the same character and direction. This is the book convention for one character speaking over several paragraphs.

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

### 5.7 Speech without quotes

When a character mark is followed by anything other than a quote, a direction or a sound, the character says the rest of the paragraph, up to the next character mark. This suits scripts written without quotation marks.

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

`@Narrator` is a character mark like any other. It is mostly useful for giving the narrator a direction (§6).

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

Parentheses anywhere else are part of the story.

```example
Her broom (which was old) creaked. @Wanda (sighing) “Come on.”
.
Narrator: Her broom (which was old) creaked.
Wanda (sighing): Come on.
```

A direction ends at its matching closing parenthesis. Parentheses inside it must balance, or be written `\(` and `\)`.

```example
@Gerald (deep (very deep)) “Hello.”
.
Gerald (deep (very deep)): Hello.
```

### 6.2 A direction for whoever is speaking

`@` followed straight away by a direction, with no handle, gives a direction to whoever is speaking at that point. At the start of narration, that is the narrator.

```example
@(warmly) Sir Percival had been training his entire life.
.
Narrator (warmly): Sir Percival had been training his entire life.
```

Inside a speech, it changes the direction from that point to the end of the speech.

```example
@Gerald “I know. @(yawning) I’m tired.”
.
Gerald: I know.
Gerald (yawning): I’m tired.
```

Just before a quote that continues an interrupted speech (§5.5), it gives that continued speech a new direction.

```example
@King “Those poor children!” cried the king. @(quieter) “Oh dear.”
.
King: Those poor children!
Narrator: cried the king.
King (quieter): Oh dear.
```

### 6.3 Which direction applies

A direction lasts until its speech ends. For any stretch of speech or narration, the direction is the first of these that exists:

1. its own direction: from its mark, from an `@( )` inside it, or carried over from the speech it continues;
2. the direction of the innermost group around it that applies to that character (§7);
3. none.

A direction replaces any direction from a group; the two are not combined.

## 7. Groups

A group gives a direction, a character, or both, to several paragraphs at once. It opens with a line of three or more colons followed by what applies, and closes with a line of three or more colons.

```
::: (whispering)
…
:::
```

The opening line can hold a character mark, a direction, and visibility instructions (§9.3), in any order.

### 7.1 A direction for everyone

A group with a direction and no character gives that direction to everyone inside it who has no direction of their own.

```example
::: (whispering)
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

### 7.2 One character for several paragraphs

A group with a character mark gives everything unmarked inside it to that character instead of the narrator. Its direction is that character's direction; other characters who speak inside the group do not get it.

```example
::: @Wanda (reading the letter)
Dear Management,

Due to unacceptable working conditions, I am officially refusing to fly.
:::
.
Wanda (reading the letter): Dear Management,

Wanda (reading the letter): Due to unacceptable working conditions, I am officially refusing to fly.
```

Inside such a group, quotes in the character's own text are read as written, just as the narrator reads them outside.

```example
::: @Gerald (reading aloud)
‘But you are a chicken,’ said the duke.

@Wanda “Ha!” ‘I’m aware,’ said the chicken.
:::
.
Gerald (reading aloud): ‘But you are a chicken,’ said the duke.

Wanda: Ha!
Wanda: I’m aware,
Gerald (reading aloud): said the chicken.
```

The second paragraph shows the limit of §5.5. Gerald's quote after Wanda's line continues *her* speech, because she spoke last. To give it back to Gerald, write `@Gerald ‘I’m aware,’` or `\‘I’m aware,’`.

### 7.3 Nesting and closing

Groups can be nested. A line of colons closes the innermost open group. A group left open runs to the end of the file (and a tool may warn about it). Blank lines around the colon lines are optional.

```example
::: (softly, close to a whisper)
At midnight, something came up the mountain.

::: @Gerald (sleepy)
Very heroic.
:::

And he went back to sleep.
:::
.
Narrator (softly, close to a whisper): At midnight, something came up the mountain.

Gerald (sleepy): Very heroic.

Narrator (softly, close to a whisper): And he went back to sleep.
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

A character mark followed by a sound gives the sound to that character: a snore, a gasp, a sigh. A quote may follow it. Anything else after the sound goes back to the narrator.

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
@Gerald (softly) [snores]
.
Gerald (softly) [snores]
```

Inside a speech, `@` followed straight away by a sound gives the sound to whoever is speaking.

```example
@Gerald “Oh no. I’m going to— @[sneezes]”
.
Gerald: Oh no. I’m going to—
Gerald [sneezes]
```

### 8.3 Square brackets that are not sounds

A Markdown link, `[text](address)`, stays a link: its text is read aloud and printed. So a sound followed directly by a parenthesis would become a link. Leave a space between them.

```example
Read more at [our website](https://example.com).
.
Narrator: Read more at our website.
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

`{page}` marks a page turn. It can stand between paragraphs or sit inside one, where a page ends mid-paragraph. An optional value labels the page that begins, such as `{page 12}` or `{page 8–9}` for a spread.

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

An instruction with any other name is kept in place, never read or printed, and ignored by tools that don't know it. This is how tools add their own marks. A tool's instructions should start with its name and a colon, such as `{kinu:take 3}`.

```example
The broom fell over. {kinu:take 3}
.
Narrator: The broom fell over.
{kinu:take 3}
```

Write `\{` for a literal curly brace.

## 10. Notes

Text between `%%` and `%%` is a note for whoever performs or produces the story. It is kept in place and never read aloud or printed. A note can sit inside a paragraph, on its own line, or run over several lines and paragraphs. A note on its own line is usually about what follows.

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

Links and images work as in Markdown (§8.3). Other Markdown blocks (lists, block quotes, tables, code, HTML) are not part of draft 0.1. Their lines are treated as ordinary paragraph text.

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

The text of each line is normalised:

- Marks, directions and escapes are removed.
- Runs of spaces and line breaks become one space, and each line is trimmed.
- A quoted speech loses its own opening and closing quotation marks.
- Emphasis stays as written.
- Lines left with no text are dropped.

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

A parser never rejects a file. It should report these warnings, each with the line and column:

- a quote or group that is never closed;
- a handle that is not in the cast, when the file has a cast;
- a cast member who never speaks (informational);
- an unknown instruction without a tool prefix;
- `{pause}` with a value that is not a length;
- a sound followed directly by `(`, which Markdown reads as a link.

## 13. Tools that edit files

The format is meant to be edited both by hand and through a visual editor. A visual editor works on the rendered story and writes the change back into the text. The rules below keep the text the author's own.

1. **Round trip.** Reading a file and writing it back without changes produces identical bytes.
2. **Small edits.** An edit changes only the characters it must. Tools never reflow text, change quotation styles, normalise spacing or reorder front matter.
3. **New marks are written in one way:**
   - a character mark and direction go directly before the speech's opening quote: `@Gerald (yawning) “…`;
   - a sound follows the word it belongs to, after one space: `fell over. [clatter]`;
   - a page turn, pause or note between paragraphs goes on its own line, with blank lines around it.
4. **Changing who says a line.** Replace the handle in its mark. If the speech had no mark because it continued an earlier one (§5.5), add a mark to it. If a later quote in the same paragraph continued this one, add a mark to that quote too, so its speaker stays the same.
5. **Removing a direction.** Delete the parentheses, their content and one space. If the remaining character mark is not needed, remove it too.
6. **Renaming a character.** Changing a full name touches only the front matter. Changing a handle replaces it in the cast and in every mark.

## 14. Rendering

*This section is advice, not a rule.*

A renderer can show the file in two ways. The **book view** is the book text, typeset. The **performance view** is a script for reading aloud, in which:

- each character has a colour, assigned in cast order;
- a character's name appears where the speaker changes, and their words carry a light tint or underline in their colour;
- a direction appears as a small italic marking above its first word, with a bar beside the paragraphs a group covers;
- sounds appear as small chips in the text, and a character's sounds in the character's colour;
- a page turn between paragraphs is a rule across the page, and one inside a paragraph is a small marker;
- pauses are small gaps labelled with their length;
- notes sit in the margin beside the text they are about;
- `{book only}` text is dimmed and labelled, and `{hidden}` headings appear only as labels.

The quotation marks stay visible in both views. They are part of the story.

## 15. Open questions

- **Name.** The final name, file extension (plain `.md` or a double extension) and front matter key.
- **Dialogue with dashes.** Spanish, French and other languages often mark speech with dashes instead of quotes. A rule for where a dash speech ends.
- **Speaking together.** A chorus line said by two characters at once: perhaps `@Wanda @Marmalade “Fine.”`.
- **Pronunciation.** A front matter list of how to say names and invented words.
- **Language changes.** A way to mark a phrase in another language.
- **Sound timing.** Lengths, overlaps and background sounds that run under the words, if they belong in the story file at all.
- **Verse and letters.** Whether block quotes should carry meaning for letters, signs and poems.
- **Headings.** Whether a file should be able to set all headings of one level to `{hidden}` at once.
- **Sounds before narration.** Whether `@Gerald [yawns] Could you not?` should keep Gerald speaking after the sound, as a script writer would expect, rather than return to the narrator.
- **Front matter.** Whether to limit front matter to a small, simple part of YAML.
