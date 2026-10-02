/** The object's box (with a margin) cut out of a frame, for naming it. */
export function cropAround(img: ImageData, mask: Uint8Array, margin = 0.1): ImageData {
  const { width: W, height: H } = img;
  let x0 = W,
    y0 = H,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (mask[y * W + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return img;
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * margin);
  const left = Math.max(0, x0 - pad);
  const top = Math.max(0, y0 - pad);
  const w = Math.min(W, x1 + pad + 1) - left;
  const h = Math.min(H, y1 + pad + 1) - top;
  const out = new ImageData(w, h);
  for (let y = 0; y < h; y++)
    out.data.set(img.data.subarray(((top + y) * W + left) * 4, ((top + y) * W + left + w) * 4), y * w * 4);
  return out;
}
