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

import { BrandWordmark } from "@/components/brand";
import { HoldingsTable } from "@/components/holdings-table";
import { InstrumentLogo } from "@/components/instrument-logo";
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

function useTotals() {
  return useMemo(() => {
    let invested = 0;
    let dayChange = 0;
    for (const i of INSTRUMENTS) {
      if (i.kind === "forex") continue;
      const weight = i.kind === "crypto" ? 0.06 : 0.035;
      invested += i.price * weight * 10;
      dayChange += i.price * weight * 10 * (i.changePct / 100);
    }
    const cash = 12840.55;
    return { invested, cash, dayChange, total: invested + cash };
  }, []);
}

export function DashboardShell() {
  const totals = useTotals();
  const [navOpen, setNavOpen] = useState(false);
  const up = totals.dayChange >= 0;

  const fmt = (v: number, frac = 2) =>
    `$${v.toLocaleString("en-US", { maximumFractionDigits: frac, minimumFractionDigits: frac })}`;

  return (
    <div className="flex min-h-dvh">
      {/* ---------- sidebar ---------- */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-border bg-surface/80 backdrop-blur-md transition-transform lg:static lg:translate-x-0 ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center justify-between px-5">
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
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
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
          <a href="#" onClick={(e) => e.preventDefault()} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground">
            <Settings className="h-4.5 w-4.5" size={18} />
            Settings
          </a>
          <a href="#" onClick={(e) => e.preventDefault()} className="mt-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground">
            <CircleUser className="h-4.5 w-4.5" size={18} />
            Account
          </a>
        </div>
      </aside>

      {navOpen && <div className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden" onClick={() => setNavOpen(false)} />}

      {/* ---------- main ---------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* topbar */}
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:px-6">
          <button onClick={() => setNavOpen(true)} className="text-muted hover:text-foreground lg:hidden" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>

          <div className="relative hidden max-w-md flex-1 sm:block">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              placeholder="Search markets (⌘K)…"
              className="input-dark pl-9"
              aria-label="Search markets"
            />
          </div>

          <div className="flex-1 sm:hidden" />

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

        {/* content */}
        <main className="mx-auto w-full max-w-7xl flex-1 space-y-5 px-4 py-6 sm:px-6">
          {/* balance cards */}
          <section className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-border bg-surface/60 p-5">
              <p className="text-[13px] text-muted">Total value</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">{fmt(totals.total)}</p>
              <p className={`mt-1 text-[13px] font-medium ${up ? "text-gain" : "text-loss"}`}>
                {up ? "+" : "−"}
                {fmt(Math.abs(totals.dayChange))} ({formatPct((totals.dayChange / totals.total) * 100)}) today
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-surface/60 p-5">
              <p className="text-[13px] text-muted">Invested</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">{fmt(totals.invested)}</p>
              <p className="mt-1 text-[13px] text-muted">Across 22 instruments</p>
            </div>
            <div className="rounded-2xl border border-border bg-surface/60 p-5">
              <p className="text-[13px] text-muted">Free funds</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">{fmt(totals.cash)}</p>
              <div className="mt-3 flex gap-2">
                <button className="flex-1 rounded-lg bg-gradient-to-r from-brand to-gain py-1.5 text-xs font-semibold text-[#071018] transition-transform active:scale-[0.98]">
                  Deposit
                </button>
                <button className="flex-1 rounded-lg border border-border py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-surface-2">
                  Withdraw
                </button>
              </div>
              </div>
          </section>

          <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
            <div className="space-y-5">
              <PortfolioChart totalValue={totals.total} />
              <HoldingsTable />
            </div>
            <div className="space-y-5">
              <OrderTicket />
              <Watchlist />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
