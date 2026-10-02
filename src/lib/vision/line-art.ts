/**
 * The scanned object as white line art: its silhouette as a bold outline and
 * its surface as flowing contour lines, centred on a square. The lines are the
 * level lines of a field mixing the distance from the outline (so they follow
 * the shape) with the object's smoothed shading (so they bend with its look).
 *
 * Pure pixel maths (no canvas) apart from `objectLineArt`, which encodes a PNG.
 */

type Pixels = { data: Uint8ClampedArray; width: number; height: number };

export type LineArtOptions = {
  /** Output side in pixels. */
  size?: number;
  /** Contour lines across the field. */
  levels?: number;
};

/** Box blur, in place, over a size x size grid (edges clamp). */
function boxBlur(src: Float32Array, size: number, radius: number) {
  const tmp = new Float32Array(src.length);
  const span = 2 * radius + 1;
  for (let y = 0; y < size; y++) {
    const row = y * size;
    let acc = 0;
    for (let k = -radius; k <= radius; k++) acc += src[row + Math.min(size - 1, Math.max(0, k))];
    for (let x = 0; x < size; x++) {
      tmp[row + x] = acc / span;
      acc += src[row + Math.min(size - 1, x + radius + 1)] - src[row + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < size; x++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) acc += tmp[Math.min(size - 1, Math.max(0, k)) * size + x];
    for (let y = 0; y < size; y++) {
      src[y * size + x] = acc / span;
      acc += tmp[Math.min(size - 1, y + radius + 1) * size + x] - tmp[Math.max(0, y - radius) * size + x];
    }
  }
}

/** Distance (pixels) from each inside pixel to the outside, by a two-pass chamfer; 0 outside. */
function insideDistance(inside: Uint8Array, size: number) {
  const INF = 1e9;
  const d = new Float32Array(inside.length);
  for (let i = 0; i < d.length; i++) d[i] = inside[i] ? INF : 0;
  const D = Math.SQRT2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      else v = Math.min(v, 1);
      if (y > 0) {
        v = Math.min(v, d[i - size] + 1);
        if (x > 0) v = Math.min(v, d[i - size - 1] + D);
        if (x < size - 1) v = Math.min(v, d[i - size + 1] + D);
      } else v = Math.min(v, 1);
      d[i] = v;
    }
  for (let y = size - 1; y >= 0; y--)
    for (let x = size - 1; x >= 0; x--) {
      const i = y * size + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x < size - 1) v = Math.min(v, d[i + 1] + 1);
      else v = Math.min(v, 1);
      if (y < size - 1) {
        v = Math.min(v, d[i + size] + 1);
        if (x < size - 1) v = Math.min(v, d[i + size + 1] + D);
        if (x > 0) v = Math.min(v, d[i + size - 1] + D);
      } else v = Math.min(v, 1);
      d[i] = v;
    }
  return d;
}

/** Keeps only the largest connected piece of a 0/1 mask (in place); returns its area. */
function keepLargest(inside: Float32Array, size: number) {
  const label = new Int32Array(inside.length);
  const stack: number[] = [];
  let best = 0;
  let bestArea = 0;
  let next = 0;
  for (let start = 0; start < inside.length; start++) {
    if (!inside[start] || label[start]) continue;
    next++;
    let area = 0;
    label[start] = next;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      area++;
      const x = i % size;
      const around = [x > 0 ? i - 1 : -1, x < size - 1 ? i + 1 : -1, i - size, i + size];
      for (const j of around)
        if (j >= 0 && j < inside.length && inside[j] && !label[j]) {
          label[j] = next;
          stack.push(j);
        }
    }
    if (area > bestArea) {
      bestArea = area;
      best = next;
    }
  }
  for (let i = 0; i < inside.length; i++) if (label[i] !== best) inside[i] = 0;
  return bestArea;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Line-art coverage (0-255 per pixel, row-major size x size) of the object
 * inside `mask` (one byte per image pixel, non-zero = object). Null when the
 * mask is empty.
 */
export function lineArtAlpha(img: Pixels, mask: Uint8Array, options: LineArtOptions = {}): Uint8ClampedArray | null {
  const S = options.size ?? 512;
  const levels = options.levels ?? 8;
  const { width: W, height: H, data } = img;

  // The object's bounds, and a square crop around them with some air.
  let x0 = W,
    y0 = H,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (mask[y * W + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  const side = Math.max(x1 - x0 + 1, y1 - y0 + 1) * 1.18;
  const cx = (x0 + x1 + 1) / 2;
  const cy = (y0 + y1 + 1) / 2;
  const scale = side / S;

  // Resample the object (luminance) and its mask onto the output square.
  const lum = new Float32Array(S * S);
  const soft = new Float32Array(S * S);
  for (let v = 0; v < S; v++)
    for (let u = 0; u < S; u++) {
      const x = Math.round(cx + (u + 0.5 - S / 2) * scale - 0.5);
      const y = Math.round(cy + (v + 0.5 - S / 2) * scale - 0.5);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = y * W + x;
      const o = v * S + u;
      soft[o] = mask[i] ? 1 : 0;
      lum[o] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    }

  // Stray specks of the mask would draw as islands: only the largest piece stays.
  if (!keepLargest(soft, S)) return null;

  // A rounder, calmer silhouette: blur the mask and cut it at one half.
  const r = Math.max(2, Math.round(S / 64));
  boxBlur(soft, S, r);
  boxBlur(soft, S, r);
  const inside = new Uint8Array(S * S);
  let area = 0;
  for (let i = 0; i < inside.length; i++)
    if (soft[i] >= 0.5) {
      inside[i] = 1;
      area++;
    }
  if (!area) return null;
  const dist = insideDistance(inside, S);
  let dMax = 0;
  for (let i = 0; i < dist.length; i++) if (dist[i] > dMax) dMax = dist[i];

  // Shading, smoothed within the object only (normalized convolution).
  const weight = new Float32Array(S * S);
  for (let i = 0; i < lum.length; i++) {
    weight[i] = inside[i];
    lum[i] *= inside[i];
  }
  const rl = Math.max(3, Math.round(S / 40));
  for (let k = 0; k < 3; k++) {
    boxBlur(lum, S, rl);
    boxBlur(weight, S, rl);
  }
  const shades: number[] = [];
  for (let i = 0; i < lum.length; i++) {
    lum[i] = weight[i] > 1e-3 ? lum[i] / weight[i] : 0;
    if (inside[i] && i % 7 === 0) shades.push(lum[i]);
  }
  shades.sort((a, b) => a - b);
  const lo = shades[Math.floor(shades.length * 0.05)] ?? 0;
  const hi = shades[Math.floor(shades.length * 0.95)] ?? 255;
  const range = Math.max(8, hi - lo);

  // Centre of the object, for a gentle swirl around it.
  let mx = 0,
    my = 0;
  for (let i = 0; i < inside.length; i++)
    if (inside[i]) {
      mx += i % S;
      my += (i / S) | 0;
    }
  mx /= area;
  my /= area;

  // The field whose level lines are drawn: rings following the outline, bent by
  // the object's shading and a slow twist so they weave like a drawn ribbon.
  const field = new Float32Array(S * S);
  for (let i = 0; i < field.length; i++) {
    if (!inside[i]) continue;
    const dn = dist[i] / dMax;
    const ln = clamp01((lum[i] - lo) / range);
    const dx = (i % S) - mx;
    const dy = ((i / S) | 0) - my;
    // The twist fades out towards the centre, where the angle has no meaning.
    const hub = clamp01(Math.hypot(dx, dy) / (0.6 * dMax));
    const twist = Math.sin(3 * Math.atan2(dy, dx) + 7 * dn) * 0.07 * hub * hub;
    field[i] = (0.72 * dn + 0.28 * ln + twist) * levels;
  }

  const outline = S / 42;
  const stroke = S / 95;
  const edgeSlope = 2 * r + 1; // pixels per unit of the twice-blurred mask, roughly
  const out = new Uint8ClampedArray(S * S);
  for (let y = 1; y < S - 1; y++)
    for (let x = 1; x < S - 1; x++) {
      const i = y * S + x;
      // Anti-aliased outer edge from the blurred mask.
      const edge = clamp01((soft[i] - 0.5) * edgeSlope + 0.5);
      if (!edge) continue;
      const d = dist[i];
      const border = clamp01(outline - d + 0.5);
      let line = 0;
      if (d > outline) {
        const t = field[i];
        const gx = (field[i + 1] - field[i - 1]) / 2;
        const gy = (field[i + S] - field[i - S]) / 2;
        const grad = Math.max(1e-3, Math.hypot(gx, gy));
        const toLevel = Math.abs(t - Math.round(t)) / grad;
        // Lines fade in away from the outline so they never merge into it.
        line = clamp01(stroke / 2 + 0.5 - toLevel) * clamp01(d - outline - stroke * 1.5);
      }
      out[i] = Math.round(255 * edge * Math.max(border, line));
    }
  return out;
}

/** The object as a white line-art PNG (data URL) on a transparent square; "" when the mask is empty. */
export function objectLineArt(img: ImageData, mask: Uint8Array, options: LineArtOptions = {}): string {
  const size = options.size ?? 512;
  const alpha = lineArtAlpha(img, mask, { ...options, size });
  if (!alpha) return "";
  const pixels = new ImageData(size, size);
  for (let i = 0; i < alpha.length; i++) {
    const o = i * 4;
    pixels.data[o] = pixels.data[o + 1] = pixels.data[o + 2] = 255;
    pixels.data[o + 3] = alpha[i];
  }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  canvas.getContext("2d")!.putImageData(pixels, 0, 0);
  return canvas.toDataURL("image/png");
}
