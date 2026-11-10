/**
 * The core's warnings (SPEC.md §12.3) as VS Code diagnostics are made. This module doesn't import
 * `vscode`, so it can be tested on its own; the extension turns each entry into a
 * `vscode.Diagnostic`.
 */
import { type Warning, type WarningCode, parse } from "voxdown";

/** A place in a document as VS Code counts it: 0-based lines, and UTF-16 code units in the line. */
export type Position = { line: number; character: number };

export type DiagnosticInfo = {
  code: WarningCode;
  severity: "warning" | "information";
  message: string;
  start: Position;
  end: Position;
};

/** The source VS Code shows next to each diagnostic. */
export const DIAGNOSTIC_SOURCE = "voxdown";

/** The warnings for a document's text. */
export function diagnose(text: string): DiagnosticInfo[] {
  return toDiagnostics(text, parse(text).warnings);
}

export function toDiagnostics(text: string, warnings: readonly Warning[]): DiagnosticInfo[] {
  const at = positions(text);
  return warnings.map((warning) => ({
    code: warning.code,
    severity: warning.severity === "info" ? "information" : "warning",
    message: warning.message,
    start: at(warning.range.from),
    end: at(Math.max(warning.range.from, warning.range.to)),
  }));
}

/** Turns UTF-16 offsets into positions. Lines end at LF or CRLF; a CR is never inside a line. */
function positions(text: string): (offset: number) => Position {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return (offset) => {
    const clamped = Math.min(Math.max(offset, 0), text.length);
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((starts[middle] ?? 0) <= clamped) low = middle;
      else high = middle - 1;
    }
    const from = starts[low] ?? 0;
    const next = starts[low + 1];
    let end = next === undefined ? text.length : next - 1;
    if (end > from && text[end - 1] === "\r") end--;
    return { line: low, character: Math.min(clamped, end) - from };
  };
}
