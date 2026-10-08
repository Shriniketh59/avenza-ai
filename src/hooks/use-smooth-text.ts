"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Reveals streamed text word by word at a steady pace, like ChatGPT, even when the
 * model delivers it in large bursts. Speeds up moderately when a big burst is waiting,
 * so long answers do not crawl. Text that was already complete on mount (history)
 * is shown at once.
 */
export function useSmoothText(target: string, streaming: boolean): string {
  const [animating, setAnimating] = useState(streaming);
  if (streaming && !animating) setAnimating(true);
  const [shown, setShown] = useState("");
  const targetRef = useRef(target);

  useEffect(() => {
    targetRef.current = target;
  }, [target]);

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
      if (backlog > 0) {
        const dt = Math.min(64, now - last);
        // ChatGPT-like pace: ~60 chars/s, easing up to 180 chars/s when a big burst is waiting.
        budget = Math.min(text.length, budget + (Math.min(180, Math.max(60, backlog / 4)) * dt) / 1000);
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
