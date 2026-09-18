"use client";

import { useMemo } from "react";

import { useLivePrices } from "@/components/live-prices";
import { useAccount } from "@/lib/account-store";
import { useAiSession } from "@/lib/ai-session";
import { INSTRUMENTS, type Instrument } from "@/lib/market-data";

export type AssetKind = Instrument["kind"];

/**
 * Display metadata per asset class. Shared by the allocation donut, the
 * composition bar and the position filters so a class always has one colour.
 */
export const KIND_META: Record<AssetKind, { label: string; color: string }> = {
  stock: { label: "Equities", color: "#2e90fa" },
  etf: { label: "ETFs", color: "#00c896" },
  crypto: { label: "Crypto", color: "#f0b90b" },
  commodity: { label: "Commodities", color: "#ff9f2e" },
  index: { label: "Indices", color: "#9a6aff" },
  forex: { label: "FX", color: "#00b8d9" },
};

/** Kinds in the order they should appear in legends, filters and the donut. */
export const KIND_ORDER: AssetKind[] = ["stock", "etf", "crypto", "commodity", "index", "forex"];

export interface MarkedPosition {
  symbol: string;
  name: string;
  kind: AssetKind;
  qty: number;
  avgCost: number;
  /** live mark */
  price: number;
  previousClose: number;
  changePct: number;
  costBasis: number;
  value: number;
  /** change in paper value since the previous close */
  dayPl: number;
  unrealizedPl: number;
  unrealizedPct: number;
  /** share of the invested book, 0–1 */
  weight: number;
  openedAt: number;
  source: "manual" | "ai";
}

export interface AllocationSlice {
  kind: AssetKind;
  label: string;
  color: string;
  value: number;
  /** share of the invested book, 0–1 */
  weight: number;
  count: number;
}

export interface PortfolioView {
  positions: MarkedPosition[];
  allocation: AllocationSlice[];
  /** market value of everything held long */
  invested: number;
  costBasis: number;
  cash: number;
  /** value with the AI engine right now (principal + running P/L) */
  aiEquity: number;
  aiPrincipal: number;
  /** cash + invested + ai equity — the headline number */
  equity: number;
  unrealizedPl: number;
  unrealizedPct: number;
  dayPl: number;
  dayPct: number;
  realizedPl: number;
  totalPl: number;
  totalPlPct: number;
  /** composition of total equity, 0–1 */
  investedWeight: number;
  cashWeight: number;
  aiWeight: number;
  /** largest single position as a share of the invested book. Concentration risk. */
  topWeight: number;
  topPosition: MarkedPosition | null;
  best: MarkedPosition | null;
  worst: MarkedPosition | null;
  /** number of instruments held */
  count: number;
}

const EMPTY: PortfolioView = {
  positions: [],
  allocation: [],
  invested: 0,
  costBasis: 0,
  cash: 0,
  aiEquity: 0,
  aiPrincipal: 0,
  equity: 0,
  unrealizedPl: 0,
  unrealizedPct: 0,
  dayPl: 0,
  dayPct: 0,
  realizedPl: 0,
  totalPl: 0,
  totalPlPct: 0,
  investedWeight: 0,
  cashWeight: 0,
  aiWeight: 0,
  topWeight: 0,
  topPosition: null,
  best: null,
  worst: null,
  count: 0,
};

const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

/**
 * Single source of truth for every portfolio figure in the app. Positions are
 * marked against live quotes each tick, so P/L and weights move in real time;
 * the previous close comes from the provider, so "today" means the real
 * session rather than a rolling window.
 */
export function usePortfolio(): PortfolioView {
  const { account } = useAccount();
  const { quotes } = useLivePrices();
  const { session } = useAiSession();

  return useMemo(() => {
    const positions: MarkedPosition[] = [];

    for (const held of account.positions) {
      const inst = INSTRUMENTS.find((i) => i.symbol === held.symbol);
      if (!inst) continue;
      const q = quotes.get(held.symbol);
      const price = q?.price ?? inst.price;
      const previousClose = q?.previousClose ?? inst.price / (1 + inst.changePct / 100);
      const costBasis = held.qty * held.avgCost;
      const value = held.qty * price;
      const dayPl = (price - previousClose) * held.qty;

      positions.push({
        symbol: held.symbol,
        name: inst.name,
        kind: inst.kind,
        qty: held.qty,
        avgCost: held.avgCost,
        price,
        previousClose,
        changePct: pct(price - previousClose, previousClose),
        costBasis,
        value,
        dayPl,
        unrealizedPl: value - costBasis,
        unrealizedPct: pct(value - costBasis, costBasis),
        weight: 0,
        openedAt: held.openedAt,
        source: held.source,
      });
    }

    positions.sort((a, b) => b.value - a.value);
    const invested = positions.reduce((sum, p) => sum + p.value, 0);
    const costBasis = positions.reduce((sum, p) => sum + p.costBasis, 0);
    const dayPl = positions.reduce((sum, p) => sum + p.dayPl, 0);

    for (const p of positions) p.weight = invested > 0 ? p.value / invested : 0;

    /* allocation by asset class, biggest first */
    const byKind = new Map<AssetKind, AllocationSlice>();
    for (const p of positions) {
      const meta = KIND_META[p.kind];
      const slice = byKind.get(p.kind) ?? {
        kind: p.kind,
        label: meta.label,
        color: meta.color,
        value: 0,
        weight: 0,
        count: 0,
      };
      slice.value += p.value;
      slice.count += 1;
      byKind.set(p.kind, slice);
    }
    const allocation = [...byKind.values()]
      .map((s) => ({ ...s, weight: invested > 0 ? s.value / invested : 0 }))
      .sort((a, b) => b.value - a.value);

    /* best/worst by today's move, ignoring dust positions that skew the % */
    const meaningful = positions.filter((p) => p.value > 1);
    const ranked = [...meaningful].sort((a, b) => b.changePct - a.changePct);

    const cash = account.cash;
    const aiEquity = session?.equity ?? account.aiPrincipal;
    const equity = cash + invested + aiEquity;
    const unrealizedPl = invested - costBasis;
    const realizedPl = account.realizedPl;
    const totalPl = unrealizedPl + realizedPl;

    return {
      positions,
      allocation,
      invested,
      costBasis,
      cash,
      aiEquity,
      aiPrincipal: account.aiPrincipal,
      equity,
      unrealizedPl,
      unrealizedPct: pct(unrealizedPl, costBasis),
      dayPl,
      dayPct: pct(dayPl, invested - dayPl),
      realizedPl,
      totalPl,
      totalPlPct: pct(totalPl, costBasis + realizedPl - unrealizedPl),
      investedWeight: equity > 0 ? invested / equity : 0,
      cashWeight: equity > 0 ? cash / equity : 0,
      aiWeight: equity > 0 ? aiEquity / equity : 0,
      topWeight: positions[0]?.weight ?? 0,
      topPosition: positions[0] ?? null,
      best: ranked[0] ?? null,
      worst: ranked[ranked.length - 1] ?? null,
      count: positions.length,
    };
  }, [account, quotes, session]);
}

/** Convenience for pages that need a blank view before providers hydrate. */
export const EMPTY_PORTFOLIO = EMPTY;

/* ------------------------------ formatting ------------------------------ */

/** `$12,480.55` — fixed decimals, no currency surprises. */
export function formatUsd(v: number, frac = 2) {
  return `$${v.toLocaleString("en-US", {
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
  })}`;
}

/**
 * Signed money in the desk convention: a real minus sign (U+2212) rather than
 * a hyphen, so columns of figures stay optically aligned.
 */
export function formatSignedUsd(v: number, frac = 2) {
  return `${v >= 0 ? "+" : "\u2212"}${formatUsd(Math.abs(v), frac)}`;
}

