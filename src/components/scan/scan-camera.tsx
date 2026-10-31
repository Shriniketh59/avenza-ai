"use client";

import { AlertCircle, Check, Copy, Loader2, SwitchCamera, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, documentsApi, scansApi } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { UploadedDocument } from "@/types/chat";

type Mode = "pages" | "flip" | "object";

interface Shot {
  key: number;
  thumb: string;
  state: "reading" | "added" | "duplicate" | "empty" | "error";
  page?: number;
  note?: string;
}

// Auto-capture: the view is sampled small and grey every SAMPLE_MS. A photo is taken when the picture has held
// still for STILL_SAMPLES samples after changing enough since the last photo (a page was turned, the object moved).
// Fast flip samples twice as often and needs only a moment of stillness, but also a sharp frame (no motion blur).
const SAMPLE_MS = { pages: 300, flip: 150, object: 300 };
const SAMPLE_W = 64;
const SAMPLE_H = 48;
const STILL = 5; // mean grey-level change between samples that still counts as "holding still"
const STILL_SAMPLES = { pages: 3, flip: 1, object: 3 };
const CHANGED = { pages: 14, flip: 10, object: 22 }; // mean change from the last photo that counts as a new view
const SHARP = 0.65; // fast flip: a frame at least this sharp, compared with the sharpest recent one
const HINTS: Record<Mode, string> = {
  pages: "Show the cover to load the book, or hold each page steady to read it.",
  flip: "Turn the pages one after another in front of the camera. Each sharp page is captured.",
  object: "Hold the object steady. Turn it to show other sides and labels.",
};
const MIN_CONTRAST = 18; // a dark or blank frame (lens covered, hand in the way) is never captured
const MAX_SIDE = 1600; // photo size sent for reading: enough for small print, quick to upload

function sample(video: HTMLVideoElement, canvas: HTMLCanvasElement): Uint8Array | null {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || !video.videoWidth) return null;
  ctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
  const rgba = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
  const grey = new Uint8Array(SAMPLE_W * SAMPLE_H);
  for (let i = 0; i < grey.length; i++) grey[i] = (rgba[i * 4] * 3 + rgba[i * 4 + 1] * 6 + rgba[i * 4 + 2]) / 10;
  return grey;
}

const meanDiff = (a: Uint8Array, b: Uint8Array) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
};

/** Edge strength: blurred (moving) frames score low. */
const sharpness = (a: Uint8Array) => {
  let sum = 0;
  for (let y = 0; y < SAMPLE_H - 1; y++)
    for (let x = 0; x < SAMPLE_W - 1; x++) {
      const i = y * SAMPLE_W + x;
      sum += Math.abs(a[i] - a[i + 1]) + Math.abs(a[i] - a[i + SAMPLE_W]);
    }
  return sum / a.length;
};

const contrast = (a: Uint8Array) => {
  const mean = a.reduce((s, v) => s + v, 0) / a.length;
  return Math.sqrt(a.reduce((s, v) => s + (v - mean) ** 2, 0) / a.length);
};

/**
 * Full-screen camera that scans a book page by page (or an object from several sides) into one document.
 * Each photo is read on the server; onDone gets the document to attach to the chat.
 */
export function ScanCamera({ onDone, onClose }: { onDone: (doc: UploadedDocument) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const small = useRef<HTMLCanvasElement | null>(null);
  const [mode, setMode] = useState<Mode>("pages");
  const [auto, setAuto] = useState(true);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [cameraError, setError] = useState<string | null>(null);
  // Browsers only give the camera to secure pages (https, or localhost).
  const error = "getUserMedia" in (navigator.mediaDevices ?? {})
    ? cameraError
    : "The camera needs a secure page: open AVENZA through https:// (or localhost).";
  const [shots, setShots] = useState<Shot[]>([]);
  const [hint, setHint] = useState(HINTS.pages);
  const [flash, setFlash] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const scan = useRef<Promise<UploadedDocument> | null>(null);
  const latest = useRef<UploadedDocument | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const lastShot = useRef<Uint8Array | null>(null);
  const prev = useRef<Uint8Array | null>(null);
  const still = useRef(0);
  const nextKey = useRef(1);
  const added = useRef(0);
  const sharpest = useRef(0);

  // Camera on (and off again when closing or switching cameras).
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    if (!navigator.mediaDevices) return; // insecure page: shown as the error above
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play().catch(() => {});
        }
        setError(null);
      })
      .catch((e: DOMException) =>
        setError(e.name === "NotAllowedError" ? "Camera access was blocked. Allow the camera for this site, then try again." : "Could not open the camera."),
      );
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [facing]);

  const capture = useCallback(() => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const scale = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext("2d")!.drawImage(v, 0, 0, canvas.width, canvas.height);
    const thumbCanvas = document.createElement("canvas");
    thumbCanvas.width = 96;
    thumbCanvas.height = Math.round((96 * canvas.height) / canvas.width);
    thumbCanvas.getContext("2d")!.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
    const key = nextKey.current++;
    setShots((list) => [...list, { key, thumb: thumbCanvas.toDataURL("image/jpeg", 0.7), state: "reading" }]);
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    navigator.vibrate?.(30);

    const patch = (p: Partial<Shot>) => setShots((list) => list.map((s) => (s.key === key ? { ...s, ...p } : s)));
    const blob = new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    scan.current ??= scansApi.create().then((r) => r.document);
    // One photo at a time, in the order taken, so page numbers follow the book.
    queue.current = queue.current.then(async () => {
      try {
        const [doc, photo] = await Promise.all([scan.current!, blob]);
        if (!photo) throw new ApiError("Could not take the photo.", 0);
        const r = await scansApi.addPage(doc.id, photo);
        if (r.document) latest.current = r.document;
        else latest.current ??= doc;
        if (r.status === "added") {
          added.current++;
          patch({ state: "added", page: r.page, note: r.preview });
          const by = r.book?.authors.length ? ` by ${r.book.authors[0]}` : "";
          setHint(
            r.book?.fullText
              ? `Found “${r.book.title}”${by}: the whole book is loaded (about ${Math.round(r.book.characters / 1800)} pages). Tap Done and ask anything.`
              : r.book
                ? `Found “${r.book.title}”${by}: summary and details loaded. Its full text is not freely available, so scan the pages you need.`
                : r.kind === "cover"
                  ? "Cover read, but the book was not found in the catalogues. Scan the pages you need."
                  : r.kind === "object"
                    ? `Got view ${r.page}${r.title ? ` of ${r.title}` : ""}. Turn it to show another side.`
                    : `Page ${r.page} read. Turn the page.`,
          );
        } else if (r.status === "duplicate") {
          patch({ state: "duplicate", page: r.page, note: `Same as page ${r.page}` });
          setHint(`Already have page ${r.page}. Turn to the next page.`);
        } else {
          patch({ state: "empty", note: r.error });
          setHint(r.error ?? "Nothing readable. Hold it flat, in good light.");
        }
      } catch (e) {
        const message = e instanceof ApiError ? e.message : "Could not read the photo.";
        patch({ state: "error", note: message });
        setHint(message);
      }
    });
  }, []);

  // Auto-capture loop.
  useEffect(() => {
    if (!auto || error) return;
    small.current ??= Object.assign(document.createElement("canvas"), { width: SAMPLE_W, height: SAMPLE_H });
    const id = setInterval(() => {
      const v = video.current;
      if (!v || finishing) return;
      const now = sample(v, small.current!);
      if (!now) return;
      const moving = prev.current ? meanDiff(now, prev.current) : 99;
      prev.current = now;
      still.current = moving < STILL ? still.current + 1 : 0;
      const sharp = sharpness(now);
      sharpest.current = Math.max(sharp, sharpest.current * 0.98); // slowly forgets, as lighting changes
      if (still.current < STILL_SAMPLES[mode] || contrast(now) < MIN_CONTRAST) return;
      if (mode === "flip" && sharp < SHARP * sharpest.current) return;
      if (lastShot.current && meanDiff(now, lastShot.current) < CHANGED[mode]) return;
      lastShot.current = now;
      still.current = 0;
      capture();
    }, SAMPLE_MS[mode]);
    return () => clearInterval(id);
  }, [auto, error, mode, capture, finishing]);

  async function finish() {
    setFinishing(true);
    setHint("Finishing the last pages…");
    await queue.current;
    if (latest.current && added.current > 0) return onDone(latest.current);
    // Nothing was read: drop the empty scan instead of leaving it in Documents.
    if (latest.current) await documentsApi.remove(latest.current.id).catch(() => {});
    onClose();
  }

  const read = shots.filter((s) => s.state === "added").length;
  const busy = shots.some((s) => s.state === "reading");

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label="Scan with camera">
      <video ref={video} playsInline muted autoPlay className="absolute inset-0 size-full object-cover" />
      {flash && <div className="pointer-events-none absolute inset-0 bg-white/60" aria-hidden />}

      {/* Top bar */}
      <div className="relative flex items-center gap-2 bg-gradient-to-b from-black/70 to-transparent px-4 pb-6 pt-[max(1rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onClose} aria-label="Close scanner" className="flex size-10 items-center justify-center rounded-full bg-black/40 hover:bg-black/60">
          <X className="size-5" />
        </button>
        <div role="radiogroup" aria-label="What are you scanning" className="mx-auto flex rounded-full bg-black/50 p-1 text-sm">
          {(["pages", "flip", "object"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => {
                setMode(m);
                setHint(HINTS[m]);
              }}
              className={cn("rounded-full px-3 py-1.5", mode === m ? "bg-white text-black" : "text-white/80")}
            >
              {m === "pages" ? "Book" : m === "flip" ? "Fast flip" : "Object"}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
          aria-label="Switch camera"
          className="flex size-10 items-center justify-center rounded-full bg-black/40 hover:bg-black/60"
        >
          <SwitchCamera className="size-5" />
        </button>
      </div>

      <div className="relative flex-1" />

      {/* Bottom: hint, thumbnails, controls */}
      <div className="relative space-y-3 bg-gradient-to-t from-black/85 via-black/60 to-transparent px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-10">
        <p className="text-center text-sm text-white/90" aria-live="polite">
          {error ?? hint}
        </p>
        {shots.length > 0 && (
          <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Captured photos">
            {shots.map((s) => (
              <li key={s.key} title={s.note} className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element -- local data URL thumbnail */}
                <img src={s.thumb} alt={s.page ? `Page ${s.page}` : "Photo"} className={cn("h-16 rounded-md border-2 object-cover", s.state === "added" ? "border-emerald-400" : s.state === "reading" ? "border-white/50" : "border-amber-400/80 opacity-60")} />
                <span className="absolute bottom-0.5 right-0.5 flex size-5 items-center justify-center rounded-full bg-black/70">
                  {s.state === "reading" ? <Loader2 className="size-3 animate-spin" /> : s.state === "added" ? <Check className="size-3 text-emerald-400" /> : s.state === "duplicate" ? <Copy className="size-3 text-amber-300" /> : <AlertCircle className="size-3 text-amber-300" />}
                </span>
                {s.page && s.state === "added" && <span className="absolute left-1 top-0.5 text-[10px] font-semibold drop-shadow">{s.page}</span>}
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between">
          <button
            type="button"
            role="switch"
            aria-checked={auto}
            onClick={() => setAuto((a) => !a)}
            className={cn("w-24 rounded-full px-3 py-2 text-xs font-medium", auto ? "bg-emerald-500/90 text-black" : "bg-white/15 text-white")}
          >
            Auto {auto ? "on" : "off"}
          </button>
          <button
            type="button"
            onClick={capture}
            disabled={Boolean(error) || finishing}
            aria-label="Take photo"
            className="flex size-[72px] items-center justify-center rounded-full border-4 border-white/90 disabled:opacity-40"
          >
            <span className="size-14 rounded-full bg-white active:scale-90" />
          </button>
          <button
            type="button"
            onClick={finish}
            disabled={finishing || shots.length === 0}
            className="w-24 rounded-full bg-white px-3 py-2 text-xs font-semibold text-black disabled:opacity-40"
          >
            {finishing || busy ? <Loader2 className="mx-auto size-4 animate-spin" /> : `Done (${read})`}
          </button>
        </div>
      </div>
    </div>
  );
}
