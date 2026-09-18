"use client";

import Link from "next/link";
import { ArrowRightLeft, Bot, ChartLine, Receipt } from "lucide-react";

import { AllocationDonut } from "@/components/allocation-donut";
import { AppHeader } from "@/components/app-header";
import { AppShell, MiniTicker } from "@/components/app-nav";
import { BottomNav } from "@/components/bottom-nav";
import { BrandMark } from "@/components/brand";
import { ContributionPanel, PerformanceLadder, RiskPanel } from "@/components/holdings-analytics";
import { PortfolioInsights } from "@/components/portfolio-insights";
import { PortfolioSummary } from "@/components/portfolio-summary";
import { PositionsTable } from "@/components/positions-table";
import { useRequireAuth } from "@/lib/demo-auth";
import { useAiSession } from "@/lib/ai-session";
import { usePortfolio } from "@/lib/portfolio";
import { AppProviders } from "@/lib/providers";

const TAPE = ["BTC", "AAPL", "NVDA", "XAUUSD", "ETH"];

function HoldingsInner() {
  const authed = useRequireAuth();
  const view = usePortfolio();
  const { session } = useAiSession();

  if (authed === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted">Loading…</div>
    );
  }

  if (authed === false) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <BrandMark size={40} />
        <h1 className="text-xl font-semibold">Sign in to view your holdings</h1>
        <Link
          href="/"
          className="rounded-xl bg-gradient-to-r from-brand to-gain px-5 py-2.5 text-sm font-semibold text-[#071018]"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <AppShell>
      <div className="flex min-h-dvh flex-col">
        <AppHeader
          leading={
            <div className="flex min-w-0 items-center gap-3">
              <div className="min-w-0">
                <h1 className="text-sm leading-tight font-semibold tracking-tight">Holdings</h1>
                <p className="hidden text-[11px] leading-tight text-muted sm:block">
                  Live positions, allocation and book quality
                </p>
              </div>
              <MiniTicker symbols={TAPE} />
            </div>
          }
        />

        {session?.phase === "running" && (
          <div className="border-b border-brand/20 bg-gradient-to-r from-brand/10 via-gain/8 to-brand/10 px-4 py-2">
            <div className="mx-auto flex max-w-[1440px] items-center gap-2 text-[12px]">
              <Bot className="h-3.5 w-3.5 shrink-0 text-gain" />
              <span className="min-w-0 flex-1 truncate text-foreground/90">
                <b>AxAI is building this book right now</b> — positions it opens will appear here, marked
                live.
              </span>
              <Link href="/trade#ai-terminal" className="shrink-0 font-semibold text-brand hover:underline">
                Open engine →
              </Link>
            </div>
          </div>
        )}

        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 pt-4 pb-28 sm:px-6 lg:pb-10">
          {/*
           * The sidebar pairs up beside the book at 2xl only. At 1280–1535 the
           * 248px rail plus a 360px sidebar would leave ~560px for the position
           * row, which cannot hold six figure columns without clipping them.
           * Below that the panels sit under the book on a two-up grid instead.
           */}
          <div className="flex flex-col gap-4 2xl:grid 2xl:grid-cols-[minmax(0,1fr)_360px] 2xl:items-start 2xl:gap-5">
            {/* LEFT — the book */}
            <div className="min-w-0 space-y-4">
              <PortfolioSummary view={view} />
              <PositionsTable view={view} />
            </div>

            {/* RIGHT — allocation and read on the book */}
            <div className="grid min-w-0 gap-4 sm:grid-cols-2 2xl:grid-cols-1">
              <AllocationDonut view={view} />
              <PortfolioInsights view={view} />

              <section className="rounded-2xl border border-border bg-surface/60 p-5">
                <h2 className="text-sm font-semibold tracking-tight">Next steps</h2>
                <div className="mt-3 space-y-2">
                  <Shortcut
                    href="/trade"
                    icon={<ChartLine className="h-4 w-4 text-brand" />}
                    title="Open the trade screen"
                    body="Chart, order entry and the AxAI terminal"
                  />
                  <Shortcut
                    href="/trade#ai-terminal"
                    icon={<Bot className="h-4 w-4 text-gain" />}
                    title="Hand funds to AxAI"
                    body="Let the engine trade the book autonomously"
                  />
                  <Shortcut
                    href="/account"
                    icon={<Receipt className="h-4 w-4 text-muted" />}
                    title="Statements & funding"
                    body="Deposits, withdrawals and settlements"
                  />
                </div>
                <p className="mt-3.5 inline-flex items-center gap-1.5 text-[11px] text-muted">
                  <ArrowRightLeft className="h-3 w-3" />
                  Positions are marked against live provider quotes on every tick.
                </p>
              </section>
            </div>
          </div>

          {/* ---------- analytics: attribution, risk and return ---------- */}
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <ContributionPanel view={view} />
            <RiskPanel view={view} />
          </div>

          <div className="mt-4">
            <PerformanceLadder view={view} />
          </div>
        </main>

        <BottomNav active="holdings" />
      </div>
    </AppShell>
  );
}

function Shortcut({
  href,
  icon,
  title,
  body,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-start gap-3 rounded-xl border border-border bg-background/40 p-3 transition-colors hover:border-brand/40"
    >
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-surface">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-semibold">{title}</span>
        <span className="block text-[11.5px] text-muted">{body}</span>
      </span>
    </Link>
  );
}

export default function HoldingsPage() {
  return (
    <AppProviders>
      <HoldingsInner />
    </AppProviders>
  );
}
