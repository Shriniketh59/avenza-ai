import "server-only";

/**
 * Server-only environment access. Nothing here is ever shipped to the browser.
 */
export const env = {
  flaskApiUrl: process.env.FLASK_API_URL?.replace(/\/$/, "") || null,
  authSecret: process.env.AUTH_SECRET || null,
  appUrl: process.env.APP_URL?.replace(/\/$/, "") || "http://localhost:3000",
  googleClientId: process.env.GOOGLE_CLIENT_ID || null,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || null,
  isProd: process.env.NODE_ENV === "production",
};

export const isGoogleConfigured = () => Boolean(env.googleClientId && env.googleClientSecret && env.authSecret);
export const isBackendConfigured = () => Boolean(env.flaskApiUrl);

/**
 * The address the user actually opened, as https://host when a proxy or tunnel (Vercel, Cloudflare) says so.
 * Behind those, request.url can show the internal http address instead.
 */
export function publicOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() || request.headers.get("host") || url.host;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export function requireAuthSecret(): Uint8Array {
  if (!env.authSecret || env.authSecret.length < 32) {
    throw new Error("AUTH_SECRET is missing or shorter than 32 characters.");
  }
  return new TextEncoder().encode(env.authSecret);
}
