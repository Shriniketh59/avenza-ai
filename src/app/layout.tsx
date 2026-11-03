import type { Metadata, Viewport } from "next";
import {
  JetBrains_Mono,
  Manrope,
  Noto_Sans_Arabic,
  Noto_Sans_Bengali,
  Noto_Sans_Devanagari,
  Noto_Sans_Gujarati,
  Noto_Sans_Gurmukhi,
  Noto_Sans_Kannada,
  Noto_Sans_Malayalam,
  Noto_Sans_Tamil,
  Noto_Sans_Telugu,
  Sora,
} from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { isBackendConfigured } from "@/lib/env";
import "./globals.css";

const sans = Manrope({ variable: "--font-sans-face", subsets: ["latin"] });
const display = Sora({ variable: "--font-display-face", subsets: ["latin"], weight: ["500", "600", "700"] });
const mono = JetBrains_Mono({ variable: "--font-mono-face", subsets: ["latin"] });
// Fonts for Indian scripts and Arabic/Urdu, named explicitly: left to the system, Chrome sometimes picked a font
// with only a few Tamil letters (Noto Sans Grantha) and drew the rest as boxes. Each covers only its own script
// (unicode-range), so it downloads only when that script is on screen. next/font needs each option list written out.
const tamil = Noto_Sans_Tamil({ variable: "--font-tamil", subsets: ["tamil"], preload: false, display: "swap" });
const devanagari = Noto_Sans_Devanagari({ variable: "--font-devanagari", subsets: ["devanagari"], preload: false, display: "swap" });
const telugu = Noto_Sans_Telugu({ variable: "--font-telugu", subsets: ["telugu"], preload: false, display: "swap" });
const kannada = Noto_Sans_Kannada({ variable: "--font-kannada", subsets: ["kannada"], preload: false, display: "swap" });
const malayalam = Noto_Sans_Malayalam({ variable: "--font-malayalam", subsets: ["malayalam"], preload: false, display: "swap" });
const bengali = Noto_Sans_Bengali({ variable: "--font-bengali", subsets: ["bengali"], preload: false, display: "swap" });
const gujarati = Noto_Sans_Gujarati({ variable: "--font-gujarati", subsets: ["gujarati"], preload: false, display: "swap" });
const gurmukhi = Noto_Sans_Gurmukhi({ variable: "--font-gurmukhi", subsets: ["gurmukhi"], preload: false, display: "swap" });
const arabic = Noto_Sans_Arabic({ variable: "--font-arabic", subsets: ["arabic"], preload: false, display: "swap" });
const scripts = [tamil, devanagari, telugu, kannada, malayalam, bengali, gujarati, gurmukhi, arabic].map((f) => f.variable).join(" ");

export const metadata: Metadata = {
  title: { default: "AVENZA AI", template: "%s · AVENZA AI" },
  description: "AVENZA AI — agentic intelligence for modern finance.",
  // iPhone "Add to Home Screen": opens full screen with its own icon and name, like an installed app.
  appleWebApp: { capable: true, title: "AVENZA", statusBarStyle: "black-translucent" },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  // Draw under the notch and home bar; layouts pad themselves with the safe-area insets.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#070f24" },
    { media: "(prefers-color-scheme: light)", color: "#f5f7fb" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-mode={isBackendConfigured() ? "backend" : "preview"}
      suppressHydrationWarning className={`${sans.variable} ${display.variable} ${mono.variable} ${scripts} h-full antialiased`}>
      <body className="h-full">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
