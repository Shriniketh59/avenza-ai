import type { MetadataRoute } from "next";

/** Install AVENZA AI as an app ("Add to Home Screen"): full screen, own icon, opens straight into chat. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "AVENZA AI",
    short_name: "AVENZA",
    description: "AVENZA AI — agentic intelligence for modern finance.",
    start_url: "/chat",
    scope: "/",
    display: "standalone",
    // "any": the same manifest makes the Windows (Microsoft Store) app, whose window is landscape.
    orientation: "any",
    background_color: "#070f24",
    theme_color: "#070f24",
    categories: ["productivity", "finance", "education"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
