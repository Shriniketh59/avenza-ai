"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { isIOS, setAudioMode, speechAudio } from "@/lib/audio-unlock";
import { voiceApi } from "@/lib/voice-api";

interface Options {
  voice: string;
  /** The user's voice for each language (Settings). */
  voices?: Record<string, string>;
  speed: number;
  /** Language code of what is spoken, when known (helps pick a voice of that language). */
  language?: string;
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
  // iPhone/iPad: an element routed through Web Audio plays into a context Safari keeps suspended, which is
  // silent. Play it directly there; the visualizer uses its gentle pulse instead.
  if (isIOS()) return;
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

// Non-Latin scripts name their language: used to pick the device voice when the reply's language is not known.
const SCRIPTS: [RegExp, string][] = [
  [/[\u0b80-\u0bff]/, "ta"], [/[\u0c80-\u0cff]/, "kn"], [/[\u0a80-\u0aff]/, "gu"], [/[\u0a00-\u0a7f]/, "pa"],
  [/[\u0c00-\u0c7f]/, "te"], [/[\u0d00-\u0d7f]/, "ml"], [/[\u0980-\u09ff]/, "bn"], [/[\u0900-\u097f]/, "hi"],
  [/[\u0600-\u06ff]/, "ar"], [/[\u0400-\u04ff]/, "ru"], [/[\u3040-\u30ff]/, "ja"], [/[\uac00-\ud7af]/, "ko"],
  [/[\u4e00-\u9fff]/, "zh"], [/[\u0e00-\u0e7f]/, "th"], [/[\u0590-\u05ff]/, "he"], [/[\u0370-\u03ff]/, "el"],
];
const scriptLanguage = (text: string) => SCRIPTS.find(([re]) => re.test(text))?.[1];

/**
 * Plays sentences in order through the local Piper voice, prefetching the next
 * sentence while the current one plays. Falls back to the browser voice if the
 * backend cannot synthesise.
 */
export function useSpeechPlayer({ voice, voices, speed, language, onIdle }: Options) {
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
  const opts = useRef({ voice, voices, speed, language, onIdle });
  // Indirection so playNext can schedule itself from audio callbacks.
  const next = useRef<() => void>(() => {});

  useEffect(() => {
    opts.current = { voice, voices, speed, language, onIdle };
  });

  const fetchAudio = useCallback((text: string) => {
    let p = pending.current.get(text);
    if (!p) {
      abort.current ??= new AbortController();
      p = voiceApi.speak(text, {
        voice: opts.current.voice,
        voices: opts.current.voices,
        speed: opts.current.speed,
        language: opts.current.language,
        signal: abort.current.signal,
      });
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
      // The shared element: unlocked by the tap that opened voice mode, so phones allow it to play now.
      const el = (audio.current ??= speechAudio());
      attachMeter(meter, el);
      el.src = url;
      const finish = () => {
        URL.revokeObjectURL(url);
        done();
      };
      el.onended = finish;
      el.onerror = finish;
      setAudioMode("play"); // iPhone: loudspeaker at media volume, not call level
      await el.play();
    } catch {
      if (gen !== generation.current) return;
      // Fallback: the device's own speech engine, which has voices for languages AVENZA has none installed for
      // (Tamil, Kannada, Gujarati on Android and Chrome), and when the server cannot speak.
      if ("speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(text.replace(/[*#`_>|]/g, "").replace(/\[\d+(?:,\s*\d+)*\]/g, ""));
        u.rate = opts.current.speed;
        const lang = opts.current.language ?? scriptLanguage(text);
        if (lang) {
          u.lang = lang;
          const match = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang.toLowerCase()));
          if (match) u.voice = match;
        }
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
