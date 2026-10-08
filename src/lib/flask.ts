import "server-only";
import { env } from "@/lib/env";

/**
 * Server-side client for the future Python Flask backend.
 * All calls go server-to-server; the browser never talks to Flask directly.
 */

export class BackendUnavailableError extends Error {
  constructor() {
    super("The AVENZA backend is not configured. Set FLASK_API_URL to enable this feature.");
  }
}

export class BackendError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function flaskFetch(path: string, init: RequestInit & { token?: string | null } = {}): Promise<Response> {
  if (!env.flaskApiUrl) throw new BackendUnavailableError();
  const { token, headers, ...rest } = init;
  const merged: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(headers as Record<string, string> | undefined),
  };
  // An empty Content-Type means "let fetch decide" (multipart uploads).
  if (!merged["Content-Type"]) delete merged["Content-Type"];
  return fetch(`${env.flaskApiUrl}${path}`, { ...rest, headers: merged, cache: "no-store" });
}

export async function flaskJson<T>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const res = await flaskFetch(path, init);
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) {
    throw new BackendError(body.error || body.message || `Backend request failed (${res.status})`, res.status);
  }
  return body as T;
}

/** Shared mapping from backend failures to route-handler JSON responses. */
export function backendErrorResponse(err: unknown): Response {
  if (err instanceof BackendUnavailableError) {
    return Response.json({ error: err.message, code: "BACKEND_NOT_CONFIGURED" }, { status: 503 });
  }
  if (err instanceof BackendError) {
    return Response.json({ error: err.message }, { status: err.status >= 500 ? 502 : err.status });
  }
  return Response.json({ error: "Could not reach the AVENZA backend. Try again shortly." }, { status: 502 });
}
