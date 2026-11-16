/*
 * Where the ink ends. The pencil's marks are pictures (a ring, an underline, an arrow) or words,
 * revealed by a mask or a clip; the pencil's lead is put on the very end of what that reveal shows,
 * read from the picture's (or the words') own ink, so the lead never runs ahead of the line.
 */

/** A picture's ink: its alpha, a byte per pixel, and the middle of the ink in each column. */
export type Ink = {
  w: number;
  h: number;
  a: Uint8ClampedArray;
  mid?: Float32Array;
  mass?: Float32Array;
  rows?: Float32Array;
  peak?: Uint8Array;
};

const pictures = new Map<string, Promise<Ink | undefined>>();
const INKED = 60;

function inkFrom(canvas: HTMLCanvasElement): Ink {
  const context = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const a = new Uint8ClampedArray(canvas.width * canvas.height);
  for (let i = 0; i < a.length; i++) a[i] = data[i * 4 + 3] as number;
  return { w: canvas.width, h: canvas.height, a };
}

/** A picture's ink, read once (it is the same file the page shows, so it comes from the cache). */
export function inkOf(url: string): Promise<Ink | undefined> {
  let ink = pictures.get(url);
  if (!ink) {
    ink = (async () => {
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        (canvas.getContext("2d") as CanvasRenderingContext2D).drawImage(image, 0, 0);
        return inkFrom(canvas);
      } catch {
        return undefined;
      }
    })();
    pictures.set(url, ink);
  }
  return ink;
}

const alpha = (ink: Ink, x: number, y: number) =>
  ink.a[Math.min(ink.h - 1, Math.max(0, y | 0)) * ink.w + Math.min(ink.w - 1, Math.max(0, x | 0))] as number;

/**
 * The middle of the ink in each column, and how much ink the column holds against the picture's
 * typical column: a thin wisp that all but vanishes once the picture is drawn small doesn't count
 * as the end of the line.
 */
function middles(ink: Ink): { mid: Float32Array; mass: Float32Array; rows: Float32Array; peak: Uint8Array } {
  if (ink.mid && ink.mass && ink.rows && ink.peak)
    return { mid: ink.mid, mass: ink.mass, rows: ink.rows, peak: ink.peak };
  const mid = new Float32Array(ink.w).fill(-1);
  const mass = new Float32Array(ink.w);
  const rows = new Float32Array(ink.w);
  const peak = new Uint8Array(ink.w);
  for (let x = 0; x < ink.w; x++) {
    let sum = 0;
    let weight = 0;
    let top = 0;
    for (let y = 0; y < ink.h; y++) {
      const v = ink.a[y * ink.w + x] as number;
      if (v > top) top = v;
      if (v > INKED) {
        sum += y * v;
        weight += v;
      }
    }
    if (weight) mid[x] = sum / weight;
    mass[x] = weight;
    // How many rows deep the ink is in this column, counting faint rows as part of one.
    rows[x] = weight / 255;
    peak[x] = top;
  }
  ink.rows = rows;
  ink.peak = peak;
  const inked = [...mass].filter((m) => m > 0).sort((p, q) => p - q);
  const typical = inked[Math.floor(inked.length / 2)] ?? 1;
  for (let x = 0; x < ink.w; x++) mass[x] = (mass[x] as number) / typical;
  ink.mid = mid;
  ink.mass = mass;
  return { mid, mass, rows, peak };
}

/**
 * Revealed from the left up to `upTo` (0 to 1 across): the last column with ink in what shows (at
 * least `least` of a typical column's), and the middle of the ink there, as fractions of the
 * picture. Before any ink shows, its first ink.
 */
export function inkEnd(
  ink: Ink,
  upTo: number,
  least: number | ((x: number) => boolean) = 0.4,
  band = 1,
): [number, number] {
  const { mid, mass } = middles(ink);
  const shows = typeof least === "number" ? (x: number) => (mass[x] as number) >= least : least;
  const last = Math.min(ink.w - 1, Math.floor(upTo * ink.w));
  for (let x = last; x >= 0; x--)
    if (shows(x)) {
      // The middle of the ink across the last `band` columns: the sliver that shows at the end.
      let sum = 0;
      let weight = 0;
      for (let c = x; c > x - band && c >= 0; c--)
        if ((mid[c] as number) >= 0) {
          sum += (mid[c] as number) * (mass[c] as number);
          weight += mass[c] as number;
        }
      return [(x + 0.5) / ink.w, (weight ? sum / weight : (mid[x] as number)) / ink.h];
    }
  for (let x = 0; x < ink.w; x++)
    if (shows(x)) return [(x + 0.5) / ink.w, (mid[x] as number) / ink.h];
  return [0, 0.5];
}

/**
 * A picture drawn `drawnHeight` CSS px tall, shown from the left up to `upTo`: the end of the ink
 * that actually shows on this screen. A column counts when its ink, scaled to the size it is
 * drawn at, covers at least about a third of a device pixel: a picture's thin, tapering end
 * shows on a sharp screen and all but vanishes at one pixel per CSS pixel.
 */
export function pictureEnd(ink: Ink, upTo: number, drawnHeight: number): [number, number] {
  const { rows } = middles(ink);
  const perRow = (drawnHeight * window.devicePixelRatio) / ink.h;
  return inkEnd(ink, upTo, (x) => (rows[x] as number) * perRow >= 0.35);
}

/**
 * A ring revealed by a conic mask from the box's centre: where the mask's edge, at `deg` clockwise
 * from twelve o'clock, crosses the ring's ink in a box `w`×`h` px (the picture stretched to fill it).
 * The middle of the thickest crossing, in px from the box's top left.
 */
export function ringEnd(
  ink: Ink,
  w: number,
  h: number,
  deg: number,
  back = true,
): [number, number] {
  const reach = Math.hypot(w, h) / 2;
  // Where a ray finds no ink (a gap in the hand-drawn loop), the end is just behind: the ink
  // already shown.
  for (const nudge of [0, -0.25, -0.5, -0.75, -1, -1.5, -2, -2.5, -3, -4, -5, -6]) {
    const t = ((deg + nudge) * Math.PI) / 180;
    const sx = Math.sin(t);
    const sy = -Math.cos(t);
    let best: [number, number] | undefined;
    let from = -1;
    for (let r = 0; r <= reach; r += 0.25) {
      const x = w / 2 + r * sx;
      const y = h / 2 + r * sy;
      if (x < 0 || y < 0 || x >= w || y >= h) break;
      const on = alpha(ink, (x / w) * ink.w, (y / h) * ink.h) > INKED;
      if (on && from < 0) from = r;
      if ((!on || r + 0.25 > reach) && from >= 0) {
        if (!best || r - from > best[1] - best[0]) best = [from, r];
        from = -1;
      }
    }
    if (best) {
      const r = (best[0] + best[1]) / 2;
      // The mask's edge is softened over about a pixel: the last ink that shows is that far
      // behind it, round the ring.
      const here: [number, number] = [w / 2 + r * sx, h / 2 + r * sy];
      if (back) {
        // A step back of about 1.2 px along the stroke, whatever the angle the edge meets it at.
        const probe = ringEnd(ink, w, h, deg + nudge - 0.3, false);
        const moved = Math.hypot(probe[0] - here[0], probe[1] - here[1]);
        const step = moved > 0.05 ? Math.min(3, (0.3 * 1.2) / moved) : 0;
        return step ? ringEnd(ink, w, h, deg + nudge - step, false) : here;
      }
      return here;
    }
  }
  return [w / 2, h / 2];
}

/**
 * Words as ink: the element's own text drawn in its own font, so the lead can sit on the end of the
 * letters a clip has shown. Coordinates are the element's own CSS px (before any transform).
 */
export type Words = { ink: Ink; scale: number; width: number };
export function wordsOf(el: HTMLElement): Words {
  const style = getComputedStyle(el);
  const scale = 3;
  const box = el.getBoundingClientRect();
  const width = el.offsetWidth || box.width;
  const height = el.offsetHeight || box.height;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width * scale));
  canvas.height = Math.max(1, Math.ceil(height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  context.scale(scale, scale);
  // Built from its parts: the computed shorthand carries a line height canvas may not take.
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  // The baseline, exactly as the line lays it out: the font's ascent and descent centred in the
  // line's height (a zero-height box on the baseline would give it only to the whole pixel).
  const metrics = context.measureText(el.textContent ?? "");
  const lineHeight = Number.parseFloat(style.lineHeight);
  let baseline: number;
  if (Number.isFinite(lineHeight)) {
    const ascent = metrics.fontBoundingBoxAscent;
    const descent = metrics.fontBoundingBoxDescent;
    baseline = (Number.parseFloat(style.paddingTop) || 0) + (lineHeight - ascent - descent) / 2 + ascent;
  } else {
    const probe = document.createElement("span");
    probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
    el.append(probe);
    baseline = probe.offsetTop - el.offsetTop;
    probe.remove();
  }
  if ("letterSpacing" in context && style.letterSpacing !== "normal")
    (context as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
      style.letterSpacing;
  context.textBaseline = "alphabetic";
  context.fillStyle = "#000";
  context.fillText(el.textContent ?? "", Number.parseFloat(style.paddingLeft) || 0, baseline);
  return { ink: inkFrom(canvas), scale, width };
}

/** Words shown up to `upTo` (0 to 1 of the element's width): the end of their ink, in its CSS px. */
export function wordsEnd(words: Words, upTo: number): [number, number] {
  const [u, v] = inkEnd(
    words.ink,
    Math.min(1, (upTo * words.width * words.scale) / words.ink.w),
    // A letter's first sliver shows sooner on a sharp screen.
    window.devicePixelRatio >= 2 ? 0.05 : 0.15,
    words.scale,
  );
  return [(u * words.ink.w) / words.scale, (v * words.ink.h) / words.scale];
}
