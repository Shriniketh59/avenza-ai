"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { AgentId } from "@/config/features";

export interface Preferences {
  showTimestamps: boolean;
  autoScroll: boolean;
  compactMessages: boolean;
  /** Whisper language code, or "auto" to detect. */
  speechLanguage: string;
  /** Piper voice id; "" = server default. */
  ttsVoice: string;
  ttsSpeed: number;
  autoSendVoice: boolean;
  memoryEnabled: boolean;
  webSearch: boolean;
  mode: "fast" | "accurate";
  /** Specialist agent id, or "auto" to pick one per question. */
  agent: AgentId;
}

const KEY = "avenza.preferences";
const DEFAULTS: Preferences = {
  showTimestamps: false,
  autoScroll: true,
  compactMessages: false,
  speechLanguage: "auto",
  ttsVoice: "",
  ttsSpeed: 1,
  autoSendVoice: false,
  memoryEnabled: true,
  webSearch: true,
  mode: "fast",
  agent: "auto",
};

const listeners = new Set<() => void>();
let cache: Preferences | null = null;

function read(): Preferences {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
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
