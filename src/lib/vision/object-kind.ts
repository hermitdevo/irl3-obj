import type { PreTrainedModel, Processor, RawImage as RawImageType } from "@huggingface/transformers";
import { configureOnnx } from "./ort-env";
import { KIND_MODEL, OBJECT_KINDS } from "@/lib/objects/object-kinds";

/**
 * What kind of object this is (lighter, mug, phone…), by zero-shot MobileCLIP:
 * the image embedding is compared with precomputed text embeddings of every
 * kind (public/models/object-kinds.*). The image is judged in greyscale, so
 * colour (measured on its own) cannot pull the kind: an orange lighter is not
 * an orange.
 */

export type KindGuess = { kind: string; score: number };

type Loaded = {
  model: PreTrainedModel;
  processor: Processor;
  RawImage: typeof RawImageType;
  table: Int8Array;
  dim: number;
};

let loading: Promise<Loaded> | null = null;

async function loadTable() {
  const [meta, bin] = await Promise.all([
    fetch("/models/object-kinds.json").then(
      (r) => r.json() as Promise<{ model: string; dim: number; kinds: string[] }>,
    ),
    fetch("/models/object-kinds.bin").then((r) => r.arrayBuffer()),
  ]);
  if (meta.model !== KIND_MODEL || meta.kinds.join("|") !== OBJECT_KINDS.join("|"))
    throw new Error("The object kind table is out of date; rebuild it (npm run kinds).");
  return { table: new Int8Array(bin), dim: meta.dim };
}

/**
 * Loads the vision model once. On a GPU it runs in half precision; on the CPU
 * in full precision (MobileCLIP's 8-bit builds give wrong answers).
 */
export function loadKindModel(device: "webgpu" | "wasm"): Promise<Loaded> {
  if (!loading) {
    loading = (async () => {
      const { CLIPVisionModelWithProjection, AutoProcessor, RawImage, env } = await import("@huggingface/transformers");
      configureOnnx(env);
      const [model, processor, { table, dim }] = await Promise.all([
        CLIPVisionModelWithProjection.from_pretrained(KIND_MODEL, {
          device,
          dtype: device === "webgpu" ? "fp16" : "fp32",
        }),
        AutoProcessor.from_pretrained(KIND_MODEL),
        loadTable(),
      ]);
      return { model, processor, RawImage, table, dim };
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/** Cosine scores of one normalized image embedding against every kind (int8 rows). */
export function kindScores(embedding: ArrayLike<number>, table: Int8Array, dim: number): number[] {
  const n = table.length / dim;
  const out = new Array<number>(n);
  for (let k = 0; k < n; k++) {
    let dot = 0;
    for (let j = 0; j < dim; j++) dot += embedding[j] * table[k * dim + j];
    out[k] = dot / 127;
  }
  return out;
}

/**
 * Combines several views: each ranks the kinds, its top three get 3, 2 and 1
 * points, and the kinds are ordered by points (then by their best score).
 */
export function voteKinds(perView: number[][], top = 3): KindGuess[] {
  const points = new Map<number, { votes: number; best: number }>();
  for (const scores of perView) {
    const order = scores.map((s, k) => [s, k]).sort((a, b) => b[0] - a[0]);
    order.slice(0, 3).forEach(([s, k], rank) => {
      const p = points.get(k) ?? { votes: 0, best: -1 };
      p.votes += 3 - rank;
      p.best = Math.max(p.best, s);
      points.set(k, p);
    });
  }
  const total = perView.length * 6 || 1;
  return [...points]
    .sort((a, b) => b[1].votes - a[1].votes || b[1].best - a[1].best)
    .slice(0, top)
    .map(([k, p]) => ({ kind: OBJECT_KINDS[k], score: p.votes / total }));
}

/** One view's score for every kind (a crop around the object, RGBA), judged in greyscale. */
export async function scoreKinds(device: "webgpu" | "wasm", crop: ImageData): Promise<number[]> {
  const { model, processor, RawImage, table, dim } = await loadKindModel(device);
  const image = new RawImage(crop.data, crop.width, crop.height, 4).grayscale().rgb();
  const { image_embeds } = await model(await processor(image));
  const v = (image_embeds.normalize().tolist() as number[][])[0];
  return kindScores(v, table, dim);
}

/** The most likely kinds for these views of one object (crops around it, RGBA). */
export async function guessKinds(device: "webgpu" | "wasm", crops: ImageData[]): Promise<KindGuess[]> {
  const perView: number[][] = [];
  for (const crop of crops) perView.push(await scoreKinds(device, crop));
  return voteKinds(perView);
}
