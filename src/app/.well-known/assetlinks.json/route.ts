/**
 * Digital Asset Links: proves the Play Store app (a Trusted Web Activity) and this site belong together, so the
 * app opens AVENZA full screen with no browser bar. ANDROID_PACKAGE and ANDROID_CERT_SHA256 (the app signing key's
 * SHA-256 fingerprints, comma-separated, from Play Console → App integrity) are set where the site is deployed.
 */
export function GET() {
  const fingerprints = (process.env.ANDROID_CERT_SHA256 ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const statements = fingerprints.length
    ? [
        {
          relation: ["delegate_permission/common.handle_all_urls"],
          target: {
            namespace: "android_app",
            package_name: process.env.ANDROID_PACKAGE || "com.avenzaai.app",
            sha256_cert_fingerprints: fingerprints,
          },
        },
      ]
    : [];
  return Response.json(statements, { headers: { "Cache-Control": "public, max-age=3600" } });
}
