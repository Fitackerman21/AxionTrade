"use client";

import { Activity, ArrowDownRight, ArrowUpRight, Gauge, ShieldCheck, TriangleAlert } from "lucide-react";

import { InstrumentLogo } from "@/components/instrument-logo";
import { formatPrice } from "@/lib/market-data";
import { formatSignedUsd, type MarkedPosition, type PortfolioView } from "@/lib/portfolio";

/**
 * Desk-style read on the book: how concentrated it is, what moved today, and
 * what has actually been banked. Concentration thresholds mirror the way a
 * broker flags a single-name position.
 */
export function PortfolioInsights({ view }: { view: PortfolioView }) {
  const { positions, topPosition, topWeight, best, worst, realizedPl, cashWeight, allocation } = view;

  if (positions.length === 0) return null;

  const concentration =
    topWeight >= 0.35
      ? { label: "Concentrated", tone: "warn" as const, note: "A single name dominates the book" }
      : topWeight >= 0.2
        ? { label: "Moderate", tone: "mid" as const, note: "One position carries meaningful weight" }
        : { label: "Diversified", tone: "ok" as const, note: "Weight is spread across the book" };

  const cashHeavy = cashWeight >= 0.4;

  return (
    <section className="rounded-2xl border border-border bg-surface/60 p-5">
      <div className="flex items-center gap-2">
        <Gauge className="h-4 w-4 text-muted" />
        <h2 className="text-sm font-semibold tracking-tight">Book insights</h2>
      </div>

      {/* concentration */}
      <div className="mt-4 rounded-xl border border-border bg-background/40 p-3.5">
        <div className="flex items-center gap-2">
          {concentration.tone === "ok" ? (
            <ShieldCheck className="h-4 w-4 text-gain" />
          ) : concentration.tone === "warn" ? (
            <TriangleAlert className="h-4 w-4 text-[#ff9f2e]" />
          ) : (
            <Activity className="h-4 w-4 text-brand" />
          )}
          <span className="text-[12.5px] font-semibold">{concentration.label}</span>
          <span className="ml-auto font-mono text-[12.5px] tabular-nums">
            {(topWeight * 100).toFixed(1)}%
          </span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border">
          <span
            className={`block h-full rounded-full transition-[width] duration-500 ${
              concentration.tone === "warn"
                ? "bg-[#ff9f2e]"
                : concentration.tone === "mid"
                  ? "bg-brand"
                  : "bg-gain"
            }`}
            style={{ width: `${Math.min(100, topWeight * 100)}%` }}
          />
        </div>
        <p className="mt-2 text-[11.5px] text-muted">
          Largest position{topPosition ? ` · ${topPosition.symbol}` : ""} — {concentration.note}.
        </p>
      </div>

      {/* today's movers */}
      <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
        <Mover p={best} title="Best today" up />
        <Mover p={worst} title="Worst today" up={false} />
      </div>

      {/* balances */}
      <div className="mt-3 space-y-2 rounded-xl border border-border bg-background/40 p-3.5 text-[12.5px]">
        <Row label="Realized P/L" value={formatSignedUsd(realizedPl)} tone={realizedPl >= 0 ? "gain" : "loss"} />
        <Row
          label="Asset classes held"
          value={`${allocation.length} of 6`}
          muted
        />
        <Row
          label="Cash weight"
          value={`${(cashWeight * 100).toFixed(1)}%`}
          hint={cashHeavy ? "holds a lot of dry powder" : undefined}
        />
      </div>
    </section>
  );
}

function Mover({ p, title, up }: { p: MarkedPosition | null; title: string; up: boolean }) {
  if (!p) return null;
  const gain = p.changePct >= 0;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-background/40 p-3">
      <InstrumentLogo symbol={p.symbol} kind={p.kind} size={30} />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted">{title}</p>
        <p className="truncate text-[12.5px] font-semibold">
          {p.symbol} <span className="font-normal text-muted">{formatPrice(p.price, p.kind)}</span>
        </p>
      </div>
      <div className="text-right">
        <p className={`inline-flex items-center gap-0.5 font-mono text-[12.5px] font-semibold tabular-nums ${gain ? "text-gain" : "text-loss"}`}>
          {gain ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
          {gain ? "+" : "−"}
          {Math.abs(p.changePct).toFixed(2)}%
        </p>
        <p className={`font-mono text-[11px] tabular-nums ${up && gain ? "text-gain" : "text-loss"} opacity-80`}>
          {formatSignedUsd(p.dayPl, 0)}
        </p>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
  muted,
  hint,
}: {
  label: string;
  value: string;
  tone?: "gain" | "loss";
  muted?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted">
        {label}
        {hint && <span className="ml-1.5 text-[11px] opacity-80">· {hint}</span>}
      </span>
      <span
        className={`font-mono tabular-nums ${
          tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : muted ? "text-muted" : "font-medium"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
