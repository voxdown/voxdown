# Changelog

Changes to the packages, newest first. Changes to the format itself are in [spec/CHANGELOG.md](spec/CHANGELOG.md). How versions work: [VERSIONING.md](VERSIONING.md).

## Unreleased

The first release, in two parts.

### First: spec 1.0, `voxdown` 1.0.0, `@voxdown/render` 1.0.0, `@voxdown/cli` 1.0.0, and the playground

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

### Then: `@voxdown/editor` 1.0.0 and the VS Code extension 1.0.0

**@voxdown/editor**
- `scriptEditor`, the CodeMirror 6 editor that draws marks as chips, with its hooks documented.
- `<voxdown-editor>`, the same as a web component (`@voxdown/editor/element`).

**VS Code extension**
- Highlighting, snippets, warnings as you type, a script preview, and the cheat sheet.
