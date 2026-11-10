/**
 * A reader for the small part of YAML that front matter needs (§4.2), so the parser has no
 * runtime dependencies. It reads:
 *
 * - `key: value`, with maps nested by indentation, and empty values as null;
 * - plain, 'single-quoted' and "double-quoted" scalars, including ones that continue on more
 *   indented lines;
 * - block scalars: `|`, `|-`, `|+`, `>`, `>-`, `>+`;
 * - block lists (`- item`, including `- key: value` maps) and flow lists (`[a, "b", c]`);
 * - comments.
 *
 * Plain scalars follow YAML's core schema: `null`, `~` and empty are null, `true` and `false` are
 * booleans, decimal numbers are numbers, and everything else is a string. Anything else (flow
 * maps, anchors, aliases, tags, multi-line flow lists) is reported as a problem and kept as its
 * raw text. It never throws.
 */
import type { Range } from "./source";

export type YamlProblem = { message: string; range: Range };
/**
 * Where each key was written. List items use their index as a path segment. `value` is where a
 * map key's value is written: from just after its colon (`from`, the spaces included) to the end of
 * its last line, or, for a value on the key's own line, to the end of the value before any
 * comment. `text` is the value as written, without those spaces.
 */
export type YamlKey = { path: readonly string[]; range: Range; value?: YamlValue };
export type YamlValue = { from: number; to: number; text: Range };
export type YamlResult = {
  data: Record<string, unknown>;
  keys: YamlKey[];
  problems: YamlProblem[];
};

export function readYaml(text: string, offset = 0): YamlResult {
  return new YamlReader(text, offset).read();
}

type YamlLine = {
  /** The line without its line ending. */
  raw: string;
  indent: number;
  /** The line after its indentation. */
  text: string;
  /** Offset of the line's start in the whole file. */
  from: number;
};

class YamlReader {
  private readonly lines: YamlLine[] = [];
  private index = 0;
  private readonly keys: YamlKey[] = [];
  private readonly problems: YamlProblem[] = [];
  /** How deep the maps and lists being read are nested, and the last line read as content. */
  private depth = 0;
  private lastContent = -1;

  constructor(text: string, offset: number) {
    let from = offset;
    for (const piece of text.split("\n")) {
      const raw = piece.endsWith("\r") ? piece.slice(0, -1) : piece;
      const indentation = /^[ \t]*/.exec(raw)?.[0] ?? "";
      const line = { raw, indent: indentation.length, text: raw.slice(indentation.length), from };
      this.lines.push(line);
      if (indentation.includes("\t") && !isBlank(line)) {
        this.problem("Tabs can't indent front matter. Use spaces.", line);
      }
      from += piece.length + 1;
    }
  }

  read(): YamlResult {
    this.skipBlank();
    const first = this.peek();
    let data: Record<string, unknown> = {};
    if (first && isListItem(first.text)) {
      this.problem("Front matter should be keys and values, not a list.", first);
      this.index = this.lines.length;
    } else if (first) {
      data = this.readMap(first.indent, []);
    }
    for (; this.index < this.lines.length; this.index++) {
      const line = this.lines[this.index];
      if (line && !isBlank(line)) this.problem("Couldn't read this line.", line);
    }
    return { data, keys: this.keys, problems: this.problems };
  }

  private readMap(indent: number, path: readonly string[]): Record<string, unknown> {
    const map: Record<string, unknown> = {};
    if (this.tooDeep(indent)) return map;
    this.depth++;
    try {
      this.readEntries(map, indent, path);
    } finally {
      this.depth--;
    }
    return map;
  }

  /** Past this depth the rest of a block is reported and skipped, so no file can exhaust the stack. */
  private tooDeep(indent: number): boolean {
    if (this.depth < MAX_DEPTH) return false;
    const line = this.peek();
    if (line) this.problem("The front matter is nested too deeply here.", line);
    while (this.index < this.lines.length) {
      const next = this.lines[this.index] as YamlLine;
      if (!isBlank(next) && next.indent < indent) break;
      if (!isBlank(next)) this.lastContent = this.index;
      this.index++;
    }
    return true;
  }

  private readEntries(map: Record<string, unknown>, indent: number, path: readonly string[]): void {
    for (;;) {
      this.skipBlank();
      const line = this.peek();
      if (!line || line.indent < indent) break;
      const entry = line.indent === indent ? readKey(line) : null;
      if (!entry) {
        this.problem(
          line.indent > indent
            ? "This line is indented more than expected."
            : "Couldn't read this line.",
          line,
        );
        this.lastContent = this.index;
        this.index++;
        continue;
      }
      const keyPath = [...path, entry.key];
      const key: YamlKey = { path: keyPath, range: entry.range };
      this.keys.push(key);
      if (Object.hasOwn(map, entry.key)) this.problem(`“${entry.key}” is set twice.`, line);
      const keyLine = this.index;
      this.lastContent = keyLine;
      this.index++;
      setKey(map, entry.key, this.readValue(entry.rest, line, indent, keyPath, true));
      key.value = this.valueRange(line, entry.rest, keyLine);
    }
  }

  /** Where the value after `key:` on `line` is written, now that it has been read. */
  private valueRange(line: YamlLine, rest: string, keyLine: number): YamlValue {
    const from = line.from + line.raw.length - rest.length;
    const lead = rest.length - rest.trimStart().length;
    const value = rest.trimStart();
    if (this.lastContent > keyLine) {
      const last = this.lines[this.lastContent] as YamlLine;
      const to = last.from + last.raw.length;
      const start =
        value === "" || value.startsWith("#") ? (this.lines[keyLine + 1]?.from ?? to) : from + lead;
      return { from, to, text: { from: start, to } };
    }
    let length = stripComment(value).length;
    if (value.startsWith('"') || value.startsWith("'")) length = parseQuoted(value)?.end ?? length;
    return {
      from,
      to: from + lead + length,
      text: { from: from + lead, to: from + lead + length },
    };
  }

  private readList(indent: number, path: readonly string[]): unknown[] {
    const list: unknown[] = [];
    if (this.tooDeep(indent)) return list;
    this.depth++;
    try {
      this.readItems(list, indent, path);
    } finally {
      this.depth--;
    }
    return list;
  }

  private readItems(list: unknown[], indent: number, path: readonly string[]): void {
    for (;;) {
      this.skipBlank();
      const line = this.peek();
      if (!line || line.indent < indent) break;
      if (line.indent > indent) {
        this.problem("This line is indented more than expected.", line);
        this.lastContent = this.index;
        this.index++;
        continue;
      }
      if (!isListItem(line.text)) break;
      const rest = line.text.slice(1);
      const item = rest.trimStart();
      const column = line.indent + 1 + rest.length - item.length;
      const itemPath = [...path, String(list.length)];
      const inline = { ...line, indent: column, text: item };
      if (item !== "" && !item.startsWith("#") && (isListItem(item) || readKey(inline))) {
        // A map or a list that starts on the dash's line: read it as if it began at its column.
        this.lines[this.index] = inline;
        list.push(
          isListItem(item) ? this.readList(column, itemPath) : this.readMap(column, itemPath),
        );
        continue;
      }
      this.lastContent = this.index;
      this.index++;
      list.push(this.readValue(item, line, indent, itemPath, false));
    }
  }

  /**
   * Reads the value after a key or a dash. The line itself has been consumed; nested blocks and
   * continuation lines come after it. `sameIndentList` allows `key:` followed by `- item` lines at
   * the key's own indentation.
   */
  private readValue(
    text: string,
    line: YamlLine,
    indent: number,
    path: readonly string[],
    sameIndentList: boolean,
  ): unknown {
    const value = text.trim();
    if (value === "" || value.startsWith("#")) return this.readNested(indent, path, sameIndentList);
    const first = value[0];
    if (first === "|" || first === ">") return this.readBlockScalar(value, line, indent);
    if (first === "[") return this.readFlowList(value, line);
    if (first === '"' || first === "'") return this.readQuoted(value, line, indent);
    if (first === "{" || first === "&" || first === "*" || first === "!") {
      this.problem("Flow maps, anchors, aliases and tags are not supported here.", line);
      return stripComment(value);
    }
    return plainScalar(this.continuePlain(stripComment(value), indent));
  }

  private readNested(indent: number, path: readonly string[], sameIndentList: boolean): unknown {
    this.skipBlank();
    const next = this.peek();
    if (!next) return null;
    if (next.indent > indent) {
      return isListItem(next.text)
        ? this.readList(next.indent, path)
        : this.readMap(next.indent, path);
    }
    if (sameIndentList && next.indent === indent && isListItem(next.text)) {
      return this.readList(indent, path);
    }
    return null;
  }

  /**
   * A plain scalar may continue on following lines that are indented more than its key. A line
   * that reads as `key: value` is not a continuation; it is reported where it stands.
   */
  private continuePlain(value: string, indent: number): string {
    let joined = value;
    for (;;) {
      const next = this.peek();
      if (!next || isBlank(next) || next.indent <= indent || readKey(next)) return joined;
      joined += ` ${stripComment(next.text)}`;
      this.lastContent = this.index;
      this.index++;
    }
  }

  private readQuoted(value: string, line: YamlLine, indent: number): unknown {
    let text = value;
    let quoted = parseQuoted(text);
    while (!quoted) {
      const next = this.peek();
      if (!next || (!isBlank(next) && next.indent <= indent)) break;
      text += `\n${next.text}`;
      if (next.text !== "") this.lastContent = this.index;
      this.index++;
      quoted = parseQuoted(text);
    }
    if (!quoted) {
      this.problem("This quoted value is never closed.", line);
      return value;
    }
    const after = text.slice(quoted.end).trim();
    if (after !== "" && !after.startsWith("#")) {
      this.problem("Unexpected text after a quoted value.", line);
    }
    return quoted.value;
  }

  private readBlockScalar(header: string, line: YamlLine, indent: number): unknown {
    const match = /^([|>])([1-9]?)([+-]?)([1-9]?)\s*(?:#.*)?$/.exec(header);
    if (!match) {
      this.problem("Couldn't read this block scalar's header.", line);
      return header;
    }
    const folded = match[1] === ">";
    const chomping = match[3] ?? "";
    const explicit = match[2] || match[4];
    let contentIndent = explicit ? indent + Number(explicit) : null;
    const body: string[] = [];
    for (;;) {
      const next = this.peek();
      if (!next) break;
      const blank = next.text === "";
      if (!blank && next.indent <= indent) break;
      if (!blank && contentIndent === null) contentIndent = next.indent;
      if (!blank && next.indent < (contentIndent ?? 0)) {
        this.problem("This line is indented less than the start of its block.", next);
        break;
      }
      body.push(blank ? "" : next.raw.slice(contentIndent ?? 0));
      if (!blank) this.lastContent = this.index;
      this.index++;
    }
    let trailing = 0;
    while (body.length > 0 && body[body.length - 1] === "") {
      body.pop();
      trailing++;
    }
    const content = folded ? fold(body) : body.join("\n");
    if (body.length === 0 || chomping === "-") return content;
    return chomping === "+" ? `${content}\n${"\n".repeat(trailing)}` : `${content}\n`;
  }

  private readFlowList(value: string, line: YamlLine): unknown {
    const body = stripComment(value);
    if (!body.endsWith("]")) {
      this.problem("A list in brackets must close on the same line.", line);
      return body;
    }
    const items = splitFlowItems(body.slice(1, -1));
    if (items.some((item) => item.startsWith("[") || item.startsWith("{"))) {
      this.problem("Lists and maps inside a list in brackets are not supported.", line);
      return body;
    }
    return items.map((item) => {
      const quoted = item.startsWith('"') || item.startsWith("'") ? parseQuoted(item) : null;
      return quoted ? quoted.value : plainScalar(item);
    });
  }

  private skipBlank(): void {
    while (this.index < this.lines.length && isBlank(this.lines[this.index] as YamlLine)) {
      this.index++;
    }
  }

  private peek(): YamlLine | undefined {
    return this.lines[this.index];
  }

  private problem(message: string, line: YamlLine): void {
    this.problems.push({ message, range: { from: line.from, to: line.from + line.raw.length } });
  }
}

const MAX_DEPTH = 32;

function isBlank(line: YamlLine): boolean {
  return line.text === "" || line.text.startsWith("#");
}

function isListItem(text: string): boolean {
  return text === "-" || text.startsWith("- ") || text.startsWith("-\t");
}

/** `key: rest`, with a plain or quoted key. The colon must be followed by a space or the end. */
function readKey(line: YamlLine): { key: string; rest: string; range: Range } | null {
  const text = line.text;
  const start = line.from + line.indent;
  if (text.startsWith('"') || text.startsWith("'")) {
    const quoted = parseQuoted(text);
    if (!quoted) return null;
    const after = text.slice(quoted.end);
    const colon = after.length - after.trimStart().length;
    if (after[colon] !== ":" || !endsToken(after, colon + 1)) return null;
    return {
      key: quoted.value,
      rest: after.slice(colon + 1),
      range: { from: start, to: start + quoted.end },
    };
  }
  if (text.startsWith("#") || isListItem(text) || text.startsWith("?")) return null;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== ":" || !endsToken(text, i + 1)) continue;
    const key = text.slice(0, i).trimEnd();
    if (key === "") return null;
    return { key, rest: text.slice(i + 1), range: { from: start, to: start + key.length } };
  }
  return null;
}

function endsToken(text: string, index: number): boolean {
  return index >= text.length || text[index] === " " || text[index] === "\t";
}

/** A comment starts with `#` at the start or after white space. */
function stripComment(text: string): string {
  if (text.startsWith("#")) return "";
  const match = /[ \t]#/.exec(text);
  return (match ? text.slice(0, match.index) : text).trim();
}

const NUMBER = /^[-+]?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?$/;

function plainScalar(text: string): unknown {
  if (text === "" || text === "~" || /^(?:null|Null|NULL)$/.test(text)) return null;
  if (/^(?:true|True|TRUE)$/.test(text)) return true;
  if (/^(?:false|False|FALSE)$/.test(text)) return false;
  if (NUMBER.test(text)) return Number(text);
  return text;
}

/**
 * A quoted scalar at the start of `text`, which may run over line breaks. Returns its value and
 * the index just after its closing quote, or null when it doesn't close.
 */
function parseQuoted(text: string): { value: string; end: number } | null {
  const quote = text[0];
  for (let i = 1; i < text.length; i++) {
    const char = text[i];
    if (quote === '"' && char === "\\") {
      i++;
      continue;
    }
    if (char !== quote) continue;
    if (quote === "'" && text[i + 1] === "'") {
      i++;
      continue;
    }
    const inner = foldLines(text.slice(1, i));
    return {
      value: quote === '"' ? unescapeDouble(inner) : inner.replaceAll("''", "'"),
      end: i + 1,
    };
  }
  return null;
}

/** Line breaks inside a quoted scalar: one becomes a space, an empty line becomes a newline. */
function foldLines(text: string): string {
  if (!text.includes("\n")) return text;
  const lines = text.split("\n").map((line, index, all) => {
    const start = index === 0 ? line : line.trimStart();
    return index === all.length - 1 ? start : start.trimEnd();
  });
  let out = lines[0] ?? "";
  let empty = 0;
  for (const line of lines.slice(1)) {
    if (line === "") {
      empty++;
      continue;
    }
    out += empty > 0 ? "\n".repeat(empty) : " ";
    out += line;
    empty = 0;
  }
  return out + "\n".repeat(empty);
}

const DOUBLE_ESCAPES: Record<string, string> = {
  "0": "\0",
  a: "\x07",
  b: "\b",
  t: "\t",
  n: "\n",
  v: "\v",
  f: "\f",
  r: "\r",
  e: "\x1b",
  " ": " ",
  '"': '"',
  "/": "/",
  "\\": "\\",
  N: "\u0085",
  _: " ",
};

function unescapeDouble(text: string): string {
  return text.replace(
    /\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g,
    (whole, code: string) => {
      if (code.length > 1) return String.fromCodePoint(Number.parseInt(code.slice(1), 16));
      return DOUBLE_ESCAPES[code] ?? whole;
    },
  );
}

/** Folded block scalars join lines with spaces, except around empty or more-indented lines. */
function fold(lines: readonly string[]): string {
  let out = "";
  let empty = 0;
  let previous: string | null = null;
  for (const line of lines) {
    if (line === "") {
      empty++;
      continue;
    }
    if (previous === null) {
      out += "\n".repeat(empty);
    } else {
      const indented = /^[ \t]/.test(previous) || /^[ \t]/.test(line);
      out += empty > 0 ? "\n".repeat(empty + (indented ? 1 : 0)) : indented ? "\n" : " ";
    }
    out += line;
    previous = line;
    empty = 0;
  }
  return out;
}

/** Splits the inside of `[…]` on commas that are not inside quotes. */
function splitFlowItems(inner: string): string[] {
  const items: string[] = [];
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    if (quote) {
      if (char === "\\" && quote === '"') i++;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ",") {
      items.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  items.push(inner.slice(start).trim());
  if (items[items.length - 1] === "") items.pop();
  return items;
}

/** Sets a key without ever touching the object's prototype, even for a key named `__proto__`. */
function setKey(map: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(map, key, { value, enumerable: true, writable: true, configurable: true });
}
