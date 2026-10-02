"use client";

import { useSyncExternalStore } from "react";
import { isColorName } from "@/lib/art/object-palette";
import { DEMO_OBJECT } from "./demo-object";

/**
 * The person's object library: objects they created, kept only in this
 * browser (localStorage). An object is known by its kind and its colour
 * (an orange lighter, a blue mug); personal marks do not matter here.
 */

export type LibraryObject = {
  id: string;
  /** What it is, as the scanner names it (lighter, mug, phone, keyboard…). */
  kind: string;
  /** Its main colour, as a name and a swatch. */
  colorName: string;
  color: string;
  /** Line art of the object (image URL), when the scan made one. */
  art?: string;
  createdAt: number;
  /** IRL3's demo object: in everyone's list, never stored or deleted. */
  demo?: boolean;
};

const KEY = "irl3-obj.objects.v1";
const CHANGED = "irl3-objects-changed";
const EMPTY: LibraryObject[] = [];

let cachedRaw: string | null = null;
let cached: LibraryObject[] = EMPTY;

function read(): LibraryObject[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // Storage can be unavailable (private mode, blocked site data).
  }
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    cached = Array.isArray(parsed) ? parsed : EMPTY;
  } catch {
    cached = EMPTY;
  }
  return cached;
}

function write(list: LibraryObject[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Non-critical: the library just does not persist.
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

/** The library, newest first; empty on the server and before hydration. */
export function useObjectLibrary() {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export { DEMO_OBJECT };

export function saveObject(object: Omit<LibraryObject, "id" | "createdAt">): LibraryObject {
  const saved: LibraryObject = { ...object, id: crypto.randomUUID(), createdAt: Date.now() };
  write([saved, ...read()]);
  return saved;
}

export function removeObject(id: string) {
  write(read().filter((o) => o.id !== id));
}

/** Saves an object as a file (kind, colour and drawing), e.g. irl3-object-orange-lighter.json. */
export function downloadObject(o: LibraryObject) {
  const file = { type: "irl3-object", version: 1, ...o };
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 1)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `irl3-object-${objectTitle(o)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Puts objects from library files (as downloadObject writes them, one object
 * or a list) back into this browser's library: restoring, or moving to
 * another browser. Each is checked; ones already here are skipped. Imports are
 * not new creations, so analytics does not count them. Returns how many were
 * added.
 */
export async function importObjects(file: File): Promise<number> {
  if (file.size > 5_000_000) throw new Error("That file is too large for a library file");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("That is not a library file");
  }
  const items = (Array.isArray(parsed) ? parsed : [parsed]) as Partial<LibraryObject & { type: string }>[];
  const valid = items.filter(
    (o) =>
      !!o &&
      o.type === "irl3-object" &&
      typeof o.kind === "string" &&
      /^[a-z][a-z -]{0,29}$/.test(o.kind) &&
      typeof o.colorName === "string" &&
      isColorName(o.colorName) &&
      typeof o.color === "string" &&
      /^#[0-9a-f]{6}$/i.test(o.color) &&
      (o.art === undefined || (typeof o.art === "string" && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(o.art))),
  );
  if (!valid.length) throw new Error("That is not a library file");
  const have = read();
  const added: LibraryObject[] = [];
  for (const o of valid) {
    const id = typeof o.id === "string" && o.id ? o.id : crypto.randomUUID();
    if (have.some((h) => h.id === id) || added.some((a) => a.id === id)) continue;
    added.push({
      id,
      kind: o.kind!,
      colorName: o.colorName!,
      color: o.color!,
      ...(o.art ? { art: o.art } : {}),
      createdAt: typeof o.createdAt === "number" ? o.createdAt : Date.now(),
    });
  }
  if (added.length) write([...added, ...have]);
  return added.length;
}

/** "Orange lighter". */
export const objectTitle = (o: Pick<LibraryObject, "kind" | "colorName">) =>
  `${o.colorName.charAt(0).toUpperCase()}${o.colorName.slice(1)} ${o.kind}`;
