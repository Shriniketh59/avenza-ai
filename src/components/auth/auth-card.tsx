import Link from "next/link";
import { cn } from "@/lib/utils";
import { LogoMark } from "../logo";

/** Logo in a slowly spinning gradient ring, gradient title, subtitle. */
export function AuthCardHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="flex flex-col items-center gap-3.5 text-center">
      <div className="relative flex size-14 items-center justify-center rounded-full bg-white/5">
        <span className="avz-ring avz-ring-slow absolute -inset-1.5 rounded-full" aria-hidden />
        <LogoMark className="size-7" />
      </div>
      <h1 className="font-display text-[1.75rem] font-semibold tracking-tight">
        <span className="avz-gradient-text">{title}</span>
      </h1>
      <p className="text-[15px] text-white/60">{subtitle}</p>
    </header>
  );
}

/** Sign in / Create account switch (each is its own route). */
export function AuthTabs({ active }: { active: "login" | "signup" }) {
  const tab = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={cn(
        "flex h-10 items-center justify-center rounded-full text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
        on ? "bg-white/[0.12] text-white" : "text-white/60 hover:text-white",
      )}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Account" className="grid grid-cols-2 gap-1 rounded-full border border-white/[0.08] bg-white/5 p-1">
      {tab("/login", "Sign in", active === "login")}
      {tab("/signup", "Create account", active === "signup")}
    </nav>
  );
}

export function AuthLegal() {
  return (
    <p className="text-center text-xs leading-relaxed text-white/50">
      By continuing you agree to the <a href="#terms" className="text-white/80 hover:underline">Terms</a> and{" "}
      <a href="#privacy" className="text-white/80 hover:underline">Privacy Policy</a>.
    </p>
  );
}
