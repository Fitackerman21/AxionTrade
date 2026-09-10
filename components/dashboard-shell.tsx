"use client";

import { useMemo, useState } from "react";
import {
  Bell,
  ChartPie,
  ChartLine,
  CircleUser,
  Compass,
  LayoutGrid,
  ListOrdered,
  Menu,
  Newspaper,
  Search,
  Settings,
  Wallet,
  X,
} from "lucide-react";

import { BottomNav } from "@/components/bottom-nav";
import { BrandWordmark } from "@/components/brand";
import { HoldingsTable } from "@/components/holdings-table";
import { LiveDot } from "@/components/live-price";
import { LivePricesProvider, useLivePrices } from "@/components/live-prices";
import { MoversStrip } from "@/components/movers-strip";
import { OrderTicket } from "@/components/order-ticket";
import { PortfolioChart } from "@/components/portfolio-chart";
import { Watchlist } from "@/components/watchlist";
import { formatPct, INSTRUMENTS } from "@/lib/market-data";

const NAV = [
  { icon: LayoutGrid, label: "Dashboard", active: true },
  { icon: ChartLine, label: "Portfolio" },
  { icon: ListOrdered, label: "Orders" },
  { icon: ChartPie, label: "Pies" },
  { icon: Compass, label: "Discover" },
  { icon: Newspaper, label: "News" },
  { icon: Wallet, label: "Wallet" },
];

function useLiveTotals() {
  const { quotes } = useLivePrices();
  return useMemo(() => {
    let invested = 0;
    let dayChange = 0;
    for (const i of INSTRUMENTS) {
      if (i.kind === "forex") continue;
      const q = quotes.get(i.symbol);
      const price = q?.price ?? i.price;
      const changePct = q?.changePct ?? i.changePct;
      const weight = i.kind === "crypto" ? 0.06 : 0.035;
      invested += price * weight * 10;
      dayChange += price * weight * 10 * (changePct / 100);
    }
    const cash = 12840.55;
    return { invested, cash, dayChange, total: invested + cash };
  }, [quotes]);
}

function DashboardInner() {
  const totals = useLiveTotals();
  const { connected } = useLivePrices();
  const [navOpen, setNavOpen] = useState(false);
  const [tradeOpen, setTradeOpen] = useState(false);
  const up = totals.dayChange >= 0;

  const fmt = (v: number, frac = 2) =>
    `$${v.toLocaleString("en-US", { maximumFractionDigits: frac, minimumFractionDigits: frac })}`;

  return (
    <div className="flex min-h-dvh">
      {/* ---------- sidebar (desktop) ---------- */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-border bg-surface/80 backdrop-blur-md transition-transform lg:static lg:translate-x-0 ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-14 items-center justify-between px-5">
          <BrandWordmark compact />
          <button onClick={() => setNavOpen(false)} className="text-muted hover:text-foreground lg:hidden" aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="mt-2 flex-1 space-y-1 px-3">
          {NAV.map((item) => (
            <a
              key={item.label}
              href="#"
              onClick={(e) => e.preventDefault()}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                item.active
                  ? "bg-brand/12 text-foreground ring-1 ring-brand/25"
                  : "text-muted hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              <item.icon className="h-4.5 w-4.5" size={18} />
              {item.label}
            </a>
          ))}
        </nav>

        <div className="border-t border-border p-3">
          <a href="#" onClick={(e) => e.preventDefault()} className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground">
            <Settings className="h-4.5 w-4.5" size={18} />
            Settings
          </a>
          <a href="#" onClick={(e) => e.preventDefault()} className="mt-1 flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground">
            <CircleUser className="h-4.5 w-4.5" size={18} />
            Account
          </a>
        </div>
      </aside>

      {navOpen && <div className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden" onClick={() => setNavOpen(false)} />}

      {/* ---------- main ---------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* topbar */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2.5 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:px-6">
          <button onClick={() => setNavOpen(true)} className="text-muted hover:text-foreground lg:hidden" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>

          <div className="relative hidden max-w-md flex-1 sm:block">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
            <input placeholder="Search markets (⌘K)…" className="input-dark pl-9" aria-label="Search markets" />
          </div>

          <div className="flex-1 sm:hidden" />

          <span className="inline-flex items-center gap-1.5 rounded-full border border-gain/25 bg-gain/8 px-2.5 py-1 text-[11px] font-semibold text-gain">
            <LiveDot connected={connected} />
            LIVE
          </span>

          <div className="ml-auto flex items-center gap-2">
            <button className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted transition-colors hover:text-foreground" aria-label="Notifications">
              <Bell className="h-4 w-4" />
              <span className="absolute top-2 right-2.5 h-1.5 w-1.5 rounded-full bg-gain" />
            </button>
            <div className="flex h-9 items-center gap-2 rounded-xl border border-border px-2.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-brand to-gain text-[11px] font-bold text-[#071018]">
                FT
              </span>
              <span className="hidden text-sm font-medium md:block">Fitackerman21</span>
            </div>
          </div>
        </header>

        {/* content — vertical scroll on mobile, bottom padding for the nav bar */}
        <main className="mx-auto w-full max-w-7xl flex-1 space-y-5 px-4 pt-5 pb-28 lg:pb-8 sm:px-6">
          {/* balance hero */}
          <section className="rounded-2xl border border-border bg-surface/60 p-5">
            <p className="text-[13px] text-muted">Total value</p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-3xl font-semibold tracking-tight sm:text-4xl">{fmt(totals.total)}</span>
              <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 font-mono text-sm font-semibold ${up ? "bg-gain/12 text-gain" : "bg-loss/12 text-loss"}`}>
                {up ? "▲" : "▼"} {formatPct((totals.dayChange / totals.total) * 100)}
              </span>
            </div>
            <p className={`mt-1 text-[13px] font-medium ${up ? "text-gain" : "text-loss"}`}>
              {up ? "+" : "−"}
              {fmt(Math.abs(totals.dayChange))} today
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border bg-background/40 p-3">
                <p className="text-xs text-muted">Invested</p>
                <p className="mt-0.5 text-lg font-semibold tracking-tight">{fmt(totals.invested)}</p>
              </div>
              <div className="rounded-xl border border-border bg-background/40 p-3">
                <p className="text-xs text-muted">Free funds</p>
                <p className="mt-0.5 text-lg font-semibold tracking-tight">{fmt(totals.cash)}</p>
              </div>
            </div>

            <div className="mt-4 flex gap-2.5">
              <button className="flex-1 rounded-xl bg-gradient-to-r from-brand to-gain py-2.5 text-sm font-semibold text-[#071018] transition-transform active:scale-[0.98]">
                Deposit
              </button>
              <button className="flex-1 rounded-xl border border-border py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-surface-2">
                Withdraw
              </button>
            </div>
          </section>

          <MoversStrip />

          <PortfolioChart totalValue={totals.total} />

          {/* holdings + side panels: stacked on mobile, 2-col on xl */}
          <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
            <div className="min-w-0 space-y-5">
              <HoldingsTable />
            </div>
            <div className="space-y-5">
              <Watchlist />
            </div>
          </div>
        </main>
      </div>

      {/* ---------- mobile order sheet ---------- */}
      {tradeOpen && (
        <div className="fixed inset-0 z-50 flex items-end lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={() => setTradeOpen(false)} />
          <div className="relative max-h-[88dvh] w-full overflow-y-auto rounded-t-3xl border-t border-border bg-surface p-1 shadow-[0_-16px_48px_rgba(0,0,0,0.6)]">
            <div className="sticky top-0 z-10 flex justify-center bg-gradient-to-b from-surface via-surface to-transparent pt-2.5 pb-2">
              <span className="h-1.5 w-10 rounded-full bg-border" />
            </div>
            <div className="px-3 pb-4">
              <OrderTicket />
            </div>
          </div>
        </div>
      )}

      {/* desktop order ticket is not shown in main flow; FAB opens sheet on mobile */}
      <BottomNav onTrade={() => setTradeOpen((v) => !v)} />
    </div>
  );
}

export function DashboardShell() {
  return (
    <LivePricesProvider>
      <DashboardInner />
    </LivePricesProvider>
  );
}
