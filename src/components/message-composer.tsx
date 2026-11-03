"use client";

import { AlertCircle, ArrowUp, AudioLines, FileText, Globe, Loader2, ScanText, Sparkles, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { usePreferences } from "@/hooks/use-preferences";
import { ApiError, documentsApi, isPreviewMode, skillsApi } from "@/lib/api-client";
import { isImage, readImage, type PickedImage } from "@/lib/images";
import { cn, createId, formatBytes } from "@/lib/utils";
import type { AttachmentMeta, UploadedDocument } from "@/types/chat";
import type { Skill } from "@/types/extensions";
import { AttachmentButton } from "./attachment-button";
import { ScanCamera } from "./scan/scan-camera";
import { VoiceButton } from "./voice-button";
import { unlockAudio } from "@/lib/audio-unlock";

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
  const [scanning, setScanning] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [prefs, updatePrefs] = usePreferences();
  // Slash commands: typing "/" lists the user's skills; "/meeting-notes <text>" runs that skill on the text.
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [menuClosed, setMenuClosed] = useState(false);
  const typed = /^\/([\w-]*)$/.exec(text)?.[1];
  const commands =
    typed === undefined || !skills ? [] : skills.filter((s) => s.command.startsWith(typed.toLowerCase()) || s.name.toLowerCase().includes(typed.toLowerCase()));
  const menuOpen = typed !== undefined && !menuClosed;

  useEffect(() => {
    // Fetched each time the menu opens, so skills made in Settings show up at once.
    if (typed !== "" || isPreviewMode()) return;
    skillsApi
      .list()
      .then((r) => setSkills(r.skills))
      .catch(() => setSkills([]));
  }, [typed]);

  const pickCommand = (s: Skill) => {
    setText(`/${s.command} `);
    setMenuClosed(false);
    ref.current?.focus();
  };

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

  /** Indexing continues on the server: poll a document's progress until it finishes. */
  const track = async (key: string, first: UploadedDocument) => {
    const patch = (p: Partial<PendingFile>) => setFiles((list) => list.map((f) => (f.key === key ? { ...f, ...p } : f)));
    let document = first;
    patch({ status: document.status === "ready" ? "ready" : "indexing", progress: document.progress, documentId: document.id });
    while (document.status === "indexing") {
      await new Promise((r) => setTimeout(r, 1500));
      ({ document } = await documentsApi.get(document.id));
      if (document.status === "error") throw new ApiError(document.error ?? "Indexing failed.", 500);
      patch({ status: document.status === "ready" ? "ready" : "indexing", progress: document.progress });
    }
  };

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
          await track(key, (await documentsApi.upload(file)).document);
        } catch (err) {
          const message = err instanceof ApiError ? err.message : "Upload failed.";
          setFiles((list) => list.map((f) => (f.key === key ? { ...f, status: "error", error: message } : f)));
        }
      }),
    );
  }, []);

  /** A camera scan, finished: attach it like an uploaded file. */
  const addScan = useCallback(async (doc: UploadedDocument) => {
    const key = createId("file");
    setFiles((list) => [...list, { key, name: doc.filename, size: doc.size, type: doc.mimeType ?? "", status: "indexing", documentId: doc.id }]);
    try {
      await track(key, doc);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not prepare the scan.";
      setFiles((list) => list.map((f) => (f.key === key ? { ...f, status: "error", error: message } : f)));
    }
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
    if (menuOpen && commands.length) {
      const n = commands.length;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (h + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
        return;
      }
      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        e.preventDefault();
        pickCommand(commands[Math.min(highlight, n - 1)]);
        return;
      }
    }
    if (menuOpen && e.key === "Escape") {
      e.preventDefault();
      setMenuClosed(true);
      return;
    }
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
      {/* Pill composer: hairline border becomes an animated AVENZA gradient on focus. */}
      <div className="relative">
        {menuOpen && (
          <div className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-2xl border border-border bg-surface shadow-xl">
            <p className="px-4 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Skills</p>
            {skills === null ? (
              <p className="px-4 pb-3 text-sm text-muted">Loading…</p>
            ) : commands.length === 0 ? (
              <p className="px-4 pb-3 text-sm text-muted">
                {skills.length ? `No skill matches “/${typed}”.` : "No skills yet. Create or import them in Settings → Skills."}
              </p>
            ) : (
              <ul id="slash-commands" role="listbox" aria-label="Skill commands" className="max-h-64 overflow-y-auto pb-1.5">
                {commands.map((s, i) => (
                  <li key={s.id} role="option" aria-selected={i === highlight}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()} // keep focus in the message box
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => pickCommand(s)}
                      className={cn("flex w-full items-start gap-3 px-4 py-2 text-left", i === highlight && "bg-surface-2")}
                    >
                      <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">
                          /{s.command}
                          {!s.enabled && <span className="ml-1.5 text-xs font-normal text-muted">(off: runs only by command)</span>}
                        </span>
                        <span className="block truncate text-xs text-muted">{s.description || s.name}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
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
              onChange={(e) => {
                setText(e.target.value);
                setHighlight(0);
                setMenuClosed(false);
              }}
              onKeyDown={onKeyDown}
              disabled={disabled}
              placeholder="Ask AVENZA, or type / for skills"
              aria-controls={menuOpen ? "slash-commands" : undefined}
              className="block w-full resize-none bg-transparent px-5 pb-1.5 pt-4 text-[0.97rem] leading-relaxed placeholder:text-muted focus:outline-none"
              style={{ maxHeight: MAX_HEIGHT }}
            />
            <div className="flex items-center gap-1 px-2.5 pb-2.5">
              <AttachmentButton disabled={disabled || generating} current={files.length} onPick={upload} onError={setNotice} />
            <button
              type="button"
              disabled={disabled || generating || isPreviewMode()}
              onClick={() => setScanning(true)}
              aria-label="Scan with camera"
              title="Scan a book or object with the camera, then ask about it"
              className="flex size-9 items-center justify-center rounded-full text-muted hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            >
              <ScanText className="size-[18px]" />
            </button>
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
                  onClick={() => {
                    unlockAudio(); // during the tap: lets phones play the spoken replies later
                    onVoiceMode();
                  }}
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
      </div>
      {scanning && (
        <ScanCamera
          onClose={() => setScanning(false)}
          onDone={(doc) => {
            setScanning(false);
            void addScan(doc);
            setNotice(`${doc.filename} attached. Ask anything about it.`);
            ref.current?.focus();
          }}
        />
      )}
      <p className="mt-2 min-h-4 text-center text-[0.7rem] text-muted" aria-live="polite">
        {notice ?? "AVENZA AI can make mistakes. Check the cited sources and verify important financial information."}
      </p>
    </form>
  );
}
