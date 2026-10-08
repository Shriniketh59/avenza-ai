"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { ChevronsUpDown, LogOut, Settings, UserRound } from "lucide-react";
import { useDismiss } from "@/hooks/use-dismiss";
import { useSignOut } from "@/hooks/use-sign-out";
import { cn } from "@/lib/utils";
import type { User } from "@/types/user";
import { UserAvatar } from "./user-avatar";

export function UserMenu({ user, collapsed }: { user: User; collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  const { signOut, pending } = useSignOut();

  const item =
    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-foreground/90 hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4 [&_svg]:text-muted";

  return (
    <div ref={ref} className="relative">
      {open && (
        <div role="menu" className="absolute bottom-full left-0 z-30 mb-2 w-60 rounded-xl border border-border bg-surface-2 p-1.5 shadow-xl shadow-black/30">
          <div className="border-b border-border px-2.5 pb-2 pt-1.5">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <div className="pt-1.5">
            <Link role="menuitem" href="/profile" className={item} onClick={close}>
              <UserRound /> Profile
            </Link>
            <Link role="menuitem" href="/settings" className={item} onClick={close}>
              <Settings /> Settings
            </Link>
            <button role="menuitem" type="button" className={item} onClick={signOut} disabled={pending}>
              <LogOut /> {pending ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={collapsed ? `Account menu for ${user.name}` : undefined}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg p-2 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          collapsed && "justify-center",
        )}
      >
        <UserAvatar user={user} />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{user.name}</span>
              <span className="block truncate text-xs text-muted">{user.email}</span>
            </span>
            <ChevronsUpDown className="size-4 text-muted" aria-hidden />
          </>
        )}
      </button>
    </div>
  );
}
