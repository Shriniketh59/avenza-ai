import { cookies } from "next/headers";
import { env, isGoogleConfigured, publicOrigin } from "@/lib/env";

const OAUTH_STATE_COOKIE = "avz_oauth_state";

/** Starts the Google OAuth 2.0 authorization-code flow (with PKCE). */
export async function GET(request: Request) {
  // Return to the address the user opened (localhost, a tunnel, the live site), not a fixed APP_URL.
  const origin = publicOrigin(request);
  if (!isGoogleConfigured()) {
    return Response.redirect(`${origin}/login?error=google_not_configured`, 302);
  }
  // Google only accepts https addresses (or localhost) as return addresses: a Wi-Fi IP can never work.
  const host = new URL(origin).hostname;
  if (/^(10|127|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+(\.\d+)?$/.test(host) && host !== "127.0.0.1") {
    return Response.redirect(`${origin}/login?error=google_local_address`, 302);
  }
  const redirectUri = `${origin}/api/auth/google/callback`;
  const next = new URL(request.url).searchParams.get("next") ?? "/chat";
  const state = crypto.randomUUID();
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));

  const store = await cookies();
  store.set(OAUTH_STATE_COOKIE, JSON.stringify({ state, verifier, redirectUri, next: next.startsWith("/") ? next : "/chat" }), {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: 600,
  });

  const params = new URLSearchParams({
    client_id: env.googleClientId!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
