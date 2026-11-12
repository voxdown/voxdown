import { fileURLToPath } from "node:url";

/** Inside the workspace, each package is read from its source, so nothing needs building first. */
const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** Exact names only, so `@voxdown/editor` doesn't also catch `@voxdown/editor/element`. */
export const workspaceAliases = [
  { find: /^voxdown$/, replacement: source("./packages/core/src/index.ts") },
  { find: /^@voxdown\/render$/, replacement: source("./packages/render/src/index.ts") },
  { find: /^@voxdown\/editor$/, replacement: source("./packages/editor/src/index.ts") },
  { find: /^@voxdown\/editor\/element$/, replacement: source("./packages/editor/src/define.ts") },
  { find: /^@voxdown\/produce$/, replacement: source("./packages/produce/src/index.ts") },
  { find: /^@voxdown\/produce\/node$/, replacement: source("./packages/produce/src/node.ts") },
];

/**
 * How long a test may take before it is taken to hang: long enough for a busy computer (the whole
 * suite at once, a browser beside it), or more for a deep fuzz run (`FUZZ_RUNS`), so the
 * documented commands finish however many stories they try. How fast the work is, is for the
 * tests' own budgets (test-support/timing.ts), not this.
 */
export const testTimeout = Math.max(30_000, Number(process.env.FUZZ_RUNS ?? 0) * 60);

/** Run before each project's tests: a turn of the event loop after each test (yield.ts). */
export const setupFiles = [source("./test-support/yield.ts")];
