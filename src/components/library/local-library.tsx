"use client";

import Link from "next/link";
import { useState } from "react";
import { Download, FileUp, Plus, Trash2 } from "lucide-react";
import { RingsMark } from "@/components/library/rings-mark";
import {
  DEMO_OBJECT,
  downloadObject,
  importObjects,
  objectTitle,
  removeObject,
  useObjectLibrary,
  type LibraryObject,
} from "@/lib/objects/object-library";

const dateFormat = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" });

/**
 * The objects created in this browser, kept only here, led by IRL3's pink
 * banana (a demo object everyone has).
 */
export function LocalLibrary() {
  const objects = useObjectLibrary();
  const [note, setNote] = useState<string | null>(null);

  return (
    <div className="space-y-8 pb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Object Library</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Objects you created in this browser. They are kept on this device only: download them to keep a copy or move
            them to another browser.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {/* A library file (as each object's download writes it) brings objects back, or into another browser. */}
          <label className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-full border border-border-strong px-5 text-sm font-medium transition-colors hover:bg-surface-hover focus-within:border-white">
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                importObjects(file)
                  .then((n) => setNote(n ? `Added ${n} object${n === 1 ? "" : "s"}` : "Those objects are already here"))
                  .catch((err) => setNote(err instanceof Error ? err.message : String(err)));
              }}
            />
            <FileUp size={17} /> Import
          </label>
          <Link
            href="/library/new"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus size={18} /> Create new object
          </Link>
        </div>
      </div>
      {note && (
        <p role="status" className="-mt-4 text-sm text-muted">
          {note}
        </p>
      )}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        <li>
          <BananaCard />
        </li>
        {objects.length === 0 ? (
          <li>
            <Link
              href="/library/new"
              className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-border p-5 text-center transition-colors hover:border-border-strong"
            >
              <RingsMark className="size-12 opacity-40" />
              <p className="mt-4 text-sm font-medium">No objects of your own yet</p>
              <p className="mt-1 text-xs text-muted">Scan one with your camera.</p>
            </Link>
          </li>
        ) : (
          objects.map((o) => (
            <li key={o.id}>
              <LibraryCard object={o} />
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

/**
 * IRL3's own object: the pink banana, drawn by the scanner's line-art engine
 * from a real photo. Everyone's library has it;
 * it cannot be deleted.
 */
function BananaCard() {
  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="relative flex aspect-square items-center justify-center bg-black p-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={DEMO_OBJECT.art} alt={objectTitle(DEMO_OBJECT)} className="size-full object-contain" />
        <span className="absolute top-2 left-2 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-black">
          Demo
        </span>
      </div>
      <div className="space-y-1 p-3">
        <p className="flex items-center gap-2">
          <span
            className="size-3 shrink-0 rounded-full border border-white/30"
            style={{ background: DEMO_OBJECT.color }}
          />
          <span className="truncate text-sm font-medium">{objectTitle(DEMO_OBJECT)}</span>
        </p>
        <p className="text-xs text-subtle">IRL3&apos;s demo object</p>
      </div>
    </article>
  );
}

function LibraryCard({ object: o }: { object: LibraryObject }) {
  const [confirming, setConfirming] = useState(false);
  const action =
    "flex size-9 items-center justify-center rounded-full bg-black/60 text-muted backdrop-blur-sm transition-colors hover:text-foreground";

  return (
    <article className="group overflow-hidden rounded-2xl border border-border bg-surface transition-colors hover:border-border-strong">
      <div className="relative flex aspect-square items-center justify-center bg-black p-6">
        {o.art ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={o.art} alt={objectTitle(o)} className="size-full object-contain" />
        ) : (
          <RingsMark className="size-full" seed={o.createdAt % 97} />
        )}
        {confirming ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 p-4 text-center">
            <p className="text-sm font-medium">Delete this object?</p>
            <p className="text-xs text-muted">It is removed from this browser for good.</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="h-9 rounded-full border border-border-strong px-4 text-sm"
              >
                Keep
              </button>
              <button
                type="button"
                onClick={() => removeObject(o.id)}
                className="h-9 rounded-full bg-red-500 px-4 text-sm font-medium text-white"
              >
                Delete
              </button>
            </div>
          </div>
        ) : (
          <div className="absolute top-2 right-2 flex gap-1.5">
            <button
              type="button"
              onClick={() => downloadObject(o)}
              aria-label={`Download ${objectTitle(o)}`}
              className={action}
            >
              <Download size={15} />
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              aria-label={`Delete ${objectTitle(o)}`}
              className={action}
            >
              <Trash2 size={15} />
            </button>
          </div>
        )}
      </div>
      <div className="space-y-1 p-3">
        <p className="flex items-center gap-2">
          <span className="size-3 shrink-0 rounded-full border border-white/30" style={{ background: o.color }} />
          <span className="truncate text-sm font-medium">{objectTitle(o)}</span>
        </p>
        <p className="text-xs text-subtle">{dateFormat.format(o.createdAt)}</p>
      </div>
    </article>
  );
}
