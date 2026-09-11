"use client";

import { Suspense, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Globe,
  Lock,
  Mail,
  ShieldCheck,
  TrendingUp,
  Zap,
} from "lucide-react";

import { AuroraBackground } from "@/components/aurora-background";
import { BrandMark, BrandWordmark } from "@/components/brand";
import { DashboardShell } from "@/components/dashboard-shell";
import { signIn } from "@/lib/demo-auth";
import { GlassButton } from "@/components/glass-button";
import { LivePricesProvider } from "@/components/live-prices";
import { TickerStrip } from "@/components/ticker-strip";

const FEATURES = [
  {
    icon: TrendingUp,
    title: "Multi-asset coverage",
    text: "Stocks, ETFs, crypto, FX and commodities — live in one terminal.",
  },
  {
    icon: Zap,
    title: "Execution in milliseconds",
    text: "Real-time pricing with sub-second refresh across every market.",
  },
  {
    icon: ShieldCheck,
    title: "Institutional-grade security",
    text: "Your capital and data protected with bank-level encryption.",
  },
];

const STATS = [
  { value: "120+", label: "Global markets" },
  { value: "$0", label: "Commission on stocks" },
  { value: "24/5", label: "Extended-hours trading" },
];

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.4 3.62v3h3.87c2.27-2.09 3.58-5.17 3.58-8.81Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.87-3a7.19 7.19 0 0 1-10.7-3.77H1.37v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.37 14.32a7.2 7.2 0 0 1 0-4.63v-3.1H1.37a12 12 0 0 0 0 10.82l4-3.09Z" />
      <path fill="#EA4335" d="M12 4.77c1.77 0 3.35.61 4.6 1.8l3.44-3.43A11.98 11.98 0 0 0 1.37 6.58l4 3.1A7.19 7.19 0 0 1 12 4.76Z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.05 12.54c-.03-2.89 2.36-4.27 2.47-4.34-1.35-1.97-3.44-2.24-4.18-2.27-1.78-.18-3.47 1.05-4.37 1.05-.9 0-2.29-1.02-3.77-1-1.94.03-3.72 1.13-4.72 2.86-2.01 3.49-.51 8.66 1.45 11.5.96 1.39 2.1 2.95 3.6 2.89 1.45-.06 2-.93 3.75-.93s2.24.93 3.77.9c1.56-.03 2.55-1.41 3.5-2.81 1.1-1.61 1.55-3.17 1.58-3.25-.04-.02-3.03-1.16-3.08-4.6ZM14.16 4.06c.8-.96 1.33-2.3 1.18-3.64-1.14.05-2.53.76-3.35 1.72-.74.85-1.39 2.22-1.21 3.53 1.27.1 2.58-.65 3.38-1.61Z" />
    </svg>
  );
}

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, delay: 0.08 * i, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setLoading(true);
    // Demo build: simulated auth round-trip, then enter the dashboard.
    setTimeout(() => {
      signIn();
      setLoading(false);
      setAuthed(true);
    }, 1400);
  };

  if (authed) {
    return (
      <Suspense fallback={<div className="flex min-h-dvh items-center justify-center text-sm text-muted">Loading workspace…</div>}>
        <DashboardShell />
      </Suspense>
    );
  }

  return (
    <LivePricesProvider>
    <main className="relative flex min-h-dvh flex-col overflow-hidden">
      <AuroraBackground />

      {/* top ticker */}
      <div className="relative z-10">
        <TickerStrip />
      </div>

      <div className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-6 py-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
        {/* ------- left: pitch ------- */}
        <section>
          <motion.div variants={fadeUp} initial="hidden" animate="show" custom={0}>
            <BrandWordmark />
          </motion.div>

          <motion.h1
            variants={fadeUp}
            initial="hidden"
            animate="show"
            custom={1}
            className="mt-8 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl"
          >
            Trade every market.
            <br />
            <span className="text-gradient">One terminal.</span>
          </motion.h1>

          <motion.p
            variants={fadeUp}
            initial="hidden"
            animate="show"
            custom={2}
            className="mt-5 max-w-md text-[15px] leading-relaxed text-muted"
          >
            AxionTrade brings stocks, ETFs, crypto, FX and commodities into a single
            professional workspace — with the speed and precision serious traders expect.
          </motion.p>

          <div className="mt-9 space-y-5">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.title}
                variants={fadeUp}
                initial="hidden"
                animate="show"
                custom={3 + i}
                className="flex items-start gap-3.5"
              >
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface/70">
                  <f.icon className="h-4.5 w-4.5 text-brand-2" size={18} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">{f.title}</p>
                  <p className="text-[13px] text-muted">{f.text}</p>
                </div>
              </motion.div>
            ))}
          </div>

          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="show"
            custom={6}
            className="mt-10 flex divide-x divide-border"
          >
            {STATS.map((s) => (
              <div key={s.label} className="pr-8 pl-8 first:pl-0 last:pr-0">
                <p className="text-xl font-semibold tracking-tight text-foreground">{s.value}</p>
                <p className="mt-0.5 text-xs text-muted">{s.label}</p>
              </div>
            ))}
          </motion.div>
        </section>

        {/* ------- right: login card ------- */}
        <motion.section
          initial={{ opacity: 0, y: 26, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          className="glass w-full rounded-2xl p-7 sm:p-8"
        >
          <div className="flex items-center gap-3">
            <BrandMark size={30} />
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Welcome back</h2>
              <p className="text-[13px] text-muted">Sign in to your AxionTrade account</p>
            </div>
          </div>

          <form onSubmit={onSubmit} className="mt-7 space-y-4">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-[13px] font-medium text-foreground">
                Email
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-dark"
                />
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="password" className="block text-[13px] font-medium text-foreground">
                  Password
                </label>
                <a href="#" className="text-[13px] text-brand hover:underline">
                  Forgot password?
                </a>
              </div>
              <div className="relative">
                <Lock className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  id="password"
                  type={showPass ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-dark pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-muted transition-colors hover:text-foreground"
                  aria-label={showPass ? "Hide password" : "Show password"}
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muted select-none">
              <input
                type="checkbox"
                defaultChecked
                className="h-3.5 w-3.5 rounded border-border bg-surface accent-[#2e90fa]"
              />
              Keep me signed in on this device
            </label>

            <GlassButton type="submit" loading={loading}>
              {loading ? null : (
                <>
                  Sign in
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </GlassButton>

            {notice && (
              <motion.p
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-lg border border-gain/20 bg-gain/10 px-3 py-2 text-center text-[13px] text-gain"
              >
                {notice}
              </motion.p>
            )}

            <div className="flex items-center gap-3 pt-1">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted">or continue with</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <GlassButton type="button" variant="ghost" onClick={() => setNotice("Google SSO lands with the dashboard.")}>
                <GoogleIcon />
                Google
              </GlassButton>
              <GlassButton type="button" variant="ghost" onClick={() => setNotice("Apple SSO lands with the dashboard.")}>
                <AppleIcon />
                Apple
              </GlassButton>
            </div>

            <p className="pt-1 text-center text-[13px] text-muted">
              New to AxionTrade?{" "}
              <a href="#" className="font-medium text-brand hover:underline">
                Create an account
              </a>
            </p>
          </form>
        </motion.section>
      </div>

      <footer className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-6 py-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <Globe className="h-3.5 w-3.5" /> Available in 180+ countries
        </span>
        <span>
          © {new Date().getFullYear()} AxionTrade · Demo build · Not investment advice
        </span>
      </footer>
    </main>
    </LivePricesProvider>
  );
}
