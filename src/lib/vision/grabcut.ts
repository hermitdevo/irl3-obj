import type { CV } from "./opencv";

/**
 * Light object isolation for phones: OpenCV GrabCut, seeded by the coarse
 * DINOv2 foreground. Far less memory than SAM. Scans run it at half
 * resolution; a one-off cut (an object saved from /scan) can afford full
 * resolution and more rounds.
 */
export function grabCutMask(
  cv: CV,
  image: ImageData,
  coarse: Uint8Array,
  grid: number,
  {
    fullSize = false,
    rounds = 3,
    sure,
    sureLeads = false,
    band = 2,
  }: {
    fullSize?: boolean;
    rounds?: number;
    /** Pixels known to be the object (e.g. of its colour, near it), image-sized: seeded as sure object. */
    sure?: Uint8Array;
    /**
     * `sure` says most of what the object is (a clearly coloured object): the
     * rest of the coarse foreground (its shadow, a hand) starts as probably
     * background instead of probably object.
     */
    sureLeads?: boolean;
    /** Patches around the coarse foreground that may still be object (the rest is sure background). */
    band?: number;
  } = {},
): Uint8Array | null {
  const size = image.width;
  const work = fullSize ? size : Math.round(size / 2);
  const cell = work / grid;

  const rgba = cv.matFromImageData(image);
  const small = new cv.Mat();
  const rgb = new cv.Mat();
  const mask = new cv.Mat(work, work, cv.CV_8UC1);
  const bgd = new cv.Mat();
  const fgd = new cv.Mat();
  const full = new cv.Mat();
  try {
    cv.resize(rgba, small, new cv.Size(work, work), 0, 0, cv.INTER_AREA);
    cv.cvtColor(small, rgb, cv.COLOR_RGBA2RGB);

    // Seed: core of the coarse foreground = sure object; its patches = probably
    // object; a band around it = probably background; far away = background.
    const near = (gx: number, gy: number, r: number) => {
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const x = gx + dx;
          const y = gy + dy;
          if (x >= 0 && y >= 0 && x < grid && y < grid && coarse[y * grid + x]) return true;
        }
      return false;
    };
    for (let y = 0; y < work; y++) {
      const gy = Math.min(grid - 1, Math.floor(y / cell));
      for (let x = 0; x < work; x++) {
        const gx = Math.min(grid - 1, Math.floor(x / cell));
        let label: number;
        if (coarse[gy * grid + gx]) label = isInterior(coarse, grid, gx, gy) ? cv.GC_FGD : cv.GC_PR_FGD;
        else label = near(gx, gy, band) ? cv.GC_PR_BGD : cv.GC_BGD;
        mask.data[y * work + x] = label;
      }
    }
    if (sure) {
      const step = size / work;
      for (let y = 0; y < work; y++)
        for (let x = 0; x < work; x++)
          if (sure[Math.floor(y * step) * size + Math.floor(x * step)]) mask.data[y * work + x] = cv.GC_FGD;
          else if (sureLeads && mask.data[y * work + x] !== cv.GC_BGD) mask.data[y * work + x] = cv.GC_PR_BGD;
    }

    cv.grabCut(rgb, mask, new cv.Rect(0, 0, 1, 1), bgd, fgd, rounds, cv.GC_INIT_WITH_MASK);
    for (let i = 0; i < mask.data.length; i++) {
      const v = mask.data[i];
      mask.data[i] = v === cv.GC_FGD || v === cv.GC_PR_FGD ? 255 : 0;
    }
    cv.resize(mask, full, new cv.Size(size, size), 0, 0, cv.INTER_NEAREST);
    return Uint8Array.from(full.data);
  } catch {
    return null;
  } finally {
    [rgba, small, rgb, mask, bgd, fgd, full].forEach((m) => m.delete());
  }
}

/** A patch whose 8 neighbours are all foreground. */
function isInterior(mask: Uint8Array, grid: number, gx: number, gy: number) {
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = gx + dx;
      const y = gy + dy;
      if (x < 0 || y < 0 || x >= grid || y >= grid || !mask[y * grid + x]) return false;
    }
  return true;
}
