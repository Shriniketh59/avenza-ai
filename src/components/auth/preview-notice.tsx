import { Info } from "lucide-react";

/** Shown on auth pages while no backend is configured. */
export function PreviewNotice() {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3.5 py-3 text-xs text-foreground/90" role="note">
      <Info className="mt-0.5 size-4 shrink-0 text-amber-400" aria-hidden />
      <p>
        <span className="font-semibold">Preview mode.</span> Accounts and chats are saved only in this browser until the AVENZA
        backend is connected.
      </p>
    </div>
  );
}
