import { BarChart3, FileSearch, Lightbulb, ShieldCheck } from "lucide-react";

const SUGGESTIONS = [
  { icon: BarChart3, label: "Explain EBITDA vs net profit", prompt: "Explain the difference between EBITDA and net profit with a simple example." },
  { icon: FileSearch, label: "Summarise my report", prompt: "Summarise the key figures and risks in my uploaded document." },
  { icon: ShieldCheck, label: "Spot payment fraud", prompt: "What are common warning signs of fraud in digital payment transactions?" },
  { icon: Lightbulb, label: "Plan a monthly budget", prompt: "Help me build a simple monthly budget template for a small business." },
];

export function WelcomeHeading({ name }: { name: string }) {
  return (
    <div className="w-full max-w-3xl px-1">
      <h1 className="text-[2.1rem] font-semibold leading-tight tracking-tight sm:text-[2.75rem]">
        <span className="avz-gradient-text">Hello, {name.split(" ")[0]}</span>
      </h1>
      <p className="mt-1 text-[1.6rem] font-medium leading-tight tracking-tight text-muted/70 sm:text-[2.2rem]">How can I help you today?</p>
    </div>
  );
}

export function Suggestions({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <ul className="flex w-full max-w-3xl flex-wrap gap-2" aria-label="Suggested prompts">
      {SUGGESTIONS.map((s) => (
        <li key={s.label}>
          <button
            type="button"
            onClick={() => onPick(s.prompt)}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/60 px-4 py-2.5 text-sm text-foreground/85 transition-colors hover:border-transparent hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <s.icon className="size-4 text-accent" aria-hidden />
            {s.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
