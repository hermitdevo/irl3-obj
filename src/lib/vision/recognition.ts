import { cosine } from "./embedder";

/** Picks up to `k` mutually diverse vectors (farthest-point sampling). */
export function diverseSubset(vectors: Float32Array[], k: number): number[] {
  if (vectors.length <= k) return vectors.map((_, i) => i);
  const chosen = [0];
  const nearest = vectors.map((v) => cosine(v, vectors[0]));
  while (chosen.length < k) {
    let pick = -1;
    let lowest = Infinity;
    nearest.forEach((s, i) => {
      if (!chosen.includes(i) && s < lowest) {
        lowest = s;
        pick = i;
      }
    });
    chosen.push(pick);
    vectors.forEach((v, i) => (nearest[i] = Math.max(nearest[i], cosine(v, vectors[pick]))));
  }
  return chosen.sort((a, b) => a - b);
}
