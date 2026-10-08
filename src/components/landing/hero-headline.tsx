"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

const WORDS = ["money.", "markets.", "your documents.", "what comes next."];

/** "Ask anything about <word>" — words cross-fade with a blur-in. */
export function HeroHeadline() {
  const [active, setActive] = useState(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setActive((n) => (n + 1) % WORDS.length), 2800);
    return () => clearInterval(id);
  }, [reduced]);

  return (
    <h1 className="font-display text-[2.75rem] font-semibold leading-[1.05] tracking-[-0.02em] sm:text-6xl lg:text-[4.5rem]">
      Ask anything about
      <span className="relative block h-[1.15em]" aria-live="off">
        {WORDS.map((w, i) => (
          <span key={w} className={i === active ? "avz-rw avz-rw-on" : "avz-rw"} aria-hidden={i !== active}>
            <span className="avz-gradient-text">{w}</span>
          </span>
        ))}
      </span>
    </h1>
  );
}
