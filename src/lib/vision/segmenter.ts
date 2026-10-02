import type { PreTrainedModel, Processor, RawImage as RawImageType, Tensor } from "@huggingface/transformers";
import { configureOnnx } from "./ort-env";
import { CAPTURE_SIZE } from "./frames";

/**
 * Precise object segmentation with SlimSAM (a distilled Segment Anything).
 *
 * The coarse DINOv2 foreground (16 x 16 patches) tells us roughly where the
 * object is; SAM turns that into a pixel-accurate mask so tables, walls and
 * the hand holding the object never contribute to its identity.
 */

export const SEGMENTER_ID = "Xenova/slimsam-77-uniform";

// The SAM processor adds mask post-processing on top of the generic processor.
type SamProcessor = Processor & {
  post_process_masks(masks: Tensor, originalSizes: unknown, reshapedSizes: unknown): Promise<Tensor[]>;
};

type Loaded = {
  model: PreTrainedModel;
  processor: SamProcessor;
  RawImage: typeof RawImageType;
};

let loading: Promise<Loaded> | null = null;

/**
 * Encoder precision: fp16 on GPUs; on the CPU (phones) the 8-bit quantized
 * encoder (8.9 MB instead of 23 MB), which is several times faster there.
 */
const ENCODER_DTYPE_GPU = "fp16";
const ENCODER_DTYPE_CPU = "q8";

export function loadSegmenter(device: "webgpu" | "wasm", onProgress?: (percent: number) => void): Promise<Loaded> {
  if (!loading) {
    loading = (async () => {
      const { SamModel, AutoProcessor, RawImage, env } = await import("@huggingface/transformers");
      configureOnnx(env);
      const [model, processor] = await Promise.all([
        SamModel.from_pretrained(SEGMENTER_ID, {
          device,
          dtype: {
            vision_encoder: device === "webgpu" ? ENCODER_DTYPE_GPU : ENCODER_DTYPE_CPU,
            prompt_encoder_mask_decoder: "fp32",
          },
          progress_callback: (p) => {
            if (p.status === "progress_total") onProgress?.(p.progress);
          },
        }),
        AutoProcessor.from_pretrained(SEGMENTER_ID),
      ]);
      return { model, processor: processor as SamProcessor, RawImage };
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

export type SegmentResult = {
  /** Pixel mask at capture resolution (0 / 255). */
  mask: Uint8Array;
  /** Fraction of the capture covered by the object. */
  area: number;
  score: number;
  source: "sam" | "coarse";
};

function coarseToPixels(mask: Uint8Array, grid: number) {
  const out = new Uint8Array(CAPTURE_SIZE * CAPTURE_SIZE);
  const cell = CAPTURE_SIZE / grid;
  for (let y = 0; y < CAPTURE_SIZE; y++) {
    const gy = Math.min(grid - 1, Math.floor(y / cell));
    for (let x = 0; x < CAPTURE_SIZE; x++)
      out[y * CAPTURE_SIZE + x] = mask[gy * grid + Math.min(grid - 1, Math.floor(x / cell))] ? 255 : 0;
  }
  return out;
}

/** The coarse foreground cell nearest the centre of the frame (the aiming frame is centred), in capture pixels. */
export function centerPoint(mask: Uint8Array, grid: number): [number, number] | null {
  const cell = CAPTURE_SIZE / grid;
  const c = (grid - 1) / 2;
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (let y = 0; y < grid; y++)
    for (let x = 0; x < grid; x++) {
      if (!mask[y * grid + x]) continue;
      const d = (x - c) ** 2 + (y - c) ** 2;
      if (d < bestD) {
        bestD = d;
        best = [(x + 0.5) * cell, (y + 0.5) * cell];
      }
    }
  return best;
}

/**
 * How well a proposal matches the object's colour pixels: the share of them it
 * covers times the share of it they make up (1 = exactly those pixels).
 */
function colourFit(data: Uint8Array, offset: number, n: number, colour: Uint8Array) {
  let both = 0;
  let inMask = 0;
  let inColour = 0;
  for (let i = 0; i < n; i++) {
    const m = data[offset + i] ? 1 : 0;
    const c = colour[i] ? 1 : 0;
    inMask += m;
    inColour += c;
    both += m & c;
  }
  return inMask && inColour ? (both / inColour) * (both / inMask) : 0;
}

/** How a mask proposal sits in the frame: area, sides it spills over, share of skin-coloured pixels. */
function describe(image: ImageData, data: Uint8Array, offset: number, w: number, h: number) {
  let on = 0;
  let skin = 0;
  for (let i = 0; i < w * h; i++) {
    if (!data[offset + i]) continue;
    on++;
    const r = image.data[i * 4];
    const g = image.data[i * 4 + 1];
    const b = image.data[i * 4 + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const cr = (r - y) * 0.713 + 128;
    const cb = (b - y) * 0.564 + 128;
    if (cr >= 135 && cr <= 173 && cb >= 77 && cb <= 127) skin++;
  }
  const side = (xs: number[], ys: number[]) => {
    let n = 0;
    for (const y of ys) for (const x of xs) n += data[offset + y * w + x] ? 1 : 0;
    return n / (xs.length * ys.length);
  };
  const all = (k: number) => Array.from({ length: k }, (_, i) => i);
  const sides = [side(all(w), [0]), side(all(w), [h - 1]), side([0], all(h)), side([w - 1], all(h))].filter(
    (f) => f > 0.15,
  ).length;
  return { area: on / (w * h), sides, skin: on ? skin / on : 0 };
}

/**
 * Segments the object in the middle of the frame. SAM is prompted with a
 * single point on the object nearest the centre (not with the coarse
 * foreground, which also holds the hand that holds the object), and the
 * proposal kept is the largest one that stays off the frame edges and is not
 * mostly skin — the object, not the hand or the wall behind it. Falls back to
 * the coarse mask when nothing plausible comes back.
 */
export async function segmentObject(
  device: "webgpu" | "wasm",
  image: ImageData,
  coarse: Uint8Array,
  grid: number,
  /**
   * When the object's colour is known: the point to prompt with (on that
   * colour), and the pixels of that colour. The proposal kept is then the one
   * that best covers those pixels and little else, instead of the largest
   * non-skin one (a pink or peach object reads as skin, and its shadow won).
   */
  hint?: { point: [number, number]; colour: Uint8Array },
): Promise<SegmentResult> {
  const point = hint?.point ?? centerPoint(coarse, grid);
  const fallback = (): SegmentResult => {
    const mask = coarseToPixels(coarse, grid);
    let on = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) on++;
    return { mask, area: on / mask.length, score: 0, source: "coarse" };
  };
  if (!point) return fallback();

  const { model, processor, RawImage } = await loadSegmenter(device);
  const raw = new RawImage(new Uint8ClampedArray(image.data), image.width, image.height, 4).rgb();
  const inputs = await processor(raw, { input_points: [[[point]]] });
  const outputs = await model(inputs);
  const masks = await processor.post_process_masks(
    outputs.pred_masks,
    inputs.original_sizes,
    inputs.reshaped_input_sizes,
  );
  const scores = (outputs.iou_scores as Tensor).data as Float32Array;

  const [, count, h, w] = masks[0].dims as number[];
  const data = masks[0].data as Uint8Array;

  let best = -1;
  let bestKey: [number, number] | null = null;
  for (let m = 0; m < count; m++) {
    if (scores[m] < 0.6) continue;
    const d = describe(image, data, m * h * w, w, h);
    if (d.area < 0.01 || d.area > 0.85 || d.sides >= 3) continue;
    const key: [number, number] = hint
      ? [colourFit(data, m * h * w, h * w, hint.colour), d.area]
      : [d.skin < 0.15 ? 1 : 0, d.area];
    if (!bestKey || key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1])) {
      best = m;
      bestKey = key;
    }
  }
  if (best < 0) return fallback();

  const mask = new Uint8Array(h * w);
  let on = 0;
  const offset = best * h * w;
  for (let i = 0; i < h * w; i++) {
    if (data[offset + i]) {
      mask[i] = 255;
      on++;
    }
  }
  return { mask, area: on / (h * w), score: scores[best], source: "sam" };
}
