"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { voiceApi } from "@/lib/voice-api";

interface Options {
  voice: string;
  speed: number;
  /** Called when the queue has fully played out. */
  onIdle?: () => void;
}

interface Meter {
  ctx: AudioContext;
  analyser: AnalyserNode;
  buf: Uint8Array<ArrayBuffer>;
}

/** Route playback through an analyser once, so the visualizer can follow the real voice. */
function attachMeter(meter: { current: Meter | null }, el: HTMLAudioElement) {
  if (meter.current) {
    if (meter.current.ctx.state === "suspended") void meter.current.ctx.resume();
    return;
  }
  try {
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaElementSource(el).connect(analyser);
    analyser.connect(ctx.destination);
    meter.current = { ctx, analyser, buf: new Uint8Array(new ArrayBuffer(analyser.fftSize)) };
  } catch {
    // Web Audio unavailable: playback still works, the visualizer falls back to a gentle pulse.
  }
}

/**
 * Plays sentences in order through the local Piper voice, prefetching the next
 * sentence while the current one plays. Falls back to the browser voice if the
 * backend cannot synthesise.
 */
export function useSpeechPlayer({ voice, speed, onIdle }: Options) {
  const [speaking, setSpeaking] = useState(false);
  /** The sentence being spoken right now (for live captions). */
  const [current, setCurrent] = useState("");
  const meter = useRef<Meter | null>(null);
  const queue = useRef<string[]>([]);
  const pending = useRef(new Map<string, Promise<Blob>>());
  const busy = useRef(false);
  const generation = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const abort = useRef<AbortController | null>(null);
  const opts = useRef({ voice, speed, onIdle });
  // Indirection so playNext can schedule itself from audio callbacks.
  const next = useRef<() => void>(() => {});

  useEffect(() => {
    opts.current = { voice, speed, onIdle };
  });

  const fetchAudio = useCallback((text: string) => {
    let p = pending.current.get(text);
    if (!p) {
      abort.current ??= new AbortController();
      p = voiceApi.speak(text, { voice: opts.current.voice, speed: opts.current.speed, signal: abort.current.signal });
      p.catch(() => {}); // handled when consumed
      pending.current.set(text, p);
    }
    return p;
  }, []);

  const playNext = useCallback(async () => {
    const gen = generation.current;
    const text = queue.current.shift();
    if (!text) {
      busy.current = false;
      setSpeaking(false);
      setCurrent("");
      opts.current.onIdle?.();
      return;
    }
    busy.current = true;
    setSpeaking(true);
    setCurrent(text);
    const blobPromise = fetchAudio(text);
    if (queue.current[0]) fetchAudio(queue.current[0]);

    const done = () => {
      pending.current.delete(text);
      if (gen === generation.current) next.current();
    };

    try {
      const blob = await blobPromise;
      if (gen !== generation.current) return;
      const url = URL.createObjectURL(blob);
      const el = (audio.current ??= new Audio());
      attachMeter(meter, el);
      el.src = url;
      const finish = () => {
        URL.revokeObjectURL(url);
        done();
      };
      el.onended = finish;
      el.onerror = finish;
      await el.play();
    } catch {
      if (gen !== generation.current) return;
      // Fallback: the browser's own speech engine.
      if ("speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(text.replace(/[*#`_>|]/g, ""));
        u.rate = opts.current.speed;
        u.onend = done;
        u.onerror = done;
        window.speechSynthesis.speak(u);
      } else done();
    }
  }, [fetchAudio]);

  useLayoutEffect(() => {
    next.current = () => void playNext();
  });

  /** Output loudness 0..1 of what is playing right now; -1 when it cannot be measured. */
  const getLevel = useCallback(() => {
    const m = meter.current;
    if (!m || !busy.current) return busy.current ? -1 : 0;
    m.analyser.getByteTimeDomainData(m.buf);
    let sum = 0;
    for (const v of m.buf) sum += ((v - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / m.buf.length) * 4);
  }, []);

  const enqueue = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      queue.current.push(text);
      if (!busy.current) void playNext();
      else if (queue.current.length === 1) fetchAudio(text); // prefetch
    },
    [playNext, fetchAudio],
  );

  const stop = useCallback(() => {
    generation.current++;
    queue.current = [];
    pending.current.clear();
    abort.current?.abort();
    abort.current = null;
    audio.current?.pause();
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    busy.current = false;
    setSpeaking(false);
    setCurrent("");
  }, []);

  useEffect(() => stop, [stop]);

  const isBusy = useCallback(() => busy.current || queue.current.length > 0, []);

  return { enqueue, stop, speaking, isBusy, current, getLevel };
}
