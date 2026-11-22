/** A MIDI file, by its name or its header ("MThd", or RIFF-wrapped). */
export function isMidiFile(name: string, bytes: Uint8Array): boolean {
  if (/\.(mid|midi|kar|rmi)$/i.test(name)) return true;
  const head = String.fromCharCode(...bytes.subarray(0, 4));
  return (
    head === "MThd" || (head === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "RMID")
  );
}

/** Telling a MusicXML score from ABC text, cheaply, before the converter is loaded. */
export function isScoreFile(name: string, bytes: Uint8Array): boolean {
  if (/\.(musicxml|mxl)$/i.test(name)) return true;
  // A zip (an .mxl under another name), or XML whose root is a MusicXML score.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4) return true;
  const head = new TextDecoder().decode(bytes.subarray(0, 4096));
  return /\.xml$/i.test(name) || /<score-(partwise|timewise)\b/.test(head);
}
