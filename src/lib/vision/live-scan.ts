import { OBJECT_KINDS } from "@/lib/objects/object-kinds";
import { getProfile } from "@/lib/scan/profile";
import { cropAround } from "./crop";
import { embedImages, loadEmbedder, upsampleMask } from "./embedder";
import { CAPTURE_SIZE, captureFrame, isSourceReady, sleep, type CapturedFrame, type FrameSource } from "./frames";
import { grabCutMask } from "./grabcut";
import { objectLineArt } from "./line-art";
import { cleanMask } from "./mask-clean";
import { colorName, objectColor, scanColor, toLab, type ObjectColor } from "./object-color";
import { loadKindModel, scoreKinds, voteKinds } from "./object-kind";
import { loadOpenCV } from "./opencv";
import { segmentObject } from "./segmenter";

/**
 * The live object scanner behind /scan: no button, no steps. Frame after
 * frame (as fast as the device manages), it finds the object in view
 * (DINOv2's foreground patches), names its kind (MobileCLIP, zero-shot) and
 * measures its colour. The last few views vote: once kind and colour agree,
 * the scanner locks on the object. While locked it follows that object (not
 * whatever else is biggest in view), and only changes its mind when a new
 * answer holds for several views in a row.
 */

/** A box in the captured square, as fractions of its side (0-1). */
export type Box = { x: number; y: number; w: number; h: number };

export type LiveState =
  | { status: "loading"; progress: number | null }
  /** No object in view (or too dark to tell). */
  | { status: "searching"; hint: string }
  /** An object is there; not sure yet what it is. */
  | { status: "looking"; box: Box; tickMs: number }
  /** Locked on an object: what it is, and where it is now. */
  | { status: "locked"; box: Box; tickMs: number; kind: string; color: ObjectColor };

/** Views kept for the vote, and how many of them must agree. */
const WINDOW = 4;
const AGREE = 2;
/** Views in a row a new answer needs before a locked object changes (after the hold). */
const RELOCK = 4;
/**
 * After a lock, what the object is stays fixed this long (and while the badge
 * is touched): the scanner only follows it, so the badge can be read and tapped.
 */
const HOLD_MS = 3000;
/** Frames without the object before the lock is let go. */
const LOST_AFTER = 4;
/** The shortest pause between two frames (fast devices). */
const MIN_GAP_MS = 100;
/** How much a new box moves the shown one (the rest is the old one): steady, but quick to follow. */
const FOLLOW = 0.65;
/** Brightness (0-255) under which nothing can be seen. */
const TOO_DARK = 30;

const SEARCH_HINT = "Point the camera at an object";

type View = { scores: number[]; color: ObjectColor | null; top: number };
type Part = { mask: Uint8Array; box: Box; size: number };

/** Every group of touching foreground patches big enough to be an object (~3% of the view). */
function partsOf(mask: Uint8Array, grid: number): Part[] {
  const seen = new Uint8Array(mask.length);
  const out: Part[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const group: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      group.push(p);
      const x = p % grid;
      const y = (p - x) / grid;
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]) {
        if (nx < 0 || ny < 0 || nx >= grid || ny >= grid) continue;
        const q = ny * grid + nx;
        if (mask[q] && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (group.length < Math.max(4, mask.length * 0.03)) continue;
    const part = new Uint8Array(mask.length);
    let x0 = grid,
      y0 = grid,
      x1 = -1,
      y1 = -1;
    for (const p of group) {
      part[p] = 1;
      const x = p % grid;
      const y = (p - x) / grid;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    out.push({
      mask: part,
      size: group.length,
      box: { x: x0 / grid, y: y0 / grid, w: (x1 - x0 + 1) / grid, h: (y1 - y0 + 1) / grid },
    });
  }
  return out;
}

function overlap(a: Box, b: Box) {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const both = w * h;
  return both / (a.w * a.h + b.w * b.h - both || 1);
}

const centreGap = (a: Box, b: Box) => Math.hypot(a.x + a.w / 2 - b.x - b.w / 2, a.y + a.h / 2 - b.y - b.h / 2);

/**
 * The object to look at: while following one, the part that is the same
 * object as before (most overlap, or the nearest centre after a quick move);
 * otherwise the biggest part.
 */
function pick(parts: Part[], previous: Box | null): Part | null {
  if (!parts.length) return null;
  if (!previous) return parts.reduce((a, b) => (b.size > a.size ? b : a));
  const best = parts.reduce((a, b) => (overlap(b.box, previous) > overlap(a.box, previous) ? b : a));
  if (overlap(best.box, previous) > 0.1) return best;
  const near = parts.reduce((a, b) => (centreGap(b.box, previous) < centreGap(a.box, previous) ? b : a));
  return centreGap(near.box, previous) < 0.3 ? near : null;
}

const blend = (a: Box, b: Box): Box => ({
  x: a.x + (b.x - a.x) * FOLLOW,
  y: a.y + (b.y - a.y) * FOLLOW,
  w: a.w + (b.w - a.w) * FOLLOW,
  h: a.h + (b.h - a.h) * FOLLOW,
});

type Answer = { kind: string; color: ObjectColor };
const same = (a: Answer, b: Answer) => a.kind === b.kind && a.color.name === b.color.name;

/**
 * The kind and colour most views agree on, or null while they do not: the
 * voted kind must be the top guess of at least AGREE views, and so must the
 * colour.
 */
function agreed(views: View[]): Answer | null {
  if (views.length < AGREE) return null;
  const [best] = voteKinds(views.map((v) => v.scores));
  const color = scanColor(views.map((v) => v.color));
  if (!best || !color) return null;
  const index = OBJECT_KINDS.indexOf(best.kind);
  const kindVotes = views.filter((v) => v.top === index).length;
  const colorVotes = views.filter((v) => v.color?.name === color.name).length;
  return kindVotes >= AGREE && colorVotes >= AGREE ? { kind: best.kind, color } : null;
}

/**
 * Shared by the page and the scan loop. `pinned` while the person touches (or
 * points at) the badge, `touchedAt` when they last did (performance.now()):
 * the lock holds while pinned and for HOLD_MS after. `paused` stops the loop
 * (it sets `parked` once it is idle), so a one-off job can use the models.
 */
export type ScanControl = { pinned: boolean; touchedAt: number; paused: boolean; parked: boolean };

export const newScanControl = (): ScanControl => ({ pinned: false, touchedAt: 0, paused: false, parked: false });

/**
 * Runs until `signal` aborts, reporting through `onState`. `getSource` gives
 * the live picture and the square to read from it (null while it is not
 * ready).
 */
export async function runLiveScan(
  getSource: () => FrameSource | null,
  onState: (state: LiveState) => void,
  signal: AbortSignal,
  control: { current: ScanControl },
): Promise<void> {
  onState({ status: "loading", progress: null });
  const { info } = await loadEmbedder((p) => onState({ status: "loading", progress: p / 100 }));
  await loadKindModel(info.device);
  signal.throwIfAborted();
  onState({ status: "searching", hint: SEARCH_HINT });

  let views: View[] = [];
  let box: Box | null = null;
  let missing = 0;
  let locked: Answer | null = null;
  let challenger: { answer: Answer; runs: number } | null = null;
  /** Until when the lock holds: no new naming, no letting go. */
  let holdUntil = 0;
  let tickMs = 400;

  while (!signal.aborted) {
    const began = performance.now();
    if (control.current.paused) {
      control.current.parked = true;
      await sleep(80, signal);
      continue;
    }
    control.current.parked = false;
    // A hidden tab has no picture to scan (and phones throttle it): wait.
    if (document.hidden) {
      await sleep(400, signal);
      continue;
    }
    const source = getSource();
    if (!source || !isSourceReady(source)) {
      await sleep(200, signal);
      continue;
    }

    // Touching the badge holds the lock, and for HOLD_MS after letting go.
    const touched = control.current.pinned ? performance.now() : control.current.touchedAt;
    if (locked) holdUntil = Math.max(holdUntil, touched + HOLD_MS);
    const holding = !!locked && performance.now() < holdUntil;

    const frame = captureFrame(source);
    const [embedding] = await embedImages([frame.small]);
    signal.throwIfAborted();
    const dark = frame.quality.brightness < TOO_DARK;
    const part: Part | null =
      dark || embedding.maskSource === "center" ? null : pick(partsOf(embedding.mask, embedding.grid), box);

    if (!part) {
      missing++;
      // While held, a lost frame or two changes nothing: the badge stays where it was.
      if (missing >= LOST_AFTER && !holding) {
        views = [];
        box = null;
        locked = null;
        challenger = null;
        onState({ status: "searching", hint: dark ? "More light, please" : SEARCH_HINT });
      }
    } else {
      missing = 0;
      const shown: Box = box ? blend(box, part.box) : part.box;
      box = shown;
      if (holding && locked) {
        // Held: only follow the object (the naming model is skipped, which also saves the battery).
        onState({ status: "locked", box: shown, tickMs, ...locked });
        await sleep(Math.max(0, MIN_GAP_MS - (performance.now() - began)), signal);
        tickMs = tickMs * 0.7 + (performance.now() - began) * 0.3;
        continue;
      }
      const pixels = upsampleMask(part.mask, embedding.grid, CAPTURE_SIZE);
      const scores = await scoreKinds(info.device, cropAround(frame.full, pixels));
      signal.throwIfAborted();
      let top = 0;
      for (let k = 1; k < scores.length; k++) if (scores[k] > scores[top]) top = k;
      views = [...views, { scores, color: objectColor(frame.full, pixels), top }].slice(-WINDOW);

      const now = agreed(views);
      if (now && !locked) {
        locked = now;
        challenger = null;
        holdUntil = performance.now() + HOLD_MS;
      } else if (now && locked && same(now, locked)) {
        challenger = null;
      } else if (now && locked) {
        // A different answer must hold a few views in a row to replace the lock.
        challenger =
          challenger && same(challenger.answer, now)
            ? { answer: now, runs: challenger.runs + 1 }
            : { answer: now, runs: 1 };
        if (challenger.runs >= RELOCK) {
          locked = now;
          challenger = null;
          holdUntil = performance.now() + HOLD_MS;
        }
      }
      onState(locked ? { status: "locked", box: shown, tickMs, ...locked } : { status: "looking", box: shown, tickMs });
    }

    await sleep(Math.max(0, MIN_GAP_MS - (performance.now() - began)), signal);
    tickMs = tickMs * 0.7 + (performance.now() - began) * 0.3;
  }
}

/**
 * The pixels of the object's colour (by name) near the foreground, and a point
 * on them: the one nearest their middle. Null when too few pixels have it.
 */
function colourHint(img: ImageData, name: string, near: Uint8Array) {
  const { width: S, data } = img;
  const colour = new Uint8Array(S * S);
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < colour.length; i++) {
    if (!near[i]) continue;
    const lab = toLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    // Highlights and deep shadow have no colour to judge.
    if (lab[0] < 6 || lab[0] > 97 || colorName(...lab) !== name) continue;
    colour[i] = 1;
    n++;
    sx += i % S;
    sy += Math.floor(i / S);
  }
  if (n < 200) return null;
  const mx = sx / n;
  const my = sy / n;
  let point: [number, number] = [mx, my];
  let bestD = Infinity;
  for (let i = 0; i < colour.length; i++) {
    if (!colour[i]) continue;
    const d = ((i % S) - mx) ** 2 + (Math.floor(i / S) - my) ** 2;
    if (d < bestD) {
      bestD = d;
      point = [i % S, Math.floor(i / S)];
    }
  }
  return { point, colour };
}

/** The close-up with the cut tinted, the rest dimmed (PNG data URL). */
function cutPicture(img: ImageData, mask: Uint8Array) {
  const out = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  for (let i = 0; i < mask.length; i++) {
    const o = i * 4;
    if (mask[i]) {
      out.data[o] = out.data[o] * 0.5 + 40;
      out.data[o + 1] = out.data[o + 1] * 0.5 + 200 * 0.5;
      out.data[o + 2] = out.data[o + 2] * 0.5 + 255 * 0.5;
    } else for (let c = 0; c < 3; c++) out.data[o + c] *= 0.35;
  }
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext("2d")!.putImageData(out, 0, 0);
  return canvas.toDataURL("image/png");
}

/** `mask` where `limit` is on too (both one byte per pixel). */
function within(mask: Uint8Array, limit: Uint8Array) {
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] && limit[i] ? 255 : 0;
  return out;
}

/**
 * Whether a cut of the close-up took more than the object: the object sits in
 * the middle with air around it, so a mask covering most of the square, or
 * lying along two of its sides, is the surroundings.
 */
function spills(mask: Uint8Array, size: number) {
  let on = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) on++;
  if (on > mask.length * 0.6) return true;
  const share = (at: (k: number) => number) => {
    let n = 0;
    for (let k = 0; k < size; k++) if (mask[at(k)]) n++;
    return n / size;
  };
  const sides = [
    share((k) => k),
    share((k) => (size - 1) * size + k),
    share((k) => k * size),
    share((k) => k * size + size - 1),
  ].filter((s) => s > 0.25).length;
  return sides >= 2;
}

/** Colour names with no hue: the object's colour does not set it apart from shadows or a dark table. */
const ACHROMATIC = new Set(["black", "white", "gray", "silver"]);

/** Air around the object in its close-up (the object spans about 1/AIR of it). */
const CLOSE_UP_AIR = 1.5;
/** Close-ups taken when saving an object; the sharpest is kept. */
const CLOSE_UPS = 4;

/** A square around the object (its box in the scanner's square), with air, in the picture's pixels. */
function closeUp(source: FrameSource, box: Box) {
  const el = source.element;
  const w = el instanceof HTMLVideoElement ? el.videoWidth : el.width;
  const h = el instanceof HTMLVideoElement ? el.videoHeight : el.height;
  const r = source.region ?? { x: 0, y: 0, side: Math.min(w, h) };
  const cx = r.x + (box.x + box.w / 2) * r.side;
  const cy = r.y + (box.y + box.h / 2) * r.side;
  const side = Math.min(Math.max(Math.max(box.w, box.h) * r.side * CLOSE_UP_AIR, 64), w, h);
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  return { x: clamp(cx - side / 2, w - side), y: clamp(cy - side / 2, h - side), side };
}

/**
 * The line art of the object the scanner is locked on, made to be kept: the
 * live loop pauses, a few close-ups of the object are taken (it fills them,
 * so far more of its detail is drawn) and the sharpest is kept; the object is
 * isolated precisely (SAM on capable devices, else GrabCut at full resolution
 * with more rounds), the mask is tidied, then drawn. "" if nothing could be.
 */
export async function lockedObjectArt(
  getSource: () => FrameSource | null,
  getBox: () => Box | null,
  control: { current: ScanControl },
  /** The colour the scanner locked on: it tells the object from its shadow, a hand, the table. */
  color: ObjectColor,
  /** For checking cuts: receives the close-up with the cut shown on it (PNG data URL). */
  onCut?: (picture: string) => void,
): Promise<string> {
  control.current.paused = true;
  try {
    // The loop finishes the frame it is on first.
    const until = performance.now() + 5000;
    while (!control.current.parked && performance.now() < until) await sleep(50);
    const { info } = await loadEmbedder();

    let best: CapturedFrame | null = null;
    for (let i = 0; i < CLOSE_UPS; i++) {
      const source = getSource();
      const box = getBox();
      if (source && box && isSourceReady(source)) {
        const frame = captureFrame({ ...source, region: closeUp(source, box) });
        if (!best || frame.quality.sharpness > best.quality.sharpness) best = frame;
      }
      if (i < CLOSE_UPS - 1) await sleep(120);
    }
    if (!best) return "";

    // In the close-up, the object is the part nearest the middle.
    const [embedding] = await embedImages([best.small]);
    const middle: Box = { x: 0.3, y: 0.3, w: 0.4, h: 0.4 };
    const parts = partsOf(embedding.mask, embedding.grid);
    const part = parts.length
      ? parts.reduce((a, b) => (centreGap(b.box, middle) < centreGap(a.box, middle) ? b : a))
      : null;
    const coarse = part?.mask ?? embedding.mask;
    // Only a clearly coloured object is told apart by its colour (a black one would match a black table).
    const hint = ACHROMATIC.has(color.name)
      ? null
      : colourHint(best.full, color.name, upsampleMask(embedding.mask, embedding.grid, CAPTURE_SIZE, true));

    let pixels: Uint8Array | null = null;
    try {
      if (getProfile().segmenter === "sam") {
        const seg = await segmentObject(info.device, best.full, coarse, embedding.grid, hint ?? undefined);
        if (seg.source === "sam") pixels = seg.mask;
      }
      if (!pixels) {
        const { cv } = await loadOpenCV();
        pixels = grabCutMask(cv, best.full, coarse, embedding.grid, {
          fullSize: true,
          rounds: 5,
          sure: hint?.colour,
          sureLeads: !!hint,
          band: 1,
        });
      }
    } catch (e) {
      console.warn("Precise isolation failed; drawing from the coarse mask:", e);
    }
    // Never beyond the object's own patches (and one patch of margin): the table, the wall stay out.
    const near = upsampleMask(coarse, embedding.grid, CAPTURE_SIZE, true);
    const tight = upsampleMask(coarse, embedding.grid, CAPTURE_SIZE);
    if (!pixels) pixels = tight;
    pixels = within(pixels, near);
    // A cut that runs off the close-up took the surroundings: keep only its part on the object's patches.
    if (spills(pixels, CAPTURE_SIZE)) pixels = within(pixels, tight);
    if (spills(pixels, CAPTURE_SIZE)) pixels = tight;
    const mask = cleanMask(pixels, CAPTURE_SIZE);
    if (onCut) onCut(cutPicture(best.full, mask));
    return objectLineArt(best.full, mask);
  } finally {
    control.current.paused = false;
  }
}
