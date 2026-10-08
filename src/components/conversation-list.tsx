"use client";

import { useState, type KeyboardEvent } from "react";
import { Check, MessageSquare, Pencil, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/types/conversation";

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  query: string;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

function groupLabel(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days < 1) return "Today";
  if (days < 2) return "Yesterday";
  if (days < 8) return "Previous 7 days";
  return "Older";
}

export function ConversationList({ conversations, activeId, query, onSelect, onRename, onDelete }: Props) {
  const q = query.trim().toLowerCase();
  const filtered = conversations
    .filter((c) => !q || c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q)))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  if (conversations.length === 0) {
    return (
      <div className="px-3 py-8 text-center text-xs text-muted">
        <MessageSquare className="mx-auto mb-2 size-5 opacity-60" aria-hidden />
        No conversations yet.
        <br />
        Start a new chat to begin.
      </div>
    );
  }
  if (filtered.length === 0) {
    return <p className="px-3 py-6 text-center text-xs text-muted">No chats match “{query}”.</p>;
  }

  const groups = new Map<string, Conversation[]>();
  for (const c of filtered) {
    const label = groupLabel(c.updatedAt);
    groups.set(label, [...(groups.get(label) ?? []), c]);
  }

  return (
    <nav aria-label="Conversation history" className="space-y-4">
      {[...groups].map(([label, items]) => (
        <div key={label}>
          <h3 className="px-4 pb-1.5 text-xs font-medium text-muted">{label}</h3>
          <ul className="space-y-0.5">
            {items.map((c) => (
              <ConversationItem
                key={c.id}
                conversation={c}
                active={c.id === activeId}
                onSelect={() => onSelect(c.id)}
                onRename={(t) => onRename(c.id, t)}
                onDelete={() => onDelete(c.id)}
              />
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function ConversationItem({
  conversation,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  conversation: Conversation;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [mode, setMode] = useState<"view" | "rename" | "confirm">("view");
  const [draft, setDraft] = useState(conversation.title);

  const commit = () => {
    onRename(draft);
    setMode("view");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") setMode("view");
  };

  if (mode === "rename") {
    return (
      <li className="flex items-center gap-1 rounded-lg bg-surface-2 px-2 py-1">
        <input
          autoFocus
          aria-label="Conversation title"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          className="h-7 min-w-0 flex-1 rounded border border-ring bg-surface px-2 text-sm outline-none"
        />
        <IconAction label="Save title" onClick={commit}>
          <Check />
        </IconAction>
        <IconAction label="Cancel rename" onClick={() => setMode("view")}>
          <X />
        </IconAction>
      </li>
    );
  }

  if (mode === "confirm") {
    return (
      <li className="flex items-center gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs">
        <span className="flex-1">Delete this chat?</span>
        <button type="button" onClick={onDelete} className="font-semibold text-danger hover:underline">
          Delete
        </button>
        <button type="button" onClick={() => setMode("view")} className="text-muted hover:text-foreground">
          Cancel
        </button>
      </li>
    );
  }

  return (
    <li
      className={cn(
        "group relative flex items-center rounded-full",
        active ? "bg-[linear-gradient(90deg,color-mix(in_oklab,var(--grad-1)_22%,transparent),color-mix(in_oklab,var(--grad-2)_16%,transparent))]" : "hover:bg-surface-2",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "page" : undefined}
        className="min-w-0 flex-1 truncate rounded-full px-4 py-2 text-left text-sm text-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {conversation.title}
      </button>
      <div className="mr-1 flex opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100">
        <IconAction
          label={`Rename ${conversation.title}`}
          onClick={() => {
            setDraft(conversation.title);
            setMode("rename");
          }}
        >
          <Pencil />
        </IconAction>
        <IconAction label={`Delete ${conversation.title}`} onClick={() => setMode("confirm")}>
          <Trash2 />
        </IconAction>
      </div>
    </li>
  );
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}
