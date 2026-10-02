"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, RotateCcw, SwitchCamera, X } from "lucide-react";
import { CameraStage } from "@/components/camera/camera-stage";
import { drawingColor, swatch, tintArt } from "@/lib/art/object-palette";
import { objectTitle, saveObject } from "@/lib/objects/object-library";
import { promptBus, type Prompt } from "@/lib/scan/prompt-bus";
import { scanObjectKind, type ObjectScanResult } from "@/lib/scan/session";
import { RingsMark } from "./rings-mark";
import { STEP_IN, StepHeader, StickyAction } from "./step-parts";
import { useCamera } from "./use-camera";

const KIND_MAX = 30;

/** A hand-typed kind: lowercase letters, spaces and hyphens only ("coffee cup"). */
function cleanKind(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z\s-]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^\s/, "")
    .slice(0, KIND_MAX);
}

/** Why a scan stopped, in words a person can act on. */
function scanError(e: unknown) {
  const raw = e instanceof Error ? e.message : String(e);
  if (/out of memory/i.test(raw))
    return "This device ran out of memory. Close other tabs, then open the page in a new tab.";
  if (/OrtRun|onnxruntime|WebGPU|device (was )?lost/i.test(raw))
    return "The scanner stopped working. Reload the page to continue.";
  return raw;
}

/** What the scan found, as shown for checking: kind guesses, colour, and the drawing in its colour. */
type Found = Pick<ObjectScanResult, "kinds" | "art"> & { color: { name: string } | null };

/**
 * Creating an object: the live camera and a Scan button. The scan names the
 * object's kind (the best guesses to choose from) and its colour; saving puts
 * it in this browser's library.
 */
export function ObjectCreate({
  onBack,
  onSaved,
  onCamera,
  label,
}: {
  onBack: () => void;
  onSaved: (id: string) => void;
  /** Whether the camera fills the column (the page drops its padding and stops scrolling). */
  onCamera?: (on: boolean) => void;
  /** Shown above the title. */
  label: string;
}) {
  const camera = useCamera();
  const [prompt, setPrompt] = useState<Prompt>(promptBus.get());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The scan: kind guesses, colour, drawing in its colour.
  const [result, setResult] = useState<Found | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  // A kind typed by hand, when none of the guesses is right ("cigarette").
  const [custom, setCustom] = useState("");
  const abort = useRef<AbortController | null>(null);
  const element = camera.element;

  useEffect(() => {
    promptBus.emit({ phase: "idle", message: "" });
    const off = promptBus.subscribe(setPrompt);
    return () => {
      off();
      abort.current?.abort();
    };
  }, []);

  const startCamera = camera.start;
  useEffect(() => {
    void startCamera();
  }, [startCamera]);

  useEffect(() => {
    const on = !result;
    onCamera?.(on);
    if (!on) return;
    // Close any keyboard, bring the header back, lock the body only.
    (document.activeElement as HTMLElement | null)?.blur?.();
    window.scrollTo(0, 0);
    const { body } = document;
    const prev = [body.style.overflow, body.style.overscrollBehavior];
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    return () => {
      [body.style.overflow, body.style.overscrollBehavior] = prev;
    };
  }, [result, onCamera]);
  useEffect(() => () => onCamera?.(false), [onCamera]);

  const scan = async () => {
    const ac = new AbortController();
    abort.current = ac;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await scanObjectKind({
        getSource: () => (element ? { element, mirrored: camera.mirrored } : null),
        signal: ac.signal,
      });
      // The drawing takes the object's colour once, here; it is saved and deployed like that.
      const art = r.art ? await tintArt(r.art, drawingColor(r.color?.name)) : r.art;
      show({ kinds: r.kinds, color: r.color ? { name: r.color.name } : null, art });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(scanError(e));
    } finally {
      setBusy(false);
      promptBus.emit({ phase: "idle", message: "" });
    }
  };

  const show = (r: Found) => {
    setResult(r);
    setKind(r.kinds[0]?.kind ?? null);
    setCustom("");
  };

  const save = () => {
    if (!result || !kind) return;
    const saved = saveObject({
      kind,
      colorName: result.color?.name ?? "unknown",
      color: swatch(result.color?.name),
      art: result.art || undefined,
    });
    onSaved(saved.id);
  };

  if (result)
    return (
      <div className={STEP_IN}>
        <StepHeader label={label} title="Is this your object?" onBack={() => setResult(null)}>
          Check what the scanner saw. Pick the right kind if the first guess is off.
        </StepHeader>

        {/* Bounded and centred: the drawing is 512 px, wider than a phone's column. */}
        <div className="mx-auto flex aspect-square w-full max-w-64 items-center justify-center rounded-3xl border border-border bg-black p-6">
          {result.art ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={result.art}
              alt="The scanned object"
              className="block h-full max-h-full w-full max-w-full object-contain"
            />
          ) : (
            <RingsMark className="size-2/3" />
          )}
        </div>

        <section className="space-y-3">
          <h2 className="text-sm font-medium">Colour</h2>
          <p className="flex items-center gap-3">
            <span
              className="size-8 rounded-full border border-white/20"
              style={{ background: swatch(result.color?.name) }}
            />
            <span className="text-lg font-semibold capitalize">{result.color?.name ?? "Unknown"}</span>
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium">What is it?</h2>
          <div role="radiogroup" aria-label="Object kind" className="grid gap-2">
            {result.kinds.map((g, i) => (
              <button
                key={g.kind}
                type="button"
                role="radio"
                aria-checked={kind === g.kind}
                onClick={() => {
                  setKind(g.kind);
                  setCustom("");
                }}
                className={`flex h-12 items-center justify-between rounded-xl border px-4 text-left transition-colors ${
                  kind === g.kind ? "border-white bg-surface-hover" : "border-border hover:border-border-strong"
                }`}
              >
                <span className="font-medium capitalize">{g.kind}</span>
                <span className="text-xs text-subtle">{i === 0 ? "Best match" : `${Math.round(g.score * 100)}%`}</span>
              </button>
            ))}
          </div>
          <label className="block space-y-2 pt-1">
            <span className="text-xs text-muted">Something else? Type what it is</span>
            <input
              value={custom}
              onChange={(e) => {
                const typed = cleanKind(e.target.value);
                setCustom(typed);
                setKind(typed.trim() ? typed.trim() : (result.kinds[0]?.kind ?? null));
              }}
              placeholder="e.g. cigarette"
              maxLength={KIND_MAX}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className={`h-12 w-full rounded-xl border bg-surface-hover px-4 text-base placeholder:text-subtle focus:outline-none ${
                custom.trim() ? "border-white" : "border-border focus:border-border-strong"
              }`}
            />
          </label>
        </section>

        <StickyAction
          disabled={!kind}
          onClick={save}
          secondary={{
            label: (
              <>
                <RotateCcw size={16} /> Scan again
              </>
            ),
            onClick: () => {
              setResult(null);
              camera.ensureLive();
            },
          }}
        >
          {kind
            ? `Save ${objectTitle({ kind, colorName: result.color?.name ?? "" })
                .toLowerCase()
                .trim()}`
            : "Save"}
        </StickyAction>
      </div>
    );

  // The camera fills the column (the screen under the header on phones).
  return (
    <div className="relative h-full w-full">
      <CameraStage
        fill
        element={element}
        mirrored={camera.mirrored}
        aspect={camera.aspect}
        prompt={prompt}
        idleHint="Center the object you want to create"
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
            {camera.error && <p className="text-sm text-red-400">{camera.error}</p>}
          </div>
        }
      >
        <button
          type="button"
          onClick={() => {
            abort.current?.abort();
            onBack();
          }}
          aria-label="Back"
          className="absolute top-4 left-4 z-20 flex size-11 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition-colors hover:bg-black/70"
        >
          <ArrowLeft size={20} />
        </button>

        {error && !busy && (
          <p className="absolute inset-x-6 bottom-32 z-20 rounded-2xl bg-black/70 px-4 py-3 text-center text-sm text-red-300 backdrop-blur-md">
            {error}
          </p>
        )}

        {
          <div className="absolute inset-x-0 bottom-8 z-20 flex items-center justify-center">
            <button
              type="button"
              onClick={busy ? () => abort.current?.abort() : scan}
              disabled={!busy && !element}
              aria-label={busy ? "Cancel" : "Scan"}
              className={`flex size-20 items-center justify-center rounded-full border-4 transition-all disabled:opacity-40 ${
                busy
                  ? "border-white/70 bg-black/50 text-white backdrop-blur-md"
                  : "border-white/40 bg-white text-black shadow-[0_0_0_4px_rgba(0,0,0,0.35)] hover:scale-105 active:scale-95"
              }`}
            >
              {busy ? <X size={28} /> : <span className="text-sm font-semibold tracking-wide">Scan</span>}
            </button>
            {element && (
              <button
                type="button"
                onClick={() => camera.start(camera.facing === "user" ? "environment" : "user")}
                disabled={busy}
                aria-label="Switch camera"
                className="absolute right-6 flex size-11 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition-colors hover:bg-black/70 disabled:opacity-40"
              >
                <SwitchCamera size={18} />
              </button>
            )}
          </div>
        }
      </CameraStage>
    </div>
  );
}
