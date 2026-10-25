"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
        <input className={fieldCls} maxLength={200} value={value.description} onChange={(e) => setValue({ ...value, description: e.target.value })} placeholder="One line on when to use it" />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Instructions</span>
        <textarea
          className={`${fieldCls} min-h-36 font-mono text-xs leading-relaxed`}
          maxLength={6000}
          required
          value={value.instructions}
          onChange={(e) => setValue({ ...value, instructions: e.target.value })}
          placeholder={"How AVENZA should work when this skill is on, e.g.\n- Start with a 3-line summary\n- Then valuation, risks and a verdict table\n- Formal tone, no emojis"}
        />
        <span className="block text-right text-[11px] text-muted">{value.instructions.length} / 6000</span>
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

export function SkillsTab() {
  const preview = isPreviewMode();
  const [prefs, update] = usePreferences();
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // skill id, "new", or null
  const [error, setError] = useState<string | null>(null);

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

  return (
    <SettingsSection
      title="Skills"
      description="Your own instructions for how AVENZA works: a format, a tone, a checklist. Pick one in the chat menu, or mention its name in a message to use it once. Skills change how answers are written, never where facts come from."
    >
      {error && <p className="pb-3 text-sm text-danger">{error}</p>}
      {skills === null && !error && <p className="text-sm text-muted">Loading…</p>}
      {skills?.length === 0 && editing !== "new" && <p className="pb-3 text-sm text-muted">No skills yet.</p>}
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
            label={s.name + (prefs.skill === s.id ? " · in use" : "")}
            description={s.description || s.instructions.slice(0, 90)}
            control={
              <div className="flex items-center gap-1">
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
      {editing === "new" ? (
        <SkillForm
          initial={EMPTY}
          onCancel={() => setEditing(null)}
          onSave={async (v) => {
            await skillsApi.create(v);
            setEditing(null);
            await load();
          }}
        />
      ) : (
        <div className="pt-3.5">
          <Button variant="outline" size="sm" onClick={() => setEditing("new")} disabled={skills === null}>
            <Plus /> New skill
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
