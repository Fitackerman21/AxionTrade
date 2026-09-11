"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  Bell,
  Bot,
  Check,
  ChevronDown,
  CircleX,
  Globe,
  Info,
  ShieldAlert,
  Star,
  Trophy,
  X,
} from "lucide-react";

import { AiPanel } from "@/components/ai-panel";
import { BottomNav } from "@/components/bottom-nav";
import { BrandMark } from "@/components/brand";
import { InstrumentLogo } from "@/components/instrument-logo";
import { LiveDot, LivePrice } from "@/components/live-price";
import { useLivePrices, useLiveQuote } from "@/components/live-prices";
import { OrderTicket } from "@/components/order-ticket";
import { TradeChart, type AiTradeAnnotation } from "@/components/trade-chart";
import { Watchlist } from "@/components/watchlist";
import { formatPct, formatPrice, INSTRUMENTS, type Instrument } from "@/lib/market-data";
import { useAccount } from "@/lib/account-store";
import { useAiSession } from "@/lib/ai-session";
import { useRequireAuth } from "@/lib/demo-auth";
import { AppProviders } from "@/lib/providers";

/* ------------------------------------------------------------------ */
/* Instrument switcher (sheet on mobile, dropdown on desktop)          */
/* ------------------------------------------------------------------ */

const GROUP_ORDER: Instrument["kind"][] = ["stock", "etf", "crypto", "forex", "commodity"];
const GROUP_LABEL: Record<Instrument["kind"], string> = {
  stock: "Stocks",
  etf: "ETFs",
  crypto: "Crypto",
  forex: "Forex",
  commodity: "Commodities",
  index: "Indices",
};

function InstrumentSwitcher({
  current,
  onSelect,
  onClose,
}: {
  current: Instrument;
  onSelect: (inst: Instrument) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-start sm:justify-center sm:pt-16" role="dialog" aria-modal="true" aria-label="Choose instrument">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="relative max-h-[72dvh] w-full overflow-y-auto rounded-t-2xl border border-border bg-surface shadow-2xl sm:max-w-lg sm:rounded-2xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <SearchIcon />
            <span className="text-sm font-semibold">Search markets</span>
          </div>
          <button onClick={onClose} className="text-muted transition-colors hover:text-foreground" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="px-2 py-2">
          {GROUP_ORDER.map((kind) => {
            const list = INSTRUMENTS.filter((i) => i.kind === kind);
            if (list.length === 0) return null;
            return (
              <div key={kind} className="mb-1">
                <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
                  {GROUP_LABEL[kind]}
                </p>
                {list.map((inst) => (
                  <button
                    key={inst.symbol}
                    onClick={() => {
                      onSelect(inst);
                      onClose();
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                      inst.symbol === current.symbol ? "bg-brand/10" : "hover:bg-surface-2"
                    }`}
                  >
                    <InstrumentLogo symbol={inst.symbol} kind={inst.kind} size={26} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">{inst.symbol}</span>
                      <span className="block truncate text-xs text-muted">{inst.name}</span>
                    </span>
                    <span className="font-mono text-xs tabular-nums text-muted">
                      {formatPrice(inst.price, inst.kind)}
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Order sheet (mobile) / centered modal (desktop)                     */
/* ------------------------------------------------------------------ */

function OrderSheet({
  symbol,
  open,
  onClose,
}: {
  symbol: string;
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} />
      <div className="relative max-h-[88dvh] w-full overflow-y-auto rounded-t-3xl border-t border-border bg-surface p-1 shadow-[0_-16px_48px_rgba(0,0,0,0.6)] sm:max-w-md sm:rounded-2xl sm:border sm:p-1">
        <div className="sticky top-0 z-10 flex justify-center bg-gradient-to-b from-surface via-surface to-transparent pt-2.5 pb-2 sm:hidden">
          <span className="h-1.5 w-10 rounded-full bg-border" />
        </div>
        <div className="px-3 pb-4 sm:px-4">
          <OrderTicket key={symbol} defaultSymbol={symbol} onDone={onClose} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Notification bell (milestones, de-risk events, settlements)         */
/* ------------------------------------------------------------------ */

function NotificationBell() {
  const { notifications, dismissNotification } = useAiSession();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted transition-colors hover:text-foreground"
        aria-label="AI engine notifications"
      >
        <Bell className="h-4 w-4" />
        {notifications.length > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gain px-1 text-[9px] font-bold text-[#071018]">
            {notifications.length}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-11 right-0 z-50 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <span className="text-[13px] font-semibold">AxAI activity</span>
              <button onClick={() => setOpen(false)} className="text-muted hover:text-foreground" aria-label="Close">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="no-scrollbar max-h-80 overflow-y-auto">
              {notifications.length === 0 && (
                <p className="px-4 py-6 text-center text-[13px] text-muted">No engine activity yet.</p>
              )}
              <ul className="divide-y divide-border/50">
                {notifications.map((n) => (
                  <li key={n.id} className="flex items-start gap-2.5 px-4 py-3">
                    <span
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                        n.tone === "milestone"
                          ? "border-gain/40 bg-gain/12 text-gain"
                          : n.tone === "derisk"
                            ? "border-[#ff8a5c]/40 bg-[#ff8a5c]/12 text-[#ff8a5c]"
                            : "border-brand/40 bg-brand/12 text-brand"
                      }`}
                    >
                      {n.tone === "milestone" ? <Trophy className="h-3 w-3" /> : n.tone === "derisk" ? <ShieldAlert className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-semibold leading-tight">{n.title}</p>
                      <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{n.body}</p>
                    </div>
                    <button onClick={() => dismissNotification(n.id)} className="text-muted/60 hover:text-foreground" aria-label="Dismiss">
                      <CircleX className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function TradeInner() {
  const authed = useRequireAuth();
  const { connected } = useLivePrices();
  const { session, lastTrade, signal } = useAiSession();
  const { account } = useAccount();
  const [symbol, setSymbol] = useState("BTC");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tab, setTab] = useState<"positions" | "watchlist">("positions");
  const [toast, setToast] = useState<string | null>(null);

  const inst = INSTRUMENTS.find((i) => i.symbol === symbol) ?? INSTRUMENTS[0];
  const q = useLiveQuote(inst.symbol);
  const price = q?.price ?? inst.price;
  const changePct = q?.changePct ?? inst.changePct;
  const up = changePct >= 0;

  const engineRunning = session?.phase === "running";

  // auto-dismiss the signal toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3400);
    return () => clearTimeout(t);
  }, [toast]);

  // Buy/Sell: while the engine runs they queue signals; otherwise manual orders
  const onManual = (dir: "LONG" | "SHORT") => {
    if (engineRunning) {
      signal(inst.symbol, dir);
      setToast(`Signal sent — ${dir} ${inst.symbol} queued for AxAI's next scan`);
    } else {
      setSheetOpen(true);
    }
  };

  // real position in the viewed instrument
  const positionUnits = account.positions.find((p) => p.symbol === symbol)?.qty ?? 0;
  const positionValue = positionUnits * price;
  const avgCost = account.positions.find((p) => p.symbol === symbol)?.avgCost ?? 0;
  const openPnl = positionUnits > 0 ? (price - avgCost) * positionUnits : 0;

  if (authed === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted">Loading…</div>
    );
  }

  if (authed === false) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <BrandMark size={40} />
        <h1 className="text-xl font-semibold">Sign in to trade</h1>
        <p className="max-w-xs text-sm text-muted">
          The trading terminal is available to signed-in members of this demo workspace.
        </p>
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
    <div className="flex min-h-dvh flex-col">
      {/* top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md">
        <Link
          href="/"
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted transition-colors hover:text-foreground"
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="h-4.5 w-4.5" />
        </Link>

        {/* instrument switcher trigger */}
        <button
          onClick={() => setPickerOpen(true)}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-border px-2.5 py-1.5 text-left transition-colors hover:border-muted/40 sm:max-w-xs"
        >
          <InstrumentLogo symbol={inst.symbol} kind={inst.kind} size={24} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold leading-tight">{inst.symbol}</span>
            <span className="block truncate text-[11px] leading-tight text-muted">{inst.name}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
        </button>

        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-gain/25 bg-gain/8 px-2.5 py-1 text-[11px] font-semibold text-gain">
          <LiveDot connected={connected} />
          LIVE
        </span>

        <NotificationBell />
      </header>

      {/* autonomous-mode banner */}
      {engineRunning && session && (
        <div className="border-b border-brand/20 bg-gradient-to-r from-brand/10 via-gain/8 to-brand/10 px-4 py-2">
          <div className="mx-auto flex max-w-5xl items-center gap-2 text-[12px]">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute h-full w-full animate-ping rounded-full bg-gain opacity-70" />
              <span className="relative h-2 w-2 rounded-full bg-gain" />
            </span>
            <span className="min-w-0 flex-1 truncate text-foreground/90">
              <b>AxAI is trading autonomously.</b> Equity{" "}
              <span className="font-mono tabular-nums">${session.equity.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span> — Buy/Sell
              now queue signals for the engine.
            </span>
            <a href="#ai-terminal" className="shrink-0 font-semibold text-brand hover:underline">
              Open engine →
            </a>
          </div>
        </div>
      )}

      {/* scrollable content — bottom nav clears via pb-28 */}
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-4 px-4 pt-4 pb-28 sm:px-6 lg:pb-8">
        {/* instrument header */}
        <section className="rounded-2xl border border-border bg-surface/60 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <InstrumentLogo symbol={inst.symbol} kind={inst.kind} size={44} />
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-semibold tracking-tight">{inst.name}</h1>
                  <Star className="h-4 w-4 text-muted" aria-label="Add to watchlist" />
                </div>
                <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-muted">
                  <Globe className="h-3 w-3" />
                  {inst.kind === "forex" ? "FX · 24/5" : inst.kind === "crypto" ? "Crypto · 24/7" : "Real exchange · Regulated"}
                </p>
              </div>
            </div>
            <div className="text-right">
              <LivePrice inst={inst} className="text-2xl font-semibold sm:text-3xl" />
              <p className={`mt-0.5 font-mono text-sm font-medium tabular-nums ${up ? "text-gain" : "text-loss"}`}>
                {up ? "▲" : "▼"} {formatPct(changePct)} today
              </p>
            </div>
          </div>

          {/* stats strip */}
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-3.5 text-[13px] sm:grid-cols-4">
            <div>
              <p className="text-[11px] text-muted">Open position</p>
              <p className="mt-0.5 font-mono font-medium tabular-nums">{positionUnits.toFixed(2)} units</p>
            </div>
            <div>
              <p className="text-[11px] text-muted">Position value</p>
              <p className="mt-0.5 font-mono font-medium tabular-nums">${positionValue.toLocaleString("en-US", { maximumFractionDigits: 2 })}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted">Open P&amp;L</p>
              <p className={`mt-0.5 font-mono font-medium tabular-nums ${openPnl >= 0 ? "text-gain" : "text-loss"}`}>
                {positionUnits > 0 ? `${openPnl >= 0 ? "+" : "−"}$${Math.abs(openPnl).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—"}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted">Free funds</p>
              <p className="mt-0.5 font-mono font-medium tabular-nums">${account.cash.toLocaleString("en-US", { maximumFractionDigits: 2 })}</p>
            </div>
          </div>
        </section>

        {/* chart — AI fills on THIS instrument animate on it */}
        <TradeChart
          inst={inst}
          aiTrade={
            lastTrade && lastTrade.symbol === inst.symbol
              ? {
                  id: lastTrade.id,
                  symbol: lastTrade.symbol,
                  dir: lastTrade.dir,
                  pnl: lastTrade.pnl,
                  outcome: lastTrade.outcome,
                  at: lastTrade.at,
                }
              : null
          }
        />

        {/* buy / sell — signal the engine when it runs, manual orders otherwise */}
        <section className="grid grid-cols-2 gap-3">
          <button
            onClick={() => onManual("LONG")}
            className="group flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-[#00e0aa] to-[#00a87a] py-4 text-base font-bold text-[#04120d] shadow-[0_12px_32px_-10px_rgba(0,200,150,0.65)] transition-transform active:scale-[0.98]"
          >
            {engineRunning ? <Bot className="h-5 w-5" /> : <ArrowUpRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />}
            Buy
            <span className="font-mono text-sm font-semibold opacity-75">{formatPrice(price, inst.kind)}</span>
          </button>
          <button
            onClick={() => onManual("SHORT")}
            className="group flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-[#ff5b73] to-[#d32f4b] py-4 text-base font-bold text-[#1a0509] shadow-[0_12px_32px_-10px_rgba(246,70,93,0.6)] transition-transform active:scale-[0.98]"
          >
            {engineRunning ? <Bot className="h-5 w-5" /> : <ArrowDownRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5 group-hover:translate-y-0.5" />}
            Sell
            <span className="font-mono text-sm font-semibold opacity-75">{formatPrice(price, inst.kind)}</span>
          </button>
        </section>

        {/* the autonomous engine terminal — merged in, nothing sacrificed */}
        <div id="ai-terminal" className="scroll-mt-20">
          <AiPanel />
        </div>

        {/* positions / watchlist tabs */}
        <section className="rounded-2xl border border-border bg-surface/60">
          <div className="flex rounded-t-2xl border-b border-border">
            {(["positions", "watchlist"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`relative flex-1 py-3 text-[13px] font-semibold capitalize transition-colors ${
                  tab === t ? "text-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                {t}
                {tab === t && (
                  <motion.span
                    layoutId="trade-tab-underline"
                    className="absolute inset-x-6 bottom-0 h-0.5 rounded-full bg-brand"
                  />
                )}
              </button>
            ))}
          </div>

          <div className="p-4">
            {tab === "positions" ? (
              <div className="rounded-xl border border-border bg-background/40 p-4">
                {positionUnits > 0 ? (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <InstrumentLogo symbol={inst.symbol} kind={inst.kind} size={32} />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">{inst.symbol} · Long</p>
                          <p className="text-xs text-muted">
                            {positionUnits.toFixed(2)} units @ {formatPrice(avgCost, inst.kind)} avg
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-sm font-semibold tabular-nums">
                          ${positionValue.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                        </p>
                        <p className={`font-mono text-xs font-medium tabular-nums ${openPnl >= 0 ? "text-gain" : "text-loss"}`}>
                          {openPnl >= 0 ? "+" : "−"}${Math.abs(openPnl).toFixed(2)} (
                          {formatPct(avgCost > 0 ? ((price - avgCost) / avgCost) * 100 : 0)})
                        </p>
                      </div>
                    </div>
                    <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted">
                      <Info className="h-3 w-3" />
                      Bought from your account — sells execute instantly at the live price.
                    </p>
                  </>
                ) : (
                  <p className="text-[13px] text-muted">
                    No open position in {inst.symbol}. Use <b className="text-foreground">Buy</b> to open one
                    {engineRunning ? ", or queue a signal for AxAI." : "."}
                  </p>
                )}
              </div>
            ) : (
              <Watchlist onPick={(sym) => setSymbol(sym)} />
            )}
          </div>
        </section>
      </main>

      {/* overlays */}
      {pickerOpen && (
        <InstrumentSwitcher current={inst} onSelect={(i) => setSymbol(i.symbol)} onClose={() => setPickerOpen(false)} />
      )}
      <OrderSheet symbol={inst.symbol} open={sheetOpen} onClose={() => setSheetOpen(false)} />

      {/* signal toast */}
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8 }}
          className="fixed bottom-24 left-1/2 z-50 flex w-[min(92vw,26rem)] -translate-x-1/2 items-center gap-2.5 rounded-2xl border border-gain/40 bg-surface/95 px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.55)] backdrop-blur-md lg:bottom-8"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gain/50 bg-gain/15">
            <Check className="h-4 w-4 text-gain" />
          </span>
          <p className="text-[13px] font-medium leading-snug">{toast}</p>
        </motion.div>
      )}

      <BottomNav active="trade" />
    </div>
  );
}

export default function TradePage() {
  return (
    <AppProviders>
      <TradeInner />
    </AppProviders>
  );
}
