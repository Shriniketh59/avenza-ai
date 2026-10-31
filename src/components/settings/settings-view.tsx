"use client";

import {
  Database,
  Download,
  FileStack,
  Gauge,
  LogOut,
  MessageSquare,
  Mic,
  Monitor,
  Moon,
  Palette,
  Plug,
  RefreshCw,
  Sparkles,
  Sun,
  Trash2,
  UserRound,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useMounted } from "@/hooks/use-mounted";
import { usePreferences } from "@/hooks/use-preferences";
import { useSignOut } from "@/hooks/use-sign-out";
import { MODELS } from "@/config/features";
import { LANGUAGES, SPEECH_LANGUAGES, languageLabel } from "@/config/languages";
import { ApiError, isPreviewMode, memoryApi, usageApi } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { voiceApi, type CatalogVoice, type VoiceOption } from "@/lib/voice-api";
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


const selectCls =
  "h-9 max-w-full rounded-lg border border-border bg-surface-2 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
  const [prefs, update] = usePreferences();
  return (
    <>
      <SettingsSection title="Language" description="Saved on this device.">
        <SettingRow
          label="Reply language"
          description="AVENZA writes and speaks its answers in this language. Automatic replies in the language you write or speak in."
          control={
            <select aria-label="Reply language" value={prefs.replyLanguage} onChange={(e) => update({ replyLanguage: e.target.value })} className={selectCls}>
              <option value="auto">Automatic (same as my message)</option>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {languageLabel(l)}
                </option>
              ))}
            </select>
          }
        />
      </SettingsSection>
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
    </>
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

/** A sample sentence in the voice's own language, for the Test button. */
const SAMPLES: Record<string, string> = {
  en: "Hello, I'm AVENZA AI. This is how I sound.",
  hi: "नमस्ते, मैं AVENZA AI हूँ। मेरी आवाज़ ऐसी है।",
  es: "Hola, soy AVENZA AI. Así suena mi voz.",
  fr: "Bonjour, je suis AVENZA AI. Voici ma voix.",
  de: "Hallo, ich bin AVENZA AI. So klinge ich.",
  it: "Ciao, sono AVENZA AI. Questa è la mia voce.",
  pt: "Olá, eu sou a AVENZA AI. É assim que eu falo.",
  ru: "Здравствуйте, я AVENZA AI. Так звучит мой голос.",
  ar: "مرحبا، أنا AVENZA AI. هكذا يبدو صوتي.",
  zh: "你好，我是 AVENZA AI。这是我的声音。",
  ja: "こんにちは、AVENZA AIです。これが私の声です。",
  ko: "안녕하세요, 저는 AVENZA AI입니다. 제 목소리는 이렇습니다.",
  tr: "Merhaba, ben AVENZA AI. Sesim böyle.",
  te: "నమస్కారం, నేను AVENZA AI. నా గొంతు ఇలా ఉంటుంది.",
  ml: "നമസ്കാരം, ഞാൻ AVENZA AI ആണ്. എന്റെ ശബ്ദം ഇങ്ങനെയാണ്.",
  mr: "नमस्कार, मी AVENZA AI आहे. माझा आवाज असा आहे.",
  bn: "নমস্কার, আমি AVENZA AI। আমার কণ্ঠ এমন।",
  ur: "السلام علیکم، میں AVENZA AI ہوں۔ میری آواز ایسی ہے۔",
  ne: "नमस्ते, म AVENZA AI हुँ। मेरो आवाज यस्तो छ।",
  id: "Halo, saya AVENZA AI. Beginilah suara saya.",
};
const family = (locale: string) => locale.split(/[-_]/)[0];

async function play(text: string, opts: { voice?: string; voices?: Record<string, string>; speed: number; language?: string }) {
  const blob = await voiceApi.speak(text, opts);
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.onended = () => URL.revokeObjectURL(url);
  await audio.play();
}

function VoiceTab() {
  const [prefs, update] = usePreferences();
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [testing, setTesting] = useState<string | null>(null);
  const reload = useCallback(() => {
    if (isPreviewMode()) return;
    voiceApi.voices().then((r) => setVoices(r.voices)).catch(() => {});
  }, []);

  useEffect(reload, [reload]);

  // Installed voices grouped by language: each language gets its own voice choice.
  const groups = new Map<string, VoiceOption[]>();
  for (const v of voices) groups.set(family(v.language), [...(groups.get(family(v.language)) ?? []), v]);

  async function testVoice(lang: string) {
    setTesting(lang);
    try {
      await play(SAMPLES[lang] ?? SAMPLES.en, { voice: prefs.ttsVoices[lang], voices: prefs.ttsVoices, speed: prefs.ttsSpeed, language: lang });
    } catch {
      /* backend offline: button simply does nothing */
    } finally {
      setTesting(null);
    }
  }

  return (
    <>
      <SettingsSection title="Voice" description="Speech recognition (Whisper) and the voices (Piper) both run on this computer. Nothing is sent to the cloud.">
        <SettingRow
          label="Speech language"
          description={`Language you speak in. Auto-detect works for most languages; Whisper understands ${SPEECH_LANGUAGES.length}.`}
          control={
            <select aria-label="Speech language" value={prefs.speechLanguage} onChange={(e) => update({ speechLanguage: e.target.value })} className={selectCls}>
              <option value="auto">Detect automatically</option>
              {SPEECH_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {languageLabel(l)}
                </option>
              ))}
            </select>
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
      <SettingsSection
        title="Voice for each language"
        description="Each reply, translation and read-aloud uses the voice of its own language. Pick one per language, or leave Automatic. Languages with no voice here (like Tamil or Kannada) use your device's own voice; install more in the Voice library below."
      >
        {voices.length === 0 && <p className="text-sm text-muted">No voices installed.</p>}
        {[...groups].map(([lang, list]) => (
          <SettingRow
            key={lang}
            label={list[0].languageName + (list[0].nativeName && list[0].nativeName !== list[0].languageName ? ` · ${list[0].nativeName}` : "")}
            description={`${list.length} voice${list.length > 1 ? "s" : ""} installed`}
            control={
              <div className="flex items-center gap-2">
                <select
                  aria-label={`Voice for ${list[0].languageName}`}
                  value={prefs.ttsVoices[lang] ?? ""}
                  onChange={(e) => {
                    const next = { ...prefs.ttsVoices };
                    if (e.target.value) next[lang] = e.target.value;
                    else delete next[lang];
                    update({ ttsVoices: next, ttsVoice: "" });
                  }}
                  className={selectCls}
                >
                  <option value="">Automatic</option>
                  {list.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                      {v.country ? ` · ${v.country}` : ""} ({v.quality})
                    </option>
                  ))}
                </select>
                <Button variant="outline" size="sm" onClick={() => testVoice(lang)} disabled={testing !== null}>
                  {testing === lang ? "Playing…" : "Test"}
                </Button>
              </div>
            }
          />
        ))}
      </SettingsSection>
      <VoiceLibrary onChange={reload} speed={prefs.ttsSpeed} />
    </>
  );
}

/** Piper's full voice catalog: install any voice (about 60 MB each), try it, remove it. */
function VoiceLibrary({ onChange, speed }: { onChange: () => void; speed: number }) {
  const [catalog, setCatalog] = useState<CatalogVoice[] | null>(null);
  const [defaultVoice, setDefaultVoice] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const preview = isPreviewMode();

  const load = useCallback(
    () =>
      voiceApi
        .catalog()
        .then((r) => {
          setCatalog(r.voices);
          setDefaultVoice(r.default);
          setError(null);
          return r.voices;
        })
        .catch((e) => {
          setError(e instanceof ApiError ? e.message : "Could not load the voice library.");
          return null;
        }),
    [],
  );

  useEffect(() => {
    if (!preview) void load();
  }, [load, preview]);

  // While a download runs, refresh its progress; tell the picker when it finishes.
  const installing = catalog?.some((v) => v.state === "installing");
  useEffect(() => {
    if (!installing) return;
    const t = setInterval(async () => {
      const list = await load();
      if (list && !list.some((v) => v.state === "installing")) onChange();
    }, 1500);
    return () => clearInterval(t);
  }, [installing, load, onChange]);

  if (preview) return null;

  const q = query.trim().toLowerCase();
  const shown = (catalog ?? []).filter(
    (v) => !q || `${v.languageName} ${v.nativeName} ${v.country} ${v.name} ${v.language}`.toLowerCase().includes(q),
  );
  const installedCount = catalog?.filter((v) => v.state === "installed").length ?? 0;
  const languageCount = new Set(catalog?.map((v) => v.languageName)).size;

  return (
    <SettingsSection
      title="Voice library"
      description={
        catalog
          ? `${catalog.length} voices in ${languageCount} languages. ${installedCount} installed. Each voice is about 60 MB and runs offline once installed.`
          : "Every Piper voice, ready to install."
      }
    >
      {error && <p className="pb-3 text-sm text-danger">{error}</p>}
      {catalog === null && !error && <p className="text-sm text-muted">Loading…</p>}
      {catalog && (
        <div className="space-y-2 pb-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a language, country or voice (e.g. Hindi, Español, Brazil)"
            aria-label="Search voices"
            className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-sm placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <ul className="max-h-[28rem] divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {shown.length === 0 && <li className="px-3 py-3 text-sm text-muted">No voice matches “{query}”.</li>}
            {shown.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {v.languageName}
                    {v.nativeName && v.nativeName !== v.languageName ? ` · ${v.nativeName}` : ""} — {v.name}
                  </p>
                  <p className="text-xs text-muted">
                    {v.country} · {v.quality} quality{v.speakers > 1 ? ` · ${v.speakers} speakers` : ""} · {v.sizeMb} MB
                    {v.id === defaultVoice ? " · default" : ""}
                    {v.state === "error" && v.error ? ` · ${v.error}` : ""}
                  </p>
                </div>
                {v.state === "installed" ? (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={playing === v.id}
                      onClick={async () => {
                        setPlaying(v.id);
                        const lang = family(v.language);
                        await play(SAMPLES[lang] ?? SAMPLES.en, { voice: v.id, speed, language: lang }).catch(() => {});
                        setPlaying(null);
                      }}
                    >
                      {playing === v.id ? "Playing…" : "Try"}
                    </Button>
                    {v.id !== defaultVoice && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${v.languageName} voice ${v.name}`}
                        onClick={async () => {
                          try {
                            await voiceApi.remove(v.id);
                            await load();
                            onChange();
                          } catch (e) {
                            setError(e instanceof ApiError ? e.message : "Could not remove the voice.");
                          }
                        }}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                ) : v.state === "installing" ? (
                  <span className="text-xs tabular-nums text-muted">Installing… {v.progress}%</span>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        await voiceApi.install(v.id);
                        await load();
                      } catch (e) {
                        setError(e instanceof ApiError ? e.message : "Could not install the voice.");
                      }
                    }}
                  >
                    <Download /> {v.state === "error" ? "Retry" : "Install"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
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
