"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { ArrowDownRight, ArrowUpRight, Info, Scale, Target, TrendingDown, TrendingUp } from "lucide-react";

import {
  KIND_META,
  KIND_ORDER,
  formatSignedUsd,
  formatUsd,
  type AssetKind,
  type PortfolioView,
} from "@/lib/portfolio";


const MONO = "font-mono tabular-nums";

/**
 * Reference allocation the risk panel measures drift against. Deliberately
 * conservative and equity-heavy, which is the conventional default for a
 * long-only retail book.
 */
const MODEL_WEIGHTS: Record<AssetKind, number> = {
  stock: 0.4,
  etf: 0.2,
  crypto: 0.15,
  commodity: 0.1,
  forex: 0.1,
  index: 0.05,
};

/* --------------------------- P/L attribution --------------------------- */

/**
 * Which positions actually moved the book today. Answers "what moved my money"
 * rather than "what do I own", which is the question a P/L number on its own
 * cannot.
 */
export function ContributionPanel({ view }: { view: PortfolioView }) {
  const [scope, setScope] = useState<"day" | "total">("day");

  const rows = useMemo(() => {
    const scored = view.positions.map((p) => ({
      symbol: p.symbol,
      name: p.name,
      kind: p.kind,
      value: scope === "day" ? p.dayPl : p.unrealizedPl,
      pct: scope === "day" ? p.changePct : p.unrealizedPct,
    }));
    return scored.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 7);
  }, [view.positions, scope]);

  const total = rows.reduce((a, r) => a + r.value, 0);
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 0.0001);
  const net = scope === "day" ? view.dayPl : view.unrealizedPl;

  return (
    <section className="rounded-2xl border border-border bg-surface/60 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Scale className="h-4 w-4 text-brand" /> What moved the book
        </h2>
        <div className="flex rounded-lg border border-border p-0.5">
          {(
            [
              { id: "day", label: "Today" },
              { id: "total", label: "Open P/L" },
            ] as const
          ).map((s) => (
            <button
              key={s.id}
              onClick={() => setScope(s.id)}
              className={`rounded-md px-2 py-1 text-[10.5px] font-semibold transition-colors ${
                scope === s.id ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-1 text-[11px] text-muted">
        Largest contributors · net{" "}
        <span className={`${MONO} font-semibold ${net >= 0 ? "text-gain" : "text-loss"}`}>
          {formatSignedUsd(net)}
        </span>{" "}
        <span className="text-muted/70">
          (top {rows.length} = {formatSignedUsd(total)})
        </span>
      </p>

      {rows.length === 0 ? (
        <p className="mt-4 text-[13px] text-muted">No open positions to attribute yet.</p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {rows.map((r) => {
            const up = r.value >= 0;
            return (
              <li key={r.symbol}>
                <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: KIND_META[r.kind].color }}
                    />
                    <span className="truncate font-medium">{r.symbol}</span>
                  </span>
                  <span className={`${MONO} shrink-0 font-semibold ${up ? "text-gain" : "text-loss"}`}>
                    {formatSignedUsd(r.value)}
                    <span className="ml-1.5 font-normal opacity-70">
                      {r.pct >= 0 ? "+" : "−"}
                      {Math.abs(r.pct).toFixed(2)}%
                    </span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-background/70">
                  <div
                    className={`h-full rounded-full ${up ? "bg-gain" : "bg-loss"}`}
                    style={{ width: `${Math.max(2, (Math.abs(r.value) / max) * 100)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------ risk panel ----------------------------- */

/**
 * Concentration, asset-class drift against a reference allocation, and cash
 * drag. The single largest risk is called out in words, because a bar chart of
 * weights does not tell you what to worry about.
 */
export function RiskPanel({ view }: { view: PortfolioView }) {
  const drift = useMemo(() => {
    return KIND_ORDER.map((k) => {
      const actual = view.allocation.find((a) => a.kind === k)?.weight ?? 0;
      const model = MODEL_WEIGHTS[k];
      return { kind: k, actual, model, gap: actual - model };
    })
      .filter((d) => d.actual > 0 || d.model > 0)
      .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  }, [view.allocation]);

  // Herfindahl index → a 1–10 diversification score
  const hhi = useMemo(
    () => view.positions.reduce((a, p) => a + p.weight ** 2, 0),
    [view.positions]
  );
  const divScore = view.positions.length <= 1 ? 1 : Math.max(1, Math.min(10, Math.round((1 - hhi) * 10 * 1.35)));

  const concentration =
    view.topWeight >= 0.4 ? "concentrated" : view.topWeight >= 0.22 ? "moderate" : "diversified";
  const largestGap = drift[0];

  const riskCallout = (() => {
    if (view.positions.length === 0) return "No open exposure — the whole book is cash.";
    if (view.topWeight >= 0.4)
      return `${view.topPosition?.symbol} is ${(view.topWeight * 100).toFixed(0)}% of the book. A single-instrument book carries the full idiosyncratic risk of that name.`;
    if (largestGap && largestGap.gap > 0.12)
      return `${KIND_META[largestGap.kind].label} is ${(largestGap.actual * 100).toFixed(0)}% of the book against a ${(largestGap.model * 100).toFixed(0)}% reference — an over-weight of ${(largestGap.gap * 100).toFixed(0)} points.`;
    if (view.cashWeight > 0.5)
      return `${(view.cashWeight * 100).toFixed(0)}% of equity is in cash. That is safety, but it is also drag: it earns nothing while it sits there.`;
    return "No single exposure dominates. The book is balanced across classes.";
  })();

  return (
    <section className="rounded-2xl border border-border bg-surface/60 p-5">
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
        <Target className="h-4 w-4 text-brand" /> Risk &amp; exposure
      </h2>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-border bg-background/40 px-3 py-2">
          <p className="text-[10.5px] text-muted">Largest</p>
          <p className={`${MONO} text-[13px] font-semibold`}>{(view.topWeight * 100).toFixed(0)}%</p>
          <p className="text-[10px] text-muted">{view.topPosition?.symbol ?? "—"}</p>
        </div>
        <div className="rounded-xl border border-border bg-background/40 px-3 py-2">
          <p className="text-[10.5px] text-muted">Cash drag</p>
          <p className={`${MONO} text-[13px] font-semibold`}>{(view.cashWeight * 100).toFixed(0)}%</p>
          <p className="text-[10px] text-muted">of equity</p>
        </div>
        <div className="rounded-xl border border-border bg-background/40 px-3 py-2">
          <p className="text-[10.5px] text-muted">Breadth</p>
          <p className={`${MONO} text-[13px] font-semibold`}>{divScore}/10</p>
          <p className="text-[10px] text-muted">{view.count} names</p>
        </div>
      </div>

      <p
        className={`mt-3 inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10.5px] font-semibold uppercase ${
          concentration === "concentrated"
            ? "border-loss/30 bg-loss/10 text-loss"
            : concentration === "moderate"
              ? "border-[#ff9f2e]/30 bg-[#ff9f2e]/10 text-[#ff9f2e]"
              : "border-gain/30 bg-gain/10 text-gain"
        }`}
      >
        {concentration}
      </p>

      <div className="mt-4 space-y-2.5">
        <p className="text-[10.5px] tracking-wide text-muted uppercase">Class weights vs reference</p>
        {drift.map((d) => (
          <div key={d.kind}>
            <div className="flex items-baseline justify-between text-[12px]">
              <span className="font-medium">{KIND_META[d.kind].label}</span>
              <span className={`${MONO} ${d.gap >= 0 ? "text-gain" : "text-loss"}`}>
                {(d.actual * 100).toFixed(0)}%
                <span className="ml-1.5 font-normal text-muted">
                  vs {(d.model * 100).toFixed(0)}% · {d.gap >= 0 ? "+" : "−"}
                  {Math.abs(d.gap * 100).toFixed(0)}
                </span>
              </span>
            </div>
            {/* track with the reference marker */}
            <div className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-background/70">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.min(100, d.actual * 100)}%`, background: KIND_META[d.kind].color }}
              />
              <span
                className="absolute inset-y-0 w-px bg-foreground/70"
                style={{ left: `${Math.min(100, d.model * 100)}%` }}
                aria-hidden
              />
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 flex items-start gap-1.5 rounded-xl border border-border bg-background/40 px-3 py-2.5 text-[11.5px] leading-relaxed text-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{riskCallout}</span>
      </p>
    </section>
  );
}

/* -------------------------- performance ladder -------------------------- */

/** Best and worst holdings by return on cost, side by side. */
export function PerformanceLadder({ view }: { view: PortfolioView }) {
  const ranked = useMemo(
    () => [...view.positions].sort((a, b) => b.unrealizedPct - a.unrealizedPct),
    [view.positions]
  );
  const top = ranked.slice(0, 4);
  const bottom = ranked.slice(-4).reverse();

  if (ranked.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border bg-surface/60 p-5">
      <h2 className="text-sm font-semibold tracking-tight">Return ladder</h2>
      <p className="mt-1 text-[11px] text-muted">Unrealized return on cost, best and worst</p>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <LadderColumn title="Leading" icon={<TrendingUp className="h-3.5 w-3.5 text-gain" />} rows={top} />
        <LadderColumn title="Lagging" icon={<TrendingDown className="h-3.5 w-3.5 text-loss" />} rows={bottom} />
      </div>
    </section>
  );
}

function LadderColumn({
  title,
  icon,
  rows,
}: {
  title: string;
  icon: React.ReactNode;
  rows: PortfolioView["positions"];
}) {
  return (
    <div>
      <p className="mb-2 inline-flex items-center gap-1.5 text-[10.5px] font-semibold tracking-wide text-muted uppercase">
        {icon}
        {title}
      </p>
      <ul className="space-y-1.5">
        {rows.map((p) => {
          const up = p.unrealizedPct >= 0;
          return (
            <li key={p.symbol}>
              <Link
                href={`/trade?symbol=${p.symbol}`}
                className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-surface-2/60"
              >
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{p.symbol}</span>
                <span className={`${MONO} text-[12px] text-muted`}>{formatUsd(p.value, 0)}</span>
                <span className={`${MONO} inline-flex w-16 items-center justify-end gap-0.5 text-[12px] font-semibold ${up ? "text-gain" : "text-loss"}`}>
                  {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                  {Math.abs(p.unrealizedPct).toFixed(1)}%
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
