"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Boxes, Check, Loader2, Lock, Plus, SwitchCamera, X } from "lucide-react";
import scanDrawing from "@/assets/effect.png";
import scanPhoto from "@/assets/right-photo.png";
import { LineMark } from "@/components/art/line-mark";
import { useCamera } from "@/components/library/use-camera";
import { SideVisual } from "@/components/layout/side-visual";
import { SplitPage } from "@/components/layout/split-page";
import { CameraStage } from "@/components/camera/camera-stage";
import { drawingColor, swatch, tintArt } from "@/lib/art/object-palette";
import { saveObject, useObjectLibrary, type LibraryObject } from "@/lib/objects/object-library";
import type { FrameSource } from "@/lib/vision/frames";
import {
  type Box,
  type LiveState,
  type ScanControl,
  lockedObjectArt,
  newScanControl,
  runLiveScan,
} from "@/lib/vision/live-scan";

type Toast = { title: string; art: string | null; color: string; cut?: string };

/** Badge width (px) at most; narrower stages get their width less a margin. */
const BADGE_WIDTH = 304;
const EDGE = 12;
/** Gap between the object and its badge (the badge's pointer sits in it). */
const GAP = 16;
/** Room kept clear for the status chip at the top and the buttons at the bottom. */
const TOP_ROOM = 56;
const BOTTOM_ROOM = 76;
/** Share of the visible picture's shorter side that is read (the rest is a margin). */
const READ_SHARE = 0.96;

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const sizeOf = (p: HTMLVideoElement | HTMLCanvasElement) =>
  p instanceof HTMLVideoElement ? { w: p.videoWidth, h: p.videoHeight } : { w: p.width, h: p.height };

type Live = {
  element: HTMLVideoElement | HTMLCanvasElement | null;
  mirrored: boolean;
  size: { w: number; h: number } | null;
  box: Box | null;
};

/** The picture for the scanner, with the square to read from it (null until both are known). */
function sourceOf({ element, mirrored, size }: Live): FrameSource | null {
  const view = element && size ? viewOf(element, size) : null;
  return element && view ? { element, mirrored, region: view.region } : null;
}

/**
 * The square the scanner reads: the biggest square inside the part of the
 * picture that shows on the stage (the picture covers the stage, centred), in
 * the picture's pixels and in the stage's.
 */
function viewOf(picture: HTMLVideoElement | HTMLCanvasElement, stage: { w: number; h: number }) {
  const { w, h } = sizeOf(picture);
  if (!w || !h || !stage.w || !stage.h) return null;
  const scale = Math.max(stage.w / w, stage.h / h);
  const side = Math.min(stage.w / scale, stage.h / scale, w, h) * READ_SHARE;
  return {
    region: { x: (w - side) / 2, y: (h - side) / 2, side },
    stage: { left: stage.w / 2 - (side * scale) / 2, top: stage.h / 2 - (side * scale) / 2, side: side * scale },
  };
}

/**
 * Scan the World: the full camera, started by itself. Point it at an object:
 * brackets find it, and once the scanner knows what it is (kind and colour) it
 * locks on and a badge on the object says what it is and whether it is in
 * your library. A new object can be created from there in one tap.
 */
export function ScanView() {
  const camera = useCamera();
  const library = useObjectLibrary();
  const [state, setState] = useState<LiveState>({ status: "loading", progress: null });
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  // Shared with the scan loop: touching the badge holds the lock; saving an object pauses the loop.
  const control = useRef<ScanControl>(newScanControl());
  const touch = (pinned: boolean) => {
    control.current.pinned = pinned;
    control.current.touchedAt = performance.now();
  };
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [badge, setBadge] = useState<HTMLDivElement | null>(null);
  const [badgeHeight, setBadgeHeight] = useState(0);

  const element = camera.element;
  const mirrored = camera.mirrored;

  // What the scan loop reads on every frame: the picture, the stage it fills, and the object's box.
  const live = useRef<Live>({ element: null, mirrored: false, size: null, box: null });
  const box = state.status === "looking" || state.status === "locked" ? state.box : null;
  useEffect(() => {
    live.current = { element, mirrored, size, box };
  }, [element, mirrored, size, box]);

  const startCamera = camera.start;
  useEffect(() => {
    void startCamera();
  }, [startCamera]);

  // The scan loop: models load once, then it runs until the page closes.
  useEffect(() => {
    const ac = new AbortController();
    runLiveScan(() => sourceOf(live.current), setState, ac.signal, control).catch((e) => {
      if (ac.signal.aborted) return;
      console.error("Live scan stopped:", e);
      setError(
        /memory|alloc|OOM/i.test(String(e))
          ? "This device ran out of memory for the scanner. Close other tabs and try again."
          : "The scanner stopped. Try again.",
      );
    });
    return () => ac.abort();
  }, [run]);

  // Like the other camera screens: no keyboard, no page scroll while it is on.
  useEffect(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    window.scrollTo(0, 0);
    const { body } = document;
    const prev = [body.style.overflow, body.style.overscrollBehavior];
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    return () => {
      [body.style.overflow, body.style.overscrollBehavior] = prev;
    };
  }, []);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    // Measured at once too: the observer only reports on the next paint.
    const first = el.getBoundingClientRect();
    setSize({ w: first.width, h: first.height });
    const observer = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!badge) return;
    const observer = new ResizeObserver(([entry]) => setBadgeHeight(entry.contentRect.height));
    observer.observe(badge);
    return () => observer.disconnect();
  }, [badge]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.cut ? 30_000 : 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  const key = state.status === "locked" ? `${state.kind}|${state.color.name}` : null;

  /** Saves the locked object to the library: its drawing in its colour, its kind and colour. */
  const save = async () => {
    if (state.status !== "locked" || saving) return;
    const { kind, color } = state;
    setSaving(`${kind}|${color.name}`);
    // In development, ?debug=1 shows the close-up and its cut in the notice, to check what the cut took.
    const debug = process.env.NODE_ENV !== "production" && new URLSearchParams(window.location.search).has("debug");
    let cut: string | undefined;
    try {
      const raw = await lockedObjectArt(
        () => sourceOf(live.current),
        () => live.current.box,
        control,
        color,
        debug ? (picture) => (cut = picture) : undefined,
      );
      const art = raw ? await tintArt(raw, drawingColor(color.name)) : "";
      saveObject({ kind, colorName: color.name, color: swatch(color.name), art: art || undefined });
      setToast({ title: capital(`${color.name} ${kind}`), art: art || null, color: color.name, cut });
    } catch (e) {
      console.error("Could not save the object:", e);
      setError("Could not save the object. Try again.");
    } finally {
      setSaving(null);
    }
  };

  const tracking = state.status === "looking" || state.status === "locked" ? state : null;
  const view = size && element ? viewOf(element, size) : null;
  const place = size && view && tracking ? placeOf(tracking.box, view.stage, size, badgeHeight) : null;
  // Brackets and badge glide to each new position over about one frame of the scanner: smooth, not late.
  const follow = `${Math.round(Math.min(700, Math.max(150, tracking?.tickMs ?? 300)))}ms`;
  const match =
    state.status === "locked"
      ? (library.find((o) => o.kind === state.kind && o.colorName === state.color.name) ?? null)
      : null;

  return (
    <SplitPage camera visual={<SideVisual photo={scanPhoto} drawing={scanDrawing} />}>
      <div ref={stage} className="relative h-full w-full">
        <CameraStage
          fill
          bare
          element={element}
          mirrored={mirrored}
          aspect={camera.aspect}
          prompt={{ phase: "idle", message: "" }}
          placeholder={
            <div className="flex flex-col items-center gap-3 px-6 text-center">
              <button
                type="button"
                onClick={() => camera.start()}
                disabled={camera.status === "loading"}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-medium text-black disabled:opacity-60"
              >
                {camera.status === "loading" ? "Opening camera…" : "Start camera"}
              </button>
              {camera.error && <p className="max-w-xs text-sm text-red-400">{camera.error}</p>}
            </div>
          }
        >
          {element && (
            <>
              {/* A soft shade at the top and bottom, so the controls read on any picture. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.45),transparent_22%,transparent_78%,rgba(0,0,0,0.5))]"
              />
              <StatusChip state={state} />
            </>
          )}

          {element && state.status === "searching" && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="relative flex size-24 items-center justify-center">
                <span className="absolute inset-0 animate-ping rounded-full border border-white/30 [animation-duration:2.4s]" />
                <LineMark seed={29} rings={4} className="size-14 opacity-70" />
              </span>
            </div>
          )}

          {place && <ObjectFrame place={place} locked={state.status === "locked"} follow={follow} lockKey={key} />}

          {place && state.status === "locked" && (
            <div
              ref={setBadge}
              onPointerEnter={() => touch(true)}
              onPointerDown={() => touch(true)}
              onPointerLeave={() => touch(false)}
              onPointerUp={(e) => e.pointerType !== "mouse" && touch(false)}
              className="absolute z-20 transition-[left,top] ease-out"
              style={{
                left: place.badgeLeft,
                top: place.badgeTop,
                width: place.badgeWidth,
                transitionDuration: follow,
              }}
            >
              <ObjectBadge
                key={key}
                kind={state.kind}
                color={state.color.name}
                match={match}
                pointer={place.pointer}
                saving={saving === key}
                onSave={save}
              />
            </div>
          )}

          {toast && (
            <div className="absolute inset-x-0 top-16 z-30 flex justify-center px-4">
              <div className="flex w-full max-w-sm animate-[modal-in_220ms_ease-out] items-center gap-3 rounded-2xl border border-white/15 bg-black/85 p-3 pr-2 text-white shadow-[0_16px_50px_rgba(0,0,0,0.6)] backdrop-blur-xl">
                <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-black ring-1 ring-white/10">
                  {toast.art ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={toast.art} alt="" className="size-full object-contain p-1" />
                  ) : (
                    <span className="size-5 rounded-full" style={{ background: swatch(toast.color) }} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <Check size={15} className="text-emerald-400" /> Object created
                  </span>
                  <span className="block truncate text-xs text-white/65">{toast.title} is in your library</span>
                </span>
                <Link
                  href="/library"
                  className="flex h-9 shrink-0 items-center rounded-full bg-white px-3.5 text-xs font-semibold text-black"
                >
                  Open
                </Link>
                <button
                  type="button"
                  onClick={() => setToast(null)}
                  aria-label="Close"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full text-white/60 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>
              {toast.cut && toast.art && (
                // Debug (?debug=1): what the cut took, and what was drawn from it.
                <div className="absolute top-full left-1/2 mt-2 grid w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 grid-cols-2 gap-2 rounded-2xl bg-black/85 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={toast.cut} alt="The cut" className="w-full rounded-lg" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={toast.art} alt="The drawing" className="w-full rounded-lg bg-black" />
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="absolute inset-x-6 bottom-28 z-30 flex flex-col items-center gap-3 rounded-2xl bg-black/80 px-4 py-4 text-center backdrop-blur-md">
              <p className="text-sm text-red-300">{error}</p>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  // A failed save leaves the scanner running; only a stopped scanner starts again.
                  if (/scanner|memory/.test(error)) {
                    setState({ status: "loading", progress: null });
                    setRun((n) => n + 1);
                  }
                }}
                className="h-10 rounded-full bg-white px-5 text-sm font-semibold text-black"
              >
                {/scanner|memory/.test(error) ? "Try again" : "OK"}
              </button>
            </div>
          )}

          {element && (
            <div className="absolute inset-x-4 bottom-6 z-20 flex items-center justify-between">
              <Link
                href="/library"
                aria-label="Object Library"
                className="relative flex size-12 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition-colors hover:bg-black/70"
              >
                <Boxes size={20} />
                {library.length > 0 && (
                  <span className="absolute -top-1 -right-1 flex min-w-5 items-center justify-center rounded-full bg-white px-1 text-[11px] font-semibold text-black tabular-nums">
                    {library.length}
                  </span>
                )}
              </Link>
              {camera.element && (
                <button
                  type="button"
                  onClick={() => camera.start(camera.facing === "user" ? "environment" : "user")}
                  aria-label="Switch camera"
                  className="flex size-12 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition-colors hover:bg-black/70"
                >
                  <SwitchCamera size={20} />
                </button>
              )}
            </div>
          )}
        </CameraStage>
      </div>
    </SplitPage>
  );
}

/** What the scanner is doing, at the top of the picture. */
function StatusChip({ state }: { state: LiveState }) {
  const content =
    state.status === "loading" ? (
      <>
        <Loader2 size={15} className="shrink-0 animate-spin" />
        Loading the scanner{state.progress ? ` · ${Math.round(state.progress * 100)}%` : "…"}
      </>
    ) : state.status === "searching" ? (
      <>
        <span className="size-2 shrink-0 animate-pulse rounded-full bg-white" />
        {state.hint}
      </>
    ) : state.status === "looking" ? (
      <>
        <Loader2 size={15} className="shrink-0 animate-spin" />
        Recognizing…
      </>
    ) : (
      <>
        <Lock size={14} className="shrink-0" />
        Locked on the {state.color.name} {state.kind}
      </>
    );
  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center px-4">
      <span
        className={`flex max-w-full items-center gap-2 rounded-full px-4 py-2 text-sm font-medium backdrop-blur-md transition-colors ${
          state.status === "locked" ? "bg-white text-black" : "bg-black/55 text-white"
        }`}
      >
        {content}
      </span>
    </div>
  );
}

type Place = {
  left: number;
  top: number;
  width: number;
  height: number;
  badgeLeft: number;
  badgeTop: number;
  badgeWidth: number;
  /** Where the badge points at the object: its side, and the x inside the badge (px). */
  pointer: { side: "top" | "bottom" | "none"; x: number };
};

/** Where the object is on the stage, and where its badge goes: above it if it fits, else below, else inside. */
function placeOf(
  box: Box,
  square: { left: number; top: number; side: number },
  size: { w: number; h: number },
  badgeHeight: number,
): Place {
  const left = Math.max(0, square.left + box.x * square.side);
  const top = Math.max(0, square.top + box.y * square.side);
  const right = Math.min(size.w, square.left + (box.x + box.w) * square.side);
  const bottom = Math.min(size.h, square.top + (box.y + box.h) * square.side);
  const badgeWidth = Math.min(BADGE_WIDTH, size.w - EDGE * 2);
  const centre = (left + right) / 2;
  const badgeLeft = Math.min(Math.max(centre - badgeWidth / 2, EDGE), size.w - EDGE - badgeWidth);
  const above = top - GAP - badgeHeight;
  const under = bottom + GAP;
  const fitsAbove = above >= TOP_ROOM;
  const fitsUnder = under + badgeHeight <= size.h - BOTTOM_ROOM;
  // Neither fits (a big object, a narrow picture): the badge sits low, over the buttons' line, like a sheet.
  const badgeTop = fitsAbove ? above : fitsUnder ? under : Math.max(TOP_ROOM, size.h - BOTTOM_ROOM - badgeHeight);
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    badgeLeft,
    badgeTop,
    badgeWidth,
    pointer: {
      side: fitsAbove ? "bottom" : fitsUnder ? "top" : "none",
      x: Math.min(Math.max(centre - badgeLeft, 24), badgeWidth - 24),
    },
  };
}

/** Corner brackets around the object, following it; once locked they turn solid and pulse once. */
function ObjectFrame({
  place,
  locked,
  follow,
  lockKey,
}: {
  place: Place;
  locked: boolean;
  follow: string;
  lockKey: string | null;
}) {
  const corner = `absolute size-6 border-[3px] transition-colors duration-300 ${
    locked ? "border-white drop-shadow-[0_0_10px_rgba(255,255,255,0.75)]" : "border-white/55"
  }`;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-10 transition-[left,top,width,height] ease-out"
      style={{ left: place.left, top: place.top, width: place.width, height: place.height, transitionDuration: follow }}
    >
      {/* A new lock pulses once (keyed by what was locked on). */}
      <div key={lockKey ?? "none"} className={`absolute -inset-1 ${locked ? "animate-[modal-in_350ms_ease-out]" : ""}`}>
        {locked && <div className="absolute inset-1 rounded-2xl bg-white/[0.06] ring-1 ring-white/25" />}
        <span className={`${corner} top-0 left-0 rounded-tl-2xl border-r-0 border-b-0`} />
        <span className={`${corner} top-0 right-0 rounded-tr-2xl border-b-0 border-l-0`} />
        <span className={`${corner} bottom-0 left-0 rounded-bl-2xl border-t-0 border-r-0`} />
        <span className={`${corner} right-0 bottom-0 rounded-br-2xl border-t-0 border-l-0`} />
      </div>
    </div>
  );
}

/** What the locked object is, whether it is in the library, and creating it there. */
function ObjectBadge({
  kind,
  color,
  match,
  pointer,
  saving,
  onSave,
}: {
  kind: string;
  color: string;
  /** The same object (kind and colour) in the library, if it is there. */
  match: LibraryObject | null;
  pointer: Place["pointer"];
  saving: boolean;
  onSave: () => void;
}) {
  const title = capital(`${color} ${kind}`);
  return (
    <div className="relative animate-[modal-in_220ms_ease-out]">
      {pointer.side !== "none" && (
        <span
          aria-hidden
          className={`absolute size-3.5 rotate-45 border-white/15 bg-neutral-950 ${
            pointer.side === "bottom" ? "-bottom-[7px] border-r border-b" : "-top-[7px] border-t border-l"
          }`}
          style={{ left: pointer.x - 7 }}
        />
      )}
      <div className="overflow-hidden rounded-[22px] border border-white/15 bg-neutral-950/90 text-white shadow-[0_18px_60px_rgba(0,0,0,0.65)] backdrop-blur-2xl">
        <div className="flex items-center gap-3 p-4">
          {match?.art ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local picture
            <img
              src={match.art}
              alt=""
              className="size-11 shrink-0 rounded-xl bg-black object-contain p-1 ring-1 ring-white/10"
            />
          ) : (
            <span
              className="size-9 shrink-0 rounded-full ring-2 ring-white/15 ring-offset-2 ring-offset-neutral-950"
              style={{ background: swatch(color) }}
            />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] leading-tight font-semibold">{title}</span>
            <span className="mt-0.5 block truncate text-xs text-white/55">
              {match ? "In your library" : "Not in your library yet"}
            </span>
          </span>
        </div>

        {match ? (
          <Link
            href="/library"
            className="flex h-12 items-center justify-center gap-1.5 border-t border-white/10 text-sm font-medium transition-colors hover:bg-white/10"
          >
            <Check size={15} className="text-emerald-400" /> Open the library
          </Link>
        ) : (
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="flex h-12 w-full items-center justify-center gap-1.5 border-t border-white/10 text-sm font-medium transition-colors hover:bg-white/10 disabled:hover:bg-transparent"
          >
            {saving ? (
              <>
                <Loader2 size={15} className="animate-spin" /> Creating…
              </>
            ) : (
              <>
                <Plus size={16} /> Create object
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
