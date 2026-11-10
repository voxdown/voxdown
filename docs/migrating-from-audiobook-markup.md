# Moving from the Audiobook Markup draft

VoxDown 1.0 grew out of a draft called Audiobook Markup (draft 0.1). The format is the same: a 0.1 file means the same thing in 1.0. What changed are names. This page lists every one, so a project that used the draft can follow.

## Files

| Draft | 1.0 |
| --- | --- |
| `audiobook-markup: 0.1` in the front matter | `voxdown: 1.0`. The old key is now just an unknown key: kept, but no longer read as the version. |
| `.md` files | `.vxd` (`.md` is still read). |

To update a folder of stories:

```sh
sed -i 's/^audiobook-markup: 0\.1$/voxdown: 1.0/' stories/*.md
for f in stories/*.md; do git mv "$f" "${f%.md}.vxd"; done   # optional
```

## Packages

| Draft | 1.0 |
| --- | --- |
| `audiobook-markup` | `voxdown` |
| `audiobook-markup/editor` | `@voxdown/editor` |
| `SPEC_VERSION` is `"0.1-draft"` | `"1.0"` |

Everything else the parser exported keeps its name and shape: `parse`, `bookText`, `spokenScript`, `tokens` and every model type.

## The editor

The editor's exports keep their names (`scriptEditor`, `livePreview`, `scriptTheme`, `completions`, `editorMarks`, `sceneNumbers`, and the rest). These changed:

| Draft | 1.0 |
| --- | --- |
| `ViewSwitches.colour` | `ViewSwitches.color` |
| CSS classes `am-…`, such as `am-chip-name`, `am-label`, `am-speech` | `vxd-…`: `vxd-chip-name`, `vxd-label`, `vxd-speech` |
| CSS variables `--am-…`, such as `--am-ink`, `--am-font` | `--vxd-…`: `--vxd-ink`, `--vxd-font` |
| `data-am-chip`, `data-am-line` on drawn marks | `data-vxd-chip`, `data-vxd-line` |

A host stylesheet can follow with:

```sh
sed -i -E 's/(\.|--|data-)am-/\1vxd-/g' your-styles.css
```

Two behaviors changed, both fixes:

- `sceneNumbers` no longer counts a paragraph holding only notes, page turns or other instructions as a scene. A story that opens with a note before its first heading now numbers that heading's scene 1, not 2.
- The folded front matter counts the cast's names, not every line under `cast:`.

## The spec

- §14's "performance view" is now the "script view".
- Examples of a tool's own instructions use `{recorder:take 3}`.
- New sections: conformance (§15), versions (§16). The open questions are now "Beyond 1.0" (§17).

## New in 1.0

The core now also writes: `write`, the edits (`setSpeaker`, `setDirection`, `renameCharacter`, `setFullName`, `setMeta`, `insertSound`, `insertLine`, `applyChanges`), `format`, the exports (`lines`, `linesToCsv`, `textByCharacter`), `characterColors`, and `fromFountain`. The renderer (`@voxdown/render`), the command line (`@voxdown/cli`), the `<voxdown-editor>` web component and the VS Code extension are new.
