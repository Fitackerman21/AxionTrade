"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bot, LogOut, RotateCcw, Wallet } from "lucide-react";

import { BottomNav } from "@/components/bottom-nav";
import { BrandMark } from "@/components/brand";
import { useRequireAuth } from "@/lib/demo-auth";
import { useAccount } from "@/lib/account-store";
import { useAiSession } from "@/lib/ai-session";
import { signOut } from "@/lib/demo-auth";
import { AppProviders } from "@/lib/providers";

const fmtUsd = (v: number, frac = 2) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: frac, maximumFractionDigits: frac })}`;

function AccountInner() {
  const authed = useRequireAuth();
  const { account, resetAccount } = useAccount();
  const { session } = useAiSession();
  const [confirming, setConfirming] = useState(false);

  if (authed === null) {
    return <div className="flex min-h-dvh items-center justify-center text-sm text-muted">Loading…</div>;
  }

  if (authed === false) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <BrandMark size={40} />
        <h1 className="text-xl font-semibold">Sign in to view your account</h1>
        <Link
          href="/"
          className="rounded-xl bg-gradient-to-r from-brand to-gain px-5 py-2.5 text-sm font-semibold text-[#071018]"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  const aiPnl = session ? session.equity - session.principal : 0;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md">
        <Link
          href="/"
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted transition-colors hover:text-foreground"
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="h-4.5 w-4.5" />
        </Link>
        <span className="text-sm font-semibold tracking-tight">Account</span>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 pt-4 pb-28 sm:px-6">
        <section className="rounded-2xl border border-border bg-surface/60 p-5">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-background/40">
              <Wallet className="h-5 w-5 text-brand" />
            </span>
            <div>
              <p className="text-[13px] text-muted">Fitackerman21 · Demo workspace</p>
              <p className="text-2xl font-semibold tracking-tight">{fmtUsd(account.cash)}</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
            <div className="rounded-xl border border-border bg-background/40 p-3">
              <p className="text-[11px] text-muted">Total deposited</p>
              <p className="mt-0.5 font-mono font-medium tabular-nums">{fmtUsd(account.deposits)}</p>
            </div>
            <div className="rounded-xl border border-border bg-background/40 p-3">
              <p className="text-[11px] text-muted">Withdrawn</p>
              <p className="mt-0.5 font-mono font-medium tabular-nums">{fmtUsd(account.withdrawn)}</p>
            </div>
            <div className="rounded-xl border border-border bg-background/40 p-3">
              <p className="text-[11px] text-muted">With AxAI</p>
              <p className="mt-0.5 font-mono font-medium tabular-nums">
                {fmtUsd(account.aiPrincipal)}
                {session && (
                  <span className={`ml-1.5 text-xs ${aiPnl >= 0 ? "text-gain" : "text-loss"}`}>
                    ({aiPnl >= 0 ? "+" : "−"}{fmtUsd(Math.abs(aiPnl))})
                  </span>
                )}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-background/40 p-3">
              <p className="text-[11px] text-muted">Realized P/L</p>
              <p className={`mt-0.5 font-mono font-medium tabular-nums ${account.realizedPl >= 0 ? "text-gain" : "text-loss"}`}>
                {account.realizedPl >= 0 ? "+" : "−"}{fmtUsd(Math.abs(account.realizedPl))}
              </p>
            </div>
          </div>

          <Link
            href="/ai"
            className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-brand/40 bg-brand/10 py-2.5 text-sm font-semibold text-brand transition-colors hover:bg-brand/20"
          >
            <Bot className="h-4 w-4" />
            Manage AxAI allocation
          </Link>
        </section>

        <section className="rounded-2xl border border-border bg-surface/60 p-5">
          <h2 className="text-sm font-semibold tracking-tight">Demo controls</h2>
          <p className="mt-1 text-[13px] text-muted">
            Reset restores the starting cash and seed portfolio. Your AI engine history is cleared too.
          </p>
          {confirming ? (
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => {
                  resetAccount();
                  setConfirming(false);
                }}
                className="flex-1 rounded-xl border border-loss/40 bg-loss/10 py-2.5 text-sm font-semibold text-loss"
              >
                Yes, reset everything
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="flex-1 rounded-xl border border-border py-2.5 text-sm font-semibold"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-muted transition-colors hover:text-foreground"
            >
              <RotateCcw className="h-4 w-4" /> Reset demo account
            </button>
          )}

          <button
            onClick={() => {
              signOut();
              window.location.href = "/";
            }}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-muted transition-colors hover:text-foreground"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </section>
      </main>

      <BottomNav active="account" />
    </div>
  );
}

export default function AccountPage() {
  return (
    <AppProviders>
      <AccountInner />
    </AppProviders>
  );
}
