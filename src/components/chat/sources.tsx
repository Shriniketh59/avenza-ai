import { FileText, Globe, Newspaper } from "lucide-react";
import type { Source } from "@/types/chat";

const ICON = { document: FileText, news: Newspaper, web: Globe } as const;

export function Sources({ sources }: { sources: Source[] }) {
  const unique = sources.filter((s, i, all) => all.findIndex((x) => (x.url ?? x.filename) === (s.url ?? s.filename)) === i);
  const pages = (s: Source) => {
    const list = [...new Set(sources.filter((x) => !x.url && x.filename === s.filename && x.page).map((x) => x.page!))].sort((a, b) => a - b);
    return list.length ? ` · p. ${list.slice(0, 4).join(", ")}${list.length > 4 ? "…" : ""}` : "";
  };
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="Sources">
      <span className="text-xs text-muted">Sources</span>
      {unique.map((s) => {
        const Icon = ICON[s.kind ?? "document"];
        const chip = (
          <>
            <Icon className="size-3 shrink-0 text-blue" aria-hidden />
            <span className="truncate">
              {s.filename}
              {!s.url && pages(s)}
            </span>
          </>
        );
        const cls = "inline-flex max-w-56 items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs";
        return s.url ? (
          <a key={s.index} href={s.url} target="_blank" rel="noopener noreferrer" title={s.title ?? s.url} className={`${cls} hover:border-blue/50 hover:text-foreground`}>
            {chip}
          </a>
        ) : (
          <span key={s.index} className={cls} title={s.title ?? s.filename}>
            {chip}
          </span>
        );
      })}
    </div>
  );
}
