"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  Globe,
  Info,
  Plus,
  Star,
} from "lucide-react";

import { BottomNav } from "@/components/bottom-nav";
import { BrandMark } from "@/components/brand";
import { InstrumentLogo } from "@/components/instrument-logo";
import { LiveDot, LivePrice } from "@/components/live-price";
import { useLivePrices, useLiveQuote } from "@/components/live-prices";
import { OrderTicket } from "@/components/order-ticket";
import { TradeChart } from "@/components/trade-chart";
import { Watchlist } from "@/components/watchlist";
import { formatPct, formatPrice, INSTRUMENTS, type Instrument } from "@/lib/market-data";
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
/* Order sheet (mobile) / floating ticket (desktop)                    */
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
    <div className="fixed inset-0 z-50 flex items-end lg:hidden" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} />
      <div className="relative max-h-[88dvh] w-full overflow-y-auto rounded-t-3xl border-t border-border bg-surface p-1 shadow-[0_-16px_48px_rgba(0,0,0,0.6)]">
        <div className="sticky top-0 z-10 flex justify-center bg-gradient-to-b from-surface via-surface to-transparent pt-2.5 pb-2">
          <span className="h-1.5 w-10 rounded-full bg-border" />
        </div>
        <div className="px-3 pb-4">
          <OrderTicket key={symbol} defaultSymbol={symbol} onDone={onClose} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function TradeInner() {
  const authed = useRequireAuth();
  const { connected } = useLivePrices();
  const [symbol, setSymbol] = useState("BTC");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tab, setTab] = useState<"positions" | "watchlist">("positions");

  const inst = INSTRUMENTS.find((i) => i.symbol === symbol) ?? INSTRUMENTS[0];
  const q = useLiveQuote(inst.symbol);
  const price = q?.price ?? inst.price;
  const changePct = q?.changePct ?? inst.changePct;
  const up = changePct >= 0;

  // demo position for the header stat strip
  const positionUnits = 0.5;
  const positionValue = positionUnits * price;
  const openPnl = positionUnits * price * (changePct / 100);

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
      </header>

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
                {openPnl >= 0 ? "+" : "−"}${Math.abs(openPnl).toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted">Free funds</p>
              <p className="mt-0.5 font-mono font-medium tabular-nums">$12,840.55</p>
            </div>
          </div>
        </section>

        {/* chart */}
        <TradeChart inst={inst} />

        {/* buy / sell buttons — the heartbeat of the trade page */}
        <section className="grid grid-cols-2 gap-3">
          <button
            onClick={() => {
              setSheetOpen(true);
            }}
            className="group flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-[#00e0aa] to-[#00a87a] py-4 text-base font-bold text-[#04120d] shadow-[0_12px_32px_-10px_rgba(0,200,150,0.65)] transition-transform active:scale-[0.98]"
          >
            <ArrowUpRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            Buy
            <span className="font-mono text-sm font-semibold opacity-75">{formatPrice(price, inst.kind)}</span>
          </button>
          <button
            onClick={() => {
              setSheetOpen(true);
            }}
            className="group flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-[#ff5b73] to-[#d32f4b] py-4 text-base font-bold text-[#1a0509] shadow-[0_12px_32px_-10px_rgba(246,70,93,0.6)] transition-transform active:scale-[0.98]"
          >
            <ArrowDownRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5 group-hover:translate-y-0.5" />
            Sell
            <span className="font-mono text-sm font-semibold opacity-75">{formatPrice(price, inst.kind)}</span>
          </button>
        </section>

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
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <InstrumentLogo symbol={inst.symbol} kind={inst.kind} size={32} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{inst.symbol} · Long</p>
                      <p className="text-xs text-muted">
                        {positionUnits.toFixed(2)} units @ {formatPrice(price, inst.kind)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm font-semibold tabular-nums">
                      ${positionValue.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    </p>
                    <p className={`font-mono text-xs font-medium tabular-nums ${openPnl >= 0 ? "text-gain" : "text-loss"}`}>
                      {openPnl >= 0 ? "+" : "−"}${Math.abs(openPnl).toFixed(2)} ({formatPct(changePct)})
                    </p>
                  </div>
                </div>
                <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted">
                  <Info className="h-3 w-3" />
                  Demo position — seeded for this workspace preview.
                </p>
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
