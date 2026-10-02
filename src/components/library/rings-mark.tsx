import { ringsAt } from "@/lib/art/rings";

/** A still ring mark in the line-art style, for an object without a drawing. */
export function RingsMark({ className = "", seed = 7 }: { className?: string; seed?: number }) {
  const { rings, outline } = ringsAt(0, seed, 4);
  return (
    <svg viewBox="0 0 100 100" aria-hidden className={`text-white ${className}`}>
      <g fill="none" stroke="currentColor" strokeLinejoin="round">
        {rings.map((d, i) => (
          <path key={i} d={d} strokeWidth={2} />
        ))}
        <path d={outline} strokeWidth={3.5} />
      </g>
    </svg>
  );
}
