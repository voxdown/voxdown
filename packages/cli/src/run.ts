/**
 * The vxd command: checks, formats, renders and exports VoxDown stories, and imports Fountain
 * screenplays. Everything it reads and writes goes through `io`, so tests run it in memory and
 * `cli.ts` only wires it to the process.
 */
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type RenderOptions, type View, render, renderDocument } from "@voxdown/render";
import {
  type FormatOptions,
  SPEC_VERSION,
  type Story,
  bookText,
  format,
  fromFountain,
  lines,
  linesToCsv,
  parse,
  spokenScript,
  textByCharacter,
} from "voxdown";
import { version } from "../package.json";

export const VERSION: string = version;

/** What the command reads and writes. Paths given to it are absolute, resolved against `cwd`. */
export type Io = {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** All of standard input, as UTF-8. */
  readStdin: () => Promise<string>;
  /**
   * A file as UTF-8. Throws an error with a Node `code` when it can't: `ENOENT`, `EISDIR`,
   * `EACCES`, or `ERR_ENCODING_INVALID_ENCODED_DATA` when the file isn't UTF-8.
   */
  readFile: (path: string) => Promise<string>;
  /** Writes a file as UTF-8, creating the folders it is in. */
  writeFile: (path: string, text: string) => Promise<void>;
  isDirectory: (path: string) => Promise<boolean>;
};

/** Exit codes: done, problems found, and the command couldn't run. */
export const OK = 0;
export const PROBLEMS = 1;
export const ERROR = 2;

/** Runs `vxd` with its arguments (without `node` and the script) and returns the exit code. */
export async function run(argv: readonly string[], io: Io): Promise<number> {
  try {
    return await dispatch([...argv], io);
  } catch (error) {
    const message =
      error instanceof Failure ? error.message : `unexpected error: ${errorMessage(error)}`;
    io.stderr(`vxd: ${message}\n`);
    return error instanceof Failure ? error.code : ERROR;
  }
}

async function dispatch(argv: string[], io: Io): Promise<number> {
  const [first, ...rest] = argv;
  if (first === undefined) {
    io.stderr(generalHelp());
    return ERROR;
  }
  if (first === "-h" || first === "--help") {
    io.stdout(generalHelp());
    return OK;
  }
  if (first === "-v" || first === "--version") {
    io.stdout(`vxd ${VERSION} (VoxDown spec ${SPEC_VERSION})\n`);
    return OK;
  }
  if (first === "help") {
    const topic = rest[0];
    if (topic === undefined) io.stdout(generalHelp());
    else io.stdout(commandHelp(commandNamed(topic)));
    return OK;
  }
  if (first.startsWith("-")) throw usage(`unknown option ${first}`);
  const command = commandNamed(first);
  const { values, files } = readOptions(first, command, rest);
  if (values.help === true) {
    io.stdout(commandHelp(command));
    return OK;
  }
  if (command.files === "one") {
    if (files.length === 0) throw usage(`${first} needs a file`, first);
    if (files.length > 1) throw usage(`${first} takes one file, not ${files.length}`, first);
  } else if (files.length === 0) {
    throw usage(`${first} needs at least one file`, first);
  }
  if (files.filter((file) => file === "-").length > 1) {
    throw usage("- (standard input) can be given only once", first);
  }
  return command.action({ io, values, files });
}

// Errors

/** An error the user can act on, shown as one line. */
class Failure extends Error {
  constructor(
    message: string,
    readonly code: number = ERROR,
  ) {
    super(message);
  }
}

function usage(message: string, command?: string): Failure {
  return new Failure(`${message} (see vxd ${command ? `${command} ` : ""}--help)`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One line for a file that can't be read or written. */
function fileFailure(error: unknown, name: string, verb: "read" | "write"): Failure {
  const code = (error as { code?: unknown } | null)?.code;
  switch (code) {
    case "ENOENT":
      return new Failure(verb === "read" ? `no such file: ${name}` : `can't write ${name}`);
    case "EISDIR":
      return new Failure(
        verb === "read"
          ? `${name} is a folder: name the files in it, such as ${name.replace(/[/\\]+$/, "")}/*.vxd`
          : `${name} is a folder, not a file`,
      );
    case "ENOTDIR":
      return new Failure(`no such folder for ${name}`);
    case "EACCES":
    case "EPERM":
      return new Failure(`can't ${verb} ${name}: permission denied`);
    case "ERR_ENCODING_INVALID_ENCODED_DATA":
      return new Failure(`${name} is not UTF-8 text`);
    default:
      return new Failure(`can't ${verb} ${name}: ${errorMessage(error)}`);
  }
}

// Options

type Option = {
  type: "boolean" | "string";
  short?: string;
  /** The values a string option accepts. */
  values?: readonly string[];
  /** How the value is shown in the help, such as `<file>`. */
  value?: string;
  help: string;
};

type Values = Record<string, string | boolean | undefined>;

type Context = { io: Io; values: Values; files: string[] };

type Command = {
  usage: string;
  summary: string;
  about: string;
  examples: string[];
  /** When it exits 1, for commands that can. */
  fails?: string;
  files: "one" | "many";
  options: Record<string, Option>;
  action: (context: Context) => Promise<number>;
};

const HELP: Option = { type: "boolean", short: "h", help: "Show this help." };

function readOptions(name: string, command: Command, args: string[]) {
  const options: Record<string, Option> = { ...command.options, help: HELP };
  const config = Object.fromEntries(
    Object.entries(options).map(([key, option]) => [
      key,
      option.short ? { type: option.type, short: option.short } : { type: option.type },
    ]),
  );
  // Not strict, so each mistake gets a message of our own below.
  const parsed = parseArgs({
    args,
    options: config,
    allowPositionals: true,
    strict: false,
    tokens: true,
  });
  // Asking for help is never a mistake, whatever else is on the line.
  if (parsed.tokens.some((token) => token.kind === "option" && token.name === "help")) {
    return { values: { help: true } as Values, files: [] };
  }
  for (const token of parsed.tokens) {
    if (token.kind !== "option") continue;
    const option = Object.hasOwn(options, token.name) ? options[token.name] : undefined;
    if (!option) throw usage(`unknown option ${token.rawName} for ${name}`, name);
    if (option.type === "boolean") {
      if (token.value !== undefined) throw usage(`${token.rawName} takes no value`, name);
      continue;
    }
    const value = token.value;
    // `--out --json` is a missing value, not a file named "--json"; `--out -` means stdout.
    if (value === undefined || (!token.inlineValue && value.startsWith("-") && value !== "-")) {
      throw usage(`${token.rawName} needs a value`, name);
    }
    if (option.values && !option.values.includes(value)) {
      throw usage(
        `${token.rawName} must be ${orList(option.values)}, not ${JSON.stringify(value)}`,
        name,
      );
    }
  }
  return { values: parsed.values as Values, files: parsed.positionals };
}

function orList(values: readonly string[]): string {
  return values.length < 3
    ? values.join(" or ")
    : `${values.slice(0, -1).join(", ")} or ${values[values.length - 1]}`;
}

function flag(values: Values, name: string): boolean {
  return values[name] === true;
}

function stringValue(values: Values, name: string): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

// Reading and writing

type Input = {
  /** As given on the command line, or `<stdin>`. */
  name: string;
  /** The absolute path, or null for standard input. */
  path: string | null;
  text: string;
};

async function readInput(io: Io, file: string): Promise<Input> {
  if (file === "-") {
    try {
      return { name: "<stdin>", path: null, text: await io.readStdin() };
    } catch (error) {
      throw fileFailure(error, "standard input", "read");
    }
  }
  const path = resolve(io.cwd, file);
  try {
    return { name: file, path, text: await io.readFile(path) };
  } catch (error) {
    throw fileFailure(error, file, "read");
  }
}

/** Every file is read before anything is written, so a missing one stops the command early. */
async function readInputs(io: Io, files: readonly string[]): Promise<Input[]> {
  const inputs: Input[] = [];
  for (const file of files) inputs.push(await readInput(io, file));
  return inputs;
}

async function writeOutput(io: Io, path: string, name: string, text: string): Promise<void> {
  try {
    await io.writeFile(path, text);
  } catch (error) {
    throw fileFailure(error, name, "write");
  }
}

/** Prints the text, or writes it to `--out` when one is given (`-` is standard output). */
async function output(io: Io, out: string | undefined, text: string): Promise<void> {
  if (out === undefined || out === "-") io.stdout(text);
  else await writeOutput(io, resolve(io.cwd, out), out, text);
}

/** A trailing line break for text that doesn't end with one, and nothing for no text. */
function asLines(text: string): string {
  return text === "" || text.endsWith("\n") ? text : `${text}\n`;
}

// check

type Problem = {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  level: "warning" | "info";
  code: string;
  message: string;
};

async function check({ io, values, files }: Context): Promise<number> {
  const inputs = await readInputs(io, files);
  const problems: Problem[] = [];
  for (const input of inputs) {
    const story = parse(input.text);
    const position = positions(input.text);
    const found = story.warnings.map((warning): Problem => {
      const end = position(warning.range.to);
      return {
        file: input.name,
        line: warning.line,
        column: warning.column,
        endLine: end.line,
        endColumn: end.column,
        level: warning.severity,
        code: warning.code,
        message: warning.message,
      };
    });
    found.sort((a, b) => a.line - b.line || a.column - b.column);
    problems.push(...found);
  }
  if (flag(values, "json")) {
    io.stdout(`${JSON.stringify(problems, null, 2)}\n`);
  } else {
    for (const p of problems) {
      io.stdout(`${p.file}:${p.line}:${p.column}  ${p.level}  ${p.code}  ${p.message}\n`);
    }
    io.stdout(`${summary(problems, inputs)}\n`);
  }
  const strict = flag(values, "strict");
  const failed = problems.some((p) => p.level === "warning" || (strict && p.level === "info"));
  return failed ? PROBLEMS : OK;
}

function summary(problems: readonly Problem[], inputs: readonly Input[]): string {
  const files = (count: number) =>
    inputs.length === 1
      ? (inputs[0]?.name ?? "")
      : count === inputs.length
        ? `${count} files`
        : `${count} of ${inputs.length} files`;
  if (problems.length === 0) return `No problems in ${files(inputs.length)}.`;
  const warnings = problems.filter((p) => p.level === "warning").length;
  const infos = problems.length - warnings;
  const counts = [
    warnings ? `${warnings} ${warnings === 1 ? "warning" : "warnings"}` : "",
    infos ? `${infos} info` : "",
  ].filter(Boolean);
  return `${counts.join(", ")} in ${files(new Set(problems.map((p) => p.file)).size)}.`;
}

/** 1-based line and column (UTF-16 code units) of an offset, as the core counts them. */
function positions(source: string): (offset: number) => { line: number; column: number } {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") starts.push(i + 1);
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((starts[middle] ?? 0) <= offset) low = middle;
      else high = middle - 1;
    }
    return { line: low + 1, column: offset - (starts[low] ?? 0) + 1 };
  };
}

// fmt

async function fmt({ io, values, files }: Context): Promise<number> {
  const checkOnly = flag(values, "check");
  // Standard input can't be written back, so it is printed.
  const print = flag(values, "stdout") || (!checkOnly && files.includes("-"));
  if (checkOnly && flag(values, "stdout")) {
    throw usage("--check and --stdout can't be used together", "fmt");
  }
  if (print && files.length > 1) {
    throw usage(
      files.includes("-") && !flag(values, "stdout")
        ? "- (standard input) is printed, so it can't be formatted with other files"
        : "--stdout takes one file",
      "fmt",
    );
  }
  const options: FormatOptions = {};
  if (flag(values, "no-names")) options.names = false;
  if (flag(values, "no-spacing")) options.spacing = false;
  const quotes = stringValue(values, "quotes");
  if (quotes === "curly" || quotes === "keep") options.quotes = quotes;
  const language = stringValue(values, "language");
  if (language !== undefined) options.language = language;

  const inputs = await readInputs(io, files);
  let changed = 0;
  for (const input of inputs) {
    const formatted = format(input.text, options);
    if (print) {
      io.stdout(formatted);
      continue;
    }
    // A file already formatted keeps its bytes and its modification time.
    if (formatted === input.text) continue;
    changed++;
    if (!checkOnly && input.path) await writeOutput(io, input.path, input.name, formatted);
    io.stdout(`${input.name}\n`);
  }
  return checkOnly && changed > 0 ? PROBLEMS : OK;
}

// render

async function renderCommand({ io, values, files }: Context): Promise<number> {
  const [input] = await readInputs(io, files);
  const story = parse(input?.text ?? "");
  const view: View = stringValue(values, "view") === "book" ? "book" : "script";
  const options: RenderOptions = {};
  if (flag(values, "pages")) options.pages = true;
  if (flag(values, "no-header")) options.header = false;
  const html = flag(values, "fragment")
    ? asLines(render(story, view, options))
    : renderDocument(story, view, options);
  await output(io, stringValue(values, "out"), html);
  return OK;
}

// export

async function exportCommand({ io, values, files }: Context): Promise<number> {
  const [input] = await readInputs(io, files);
  const story = parse(input?.text ?? "");
  const kind = stringValue(values, "format") ?? "json";
  const out = stringValue(values, "out");
  if (kind === "text") {
    await exportText(io, story, out);
    return OK;
  }
  if (out !== undefined && out !== "-" && (await wantsFolder(io, out))) {
    throw usage(`--out ${out} is a folder, but ${kind} is one file`, "export");
  }
  const rows = lines(story, { speechOnly: flag(values, "speech-only") });
  if (kind === "csv") {
    await output(io, out, linesToCsv(rows));
  } else {
    // The same rows, with the fields a reader looks for first.
    const json = rows.map(({ kind, speaker, direction, text, ...rest }) => ({
      kind,
      speaker,
      direction,
      text,
      ...rest,
    }));
    await output(io, out, `${JSON.stringify(json, null, 2)}\n`);
  }
  return OK;
}

/** What each character says: `== Name ==` sections, or one `Name.txt` each in a folder. */
async function exportText(io: Io, story: Story, out: string | undefined): Promise<void> {
  const said = textByCharacter(story);
  if (out !== undefined && out !== "-" && (await wantsFolder(io, out))) {
    const folder = resolve(io.cwd, out);
    for (const [name, text] of said) {
      const file = fileName(name);
      await writeOutput(io, join(folder, file), join(out, file), text);
    }
    return;
  }
  const sections = [...said].map(([name, text]) => `== ${name} ==\n${text}`);
  await output(io, out, sections.join("\n"));
}

/** An existing folder, or a path written as one, ending in a slash. */
async function wantsFolder(io: Io, out: string): Promise<boolean> {
  return /[/\\]$/.test(out) || (await io.isDirectory(resolve(io.cwd, out)));
}

/** A character's file. Names are one word (§5.2), but the narrator's can be anything. */
function fileName(name: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it removes
  const safe = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/^\.+/, "_") || "_";
  // Windows keeps these names for devices.
  return /^(?:con|prn|aux|nul|com\d|lpt\d)$/i.test(safe) ? `${safe}_.txt` : `${safe}.txt`;
}

// text

async function text({ io, values, files }: Context): Promise<number> {
  const book = flag(values, "book");
  const spoken = flag(values, "spoken");
  if (book === spoken) {
    throw usage(
      book ? "choose one of --book and --spoken" : "text needs --book or --spoken",
      "text",
    );
  }
  const [input] = await readInputs(io, files);
  const story = parse(input?.text ?? "");
  await output(
    io,
    stringValue(values, "out"),
    asLines(book ? bookText(story) : spokenScript(story)),
  );
  return OK;
}

// import

async function importCommand({ io, values, files }: Context): Promise<number> {
  const [input] = await readInputs(io, files);
  const story = fromFountain(input?.text ?? "", {
    readSceneHeadings: flag(values, "read-scene-headings"),
  });
  await output(io, stringValue(values, "out"), asLines(story));
  return OK;
}

// The commands

const OUT: Option = {
  type: "string",
  short: "o",
  value: "<file>",
  help: "Write to a file instead of standard output.",
};

const COMMANDS: Record<string, Command> = {
  check: {
    usage: "vxd check <files…> [--json] [--strict]",
    summary: "Report each file's warnings",
    about: [
      "Prints every warning in the files, one per line, then a summary:",
      "  file:line:column  level  code  message",
      "Fails when a file has a warning. Info, such as a cast member who never speaks, doesn't fail",
      "unless --strict is given. The codes are in the spec, §12.3.",
    ].join("\n"),
    examples: ["vxd check story.vxd", "vxd check chapters/*.vxd --json"],
    fails: "a file has a warning (or, with --strict, an info)",
    files: "many",
    options: {
      json: { type: "boolean", help: "Print the warnings as a JSON array instead." },
      strict: { type: "boolean", help: "Fail on info too." },
    },
    action: check,
  },
  fmt: {
    usage: "vxd fmt <files…> [--check] [--stdout] [--quotes curly] [--language xx] [--no-names]",
    summary: "Tidy files, without changing who says what",
    about: [
      "Formats each file in place and lists the files it changed. Spaces are trimmed and collapsed,",
      "runs of blank lines become one, headings and scene breaks get a blank line around them, and",
      "names are written as the cast spells them. Files already formatted are left untouched.",
    ].join("\n"),
    examples: [
      "vxd fmt story.vxd",
      "vxd fmt --check chapters/*.vxd",
      "vxd fmt story.vxd --quotes curly --stdout",
    ],
    fails: "--check found files to format",
    files: "many",
    options: {
      check: {
        type: "boolean",
        help: "Write nothing: list the files that would change, and fail if any would.",
      },
      stdout: { type: "boolean", help: "Print the formatted file instead (one file only)." },
      quotes: {
        type: "string",
        values: ["curly", "keep"],
        help: "curly turns straight quotation marks into curly ones. Default keep.",
      },
      language: {
        type: "string",
        value: "<xx>",
        help: "The language for curly quotes, such as en, de or fr. Default: the file's.",
      },
      "no-names": { type: "boolean", help: "Leave names as they are written." },
      "no-spacing": { type: "boolean", help: "Leave spaces and blank lines as they are." },
    },
    action: fmt,
  },
  render: {
    usage:
      "vxd render <file> [--view book|script] [--out file] [--fragment] [--pages] [--no-header]",
    summary: "Write a story as HTML, as a script or a book",
    about: [
      "Writes a whole HTML page with its stylesheet. The script view shows who says what, how, and",
      "every sound, pause and page turn; the book view is the printed story.",
    ].join("\n"),
    examples: ["vxd render story.vxd --out story.html", "vxd render story.vxd --view book --pages"],
    files: "one",
    options: {
      view: {
        type: "string",
        values: ["script", "book"],
        help: "The script for reading aloud (default), or the printed book.",
      },
      out: OUT,
      fragment: {
        type: "boolean",
        help: "Only the story's <article>, without the page around it or the stylesheet.",
      },
      pages: { type: "boolean", help: "Book view: show page numbers in the margin." },
      "no-header": { type: "boolean", help: "Leave out the title, author and cast." },
    },
    action: renderCommand,
  },
  export: {
    usage: "vxd export <file> [--format json|csv|text] [--speech-only] [--out file|dir]",
    summary: "The spoken script as JSON or CSV, or each character's lines",
    about: [
      "json (the default) and csv: one row per thing heard, with who says it, how, and the scene and",
      "page it is on. text: what each character says, one line per speech, under == Name ==; with",
      "--out naming a folder, one Name.txt per character instead.",
    ].join("\n"),
    examples: [
      "vxd export story.vxd --format csv --out lines.csv",
      "vxd export story.vxd --format text --out sides/",
    ],
    files: "one",
    options: {
      format: { type: "string", values: ["json", "csv", "text"], help: "Default json." },
      "speech-only": {
        type: "boolean",
        help: "Only what characters say: speech and the sounds they make.",
      },
      out: {
        ...OUT,
        value: "<file|dir>",
        help: "Write to a file, or with --format text to a folder (made if needed).",
      },
    },
    action: exportCommand,
  },
  text: {
    usage: "vxd text <file> --book|--spoken [--out file]",
    summary: "The book text or the spoken script, as plain text",
    about: [
      "--book prints the story as it is printed: plain Markdown without the marks. --spoken prints",
      "the spoken script: one line per thing heard, with its voice, as the spec's examples write it.",
    ].join("\n"),
    examples: ["vxd text story.vxd --book", "vxd text story.vxd --spoken --out script.txt"],
    files: "one",
    options: {
      book: { type: "boolean", help: "The book text." },
      spoken: { type: "boolean", help: "The spoken script." },
      out: OUT,
    },
    action: text,
  },
  import: {
    usage: "vxd import <file.fountain> [--out file] [--read-scene-headings]",
    summary: "Turn a Fountain screenplay into a VoxDown story",
    about: [
      "Character cues become marks, parentheticals directions, action narration, and scene headings",
      "hidden headings. The cast is gathered from the cues.",
    ].join("\n"),
    examples: ["vxd import script.fountain --out story.vxd"],
    files: "one",
    options: {
      out: OUT,
      "read-scene-headings": {
        type: "boolean",
        help: "Read scene headings aloud instead of keeping them as hidden labels.",
      },
    },
    action: importCommand,
  },
};

function commandNamed(name: string): Command {
  const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
  if (!command) throw usage(`unknown command ${JSON.stringify(name)}`);
  return command;
}

// Help

function generalHelp(): string {
  const commands = Object.entries(COMMANDS).map(([name, command]) => {
    const files = command.files === "one" ? "<file>" : "<files…>";
    return [`${name} ${files}`, command.summary] as const;
  });
  return [
    `vxd ${VERSION}: tools for VoxDown, a plain-text format for stories read aloud.`,
    "",
    "Usage: vxd <command> [options]",
    "",
    "Commands:",
    ...table(commands),
    "",
    "Options:",
    ...table([
      ["-h, --help", "Show this help, or a command's: vxd <command> --help"],
      ["-v, --version", "Show the versions of vxd and of the VoxDown spec"],
    ]),
    "",
    "Files are .vxd or .md, read as UTF-8; - reads standard input.",
    "Exit codes: 0 done, 1 problems found, 2 a usage error or a file that can't be read.",
    "",
  ].join("\n");
}

function commandHelp(command: Command): string {
  const options = Object.entries({ ...command.options, help: HELP }).map(([key, option]) => {
    const short = option.short ? `-${option.short}, ` : "";
    const value =
      option.type === "boolean" ? "" : ` ${option.value ?? option.values?.join("|") ?? "<value>"}`;
    return [`${short}--${key}${value}`, option.help] as const;
  });
  return [
    `Usage: ${command.usage}`,
    "",
    command.about,
    "",
    "Options:",
    ...table(options),
    "",
    command.examples.length > 1 ? "Examples:" : "Example:",
    ...command.examples.map((example) => `  ${example}`),
    "",
    "Files are .vxd or .md, read as UTF-8; - reads standard input.",
    `Exit codes: 0 done, ${command.fails ? `1 ${command.fails}, ` : ""}2 a usage error or a file that can't be read.`,
    "",
  ].join("\n");
}

function table(rows: ReadonlyArray<readonly [string, string]>): string[] {
  const width = Math.max(...rows.map(([left]) => left.length));
  return rows.map(([left, right]) => `  ${left.padEnd(width)}   ${right}`);
}
