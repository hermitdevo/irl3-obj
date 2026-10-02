"use client";

import { useEffect, useRef } from "react";

/**
 * A layer that drifts a few pixels toward the pointer (anywhere on the page),
 * eased by a CSS transition; still for people who prefer reduced motion.
 */
export function DriftLayer({
  children,
  amount = 10,
  className = "",
}: {
  children: React.ReactNode;
  /** Largest shift in pixels, at the window's edges. */
  amount?: number;
  className?: string;
}) {
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = layer.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const x = (e.clientX / window.innerWidth - 0.5) * 2;
        const y = (e.clientY / window.innerHeight - 0.5) * 2;
        el.style.transform = `translate3d(${(x * amount).toFixed(2)}px, ${(y * amount).toFixed(2)}px, 0)`;
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
    };
  }, [amount]);

  return (
    <div
      ref={layer}
      aria-hidden
      className={`transition-transform duration-700 ease-out will-change-transform ${className}`}
    >
      {children}
    </div>
  );
}
