// AVENZA AI service worker. App stores (Microsoft Store, Play Store) expect an installable web app to have one.
// It deliberately has no fetch handler: every request goes straight to the network, so streamed chat replies,
// voice and uploads behave exactly as in the browser, and nothing stale is ever served from a cache.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
