/** A bounded, portable filename stem; never a path. */
export function filenameStem(value: string): string {
  const cleaned = [...value]
    .map((char) =>
      char.charCodeAt(0) < 32 ||
      char.charCodeAt(0) === 127 ||
      /[<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/.test(char)
        ? "-"
        : char,
    )
    .join("")
    .replace(/\.(?:fountain|txt|studio\.json)$/i, "")
    .replace(/^[. ]+|[. ]+$/g, "");
  let base = "";
  let bytes = 0;
  const encoder = new TextEncoder();
  for (const char of cleaned) {
    bytes += encoder.encode(char).length;
    if (bytes > 180 || base.length + char.length > 120) break;
    base += char;
  }
  base = base.replace(/[. ]+$/g, "");
  const safe = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base) ? `_${base}` : base;
  return safe || "Untitled";
}
