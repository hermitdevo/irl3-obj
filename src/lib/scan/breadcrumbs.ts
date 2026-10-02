/**
 * Crash breadcrumbs. If the browser kills the tab mid-scan (phones do this
 * when memory runs out), the last recorded step survives in localStorage and
 * is shown after the page reloads.
 */

const KEY = "irl3-obj.lastRun";

export type LastRun = { step: string; at: number; running: boolean; profile: string };

function write(run: LastRun) {
  try {
    localStorage.setItem(KEY, JSON.stringify(run));
  } catch {
    // Storage can be unavailable; breadcrumbs are best effort.
  }
}

export const breadcrumbs = {
  step(step: string, profile: string) {
    write({ step, at: Date.now(), running: true, profile });
  },
  finish(step: string, profile: string) {
    write({ step, at: Date.now(), running: false, profile });
  },
  /** The previous run, if it never finished (the tab was killed). */
  crashed(): LastRun | null {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const run = JSON.parse(raw) as LastRun;
      // Leaving or reloading the page while the models download is not a crash.
      return run.running && run.step !== "loading models" ? run : null;
    } catch {
      return null;
    }
  },
  clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Ignore.
    }
  },
};
