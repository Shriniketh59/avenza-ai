import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow opening the dev server from other devices on the LAN.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*"],
  // Hide the floating Next.js dev badge (it covered the sidebar profile).
  devIndicators: false,
};

export default nextConfig;
