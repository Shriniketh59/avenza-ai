"use client";

import { Check, ChevronDown, CircleSlash, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AGENTS, MODELS } from "@/config/features";
import { useDismiss } from "@/hooks/use-dismiss";
import { usePreferences } from "@/hooks/use-preferences";
import { isPreviewMode, skillsApi } from "@/lib/api-client";
import type { Skill } from "@/types/extensions";
import { cn } from "@/lib/utils";

function Option({
  selected,
  onSelect,
  icon: Icon,
  name,
  hint,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  name: string;
  hint: string;
}) {
  return (
    <li role="option" aria-selected={selected}>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <Icon className="size-4 text-accent" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{name}</span>
          <span className="block text-xs text-muted">{hint}</span>
        </span>
        {selected && <Check className="size-4 text-accent" aria-hidden />}
      </button>
    </li>
  );
}

/**
 * Agent and model picker. Agents are specialist prompts and search rules on the backend;
 * the model is Avenza Flash (fast, simpler tasks) or Avenza Plus (complex tasks), and usage is charged per model.
 */
export function AgentSelector() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  const [prefs, update] = usePreferences();
  const mode = MODELS.find((m) => m.id === prefs.mode) ?? MODELS[0];
  const agent = AGENTS.find((a) => a.id === prefs.agent) ?? AGENTS[0];
  const [skills, setSkills] = useState<Skill[]>([]);
  const skill = skills.find((s) => s.id === prefs.skill);

  // The user's skills, refreshed each time the menu opens (they are edited in Settings).
  useEffect(() => {
    if (!open || isPreviewMode()) return;
    skillsApi
      .list()
      .then((r) => setSkills(r.skills.filter((s) => s.enabled || s.id === prefs.skill)))
      .catch(() => {});
  }, [open, prefs.skill]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="leading-tight">
          <span className="block text-[1.05rem] font-semibold">AVENZA</span>
          <span className="flex items-center gap-1 text-xs text-muted">
            {agent.name} · {mode.name}
            {prefs.skill && ` · ${skill?.name ?? "Skill"}`} <ChevronDown className="size-3" aria-hidden />
          </span>
        </span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-[75vh] w-80 overflow-y-auto rounded-xl border border-border bg-surface-2 p-1.5 shadow-xl shadow-black/30">
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Agent</p>
          <ul role="listbox" aria-label="Agent">
            {AGENTS.map((a) => (
              <Option
                key={a.id}
                selected={a.id === agent.id}
                onSelect={() => {
                  update({ agent: a.id });
                  close();
                }}
                icon={a.icon}
                name={a.name}
                hint={a.hint}
              />
            ))}
          </ul>
          <div className="my-1.5 h-px bg-border" />
          <p className="px-2.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Model</p>
          <ul role="listbox" aria-label="Model">
            {MODELS.map((m) => (
              <Option
                key={m.id}
                selected={m.id === mode.id}
                onSelect={() => {
                  update({ mode: m.id });
                  close();
                }}
                icon={m.icon}
                name={m.name}
                hint={m.hint}
              />
            ))}
          </ul>
          {skills.length > 0 && (
            <>
              <div className="my-1.5 h-px bg-border" />
              <p className="px-2.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Skill</p>
              <ul role="listbox" aria-label="Skill">
                <Option
                  selected={!prefs.skill}
                  onSelect={() => {
                    update({ skill: "" });
                    close();
                  }}
                  icon={CircleSlash}
                  name="Automatic"
                  hint="Uses a skill when its description fits the message, or when you name it"
                />
                {skills.map((s) => (
                  <Option
                    key={s.id}
                    selected={s.id === prefs.skill}
                    onSelect={() => {
                      update({ skill: s.id });
                      close();
                    }}
                    icon={Sparkles}
                    name={s.name}
                    hint={s.description || s.instructions.slice(0, 60)}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
