import { filenameStem } from "./filename";
import { readSource } from "./source";

/** Portable backups carry content, never browser recovery identifiers or executable settings. */
export const PROJECT_FORMAT = "voxdown-studio-project";
export const PROJECT_VERSION = 1;
export const MAX_PROJECT_BYTES = 16_000_000;
export const MAX_PROJECT_CHARACTERS = 2_000_000;
export const MAX_PROJECT_SNAPSHOTS = 50;
export const MAX_PROJECT_NAME = 200;
export type ProjectDraft = { name: string; source: string };
export type ProjectSnapshot = ProjectDraft & { created: number };
export type StudioProject = {
  format: typeof PROJECT_FORMAT;
  version: typeof PROJECT_VERSION;
  draft: ProjectDraft;
  snapshots: ProjectSnapshot[];
};

function invalid(detail: string): never {
  throw new Error(`This Studio backup cannot be opened: ${detail}`);
}

/** No coercion, inherited fields, accessors, or unexpected keys cross the format boundary. */
function fields(
  value: unknown,
  expected: readonly string[],
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    invalid(`${label} must be an object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    invalid(`${label} must be a plain object.`);
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expected.length ||
    keys.some((key) => typeof key !== "string" || !expected.includes(key))
  )
    invalid(`${label} has missing or unsupported fields.`);
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
      invalid(`${label} contains an unsupported property.`);
  }
  return value as Record<string, unknown>;
}
function control(char: string): boolean {
  return char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127;
}
function name(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > MAX_PROJECT_NAME ||
    [...value].some(control)
  )
    invalid(
      `${label} needs a name of 1–${MAX_PROJECT_NAME} characters without control characters.`,
    );
  return value;
}
function source(value: unknown, label: string, budget: { characters: number }): string {
  if (typeof value !== "string") invalid(`${label} source must be text.`);
  try {
    budget.characters += readSource(value).normalized.length;
  } catch (error) {
    invalid(`${label}: ${error instanceof Error ? error.message : "invalid screenplay source."}`);
  }
  if (budget.characters > MAX_PROJECT_CHARACTERS)
    invalid("the draft and snapshots exceed 2,000,000 combined screenplay characters.");
  return value;
}
function validate(value: unknown): StudioProject {
  const root = fields(value, ["format", "version", "draft", "snapshots"], "Backup");
  if (root.format !== PROJECT_FORMAT) invalid("this is not a VoxDown Studio project.");
  if (root.version !== PROJECT_VERSION)
    invalid("this backup version is unsupported. Open it with a compatible version of Studio.");
  const draft = fields(root.draft, ["name", "source"], "Draft");
  const budget = { characters: 0 };
  const validatedDraft = {
    name: name(draft.name, "Draft"),
    source: source(draft.source, "Draft", budget),
  };
  if (!Array.isArray(root.snapshots) || root.snapshots.length > MAX_PROJECT_SNAPSHOTS)
    invalid(`snapshots must be a list of at most ${MAX_PROJECT_SNAPSHOTS} entries.`);
  if (
    Object.getPrototypeOf(root.snapshots) !== Array.prototype ||
    Reflect.ownKeys(root.snapshots).length !== root.snapshots.length + 1
  )
    invalid("snapshots must be a plain list without extra properties.");
  const snapshots: ProjectSnapshot[] = [];
  for (let index = 0; index < root.snapshots.length; index++) {
    const label = `Snapshot ${index + 1}`;
    const entry = Object.getOwnPropertyDescriptor(root.snapshots, String(index));
    if (!entry || !("value" in entry) || !entry.enumerable)
      invalid(`${label} must be a plain object in the snapshot list.`);
    const snapshot = fields(entry.value, ["name", "source", "created"], label);
    if (
      typeof snapshot.created !== "number" ||
      !Number.isSafeInteger(snapshot.created) ||
      snapshot.created < 0 ||
      snapshot.created > 8_640_000_000_000_000
    )
      invalid(`${label} has an invalid creation time.`);
    snapshots.push({
      name: name(snapshot.name, label),
      source: source(snapshot.source, label, budget),
      created: snapshot.created,
    });
  }
  return { format: PROJECT_FORMAT, version: PROJECT_VERSION, draft: validatedDraft, snapshots };
}
function boundedJSON(text: string): void {
  // The first check avoids allocating a UTF-8 buffer for an already oversized string.
  if (text.length > MAX_PROJECT_BYTES || new TextEncoder().encode(text).length > MAX_PROJECT_BYTES)
    invalid("the backup exceeds the 16 MB file limit.");
}

/** Supply content fields only; recovery ids are deliberately excluded from the portable format. */
export function createProject(
  draft: ProjectDraft,
  snapshots: readonly ProjectSnapshot[] = [],
): StudioProject {
  return validate({ format: PROJECT_FORMAT, version: PROJECT_VERSION, draft, snapshots });
}
export function serializeProject(project: StudioProject): string {
  const text = `${JSON.stringify(validate(project), null, 2)}\n`;
  boundedJSON(text);
  return text;
}
/** Pure validation: callers decide whether/where to save the fully validated result. */
export function parseProject(text: string): StudioProject {
  if (typeof text !== "string") invalid("the backup must be a JSON text file.");
  boundedJSON(text);
  let value: unknown;
  try {
    value = JSON.parse(text.startsWith("\uFEFF") ? text.slice(1) : text);
  } catch {
    invalid("the file is not valid JSON.");
  }
  return validate(value);
}
/** A single cross-platform filename, independent of paths or the screenplay's extension. */
export function projectName(value: string): string {
  return `${filenameStem(value)}.studio.json`;
}
