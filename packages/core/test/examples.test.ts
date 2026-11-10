import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SPEC_VERSION, format, fromFountain, parse, write } from "../src/index";
import { root } from "./examples";

/** The examples folder: stories anyone may copy, each a clean, formatted file of this spec. */
const folder = join(root, "examples");
const stories = readdirSync(folder).filter((name) => name.endsWith(".vxd"));
const screenplays = readdirSync(folder).filter((name) => name.endsWith(".fountain"));

describe.each(stories)("examples/%s", (name) => {
  const source = readFileSync(join(folder, name), "utf8");
  const story = parse(source);

  it("parses without warnings", () => {
    expect(story.warnings).toEqual([]);
  });

  it("declares the spec version, a title and a language", () => {
    expect(story.meta.version).toBe(SPEC_VERSION);
    expect(story.meta.title).toBeTruthy();
    expect(story.meta.language).toBeTruthy();
  });

  it("is already formatted, and writes back byte for byte", () => {
    expect(format(source)).toBe(source);
    expect(write(story)).toBe(source);
  });

  it("says where it comes from: fresh writing or the public domain", () => {
    expect(source).toMatch(/public domain|gemeinfrei|CC0/i);
  });
});

describe.each(screenplays)("examples/%s", (name) => {
  const converted = fromFountain(readFileSync(join(folder, name), "utf8"));

  it("imports without warnings, already formatted", () => {
    expect(parse(converted).warnings).toEqual([]);
    expect(format(converted)).toBe(converted);
  });
});
