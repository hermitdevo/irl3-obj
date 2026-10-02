/**
 * Wavy closed rings in the line-art style (viewBox 0..100, centred on 50,50),
 * shared by the busy animation and the placeholder artwork.
 */

const POINTS = 96;

/** One closed wavy ring as an SVG path. */
export function ringPath(radius: number, wave: number, lobes: number, phase: number, turn: number) {
  let d = "";
  for (let i = 0; i <= POINTS; i++) {
    const a = (i / POINTS) * Math.PI * 2;
    const r = radius + wave * Math.sin(lobes * a + phase) + wave * 0.45 * Math.sin((lobes + 2) * a - phase * 0.7);
    const x = 50 + r * Math.cos(a + turn);
    const y = 50 + r * Math.sin(a + turn);
    d += `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return d + "Z";
}

export type Rings = { rings: string[]; outline: string };

/**
 * The ring set at time `t` (seconds). `seed` shifts the waves so each
 * artwork differs; `count` is the number of inner rings.
 */
export function ringsAt(t: number, seed = 0, count = 6): Rings {
  const rings: string[] = [];
  const lobes = 3 + (seed % 3);
  for (let i = 0; i < count; i++) {
    const radius = 17 + i * (27 / count);
    const wave = 1.1 + i * 0.35;
    const dir = i % 2 ? -1 : 1;
    rings.push(
      ringPath(radius, wave, lobes, t * (0.9 + i * 0.12) + i * 0.8 + seed, dir * t * 0.25 + i * 0.35 + seed * 0.7),
    );
  }
  return { rings, outline: ringPath(46, 1.4, lobes + 1, t * 0.6 + seed * 1.3, t * 0.1) };
}
