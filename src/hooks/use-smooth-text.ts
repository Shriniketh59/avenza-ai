"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Reveals streamed text word by word at a steady, ChatGPT-like pace, even when the model
 * delivers it in bursts. The pace rises gently only when text piles up, so it never falls
 * far behind. When the model finishes, the rest is typed out quickly (about half a second)
 * instead of jumping, and the animation stops. Text that was already complete on mount
 * (history) is shown at once.
 */
export function useSmoothText(target: string, streaming: boolean): string {
  const [shown, setShown] = useState(target);
  const [animating, setAnimating] = useState(false);
  if (streaming && !animating) setAnimating(true);
  const targetRef = useRef(target);
  const streamingRef = useRef(streaming);

  useEffect(() => {
    targetRef.current = target;
    streamingRef.current = streaming;
  }, [target, streaming]);

  useEffect(() => {
    if (!animating) return;
    let budget = 0; // characters "typed" so far (fractional)
    let visible = 0; // characters on screen, always ending at a word boundary
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const text = targetRef.current;
      if (visible > text.length) visible = budget = text.length; // regenerated or trimmed
      const backlog = text.length - budget;
      if (!streamingRef.current && backlog <= 0) {
        setAnimating(false); // caught up after the model finished: stop the loop
        return;
      }
      if (backlog > 0) {
        const dt = Math.min(50, now - last);
        // While writing: ~70 chars/s, rising gently with the backlog (max 260/s) so it stays close behind.
        // After the model finishes: type the rest within about 0.6 s.
        const rate = streamingRef.current ? Math.min(260, Math.max(70, backlog / 1.5)) : Math.max(150, backlog / 0.6);
        budget = Math.min(text.length, budget + (rate * dt) / 1000);
        // Show only whole words: cut back to the last whitespace the budget has reached.
        let cut = Math.floor(budget);
        if (cut < text.length) while (cut > visible && !/\s/.test(text[cut])) cut--;
        if (cut > visible) {
          visible = cut;
          setShown(text.slice(0, cut));
        }
      }
      last = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animating]);

  return animating ? shown : target;
}
