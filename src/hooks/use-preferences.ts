"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { AgentId, ModelId } from "@/config/features";

export interface Preferences {
  showTimestamps: boolean;
  autoScroll: boolean;
  compactMessages: boolean;
  /** Whisper language code, or "auto" to detect. */
  speechLanguage: string;
  /** Language code AVENZA replies in (src/config/languages.ts), or "auto" = the language of the message. */
  replyLanguage: string;
  /** Piper voice id; "" = automatic (a voice of the reply's language, else the server default). */
  ttsVoice: string;
  /** The voice for each language ("hi" -> "hi_IN-rohan-medium"); a language not listed uses any installed voice of it. */
  ttsVoices: Record<string, string>;
  ttsSpeed: number;
  autoSendVoice: boolean;
  memoryEnabled: boolean;
  webSearch: boolean;
  /** Avenza Flash or Avenza Plus. */
  mode: ModelId;
  /** Specialist agent id, or "auto" to pick one per question. */
  agent: AgentId;
  /** User skill id to apply to every message; "" = none (a skill named in the message still applies). */
  skill: string;
}

const KEY = "avenza.preferences";
const DEFAULTS: Preferences = {
  showTimestamps: false,
  autoScroll: true,
  compactMessages: false,
  speechLanguage: "auto",
  replyLanguage: "auto",
  ttsVoice: "",
  ttsVoices: {},
  ttsSpeed: 1,
  autoSendVoice: false,
  memoryEnabled: true,
  webSearch: true,
  mode: "flash",
  agent: "auto",
  skill: "",
};

const listeners = new Set<() => void>();
let cache: Preferences | null = null;

function read(): Preferences {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
    // Saved before the models were named: "fast" / "accurate".
    const legacy = { fast: "flash", accurate: "plus" } as Record<string, ModelId>;
    cache!.mode = legacy[cache!.mode] ?? (cache!.mode === "plus" ? "plus" : "flash");
    // One voice picked before voices were per language: it becomes the voice for its own language.
    if (cache!.ttsVoice && !cache!.ttsVoices[cache!.ttsVoice.split("_")[0]]) {
      cache!.ttsVoices = { ...cache!.ttsVoices, [cache!.ttsVoice.split("_")[0]]: cache!.ttsVoice };
    }
  } catch {
    cache = DEFAULTS;
  }
  return cache!;
}

/** Device-local UI preferences (not account data). */
export function usePreferences() {
  const prefs = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => DEFAULTS,
  );
  const update = useCallback((patch: Partial<Preferences>) => {
    cache = { ...read(), ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(cache));
    } catch {
      /* storage unavailable: keep in memory */
    }
    listeners.forEach((l) => l());
  }, []);
  return [prefs, update] as const;
}
