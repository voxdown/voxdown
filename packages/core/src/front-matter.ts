/**
 * Front matter (§4.2) and what the story takes from it: its details, its cast (§4.3) and who
 * narrates (§5.1).
 */
import type { CastMember, FrontMatter, Meta } from "./model";
import type { Range, SourceText } from "./source";
import type { Warn } from "./warnings";
import { type YamlKey, readYaml } from "./yaml";

export type FrontMatterRead = {
  frontMatter: FrontMatter | null;
  /** Where each front matter key was written. */
  keys: YamlKey[];
  /** The index of the story's first line. */
  bodyLine: number;
  /** The spec version as written after `voxdown:`, so `1.10` stays apart from `1.1` (§16). */
  versionText?: string;
  /**
   * Each value YAML reads as a number or `true`/`false`, as written, by its keys' path: what the
   * format reads as text keeps it (`title: 1.10` is `1.10`, not `1.1`).
   */
  written: Map<string, string>;
};

/** A file has front matter only if a `---` first line is closed by a second one (§4.4). */
export function readFrontMatter(text: SourceText, warn: Warn): FrontMatterRead {
  const lines = text.lines;
  const first = lines[0];
  if (!first || text.slice(first).replace(/^﻿/, "").trimEnd() !== "---") {
    return { frontMatter: null, keys: [], bodyLine: 0, written: new Map() };
  }
  for (let close = 1; close < lines.length; close++) {
    const closing = lines[close];
    if (!closing || text.slice(closing).trimEnd() !== "---") continue;
    const rawFrom = lines[1]?.from ?? closing.from;
    const rawTo = close > 1 ? (lines[close - 1]?.to ?? rawFrom) : rawFrom;
    const raw = text.text.slice(rawFrom, rawTo);
    const yaml = readYaml(raw, rawFrom);
    for (const problem of yaml.problems) warn("front-matter", problem.message, problem.range);
    const versionKey = yaml.keys.find((key) => key.path.length === 1 && key.path[0] === "voxdown");
    const versionText = versionKey && writtenValue(text.text, versionKey.range);
    const written = new Map<string, string>();
    for (const key of yaml.keys) {
      const value = valueAt(yaml.data, key.path);
      if (typeof value !== "number" && typeof value !== "boolean") continue;
      const as = writtenValue(text.text, key.range);
      if (as !== undefined) written.set(pathKey(key.path), as);
    }
    return {
      frontMatter: { range: { from: first.from, to: closing.to }, raw, data: yaml.data },
      keys: yaml.keys,
      bodyLine: close + 1,
      ...(versionText ? { versionText } : {}),
      written,
    };
  }
  return { frontMatter: null, keys: [], bodyLine: 0, written: new Map() };
}

function pathKey(path: readonly string[]): string {
  return path.join("\u0000");
}

function valueAt(data: unknown, path: readonly string[]): unknown {
  let value = data;
  for (const step of path) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    value = Object.hasOwn(value, step) ? (value as Record<string, unknown>)[step] : undefined;
  }
  return value;
}

/** A one-line value as written after its key, without quotes or a comment. */
function writtenValue(source: string, key: Range): string | undefined {
  const colon = source.indexOf(":", key.to);
  const end = source.indexOf("\n", colon);
  const line = source.slice(colon + 1, end < 0 ? source.length : end);
  const value = line
    .replace(/\s+#.*$/, "")
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2");
  return value || undefined;
}

export type StorySetup = {
  /** The book's details. The narrator's spelling is settled later, by `Names`. */
  details: Omit<Meta, "narrator">;
  cast: CastMember[];
  /** Whether the front matter has a `cast` map, so undeclared names deserve a warning. */
  hasCast: boolean;
  narratorSetting: string | undefined;
  /** Where each cast member's name is written in the front matter. */
  castRanges: Map<string, Range>;
};

export function readSetup(read: FrontMatterRead, warn: Warn): StorySetup {
  const data = read.frontMatter?.data ?? {};
  // A value read as text is its text as written, though YAML would read a number in it.
  const scalarText = (value: unknown, ...path: string[]) =>
    textOf(
      typeof value === "number" || typeof value === "boolean"
        ? (read.written.get(pathKey(path)) ?? value)
        : value,
    );
  const narratorSetting = scalarText(data.narrator, "narrator");
  const castRanges = new Map<string, Range>();
  for (const key of read.keys) {
    const [top, handle] = key.path;
    if (key.path.length === 2 && top === "cast" && handle !== undefined) {
      castRanges.set(handle, key.range);
    }
  }
  const castValue = data.cast;
  const hasCast = isMap(castValue);
  if (castValue !== undefined && castValue !== null && !hasCast && read.frontMatter) {
    warn(
      "front-matter",
      "The cast should map each name to a full name or details.",
      read.frontMatter.range,
    );
  }
  const cast: CastMember[] = [];
  if (hasCast) {
    for (const [handle, value] of Object.entries(castValue)) {
      cast.push(castMember(handle, value, scalarText));
    }
  }
  const details: Omit<Meta, "narrator"> = {};
  const fields = [
    ["title", "title"],
    ["subtitle", "subtitle"],
    ["author", "author"],
    ["language", "language"],
    ["version", "voxdown"],
  ] as const;
  for (const [field, key] of fields) {
    const value =
      field === "version"
        ? (read.versionText ?? scalarText(data[key], key))
        : scalarText(data[key], key);
    if (value !== undefined) details[field] = value;
  }
  return { details, cast, hasCast, narratorSetting, castRanges };
}

function castMember(
  handle: string,
  value: unknown,
  scalarText: (value: unknown, ...path: string[]) => string | undefined,
): CastMember {
  if (isMap(value)) {
    const about = scalarText(value.about, "cast", handle, "about");
    return {
      handle,
      name: scalarText(value.name, "cast", handle, "name") ?? handle,
      ...(about !== undefined ? { about } : {}),
      data: value,
    };
  }
  return { handle, name: scalarText(value, "cast", handle) ?? handle, data: {} };
}

function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string | undefined {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text === "" ? undefined : text;
}
