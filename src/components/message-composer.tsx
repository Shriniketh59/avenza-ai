"use client";

import { AlertCircle, ArrowUp, AudioLines, FileText, Globe, Loader2, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { usePreferences } from "@/hooks/use-preferences";
import { ApiError, documentsApi } from "@/lib/api-client";
import { isImage, readImage, type PickedImage } from "@/lib/images";
import { cn, createId, formatBytes } from "@/lib/utils";
import type { AttachmentMeta } from "@/types/chat";
import { AttachmentButton } from "./attachment-button";
import { VoiceButton } from "./voice-button";

interface Props {
  generating: boolean;
  disabled?: boolean;
  speechLanguage: string;
  autoSendVoice: boolean;
  onVoiceMode: () => void;
  onSend: (text: string, attachments: AttachmentMeta[], images: PickedImage[]) => void;
  onStop: () => void;
}

interface PendingFile {
  key: string;
  name: string;
  size: number;
  type: string;
  status: "uploading" | "indexing" | "ready" | "error";
  progress?: number;
  documentId?: string;
  error?: string;
  /** Images are read in the browser and go straight to the vision model, not to the document index. */
  image?: PickedImage;
}

const MAX_HEIGHT = 220;

export function MessageComposer({ generating, disabled, speechLanguage, autoSendVoice, onVoiceMode, onSend, onStop }: Props) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [prefs, updatePrefs] = usePreferences();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [text]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(id);
  }, [notice]);

  const uploading = files.some((f) => f.status === "uploading");
  const hasImages = files.some((f) => f.image);
  const canSend = (text.trim().length > 0 || hasImages) && !generating && !disabled && !uploading;

  const upload = useCallback(async (picked: File[]) => {
    const entries: PendingFile[] = picked.map((f) => ({ key: createId("file"), name: f.name, size: f.size, type: f.type, status: "uploading" }));
    setFiles((list) => [...list, ...entries]);
    await Promise.all(
      picked.map(async (file, i) => {
        const key = entries[i].key;
        const patch = (p: Partial<PendingFile>) => setFiles((list) => list.map((f) => (f.key === key ? { ...f, ...p } : f)));
        if (isImage(file)) {
          try {
            patch({ status: "ready", image: await readImage(file) });
          } catch {
            patch({ status: "error", error: "Could not read this image." });
          }
          return;
        }
        try {
          let { document } = await documentsApi.upload(file);
          patch({ status: document.status === "ready" ? "ready" : "indexing", progress: document.progress, documentId: document.id });
          // Indexing continues on the server; poll for progress until it finishes.
          while (document.status === "indexing") {
            await new Promise((r) => setTimeout(r, 1500));
            ({ document } = await documentsApi.get(document.id));
            if (document.status === "error") throw new ApiError(document.error ?? "Indexing failed.", 500);
            patch({ status: document.status === "ready" ? "ready" : "indexing", progress: document.progress });
          }
        } catch (err) {
          const message = err instanceof ApiError ? err.message : "Upload failed.";
          setFiles((list) => list.map((f) => (f.key === key ? { ...f, status: "error", error: message } : f)));
        }
      }),
    );
  }, []);

  const submit = useCallback(
    (value = text) => {
      const images = files.flatMap((f) => (f.image ? [f.image] : [])).slice(0, 4);
      if ((!value.trim() && !images.length) || generating || disabled || uploading) return;
      const ready = files
        .filter((f) => !f.image && (f.status === "ready" || f.status === "indexing"))
        .map<AttachmentMeta>((f) => ({ id: f.documentId!, name: f.name, size: f.size, type: f.type }));
      onSend(value.trim() || "What is in this image? Describe it and read out any text.", ready, images);
      setText("");
      setFiles([]);
      ref.current?.focus();
    },
    [text, files, generating, disabled, uploading, onSend],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const onTranscript = useCallback(
    (t: string) => {
      if (autoSendVoice) submit(t);
      else setText((prev) => (prev ? `${prev} ${t}` : t));
    },
    [autoSendVoice, submit],
  );

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        submit();
      }}
      className="mx-auto w-full max-w-3xl"
    >
      {/* Gemini-style pill: hairline border becomes an animated AVENZA gradient on focus. */}
      <div className={cn("avz-composer shadow-[0_10px_40px_-18px_rgba(0,0,0,0.6)]", disabled && "opacity-60")}>
        <div className="avz-composer-inner bg-surface-2">
          {files.length > 0 && (
            <ul className="flex flex-wrap gap-2 px-3 pt-3" aria-label="Attached files">
              {files.map((f) => (
                <li
                  key={f.key}
                  title={f.error}
                  className={cn(
                    "relative flex max-w-60 items-center gap-2 overflow-hidden rounded-xl border bg-surface py-1.5 pl-2 pr-1.5 text-xs",
                    f.status === "error" ? "border-danger/50" : "border-border",
                  )}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-blue/15 text-blue">
                    {f.image ? (
                      // eslint-disable-next-line @next/next/no-img-element -- local data URL preview
                      <img src={f.image.thumb} alt="" className="size-full object-cover" />
                    ) : f.status === "uploading" || f.status === "indexing" ? <Loader2 className="size-4 animate-spin" /> : f.status === "error" ? <AlertCircle className="size-4 text-danger" /> : <FileText className="size-4" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{f.name}</span>
                    <span className={cn("block", f.status === "error" ? "truncate text-danger" : "text-muted")}>
                      {f.status === "uploading"
                        ? "Uploading…"
                        : f.status === "indexing"
                          ? `Indexing ${Math.round((f.progress ?? 0) * 100)}%`
                          : f.status === "error"
                            ? f.error
                            : f.image
                              ? `${formatBytes(f.size)} · Image`
                              : `${formatBytes(f.size)} · Ready`}
                    </span>
                  </span>
                  {f.status === "indexing" && (
                    <span
                      aria-hidden
                      className="absolute bottom-0 left-0 h-0.5 bg-[linear-gradient(90deg,var(--grad-1),var(--grad-2))] transition-[width] duration-500"
                      style={{ width: `${Math.max(4, Math.round((f.progress ?? 0) * 100))}%` }}
                    />
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => setFiles((list) => list.filter((x) => x.key !== f.key))}
                    className="ml-1 rounded-full p-0.5 text-muted hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label htmlFor="composer" className="sr-only">
            Message AVENZA AI
          </label>
          <textarea
            id="composer"
            ref={ref}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={disabled}
            placeholder="Ask AVENZA"
            className="block w-full resize-none bg-transparent px-5 pb-1.5 pt-4 text-[0.97rem] leading-relaxed placeholder:text-muted focus:outline-none"
            style={{ maxHeight: MAX_HEIGHT }}
          />
          <div className="flex items-center gap-1 px-2.5 pb-2.5">
            <AttachmentButton disabled={disabled || generating} current={files.length} onPick={upload} onError={setNotice} />
            <button
              type="button"
              aria-pressed={prefs.webSearch}
              onClick={() => updatePrefs({ webSearch: !prefs.webSearch })}
              title={prefs.webSearch ? "Live web search on" : "Live web search off"}
              className={cn(
                "flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                prefs.webSearch ? "border-blue/40 bg-blue/15 text-blue" : "border-border text-muted hover:bg-surface-3 hover:text-foreground",
              )}
            >
              <Globe className="size-4" aria-hidden />
              Search
            </button>
            <span className="ml-auto" />
            <VoiceButton language={speechLanguage} disabled={disabled || generating} onTranscript={onTranscript} onError={setNotice} />
            {generating ? (
              <button
                type="button"
                onClick={onStop}
                aria-label="Stop generating"
                className="ml-1 flex size-9 items-center justify-center rounded-full bg-foreground text-background hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-2"
              >
                <Square className="size-3.5 fill-current" />
              </button>
            ) : !text.trim() && !files.length ? (
              <button
                type="button"
                onClick={onVoiceMode}
                disabled={disabled}
                aria-label="Start voice conversation"
                title="Voice mode"
                className="ml-1 flex size-9 items-center justify-center rounded-full bg-foreground text-background hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-2 disabled:opacity-40"
              >
                <AudioLines className="size-[18px]" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                aria-label="Send message"
                className="ml-1 flex size-9 items-center justify-center rounded-full bg-accent text-accent-foreground hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-2 disabled:bg-surface-3 disabled:text-muted"
              >
                <ArrowUp className="size-[18px]" strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
      </div>
      <p className="mt-2 min-h-4 text-center text-[0.7rem] text-muted" aria-live="polite">
        {notice ?? "AVENZA AI can make mistakes. Check the cited sources and verify important financial information."}
      </p>
    </form>
  );
}
