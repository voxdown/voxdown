# @voxdown/render

HTML for VoxDown stories, with no framework: a **book view**, the printed story, and a **script view**, a script to read aloud from, with speakers colored, directions above their words, and sounds, pauses and page turns marked. The output is a string, so it renders on a server or in a browser.

```sh
npm install @voxdown/render
```

```js
import { renderScript, renderBook, renderDocument, stylesheet } from "@voxdown/render";
import { parse } from "voxdown";

const story = parse(source);
element.innerHTML = renderScript(story); // with `stylesheet` in a <style>, or @voxdown/render/voxdown.css
await writeFile("story.html", renderDocument(story, "book", { pages: true })); // a whole page
```

## Functions

| Function | Gives |
| --- | --- |
| `renderScript(story, options?)` | The script view: an `<article class="vxd vxd-script">`. |
| `renderBook(story, options?)` | The book view: an `<article class="vxd vxd-book">`. |
| `render(storyOrSource, "book" \| "script", options?)` | Either, from a story or its text. |
| `renderDocument(storyOrSource, view, options?)` | A whole HTML page with the stylesheet, in the story’s language. |
| `stylesheet` | The CSS, also at `@voxdown/render/voxdown.css`. |
| `characterColors(story, overrides?)`, `PALETTE` | Each character’s color (from `voxdown`). |
| `inlineHtml(text)`, `escapeHtml(text)`, `safeUrl(url, image?)` | The small Markdown and escaping helpers the views use. |

Options: `colors` (by character name), `header` (the title, author and cast; on unless `false`), `pages` (book view: page numbers in the margin), `narratorName` (script view: name the narrator too).

## The look

Both views follow SPEC.md §14. Set these variables on `.vxd` or any ancestor:

| Variable | What |
| --- | --- |
| `--vxd-story-font`, `--vxd-interface-font` | The story’s face, and the face of names, chips and labels. |
| `--vxd-size`, `--vxd-measure` | Text size and line length. |
| `--vxd-ink`, `--vxd-muted`, `--vxd-paper`, `--vxd-line` | Text, quiet text, the page, hairlines. |
| `--vxd-direction`, `--vxd-sound`, `--vxd-page`, `--vxd-note` | Each kind of mark. |

Dark paper follows `prefers-color-scheme`, or `data-vxd-theme="dark"` (or `"light"`) on an ancestor. Each speech carries `data-speaker` and its character’s color as `--vxd-c`, so a page can, say, fade everyone but one speaker:

```css
.vxd-speech:not([data-speaker="Gerald"]) { opacity: 0.4; }
```

The classes are stable: `vxd-speech`, `vxd-narration`, `vxd-name`, `vxd-direction`, `vxd-chip` with `vxd-chip-sound`, `-vocal`, `-pause`, `-page`, `-instruction` and `-label`, `vxd-turn`, `vxd-note`, `vxd-group`, `vxd-heading`, `vxd-break`, `vxd-line`, and `vxd-p`.

## Safety

The views escape every story’s text, and keep only link and image addresses that can’t run script (relative, `http`, `https`, `mailto`, and raster `data:` images). Rendering a file from a stranger is safe.

## License

MIT.
