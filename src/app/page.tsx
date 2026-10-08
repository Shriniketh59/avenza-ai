import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Database, FileText, Globe, Mic, Sparkles } from "lucide-react";
import { Aurora, GenerativeDemo } from "@/components/auth/generative-showcase";
import { HeroHeadline } from "@/components/landing/hero-headline";
import { LandingNav } from "@/components/landing/landing-nav";
import { getSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: { absolute: "AVENZA AI — Intelligence for modern finance" },
};

const FEATURES = [
  { icon: FileText, color: "text-[#19e3b5]", title: "Answers from your files", text: "Upload reports, statements and sheets. Every answer cites the passage it came from." },
  { icon: Globe, color: "text-[#3d8bff]", title: "Live web & news", text: "Searches the web and fresh headlines for every question, so rates and results stay current." },
  { icon: Database, color: "text-[#9a7bff]", title: "Memory that's yours", text: "Remembers your role and preferences across chats. Clear it any time in Settings." },
  { icon: Mic, color: "text-[#19e3b5]", title: "Talk, hands-free", text: "Voice mode listens, answers out loud and lets you interrupt, just like a conversation." },
];

export default async function Home() {
  if (await getSession()) redirect("/chat");

  return (
    <div className="dark relative min-h-full overflow-hidden bg-[#050a1c] text-[#eef2ff]">
      <Aurora />
      <LandingNav />

      <section id="top" className="relative z-[1] mx-auto flex max-w-[1100px] flex-col items-center gap-6 px-6 pb-10 pt-14 text-center sm:pt-20">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-[13px] text-white/80">
          <Sparkles className="size-3.5 text-[#9a7bff]" aria-hidden />
          Now with live web search, document answers &amp; voice
        </span>
        <HeroHeadline />
        <p className="max-w-[620px] text-lg leading-relaxed text-white/70 sm:text-[19px]">
          AVENZA AI reads your documents, searches live sources and answers in plain language, with every claim traced back to where it came from.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          <Link
            href="/signup"
            className="avz-btn-grad inline-flex h-[52px] items-center gap-2 rounded-full px-7 text-base font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            Start for free <ArrowRight className="size-4" strokeWidth={2.4} aria-hidden />
          </Link>
          <a
            href="#demo"
            className="inline-flex h-[52px] items-center rounded-full border border-white/20 bg-white/5 px-7 text-base font-semibold text-white transition-colors hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            See it think
          </a>
        </div>
      </section>

      <section id="demo" aria-label="Demo" className="relative z-[1] mx-auto max-w-[820px] px-6 pb-20 pt-6">
        <div className="rounded-[32px] bg-[linear-gradient(135deg,rgba(25,227,181,0.55),rgba(61,139,255,0.35),rgba(154,123,255,0.55))] p-px">
          <div className="rounded-[31px] bg-[rgba(8,14,36,0.92)] p-2 sm:p-4">
            <GenerativeDemo className="max-w-none border-0 bg-transparent shadow-none backdrop-blur-none" />
          </div>
        </div>
      </section>

      <section id="features" className="relative z-[1] mx-auto max-w-[1200px] px-6 pb-24 pt-6">
        <h2 className="font-display mb-8 text-center text-3xl font-semibold tracking-tight sm:text-4xl">
          Built for <span className="avz-gradient-text">finance work</span>
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <li
              key={f.title}
              className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/[0.04] p-6 transition-[border-color,transform] duration-300 hover:-translate-y-0.5 hover:border-[#9a7bff]/45"
            >
              <f.icon className={`size-7 ${f.color}`} strokeWidth={1.8} aria-hidden />
              <h3 className="font-display text-lg font-semibold">{f.title}</h3>
              <p className="text-[15px] leading-relaxed text-white/65">{f.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <footer id="footer" className="relative z-[1] border-t border-white/10">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-6 py-7 text-sm text-white/55">
          <span>© {new Date().getFullYear()} AVENZA · A brighter tomorrow</span>
          <div className="flex gap-6">
            <a href="#footer" className="hover:text-white">Privacy</a>
            <a href="#footer" className="hover:text-white">Terms</a>
            <Link href="/login" className="hover:text-white">Log in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
