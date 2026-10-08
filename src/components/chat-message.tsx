"use client";

import { AlertTriangle, Check, Copy, FileText, RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react";
import { memo, useState } from "react";
import { useSmoothText } from "@/hooks/use-smooth-text";
import { stripCitations } from "@/lib/citations";
import { cn, formatBytes } from "@/lib/utils";
import type { ChatMessage as Message, Feedback } from "@/types/chat";
import { LogoMark } from "./logo";
import { Markdown } from "./chat/markdown";
import { Sources } from "./chat/sources";
import { ToolStatus } from "./chat/tool-status";

interface Props {
  message: Message;
  isLast: boolean;
  canRegenerate: boolean;
  showTimestamp: boolean;
  compact: boolean;
  onRegenerate: () => void;
  onFeedback: (f: Feedback) => void;
}

export const ChatMessage = memo(function ChatMessage({ message, isLast, canRegenerate, showTimestamp, compact, onRegenerate, onFeedback }: Props) {
  const time = showTimestamp ? new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;

  if (message.role === "user") {
    return (
      <div className={cn("flex flex-col items-end gap-1.5", compact ? "py-1.5" : "py-3")}>
        {message.images && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {message.images.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- inline data URL thumbnail
              <img key={i} src={src} alt={`Attached image ${i + 1}`} className="max-h-48 max-w-60 rounded-2xl border border-border object-cover" />
            ))}
          </div>
        )}
        {message.attachments && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {message.attachments.map((a) => (
              <span key={a.id} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1 text-xs text-muted">
                <FileText className="size-3.5" aria-hidden /> {a.name} · {formatBytes(a.size)}
              </span>
            ))}
          </div>
        )}
        <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-3xl rounded-tr-md bg-surface-3 px-5 py-3 text-[0.97rem] leading-relaxed">
          {message.content}
        </div>
        {time && <span className="text-[0.7rem] text-muted">{time}</span>}
      </div>
    );
  }

  const waiting = message.status === "pending";
  const working = waiting || message.status === "streaming";
  const done = message.status === "complete" || message.status === "stopped";

  return (
    <div className={cn("group flex gap-3 sm:gap-4", compact ? "py-2" : "py-5")}>
      {/* Brand mark; a gradient ring spins around it while the answer is being produced. */}
      <div className="relative mt-0.5 flex size-8 shrink-0 items-center justify-center">
        {working && <span className="avz-ring absolute inset-0 rounded-full" aria-hidden />}
        <LogoMark className="size-[18px]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="sr-only">AVENZA AI said:</p>
        {message.toolCalls && message.toolCalls.length > 0 && <ToolStatus tools={message.toolCalls} />}

        {waiting && <Thinking />}
        {message.content && <Answer content={message.content} streaming={working} />}

        {message.sources && message.sources.length > 0 && message.status !== "pending" && <Sources sources={message.sources} />}
        {message.status === "stopped" && <p className="mt-2 text-xs italic text-muted">Generation stopped.</p>}
        {message.status === "error" && (
          <div role="alert" className="mt-1 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
            <span>{message.error}</span>
          </div>
        )}

        {(done || message.status === "error") && (
          <div className={cn("mt-2 flex items-center gap-0.5 text-muted", !isLast && "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100")}>
            {message.content && <CopyButton text={stripCitations(message.content)} />}
            {done && (
              <>
                <ActionButton label="Good response" pressed={message.feedback === "up"} onClick={() => onFeedback(message.feedback === "up" ? null : "up")}>
                  <ThumbsUp />
                </ActionButton>
                <ActionButton label="Bad response" pressed={message.feedback === "down"} onClick={() => onFeedback(message.feedback === "down" ? null : "down")}>
                  <ThumbsDown />
                </ActionButton>
              </>
            )}
            {isLast && canRegenerate && (
              <ActionButton label="Regenerate response" onClick={onRegenerate}>
                <RotateCcw />
              </ActionButton>
            )}
            {time && <span className="ml-2 text-[0.7rem]">{time}</span>}
          </div>
        )}
      </div>
    </div>
  );
});

/** Answer text without source numbers, typed out word by word while it streams. */
function Answer({ content, streaming }: { content: string; streaming: boolean }) {
  const shown = useSmoothText(stripCitations(content, streaming), streaming);
  const typing = streaming || shown.length < stripCitations(content).length;
  return (
    <div className={cn(typing && "avz-typing")}>
      <Markdown content={shown} />
    </div>
  );
}

/** Gradient shimmer placeholder shown until the first words arrive. */
function Thinking() {
  return (
    <div role="status" aria-label="AVENZA AI is thinking" className="space-y-3 pt-1">
      <p className="avz-shimmer-text text-sm font-medium">Thinking…</p>
      <div className="avz-shimmer w-full" />
      <div className="avz-shimmer w-[88%]" />
      <div className="avz-shimmer w-[62%]" />
    </div>
  );
}

function ActionButton({ label, pressed, onClick, children }: { label: string; pressed?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded-full hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:text-accent [&_svg]:size-4"
    >
      {children}
    </button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <ActionButton
      label={copied ? "Copied" : "Copy response"}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? <Check /> : <Copy />}
    </ActionButton>
  );
}
