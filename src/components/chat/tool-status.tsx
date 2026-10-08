import { CheckCircle2, CircleDashed, Loader2, XCircle } from "lucide-react";
import type { ToolCall } from "@/types/chat";

const ICON = {
  queued: <CircleDashed className="size-3.5 text-muted" />,
  running: <Loader2 className="size-3.5 animate-spin text-blue" />,
  succeeded: <CheckCircle2 className="size-3.5 text-accent" />,
  failed: <XCircle className="size-3.5 text-danger" />,
} as const;

const LABELS: Record<string, string> = {
  search_knowledge: "Your documents, memory & news",
  web_search: "Web search",
  agent: "Agent",
  understand: "Understanding",
};

/** Renders tool-execution events streamed by the agent backend. */
export function ToolStatus({ tools }: { tools: ToolCall[] }) {
  return (
    <ul className="mb-3 flex flex-wrap gap-1.5" aria-label="Tool activity">
      {tools.map((t) => (
        <li key={t.id} className="flex max-w-full items-center gap-2 rounded-full border border-border bg-surface-2/70 px-3 py-1 text-xs">
          {ICON[t.status]}
          <span className="shrink-0 whitespace-nowrap text-foreground/90">{LABELS[t.name] ?? t.name}</span>
          {t.summary && <span className="min-w-0 truncate text-muted">— {t.summary}</span>}
          <span className="sr-only">{t.status}</span>
        </li>
      ))}
    </ul>
  );
}
