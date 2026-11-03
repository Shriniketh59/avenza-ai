const MESSAGES: Record<string, string> = {
  google_not_configured: "Google sign-in is not configured on this server yet.",
  google_cancelled: "Google sign-in was cancelled.",
  google_state: "Your Google sign-in session expired. Please try again.",
  google_exchange: "Google could not complete sign-in. Please try again.",
  google_unverified: "Your Google email address is not verified.",
  google_failed: "Google sign-in failed. Please try again.",
  google_local_address:
    "Google sign-in does not work on a Wi-Fi address like 192.168.x.x. Use email sign-in here, or open the app on its https address.",
};

export function authErrorMessage(code: string | undefined | null): string | null {
  return code ? (MESSAGES[code] ?? "Sign-in failed. Please try again.") : null;
}

export function backendHint(code?: string): string | null {
  return code === "BACKEND_NOT_CONFIGURED"
    ? "Email sign-in is waiting on the AVENZA backend. Set FLASK_API_URL to enable it."
    : null;
}
