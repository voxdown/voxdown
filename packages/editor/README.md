# @voxdown/editor

An editor for VoxDown stories. Lines you aren’t typing in read like a finished script: names as chips in each character’s color, directions as small labels above the words they direct, sounds, notes and page turns as chips, scene breaks and headings drawn across the page, groups with a bar, and the front matter folded to one line. Click or tap a line to see its raw marks; **Show marks** (Ctrl/Cmd+Shift+M) shows them everywhere. It also completes names and marks, types curly quotes, and finishes marks as you type. The text stays the only source: nothing is hidden in the editor.

It comes two ways: a [CodeMirror 6](https://codemirror.net) extension, and a `<voxdown-editor>` web component for pages that don’t use CodeMirror. It depends on CodeMirror 6 and `voxdown` only.

```sh
npm install @voxdown/editor
```

## The web component

```html
<script type="module">import "@voxdown/editor/element";</script>

<voxdown-editor show-marks>
  @Gerald (yawning) “Could you not?” [snores]
</voxdown-editor>
```

- The story is the element’s **`value`**. It starts from a `value` attribute, a `<script type="text/voxdown">` inside it (which keeps `<` and `&` as written), or its text, without the page’s indentation.
- It fires **`input`** on every change, and **`change`** when it loses focus after one.
- Attributes: **`show-marks`**, **`readonly`**, and `smart-quotes="off"`.
- Characters and their colors come from the story itself: its cast, then every name it marks.
- **`view`** is the CodeMirror view, for adding your own extensions or commands.
- It draws in a shadow root; the `--vxd-*` variables below reach inside. Give it a height: `voxdown-editor { height: 24rem; }`.
- `defineVoxdownEditor("my-editor")` registers it under another name; `VoxdownEditorElement` is the class.

## The CodeMirror extension

```js
import { EditorView } from "@codemirror/view";
import { scriptEditor } from "@voxdown/editor";

new EditorView({
  parent: document.querySelector("#editor"),
  doc: story,
  extensions: [
    scriptEditor({
      characters: () => [
        { handle: "Gerald", name: "Gerald the Dragon", color: "#c2410c" },
        { handle: "Wanda", name: "Wanda", color: "#2563eb" },
      ],
    }),
  ],
});
```

`charactersOf(text)` (from `@voxdown/editor/element`) works the characters out from a story, as the web component does.

### Options and hooks

Only `characters` is required. The rest let a host app add its own controls without changing the editor.

| Option | What it does |
| --- | --- |
| `characters: () => Character[]` | The cast to color and suggest: `{ handle, name, color?, provisional? }`. A `provisional` character is colored but never suggested. Called whenever the editor draws, so it can change. |
| `showMarks` | Start with every mark raw. |
| `smartQuotes` | Type “ ” and ’ for `"` and `'` (on unless `false`), with Enter and Backspace that split and join quotes. |
| `view` | Which kinds of mark to draw at first: `{ color, names, directions, sounds, vocal, pages, notes }`, each `true` unless said. Change later with the `setView` effect. |
| `onNameClick(view, { from, to, speaker })` | A click on a name chip, for a speaker menu of your own. Without it, a click puts the cursor there. |
| `pageTurns: () => boolean` | Whether page turns do anything where this text goes. When not, they are drawn inactive. |
| `pageLabel(state, from)` | What a page turn turns to, such as `"page 12"`, by where its mark starts. |
| `pageTurnTools(element, place)` | Your own controls inside each page turn’s rule, `"before"` or `"after"` its label: mount into `element`, and return a function that takes them down. A player might put a chime button there. |
| `sceneLabel(state, from, scene)` | What a scene break opens, by where its mark starts and the scene’s number. Unless said, `Scene 2`. |
| `toolMarks` | Your tool’s own instructions (SPEC.md §9.5) drawn as a small mark instead of a chip: `{ "recorder:join": { text: "⁀", title: "Recorded as one" } }`. |
| `chipStatus(state, from, to)` | A status for a sound’s chip, set as its `data-status` for your stylesheet to draw, such as whether a recording exists: `{ name: "recorded", title: "Recorded" }`. Read again whenever you dispatch an effect. |
| `readSceneAloud` | A speaker button on every scene break and heading that writes the scene’s name as a line of its own after the mark, to be read aloud, and takes it out again. `say(scene)` says a scene’s number in the story’s language; `nameWas(state, from)` knows a heading’s old name, so a line still saying it is marked out of date. |

### Other exports

- **State:** `setShowMarks`, `showMarksField`; `setView`, `viewField`; `marksField` (the drawn marks, worked out when the text changes); `openField` and `holdOpen` (which lines show their raw marks).
- **Scenes:** `sceneNumbers(state)`, each scene break’s and heading’s number in text order; `readSceneName`, `readSceneNameSpec`, `sceneNameChange`, `spokenName`, `nameReadAt`, `readNamesField` for the scene-name speaker.
- **Pieces:** `livePreview`, `scriptTheme`, `completions`, `startCompletion`, `smartQuotes`, `editorMarks(text)` (what the editor draws, without a view), and `editDistance`.

## The look

The editor reads these variables, with plain fallbacks:

| Variable | What |
| --- | --- |
| `--vxd-font`, `--vxd-ui-font`, `--vxd-mono` | The story, the chips, the raw marks. |
| `--vxd-size`, `--vxd-leading` | Text size and line height. |
| `--vxd-ink`, `--vxd-muted`, `--vxd-line` | Text, quiet text, hairlines. |
| `--vxd-direction`, `--vxd-sound`, `--vxd-page`, `--vxd-note`, `--vxd-warning` | Each kind of mark. |
| `--vxd-active`, `--vxd-accent`, `--vxd-focus` | The line being edited, the accent, focus rings. |

Drawn marks carry `data-vxd-chip` or `data-vxd-line` with their kind, and `data-speaker` where they belong to a character.

## License

MIT.
