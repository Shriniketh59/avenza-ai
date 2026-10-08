"use client";

import { Mic, MicOff, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useConversations } from "@/hooks/conversation-store";
import { usePreferences } from "@/hooks/use-preferences";
import { MicrophoneError, useRecorder } from "@/hooks/use-recorder";
import { useSpeechPlayer } from "@/hooks/use-speech-player";
import { ApiError } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { takeSentences, voiceApi, type VoiceCommand } from "@/lib/voice-api";
import { VoiceGlow, type VoicePhase } from "./voice-glow";

const STATUS: Record<VoicePhase, string> = {
  starting: "Starting",
  listening: "Listening",
  transcribing: "Understanding",
  thinking: "Searching your sources",
  speaking: "Speaking · tap to interrupt",
  paused: "Paused",
  error: "Something went wrong",
};

/** Words that rise out of a blur one after another; `step` is the delay between words in seconds. */
function AnimatedWords({ text, step }: { text: string; step: number }) {
  return (
    <>
      {text.split(/(\s+)/).map((w, i) =>
        /^\s+$/.test(w) ? (
          w
        ) : (
          <span key={i} className="avz-vword" style={{ "--d": `${(i / 2) * step}s` } as React.CSSProperties}>
            {w}
          </span>
        ),
      )}
    </>
  );
}

/** Caption text: plain words, no Markdown or citation markers. */
function caption(text: string) {
  return text.replace(/\[\d+\]/g, "").replace(/[#*`>|_]/g, "").replace(/\s{2,}/g, " ").trim();
}

interface Turn {
  startedAt: number;
  spoken: number;
  done: boolean;
}

/**
 * Hands-free conversation: listen → transcribe (Whisper) → answer extracted from
 * sources by local NLP models (no LLM) → speak sentence by sentence (Piper) → listen again.
 */
export function VoiceMode({ onClose }: { onClose: () => void }) {
  const store = useConversations();
  const [prefs, updatePrefs] = usePreferences();
  const { record, cancel: cancelRecording, level } = useRecorder();
  const [phase, setPhase] = useState<VoicePhase>("starting");
  const [heard, setHeard] = useState("");
  const [error, setError] = useState<string | null>(null);

  const active = useRef(true);
  const turn = useRef<Turn | null>(null);
  const listenRef = useRef<() => void>(() => {});
  const storeRef = useRef(store);
  const prefsRef = useRef(prefs);
  useLayoutEffect(() => {
    storeRef.current = store;
    prefsRef.current = prefs;
  });

  const player = useSpeechPlayer({
    voice: prefs.ttsVoice,
    speed: prefs.ttsSpeed,
    onIdle: () => {
      // Resume listening once the answer has been fully spoken.
      if (active.current && (!turn.current || turn.current.done)) listenRef.current();
    },
  });

  const say = useCallback(
    (text: string) => {
      turn.current = null;
      player.enqueue(text);
    },
    [player],
  );

  const ask = useCallback((text: string) => {
    setPhase("thinking");
    turn.current = { startedAt: Date.now(), spoken: 0, done: false };
    void storeRef.current.send(text, undefined, { voice: true });
  }, []);

  const runCommand = useCallback(
    (command: VoiceCommand, text: string) => {
      switch (command.name) {
        case "new_chat":
          storeRef.current.newChat();
          return say("Okay, starting a new chat.");
        case "stop":
          return listenRef.current();
        case "exit_voice":
          return onClose();
        case "toggle_web":
          updatePrefs({ webSearch: command.value });
          return say(`Web search is now ${command.value ? "on" : "off"}.`);
        case "set_mode":
          updatePrefs({ mode: command.value });
          return say(`Switched to ${command.value} mode.`);
        case "web_search":
          updatePrefs({ webSearch: true });
          return ask(text);
      }
    },
    [ask, onClose, say, updatePrefs],
  );

  const listen = useCallback(async () => {
    if (!active.current) return;
    setPhase("listening");
    setError(null);
    try {
      const blob = await record({ autoStop: true });
      if (!active.current) return;
      if (!blob) return setPhase("paused");
      setPhase("transcribing");
      const { text, command } = await voiceApi.transcribe(blob, prefsRef.current.speechLanguage);
      if (!active.current) return;
      if (!text) return void listenRef.current();
      setHeard(text);
      if (command) runCommand(command, text);
      else ask(text);
    } catch (e) {
      if (!active.current) return;
      setPhase("error");
      setError(e instanceof MicrophoneError || e instanceof ApiError ? e.message : "Voice processing failed.");
    }
  }, [ask, record, runCommand]);

  useLayoutEffect(() => {
    listenRef.current = () => void listen();
  });

  // Speak the assistant's reply while it streams in.
  const messages = store.active?.messages;
  useEffect(() => {
    const t = turn.current;
    const last = messages?.at(-1);
    if (!t || t.done || !last || last.role !== "assistant" || last.createdAt < t.startedAt) return;

    const finished = last.status !== "pending" && last.status !== "streaming";
    const fresh = last.content.slice(t.spoken);
    const [sentences, rest] = takeSentences(fresh, finished);
    t.spoken += fresh.length - rest.length;
    sentences.forEach(player.enqueue);

    if (finished) {
      t.done = true;
      if (last.status === "error") player.enqueue(`Sorry. ${last.error ?? "Something went wrong."}`);
      // Nothing left to say (e.g. empty reply): go straight back to listening.
      if (!player.isBusy()) setTimeout(() => listenRef.current(), 0);
    }
  }, [messages, player]);

  // Start listening on open; release everything on close.
  useEffect(() => {
    active.current = true;
    const id = setTimeout(() => listenRef.current(), 0);
    return () => {
      clearTimeout(id);
      active.current = false;
      cancelRecording();
    };
  }, [cancelRecording]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shownPhase: VoicePhase = player.speaking ? "speaking" : phase;

  const onOrb = () => {
    if (shownPhase === "speaking" || shownPhase === "thinking") {
      // Interrupt: stop talking and generating, listen to the user.
      player.stop();
      storeRef.current.stop();
      if (turn.current) turn.current.done = true;
      listenRef.current();
    } else if (shownPhase === "paused" || shownPhase === "error") {
      listenRef.current();
    } else if (shownPhase === "listening") {
      cancelRecording();
      setPhase("paused");
    }
  };

  const listening = shownPhase === "listening";
  const spoken = shownPhase === "speaking" ? caption(player.current) : "";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Voice conversation"
      data-phase={shownPhase}
      className="avz-voice fixed inset-0 z-50 flex flex-col overflow-hidden text-white"
    >
      <VoiceGlow phase={shownPhase} level={level} getSpeakerLevel={player.getLevel} />

      <div className="relative flex items-center justify-between px-4 py-4 sm:px-8">
        <span className="flex items-center gap-2 text-sm font-medium">
          <span className={cn("size-2 rounded-full bg-[var(--vc1)] shadow-[0_0_10px_var(--vc1)]", listening && "animate-pulse")} aria-hidden />
          <span className="avz-gradient-text font-semibold">AVENZA Live</span>
        </span>
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/70 backdrop-blur-md">
          {prefs.webSearch ? "Docs · News · Web" : "Docs · News"}
        </span>
      </div>

      {/* Whole stage is a tap target: interrupts while AVENZA talks, resumes when paused. */}
      <button
        type="button"
        onClick={onOrb}
        aria-label={STATUS[shownPhase]}
        className="relative flex min-h-0 flex-1 flex-col items-center px-6 text-center focus-visible:outline-none"
      >
        <p key={shownPhase} className="avz-status mt-[8vh] text-sm font-semibold uppercase tracking-[0.2em]" role="status" aria-live="polite">
          {STATUS[shownPhase]}
        </p>
        <div className="flex w-full max-w-3xl flex-1 items-center justify-center py-8">
          {error ? (
            <p className="text-lg text-red-300">{error}</p>
          ) : spoken ? (
            // Each word lights up in the phase colours at roughly the pace Piper speaks it (~0.36 s per word at 1x).
            <p key={spoken} className="avz-speak-text text-2xl font-medium leading-snug sm:text-4xl sm:leading-tight">
              <AnimatedWords text={spoken} step={0.36 / (prefs.ttsSpeed || 1)} />
            </p>
          ) : heard ? (
            <p
              key={heard}
              className={cn(
                "text-xl leading-snug sm:text-3xl",
                shownPhase === "thinking" ? "avz-think-text" : "text-white/60",
              )}
            >
              <AnimatedWords text={`“${heard}”`} step={0.05} />
            </p>
          ) : (
            <p key={shownPhase === "paused" ? "paused" : "idle"} className="text-xl text-white/65 sm:text-2xl">
              <AnimatedWords text={shownPhase === "paused" ? "Tap anywhere or press Resume to talk." : "Start talking. I’m listening."} step={0.06} />
            </p>
          )}
        </div>
      </button>

      <div className="relative flex items-center justify-center gap-4 pb-6 pt-4">
        <button
          type="button"
          onClick={() => (listening ? (cancelRecording(), setPhase("paused")) : listenRef.current())}
          aria-label={listening ? "Pause microphone" : "Resume microphone"}
          className={cn(
            "flex h-14 items-center gap-2 rounded-full px-6 text-sm font-medium backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
            listening ? "bg-white/15 hover:bg-white/25" : "bg-white text-[#05070f]",
          )}
        >
          {listening ? <MicOff className="size-5" /> : <Mic className="size-5" />}
          {listening ? "Hold" : "Resume"}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="End voice conversation"
          className="flex h-14 items-center gap-2 rounded-full bg-[#e5484d] px-6 text-sm font-medium text-white hover:bg-[#d13b40] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <X className="size-5" />
          End
        </button>
      </div>
      <p className="relative pb-5 text-center text-xs text-white/55">
        Say “new chat”, “search the web for…” or “goodbye”. Answers are quoted from your sources; speech stays on this computer.
      </p>
    </div>
  );
}
