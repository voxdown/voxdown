import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  external: ["voxdown", "@voxdown/render", "@voxdown/produce"],
  format: ["esm"],
  platform: "node",
  banner: { js: "#!/usr/bin/env node" },
  sourcemap: true,
  clean: true,
  target: "node20",
});
