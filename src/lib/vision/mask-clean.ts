/**
 * Tidies an object mask (one byte per pixel, non-zero = object, size x size)
 * for drawing: only the largest 8-connected piece is kept, holes inside it
 * are filled, and the outline is smoothed (a majority vote over a small
 * square, twice), so stray specks and ragged edges do not reach the line art.
 */
export function cleanMask(mask: Uint8Array, size: number, smooth = 2): Uint8Array {
  const n = size * size;
  const on = new Uint8Array(n);
  for (let i = 0; i < n; i++) on[i] = mask[i] ? 1 : 0;

  // The largest piece.
  const label = new Int32Array(n);
  let best = 0;
  let bestArea = 0;
  let next = 0;
  const stack: number[] = [];
  for (let start = 0; start < n; start++) {
    if (!on[start] || label[start]) continue;
    next++;
    let area = 0;
    label[start] = next;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      area++;
      const x = p % size;
      const y = (p - x) / size;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const q = ny * size + nx;
          if (on[q] && !label[q]) {
            label[q] = next;
            stack.push(q);
          }
        }
    }
    if (area > bestArea) {
      bestArea = area;
      best = next;
    }
  }
  if (!best) return on;
  for (let i = 0; i < n; i++) on[i] = label[i] === best ? 1 : 0;

  // Holes: background the border cannot reach is inside the object.
  const outside = new Uint8Array(n);
  for (let i = 0; i < size; i++)
    for (const p of [i, (size - 1) * size + i, i * size, i * size + size - 1])
      if (!on[p] && !outside[p]) {
        outside[p] = 1;
        stack.push(p);
      }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % size;
    const y = (p - x) / size;
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const q = ny * size + nx;
      if (!on[q] && !outside[q]) {
        outside[q] = 1;
        stack.push(q);
      }
    }
  }
  for (let i = 0; i < n; i++) if (!outside[i]) on[i] = 1;

  // Smooth the outline: each pixel takes the majority of its 5 x 5 square (a running sum keeps it fast).
  const r = 2;
  let cur = on;
  for (let pass = 0; pass < smooth; pass++) {
    const sums = new Int32Array((size + 1) * (size + 1));
    for (let y = 0; y < size; y++) {
      let row = 0;
      for (let x = 0; x < size; x++) {
        row += cur[y * size + x];
        sums[(y + 1) * (size + 1) + x + 1] = sums[y * (size + 1) + x + 1] + row;
      }
    }
    const out = new Uint8Array(n);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const x0 = Math.max(0, x - r);
        const y0 = Math.max(0, y - r);
        const x1 = Math.min(size, x + r + 1);
        const y1 = Math.min(size, y + r + 1);
        const s =
          sums[y1 * (size + 1) + x1] -
          sums[y0 * (size + 1) + x1] -
          sums[y1 * (size + 1) + x0] +
          sums[y0 * (size + 1) + x0];
        out[y * size + x] = s * 2 > (x1 - x0) * (y1 - y0) ? 1 : 0;
      }
    cur = out;
  }
  for (let i = 0; i < n; i++) cur[i] = cur[i] ? 255 : 0;
  return cur;
}
