import { isBackendConfigured } from "@/lib/env";
import { flaskFetch } from "@/lib/flask";

export async function GET() {
  if (!isBackendConfigured()) return Response.json({ backend: "not_configured" });
  try {
    const res = await flaskFetch("/health", { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return Response.json({ backend: "offline" });
    const body = (await res.json()) as {
      ai?: { ollama: string; llm: string; llm_ready: boolean; balance_ok?: boolean | null };
    };
    const ai = body.ai;
    // "online" only when the API key works and local retrieval (Ollama embeddings) is up.
    if (!ai?.llm_ready) return Response.json({ backend: "model_missing", model: ai?.llm ?? null });
    if (ai.balance_ok === false) return Response.json({ backend: "no_credit", model: ai.llm });
    if (ai.ollama !== "online") return Response.json({ backend: "model_offline", model: ai.llm });
    return Response.json({ backend: "online", model: ai.llm });
  } catch {
    return Response.json({ backend: "offline" });
  }
}
