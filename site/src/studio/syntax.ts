import type { Text } from "@codemirror/state";
import { type FountainDocument, parseFountain } from "./fountain";

// CodeMirror Text is immutable. Selection/decorations reuse it; edits get a new identity.
// Weak keys release abandoned documents without retaining a second screenplay history.
const parsed = new WeakMap<Text, FountainDocument>();
export function parsedSource(source: Text): FountainDocument {
  const known = parsed.get(source);
  if (known) return known;
  const result = parseFountain(source.toString());
  parsed.set(source, result);
  return result;
}
export function rememberParsedSource(source: Text, result: FountainDocument): void {
  parsed.set(source, result);
}
