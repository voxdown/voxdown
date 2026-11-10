import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SPEC_VERSION } from "voxdown";
import { root } from "./memory";

/** The built command, when `pnpm build` has made it. Nothing here builds it. */
const cli = join(root, "packages/cli/dist/cli.js");
const vxd = (args: string[], input = "") =>
  spawnSync(process.execPath, [cli, ...args], { cwd: root, input, encoding: "utf8" });

describe.skipIf(!existsSync(cli))("the built vxd", () => {
  it("starts with a shebang, so it runs as a command", () => {
    expect(readFileSync(cli, "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  it("prints its version", () => {
    const pkg = JSON.parse(readFileSync(join(root, "packages/cli/package.json"), "utf8"));
    const result = vxd(["--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`vxd ${pkg.version} (VoxDown spec ${SPEC_VERSION})\n`);
  });

  it("exits 0 on a clean story, 1 on warnings and 2 on a missing file", () => {
    expect(vxd(["check", "examples/peter-rabbit.vxd"]).status).toBe(0);
    const warned = vxd(["check", "-"], "---\ncast:\n  Bob: Bob\n---\n@Al “Hi.”\n");
    expect(warned.status).toBe(1);
    expect(warned.stdout).toContain("<stdin>:5:2  warning  unknown-character");
    const missing = vxd(["check", "missing.vxd"]);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toBe("vxd: no such file: missing.vxd\n");
  });
});
