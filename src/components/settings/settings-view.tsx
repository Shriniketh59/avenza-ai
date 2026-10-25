"use client";

import { Database, FileStack, Gauge, LogOut, MessageSquare, Mic, Monitor, Moon, Palette, Plug, RefreshCw, Sparkles, Sun, UserRound } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useMounted } from "@/hooks/use-mounted";
import { usePreferences } from "@/hooks/use-preferences";
import { useSignOut } from "@/hooks/use-sign-out";
import { MODELS } from "@/config/features";
import { ApiError, isPreviewMode, memoryApi, usageApi } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { voiceApi, type VoiceOption } from "@/lib/voice-api";
import type { UsageLimit, UsageSummary } from "@/types/usage";
import { useShell } from "../workspace-shell";
import { DocumentsPanel } from "./documents-panel";
import { PluginsTab, SkillsTab } from "./extensions-panels";
import { SettingRow, SettingsSection, Switch } from "./section";

const TABS = [
  { id: "general", label: "General", icon: Palette },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "voice", label: "Voice", icon: Mic },
  { id: "data", label: "Documents", icon: FileStack },
  { id: "memory", label: "Memory", icon: Database },
  { id: "skills", label: "Skills", icon: Sparkles },
  { id: "plugins", label: "Plugins", icon: Plug },
  { id: "usage", label: "Usage", icon: Gauge },
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
        {tab === "skills" && <SkillsTab />}
        {tab === "plugins" && <PluginsTab />}
        {tab === "usage" && <UsageTab />}
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

const fmt = new Intl.NumberFormat();

/** "Resets in 3 hr 12 min" for a near reset, "Resets Mon 5:30 AM" for one days away. */
function resetLabel(iso: string | null, idle: string): string {
  if (!iso) return idle;
  const at = new Date(iso);
  const mins = Math.max(0, Math.round((at.getTime() - Date.now()) / 60000));
  if (mins < 24 * 60) return `Resets in ${mins >= 60 ? `${Math.floor(mins / 60)} hr ` : ""}${mins % 60} min`;
  return `Resets ${at.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
}

function UsageBar({ label, detail, part }: { label: string; detail: string; part: UsageLimit }) {
  const pct = Math.min(100, Math.round((100 * part.used) / Math.max(1, part.limit)));
  return (
    <div className="py-3.5 first:pt-0 last:pb-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted">{detail}</p>
        </div>
        <p className="text-sm tabular-nums text-muted">{pct}% used</p>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 overflow-hidden rounded-full bg-surface-3"
      >
        <div className={cn("h-full rounded-full transition-[width]", pct >= 90 ? "bg-danger" : "bg-accent")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function UsageTab() {
  const preview = isPreviewMode();
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updated, setUpdated] = useState<Date | null>(null);

  const fetchUsage = useCallback(
    () =>
      usageApi
        .get()
        .then((r) => {
          setUsage(r.usage);
          setUpdated(new Date());
          setError(null);
        })
        .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load usage.")),
    [],
  );

  const load = useCallback(() => {
    setLoading(true);
    fetchUsage().finally(() => setLoading(false));
  }, [fetchUsage]);

  useEffect(() => {
    if (!preview) fetchUsage();
  }, [fetchUsage, preview]);

  if (preview) {
    return (
      <SettingsSection title="Usage" description="Sign in with an account to see your usage and limits.">
        <p className="text-sm text-muted">Usage is tracked per account on the AVENZA backend.</p>
      </SettingsSection>
    );
  }

  return (
    <>
      <SettingsSection
        title="Usage limits"
        description="Each message uses part of your limit, depending on its length and the sources read. Avenza Plus uses more of your limit than Avenza Flash."
      >
        {error && <p className="pb-3 text-sm text-danger">{error}</p>}
        {usage ? (
          <>
            <UsageBar
              label="Current session"
              detail={resetLabel(usage.session.resets_at, `Starts with your next message · ${usage.session.hours}-hour window`)}
              part={usage.session}
            />
            <UsageBar label="Weekly limit" detail={resetLabel(usage.weekly.resets_at, "")} part={usage.weekly} />
          </>
        ) : (
          !error && <p className="text-sm text-muted">Loading…</p>
        )}
        <div className="flex items-center justify-between gap-3 py-3.5 last:pb-0">
          <p className="text-xs text-muted">{updated ? `Last updated ${updated.toLocaleTimeString()}` : ""}</p>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn(loading && "animate-spin")} /> Refresh
          </Button>
        </div>
      </SettingsSection>
      {usage && (
        <SettingsSection title="This week by model" description={`${fmt.format(usage.messages_this_week)} message(s) since the weekly reset.`}>
          {MODELS.map((m) => {
            const u = usage.models[m.id];
            return (
              <SettingRow
                key={m.id}
                label={m.name}
                description={m.hint}
                control={
                  <span className="text-sm tabular-nums text-muted">
                    {Math.round((100 * (u?.weighted ?? 0)) / Math.max(1, usage.weekly.limit))}% of weekly limit
                  </span>
                }
              />
            );
          })}
        </SettingsSection>
      )}
    </>
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
