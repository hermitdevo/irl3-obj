/**
 * A compact color signature of the object's pixels: hue x saturation bins for
 * colorful pixels, plus a few brightness bins for gray and dark pixels.
 * Hue is fairly stable under lighting changes, which makes this a strong cue
 * for plain objects (a yellow banana is not a pink banana).
 */

const HUE_BINS = 12;
const BINS = 1 + 3 + HUE_BINS * 2;

export function colorSignature(image: ImageData, mask: Uint8Array): Float32Array {
  const hist = new Float32Array(BINS);
  const d = image.data;
  let n = 0;
  for (let i = 0; i < mask.length; i += 2) {
    if (!mask[i]) continue;
    const r = d[i * 4] / 255;
    const g = d[i * 4 + 1] / 255;
    const b = d[i * 4 + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const v = max;
    const s = max > 0 ? (max - min) / max : 0;
    let bin: number;
    if (v < 0.15) bin = 0;
    else if (s < 0.2) bin = v < 0.45 ? 1 : v < 0.75 ? 2 : 3;
    else {
      let h: number;
      const c = max - min;
      if (max === r) h = ((g - b) / c + 6) % 6;
      else if (max === g) h = (b - r) / c + 2;
      else h = (r - g) / c + 4;
      const hue = Math.min(HUE_BINS - 1, Math.floor((h / 6) * HUE_BINS));
      bin = 4 + hue * 2 + (s < 0.55 ? 0 : 1);
    }
    hist[bin]++;
    n++;
  }
  if (n) for (let k = 0; k < BINS; k++) hist[k] /= n;
  return hist;
}

/** Histogram intersection: 1 = identical color distribution, 0 = nothing in common. */
export function colorSimilarity(a: Float32Array, b: Float32Array) {
  let s = 0;
  for (let k = 0; k < a.length; k++) s += Math.min(a[k], b[k]);
  return s;
}
