"use client";

import { Loader2, Mic, Square } from "lucide-react";
import { useState } from "react";
import { MicrophoneError, useRecorder } from "@/hooks/use-recorder";
import { ApiError } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { voiceApi } from "@/lib/voice-api";

/** Dictation: record, transcribe locally with Whisper, insert the text. */
export function VoiceButton({
  language,
  disabled,
  onTranscript,
  onError,
}: {
  language: string;
  disabled?: boolean;
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
}) {
  const { record, stop, recording, level } = useRecorder();
  const [transcribing, setTranscribing] = useState(false);

  async function start() {
    try {
      const blob = await record({ autoStop: true, silenceMs: 1500, noSpeechMs: 10000 });
      if (!blob) return onError("Didn't catch that. Try again.");
      setTranscribing(true);
      const { text } = await voiceApi.transcribe(blob, language);
      if (text) onTranscript(text);
      else onError("Didn't catch that. Try again.");
    } catch (e) {
      onError(e instanceof MicrophoneError || e instanceof ApiError ? e.message : "Voice input failed.");
    } finally {
      setTranscribing(false);
    }
  }

  return (
    <button
      type="button"
      disabled={disabled || transcribing}
      onClick={recording ? stop : start}
      aria-pressed={recording}
      aria-label={recording ? "Stop dictation" : transcribing ? "Transcribing" : "Dictate"}
      title={recording ? "Stop" : "Dictate (runs locally)"}
      className={cn(
        "relative flex size-9 items-center justify-center rounded-full text-muted hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
        recording && "bg-danger/15 text-danger hover:bg-danger/20 hover:text-danger",
      )}
    >
      {recording && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full border-2 border-danger/60 transition-transform duration-75"
          style={{ transform: `scale(${1 + level * 0.5})` }}
        />
      )}
      {transcribing ? <Loader2 className="size-[18px] animate-spin" /> : recording ? <Square className="size-3.5 fill-current" /> : <Mic className="size-[18px]" />}
    </button>
  );
}
