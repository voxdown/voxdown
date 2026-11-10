import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { format } from "voxdown";
import { nodeIo } from "../src/node-io";
import { run } from "../src/run";
import { peter } from "./memory";

// A few small files in a folder of their own.
const folder = mkdtempSync(join(tmpdir(), "vxd-cli-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

async function vxd(args: string[]) {
  let stdout = "";
  let stderr = "";
  const io = nodeIo({
    cwd: folder,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });
  const code = await run(args, io);
  return { code, stdout, stderr };
}

const BOM = "﻿";
const longAgo = new Date("2001-02-03T04:05:06Z");

describe("on a real disk", () => {
  it("leaves a formatted file's bytes and modification time alone", async () => {
    const path = join(folder, "peter.vxd");
    writeFileSync(path, `${BOM}${peter.replace(/\n/g, "\r\n")}`);
    utimesSync(path, longAgo, longAgo);
    const before = readFileSync(path);
    expect(await vxd(["fmt", "peter.vxd"])).toEqual({ code: 0, stdout: "", stderr: "" });
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(statSync(path).mtimeMs).toBe(longAgo.getTime());
  });

  it("keeps a byte order mark and Windows line endings when it formats", async () => {
    const path = join(folder, "messy.vxd");
    const messy = `${BOM}Once  upon a time.   \r\n\r\n\r\nThe end.\r\n`;
    writeFileSync(path, messy);
    expect(await vxd(["fmt", "messy.vxd"])).toMatchObject({ code: 0, stdout: "messy.vxd\n" });
    const bytes = readFileSync(path);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.toString("utf8")).toBe(format(messy));
    expect(bytes.toString("utf8")).toBe(`${BOM}Once upon a time.\r\n\r\nThe end.\r\n`);
  });

  it("refuses a file that isn't UTF-8, rather than writing over it", async () => {
    const path = join(folder, "latin1.vxd");
    const latin1 = Buffer.from("Caf\xe9  au lait.\n", "latin1");
    writeFileSync(path, latin1);
    expect(await vxd(["fmt", "latin1.vxd"])).toEqual({
      code: 2,
      stdout: "",
      stderr: "vxd: latin1.vxd is not UTF-8 text\n",
    });
    expect(readFileSync(path).equals(latin1)).toBe(true);
  });

  it("names missing files and folders in one line", async () => {
    expect(await vxd(["check", "nowhere.vxd"])).toEqual({
      code: 2,
      stdout: "",
      stderr: "vxd: no such file: nowhere.vxd\n",
    });
    const result = await vxd(["check", "."]);
    expect(result).toMatchObject({
      code: 2,
      stderr: "vxd: . is a folder: name the files in it, such as ./*.vxd\n",
    });
  });

  it("makes the folders it writes into", async () => {
    writeFileSync(join(folder, "story.vxd"), "@Gerald “Could you not?”\n\nHe could not.\n");
    expect(await vxd(["export", "story.vxd", "--format", "text", "--out", "deep/sides/"])).toEqual({
      code: 0,
      stdout: "",
      stderr: "",
    });
    expect(readFileSync(join(folder, "deep/sides/Gerald.txt"), "utf8")).toBe("Could you not?\n");
    expect(readFileSync(join(folder, "deep/sides/Narrator.txt"), "utf8")).toBe("He could not.\n");
    expect((await vxd(["render", "story.vxd", "--out", "site/story.html"])).code).toBe(0);
    expect(readFileSync(join(folder, "site/story.html"), "utf8")).toContain("Could you not?");
  });
});
