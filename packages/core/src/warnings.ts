import type { Warning, WarningCode } from "./model";
import type { Range, SourceText } from "./source";

/** Reports a warning. A parser never rejects a file (§12.3). */
export type Warn = (
  code: WarningCode,
  message: string,
  range: Range,
  severity?: Warning["severity"],
) => void;

export function collectWarnings(text: SourceText): { list: Warning[]; warn: Warn } {
  const list: Warning[] = [];
  const warn: Warn = (code, message, range, severity = "warning") => {
    list.push({ code, severity, message, range, ...text.position(range.from) });
  };
  return { list, warn };
}

/** Names after a `+` are reserved for a later version (§5.10): the speaker says it with others. */
export function warnOthers(warn: Warn, speaker: string, range: Range): void {
  warn(
    "together-names",
    `Naming who else says it comes in a later version of VoxDown: for now, ${speaker} says it together with others.`,
    range,
    "info",
  );
}
