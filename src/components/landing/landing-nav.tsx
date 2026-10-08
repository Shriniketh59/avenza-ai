import Link from "next/link";
import { Logo } from "../logo";

const LINKS = [
  { href: "#demo", label: "Product" },
  { href: "#features", label: "Features" },
  { href: "#features", label: "Security" },
  { href: "#footer", label: "About" },
];

export function LandingNav() {
  return (
    <header className="relative z-10 mx-auto flex h-20 max-w-[1200px] items-center justify-between gap-4 px-6">
      <Link href="/" aria-label="AVENZA AI home" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
        <Logo onDark />
      </Link>
      <nav aria-label="Main" className="hidden gap-8 text-[15px] md:flex">
        {LINKS.map((l) => (
          <a key={l.label} href={l.href} className="text-white/70 transition-colors hover:text-white">
            {l.label}
          </a>
        ))}
      </nav>
      <div className="flex items-center gap-2.5">
        <Link
          href="/login"
          className="inline-flex h-11 items-center rounded-full border border-white/20 bg-white/[0.06] px-5 text-[15px] font-semibold text-white transition-colors hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          Log in
        </Link>
        <Link
          href="/signup"
          className="avz-btn-grad hidden h-11 items-center rounded-full px-5 text-[15px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 sm:inline-flex"
        >
          Get started
        </Link>
      </div>
    </header>
  );
}
