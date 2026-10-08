import { ApiError } from "@/lib/api-error";
import { isPreviewMode } from "@/lib/api-client";

export type VoiceCommand =
  | { name: "new_chat" | "stop" | "exit_voice" }
  | { name: "toggle_web"; value: boolean }
  | { name: "set_mode"; value: "fast" | "accurate" }
  | { name: "web_search"; query: string };

export interface Transcription {
  text: string;
  language: string | null;
  command: VoiceCommand | null;
}

export interface VoiceOption {
  id: string;
  language: string;
  name: string;
  quality: string;
}

function assertBackend() {
  if (isPreviewMode()) throw new ApiError("Voice needs the AVENZA backend.", 503, "PREVIEW_MODE");
}

async function fail(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  throw new ApiError(body.error ?? fallback, res.status);
}

/** All speech processing runs on the local backend (Whisper + Piper). */
export const voiceApi = {
  async transcribe(audio: Blob, language: string): Promise<Transcription> {
    assertBackend();
    const form = new FormData();
    form.append("audio", audio, "speech.webm");
    form.append("language", language);
    const res = await fetch("/api/voice/transcribe", { method: "POST", body: form });
    if (!res.ok) return fail(res, "Could not transcribe audio.");
    return res.json();
  },

  async speak(text: string, opts: { voice?: string; speed?: number; signal?: AbortSignal }): Promise<Blob> {
    assertBackend();
    const res = await fetch("/api/voice/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: opts.voice || undefined, speed: opts.speed }),
      signal: opts.signal,
    });
    if (!res.ok) return fail(res, "Speech synthesis failed.");
    return res.blob();
  },

  async voices(): Promise<{ voices: VoiceOption[]; default: string }> {
    assertBackend();
    const res = await fetch("/api/voice/voices");
    if (!res.ok) return fail(res, "Could not load voices.");
    return res.json();
  },
};

/**
 * Split streamed Markdown into complete sentences ready to speak.
 * Returns [sentences, remainder]. Waits while a code block is still open.
 */
export function takeSentences(buffer: string, final = false): [string[], string] {
  if (!final && (buffer.match(/```/g)?.length ?? 0) % 2 === 1) return [[], buffer];
  const out: string[] = [];
  // Mid-stream, a sentence ends only at punctuation followed by whitespace, so "5." + "25" is not split.
  const re = final ? /[^.!?\n]*?(?:[.!?](?=\s|$)|\n+)/g : /[^.!?\n]*?(?:[.!?](?=\s)|\n+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(buffer))) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const piece = buffer.slice(last, re.lastIndex);
    if (piece.trim().length >= 2) out.push(piece.trim());
    last = re.lastIndex;
  }
  const rest = buffer.slice(last);
  if (final && rest.trim()) {
    out.push(rest.trim());
    return [mergeShort(out), ""];
  }
  return [mergeShort(out), rest];
}

/** Join tiny fragments so the voice does not pause after every list bullet. */
function mergeShort(parts: string[]): string[] {
  const merged: string[] = [];
  for (const p of parts) {
    if (merged.length && (merged[merged.length - 1].length < 40 || p.length < 12)) merged[merged.length - 1] += ` ${p}`;
    else merged.push(p);
  }
  return merged;
}
