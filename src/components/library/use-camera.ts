"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getProfile } from "@/lib/scan/profile";

const MEDIA_CLASS = "absolute inset-0 h-full w-full object-contain";

export type CameraState = {
  element: HTMLVideoElement | null;
  mirrored: boolean;
  aspect: number;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  facing: "user" | "environment";
};

/** The live camera for a scan: start (from a tap on phones), switch, and stop on leaving. */
export function useCamera() {
  const stream = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>({
    element: null,
    mirrored: false,
    aspect: 4 / 3,
    status: "idle",
    error: null,
    facing: "environment",
  });

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  const start = useCallback(
    async (facing: "user" | "environment" = getProfile().facing) => {
      stop();
      setState((s) => ({ ...s, status: "loading", error: null }));
      try {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error("Camera access needs a secure page (HTTPS or localhost).");
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        stream.current = media;
        const video = document.createElement("video");
        video.className = MEDIA_CLASS;
        video.muted = true;
        video.playsInline = true;
        video.srcObject = media;
        await video.play();
        // Some browsers (iOS) do not report facingMode; fall back to the one asked for.
        const reported = media.getVideoTracks()[0]?.getSettings().facingMode;
        setState({
          element: video,
          mirrored: (reported || facing) === "user",
          aspect: video.videoWidth / video.videoHeight || 4 / 3,
          status: "ready",
          error: null,
          facing,
        });
      } catch (e) {
        const denied = e instanceof DOMException && e.name === "NotAllowedError";
        setState((s) => ({
          ...s,
          element: null,
          status: "error",
          error: denied
            ? "Camera access was blocked. Allow it in the browser to continue."
            : e instanceof Error
              ? e.message
              : String(e),
        }));
      }
    },
    [stop],
  );

  useEffect(() => stop, [stop]);

  /** Restarts the camera if its stream has ended (phones can end it while the picture is off screen). */
  const ensureLive = useCallback(() => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track || track.readyState !== "live") void start(state.facing);
  }, [start, state.facing]);

  return { ...state, start, stop, ensureLive };
}
