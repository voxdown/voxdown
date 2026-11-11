# Contributing to VoxDown

Thank you for helping. This page explains how the repository works, how to run it, and how changes are made. Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

## Ground rules

These keep VoxDown small and usable anywhere. The tests enforce the first three.

- **The core has no dependencies.** `voxdown` imports nothing outside its own folder, so it runs in browsers, Node, Deno and Bun alike.
- **Each package imports only what its manifest declares**, and never reaches into another package’s folder.
- **The project names no host application.** Examples of a tool’s own marks use a neutral tool, such as `{recorder:take 3}`.
- **The spec talks about stories and characters.** Voices, engines, casting, takes, prices and mixing belong to the tools that use the format.
- **Examples are new writing or public domain**, and say which. New writing in this repository is free to copy under CC0.
- **The editor depends on CodeMirror 6 only.** Any other dependency is named in its README with the reason for it.
- **The site has no analytics, tracking or third-party requests.** Fonts are bundled.
- **Plain, direct American English** in docs, messages and the spec.

## Setting up

You need Node 20 or later (CI tests 20, 22 and 24) and pnpm 9 (`corepack enable` gives you the right one).

```sh
pnpm install
pnpm test        # every package's tests
pnpm typecheck
pnpm lint        # Biome; `pnpm format` fixes formatting
pnpm build       # the packages, into each package's dist/
pnpm site        # the playground, at http://localhost:5173
pnpm check       # lint, typecheck, test and build, as CI runs them
pnpm site:check  # the built playground, listening page and Writer in Chromium (after `pnpm exec playwright install chromium`)
pnpm check:all   # both: what a change to the site, or a release, must pass
pnpm --filter voxdown-vscode test:vscode   # the extension in a real VS Code (under xvfb-run on Linux)
```

Inside the workspace, packages are read from their source, so tests and the playground need no build first.

## The layout

| Folder | What |
| --- | --- |
| `spec/` | SPEC.md, its cheat sheet, its changelog, and `conformance.json` |
| `packages/core` | `voxdown`: parser, readings, writer, edits, formatter, exports, Fountain import |
| `packages/render` | `@voxdown/render`: HTML views and their stylesheet |
| `packages/editor` | `@voxdown/editor`: the CodeMirror editor and `<voxdown-editor>` |
| `packages/cli` | `@voxdown/cli`: the `vxd` command |
| `packages/vscode` | the VS Code extension (not on npm) |
| `site` | the playground |
| `examples` | stories for learning and testing |

## Changing the spec

The spec’s examples are its tests. An example is a fenced block marked `example`: the input, a line with a single dot, the spoken script, and optionally a second dot and the book text (SPEC.md §3).

1. Change the rule, and add or change an example for it. Every rule has one.
2. Run `pnpm test`. `spec.test.ts` checks every example is well formed, and `conformance.test.ts` checks the parser produces it.
3. Change the parser until it does.
4. Run `pnpm fixtures` to write `spec/conformance.json` again, and commit it. A test fails if it is out of date.
5. Add a line to `spec/CHANGELOG.md`. Read SPEC.md §16 first: a change to what a valid file means needs a new major version, so most changes should only add.

Open an issue before a large change, so it can be discussed first.

## Changing a package

- Add a test for what you change. Bugs come with a test that fails before the fix.
- Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md).
- Keep the public API documented in the package’s README.

## Commits and pull requests

Write commit messages a newcomer can follow: what changed, and why. Keep one change per pull request, and make sure `pnpm check` passes.

## Reporting a security problem

Please don’t open a public issue. Use **Report a vulnerability** on the repository’s Security tab, which reaches the maintainers privately.
