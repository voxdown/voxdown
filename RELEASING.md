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

Pack it, then upload the file to each store:

```sh
pnpm --filter voxdown-vscode package     # writes packages/vscode/voxdown-<version>.vsix
```

- **Visual Studio Marketplace:** at <https://marketplace.visualstudio.com/manage/publishers/voxdown>, the extension's **…** menu → **Update**, and choose the `.vsix` (the first time: **New extension → Visual Studio Code**). No token is needed. A token from the command line (`vsce publish`) now needs an Azure DevOps organization, and a new organization needs an Azure subscription; global tokens end on 1 December 2026.
- **Open VSX**, for VSCodium, Cursor and others: `npx ovsx publish packages/vscode/voxdown-<version>.vsix -p "$OVSX_TOKEN"`, with a token from <https://open-vsx.org> (Settings → Access Tokens).

To publish from GitHub Actions instead, with no stored token for the Marketplace, set up a policy on the publisher's **Trusted Publishing** tab and run `npx @vscode/vsce@4 publish --oidc` in a job with `permissions: id-token: write`.

## The spec

A new spec version is tagged `spec-<version>` (`spec-1.1`) on the commit that changes `SPEC.md`’s version line, `SPEC_VERSION` in `packages/core/src/index.ts`, and `spec/CHANGELOG.md`.

## The first release

Done once, in this order. Steps 1, 5 and 7 are on the web. **Run every command from this repository’s folder**, except in step 4: `git`, `pnpm` and `gh repo create` act on whatever folder they are run in.

1. **The GitHub organization:** create `voxdown` at <https://github.com/organizations/plan> (the free plan).
2. **The repository**, public, and the first push:

   ```sh
   gh repo create voxdown/voxdown --public \
     --description "Markdown for stories read aloud: a format, a parser, a renderer, an editor and tools." \
     --homepage "https://voxdown.github.io/"
   git remote add origin git@github.com:voxdown/voxdown.git
   git push -u origin main
   ```

3. **Pages, private vulnerability reports, and topics.** The push to `main` deploys the playground to `voxdown.github.io/voxdown/`.

   ```sh
   gh api -X POST repos/voxdown/voxdown/pages -f build_type=workflow
   gh api -X PUT repos/voxdown/voxdown/private-vulnerability-reporting
   gh repo edit voxdown/voxdown --add-topic voxdown,markdown,audiobook,text-to-speech,screenwriting
   ```

4. **The address `voxdown.github.io`.** The bare address belongs to a repository named `voxdown.github.io`. Ours holds one page, which sends visitors on to `/voxdown/` and keeps the rest of the address. Run this from that repository’s folder:

   ```sh
   gh repo create voxdown/voxdown.github.io --public \
     --description "Sends voxdown.github.io on to the VoxDown playground." \
     --homepage "https://voxdown.github.io/" --source . --remote origin --push
   gh api -X POST repos/voxdown/voxdown.github.io/pages -f "source[branch]=main" -f "source[path]=/"
   ```

   A domain bought later is set on that repository (Settings → Pages). GitHub then serves the playground at the domain’s `/voxdown/` too.

5. **The npm organization:** create `voxdown` at <https://www.npmjs.com/org/create> (free for public packages), then `npm login`. It prints a link; if no browser opens, open the link yourself and leave the prompt waiting.
6. **The first packages** (spec 1.0, `voxdown`, `@voxdown/render`, `@voxdown/cli`), and their tags:

   ```sh
   pnpm install --frozen-lockfile && pnpm check
   pnpm --filter voxdown publish --access public
   pnpm --filter @voxdown/render publish --access public
   pnpm --filter @voxdown/cli publish --access public
   git tag spec-1.0 && git tag voxdown@1.0.0 && git tag @voxdown/render@1.0.0 && git tag @voxdown/cli@1.0.0
   git push origin --tags
   ```

7. **Then, the editor and the extension:** publish `@voxdown/editor` the same way and tag it `@voxdown/editor@1.0.0`; create the `voxdown` publisher at <https://marketplace.visualstudio.com/manage> (ID `voxdown`, as in the extension's manifest), upload the extension as above, and tag it `vscode@1.0.0`.
