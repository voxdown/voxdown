import { fileURLToPath } from "node:url";

/** Inside the workspace, each package is read from its source, so nothing needs building first. */
const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** Exact names only, so `@voxdown/editor` doesn't also catch `@voxdown/editor/element`. */
export const workspaceAliases = [
  { find: /^voxdown$/, replacement: source("./packages/core/src/index.ts") },
  { find: /^@voxdown\/render$/, replacement: source("./packages/render/src/index.ts") },
  { find: /^@voxdown\/editor$/, replacement: source("./packages/editor/src/index.ts") },
  { find: /^@voxdown\/editor\/element$/, replacement: source("./packages/editor/src/define.ts") },
];
