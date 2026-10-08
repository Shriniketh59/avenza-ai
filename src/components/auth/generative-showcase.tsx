"use client";

import { FileText, Globe, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";
import { LogoMark } from "../logo";

interface Example {
  prompt: string;
  answer: string;
  sources: { label: string; kind: "doc" | "web" }[];
}

// Illustrative examples of what the assistant does (not live data).
const EXAMPLES: Example[] = [
  {
    prompt: "Summarise the key risks in my quarterly report",
    answer:
      "Three risks stand out: rising loan defaults in the SME book, heavier reliance on short-term funding, and margin pressure from higher deposit rates. Defaults are the one to watch first.",
    sources: [{ label: "Q3-report.pdf", kind: "doc" }],
  },
  {
    prompt: "Explain EBITDA in one line",
    answer:
      "EBITDA shows what a business earns from its core operations before interest, taxes, depreciation and amortisation, which makes companies easier to compare.",
    sources: [{ label: "Web search", kind: "web" }],
  },
  {
    prompt: "Is this payment pattern suspicious?",
    answer:
      "Possibly. Many small transfers to a new payee within an hour is a common card-testing pattern. I'd flag it for review and verify the payee before approving more.",
    sources: [
      { label: "transactions.csv", kind: "doc" },
      { label: "Web search", kind: "web" },
    ],
  },
];

type Phase = "typing" | "thinking" | "answering" | "done" | "leaving";

/** Self-playing chat: the question types itself, then the answer streams in word by word. */
export function GenerativeDemo({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("typing");
  const [chars, setChars] = useState(0);
  const [words, setWords] = useState(0);

  const ex = EXAMPLES[index];
  const answerWords = ex.answer.split(/(?<=\s)/);

  useEffect(() => {
    if (reduced) return;
    let t: ReturnType<typeof setTimeout>;
    if (phase === "typing") {
      t = chars < ex.prompt.length ? setTimeout(() => setChars((c) => c + 1), 38) : setTimeout(() => setPhase("thinking"), 450);
    } else if (phase === "thinking") {
      t = setTimeout(() => setPhase("answering"), 1300);
    } else if (phase === "answering") {
      t = words < answerWords.length ? setTimeout(() => setWords((w) => w + 1), 55) : setTimeout(() => setPhase("done"), 200);
    } else if (phase === "done") {
      t = setTimeout(() => setPhase("leaving"), 3200);
    } else {
      t = setTimeout(() => {
        setIndex((n) => (n + 1) % EXAMPLES.length);
        setChars(0);
        setWords(0);
        setPhase("typing");
      }, 450);
    }
    return () => clearTimeout(t);
  }, [phase, chars, words, ex.prompt.length, answerWords.length, reduced]);

  // Reduced motion: show the finished first example, no animation.
  const shownChars = reduced ? ex.prompt.length : chars;
  const shownWords = reduced ? answerWords.length : words;
  const shownPhase: Phase = reduced ? "done" : phase;
  const answered = shownPhase === "answering" || shownPhase === "done" || shownPhase === "leaving";

  return (
    <div
      aria-hidden
      className={cn(
        "relative w-full max-w-[460px] rounded-[28px] border border-white/10 bg-white/[0.04] p-5 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.7)] backdrop-blur-xl",
        className,
      )}
    >
      <div key={index} className={`min-h-[218px] space-y-4 ${shownPhase === "leaving" ? "avz-fade-out" : ""}`}>
        {/* User prompt */}
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-3xl rounded-tr-md bg-white/10 px-4 py-2.5 text-[0.92rem] leading-relaxed text-white/90">
            {ex.prompt.slice(0, shownChars)}
            {shownPhase === "typing" && <span className="avz-caret ml-px inline-block h-4 w-[2px] translate-y-0.5 bg-white/80" />}
          </div>
        </div>

        {/* Assistant */}
        {shownPhase !== "typing" && (
          <div className="flex gap-3">
            <div className="relative mt-0.5 flex size-8 shrink-0 items-center justify-center">
              {(shownPhase === "thinking" || shownPhase === "answering") && <span className="avz-ring absolute inset-0 rounded-full" />}
              <LogoMark className="size-[18px]" />
            </div>
            <div className="min-w-0 flex-1 pt-1">
              {shownPhase === "thinking" ? (
                <div className="space-y-2.5">
                  <p className="avz-shimmer-text text-xs font-medium">Thinking…</p>
                  <div className="avz-shimmer w-full" />
                  <div className="avz-shimmer w-[80%]" />
                </div>
              ) : (
                <p className="text-[0.92rem] leading-relaxed text-white/85">
                  {answerWords.slice(0, shownWords).map((w, i) => (
                    <span key={i} className={reduced ? undefined : "avz-word"}>
                      {w}
                    </span>
                  ))}
                </p>
              )}
              {answered && shownWords >= answerWords.length && (
                <div className="avz-rotate-in mt-3 flex flex-wrap gap-1.5">
                  {ex.sources.map((s) => (
                    <span key={s.label} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[0.7rem] text-white/70">
                      {s.kind === "doc" ? <FileText className="size-3 text-[var(--grad-2)]" /> : <Globe className="size-3 text-[var(--grad-1)]" />}
                      {s.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Mini composer */}
      <div className="mt-5 flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] py-2 pl-4 pr-2 text-sm text-white/40">
        <Sparkles className="size-4 text-[var(--grad-3)]" />
        <span className="flex-1">Ask AVENZA</span>
        <span className="size-7 rounded-full [background:linear-gradient(135deg,var(--grad-1),var(--grad-2),var(--grad-3))]" />
      </div>
    </div>
  );
}

/** Slow-drifting teal / blue / violet light behind the panel. */
export function Aurora() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="avz-aurora-a absolute -left-[15%] top-[8%] size-[55%] rounded-full bg-[var(--grad-1)] opacity-[0.22] blur-[110px]" />
      <div className="avz-aurora-b absolute right-[-20%] top-[30%] size-[60%] rounded-full bg-[var(--grad-2)] opacity-[0.25] blur-[120px]" />
      <div className="avz-aurora-c absolute bottom-[-20%] left-[20%] size-[55%] rounded-full bg-[var(--grad-3)] opacity-[0.22] blur-[120px]" />
      <div className="absolute inset-0 opacity-[0.25] [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_40%_40%,black,transparent_70%)]" />
    </div>
  );
}
