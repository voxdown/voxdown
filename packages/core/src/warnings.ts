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
