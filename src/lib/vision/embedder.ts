import type { PreTrainedModel, Tensor as TensorType } from "@huggingface/transformers";
import { getProfile } from "@/lib/scan/profile";
import { EMBED_SIZE } from "./frames";
import { configureOnnx } from "./ort-env";

export const MODEL_ID = "onnx-community/dinov2-small-ONNX";

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

export type EmbedderInfo = { device: "webgpu" | "wasm"; model: string };

export type Embedding = {
  /** L2-normalized mean of the foreground patch tokens. */
  vector: Float32Array;
  /** Foreground mask over the patch grid (1 = object). */
  mask: Uint8Array;
  grid: number;
  foreground: number;
  maskSource: "auto" | "center";
  /** L2-normalized patch tokens (grid * grid rows of `dim`), for re-pooling with a precise mask. */
  patches: Float32Array;
  dim: number;
};

type Loaded = {
  model: PreTrainedModel;
  Tensor: typeof TensorType;
  info: EmbedderInfo;
};

let loading: Promise<Loaded> | null = null;

async function detectWebGPU() {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) != null;
  } catch {
    return false;
  }
}

export function loadEmbedder(onProgress?: (percent: number) => void): Promise<Loaded> {
  if (!loading) {
    loading = (async () => {
      const { AutoModel, Tensor, env } = await import("@huggingface/transformers");
      configureOnnx(env);
      env.allowLocalModels = false;
      const profile = getProfile();
      const device = profile.device ?? ((await detectWebGPU()) ? "webgpu" : "wasm");
      const model = await AutoModel.from_pretrained(MODEL_ID, {
        device,
        dtype: profile.embedDtype,
        progress_callback: (p) => {
          if (p.status === "progress_total") onProgress?.(p.progress);
        },
      });
      return { model, Tensor, info: { device, model: MODEL_ID } };
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

function toPixelValues(images: ImageData[]) {
  const plane = EMBED_SIZE * EMBED_SIZE;
  const out = new Float32Array(images.length * 3 * plane);
  images.forEach((img, b) => {
    const d = img.data;
    const base = b * 3 * plane;
    for (let i = 0; i < plane; i++) {
      out[base + i] = (d[i * 4] / 255 - MEAN[0]) / STD[0];
      out[base + plane + i] = (d[i * 4 + 1] / 255 - MEAN[1]) / STD[1];
      out[base + 2 * plane + i] = (d[i * 4 + 2] / 255 - MEAN[2]) / STD[2];
    }
  });
  return out;
}

export async function embedImages(images: ImageData[]): Promise<Embedding[]> {
  const { model, Tensor } = await loadEmbedder();
  const results: Embedding[] = [];
  const step = getProfile().embedBatch;
  for (let start = 0; start < images.length; start += step) {
    const chunk = images.slice(start, start + step);
    const pixelValues = new Tensor("float32", toPixelValues(chunk), [chunk.length, 3, EMBED_SIZE, EMBED_SIZE]);
    const output = await model({ pixel_values: pixelValues });
    const hidden = output.last_hidden_state as TensorType;
    const [batch, tokens, dim] = hidden.dims as number[];
    const data = hidden.data as Float32Array;
    for (let b = 0; b < batch; b++) {
      const offset = b * tokens * dim;
      results.push(summarize(data.subarray(offset, offset + tokens * dim), tokens, dim));
    }
  }
  return results;
}

/** Turns raw tokens (CLS + patches) into a foreground-focused descriptor. */
function summarize(tokens: Float32Array, count: number, dim: number): Embedding {
  const patches = count - 1;
  const grid = Math.round(Math.sqrt(patches));
  const x = new Float32Array(patches * dim);
  for (let p = 0; p < patches; p++) {
    const row = tokens.subarray((p + 1) * dim, (p + 2) * dim);
    let norm = 0;
    for (let k = 0; k < dim; k++) norm += row[k] * row[k];
    norm = Math.sqrt(norm) || 1;
    for (let k = 0; k < dim; k++) x[p * dim + k] = row[k] / norm;
  }

  let { mask, foreground } = foregroundMask(x, patches, dim, grid);
  let maskSource: Embedding["maskSource"] = "auto";
  if (foreground < 0.04 || foreground > 0.85) {
    mask = centerMask(grid);
    foreground = mask.reduce((s, v) => s + v, 0) / patches;
    maskSource = "center";
  }

  const vector = new Float32Array(dim);
  let used = 0;
  for (let p = 0; p < patches; p++) {
    if (!mask[p]) continue;
    used++;
    for (let k = 0; k < dim; k++) vector[k] += x[p * dim + k];
  }
  normalize(vector, used);
  return { vector, mask, grid, foreground, maskSource, patches: x, dim };
}

/**
 * Re-pools the patch tokens with a pixel-accurate object mask: each patch is
 * weighted by how much of it the object covers. Returns null if the mask
 * barely touches the patch grid.
 */
export function pooledVector(e: Embedding, pixelMask: Uint8Array, size: number): Float32Array | null {
  const { grid, dim, patches } = e;
  const cell = size / grid;
  const weights = new Float32Array(grid * grid);
  for (let y = 0; y < size; y++) {
    const gy = Math.min(grid - 1, Math.floor(y / cell));
    for (let x = 0; x < size; x++)
      if (pixelMask[y * size + x]) weights[gy * grid + Math.min(grid - 1, Math.floor(x / cell))]++;
  }
  const full = cell * cell;
  const vector = new Float32Array(dim);
  let total = 0;
  for (let p = 0; p < weights.length; p++) {
    const w = weights[p] / full;
    if (w < 0.3) continue;
    total += w;
    for (let k = 0; k < dim; k++) vector[k] += w * patches[p * dim + k];
  }
  if (total < 1) return null;
  normalize(vector);
  return vector;
}

function normalize(v: Float32Array, divisor = 1) {
  let n = 0;
  for (let k = 0; k < v.length; k++) {
    v[k] /= divisor || 1;
    n += v[k] * v[k];
  }
  n = Math.sqrt(n) || 1;
  for (let k = 0; k < v.length; k++) v[k] /= n;
}

/**
 * Separates the object from its surroundings using the first principal
 * component of the patch tokens (a well-known DINOv2 property), keeping the
 * connected region under the guide's center.
 */
function foregroundMask(x: Float32Array, patches: number, dim: number, grid: number) {
  const mean = new Float32Array(dim);
  for (let p = 0; p < patches; p++) for (let k = 0; k < dim; k++) mean[k] += x[p * dim + k] / patches;

  // Power iteration on the covariance without forming it.
  let v = new Float32Array(dim).map((_, k) => Math.sin(k * 12.9898) + 0.5);
  const proj = new Float32Array(patches);
  for (let it = 0; it < 30; it++) {
    for (let p = 0; p < patches; p++) {
      let s = 0;
      for (let k = 0; k < dim; k++) s += (x[p * dim + k] - mean[k]) * v[k];
      proj[p] = s;
    }
    const next = new Float32Array(dim);
    for (let p = 0; p < patches; p++) for (let k = 0; k < dim; k++) next[k] += (x[p * dim + k] - mean[k]) * proj[p];
    normalize(next);
    v = next;
  }
  for (let p = 0; p < patches; p++) {
    let s = 0;
    for (let k = 0; k < dim; k++) s += (x[p * dim + k] - mean[k]) * v[k];
    proj[p] = s;
  }

  // Orient the component so the center of the guide counts as foreground.
  const lo = Math.floor(grid * 0.35);
  const hi = Math.ceil(grid * 0.65);
  let center = 0;
  let centerN = 0;
  let all = 0;
  for (let y = 0; y < grid; y++)
    for (let xg = 0; xg < grid; xg++) {
      const val = proj[y * grid + xg];
      all += val;
      if (y >= lo && y < hi && xg >= lo && xg < hi) {
        center += val;
        centerN++;
      }
    }
  if (center / centerN < all / patches) for (let p = 0; p < patches; p++) proj[p] = -proj[p];

  const threshold = otsu(proj);
  const raw = new Uint8Array(patches);
  for (let p = 0; p < patches; p++) raw[p] = proj[p] > threshold ? 1 : 0;

  const mask = largestCentralComponent(raw, grid);
  const foreground = mask.reduce((s, m) => s + m, 0) / patches;
  return { mask, foreground };
}

function otsu(values: Float32Array) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const bins = 64;
  const hist = new Float64Array(bins);
  const span = max - min || 1;
  for (const v of values) hist[Math.min(bins - 1, Math.floor(((v - min) / span) * bins))]++;
  const total = values.length;
  let sumAll = 0;
  for (let i = 0; i < bins; i++) sumAll += i * hist[i];
  let wB = 0;
  let sumB = 0;
  let best = 0;
  let bestVar = -1;
  for (let i = 0; i < bins; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > bestVar) {
      bestVar = between;
      best = i;
    }
  }
  return min + ((best + 1) / bins) * span;
}

function largestCentralComponent(raw: Uint8Array, grid: number) {
  const labels = new Int32Array(raw.length).fill(-1);
  const sizes: number[] = [];
  const centerDist: number[] = [];
  const c = (grid - 1) / 2;
  for (let start = 0; start < raw.length; start++) {
    if (!raw[start] || labels[start] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    let dist = Infinity;
    const stack = [start];
    labels[start] = id;
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const py = Math.floor(p / grid);
      const px = p % grid;
      dist = Math.min(dist, Math.hypot(px - c, py - c));
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = px + dx;
        const ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= grid || ny >= grid) continue;
        const q = ny * grid + nx;
        if (raw[q] && labels[q] < 0) {
          labels[q] = id;
          stack.push(q);
        }
      }
    }
    sizes.push(size);
    centerDist.push(dist);
  }
  if (!sizes.length) return raw;

  // Prefer components touching the middle of the guide, then the largest one.
  let best = 0;
  for (let i = 1; i < sizes.length; i++) {
    const nearI = centerDist[i] <= grid * 0.2;
    const nearB = centerDist[best] <= grid * 0.2;
    if ((nearI && !nearB) || (nearI === nearB && sizes[i] > sizes[best])) best = i;
  }
  const mask = new Uint8Array(raw.length);
  for (let p = 0; p < raw.length; p++) mask[p] = labels[p] === best ? 1 : 0;
  return mask;
}

function centerMask(grid: number) {
  const mask = new Uint8Array(grid * grid);
  const c = (grid - 1) / 2;
  const r = grid * 0.34;
  for (let y = 0; y < grid; y++)
    for (let x = 0; x < grid; x++) mask[y * grid + x] = Math.hypot(x - c, y - c) <= r ? 1 : 0;
  return mask;
}

/** Expands the patch mask to a pixel mask (0/255), optionally grown by one patch. */
export function upsampleMask(mask: Uint8Array, grid: number, size: number, dilate = false): Uint8Array {
  const dilated = dilate ? new Uint8Array(mask.length) : mask;
  for (let y = 0; dilate && y < grid; y++)
    for (let x = 0; x < grid; x++) {
      let on = 0;
      for (let dy = -1; dy <= 1 && !on; dy++)
        for (let dx = -1; dx <= 1 && !on; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < grid && ny < grid && mask[ny * grid + nx]) on = 1;
        }
      dilated[y * grid + x] = on;
    }
  const out = new Uint8Array(size * size);
  const cell = size / grid;
  for (let y = 0; y < size; y++) {
    const gy = Math.min(grid - 1, Math.floor(y / cell));
    for (let x = 0; x < size; x++)
      out[y * size + x] = dilated[gy * grid + Math.min(grid - 1, Math.floor(x / cell))] ? 255 : 0;
  }
  return out;
}

export function cosine(a: Float32Array, b: Float32Array) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
