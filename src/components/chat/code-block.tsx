"use client";

import { Check, Copy } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

export function CodeBlock({ language, children }: { language: string | null; children: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(ref.current?.innerText ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-code">
      <div className="flex items-center justify-between border-b border-white/5 px-3.5 py-1.5 text-xs text-slate-400">
        <span className="font-mono">{language ?? "text"}</span>
        <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy code"}
        </button>
      </div>
      <pre ref={ref} className="overflow-x-auto p-4 font-mono text-[0.82rem] leading-relaxed text-slate-200">
        {children}
      </pre>
    </div>
  );
}
