"use client";

import { Database, FileStack, LogOut, MessageSquare, Mic, Monitor, Moon, Palette, Sun, UserRound } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useMounted } from "@/hooks/use-mounted";
import { usePreferences } from "@/hooks/use-preferences";
import { useSignOut } from "@/hooks/use-sign-out";
import { ApiError, isPreviewMode, memoryApi } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { voiceApi, type VoiceOption } from "@/lib/voice-api";
import { useShell } from "../workspace-shell";
import { DocumentsPanel } from "./documents-panel";
import { SettingRow, SettingsSection, Switch } from "./section";

const TABS = [
  { id: "general", label: "General", icon: Palette },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "voice", label: "Voice", icon: Mic },
  { id: "data", label: "Documents", icon: FileStack },
  { id: "memory", label: "Memory", icon: Database },
  { id: "account", label: "Account", icon: UserRound },
] as const;
type Tab = (typeof TABS)[number]["id"];

const THEMES = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
] as const;

const SPEECH_LANGS = [
  { id: "auto", label: "Detect automatically" },
  { id: "en", label: "English" },
  { id: "hi", label: "Hindi" },
  { id: "ta", label: "Tamil" },
  { id: "te", label: "Telugu" },
  { id: "kn", label: "Kannada" },
  { id: "ml", label: "Malayalam" },
  { id: "mr", label: "Marathi" },
  { id: "bn", label: "Bengali" },
  { id: "es", label: "Spanish" },
  { id: "fr", label: "French" },
  { id: "de", label: "German" },
];

export function SettingsView() {
  const [tab, setTab] = useState<Tab>("general");
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 md:flex-row">
      <nav aria-label="Settings sections" className="md:w-52 md:shrink-0">
        <ul role="tablist" aria-orientation="vertical" className="flex gap-1 overflow-x-auto md:flex-col">
          {TABS.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  tab === t.id ? "bg-surface-3 font-medium text-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground",
                )}
              >
                <t.icon className="size-4" aria-hidden />
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div id={`panel-${tab}`} role="tabpanel" className="min-w-0 flex-1 space-y-5">
        {tab === "general" && <GeneralTab />}
        {tab === "chat" && <ChatTab />}
        {tab === "voice" && <VoiceTab />}
        {tab === "data" && (
          <SettingsSection title="Documents" description="Files you attach are parsed, split into passages and embedded into your private ChromaDB collection.">
            <DocumentsPanel />
          </SettingsSection>
        )}
        {tab === "memory" && <MemoryTab />}
        {tab === "account" && <AccountTab />}
      </div>
    </div>
  );
}

function GeneralTab() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  return (
    <SettingsSection title="Appearance">
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
        {THEMES.map((t) => {
          const active = mounted && theme === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(t.id)}
              className={cn(
                "flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? "border-accent bg-accent/10 text-foreground" : "border-border text-muted hover:bg-surface-2",
              )}
            >
              <t.icon className="size-5" aria-hidden />
              {t.label}
            </button>
          );
        })}
      </div>
    </SettingsSection>
  );
}

function ChatTab() {
  const [prefs, update] = usePreferences();
  return (
    <SettingsSection title="Chat" description="Saved on this device.">
      <SettingRow label="Auto-scroll" description="Follow new messages as they stream in." control={<Switch label="Auto-scroll" checked={prefs.autoScroll} onChange={(v) => update({ autoScroll: v })} />} />
      <SettingRow label="Show timestamps" control={<Switch label="Show timestamps" checked={prefs.showTimestamps} onChange={(v) => update({ showTimestamps: v })} />} />
      <SettingRow label="Compact messages" description="Tighter spacing between messages." control={<Switch label="Compact messages" checked={prefs.compactMessages} onChange={(v) => update({ compactMessages: v })} />} />
    </SettingsSection>
  );
}

function VoiceTab() {
  const [prefs, update] = usePreferences();
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [testing, setTesting] = useState(false);
  const selectCls = "h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  useEffect(() => {
    if (isPreviewMode()) return;
    voiceApi.voices().then((r) => setVoices(r.voices)).catch(() => {});
  }, []);

  async function testVoice() {
    setTesting(true);
    try {
      const blob = await voiceApi.speak("Hello, I'm AVENZA AI. This is how I sound.", { voice: prefs.ttsVoice, speed: prefs.ttsSpeed });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch {
      /* backend offline: button simply does nothing */
    } finally {
      setTesting(false);
    }
  }

  return (
    <SettingsSection title="Voice" description="Speech recognition (Whisper) and the voice (Piper) both run on this computer. Nothing is sent to the cloud.">
      <SettingRow
        label="Speech language"
        description="Language you speak in. Auto-detect works for most languages."
        control={
          <select aria-label="Speech language" value={prefs.speechLanguage} onChange={(e) => update({ speechLanguage: e.target.value })} className={selectCls}>
            {SPEECH_LANGS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        }
      />
      <SettingRow
        label="Assistant voice"
        control={
          <div className="flex items-center gap-2">
            <select aria-label="Assistant voice" value={prefs.ttsVoice} onChange={(e) => update({ ttsVoice: e.target.value })} className={selectCls}>
              <option value="">Default</option>
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.language})
                </option>
              ))}
            </select>
            <Button variant="outline" size="sm" onClick={testVoice} disabled={testing}>
              {testing ? "Playing…" : "Test"}
            </Button>
          </div>
        }
      />
      <SettingRow
        label="Speaking speed"
        description={`${prefs.ttsSpeed.toFixed(1)}×`}
        control={
          <input
            type="range"
            aria-label="Speaking speed"
            min={0.7}
            max={1.6}
            step={0.1}
            value={prefs.ttsSpeed}
            onChange={(e) => update({ ttsSpeed: Number(e.target.value) })}
            className="w-40 accent-[var(--accent)]"
          />
        }
      />
      <SettingRow label="Send after dictation" description="In the message box, send as soon as you stop speaking." control={<Switch label="Send after dictation" checked={prefs.autoSendVoice} onChange={(v) => update({ autoSendVoice: v })} />} />
    </SettingsSection>
  );
}

function MemoryTab() {
  const [prefs, update] = usePreferences();
  const [status, setStatus] = useState<string | null>(null);
  const preview = isPreviewMode();
  return (
    <SettingsSection title="Memory" description="When on, facts you share (like your name, role or preferences) are stored in ChromaDB and recalled in later chats.">
      <SettingRow label="Reference saved memories" control={<Switch label="Reference saved memories" checked={prefs.memoryEnabled && !preview} disabled={preview} onChange={(v) => update({ memoryEnabled: v })} />} />
      <SettingRow
        label="Clear memory"
        description={status ?? "Permanently delete everything AVENZA AI remembers about you."}
        control={
          <Button
            variant="outline"
            size="sm"
            disabled={preview}
            onClick={async () => {
              try {
                await memoryApi.clear();
                setStatus("Memory cleared.");
              } catch (e) {
                setStatus(e instanceof ApiError ? e.message : "Could not clear memory.");
              }
            }}
          >
            Clear
          </Button>
        }
      />
    </SettingsSection>
  );
}

function AccountTab() {
  const { user } = useShell();
  const { signOut, pending } = useSignOut();
  return (
    <SettingsSection title="Account">
      <SettingRow label="Name" description={user.name} control={null} />
      <SettingRow label="Email" description={user.email} control={<span className="text-xs text-muted">{user.provider === "google" ? "Google account" : "Email & password"}</span>} />
      <SettingRow
        label="Sign out"
        description="End your session on this device."
        control={
          <Button variant="secondary" size="sm" onClick={signOut} disabled={pending}>
            <LogOut /> {pending ? "Signing out…" : "Sign out"}
          </Button>
        }
      />
    </SettingsSection>
  );
}
