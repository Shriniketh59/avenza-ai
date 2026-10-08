"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type VoicePhase = "starting" | "listening" | "transcribing" | "thinking" | "speaking" | "paused" | "error";

/**
 * Live voice colour: a bottom aurora in the phase palette. Listening follows the microphone,
 * speaking follows the real voice output. The level is published as `--avz-energy` (0..1) on the
 * voice dialog, so the caption text can glow with it too. Animated per frame without re-rendering React.
 */
export function VoiceGlow({
  phase,
  level,
  getSpeakerLevel,
}: {
  phase: VoicePhase;
  level: number;
  getSpeakerLevel: () => number;
}) {
  const root = useRef<HTMLDivElement>(null);
  const state = useRef({ phase, level, getSpeakerLevel });
  useEffect(() => {
    state.current = { phase, level, getSpeakerLevel };
  });

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const target = root.current?.closest<HTMLElement>(".avz-voice") ?? root.current;
    let smooth = 0;
    let frame = 0;
    const tick = (now: number) => {
      const { phase: p, level: mic, getSpeakerLevel: speaker } = state.current;
      const t = now / 1000;
      let goal = 0;
      if (p === "listening") goal = mic;
      else if (p === "speaking") {
        const out = speaker();
        goal = out < 0 ? 0.35 + 0.25 * Math.sin(t * 7) : out; // -1: level unknown, pulse gently
      } else if (p === "thinking" || p === "transcribing" || p === "starting") {
        goal = 0.3 + 0.15 * Math.sin(t * 3);
      }
      // Fast attack, slower release reads as natural speech.
      smooth += (goal - smooth) * (goal > smooth ? 0.45 : 0.12);
      target?.style.setProperty("--avz-energy", (reduce ? 0.3 : smooth).toFixed(3));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const dim = phase === "paused" || phase === "error";
  return (
    <div ref={root} aria-hidden className="pointer-events-none absolute inset-0">
      <div className={cn("avz-aurora absolute inset-x-[-10%] bottom-[-12vh] h-[52vh]", dim && "opacity-30")} />
    </div>
  );
}
