<img src="assets/icon.svg" width="64" height="64" alt="">

# VoxDown

**Markdown for stories read aloud.**

VoxDown is a plain-text format for stories that are performed: by a narrator, a cast, or a speech engine. A file is a Markdown story with light marks in it: who says each line, how they say it, the sounds a listener hears, where the pages turn, and notes for the performer. Take the marks out and you have the printed book. Leave them in and you have the script.

```
## The cave {hidden}

Then he heard a deep rumble. [deep rumbling, from inside a cave]

The dragon was snoring. @Gerald [snores]

@Gerald (deep, polite and utterly unbothered) “Could you not?”

@Gerald “I’ve only just got to sleep,” said the dragon. {page}
```

The one rule to remember: **on each line, the quotes after a name belong to it, and everything else belongs to the narrator.**

- **Try it** in the [playground](https://voxdown.github.io/): write on the left, see the script, the book and the lines on the right.
- **Hear it**: [two stories read aloud](https://voxdown.github.io/voxdown/listen.html), every character in their own voice and every line as its marks direct.
- **Learn it** from the [cheat sheet](spec/CHEATSHEET.md), every mark on one page.
- **Read the spec**: [SPEC.md](spec/SPEC.md), version 1.0, with a worked example for every rule.

## In 30 seconds

```sh
npm install voxdown
```

```js
import { bookText, lines, linesToCsv, parse, spokenScript } from "voxdown";

const story = parse("@Gerald (yawning) “I’ve only just got to sleep,” said the dragon. [snores]");

spokenScript(story);
// Gerald (yawning): I’ve only just got to sleep,
// Narrator: said the dragon.
// [snores]

bookText(story);
// “I’ve only just got to sleep,” said the dragon.

linesToCsv(lines(story));
// kind,speaker,direction,text,scene,page
// speech,Gerald,yawning,"I’ve only just got to sleep,",1,1
// speech,Narrator,,said the dragon.,1,1
// sound,,,snores,1,1
```

Or from the command line, without installing anything:

```sh
npx @voxdown/cli check story.vxd                  # warnings, with line and column
npx @voxdown/cli export story.vxd --format csv    # one row per line heard
npx @voxdown/cli render story.vxd -o story.html   # a script to print or share
```

## What is here

| | What it is |
| --- | --- |
| [`spec/`](spec/) | The format: [SPEC.md](spec/SPEC.md), the [cheat sheet](spec/CHEATSHEET.md), and [conformance.json](spec/conformance.json), every example as data for other implementations. |
| [`voxdown`](packages/core/) | The parser, the two readings, a lossless writer and the edits a tool makes, a formatter, exports and a Fountain import. No dependencies; browsers and Node. |
| [`@voxdown/render`](packages/render/) | HTML for a book view and a script view, with a stylesheet driven by CSS variables. No framework. |
| [`@voxdown/editor`](packages/editor/) | An editor that draws marks as chips, for CodeMirror 6, and the same as a `<voxdown-editor>` web component. |
| [`@voxdown/cli`](packages/cli/) | The `vxd` command: `check`, `fmt`, `render`, `export`, `text`, `import`. |
| [`packages/vscode`](packages/vscode/) | VS Code support: highlighting, snippets, warnings, a preview and the cheat sheet. |
| [`site/`](site/) | The playground. |
| [`examples/`](examples/) | Stories to learn from and test with: public domain, or new and free to copy. |

## The marks

| You want | You write |
| --- | --- |
| A character’s line | `@Gerald “Could you not?”` |
| How it is said | `@Gerald (yawning) “I’m tired.”` |
| A direction for the narrator | `@(warmly) Once upon a time…` |
| A direction over several lines | `::: whispering` … `:::` |
| A sound | `The broom fell over. [wooden clatter]` |
| A sound a character makes | `@Gerald [snores]` |
| A page turn, a pause | `{page}`, `{pause 2s}` |
| Printed only, heard only | `{book only} …`, `{audio only} …` |
| A note for the performer | `%% Slowly here. %%` |
| The cast | YAML front matter: `cast:` |

Every Markdown story is already a valid VoxDown file, read by one narrator. Marks are added where they help, and a file never fails to read: problems are warnings.

## Other implementations

The spec’s examples are its tests. [`spec/conformance.json`](spec/conformance.json) lists each one with its input, its spoken script and book text, its lines as data, and the warnings this implementation reports. SPEC.md §15 says what a reader and a writer must do to conform.

## Versions

The spec and the packages are versioned separately: the spec is 1.0, and each package follows semantic versioning. See [VERSIONING.md](VERSIONING.md).

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) explains how the repository works, how to run the tests, and how a change to the spec is made. Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

## License

The code is under the [MIT license](LICENSE). The spec text in `spec/` is under [CC BY 4.0](spec/LICENSE). The examples are in the public domain or, where new, free to copy under CC0.
