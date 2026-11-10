import { fileURLToPath } from "node:url";

/** Inside the workspace, each package is read from its source, so nothing needs building first. */
const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export const workspaceAliases = {
  voxdown: source("./packages/core/src/index.ts"),
  "@voxdown/render": source("./packages/render/src/index.ts"),
  "@voxdown/editor": source("./packages/editor/src/index.ts"),
};
