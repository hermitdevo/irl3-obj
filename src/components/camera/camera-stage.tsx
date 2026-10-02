"use client";

import { useEffect, useRef, useState } from "react";
import { GUIDE_FRACTION } from "@/lib/vision/frames";
import { Camera, Check, CircleAlert, Focus, Hand, Loader2, Rotate3d, RotateCw } from "lucide-react";
import type { Prompt } from "@/lib/scan/prompt-bus";

type CameraStageProps = {
  /** Live element to show: the camera <video>. */
  element: HTMLVideoElement | HTMLCanvasElement | null;
  mirrored: boolean;
  aspect: number;
  prompt: Prompt;
  placeholder?: React.ReactNode;
  /**
   * Fill the parent edge to edge (the picture is cropped to cover it) instead
   * of a box with the picture's own proportions.
   */
  fill?: boolean;
  /** Controls drawn over the picture (buttons, results). */
  children?: React.ReactNode;
  /** Shown just above the aiming frame while nothing is running. */
  idleHint?: string;
  /** Only the picture: no aiming frame, veil or guidance (the page draws its own). */
  bare?: boolean;
};

/** Side of the square aiming frame, as a share of the stage's shorter side. */
const FRAME = 0.64;

type Box = { left: number; top: number; width: number; height: number };

/** The aiming frame's box in percent of the stage (it is square and centered). */
function frameBox(aspect: number): Box {
  const a = aspect || 4 / 3;
  const w = a >= 1 ? (FRAME / a) * 100 : FRAME * 100;
  const h = a >= 1 ? FRAME * 100 : FRAME * a * 100;
  return { left: (100 - w) / 2, top: (100 - h) / 2, width: w, height: h };
}

/**
 * The aiming frame over a picture that covers a stage of `w` x `h` pixels:
 * the square the scan actually captures (the centre GUIDE_FRACTION of the
 * picture's shorter side), kept inside the visible area.
 */
function coverBox(aspect: number, w: number, h: number): Box {
  const a = aspect || 4 / 3;
  const scale = Math.max(w / a, h); // picture units: width a, height 1
  const side = Math.min(GUIDE_FRACTION * Math.min(a, 1) * scale, 0.86 * Math.min(w, h));
  const width = (side / w) * 100;
  const height = (side / h) * 100;
  return { left: (100 - width) / 2, top: (100 - height) / 2, width, height };
}

export function CameraStage({
  element,
  mirrored,
  aspect,
  prompt,
  placeholder,
  fill = false,
  children,
  idleHint,
  bare = false,
}: CameraStageProps) {
  const host = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el || !element) return;
    el.appendChild(element);
    // Safari pauses a video taken out of the page and does not resume it when
    // it comes back (the picture freezes): play it again on every mount.
    if (element instanceof HTMLVideoElement && element.paused) element.play().catch(() => {});
    return () => {
      if (element.parentElement === el) el.removeChild(element);
    };
  }, [element]);

  // A filled stage takes its parent's shape: measure it to place the aiming frame.
  useEffect(() => {
    const el = shell.current;
    if (!fill || !el) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [fill]);

  const active = ["position", "challenge", "sweep", "processing"].includes(prompt.phase);
  const box = fill && size ? coverBox(aspect, size.w, size.h) : frameBox(aspect);

  return (
    <div
      ref={shell}
      className={
        fill
          ? "relative h-full w-full overflow-hidden bg-black [&_canvas]:object-cover [&_video]:object-cover"
          : "relative w-full overflow-hidden rounded-2xl border border-border bg-black"
      }
      style={fill ? undefined : { aspectRatio: String(aspect || 4 / 3) }}
    >
      <div ref={host} className="absolute inset-0" style={{ transform: mirrored ? "scaleX(-1)" : undefined }} />

      {!element && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted">
          <Camera size={28} />
          {placeholder}
        </div>
      )}

      {element && !bare && (
        <>
          <FrameVeil box={box} />
          <AimingFrame box={box} active={active} done={prompt.phase === "done"} />
          <Guidance prompt={prompt} box={box} />
          {idleHint && prompt.phase === "idle" && (
            <div
              className="pointer-events-none absolute inset-x-0 flex justify-center px-6 pb-4"
              style={{ bottom: `${100 - box.top}%` }}
            >
              <p className="max-w-xs text-center text-base leading-snug font-semibold text-balance text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]">
                {idleHint}
              </p>
            </div>
          )}
        </>
      )}
      {children}
    </div>
  );
}

/** Blurs and dims everything outside the aiming frame, so the eye goes to the object. */
function FrameVeil({ box }: { box: Box }) {
  const veil = "pointer-events-none absolute bg-black/35 backdrop-blur-md";
  const right = 100 - box.left - box.width;
  const bottom = 100 - box.top - box.height;
  return (
    <div aria-hidden>
      <div className={veil} style={{ left: 0, right: 0, top: 0, height: `${box.top}%` }} />
      <div className={veil} style={{ left: 0, right: 0, bottom: 0, height: `${bottom}%` }} />
      <div className={veil} style={{ left: 0, width: `${box.left}%`, top: `${box.top}%`, height: `${box.height}%` }} />
      <div className={veil} style={{ right: 0, width: `${right}%`, top: `${box.top}%`, height: `${box.height}%` }} />
    </div>
  );
}

/** Corner brackets around the aiming frame; they brighten while a scan runs. */
function AimingFrame({ box, active, done }: { box: Box; active: boolean; done: boolean }) {
  const tone = done ? "border-emerald-400" : active ? "border-white" : "border-white/50";
  const corner = `absolute size-[16%] border-[3px] transition-colors duration-300 ${tone}`;
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute transition-transform duration-500 ${active ? "scale-[1.02]" : ""}`}
      style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%` }}
    >
      <div className="absolute inset-0 rounded-3xl ring-1 ring-white/10" />
      <span className={`${corner} top-0 left-0 rounded-tl-3xl border-r-0 border-b-0`} />
      <span className={`${corner} top-0 right-0 rounded-tr-3xl border-b-0 border-l-0`} />
      <span className={`${corner} bottom-0 left-0 rounded-bl-3xl border-t-0 border-r-0`} />
      <span className={`${corner} right-0 bottom-0 rounded-br-3xl border-t-0 border-l-0`} />
    </div>
  );
}

const STEP_HINT = {
  hold: "keep it steady",
  turn: "turn it slowly, any direction",
  side: "keep turning until a side shows",
} as const;

/** The icon that shows what to do now, and whether it moves (turning steps spin slowly). */
function stepIcon(prompt: Prompt) {
  if (prompt.phase === "error") return { Icon: CircleAlert, spin: false };
  if (prompt.phase === "done" || (prompt.phase === "challenge" && (prompt.progress ?? 0) >= 1))
    return { Icon: Check, spin: false };
  if (prompt.phase === "processing" || prompt.phase === "loading") return { Icon: Loader2, spin: true };
  if (prompt.phase === "position") return { Icon: Focus, spin: false };
  if (prompt.phase === "sweep") return { Icon: RotateCw, spin: true };
  const kind = prompt.challengeKind ?? "turn";
  if (kind === "hold") return { Icon: Hand, spin: false };
  return { Icon: kind === "side" ? Rotate3d : RotateCw, spin: true };
}

const shadow = "drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]";

/**
 * Guidance around the aiming frame: a big icon just above it (with a ring
 * that fills as the step progresses) and the instruction just below it.
 */
function Guidance({ prompt, box }: { prompt: Prompt; box: Box }) {
  if (prompt.phase === "idle" || !prompt.message) return null;
  const { Icon, spin } = stepIcon(prompt);
  const done = prompt.phase === "done" || (prompt.phase === "challenge" && (prompt.progress ?? 0) >= 1);
  const tone =
    prompt.phase === "error"
      ? "text-red-400"
      : done
        ? "text-emerald-400"
        : prompt.warn
          ? "text-amber-400"
          : "text-white";
  const progress = typeof prompt.progress === "number" ? Math.max(0, Math.min(1, prompt.progress)) : null;
  const ring = 2 * Math.PI * 26;
  const challenge = prompt.phase === "challenge";
  const kind = prompt.challengeKind ?? "turn";
  return (
    <>
      <div
        className="pointer-events-none absolute inset-x-0 flex justify-center pb-2"
        style={{ bottom: `${100 - box.top}%` }}
      >
        <div className={`relative flex size-14 items-center justify-center ${tone} ${shadow}`}>
          {progress !== null && (
            <svg viewBox="0 0 60 60" className="absolute inset-0 -rotate-90">
              <circle cx="30" cy="30" r="26" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
              <circle
                cx="30"
                cy="30"
                r="26"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={ring}
                strokeDashoffset={ring * (1 - progress)}
                className="transition-[stroke-dashoffset] duration-150"
              />
            </svg>
          )}
          <Icon size={28} strokeWidth={2.4} className={spin ? "animate-[spin_2.4s_linear_infinite]" : ""} />
        </div>
      </div>
      <div
        className="pointer-events-none absolute inset-x-0 flex flex-col items-center gap-0.5 px-4 pt-2 text-center"
        style={{ top: `${box.top + box.height}%` }}
      >
        <p
          className={`line-clamp-3 max-w-full text-base leading-snug font-semibold break-words text-balance ${tone} ${shadow}`}
        >
          {prompt.message}
        </p>
        {challenge && prompt.steps && prompt.steps > 1 && (
          <p className={`text-xs text-white/70 ${shadow}`}>
            Step {prompt.step} of {prompt.steps} · {STEP_HINT[kind]}
          </p>
        )}
      </div>
    </>
  );
}
