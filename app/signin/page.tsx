"use client";

/**
 * Sign-in at /signin — two jobs on one screen, chosen by a tab.
 *
 * **Create account** asks for a name, a username, an email, a date of birth and a
 * city. There is no password field and no third-party SSO: the server mints the
 * password code, the screen shows it once with instructions to save it, and the same
 * code is kept in the directory so the dashboard can hand it back if it is lost.
 *
 * **Log in** takes the username and that code and opens the workspace.
 *
 * The generated code is the only credential the user holds, so the screen that shows
 * it is deliberately loud: large, monospaced, copyable, and blocked behind an explicit
 * "I've saved it" step before sign-in.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  AtSign,
  CalendarDays,
  Check,
  Copy,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Lock,
  Mail,
  MapPin,
  ShieldCheck,
  TrendingUp,
  User,
  Zap,
} from "lucide-react";

import { AuroraBackground } from "@/components/aurora-background";
import { BrandMark, BrandWordmark } from "@/components/brand";
import { DashboardShell } from "@/components/dashboard-shell";
import { GlassButton } from "@/components/glass-button";
import { LivePricesProvider } from "@/components/live-prices";
import { TickerStrip } from "@/components/ticker-strip";
import { isAuthed, signIn } from "@/lib/demo-auth";
import { AppProviders } from "@/lib/providers";
import { saveUser } from "@/lib/user-auth";

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

type Mode = "create" | "login";

/** What the create form submits. */
const BLANK_FORM = {
  fullName: "",
  username: "",
  email: "",
  dateOfBirth: "",
  city: "",
};
type FormFields = typeof BLANK_FORM;

/** The code the server issued, held only while the success screen is shown. */
interface Issued {
  username: string;
  fullName: string;
  password: string;
}

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, delay: 0.08 * i, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

/** A labelled input with a leading icon, shared by both forms. */
function Field({
  id,
  label,
  icon: Icon,
  children,
}: {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-foreground">
        {label}
      </label>
      <div className="relative">
        <Icon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
        {children}
      </div>
    </div>
  );
}

export default function SignInPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("create");
  const [authed, setAuthed] = useState(false);
  const [checked, setChecked] = useState(false);

  // create-account state
  const [form, setForm] = useState<FormFields>(BLANK_FORM);
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [copied, setCopied] = useState(false);

  // login state
  const [loginName, setLoginName] = useState("");
  const [loginCode, setLoginCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<string | null>(null);

  /**
   * An existing session must win. Without this, landing on `/signin` while signed
   * in shows the form again and strands you outside the workspace.
   */
  useEffect(() => {
    if (isAuthed()) setAuthed(true);
    setChecked(true);
  }, []);

  const setField = (key: keyof FormFields, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setErrorField(null);
    if (next === "login" && issued) setLoginName(issued.username);
  };

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setErrorField(null);
    setIssuing(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        field?: string;
        username?: string;
        fullName?: string;
        password?: string;
      };
      if (!response.ok || !data.password) {
        setError(data.error ?? "The account could not be created right now.");
        setErrorField(data.field ?? null);
        return;
      }
      setIssued({
        username: data.username ?? form.username,
        fullName: data.fullName ?? form.fullName,
        password: data.password,
      });
      setLoginName(data.username ?? form.username);
      setForm(BLANK_FORM);
      setCopied(false);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIssuing(false);
    }
  };

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setErrorField(null);
    setLoggingIn(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: loginName, password: loginCode }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        user?: { username: string; fullName: string; email: string; dateOfBirth: string; city: string };
      };
      if (!response.ok || !data.user) {
        setError(data.error ?? "Wrong username or password code.");
        return;
      }
      // Record the profile before the gate reads the auth flag, so the workspace
      // never renders a frame with the wrong name.
      saveUser(data.user);
      signIn();
      setAuthed(true);
      router.replace("/");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoggingIn(false);
    }
  };

  const copyCode = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard may be blocked; the code is on screen and selectable regardless
    }
  };

  if (!checked) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted">Loading workspace…</div>
    );
  }

  if (authed) {
    return (
      <AppProviders>
        <DashboardShell />
      </AppProviders>
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
              <Link href="/home" className="inline-block transition-opacity hover:opacity-85">
                <BrandWordmark />
              </Link>
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
              Axion brings stocks, ETFs, crypto, FX and commodities into a single
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

          {/* ------- right: auth card ------- */}
          <motion.section
            initial={{ opacity: 0, y: 26, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="glass w-full rounded-2xl p-7 sm:p-8"
          >
            <div className="flex items-center gap-3">
              <BrandMark size={30} />
              <div>
                <h2 className="text-lg font-semibold tracking-tight">
                  {issued ? "Save your password code" : mode === "create" ? "Create your account" : "Welcome back"}
                </h2>
                <p className="text-[13px] text-muted">
                  {issued
                    ? "This is the only time it is shown"
                    : mode === "create"
                      ? "Open an Axion account in under a minute"
                      : "Log in with your Axion username and code"}
                </p>
              </div>
            </div>

            {/* ---------------- code issued ---------------- */}
            {issued ? (
              <div className="mt-7 space-y-5">
                <p className="text-[13px] leading-relaxed text-muted">
                  Welcome, <span className="font-semibold text-foreground">{issued.fullName}</span>.
                  Axion generated this password code for{" "}
                  <span className="font-semibold text-foreground">@{issued.username}</span>.
                </p>

                <div className="rounded-xl border border-brand/40 bg-brand/5 p-4">
                  <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">
                    Your password code
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate font-mono text-xl font-semibold tracking-wider text-foreground">
                      {issued.password}
                    </code>
                    <button
                      type="button"
                      onClick={() => void copyCode()}
                      aria-label="Copy password code"
                      className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium text-muted transition-colors hover:text-foreground"
                    >
                      {copied ? <Check className="h-4 w-4 text-gain" /> : <Copy className="h-4 w-4" />}
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-loss/30 bg-loss/5 p-3.5">
                  <p className="flex items-center gap-2 text-[13px] font-semibold text-loss">
                    <KeyRound className="h-4 w-4" /> Save it now — you will not see it again
                  </p>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
                    Write the code down somewhere safe and take a screenshot as a backup.
                    If you lose it, you can ask Axion support to recover it from your profile.
                  </p>
                </div>

                <GlassButton
                  type="button"
                  onClick={() => {
                    setIssued(null);
                    switchMode("login");
                  }}
                >
                  I&apos;ve saved it — continue to log in
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </GlassButton>
              </div>
            ) : (
              <>
                {/* ---------------- tabs ---------------- */}
                <div className="mt-6 grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface/60 p-1">
                  {(["create", "login"] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => switchMode(tab)}
                      className={`rounded-lg py-2 text-[13px] font-semibold transition-colors ${
                        mode === tab
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted hover:text-foreground"
                      }`}
                    >
                      {tab === "create" ? "Create account" : "Log in"}
                    </button>
                  ))}
                </div>

                {error ? (
                  <motion.p
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4 rounded-lg border border-loss/25 bg-loss/10 px-3 py-2 text-center text-[13px] text-loss"
                  >
                    {error}
                  </motion.p>
                ) : null}

                {/* ---------------- create ---------------- */}
                {mode === "create" ? (
                  <form onSubmit={onCreate} className="mt-5 space-y-4">
                    <Field id="fullName" label="Full name" icon={User}>
                      <input
                        id="fullName"
                        autoComplete="name"
                        placeholder="Ada Lovelace"
                        value={form.fullName}
                        onChange={(e) => setField("fullName", e.target.value)}
                        className={`input-dark ${
                          errorField === "fullName" ? "border-loss/60" : ""
                        }`}
                      />
                    </Field>

                    <Field id="username" label="Username" icon={AtSign}>
                      <input
                        id="username"
                        autoComplete="username"
                        placeholder="ada_l"
                        value={form.username}
                        onChange={(e) => setField("username", e.target.value)}
                        className={`input-dark ${
                          errorField === "username" ? "border-loss/60" : ""
                        }`}
                      />
                    </Field>

                    <Field id="email" label="Email" icon={Mail}>
                      <input
                        id="email"
                        type="email"
                        autoComplete="email"
                        placeholder="you@example.com"
                        value={form.email}
                        onChange={(e) => setField("email", e.target.value)}
                        className={`input-dark ${errorField === "email" ? "border-loss/60" : ""}`}
                      />
                    </Field>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field id="dateOfBirth" label="Date of birth" icon={CalendarDays}>
                        <input
                          id="dateOfBirth"
                          type="date"
                          max={new Date().toISOString().slice(0, 10)}
                          value={form.dateOfBirth}
                          onChange={(e) => setField("dateOfBirth", e.target.value)}
                          className={`input-dark ${errorField === "dateOfBirth" ? "border-loss/60" : ""}`}
                        />
                      </Field>

                      <Field id="city" label="City of residence" icon={MapPin}>
                        <input
                          id="city"
                          autoComplete="address-level2"
                          placeholder="Lagos"
                          value={form.city}
                          onChange={(e) => setField("city", e.target.value)}
                          className={`input-dark ${errorField === "city" ? "border-loss/60" : ""}`}
                        />
                      </Field>
                    </div>

                    <p className="text-[12px] leading-relaxed text-muted">
                      No password to choose — we generate a secure password code for you on
                      the next step.
                    </p>

                    <GlassButton type="submit" loading={issuing}>
                      {issuing ? null : (
                        <>
                          Create account
                          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </>
                      )}
                    </GlassButton>
                  </form>
                ) : (
                  /* ---------------- login ---------------- */
                  <form onSubmit={onLogin} className="mt-5 space-y-4">
                    <Field id="login-username" label="Username" icon={AtSign}>
                      <input
                        id="login-username"
                        autoComplete="username"
                        placeholder="ada_l"
                        value={loginName}
                        onChange={(e) => setLoginName(e.target.value)}
                        className="input-dark"
                      />
                    </Field>

                    <div>
                      <label
                        htmlFor="login-code"
                        className="mb-1.5 block text-[13px] font-medium text-foreground"
                      >
                        Password code
                      </label>
                      <div className="relative">
                        <Lock className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
                        <input
                          id="login-code"
                          type={showCode ? "text" : "password"}
                          autoComplete="current-password"
                          placeholder="AXN-••••-••••"
                          value={loginCode}
                          onChange={(e) => setLoginCode(e.target.value)}
                          className="input-dark pr-11"
                        />
                        <button
                          type="button"
                          onClick={() => setShowCode((v) => !v)}
                          className="absolute top-1/2 right-3 -translate-y-1/2 text-muted transition-colors hover:text-foreground"
                          aria-label={showCode ? "Hide password code" : "Show password code"}
                        >
                          {showCode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      <p className="mt-1.5 text-[12px] text-muted">
                        Lost your code?{" "}
                        <Link href="/community" className="text-brand hover:underline">
                          Ask the community
                        </Link>{" "}
                        or contact support to recover it.
                      </p>
                    </div>

                    <GlassButton type="submit" loading={loggingIn}>
                      {loggingIn ? null : (
                        <>
                          Log in
                          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </>
                      )}
                    </GlassButton>
                  </form>
                )}
              </>
            )}
          </motion.section>
        </div>

        <footer className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-6 py-4 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5" /> Available in 180+ countries
          </span>
          <Link href="/home" className="text-brand transition-colors hover:underline">
            Product overview
          </Link>
          <span>© {new Date().getFullYear()} Axion · Not investment advice</span>
        </footer>
      </main>
    </LivePricesProvider>
  );
}
