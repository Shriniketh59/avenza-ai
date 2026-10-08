import { useId } from "react";
import { cn } from "@/lib/utils";

/** AVENZA "A" mark. Replace with the official SVG asset when available. */
export function LogoMark({ className }: { className?: string }) {
  // Unique gradient ids: a duplicate id inside a hidden (display:none) copy would blank out visible marks.
  const id = useId().replace(/:/g, "");
  const l = `avz-l-${id}`;
  const r = `avz-r-${id}`;
  const sw = `avz-s-${id}`;
  return (
    <svg viewBox="0 0 520 440" className={cn("size-8", className)} aria-hidden>
      <defs>
        <linearGradient id={l} x1="0.7" y1="0" x2="0.1" y2="1">
          <stop offset="0" stopColor="#1FF5C0" />
          <stop offset="0.55" stopColor="#14A9B4" />
          <stop offset="1" stopColor="#1B5FE0" />
        </linearGradient>
        <linearGradient id={r} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1C3FB8" />
          <stop offset="1" stopColor="#1E7BFF" />
        </linearGradient>
        <linearGradient id={sw} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#1A7FD6" />
          <stop offset="0.5" stopColor="#16C7B8" />
          <stop offset="1" stopColor="#22F0A8" />
        </linearGradient>
      </defs>
      <path d="M300 62 L478 410 L400 410 Q384 410 376 396 L250 150 Z" fill={`url(#${r})`} />
      <path
        d="M262 30 Q300 8 322 52 L130 396 Q122 410 106 410 L46 410 Z"
        fill={`url(#${l})`}
        stroke={`url(#${l})`}
        strokeWidth="44"
        strokeLinejoin="round"
      />
      <path d="M30 396 Q20 360 60 330 Q260 190 500 150 Q300 220 160 330 Q120 362 132 410 L64 410 Q36 410 30 396 Z" fill={`url(#${sw})`} />
    </svg>
  );
}

export function Logo({ className, compact = false, onDark = false }: { className?: string; compact?: boolean; onDark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      {!compact && (
        <span className={cn("text-[1.05rem] font-semibold tracking-[0.14em]", onDark ? "text-white" : "text-foreground")}>
          AVENZA <span className="text-accent">AI</span>
        </span>
      )}
    </span>
  );
}
