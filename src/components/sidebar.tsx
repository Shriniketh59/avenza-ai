"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { PanelLeftClose, PanelLeftOpen, Search, Settings, SquarePen, X } from "lucide-react";
import { useConversations } from "@/hooks/conversation-store";
import { cn } from "@/lib/utils";
import type { User } from "@/types/user";
import { ConversationList } from "./conversation-list";
import { Logo, LogoMark } from "./logo";
import { UserMenu } from "./user-menu";

interface SidebarProps {
  user: User;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({ user, collapsed, onToggleCollapsed, mobileOpen, onCloseMobile }: SidebarProps) {
  const store = useConversations();
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");

  const goToChat = () => {
    if (pathname !== "/chat") router.push("/chat");
    onCloseMobile();
  };

  const iconBtn =
    "flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-[18px]";
  const rowBtn =
    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-foreground/90 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-[18px] [&_svg]:text-muted";

  // Collapsed rail (desktop only)
  const rail = (
    <div className="hidden h-full w-[68px] flex-col items-center gap-1 bg-surface py-3 md:flex">
      <Link href="/chat" aria-label="AVENZA AI home" className="mb-2 rounded-lg p-1.5">
        <LogoMark className="size-7" />
      </Link>
      <button type="button" className={iconBtn} onClick={onToggleCollapsed} aria-label="Expand sidebar">
        <PanelLeftOpen />
      </button>
      <button
        type="button"
        className={iconBtn}
        aria-label="New chat"
        onClick={() => {
          store.newChat();
          goToChat();
        }}
      >
        <SquarePen />
      </button>
      <Link href="/settings" className={iconBtn} aria-label="Settings">
        <Settings />
      </Link>
      <div className="mt-auto">
        <UserMenu user={user} collapsed />
      </div>
    </div>
  );

  const panel = (
    <div className="flex h-full w-[280px] flex-col bg-surface">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <Link href="/chat" className="rounded-lg px-1.5 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onCloseMobile}>
          <Logo />
        </Link>
        <button type="button" className={cn(iconBtn, "hidden md:flex")} onClick={onToggleCollapsed} aria-label="Collapse sidebar">
          <PanelLeftClose />
        </button>
        <button type="button" className={cn(iconBtn, "md:hidden")} onClick={onCloseMobile} aria-label="Close sidebar">
          <X />
        </button>
      </div>

      <div className="space-y-2 px-3 pb-3">
        <button
          type="button"
          onClick={() => {
            store.newChat();
            goToChat();
          }}
          className="flex h-11 w-full items-center gap-2.5 rounded-full bg-surface-2 px-4 text-sm font-medium hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <SquarePen className="size-4 text-accent" aria-hidden />
          New chat
          <kbd className="ml-auto hidden rounded border border-border px-1.5 text-[0.65rem] text-muted lg:inline">Ctrl ⇧ O</kbd>
        </button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            aria-label="Search conversations"
            className="h-10 w-full rounded-full border border-transparent bg-surface-2 pl-9 pr-3 text-sm placeholder:text-muted focus-visible:border-ring focus-visible:outline-none"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <ConversationList
          conversations={store.conversations}
          activeId={pathname === "/chat" ? store.activeId : null}
          query={query}
          onSelect={(id) => {
            store.select(id);
            goToChat();
          }}
          onRename={store.rename}
          onDelete={store.remove}
        />
      </div>

      <div className="space-y-1 border-t border-border p-2">
        <Link href="/settings" className={rowBtn} onClick={onCloseMobile} aria-current={pathname === "/settings" ? "page" : undefined}>
          <Settings /> Settings
        </Link>
        <UserMenu user={user} collapsed={false} />
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop */}
      <aside className="hidden h-full shrink-0 md:block">{collapsed ? rail : panel}</aside>

      {/* Mobile drawer */}
      <div className={cn("fixed inset-0 z-40 md:hidden", mobileOpen ? "pointer-events-auto" : "pointer-events-none")} aria-hidden={!mobileOpen}>
        <div
          className={cn("absolute inset-0 bg-black/60 transition-opacity", mobileOpen ? "opacity-100" : "opacity-0")}
          onClick={onCloseMobile}
        />
        <aside
          className={cn("absolute inset-y-0 left-0 transition-transform", mobileOpen ? "translate-x-0" : "-translate-x-full")}
          inert={!mobileOpen}
        >
          {panel}
        </aside>
      </div>
    </>
  );
}
