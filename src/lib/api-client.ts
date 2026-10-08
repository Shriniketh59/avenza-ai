import type { ChatRequest, ChatStreamEvent, UploadedDocument } from "@/types/chat";
import type { User } from "@/types/user";
import { ApiError } from "@/lib/api-error";
import { localAuth } from "@/lib/local-auth";

export { ApiError };
import type { ForgotPasswordInput, LoginInput, SignupInput } from "@/lib/validations";

/**
 * Browser-side API client. Talks only to this app's Next.js route handlers,
 * which forward to the Flask backend server-side.
 */

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
    });
  } catch {
    throw new ApiError("Network error. Check your connection and try again.", 0);
  }
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    fields?: Record<string, string>;
  } & T;
  if (!res.ok) throw new ApiError(body.error ?? "Something went wrong.", res.status, body.code, body.fields);
  return body;
}

/**
 * Preview mode = no Flask backend configured (set by the root layout).
 * Everything then runs in the browser and no API requests are made.
 */
export function isPreviewMode(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.mode === "preview";
}

export const authApi = {
  login: (input: LoginInput) =>
    isPreviewMode() ? localAuth.login(input) : request<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify(input) }),
  signup: (input: SignupInput) =>
    isPreviewMode() ? localAuth.signup(input) : request<{ user: User }>("/api/auth/signup", { method: "POST", body: JSON.stringify(input) }),
  forgotPassword: (input: ForgotPasswordInput) =>
    isPreviewMode()
      ? localAuth.forgotPassword()
      : request<{ ok: true }>("/api/auth/forgot-password", { method: "POST", body: JSON.stringify(input) }),
  logout: () => (isPreviewMode() ? localAuth.logout() : request<{ ok: true }>("/api/auth/logout", { method: "POST" })),
  updateProfile: (input: { name: string }, current: User) =>
    isPreviewMode()
      ? localAuth.updateProfile(input, current)
      : request<{ user: User }>("/api/profile", { method: "PATCH", body: JSON.stringify(input) }),
};

export type BackendHealth = "online" | "offline" | "not_configured" | "preview" | "model_offline" | "model_missing" | "no_credit";

export const systemApi = {
  health: async (): Promise<{ backend: BackendHealth; model?: string | null }> =>
    isPreviewMode() ? { backend: "preview" } : request<{ backend: BackendHealth; model?: string | null }>("/api/health"),
};

export const documentsApi = {
  list: () => request<{ documents: UploadedDocument[] }>("/api/documents"),
  get: (id: string) => request<{ document: UploadedDocument }>(`/api/documents/${encodeURIComponent(id)}`),
  remove: (id: string) => request<{ ok: true }>(`/api/documents/${encodeURIComponent(id)}`, { method: "DELETE" }),
  async upload(file: File): Promise<{ document: UploadedDocument }> {
    if (isPreviewMode()) throw new ApiError("Document upload needs the AVENZA backend.", 503, "PREVIEW_MODE");
    const form = new FormData();
    form.append("file", file);
    let res: Response;
    try {
      res = await fetch("/api/documents", { method: "POST", body: form });
    } catch {
      throw new ApiError("Network error while uploading.", 0);
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string; document?: UploadedDocument };
    if (!res.ok || !body.document) throw new ApiError(body.error ?? "Upload failed.", res.status);
    return { document: body.document };
  },
};

export const memoryApi = {
  count: () => request<{ count: number }>("/api/memory"),
  clear: () => request<{ ok: true }>("/api/memory", { method: "DELETE" }),
};

/**
 * Stream a chat completion. The route handler returns newline-delimited JSON
 * events (see ChatStreamEvent). Abort via the signal to stop generation.
 */
export async function* streamChat(payload: ChatRequest, signal: AbortSignal): AsyncGenerator<ChatStreamEvent> {
  if (isPreviewMode()) {
    throw new ApiError(
      "AVENZA AI is not connected to its model yet. Your message is saved — replies will work once the backend is live.",
      503,
      "PREVIEW_MODE",
    );
  }
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiError(body.error ?? "The assistant is unavailable right now.", res.status, body.code);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) yield JSON.parse(line) as ChatStreamEvent;
    }
  }
  if (buffer.trim()) yield JSON.parse(buffer) as ChatStreamEvent;
}
