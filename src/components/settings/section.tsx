import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

export function SettingsSection({ title, description, soon, children }: { title: string; description?: string; soon?: boolean; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6" aria-labelledby={`s-${title}`}>
      <div className="mb-4 flex items-center gap-2">
        <h2 id={`s-${title}`} className="text-base font-semibold">
          {title}
        </h2>
        {soon && <Badge>Coming soon</Badge>}
      </div>
      {description && <p className="-mt-3 mb-4 text-sm text-muted">{description}</p>}
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

export function SettingRow({ label, description, control }: { label: string; description?: string; control: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
      {control}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative h-6 w-11 shrink-0 rounded-full bg-surface-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 aria-checked:bg-accent"
    >
      <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[22px]" : "translate-x-0.5"}`} />
    </button>
  );
}
