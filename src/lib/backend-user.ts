import type { User } from "@/types/user";

/** Shape the Flask backend returns from its auth endpoints. */
export interface BackendAuthResponse {
  user: { id: string | number; name: string; email: string; avatar_url?: string | null; created_at?: string | null };
  token?: string | null;
}

export function toUser(raw: BackendAuthResponse["user"], provider: User["provider"]): User {
  return {
    id: String(raw.id),
    name: raw.name,
    email: raw.email,
    avatarUrl: raw.avatar_url ?? null,
    createdAt: raw.created_at ?? null,
    provider,
  };
}
