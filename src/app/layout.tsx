import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Manrope, Sora } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { isBackendConfigured } from "@/lib/env";
import "./globals.css";

const sans = Manrope({ variable: "--font-sans-face", subsets: ["latin"] });
const display = Sora({ variable: "--font-display-face", subsets: ["latin"], weight: ["500", "600", "700"] });
const mono = JetBrains_Mono({ variable: "--font-mono-face", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "AVENZA AI", template: "%s · AVENZA AI" },
  description: "AVENZA AI — agentic intelligence for modern finance.",
};

export const viewport: Viewport = {
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
      suppressHydrationWarning className={`${sans.variable} ${display.variable} ${mono.variable} h-full antialiased`}>
      <body className="h-full">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
