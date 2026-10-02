/** Side length of the capture used for local features. */
export const CAPTURE_SIZE = 448;
/** Side length fed to the embedding model (16 x 16 patches of 14px). */
export const EMBED_SIZE = 224;
/** Tiny grayscale thumbnail used for signal / motion analysis. */
export const TINY_SIZE = 64;
/** Fraction of the shorter frame edge covered by the guide square. */
export const GUIDE_FRACTION = 0.72;

export type FrameSource = {
  element: HTMLVideoElement | HTMLCanvasElement;
  mirrored: boolean;
  /**
   * The square to capture, in the source's pixels (display orientation, before
   * mirroring). Default: the centre GUIDE_FRACTION of the shorter side.
   */
  region?: { x: number; y: number; side: number };
};

export type CapturedFrame = {
  t: number;
  full: ImageData;
  small: ImageData;
  tiny: Uint8Array;
  quality: FrameQuality;
};

export type FrameQuality = {
  brightness: number;
  sharpness: number;
};

function sourceSize(el: HTMLVideoElement | HTMLCanvasElement) {
  return el instanceof HTMLVideoElement ? { w: el.videoWidth, h: el.videoHeight } : { w: el.width, h: el.height };
}

function context(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas is not available");
  return ctx;
}

function makeCanvas(size: number) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  return c;
}

const canvases =
  typeof document === "undefined"
    ? null
    : {
        full: makeCanvas(CAPTURE_SIZE),
        small: makeCanvas(EMBED_SIZE),
        tiny: makeCanvas(TINY_SIZE),
      };

export function isSourceReady(source: FrameSource) {
  const { w, h } = sourceSize(source.element);
  return w > 0 && h > 0;
}

/** Grabs the guide square in display space (mirrored sources are flipped back). */
export function captureFrame(source: FrameSource): CapturedFrame {
  if (!canvases) throw new Error("Capture is only available in the browser");
  const { w, h } = sourceSize(source.element);
  const side = source.region?.side ?? Math.min(w, h) * GUIDE_FRACTION;
  // A mirrored picture is shown flipped: the region's x is taken from the flipped side.
  const sx = source.region ? (source.mirrored ? w - source.region.x - side : source.region.x) : (w - side) / 2;
  const sy = source.region?.y ?? (h - side) / 2;

  const fullCtx = context(canvases.full);
  fullCtx.save();
  if (source.mirrored) {
    fullCtx.translate(CAPTURE_SIZE, 0);
    fullCtx.scale(-1, 1);
  }
  fullCtx.drawImage(source.element, sx, sy, side, side, 0, 0, CAPTURE_SIZE, CAPTURE_SIZE);
  fullCtx.restore();
  const full = fullCtx.getImageData(0, 0, CAPTURE_SIZE, CAPTURE_SIZE);

  const smallCtx = context(canvases.small);
  smallCtx.drawImage(canvases.full, 0, 0, EMBED_SIZE, EMBED_SIZE);
  const small = smallCtx.getImageData(0, 0, EMBED_SIZE, EMBED_SIZE);

  const tinyCtx = context(canvases.tiny);
  tinyCtx.drawImage(canvases.full, 0, 0, TINY_SIZE, TINY_SIZE);
  const tiny = toGray(tinyCtx.getImageData(0, 0, TINY_SIZE, TINY_SIZE));

  return { t: performance.now(), full, small, tiny, quality: measureQuality(small) };
}

export function toGray(img: ImageData): Uint8Array {
  const out = new Uint8Array(img.width * img.height);
  const d = img.data;
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    out[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
  }
  return out;
}

/** Mean brightness and variance of the Laplacian (a standard focus measure). */
export function measureQuality(img: ImageData): FrameQuality {
  const g = toGray(img);
  const w = img.width;
  const h = img.height;
  let sum = 0;
  for (let i = 0; i < g.length; i++) sum += g[i];

  let lSum = 0;
  let lSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = g[i - w] + g[i + w] + g[i - 1] + g[i + 1] - 4 * g[i];
      lSum += l;
      lSq += l * l;
      n++;
    }
  }
  const mean = lSum / n;
  return { brightness: sum / g.length, sharpness: lSq / n - mean * mean };
}

export function thumbnail(img: ImageData, size = 96, mask?: Uint8Array, grid = 16): string {
  const src = document.createElement("canvas");
  src.width = img.width;
  src.height = img.height;
  context(src).putImageData(img, 0, 0);

  const out = makeCanvas(size);
  const ctx = context(out);
  ctx.drawImage(src, 0, 0, size, size);
  if (mask) {
    // Dim everything the foreground mask rejected.
    const cell = size / grid;
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    for (let y = 0; y < grid; y++)
      for (let x = 0; x < grid; x++) if (!mask[y * grid + x]) ctx.fillRect(x * cell, y * cell, cell + 0.5, cell + 0.5);
  }
  return out.toDataURL("image/jpeg", 0.8);
}

/** Thumbnail that dims everything outside a pixel mask (capture resolution). */
export function maskedThumbnail(img: ImageData, mask: Uint8Array, size = 96): string {
  const dimmed = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) continue;
    dimmed.data[i * 4] *= 0.3;
    dimmed.data[i * 4 + 1] *= 0.3;
    dimmed.data[i * 4 + 2] *= 0.3;
  }
  return thumbnail(dimmed, size);
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(id);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
