"use client";

import { Menu } from "lucide-react";
import type { ReactNode } from "react";
import { useBackendStatus, type BackendStatus } from "@/hooks/use-backend-status";
import { cn } from "@/lib/utils";
import { useShell } from "./workspace-shell";

const STATUS: Record<BackendStatus, { label: string; dot: string }> = {
  checking: { label: "Checking model…", dot: "bg-muted" },
  online: { label: "AI model ready", dot: "bg-accent" },
  offline: { label: "Model offline", dot: "bg-danger" },
  not_configured: { label: "Backend not connected", dot: "bg-amber-400" },
  preview: { label: "Preview mode · model not connected", dot: "bg-amber-400" },
  model_offline: { label: "Search index offline · run ollama serve", dot: "bg-danger" },
  no_credit: { label: "API balance is empty · top up to chat", dot: "bg-amber-400" },
  model_missing: { label: "API key missing · add it to .env.local", dot: "bg-amber-400" },
};

export function ModelStatus() {
  const status = useBackendStatus();
  const s = STATUS[status];
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border px-2.5 py-1 text-xs text-muted" role="status">
      <span className={cn("size-1.5 rounded-full", s.dot)} aria-hidden />
      {s.label}
    </span>
  );
}

export function WorkspaceHeader({ title, children }: { title?: ReactNode; children?: ReactNode }) {
  const { openSidebar } = useShell();
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 px-3 sm:px-5">
      <button
        type="button"
        onClick={openSidebar}
        aria-label="Open sidebar"
        className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
      >
        <Menu className="size-5" />
      </button>
      {/* Text titles truncate; component titles (the agent picker) must not clip their dropdown. */}
      <div className={cn("min-w-0 flex-1 text-sm font-medium", typeof title === "string" && "truncate")}>{title}</div>
      {children}
    </header>
  );
}
