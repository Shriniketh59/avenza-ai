import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow opening the dev server from other devices on the LAN, or through a Cloudflare quick tunnel (https).
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "*.trycloudflare.com"],
  // Hide the floating Next.js dev badge (it covered the sidebar profile).
  devIndicators: false,
};

export default nextConfig;
