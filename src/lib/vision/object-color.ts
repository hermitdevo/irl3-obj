/**
 * The main colour of an object, as a plain name (orange, blue, black…): the
 * largest colour cluster of the pixels inside its mask, named in CIE LCh.
 * Pure pixel maths, the same in the browser and in Node.
 */

type Pixels = { data: Uint8ClampedArray | Uint8Array; width: number; height: number };

export type ObjectColor = {
  /** Plain colour name. */
  name: string;
  /** The cluster's average colour, #rrggbb. */
  hex: string;
  /** Share of the object's pixels in that colour (0-1). */
  share: number;
};

function srgbToLinear(c: number) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** sRGB (0-255) to CIE Lab (D65). */
export function toLab(r: number, g: number, b: number): [number, number, number] {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (t * 24389) / 27 / 116 + 16 / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/**
 * A plain name for a colour in Lab, by its LCh hue. CIELAB hues (not HSV
 * ones): red sits near 40°, orange near 60°, yellow near 95°, green 135°,
 * cyan 200°, blue 280°, purple 315°, and pinks/magentas from about 335°
 * through 0° to 15°.
 */
export function colorName(L: number, a: number, b: number): string {
  const C = Math.hypot(a, b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  if (C < 10) {
    if (L < 22) return "black";
    if (L > 82) return "white";
    return L > 60 ? "silver" : "gray";
  }
  if (L < 18) return "black";
  // Dark, weak oranges and reds read as brown; muted yellows as gold/beige.
  if (h >= 30 && h < 75 && L < 52 && C < 55) return "brown";
  if (h >= 60 && h < 105 && C < 35) return L > 70 ? "beige" : "gold";
  if (h >= 335 || h < 15) return "pink";
  if (h < 50) return L > 65 && C < 45 ? "pink" : "red";
  if (h < 75) return "orange";
  if (h < 105) return "yellow";
  if (h < 170) return "green";
  if (h < 225) return "teal";
  if (h < 295) return "blue";
  return "purple";
}

/** Skin-like colour (YCbCr box, a common rule of thumb). */
function isSkin(r: number, g: number, b: number) {
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return cr >= 138 && cr <= 173 && cb >= 77 && cb <= 127 && r > g && r > b;
}

/**
 * One colour for a whole scan: each view votes its colour name, weighted by
 * how much of the object it covers; the swatch comes from the winning views.
 */
export function scanColor(views: (ObjectColor | null)[]): ObjectColor | null {
  const tally = new Map<string, { weight: number; hexes: string[] }>();
  for (const v of views) {
    if (!v) continue;
    const t = tally.get(v.name) ?? { weight: 0, hexes: [] };
    t.weight += 0.5 + v.share;
    t.hexes.push(v.hex);
    tally.set(v.name, t);
  }
  const best = [...tally].sort((a, b) => b[1].weight - a[1].weight)[0];
  if (!best) return null;
  const total = [...tally.values()].reduce((n, t) => n + t.weight, 0);
  return { name: best[0], hex: best[1].hexes[Math.floor(best[1].hexes.length / 2)], share: best[1].weight / total };
}

const hex = (v: number) =>
  Math.max(0, Math.min(255, Math.round(v)))
    .toString(16)
    .padStart(2, "0");

/**
 * The object's main colour. `mask` has one byte per pixel (non-zero = object).
 * Blown highlights and deep shadows are left out, then the rest is clustered
 * (k-means in Lab, k = 3) and the biggest cluster is named.
 */
export function objectColor(img: Pixels, mask: Uint8Array, k = 3): ObjectColor | null {
  const { data, width, height } = img;
  const total = width * height;
  const step = Math.max(1, Math.floor(Math.sqrt(total / 20000)));
  const labs: number[][] = [];
  const rgbs: number[][] = [];
  const skin: boolean[] = [];
  for (let y = 0; y < height; y += step)
    for (let x = 0; x < width; x += step) {
      const i = y * width + x;
      if (!mask[i]) continue;
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      const lab = toLab(r, g, b);
      // Specular highlights and deep shadow say little about the colour.
      if (lab[0] > 97 || lab[0] < 6) continue;
      labs.push(lab);
      rgbs.push([r, g, b]);
      skin.push(isSkin(r, g, b));
    }
  if (labs.length < 30) return null;

  // A holding hand often slips into the mask: leave skin out, unless the object
  // itself is mostly that colour (a beige or peach object keeps its pixels).
  const skinShare = skin.filter(Boolean).length / skin.length;
  if (skinShare > 0.05 && skinShare < 0.6) {
    for (let i = labs.length - 1; i >= 0; i--)
      if (skin[i]) {
        labs.splice(i, 1);
        rgbs.splice(i, 1);
      }
  }
  if (labs.length < 30) return null;

  // k-means++-ish start: spread the seeds along lightness.
  const sorted = labs.map((l, i) => [l[0], i]).sort((p, q) => p[0] - q[0]);
  let centers = Array.from({ length: k }, (_, c) => [...labs[sorted[Math.floor(((c + 0.5) / k) * sorted.length)][1]]]);
  const assign = new Int32Array(labs.length);
  for (let iter = 0; iter < 12; iter++) {
    for (let i = 0; i < labs.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d =
          (labs[i][0] - centers[c][0]) ** 2 + (labs[i][1] - centers[c][1]) ** 2 + (labs[i][2] - centers[c][2]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      assign[i] = best;
    }
    centers = centers.map((old, c) => {
      const sum = [0, 0, 0];
      let n = 0;
      for (let i = 0; i < labs.length; i++)
        if (assign[i] === c) {
          sum[0] += labs[i][0];
          sum[1] += labs[i][1];
          sum[2] += labs[i][2];
          n++;
        }
      return n ? sum.map((v) => v / n) : old;
    });
  }

  const counts = new Array(k).fill(0);
  for (let i = 0; i < labs.length; i++) counts[assign[i]]++;
  // The colour an object is known by is its most vivid sizeable part: a black
  // cap on an orange lighter does not make it black. Among clusters holding at
  // least a quarter of the pixels, take the most chromatic one when it is
  // clearly coloured; otherwise the biggest.
  const chroma = centers.map((c) => Math.hypot(c[1], c[2]));
  let top = counts.indexOf(Math.max(...counts));
  for (let c = 0; c < k; c++)
    if (counts[c] >= labs.length * 0.25 && chroma[c] >= 25 && chroma[c] > chroma[top] + 10) top = c;
  const rgb = [0, 0, 0];
  for (let i = 0; i < labs.length; i++)
    if (assign[i] === top) for (let j = 0; j < 3; j++) rgb[j] += rgbs[i][j] / counts[top];
  const [L, a, b] = centers[top];
  return {
    name: colorName(L, a, b),
    hex: `#${hex(rgb[0])}${hex(rgb[1])}${hex(rgb[2])}`,
    share: counts[top] / labs.length,
  };
}
