import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { env, isBackendConfigured, requireAuthSecret } from "@/lib/env";
import { LOCAL_SESSION_COOKIE, decodeLocalSession } from "@/lib/local-session";
import {
  SESSION_COOKIE,
  SESSION_TTL_LONG,
  SESSION_TTL_SHORT,
  decryptSession,
  encryptSession,
} from "@/lib/session-token";
import type { Session, User } from "@/types/user";

/** Read and decrypt the current session (memoised per request). */
export const getSession = cache(async (): Promise<Session | null> => {
  const store = await cookies();
  const real = await decryptSession(store.get(SESSION_COOKIE)?.value, env.authSecret ?? undefined);
  if (real || isBackendConfigured()) return real;
  // Preview mode: no backend yet, session lives in the browser.
  return decodeLocalSession(store.get(LOCAL_SESSION_COOKIE)?.value);
});

/** For server components / pages that must have a user. */
export async function requireUser(): Promise<User> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session.user;
}

export async function createSession(user: User, opts: { remember: boolean; backendToken?: string | null }) {
  requireAuthSecret();
  const ttl = opts.remember ? SESSION_TTL_LONG : SESSION_TTL_SHORT;
  const session: Session = {
    user,
    backendToken: opts.backendToken ?? null,
    expiresAt: Date.now() + ttl * 1000,
  };
  const token = await encryptSession(session, env.authSecret!);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: "lax",
    path: "/",
    // Without "remember me" the cookie is a browser-session cookie.
    ...(opts.remember ? { maxAge: ttl } : {}),
  });
  return session;
}

export async function updateSessionUser(patch: Partial<Pick<User, "name" | "avatarUrl">>) {
  const session = await getSession();
  if (!session) return null;
  const remember = session.expiresAt - Date.now() > SESSION_TTL_SHORT * 1000;
  return createSession({ ...session.user, ...patch }, { remember, backendToken: session.backendToken });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(LOCAL_SESSION_COOKIE);
}
