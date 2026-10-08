"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ConversationProvider, useConversations } from "@/hooks/conversation-store";
import type { User } from "@/types/user";
import { Sidebar } from "./sidebar";

const ShellContext = createContext<{ openSidebar: () => void; user: User } | null>(null);
export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside <WorkspaceShell>");
  return ctx;
}

export function WorkspaceShell({ user, children }: { user: User; children: ReactNode }) {
  return (
    <ConversationProvider userId={user.id}>
      <ShellInner user={user}>{children}</ShellInner>
    </ConversationProvider>
  );
}

function ShellInner({ user, children }: { user: User; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { newChat } = useConversations();

  // Close the mobile drawer on navigation.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setMobileOpen(false);
  }

  // Ctrl/Cmd + Shift + O starts a new chat.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        newChat();
        router.push("/chat");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newChat, router]);

  return (
    <ShellContext.Provider value={{ openSidebar: () => setMobileOpen(true), user }}>
      <div className="flex h-dvh overflow-hidden">
        <Sidebar
          user={user}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((c) => !c)}
          mobileOpen={mobileOpen}
          onCloseMobile={() => setMobileOpen(false)}
        />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </ShellContext.Provider>
  );
}
