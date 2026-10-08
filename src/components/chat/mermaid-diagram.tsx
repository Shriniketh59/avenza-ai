"use client";

import { Check, Code2, Copy, Download, Workflow } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils";

type MermaidApi = (typeof import("mermaid"))["default"];
let loader: Promise<MermaidApi> | null = null;

/** Mermaid is large (~1 MB): load it only when a diagram is shown. */
function loadMermaid(dark: boolean): Promise<MermaidApi> {
  loader ??= import("mermaid").then((m) => m.default);
  return loader.then((mermaid) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: dark ? "dark" : "default",
      fontFamily: "inherit",
      flowchart: { htmlLabels: false, curve: "basis" },
    });
    return mermaid;
  });
}

// next-themes puts "dark" or "light" on <html>; fall back to the OS setting before it has run.
const isDark = () => {
  const cls = document.documentElement.classList;
  return cls.contains("dark") || (!cls.contains("light") && matchMedia("(prefers-color-scheme: dark)").matches);
};

/**
 * Renders a ```mermaid block as a diagram. While the answer is still streaming the code is
 * usually incomplete, so rendering waits until it has stopped changing; if it never parses,
 * the code is shown instead.
 */
export function MermaidDiagram({ code }: { code: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const mermaid = await loadMermaid(isDark());
        await mermaid.parse(code);
        const { svg } = await mermaid.render(`mmd${id}${Date.now()}`, code);
        if (!cancelled) {
          setSvg(svg);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, id]);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const download = () => {
    if (!svg) return;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "avenza-diagram.svg" });
    a.click();
    URL.revokeObjectURL(url);
  };

  const button = "inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-2">
      <div className="flex items-center gap-3 border-b border-border px-3.5 py-1.5 text-xs text-muted">
        <span className="mr-auto inline-flex items-center gap-1.5">
          <Workflow className="size-3.5" aria-hidden /> Flow diagram
        </span>
        <button type="button" onClick={() => setShowCode((s) => !s)} className={button}>
          <Code2 className="size-3.5" /> {showCode ? "Diagram" : "Code"}
        </button>
        <button type="button" onClick={copy} className={button}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" onClick={download} disabled={!svg} className={cn(button, "disabled:opacity-40")}>
          <Download className="size-3.5" /> SVG
        </button>
      </div>
      {svg && !showCode ? (
        <div
          className="flex justify-center overflow-x-auto bg-white/[0.02] p-4 [&_svg]:h-auto [&_svg]:max-w-full"
          // Mermaid output rendered with securityLevel "strict" (no scripts, no HTML labels).
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div>
          {!svg && !showCode && (
            <p className="px-4 pt-3 text-xs text-muted">{failed ? "Diagram is still being written or has a syntax error; showing its code." : "Drawing diagram…"}</p>
          )}
          <pre className="overflow-x-auto p-4 font-mono text-[0.82rem] leading-relaxed">{code}</pre>
        </div>
      )}
    </div>
  );
}
