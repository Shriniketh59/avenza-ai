"use client";

import { Check, Code2, Copy, Download, Workflow } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
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
      // Dark mode: arrow labels ("Yes", "Valid") on a dark chip, not a light-grey box with pale text.
      ...(dark ? { themeVariables: { edgeLabelBackground: "#1e2a4a", tertiaryColor: "#1e2a4a" } } : {}),
    });
    return mermaid;
  });
}

// next-themes puts "dark" or "light" on <html>; fall back to the OS setting before it has run.
const isDark = () => {
  const cls = document.documentElement.classList;
  return cls.contains("dark") || (!cls.contains("light") && matchMedia("(prefers-color-scheme: dark)").matches);
};

// Redraw at most this often while the code is still being written.
const REDRAW_MS = 400;

/** The code as written, then without its last (possibly half-written) line: the first that parses is drawn. */
function candidates(code: string): string[] {
  const lines = code.trimEnd().split("\n");
  return lines.length > 2 ? [code, lines.slice(0, -1).join("\n")] : [code];
}

/**
 * Renders a ```mermaid block as a diagram, live: while the answer is still being written it is redrawn every
 * REDRAW_MS from the lines finished so far, so the diagram grows step by step. The last good drawing always
 * stays on screen (never blanked while the next one renders); if nothing has parsed yet, the code is shown.
 */
export function MermaidDiagram({ code }: { code: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);

  const latest = useRef(code);
  const drawn = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null; // React may mount again (Strict Mode): it must be able to schedule a new draw
      busy.current = false;
    };
  }, []);

  useEffect(() => {
    latest.current = code;
    // Throttle, not debounce: a stream changes the code many times a second and would never let a debounce fire.
    const draw = async () => {
      timer.current = null;
      if (busy.current) return void (timer.current = setTimeout(draw, REDRAW_MS)); // mermaid renders one at a time
      const source = latest.current;
      if (source === drawn.current) return;
      busy.current = true;
      try {
        const mermaid = await loadMermaid(isDark());
        for (const attempt of candidates(source)) {
          if (!(await mermaid.parse(attempt, { suppressErrors: true }))) continue;
          const { svg } = await mermaid.render(`mmd${id}${Date.now()}`, attempt);
          if (!alive.current) return;
          setSvg(svg);
          setFailed(false);
          drawn.current = source;
          return;
        }
        if (alive.current) setFailed(true);
      } catch {
        if (alive.current) setFailed(true);
      } finally {
        busy.current = false;
        if (alive.current && latest.current !== drawn.current && !timer.current) timer.current = setTimeout(draw, REDRAW_MS);
      }
    };
    timer.current ??= setTimeout(draw, drawn.current ? REDRAW_MS : 150);
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
    // data-diagram: kept out of the fade-in that new blocks get while an answer is written (it redraws in place).
    <div data-diagram className="overflow-hidden rounded-xl border border-border bg-surface-2">
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
            <p className="px-4 pt-3 text-xs text-muted">{failed ? "Showing the code until the diagram can be drawn." : "Drawing diagram…"}</p>
          )}
          <pre className="overflow-x-auto p-4 font-mono text-[0.82rem] leading-relaxed">{code}</pre>
        </div>
      )}
    </div>
  );
}
