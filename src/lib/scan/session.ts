import { objectColor, scanColor, type ObjectColor } from "@/lib/vision/object-color";
import { cropAround } from "@/lib/vision/crop";
import { guessKinds, type KindGuess } from "@/lib/vision/object-kind";
import { embedImages, loadEmbedder, upsampleMask, type Embedding } from "@/lib/vision/embedder";
import { extractOrb, withoutStatic, type OrbFeatures } from "@/lib/vision/features";
import {
  CAPTURE_SIZE,
  captureFrame,
  isSourceReady,
  sleep,
  type CapturedFrame,
  type FrameSource,
} from "@/lib/vision/frames";
import { objectLineArt } from "@/lib/vision/line-art";
import { loadOpenCV, type CV } from "@/lib/vision/opencv";
import { extractIdentity, type Identity } from "@/lib/vision/identity";
import { diverseSubset } from "@/lib/vision/recognition";
import { loadSegmenter } from "@/lib/vision/segmenter";
import { breadcrumbs } from "./breadcrumbs";
import { getProfile } from "./profile";
import { promptBus, type Prompt } from "./prompt-bus";

export const QUALITY = { minBrightness: 35, maxBrightness: 225, minSharpness: 25 };

export type SessionContext = {
  getSource: () => FrameSource | null;
  signal: AbortSignal;
};

export type Analyzed = {
  frame: CapturedFrame;
  embedding: Embedding;
  /** Foreground mask at capture resolution (0 / 255). */
  mask: Uint8Array;
  features: OrbFeatures;
  good: boolean;
};

function prompt(p: Prompt) {
  promptBus.emit(p);
  const step = `${p.phase}: ${p.message}`;
  if (p.phase === "done") breadcrumbs.finish(step, getProfile().kind);
  else breadcrumbs.step(step, getProfile().kind);
}

function isGood(frame: CapturedFrame) {
  const q = frame.quality;
  return (
    q.brightness >= QUALITY.minBrightness &&
    q.brightness <= QUALITY.maxBrightness &&
    q.sharpness >= QUALITY.minSharpness
  );
}

type Device = "webgpu" | "wasm";

async function prepare(ctx: SessionContext): Promise<{ cv: CV; device: Device }> {
  prompt({ phase: "loading", message: "Loading recognition models…" });
  const [{ cv }, { info }] = await Promise.all([loadOpenCV(), loadEmbedder()]);
  if (getProfile().segmenter === "sam") await loadSegmenter(info.device);
  ctx.signal.throwIfAborted();
  return { cv, device: info.device };
}

/** Precise, background-free identity for each selected frame. */
async function identify(cv: CV, device: Device, picked: Analyzed[], ctx: SessionContext): Promise<Identity[]> {
  const out: Identity[] = [];
  for (let i = 0; i < picked.length; i++) {
    ctx.signal.throwIfAborted();
    prompt({
      phase: "processing",
      message: `Isolating the object (${i + 1}/${picked.length})…`,
      progress: i / picked.length,
    });
    out.push(await extractIdentity(cv, device, picked[i].frame, picked[i].embedding));
  }
  return out;
}

function source(ctx: SessionContext) {
  const s = ctx.getSource();
  if (!s || !isSourceReady(s)) throw new Error("The camera is not ready yet.");
  return s;
}

/** Waits until the frame is bright and sharp enough for a short, steady moment. */
async function position(ctx: SessionContext) {
  const needed = 6;
  let streak = 0;
  const deadline = performance.now() + 12000;
  while (streak < needed) {
    ctx.signal.throwIfAborted();
    if (performance.now() > deadline) {
      throw new Error("Could not get a clear view. Use more light and hold the object inside the frame.");
    }
    const frame = captureFrame(source(ctx));
    streak = isGood(frame) ? streak + 1 : 0;
    prompt({ phase: "position", message: "Hold the object inside the frame", progress: streak / needed });
    await sleep(150, ctx.signal);
  }
}

/** A run of consecutive frames; `gap` is how many frames apart to look for static details. */
type Segment = { frames: CapturedFrame[]; gap: number };

async function analyze(
  cv: CV,
  segments: Segment[],
  ctx: SessionContext,
  /** Embeddings already computed during capture, keyed by frame. */
  known?: Map<CapturedFrame, Embedding>,
): Promise<Analyzed[]> {
  const frames = segments.flatMap((s) => s.frames);
  prompt({ phase: "processing", message: "Analyzing the object…", progress: 0 });
  const missing = frames.filter((f) => !known?.has(f));
  breadcrumbs.step(`recognition model on ${missing.length} frames`, getProfile().kind);
  const fresh = await embedImages(missing.map((f) => f.small));
  ctx.signal.throwIfAborted();
  const byFrame = new Map(known);
  missing.forEach((f, i) => byFrame.set(f, fresh[i]));
  const embeddings = frames.map((f) => byFrame.get(f)!);

  const masks = embeddings.map((e) => upsampleMask(e.mask, e.grid, CAPTURE_SIZE));
  const raw = frames.map((frame, i) => {
    prompt({ phase: "processing", message: "Analyzing the object…", progress: ((i + 1) / frames.length) * 0.6 });
    return extractOrb(cv, frame.full, masks[i]);
  });

  // Remove details that do not move with the object (background seen through the mask).
  const out: Analyzed[] = [];
  let offset = 0;
  for (const { frames: seg, gap } of segments) {
    for (let i = 0; i < seg.length; i++) {
      const others =
        gap > 0 ? [i - gap, i + gap].filter((j) => j >= 0 && j < seg.length).map((j) => raw[offset + j]) : [];
      const k = offset + i;
      out.push({
        frame: seg[i],
        embedding: embeddings[k],
        mask: masks[k],
        features: withoutStatic(cv, raw[k], others),
        good: isGood(seg[i]),
      });
      prompt({
        phase: "processing",
        message: "Analyzing the object…",
        progress: 0.6 + (0.4 * (k + 1)) / frames.length,
      });
    }
    offset += seg.length;
  }
  return out;
}

type ShortScan = {
  frames: number;
  views: number;
  message: string;
  /** A 3-2-1 before starting, to aim (not needed when a scan continues). */
  countdown?: boolean;
};

/**
 * A short scan: the object turning a little, reduced to its
 * most different sharp views.
 */
async function shortScan(ctx: SessionContext, o: ShortScan) {
  const { cv, device } = await prepare(ctx);
  const frameCount = o.frames;
  source(ctx);
  for (let s = o.countdown === false ? 0 : 3; s > 0; s--) {
    prompt({ phase: "position", message: `Point the camera at the object… ${s}` });
    await sleep(1000, ctx.signal);
  }
  await position(ctx);
  const frames: CapturedFrame[] = [];
  const message = o.message;
  const base: Omit<Prompt, "progress"> = { phase: "challenge", challengeKind: "turn", message };
  for (let i = 0; i < frameCount; i++) {
    frames.push(captureFrame(source(ctx)));
    prompt({ ...base, progress: (i + 1) / frameCount });
    await sleep(220, ctx.signal);
  }

  const analyzed = await analyze(cv, [{ frames, gap: 3 }], ctx);
  const usable = analyzed.filter((a) => a.good);
  if (usable.length < 3) throw new Error("Too many frames were dark or blurry. Try again with more light.");
  const picked = diverseSubset(
    usable.map((a) => a.embedding.vector),
    o.views,
  ).map((i) => usable[i]);
  return { cv, device, picked };
}

export type ObjectScanResult = {
  /** Most likely kinds, best first. */
  kinds: KindGuess[];
  color: ObjectColor | null;
  /** Line art of the object (PNG data URL). */
  art: string;
  /** DINOv2 look of the object (mean of its views), for telling objects apart later. */
  vector: Float32Array;
};

/**
 * The object scan: a short turn of the object, isolated from its surroundings
 * (per device profile). It names the object (kind, by zero-shot recognition)
 * and its colour, and draws it as line art.
 */
export async function scanObjectKind(ctx: SessionContext): Promise<ObjectScanResult> {
  const { cv, device, picked } = await shortScan(ctx, {
    frames: 10,
    views: 4,
    message: "Turn the object slowly",
    countdown: true,
  });
  const identities = await identify(cv, device, picked, ctx);

  prompt({ phase: "processing", message: "Naming the object…" });
  const crops = picked.map((a, i) => cropAround(a.frame.full, identities[i].mask));
  const kinds = await guessKinds(device, crops);
  ctx.signal.throwIfAborted();

  const color = scanColor(picked.map((a, i) => objectColor(a.frame.full, identities[i].mask)));
  const dim = identities[0].vector.length;
  const vector = new Float32Array(dim);
  for (const id of identities) for (let j = 0; j < dim; j++) vector[j] += id.vector[j] / identities.length;

  prompt({ phase: "done", message: "Object scanned" });
  return { kinds, color, art: objectLineArt(picked[0].frame.full, identities[0].mask), vector };
}
