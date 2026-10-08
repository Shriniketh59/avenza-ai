"use client";

import { FileText, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ApiError, documentsApi } from "@/lib/api-client";
import { formatBytes } from "@/lib/utils";
import type { UploadedDocument } from "@/types/chat";

export function DocumentsPanel() {
  const [docs, setDocs] = useState<UploadedDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    documentsApi
      .list()
      .then((r) => setDocs(r.documents))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load documents."));
  }, []);

  useEffect(load, [load]);

  if (error) return <p className="py-3 text-sm text-danger">{error}</p>;
  if (!docs) return <p className="flex items-center gap-2 py-3 text-sm text-muted"><Loader2 className="size-4 animate-spin" /> Loading…</p>;
  if (docs.length === 0) return <p className="py-3 text-sm text-muted">No documents yet. Attach files in a chat to add them to your knowledge base.</p>;

  return (
    <ul className="divide-y divide-border">
      {docs.map((d) => (
        <li key={d.id} className="flex items-center gap-3 py-3">
          <FileText className="size-4 shrink-0 text-blue" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{d.filename}</p>
            <p className="text-xs text-muted">
              {formatBytes(d.size)} · {d.chunks} passages ·{" "}
              {d.status === "indexing" ? (
                <span className="text-blue">Indexing {Math.round(d.progress * 100)}%</span>
              ) : d.status === "error" ? (
                <span className="text-danger">{d.error ?? "Indexing failed"}</span>
              ) : (
                new Date(d.createdAt).toLocaleDateString()
              )}
            </p>
          </div>
          <button
            type="button"
            aria-label={`Delete ${d.filename}`}
            disabled={busy === d.id}
            onClick={async () => {
              setBusy(d.id);
              try {
                await documentsApi.remove(d.id);
                setDocs((list) => list?.filter((x) => x.id !== d.id) ?? null);
              } catch (e) {
                setError(e instanceof ApiError ? e.message : "Delete failed.");
              } finally {
                setBusy(null);
              }
            }}
            className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            {busy === d.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          </button>
        </li>
      ))}
    </ul>
  );
}
