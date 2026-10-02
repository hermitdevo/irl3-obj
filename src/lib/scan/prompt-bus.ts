export type Phase = "idle" | "loading" | "position" | "challenge" | "sweep" | "processing" | "done" | "error";

export type Prompt = {
  phase: Phase;
  message: string;
  /** 0..1 progress within the current phase. */
  progress?: number;
  /** Guided challenge: what is being asked right now. */
  challengeKind?: "hold" | "turn" | "side";
  /** Guided challenge: the person is not doing what is asked (moving while holding). */
  warn?: boolean;
  /** Guided challenge: which step this is (1-based) and how many there are. */
  step?: number;
  steps?: number;
  /** Guided challenge diagnostics: tracked points and the latest shift (capture px). */
  tracking?: { points: number; shift: number };
};

type Listener = (prompt: Prompt) => void;

const listeners = new Set<Listener>();
let current: Prompt = { phase: "idle", message: "" };

/** Broadcasts what the user is being asked to do. */
export const promptBus = {
  get: () => current,
  emit(prompt: Prompt) {
    current = prompt;
    listeners.forEach((l) => l(prompt));
  },
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
