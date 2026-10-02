import type { CV } from "./opencv";

/** ORB keypoints (x, y pairs in capture space) and their 32-byte descriptors. */
export type OrbFeatures = {
  count: number;
  points: Float32Array;
  descriptors: Uint8Array;
};

export type Correspondences = {
  count: number;
  a: Float64Array;
  b: Float64Array;
};

const ORB_FEATURES = 800;

/**
 * ORB details. `count` and `fastThreshold` default to what recognition was
 * calibrated with; object keys ask for more, fainter details.
 */
export function extractOrb(
  cv: CV,
  image: ImageData,
  mask?: Uint8Array,
  { count = ORB_FEATURES, fastThreshold = 20 }: { count?: number; fastThreshold?: number } = {},
): OrbFeatures {
  const rgba = cv.matFromImageData(image);
  const gray = new cv.Mat();
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);

  const maskMat = mask ? new cv.Mat(image.height, image.width, cv.CV_8UC1) : new cv.Mat();
  if (mask) maskMat.data.set(mask);

  const orb = new cv.ORB(count, 1.2, 8, 31, 0, 2, cv.ORB_HARRIS_SCORE, 31, fastThreshold);
  const keypoints = new cv.KeyPointVector();
  const descriptors = new cv.Mat();

  try {
    orb.detectAndCompute(gray, maskMat, keypoints, descriptors);
    const count = descriptors.rows;
    const points = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const kp = keypoints.get(i);
      points[i * 2] = kp.pt.x;
      points[i * 2 + 1] = kp.pt.y;
    }
    return { count, points, descriptors: Uint8Array.from(descriptors.data) };
  } finally {
    rgba.delete();
    gray.delete();
    maskMat.delete();
    orb.delete();
    keypoints.delete();
    descriptors.delete();
  }
}

/** Lowe ratio-test matching with one-to-one enforcement. */
export function matchOrb(cv: CV, a: OrbFeatures, b: OrbFeatures, ratio = 0.8): Correspondences {
  const best = new Map<number, { query: number; distance: number }>();
  for (const [query, train, distance] of matchIndices(cv, a, b, ratio)) {
    const prev = best.get(train);
    if (!prev || distance < prev.distance) best.set(train, { query, distance });
  }
  const count = best.size;
  const pa = new Float64Array(count * 2);
  const pb = new Float64Array(count * 2);
  let k = 0;
  for (const [train, { query }] of best) {
    pa[k * 2] = a.points[query * 2];
    pa[k * 2 + 1] = a.points[query * 2 + 1];
    pb[k * 2] = b.points[train * 2];
    pb[k * 2 + 1] = b.points[train * 2 + 1];
    k++;
  }
  return { count, a: pa, b: pb };
}

/**
 * Drops keypoints that stay put (within `tolerance` px) while the object moves
 * in other frames of the same sequence. On a steady camera those are the
 * background; the turning object's details always travel.
 */
export function withoutStatic(cv: CV, target: OrbFeatures, others: OrbFeatures[], tolerance = 2): OrbFeatures {
  if (!others.length || target.count === 0) return target;
  const staticIdx = new Set<number>();
  const tol2 = tolerance * tolerance;
  for (const other of others) {
    const matches = matchIndices(cv, target, other);
    for (const [qi, ti] of matches) {
      const dx = target.points[qi * 2] - other.points[ti * 2];
      const dy = target.points[qi * 2 + 1] - other.points[ti * 2 + 1];
      if (dx * dx + dy * dy <= tol2) staticIdx.add(qi);
    }
  }
  if (!staticIdx.size) return target;
  return subset(target, (i) => !staticIdx.has(i));
}

function subset(f: OrbFeatures, keepIndex: (i: number) => boolean): OrbFeatures {
  const keep: number[] = [];
  for (let i = 0; i < f.count; i++) if (keepIndex(i)) keep.push(i);
  const points = new Float32Array(keep.length * 2);
  const descriptors = new Uint8Array(keep.length * 32);
  keep.forEach((src, dst) => {
    points[dst * 2] = f.points[src * 2];
    points[dst * 2 + 1] = f.points[src * 2 + 1];
    descriptors.set(f.descriptors.subarray(src * 32, src * 32 + 32), dst * 32);
  });
  return { count: keep.length, points, descriptors };
}

/** Ratio-test matches as [queryIndex, trainIndex, distance]. */
function matchIndices(cv: CV, a: OrbFeatures, b: OrbFeatures, ratio = 0.8): [number, number, number][] {
  if (a.count < 2 || b.count < 2) return [];
  const da = new cv.Mat(a.count, 32, cv.CV_8U);
  const db = new cv.Mat(b.count, 32, cv.CV_8U);
  da.data.set(a.descriptors);
  db.data.set(b.descriptors);
  const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
  const knn = new cv.DMatchVectorVector();
  try {
    matcher.knnMatch(da, db, knn, 2);
    const out: [number, number, number][] = [];
    for (let i = 0; i < knn.size(); i++) {
      const pair = knn.get(i);
      if (pair.size() < 2) continue;
      const m = pair.get(0);
      if (m.distance < ratio * pair.get(1).distance) out.push([m.queryIdx, m.trainIdx, m.distance]);
    }
    return out;
  } finally {
    da.delete();
    db.delete();
    matcher.delete();
    knn.delete();
  }
}

export function homographyInliers(cv: CV, c: Correspondences, threshold = 3): number {
  if (c.count < 4) return 0;
  const src = cv.matFromArray(c.count, 1, cv.CV_32FC2, Array.from(c.a));
  const dst = cv.matFromArray(c.count, 1, cv.CV_32FC2, Array.from(c.b));
  const mask = new cv.Mat();
  let h: CV = null;
  try {
    h = cv.findHomography(src, dst, cv.RANSAC, threshold, mask);
    if (h.empty()) return 0;
    let inliers = 0;
    for (let i = 0; i < mask.rows; i++) if (mask.data[i]) inliers++;
    return inliers;
  } finally {
    src.delete();
    dst.delete();
    mask.delete();
    h?.delete();
  }
}

/** Median horizontal / vertical displacement of matched points (b - a). */
export function medianShift(c: Correspondences) {
  if (c.count === 0) return { dx: 0, dy: 0 };
  const dx: number[] = [];
  const dy: number[] = [];
  for (let i = 0; i < c.count; i++) {
    dx.push(c.b[i * 2] - c.a[i * 2]);
    dy.push(c.b[i * 2 + 1] - c.a[i * 2 + 1]);
  }
  const median = (v: number[]) => {
    v.sort((x, y) => x - y);
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  return { dx: median(dx), dy: median(dy) };
}
