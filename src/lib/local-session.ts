import type { Session, User } from "@/types/user";

/**
 * Preview-mode session (no backend configured). The signed-in user's public
 * profile is kept in a readable cookie so server components and proxy.ts can
 * route correctly. This is NOT secure authentication — it exists so the
 * frontend is fully usable before the Flask backend ships.
 */
export const LOCAL_SESSION_COOKIE = "avz_preview_session";

export function encodeLocalSession(user: User, expiresAt: number): string {
  const json = JSON.stringify({ user, expiresAt });
  return btoa(String.fromCharCode(...new TextEncoder().encode(json)));
}

export function decodeLocalSession(value: string | undefined): Session | null {
  if (!value) return null;
  try {
    const bytes = Uint8Array.from(atob(decodeURIComponent(value)), (c) => c.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes)) as { user: User; expiresAt: number };
    if (!data.user?.id || !data.user.email || data.expiresAt < Date.now()) return null;
    return { user: data.user, expiresAt: data.expiresAt, backendToken: null };
  } catch {
    return null;
  }
}
