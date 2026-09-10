"use client";

import { InstrumentLogo } from "@/components/instrument-logo";
import { Sparkline } from "@/components/sparkline";
import {
  formatPct,
  formatPrice,
  INSTRUMENTS,
  seededSeries,
  type Instrument,
} from "@/lib/market-data";

function TickerItem({ inst }: { inst: Instrument }) {
  const up = inst.changePct >= 0;
  const series = seededSeries(inst.symbol, 40, inst.vol ?? 0.01).map(
    (v) => v * inst.price
  );

  return (
    <a
      href="#"
      onClick={(e) => e.preventDefault()}
      className="group flex shrink-0 items-center gap-2.5 rounded-xl border border-transparent px-3 py-1.5 transition-colors hover:border-border hover:bg-surface/80"
    >
      <InstrumentLogo symbol={inst.symbol} kind={inst.kind} size={22} />
      <span className="text-sm font-semibold tracking-tight text-foreground">
        {inst.symbol}
      </span>
      <Sparkline data={series} width={56} height={20} strokeWidth={1.4} />
      <span className="font-mono text-[13px] tabular-nums text-muted">
        {formatPrice(inst.price, inst.kind)}
      </span>
      <span
        className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums ${
          up
            ? "bg-gain/10 text-gain"
            : "bg-loss/10 text-loss"
        }`}
      >
        {formatPct(inst.changePct)}
      </span>
    </a>
  );
}

export function TickerStrip() {
  // duplicate once for the seamless -50% translateX loop
  const doubled = [...INSTRUMENTS, ...INSTRUMENTS];

  return (
    <div className="relative w-full overflow-hidden border-y border-border/70 bg-surface/40 backdrop-blur-sm">
      <div className="animate-ticker flex w-max items-center gap-1 py-1.5">
        {doubled.map((inst, i) => (
          <TickerItem key={`${inst.symbol}-${i}`} inst={inst} />
        ))}
      </div>
      {/* edge fade masks */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-background to-transparent" />
    </div>
  );
}
