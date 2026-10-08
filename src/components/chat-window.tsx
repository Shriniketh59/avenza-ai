"use client";

import { ArrowDown } from "lucide-react";
import { useState } from "react";
import { useConversations } from "@/hooks/conversation-store";
import { useAutoScroll } from "@/hooks/use-auto-scroll";
import { usePreferences } from "@/hooks/use-preferences";
import { AgentSelector } from "./chat/agent-selector";
import { Suggestions, WelcomeHeading } from "./chat/welcome";
import { ChatMessage } from "./chat-message";
import { MessageComposer } from "./message-composer";
import { VoiceMode } from "./voice/voice-mode";
import { ModelStatus, WorkspaceHeader } from "./workspace-header";
import { useShell } from "./workspace-shell";

export function ChatWindow() {
  const { user } = useShell();
  const store = useConversations();
  const [prefs] = usePreferences();
  const [voiceOpen, setVoiceOpen] = useState(false);
  const messages = store.active?.messages ?? [];
  const generating = store.generatingId !== null;
  const lastContent = messages.at(-1)?.content.length ?? 0;
  const { ref, onScroll, atBottom, scrollToBottom } = useAutoScroll<HTMLDivElement>(`${messages.length}:${lastContent}`, prefs.autoScroll);

  const composer = (
    <MessageComposer
      generating={generating}
      speechLanguage={prefs.speechLanguage}
      onVoiceMode={() => setVoiceOpen(true)}
      autoSendVoice={prefs.autoSendVoice}
      onSend={(text, files, images) => void store.send(text, files, { images })}
      onStop={store.stop}
    />
  );

  return (
    <>
      {voiceOpen && <VoiceMode onClose={() => setVoiceOpen(false)} />}
      <WorkspaceHeader title={<AgentSelector />}>
        {store.active && <span className="hidden max-w-xs truncate text-sm text-muted lg:block">{store.active.title}</span>}
        <span className="hidden sm:inline-flex">
          <ModelStatus />
        </span>
      </WorkspaceHeader>

      {messages.length === 0 ? (
        // Empty state: centred greeting with the composer in the middle, like modern chat apps.
        <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-4 pb-[10vh] sm:px-6">
          {/* Soft brand glow behind the greeting */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-[22%] h-64 w-[min(720px,90vw)] -translate-x-1/2 rounded-full opacity-[0.13] blur-3xl [background:linear-gradient(90deg,var(--grad-1),var(--grad-2),var(--grad-3))]"
          />
          <WelcomeHeading name={user.name} />
          <div className="w-full">{composer}</div>
          <Suggestions onPick={(p) => void store.send(p)} />
        </div>
      ) : (
        <>
          <div className="relative min-h-0 flex-1">
            <div ref={ref} onScroll={onScroll} className="h-full overflow-y-auto">
              <div className="mx-auto w-full max-w-3xl px-4 pb-10 pt-6" role="log" aria-live="polite" aria-label="Conversation">
                {messages.map((m, i) => (
                  <ChatMessage
                    key={m.id}
                    message={m}
                    isLast={i === messages.length - 1}
                    canRegenerate={!generating}
                    showTimestamp={prefs.showTimestamps}
                    compact={prefs.compactMessages}
                    onRegenerate={store.regenerate}
                    onFeedback={(f) => store.setFeedback(m.id, f)}
                  />
                ))}
              </div>
            </div>
            {!atBottom && (
              <button
                type="button"
                onClick={() => scrollToBottom()}
                aria-label="Scroll to latest message"
                className="absolute bottom-3 left-1/2 flex size-9 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-surface-2 text-muted shadow-lg hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ArrowDown className="size-4" />
              </button>
            )}
          </div>
          <div className="shrink-0 px-3 pb-3 pt-1 sm:px-5">{composer}</div>
        </>
      )}
    </>
  );
}
