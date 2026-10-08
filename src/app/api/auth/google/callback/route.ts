import { cookies } from "next/headers";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { createSession } from "@/lib/auth";
import { toUser, type BackendAuthResponse } from "@/lib/backend-user";
import { env, isBackendConfigured, isGoogleConfigured } from "@/lib/env";
import { flaskJson } from "@/lib/flask";

const OAUTH_STATE_COOKIE = "avz_oauth_state";
const googleJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

interface GoogleIdClaims {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const fail = (code: string) => Response.redirect(`${url.origin}/login?error=${code}`, 302);
  if (!isGoogleConfigured()) return fail("google_not_configured");

  const store = await cookies();
  const raw = store.get(OAUTH_STATE_COOKIE)?.value;
  store.delete({ name: OAUTH_STATE_COOKIE, path: "/api/auth/google" });
  const saved = raw ? (JSON.parse(raw) as { state: string; verifier: string; next: string }) : null;

  const code = url.searchParams.get("code");
  if (url.searchParams.get("error")) return fail("google_cancelled");
  if (!code || !saved || saved.state !== url.searchParams.get("state")) return fail("google_state");

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.googleClientId!,
        client_secret: env.googleClientSecret!,
        redirect_uri: `${env.appUrl}/api/auth/google/callback`,
        grant_type: "authorization_code",
        code_verifier: saved.verifier,
      }),
    });
    if (!tokenRes.ok) return fail("google_exchange");
    const { id_token } = (await tokenRes.json()) as { id_token?: string };
    if (!id_token) return fail("google_exchange");

    const { payload } = await jwtVerify<GoogleIdClaims>(id_token, googleJwks, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: env.googleClientId!,
    });
    if (!payload.email_verified) return fail("google_unverified");

    let backendToken: string | null = null;
    let user = {
      id: `google:${payload.sub}`,
      name: payload.name ?? payload.email,
      email: payload.email,
      avatarUrl: payload.picture ?? null,
      provider: "google" as const,
    };

    // When the Flask backend exists, it owns the account record.
    if (isBackendConfigured()) {
      const data = await flaskJson<BackendAuthResponse>("/auth/oauth/google", {
        method: "POST",
        body: JSON.stringify({ id_token }),
      });
      user = { ...toUser(data.user, "google"), avatarUrl: data.user.avatar_url ?? payload.picture ?? null, provider: "google" };
      backendToken = data.token ?? null;
    }

    await createSession(user, { remember: true, backendToken });
    return Response.redirect(`${url.origin}${saved.next}`, 302);
  } catch {
    return fail("google_failed");
  }
}
