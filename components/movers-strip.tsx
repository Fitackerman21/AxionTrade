"use client";

import { useMemo } from "react";
import { Flame } from "lucide-react";

import { InstrumentLogo } from "@/components/instrument-logo";
import { LivePrice } from "@/components/live-price";
import { useLivePrices } from "@/components/live-prices";
import { INSTRUMENTS } from "@/lib/market-data";

export function MoversStrip() {
  const { quotes } = useLivePrices();

  const movers = useMemo(() => {
    const withQuotes = INSTRUMENTS.map((inst) => ({
      inst,
      changePct: quotes.get(inst.symbol)?.changePct ?? inst.changePct,
    }));
    const sorted = [...withQuotes].sort((a, b) => b.changePct - a.changePct);
    return { gainers: sorted.slice(0, 3), losers: sorted.slice(-3).reverse() };
  }, [quotes]);

  const Card = ({ inst, changePct }: { inst: (typeof INSTRUMENTS)[number]; changePct: number }) => {
    const up = changePct >= 0;
    return (
      <div className="group flex min-w-[150px] shrink-0 items-center gap-2.5 rounded-xl border border-border bg-surface/70 px-3 py-2.5 transition-colors hover:border-muted/40">
        <InstrumentLogo symbol={inst.symbol} kind={inst.kind} size={26} />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold leading-tight">{inst.symbol}</p>
          <LivePrice inst={inst} className="text-xs" />
        </div>
        <span
          className={`ml-auto rounded-lg px-2 py-1 font-mono text-xs font-bold tabular-nums ${
            up ? "bg-gain/15 text-gain" : "bg-loss/15 text-loss"
          }`}
        >
          {up ? "▲" : "▼"} {Math.abs(changePct).toFixed(2)}%
        </span>
      </div>
    );
  };

  return (
    <section>
      <div className="mb-2.5 flex items-center gap-2">
        <Flame className="h-4 w-4 text-[#ff9f2e]" />
        <h2 className="text-sm font-semibold tracking-tight">Top movers</h2>
        <span className="text-xs text-muted">live</span>
      </div>
      <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {movers.gainers.map(({ inst, changePct }) => (
          <Card key={`g-${inst.symbol}`} inst={inst} changePct={changePct} />
        ))}
        {movers.losers.map(({ inst, changePct }) => (
          <Card key={`l-${inst.symbol}`} inst={inst} changePct={changePct} />
        ))}
      </div>
    </section>
  );
}
