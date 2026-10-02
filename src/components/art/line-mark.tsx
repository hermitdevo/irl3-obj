import { ringsAt } from "@/lib/art/rings";

/**
 * A small icon in the logo's line-art style: wavy rings inside a bold outline.
 * `seed` changes the waves, `rings` how many there are, so each topic gets its
 * own mark while all of them look like one family.
 */
export function LineMark({
  seed = 0,
  rings = 4,
  className = "size-6",
  color = "text-white",
}: {
  seed?: number;
  rings?: number;
  className?: string;
  /** Tailwind text colour of the strokes. */
  color?: string;
}) {
  const { rings: inner, outline } = ringsAt(0, seed, rings);
  return (
    <svg viewBox="0 0 100 100" aria-hidden className={`${color} ${className}`}>
      <g fill="none" stroke="currentColor" strokeLinejoin="round">
        {inner.map((d, i) => (
          <path key={i} d={d} strokeWidth={3} />
        ))}
        <path d={outline} strokeWidth={6} />
      </g>
    </svg>
  );
}

/** The mark on a black tile, for card headers. */
export function MarkTile({ seed, rings }: { seed: number; rings?: number }) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-black">
      <LineMark seed={seed} rings={rings} className="size-7" />
    </span>
  );
}
