"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, LogOut, Sparkles } from "lucide-react";

import { BrandMark, BrandWordmark } from "@/components/brand";
import { usePortfolioValue } from "@/components/app-header";
import { useLivePrices } from "@/components/live-prices";
import { NAV_ITEMS, isActive } from "@/components/nav-items";
import { useAccount } from "@/lib/account-store";
import { useAiSession } from "@/lib/ai-session";
import { signOut } from "@/lib/demo-auth";
import { INSTRUMENTS, formatPrice } from "@/lib/market-data";

const fmtUsd = (v: number, frac = 2) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: frac, maximumFractionDigits: frac })}`;

/**
 * Desktop navigation rail. The bottom bar is mobile-only (`lg:hidden`), so this
 * is the primary wayfinding surface from `lg` upward. It renders the same
 * NAV_ITEMS list as the hamburger drawer and the bottom bar.
 */
export function AppNav() {
  const pathname = usePathname();
  const { session } = useAiSession();
  const { account } = useAccount();
  const totals = usePortfolioValue();

  return (
    <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col border-r border-border bg-surface/40 backdrop-blur lg:flex">
      <Link href="/" className="flex h-16 items-center gap-2 border-b border-border px-5">
        <BrandMark size={26} />
        <BrandWordmark />
      </Link>

      <nav className="px-3 py-4" aria-label="Primary">
        {NAV_ITEMS.map(({ key, href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={key}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                active ? "bg-brand/12 text-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              <Icon className={`h-4.5 w-4.5 ${active ? "text-brand" : ""}`} />
              {label}
              {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand" />}
            </Link>
          );
        })}
      </nav>

      {/* AxAI status — an indicator, not a second route into /trade */}
      <div className="px-3">
        <Link
          href="/trade"
          className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-colors ${
            session?.phase === "running"
              ? "border-gain/30 bg-gain/8 hover:border-gain/50"
              : "border-border bg-background/40 hover:border-brand/40"
          }`}
        >
          <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-brand/30 bg-brand/10">
            <Bot className="h-3.5 w-3.5 text-brand" />
            {session?.phase === "running" && (
              <span className="absolute -top-1 -right-1 flex h-2 w-2">
                <span className="absolute h-full w-full animate-ping rounded-full bg-gain opacity-70" />
                <span className="relative h-2 w-2 rounded-full bg-gain" />
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] font-semibold leading-tight">
              {session?.phase === "running" ? "AxAI trading" : "AxAI engine"}
            </span>
            <span className="block truncate font-mono text-[10.5px] leading-tight text-muted tabular-nums">
              {session
                ? session.phase === "running"
                  ? `${fmtUsd(session.equity, 0)} · ${session.trades.length} fills`
                  : `settled ${fmtUsd(session.equity, 0)}`
                : "standby"}
            </span>
          </span>
        </Link>
      </div>

      <div className="mt-auto space-y-3 border-t border-border p-4">
        <div className="rounded-xl border border-border bg-background/40 p-3">
          <p className="text-[11px] text-muted">Portfolio value</p>
          <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
            {totals ? fmtUsd(totals.total) : "—"}
          </p>
          <div className="mt-2 space-y-0.5 text-[11px] text-muted">
            <div className="flex justify-between">
              <span>Free funds</span>
              <span className="font-mono tabular-nums">{totals ? fmtUsd(totals.cash) : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span>Invested</span>
              <span className="font-mono tabular-nums">{totals ? fmtUsd(totals.holdings) : "—"}</span>
            </div>
            {totals && totals.aiEquity > 0 && (
              <div className="flex justify-between">
                <span className="text-brand">With AxAI</span>
                <span className="font-mono tabular-nums text-brand">{fmtUsd(totals.aiEquity)}</span>
              </div>
            )}
          </div>
        </div>

        <Link
          href="/markets"
          className="flex items-center justify-center gap-2 rounded-xl border border-brand/30 bg-brand/8 py-2 text-[12.5px] font-semibold text-brand transition-colors hover:bg-brand/14"
        >
          <Sparkles className="h-3.5 w-3.5" /> Browse markets
        </Link>

        <button
          onClick={() => {
            signOut();
            window.location.href = "/";
          }}
          className="inline-flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:text-foreground"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </aside>
  );
}

/** Wraps page content so it sits beside the desktop rail. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh w-full">
      <AppNav />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Small live ticker used in the desktop top area of the trade page. */
export function MiniTicker({ symbols }: { symbols: string[] }) {
  const { quotes } = useLivePrices();
  return (
    <div className="hidden shrink-0 items-center gap-4 2xl:flex">
      {symbols.map((s) => {
        const q = quotes.get(s);
        const inst = INSTRUMENTS.find((i) => i.symbol === s);
        if (!q || !inst) return null;
        const up = q.changePct >= 0;
        return (
          <span key={s} className="inline-flex items-center gap-1.5 text-[12px]">
            <span className="font-semibold">{s}</span>
            <span className="font-mono tabular-nums text-muted">{formatPrice(q.price, inst.kind)}</span>
            <span className={`font-mono tabular-nums ${up ? "text-gain" : "text-loss"}`}>
              {up ? "+" : ""}
              {q.changePct.toFixed(2)}%
            </span>
          </span>
        );
      })}
    </div>
  );
}
