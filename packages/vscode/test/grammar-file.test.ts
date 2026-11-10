import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { grammar, markdownInjection } from "../src/grammar";

/** The grammar files are written from src/grammar.ts: `pnpm grammar` writes them again. */
const files = [
  ["syntaxes/voxdown.tmLanguage.json", grammar],
  ["syntaxes/voxdown.markdown.tmLanguage.json", markdownInjection],
] as const;

describe("the grammar files", () => {
  it.each(files)("%s matches src/grammar.ts", (path, written) => {
    const file = new URL(`../${path}`, import.meta.url);
    if (process.env.UPDATE_GRAMMAR) writeFileSync(file, `${JSON.stringify(written, null, 2)}\n`);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(written);
  });
});
