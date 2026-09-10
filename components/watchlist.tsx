"use client";

import { Plus } from "lucide-react";

import { InstrumentLogo } from "@/components/instrument-logo";
import { Sparkline } from "@/components/sparkline";
import {
  formatPct,
  formatPrice,
  INSTRUMENTS,
  seededSeries,
} from "@/lib/market-data";

const WATCH = ["NVDA", "BTC", "ETH", "SOL", "TSLA", "SPY", "XAUUSD", "EURUSD"];

export function Watchlist() {
  const rows = WATCH.map((s) => INSTRUMENTS.find((i) => i.symbol === s)!).filter(Boolean);

  return (
    <section className="rounded-2xl border border-border bg-surface/60">
      <div className="flex items-center justify-between px-5 py-4">
        <h2 className="text-sm font-semibold tracking-tight">Watchlist</h2>
        <button className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted transition-colors hover:border-muted/50 hover:text-foreground" aria-label="Add to watchlist">
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <ul className="divide-y divide-border/50 border-t border-border">
        {rows.map((inst) => {
          const up = inst.changePct >= 0;
          return (
            <li
              key={inst.symbol}
              className="group flex cursor-pointer items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2/60"
            >
              <InstrumentLogo symbol={inst.symbol} kind={inst.kind} size={28} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold leading-tight">{inst.symbol}</p>
                <p className="truncate text-xs text-muted">{inst.name}</p>
              </div>
              <Sparkline data={seededSeries(inst.symbol, 36, inst.vol ?? 0.012).map((v) => v * inst.price)} width={64} height={24} strokeWidth={1.3} />
              <div className="w-20 text-right">
                <p className="font-mono text-[13px] tabular-nums">{formatPrice(inst.price, inst.kind)}</p>
                <p className={`font-mono text-xs tabular-nums ${up ? "text-gain" : "text-loss"}`}>
                  {formatPct(inst.changePct)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
