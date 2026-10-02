/**
 * Processing profile. Phones (iOS Safari especially) have tight per-tab memory
 * limits, so they get a light profile: compressed models on the CPU, a much
 * lighter object isolation (GrabCut instead of SAM) and fewer frames.
 */

export type ProfileKind = "full" | "light";
export type ProfileChoice = "auto" | ProfileKind;

export type ProcessingProfile = {
  kind: ProfileKind;
  /** Where the neural networks run; null = pick WebGPU when available. */
  device: "wasm" | null;
  embedDtype: "fp32" | "q8";
  embedBatch: number;
  segmenter: "sam" | "grabcut";
  challengeFrames: number;
  challengeInterval: number;
  sweepFrames: number;
  sweepInterval: number;
  maxViews: number;
  scanIdentityFrames: number;
  /** Default camera when it starts. */
  facing: "user" | "environment";
};

const FULL: ProcessingProfile = {
  kind: "full",
  device: null,
  embedDtype: "fp32",
  embedBatch: 4,
  segmenter: "sam",
  challengeFrames: 14,
  challengeInterval: 170,
  sweepFrames: 18,
  sweepInterval: 330,
  maxViews: 10,
  scanIdentityFrames: 6,
  facing: "user",
};

const LIGHT: ProcessingProfile = {
  kind: "light",
  device: "wasm",
  embedDtype: "q8",
  embedBatch: 1,
  segmenter: "grabcut",
  // Same challenge as the full profile: the depth test is calibrated on it.
  challengeFrames: 14,
  challengeInterval: 170,
  sweepFrames: 12,
  sweepInterval: 450,
  maxViews: 8,
  scanIdentityFrames: 6,
  facing: "environment",
};

const KEY = "irl3-obj.profile";
const ISOLATION_KEY = "irl3-obj.isolation";

/**
 * Object isolation on phones: "auto" keeps the light GrabCut; "precise" runs
 * SAM there too (on the CPU), which separates the object from the hand holding
 * it but needs more memory — experimental until measured on real phones.
 */
export type IsolationChoice = "auto" | "precise";

export function loadIsolationChoice(): IsolationChoice {
  try {
    return localStorage.getItem(ISOLATION_KEY) === "precise" ? "precise" : "auto";
  } catch {
    return "auto";
  }
}

export function saveIsolationChoice(choice: IsolationChoice) {
  try {
    if (choice === "auto") localStorage.removeItem(ISOLATION_KEY);
    else localStorage.setItem(ISOLATION_KEY, choice);
  } catch {
    // Non-critical.
  }
}

export function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch support gives it away.
  return /iPhone|iPad|iPod|Android/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function loadProfileChoice(): ProfileChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "full" || v === "light") return v;
  } catch {
    // Storage can be unavailable.
  }
  return "auto";
}

export function saveProfileChoice(choice: ProfileChoice) {
  try {
    if (choice === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Non-critical.
  }
}

let active: ProcessingProfile | null = null;

/** The profile in effect for this page load (a change needs a reload). */
export function getProfile(): ProcessingProfile {
  if (!active) {
    const choice = loadProfileChoice();
    const kind = choice === "auto" ? (isMobileDevice() ? "light" : "full") : choice;
    active = kind === "light" ? LIGHT : FULL;
    if (active.segmenter !== "sam" && loadIsolationChoice() === "precise") active = { ...active, segmenter: "sam" };
  }
  return active;
}
