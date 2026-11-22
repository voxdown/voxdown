/** Reading a MIDI file back, for tests. */
/** A MIDI file read back, for tests: its tracks' names and notes in ticks. */
export function readMidi(bytes: Uint8Array): {
  format: number;
  division: number;
  tempo: number;
  tracks: {
    name: string;
    notes: { tick: number; pitch: number; velocity: number; length: number }[];
  }[];
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const format = view.getUint16(8);
  const count = view.getUint16(10);
  const division = view.getUint16(12);
  let at = 14;
  let tempo = 500_000;
  const tracks: ReturnType<typeof readMidi>["tracks"] = [];
  for (let index = 0; index < count; index++) {
    const length = view.getUint32(at + 4);
    let position = at + 8;
    const end = position + length;
    let tick = 0;
    let status = 0;
    let name = "";
    const open = new Map<number, { tick: number; velocity: number }>();
    const notes: { tick: number; pitch: number; velocity: number; length: number }[] = [];
    const readVariable = () => {
      let value = 0;
      for (;;) {
        const byte = bytes[position++] as number;
        value = (value << 7) | (byte & 0x7f);
        if (!(byte & 0x80)) return value;
      }
    };
    while (position < end) {
      tick += readVariable();
      let byte = bytes[position] as number;
      if (byte & 0x80) {
        status = byte;
        position++;
      } else byte = status;
      if (status === 0xff) {
        const type = bytes[position++] as number;
        const size = readVariable();
        const data = bytes.subarray(position, position + size);
        if (type === 0x03) name = new TextDecoder().decode(data);
        if (type === 0x51)
          tempo = ((data[0] as number) << 16) | ((data[1] as number) << 8) | (data[2] as number);
        position += size;
      } else if ((status & 0xf0) === 0x90 || (status & 0xf0) === 0x80) {
        const pitch = bytes[position++] as number;
        const velocity = bytes[position++] as number;
        if ((status & 0xf0) === 0x90 && velocity > 0) open.set(pitch, { tick, velocity });
        else {
          const started = open.get(pitch);
          if (started)
            notes.push({
              tick: started.tick,
              pitch,
              velocity: started.velocity,
              length: tick - started.tick,
            });
          open.delete(pitch);
        }
      } else if ((status & 0xf0) === 0xc0 || (status & 0xf0) === 0xd0) position += 1;
      else position += 2;
    }
    notes.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
    tracks.push({ name, notes });
    at = end;
  }
  return { format, division, tempo, tracks };
}
