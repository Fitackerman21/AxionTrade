"use client";

/**
 * Landing page client shell — structure inspired by the AlgoSensei reference
 * (full-bleed 3D hero, centred wordmark, CTA row, bottom link rail) with
 * AxionTrade branding, tokens and copy. Lives at /home; `/` stays the
 * sign-in entry.
 */

import Link from "next/link";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { ArrowRight, Bot, Globe2, LineChart, ShieldCheck, Zap } from "lucide-react";

import { BrandWordmark } from "@/components/brand";
import { TickerStrip } from "@/components/ticker-strip";

/** three.js is heavy and browser-only — split it into its own client bundle. */
const LandingScene = dynamic(
  () => import("@/components/landing-scene").then((m) => m.LandingScene),
  {
    ssr: false,
    loading: () => <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(46,144,250,0.08),transparent_60%)]" />,
  },
);

const FEATURES = [
  {
    icon: Bot,
    title: "AxAI engine",
    text: "A simulated algo desk that plans, fills and scores every move — live in the terminal.",
    href: "/trade",
  },
  {
    icon: Globe2,
    title: "Multi-asset coverage",
    text: "Stocks, ETFs, crypto, FX and commodities — one workspace, one watchlist.",
    href: "/markets",
  },
  {
    icon: Zap,
    title: "Execution in milliseconds",
    text: "Real-time pricing with sub-second refresh across every market we cover.",
    href: "/markets",
  },
  {
    icon: ShieldCheck,
    title: "Paper-first by design",
    text: "Simulated fills, transparent fees and risk meters — learn the loop before real money.",
    href: "/trade",
  },
];

const STATS = [
  { value: "120+", label: "Global markets" },
  { value: "$0", label: "Commission on stocks" },
  { value: "24/5", label: "Extended-hours trading" },
  { value: "<1s", label: "Live price refresh" },
];

const LINKS = [
  { href: "/home", label: "Overview" },
  { href: "/markets", label: "Markets" },
  { href: "/trade", label: "Trade" },
  { href: "/holdings", label: "Holdings" },
  { href: "/account", label: "Account" },
];

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, delay: 0.08 * i, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

export default function HomeClient() {
  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden">
      {/* 3D hero backdrop — pointer-events off so the page stays fully interactive */}
      <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
        <LandingScene />
        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-background to-transparent" />
      </div>

      {/* top bar */}
      <header className="relative z-10 flex items-center justify-between px-5 py-4 sm:px-8">
        <Link href="/home" className="transition-opacity hover:opacity-85">
          <BrandWordmark />
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="hidden rounded-xl border border-border bg-surface/60 px-4 py-2 text-sm font-medium text-foreground backdrop-blur transition-colors hover:border-muted/40 hover:bg-surface sm:inline-flex"
          >
            Sign in
          </Link>
          <Link
            href="/trade"
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-brand to-gain px-4 py-2 text-sm font-semibold text-[#071018] shadow-[0_8px_28px_-8px_rgba(46,144,250,0.55)] transition-transform active:scale-[0.985]"
          >
            Open terminal
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      {/* live ticker */}
      <div className="relative z-10">
        <TickerStrip />
      </div>

      {/* hero */}
      <section className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 py-14 text-center">
        <motion.div variants={fadeUp} initial="hidden" animate="show" custom={0}>
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/70 px-3.5 py-1.5 text-xs font-medium text-muted backdrop-blur">
            <LineChart className="h-3.5 w-3.5 text-gain" />
            AxAI engine · simulated trading, live pricing
          </span>
        </motion.div>

        <motion.h1
          variants={fadeUp}
          initial="hidden"
          animate="show"
          custom={1}
          className="mt-6 max-w-3xl text-5xl font-semibold leading-[1.04] tracking-tight sm:text-6xl md:text-7xl"
        >
          <span className="text-gradient">Axion</span>
          <span className="text-foreground">Trade</span>
        </motion.h1>

        <motion.p
          variants={fadeUp}
          initial="hidden"
          animate="show"
          custom={2}
          className="mt-5 max-w-xl text-lg leading-relaxed text-muted sm:text-xl"
        >
          Every market. One terminal. An AI engine that trades alongside you —
          plan, fill and score, in milliseconds.
        </motion.p>

        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="show"
          custom={3}
          className="mt-9 flex flex-col items-center gap-3 sm:flex-row"
        >
          <Link
            href="/"
            className="group inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand to-gain px-7 text-[15px] font-semibold text-[#071018] shadow-[0_8px_28px_-8px_rgba(46,144,250,0.55)] transition-transform active:scale-[0.985]"
          >
            Get started
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link
            href="/trade"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-brand/40 bg-surface/60 px-7 text-[15px] font-semibold text-brand backdrop-blur transition-colors hover:border-brand hover:bg-surface"
          >
            <Bot className="h-4.5 w-4.5" />
            See the AxAI engine
          </Link>
        </motion.div>

        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="show"
          custom={4}
          className="mt-12 flex flex-wrap items-start justify-center gap-x-10 gap-y-6"
        >
          {STATS.map((s) => (
            <div key={s.label} className="text-center">
              <p className="text-2xl font-semibold tracking-tight text-foreground">{s.value}</p>
              <p className="mt-0.5 text-xs text-muted">{s.label}</p>
            </div>
          ))}
        </motion.div>
      </section>

      {/* feature cards */}
      <section className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-10">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              variants={fadeUp}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.4 }}
              custom={i}
            >
              <Link
                href={f.href}
                className="glass block h-full rounded-2xl p-5 transition-colors hover:border-muted/30"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface-2">
                  <f.icon className="h-5 w-5 text-brand-2" />
                </span>
                <p className="mt-4 text-sm font-semibold text-foreground">{f.title}</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{f.text}</p>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      {/* bottom link rail — nod to the reference's bottom nav */}
      <nav className="relative z-10 flex justify-center px-6 pb-4">
        <div className="flex flex-wrap items-center justify-center gap-1 rounded-full border border-border bg-surface/60 px-2 py-1.5 backdrop-blur">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-full px-3.5 py-1.5 text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              {l.label}
            </Link>
          ))}
          <span className="mx-1 h-4 w-px bg-border" />
          <Link
            href="/"
            className="rounded-full px-3.5 py-1.5 text-[13px] font-medium text-brand transition-colors hover:bg-surface-2"
          >
            Sign in
          </Link>
        </div>
      </nav>

      <footer className="relative z-10 border-t border-border/60 px-6 py-4 text-center text-xs text-muted">
        © {new Date().getFullYear()} AxionTrade · Simulated trading — not investment advice
      </footer>
    </main>
  );
}
