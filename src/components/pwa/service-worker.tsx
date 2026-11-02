"use client";

import { useEffect } from "react";

/** Registers public/sw.js, which makes AVENZA installable as an app (it does not cache anything). */
export function ServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* not installable then, but the site works the same */
      });
    }
  }, []);
  return null;
}
