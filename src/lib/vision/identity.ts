import { getProfile } from "@/lib/scan/profile";
import { colorSignature } from "./color";
import { pooledVector, type Embedding } from "./embedder";
import { extractOrb, type OrbFeatures } from "./features";
import { CAPTURE_SIZE, type CapturedFrame } from "./frames";
import { grabCutMask } from "./grabcut";
import type { CV } from "./opencv";
import { segmentObject } from "./segmenter";

/**
 * Everything that identifies an object in one view, computed only from the
 * object's own pixels (precise SAM mask), never from its surroundings.
 */
export type Identity = {
  /** Pixel mask at capture resolution (0 / 255). */
  mask: Uint8Array;
  maskSource: "sam" | "grabcut" | "coarse";
  area: number;
  vector: Float32Array;
  features: OrbFeatures;
  color: Float32Array;
};

/** Pixels kept away from the silhouette so descriptors never include background. */
const EDGE_MARGIN = 8;

function erode(cv: CV, mask: Uint8Array, radius: number): Uint8Array {
  const src = new cv.Mat(CAPTURE_SIZE, CAPTURE_SIZE, cv.CV_8UC1);
  src.data.set(mask);
  const dst = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(radius * 2 + 1, radius * 2 + 1));
  try {
    cv.erode(src, dst, kernel);
    return Uint8Array.from(dst.data);
  } finally {
    src.delete();
    dst.delete();
    kernel.delete();
  }
}

/** GrabCut isolation for phones; falls back to the coarse mask if it fails. */
function lightSegment(cv: CV, frame: CapturedFrame, embedding: Embedding) {
  const cut = grabCutMask(cv, frame.full, embedding.mask, embedding.grid);
  let on = 0;
  if (cut) for (let i = 0; i < cut.length; i++) if (cut[i]) on++;
  const area = cut ? on / cut.length : 0;
  if (cut && area >= 0.01 && area <= 0.9) return { mask: cut, area, source: "grabcut" as const };
  const mask = coarsePixels(embedding.mask, embedding.grid);
  let c = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) c++;
  return { mask, area: c / mask.length, source: "coarse" as const };
}

function coarsePixels(mask: Uint8Array, grid: number) {
  const out = new Uint8Array(CAPTURE_SIZE * CAPTURE_SIZE);
  const cell = CAPTURE_SIZE / grid;
  for (let y = 0; y < CAPTURE_SIZE; y++) {
    const gy = Math.min(grid - 1, Math.floor(y / cell));
    for (let x = 0; x < CAPTURE_SIZE; x++)
      out[y * CAPTURE_SIZE + x] = mask[gy * grid + Math.min(grid - 1, Math.floor(x / cell))] ? 255 : 0;
  }
  return out;
}

/**
 * Details for an object key: more and fainter than for recognition (1500 at
 * FAST 10). On real phone scans this lifted the worst same-object match from
 * 10 to 95 aligned details, with other objects still at 0.
 */
export function keyFeatures(cv: CV, frame: CapturedFrame, identity: Identity): OrbFeatures {
  return extractOrb(cv, frame.full, erode(cv, identity.mask, EDGE_MARGIN), { count: 1500, fastThreshold: 10 });
}

export async function extractIdentity(
  cv: CV,
  device: "webgpu" | "wasm",
  frame: CapturedFrame,
  embedding: Embedding,
): Promise<Identity> {
  const seg =
    getProfile().segmenter === "sam"
      ? await segmentObject(device, frame.full, embedding.mask, embedding.grid)
      : lightSegment(cv, frame, embedding);
  const inner = erode(cv, seg.mask, EDGE_MARGIN);
  return {
    mask: seg.mask,
    maskSource: seg.source,
    area: seg.area,
    vector: pooledVector(embedding, seg.mask, CAPTURE_SIZE) ?? embedding.vector,
    features: extractOrb(cv, frame.full, inner),
    color: colorSignature(frame.full, inner),
  };
}
