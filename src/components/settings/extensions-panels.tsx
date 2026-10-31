"use client";

import { Download, GitBranch, Pencil, Plus, RefreshCw, Trash2, Upload, Wand2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { usePreferences } from "@/hooks/use-preferences";
import { ApiError, isPreviewMode, pluginsApi, skillsApi } from "@/lib/api-client";
import type { Plugin, Skill, SkillInput } from "@/types/extensions";
import { SettingRow, SettingsSection, Switch } from "./section";

const fieldCls =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const EMPTY: SkillInput = { name: "", description: "", instructions: "" };

function errorText(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback;
}

function SkillForm({ initial, onSave, onCancel }: { initial: SkillInput; onSave: (v: SkillInput) => Promise<void>; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-3 py-3.5"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
          await onSave(value);
        } catch (err) {
          setError(errorText(err, "Could not save the skill."));
          setSaving(false);
        }
      }}
    >
      <label className="block space-y-1">
        <span className="text-sm font-medium">Name</span>
        <input className={fieldCls} maxLength={60} required value={value.name} onChange={(e) => setValue({ ...value, name: e.target.value })} placeholder="Equity research note" />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Description</span>
        <input className={fieldCls} maxLength={300} value={value.description} onChange={(e) => setValue({ ...value, description: e.target.value })} placeholder="What it does and when to use it (AVENZA picks skills by this)" />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Instructions</span>
        <textarea
          className={`${fieldCls} min-h-36 font-mono text-xs leading-relaxed`}
          maxLength={20000}
          required
          value={value.instructions}
          onChange={(e) => setValue({ ...value, instructions: e.target.value })}
          placeholder={"How AVENZA should work when this skill is on, e.g.\n- Start with a 3-line summary\n- Then valuation, risks and a verdict table\n- Formal tone, no emojis"}
        />
        <span className="block text-right text-[11px] text-muted">{value.instructions.length} / 20000</span>
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Saving…" : "Save skill"}
        </Button>
      </div>
    </form>
  );
}

function skillMarkdown(s: Skill) {
  const yamlText = (v: string) => JSON.stringify(v); // a JSON string is valid YAML, quotes and all
  const slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "skill";
  return { slug, text: `---\nname: ${slug}\ndescription: ${yamlText(s.description)}\n---\n\n${s.instructions}\n` };
}

/** Save a skill as SKILL.md, the format Claude skills use (it can be imported back here or into Claude). */
function exportSkill(s: Skill) {
  const { slug, text } = skillMarkdown(s);
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${slug}-SKILL.md` });
  a.click();
  URL.revokeObjectURL(url);
}

function shortSource(url: string) {
  const m = url.match(/github\.com\/([^/]+\/[^/]+)\/blob\/[^/]+\/(.+)$/);
  return m ? `${m[1]} · ${m[2]}` : url;
}

/** "Create with AVENZA": describe the skill, the model drafts it, the user reviews it in the form. */
function SkillCreator({ onDraft, onCancel }: { onDraft: (v: SkillInput) => void; onCancel: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-3 py-3.5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          onDraft((await skillsApi.generate(prompt)).draft);
        } catch (err) {
          setError(errorText(err, "Could not draft the skill."));
          setBusy(false);
        }
      }}
    >
      <label className="block space-y-1">
        <span className="text-sm font-medium">What should this skill do?</span>
        <textarea
          className={`${fieldCls} min-h-24`}
          maxLength={2000}
          required
          minLength={8}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={"e.g. When I ask about a listed company, write an equity research note: summary, business, financials table, valuation, risks and a verdict."}
        />
      </label>
      <p className="text-xs text-muted">AVENZA drafts the name, a description of when to use it, and the instructions. You review and edit before saving.</p>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy || prompt.trim().length < 8}>
          <Wand2 /> {busy ? "Drafting…" : "Draft skill"}
        </Button>
      </div>
    </form>
  );
}

/** Import from a GitHub link (file, folder or repository) or a SKILL.md file from this computer. */
function SkillImporter({ onDone, onCancel }: { onDone: (count: number) => Promise<void>; onCancel: () => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function run(source: { url: string } | { content: string }) {
    setBusy(true);
    setError(null);
    try {
      const { skills } = await skillsApi.importSkills(source);
      await onDone(skills.length);
    } catch (err) {
      setError(errorText(err, "Could not import the skill."));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 py-3.5">
      <form
        className="space-y-1"
        onSubmit={(e) => {
          e.preventDefault();
          void run({ url: url.trim() });
        }}
      >
        <span className="text-sm font-medium">From GitHub</span>
        <div className="flex gap-2">
          <input
            className={fieldCls}
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/anthropics/skills/tree/main/skills"
            aria-label="GitHub link"
          />
          <Button type="submit" size="sm" className="h-auto" disabled={busy || !url.trim()}>
            {busy ? "Importing…" : "Import"}
          </Button>
        </div>
        <span className="block text-xs text-muted">
          A link to a SKILL.md file, a skill folder, or a whole repository (up to 10 skills). Imported skills can be updated from GitHub later.
        </span>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Or from a file</span>
        <input
          ref={fileRef}
          type="file"
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            if (file.size > 200_000) return setError("That file is too large for a skill (200 KB at most).");
            void run({ content: await file.text() });
          }}
        />
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload /> Upload SKILL.md
        </Button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Close
        </Button>
      </div>
    </div>
  );
}

export function SkillsTab() {
  const preview = isPreviewMode();
  const [prefs, update] = usePreferences();
  const [skills, setSkills] = useState<Skill[] | null>(null);
  // A skill id, "new", "create" (draft with AVENZA), "import", or null.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<SkillInput>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);

  const load = useCallback(
    () =>
      skillsApi
        .list()
        .then((r) => {
          setSkills(r.skills);
          setError(null);
        })
        .catch((e) => setError(errorText(e, "Could not load skills."))),
    [],
  );

  useEffect(() => {
    if (!preview) load();
  }, [load, preview]);

  if (preview) {
    return <SettingsSection title="Skills" description="Sign in with an account to create skills.">{null}</SettingsSection>;
  }

  const patchSkill = (s: Skill) => setSkills((list) => list?.map((x) => (x.id === s.id ? s : x)) ?? null);

  return (
    <SettingsSection
      title="Skills"
      description="Reusable instructions for how AVENZA works: a format, a tone, a workflow. Like Claude's skills, AVENZA uses one on its own when the message fits the skill's description; you can also pick one in the chat menu or name it in a message. Skills change how answers are written, never where facts come from."
    >
      {error && <p className="pb-3 text-sm text-danger">{error}</p>}
      {notice && <p className="pb-3 text-sm text-muted">{notice}</p>}
      {skills === null && !error && <p className="text-sm text-muted">Loading…</p>}
      {skills?.length === 0 && !editing && <p className="pb-3 text-sm text-muted">No skills yet. Write one, let AVENZA draft one, or import one from GitHub.</p>}
      {skills?.map((s) =>
        editing === s.id ? (
          <SkillForm
            key={s.id}
            initial={{ name: s.name, description: s.description, instructions: s.instructions }}
            onCancel={() => setEditing(null)}
            onSave={async (v) => {
              await skillsApi.update(s.id, v);
              setEditing(null);
              await load();
            }}
          />
        ) : (
          <SettingRow
            key={s.id}
            label={s.name + (prefs.skill === s.id ? " · in use" : "") + (s.enabled ? "" : " · off")}
            description={(s.description || s.instructions.slice(0, 90)) + (s.source_url ? ` · From GitHub: ${shortSource(s.source_url)}` : "")}
            control={
              <div className="flex items-center gap-1">
                <Switch
                  label={`Use ${s.name}`}
                  checked={s.enabled}
                  onChange={async (v) => {
                    patchSkill({ ...s, enabled: v });
                    try {
                      patchSkill((await skillsApi.setEnabled(s.id, v)).skill);
                    } catch (e) {
                      patchSkill(s);
                      setError(errorText(e, "Could not change the skill."));
                    }
                  }}
                />
                {s.source_url && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Update ${s.name} from GitHub`}
                    title="Update from GitHub"
                    disabled={refreshing === s.id}
                    onClick={async () => {
                      setRefreshing(s.id);
                      setNotice(null);
                      try {
                        const r = await skillsApi.refresh(s.id);
                        patchSkill(r.skill);
                        setNotice(r.changed ? `“${s.name}” was updated from GitHub.` : `“${s.name}” is already up to date.`);
                      } catch (e) {
                        setError(errorText(e, "Could not update the skill."));
                      } finally {
                        setRefreshing(null);
                      }
                    }}
                  >
                    <RefreshCw className={refreshing === s.id ? "animate-spin" : undefined} />
                  </Button>
                )}
                <Button variant="ghost" size="icon-sm" aria-label={`Export ${s.name} as SKILL.md`} title="Export as SKILL.md" onClick={() => exportSkill(s)}>
                  <Download />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s.id)}>
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${s.name}`}
                  onClick={async () => {
                    if (!window.confirm(`Delete the skill “${s.name}”?`)) return;
                    try {
                      await skillsApi.remove(s.id);
                      if (prefs.skill === s.id) update({ skill: "" });
                      await load();
                    } catch (e) {
                      setError(errorText(e, "Could not delete the skill."));
                    }
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            }
          />
        ),
      )}
      {editing === "new" && (
        <SkillForm
          initial={draft}
          onCancel={() => setEditing(null)}
          onSave={async (v) => {
            await skillsApi.create(v);
            setEditing(null);
            await load();
          }}
        />
      )}
      {editing === "create" && (
        <SkillCreator
          onCancel={() => setEditing(null)}
          onDraft={(v) => {
            setDraft(v);
            setEditing("new");
          }}
        />
      )}
      {editing === "import" && (
        <SkillImporter
          onCancel={() => setEditing(null)}
          onDone={async (count) => {
            setEditing(null);
            setNotice(`Imported ${count} skill${count === 1 ? "" : "s"}.`);
            await load();
          }}
        />
      )}
      {!editing && (
        <div className="flex flex-wrap gap-2 pt-3.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDraft(EMPTY);
              setEditing("new");
            }}
            disabled={skills === null && !error}
          >
            <Plus /> New skill
          </Button>
          <Button variant="outline" size="sm" onClick={() => setEditing("create")} disabled={skills === null && !error}>
            <Wand2 /> Create with AVENZA
          </Button>
          <Button variant="outline" size="sm" onClick={() => setEditing("import")} disabled={skills === null && !error}>
            <GitBranch /> Import
          </Button>
        </div>
      )}
    </SettingsSection>
  );
}

export function PluginsTab() {
  const preview = isPreviewMode();
  const [plugins, setPlugins] = useState<Plugin[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (preview) return;
    pluginsApi
      .list()
      .then((r) => setPlugins(r.plugins))
      .catch((e) => setError(errorText(e, "Could not load plugins.")));
  }, [preview]);

  if (preview) {
    return <SettingsSection title="Plugins" description="Sign in with an account to use plugins.">{null}</SettingsSection>;
  }

  return (
    <SettingsSection
      title="Plugins"
      description="Live tools AVENZA uses when a question needs them. Their data is shown as a cited source, so figures come from the named provider, not the model."
    >
      {error && <p className="pb-3 text-sm text-danger">{error}</p>}
      {plugins === null && !error && <p className="text-sm text-muted">Loading…</p>}
      {plugins?.map((p) => (
        <SettingRow
          key={p.id}
          label={p.name}
          description={`${p.description} Source: ${p.source}.`}
          control={
            <Switch
              label={p.name}
              checked={p.enabled}
              onChange={async (v) => {
                setPlugins((list) => list?.map((x) => (x.id === p.id ? { ...x, enabled: v } : x)) ?? null);
                try {
                  await pluginsApi.toggle(p.id, v);
                } catch (e) {
                  setPlugins((list) => list?.map((x) => (x.id === p.id ? { ...x, enabled: !v } : x)) ?? null);
                  setError(errorText(e, "Could not change the plugin."));
                }
              }}
            />
          }
        />
      ))}
    </SettingsSection>
  );
}
