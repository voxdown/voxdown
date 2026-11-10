# Versions

VoxDown has two kinds of version: the spec’s and the packages’. They move separately.

## The spec

The spec is versioned `major.minor` (SPEC.md §16). A file says which version it follows with its `voxdown:` front matter key.

- A **minor** version only adds: new instructions, front matter keys or warnings, or meaning for text a 1.0 file would rarely contain. Every 1.0 file means the same under every 1.x.
- A **major** version may change what existing files mean.
- Fixing wording, or adding examples of existing rules, changes no version.

Spec versions are tagged `spec-1.0`, `spec-1.1`, and so on. Its changes are in [spec/CHANGELOG.md](spec/CHANGELOG.md).

## The packages

Each package follows [semantic versioning](https://semver.org) on its own and is tagged `name@version` (`voxdown@1.0.0`, `@voxdown/cli@1.0.0`). The VS Code extension is tagged `vscode@1.0.0`.

- `voxdown` implements one spec version, exported as `SPEC_VERSION`. A new spec minor version comes in a new minor release of `voxdown`; a new spec major version, in a new major release.
- For `voxdown`, a **breaking change** is one that removes or renames an export, changes the model’s shape so that working code fails, or changes the spoken script, book text or lines of a file in a way the spec doesn’t ask for. Bringing output in line with the spec is a fix, released as a patch, and noted in the changelog.
- `@voxdown/render`, `@voxdown/editor` and `@voxdown/cli` depend on `voxdown ^1` and release when they change. A change to the HTML a renderer writes that would break a stylesheet is a breaking change; a change to how it looks is not.
- Before 1.0 nothing was published. The draft’s names, and how to move from them, are in [docs/migrating-from-audiobook-markup.md](docs/migrating-from-audiobook-markup.md).

## Changelogs

Package changes are in [CHANGELOG.md](CHANGELOG.md), newest first, with an **Unreleased** section that each pull request adds to.
