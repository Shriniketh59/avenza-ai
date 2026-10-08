import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/logo";

const STARS = [
  [8, 14, 0], [18, 38, 1.1], [27, 9, 0.4], [36, 26, 2.2], [61, 12, 0.9],
  [72, 33, 1.7], [83, 18, 0.2], [91, 42, 2.6], [47, 6, 1.4], [5, 47, 2.9],
];

/** Always-dark auth shell: starfield, glowing horizon, centred glass card. */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="dark relative flex min-h-full flex-col overflow-hidden bg-[#03071a] text-[#eef2ff]">
      {STARS.map(([x, y, d]) => (
        <span key={`${x}-${y}`} aria-hidden className="avz-star" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${d}s` }} />
      ))}
      <div aria-hidden className="avz-rim" />

      <header className="relative z-10 mx-auto flex h-20 w-full max-w-[1200px] items-center justify-between px-6">
        <Link href="/" aria-label="AVENZA AI home" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
          <Logo onDark />
        </Link>
        <Link
          href="/"
          className="inline-flex h-11 items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 text-sm font-semibold text-white transition-colors hover:bg-white/[0.14] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <ArrowLeft className="size-4" aria-hidden /> Back to home
        </Link>
      </header>

      <main className="relative z-10 flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:pt-6">
        <div className="avz-card-in w-full max-w-[440px] rounded-[30px] bg-[linear-gradient(160deg,rgba(25,227,181,0.5),rgba(255,255,255,0.08)_35%,rgba(255,255,255,0.06)_65%,rgba(154,123,255,0.5))] p-px">
          <div className="rounded-[29px] bg-[rgba(7,12,32,0.86)] px-6 pb-7 pt-9 backdrop-blur-2xl sm:px-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
