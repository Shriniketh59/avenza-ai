import { EncryptJWT, jwtDecrypt } from "jose";
import type { Session } from "@/types/user";

/**
 * Encrypted session token helpers (JWE, dir + A256GCM).
 * Runtime-agnostic: used by route handlers, server components and proxy.ts.
 */

export const SESSION_COOKIE = "avz_session";
export const SESSION_TTL_SHORT = 60 * 60 * 12; // 12h when "remember me" is off
export const SESSION_TTL_LONG = 60 * 60 * 24 * 30; // 30d when "remember me" is on

async function deriveKey(secret: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return new Uint8Array(digest);
}

export async function encryptSession(session: Session, secret: string): Promise<string> {
  return new EncryptJWT({ session })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(session.expiresAt / 1000))
    .encrypt(await deriveKey(secret));
}

export async function decryptSession(token: string | undefined, secret: string | undefined): Promise<Session | null> {
  if (!token || !secret) return null;
  try {
    const { payload } = await jwtDecrypt(token, await deriveKey(secret));
    const session = payload.session as Session | undefined;
    if (!session || session.expiresAt < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}
