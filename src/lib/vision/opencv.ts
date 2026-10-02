/* eslint-disable @typescript-eslint/no-explicit-any -- OpenCV.js has no usable typings */

export type CV = any;

const SCRIPT_URL = "/vendor/opencv.js";

let cvPromise: Promise<{ cv: CV }> | null = null;

/**
 * Loads OpenCV.js once from a static script (see scripts/copy-vendor.mjs).
 *
 * The Emscripten module is "thenable" and resolves to itself, so a promise
 * must never resolve with it directly (that loops forever). It is always
 * handed out wrapped: `const { cv } = await loadOpenCV()`.
 */
export function loadOpenCV(): Promise<{ cv: CV }> {
  if (!cvPromise) {
    cvPromise = new Promise<{ cv: CV }>((resolve, reject) => {
      const ready = () => {
        const cv = (window as any).cv;
        if (!cv) return reject(new Error("OpenCV.js did not initialize"));
        if (cv.Mat) return resolve({ cv });
        cv.onRuntimeInitialized = () => resolve({ cv });
      };
      if ((window as any).cv) return ready();
      const script = document.createElement("script");
      script.src = SCRIPT_URL;
      script.async = true;
      script.onload = ready;
      script.onerror = () => reject(new Error("Could not load OpenCV.js"));
      document.head.appendChild(script);
    });
    cvPromise.catch(() => {
      cvPromise = null;
    });
  }
  return cvPromise;
}
