# Releasing

How a release is made. Every step that publishes something is done by a maintainer, by hand.

## Every release

1. On an up-to-date `main`, run everything CI runs, and the playground in a browser:

   ```sh
   pnpm install --frozen-lockfile
   pnpm check
   pnpm site:check
   ```

2. Set each changed package’s version in its `package.json` (see [VERSIONING.md](VERSIONING.md)), move the **Unreleased** notes in [CHANGELOG.md](CHANGELOG.md) under the new versions, commit, and tag:

   ```sh
   git tag voxdown@1.0.1          # one tag per package released
   git push origin main --tags
   ```

3. Check what will be published, then publish. `pnpm publish` turns `workspace:^` into real version ranges.

   ```sh
   pnpm build
   pnpm --filter voxdown publish --dry-run
   pnpm --filter voxdown publish --access public
   ```

   Publish in dependency order: `voxdown`, then `@voxdown/render`, then `@voxdown/editor` and `@voxdown/cli`.

4. The playground deploys itself from `main` (the **Playground** workflow).

## The VS Code extension

```sh
pnpm --filter voxdown-vscode package                    # writes voxdown-<version>.vsix
pnpm --filter voxdown-vscode exec vsce publish --packagePath voxdown-<version>.vsix
pnpm --filter voxdown-vscode exec ovsx publish voxdown-<version>.vsix -p "$OVSX_TOKEN"   # Open VSX, for VSCodium and others
```

`vsce publish` asks for the `voxdown` publisher’s Azure DevOps token (`vsce login voxdown` stores it).

## The spec

A new spec version is tagged `spec-<version>` (`spec-1.1`) on the commit that changes `SPEC.md`’s version line, `SPEC_VERSION` in `packages/core/src/index.ts`, and `spec/CHANGELOG.md`.

## The first release

Done once, in this order. Steps 1, 4 and 6 are on the web.

1. **The GitHub organization:** create `voxdown` at <https://github.com/organizations/plan> (the free plan).
2. **The repository**, public, and the first push:

   ```sh
   gh repo create voxdown/voxdown --public \
     --description "Markdown for stories read aloud: a format, a parser, a renderer, an editor and tools." \
     --homepage "https://voxdown.github.io/voxdown/"
   git remote add origin git@github.com:voxdown/voxdown.git
   git push -u origin main
   ```

3. **Pages, private vulnerability reports, and topics:**

   ```sh
   gh api -X POST repos/voxdown/voxdown/pages -f build_type=workflow
   gh api -X PUT repos/voxdown/voxdown/private-vulnerability-reporting
   gh repo edit voxdown/voxdown --add-topic voxdown,markdown,audiobook,text-to-speech,screenwriting
   gh workflow run Playground --repo voxdown/voxdown
   ```

4. **The npm organization:** create `voxdown` at <https://www.npmjs.com/org/create> (free for public packages), then `npm login`.
5. **The first packages** (spec 1.0, `voxdown`, `@voxdown/render`, `@voxdown/cli`), and their tags:

   ```sh
   pnpm install --frozen-lockfile && pnpm check
   pnpm --filter voxdown publish --access public
   pnpm --filter @voxdown/render publish --access public
   pnpm --filter @voxdown/cli publish --access public
   git tag spec-1.0 && git tag voxdown@1.0.0 && git tag @voxdown/render@1.0.0 && git tag @voxdown/cli@1.0.0
   git push origin --tags
   ```

6. **Then, the editor and the extension:** publish `@voxdown/editor` the same way and tag it `@voxdown/editor@1.0.0`; create the `voxdown` publisher at <https://marketplace.visualstudio.com/manage>, then publish the extension as above and tag it `vscode@1.0.0`.
