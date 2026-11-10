# Changelog

Changes to the packages, newest first. Changes to the format itself are in [spec/CHANGELOG.md](spec/CHANGELOG.md). How versions work: [VERSIONING.md](VERSIONING.md).

## Unreleased

**VS Code extension 1.0.0**
- Highlighting, snippets, warnings as you type, a script preview, and the cheat sheet.

**The playground**
- The linked pages glide to their place instead of jumping, unless the system asks for less motion.

## `@voxdown/render` 1.1.0 and the playground (9 November 2026)

**@voxdown/render**
- `positions`: each paragraph, heading, line, speech and mark says where it comes from in the source (`data-from`, `data-to`), to link a view to an editor.
- In the script view, a speaker's line and a direction's dashes each have their own lane under the words, as in the editor, instead of being drawn over each other.

**The playground**
- The icon in the masthead, and a switch for light, dark, or as the system is.
- A strip of marks above the editor: a click puts one in.
- The two pages are linked: a click on the script, the book or the lines moves the editor's cursor there, and the cursor marks its place on the right page.
- The examples show who wrote them, under each title, with a book or a script page beside it.
- Laptop and phone layouts that fit: the left page no longer slides under the right one, and stacked pages keep their buttons.

## `@voxdown/editor` 1.0.0 (9 November 2026)

- `scriptEditor`, the CodeMirror 6 editor that draws marks as chips, with its hooks documented.
- `<voxdown-editor>`, the same as a web component (`@voxdown/editor/element`).

## `@voxdown/render` 1.0.1 (9 November 2026)

- The stylesheet styles only what is inside a rendered view (`.vxd`). It used to reach the editor’s marks on the same page, which share its class names: with every mark shown raw, a direction was squeezed to one letter per line.
- In the script view, a line inside a group no longer repeats the group’s direction above its words. The group’s label already says it; a line’s own direction is still drawn.
- A character group’s label names its character by their full name, as their lines do, not by their handle. The lines inside it don’t name them again.

## Spec 1.0, `voxdown` 1.0.0, `@voxdown/render` 1.0.0, `@voxdown/cli` 1.0.0, and the playground (9 November 2026)

**voxdown**
- `parse`, `spokenScript`, `bookText` and `tokens`, passing every example in the spec.
- Warnings with stable codes (SPEC.md §12.3).
- `write`: a lossless writer. An unchanged story writes back byte for byte; fields changed on the model are written back as the edits below make them.
- Edits that follow SPEC.md §13: `setSpeaker`, `setDirection`, `renameCharacter`, `setFullName`, `setMeta`, `insertSound`, `insertLine`, and `applyChanges`.
- `format`: spacing, names in the cast’s spelling, and curly quotes when asked.
- `lines`, `linesToCsv` and `textByCharacter`: the spoken script as data.
- `fromFountain`: an import from Fountain screenplays.
- `characterColors` and `PALETTE`.

**@voxdown/render**
- `renderBook` and `renderScript`, `render` and `renderDocument`, and `stylesheet` (also as `@voxdown/render/voxdown.css`).

**@voxdown/cli**
- `vxd check`, `fmt`, `render`, `export`, `text` and `import`.

**The playground**
- The editor, the script, the book, the lines, CSV and each character’s sides, side by side, with the examples.
