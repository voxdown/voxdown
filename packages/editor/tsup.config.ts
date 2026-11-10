import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/define.ts"],
  external: [/^@codemirror\//, "voxdown"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
});
