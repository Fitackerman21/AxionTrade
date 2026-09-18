"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowDown,
  ArrowDownRight,
  ArrowUp,
  ArrowUpRight,
  Compass,
  Flame,
  Grid2x2,
  Layers,
  Search,
  SlidersHorizontal,
  Star,
  TrendingDown,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { AppShell } from "@/components/app-nav";
import { BottomNav } from "@/components/bottom-nav";
import { BrandMark } from "@/components/brand";
import { InstrumentLogo } from "@/components/instrument-logo";
import { LivePrice } from "@/components/live-price";
import { useLivePrices } from "@/components/live-prices";
import { MarketDetail } from "@/components/market-detail";
import { Sparkline } from "@/components/sparkline";
import { useRequireAuth } from "@/lib/demo-auth";
import { KIND_META, KIND_ORDER, usePortfolio, type AssetKind } from "@/lib/portfolio";
import { INSTRUMENTS, formatPct, formatPrice, seededSeries, type Instrument } from "@/lib/market-data";
import { AppProviders } from "@/lib/providers";
import { useWatchlist } from "@/lib/watchlist";

const MONO = "font-mono tabular-nums";

/** Realistic half-spread per asset class, as a fraction of price. */
const SPREAD: Record<string, number> = {
  forex: 0.00012,
  crypto: 0.00035,
  commodity: 0.0004,
  index: 0.0005,
  etf: 0.0005,
  stock: 0.0006,
};

/** US cash session, in the market's own timezone. */
function usSessionOpen(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday");
  if (weekday === "Sat" || weekday === "Sun") return false;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return minutes >= 570 && minutes < 960; // 09:30 – 16:00
}

function marketStatus(inst: Instrument, now: Date) {
  if (inst.kind === "crypto") return { label: "24/7", open: true };
  if (inst.kind === "forex") return { label: "24/5", open: now.getUTCDay() !== 0 && now.getUTCDay() !== 6 };
  if (inst.kind === "commodity") return { label: "23/5", open: usSessionOpen(now) || now.getUTCDay() !== 0 };
  return { label: usSessionOpen(now) ? "Open" : "Closed", open: usSessionOpen(now) };
}

type SortKey = "change" | "price" | "name" | "symbol";
type ViewMode = "table" | "grid" | "heat";
type QuickFilter = "all" | "gainers" | "losers" | "watching" | "held";

interface Row {
  inst: Instrument;
  price: number;
  previousClose: number;
  changePct: number;
  live: boolean;
  dir: "up" | "down" | null;
  spreadPct: number;
  spark: number[];
  held: boolean;
  status: { label: string; open: boolean };
}

function MarketsInner() {
  const authed = useRequireAuth();
  const { quotes } = useLivePrices();
  const portfolio = usePortfolio();
  const watch = useWatchlist();

  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<AssetKind | "all">("all");
  const [quick, setQuick] = useState<QuickFilter>("all");
  const [sort, setSort] = useState<SortKey>("change");
  const [asc, setAsc] = useState(false);
  const [view, setView] = useState<ViewMode>("table");
  const [detail, setDetail] = useState<Instrument | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // one clock reading per render is enough for session status
  const now = useMemo(() => new Date(), []);
  const heldSymbols = useMemo(() => new Set(portfolio.positions.map((p) => p.symbol)), [portfolio.positions]);

  const rows = useMemo<Row[]>(() => {
    return INSTRUMENTS.map((inst) => {
      const q = quotes.get(inst.symbol);
      const price = q?.price ?? inst.price;
      const previousClose = q?.previousClose ?? inst.price / (1 + inst.changePct / 100);
      const changePct = q?.changePct ?? inst.changePct;
      return {
        inst,
        price,
        previousClose,
        changePct,
        live: q?.live ?? false,
        dir: q?.dir ?? null,
        spreadPct: SPREAD[inst.kind] ?? 0.0006,
        spark: seededSeries(inst.symbol, 40, inst.vol ?? 0.014).map((v) => v * price),
        held: heldSymbols.has(inst.symbol),
        status: marketStatus(inst, now),
      };
    });
  }, [quotes, heldSymbols, now]);

  /* ------------------------------ analytics ------------------------------ */

  const breadth = useMemo(() => {
    let up = 0;
    let down = 0;
    let flat = 0;
    let sum = 0;
    for (const r of rows) {
      if (r.changePct > 0.05) up += 1;
      else if (r.changePct < -0.05) down += 1;
      else flat += 1;
      sum += r.changePct;
    }
    const avg = rows.length ? sum / rows.length : 0;
    return {
      up,
      down,
      flat,
      avg,
      advPct: rows.length ? (up / rows.length) * 100 : 0,
      // >55% advancing reads as risk-on; the mirror reads as risk-off
      tone: up / Math.max(1, up + down) > 0.55 ? "risk-on" : down / Math.max(1, up + down) > 0.55 ? "risk-off" : "mixed",
    };
  }, [rows]);

  const classPerf = useMemo(() => {
    return KIND_ORDER.map((k) => {
      const group = rows.filter((r) => r.inst.kind === k);
      const avg = group.length ? group.reduce((a, r) => a + r.changePct, 0) / group.length : 0;
      const best = group.reduce<Row | null>((a, r) => (!a || r.changePct > a.changePct ? r : a), null);
      return { kind: k, count: group.length, avg, best };
    }).filter((g) => g.count > 0);
  }, [rows]);

  // Movers are a market-wide read, so they deliberately ignore the text search
  // and the gainers/losers toggles — but they do follow the asset-class filter,
  // because scoping to Crypto and then being shown equity movers is incoherent.
  const movers = useMemo(() => {
    const pool = rows.filter((r) => kind === "all" || r.inst.kind === kind);
    const sorted = [...pool].sort((a, b) => b.changePct - a.changePct);
    const volatile = [...pool].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
    return {
      gainers: sorted.slice(0, 5),
      losers: sorted.slice(-5).reverse(),
      volatile: volatile.slice(0, 5),
    };
  }, [rows, kind]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (kind !== "all" && r.inst.kind !== kind) return false;
      if (quick === "gainers" && r.changePct <= 0) return false;
      if (quick === "losers" && r.changePct >= 0) return false;
      if (quick === "watching" && !watch.has(r.inst.symbol)) return false;
      if (quick === "held" && !r.held) return false;
      if (q && !r.inst.symbol.toLowerCase().includes(q) && !r.inst.name.toLowerCase().includes(q)) return false;
      return true;
    });

    const dir = asc ? 1 : -1;
    out = out.sort((a, b) => {
      switch (sort) {
        case "price":
          return (a.price - b.price) * dir;
        case "name":
          return a.inst.name.localeCompare(b.inst.name) * dir;
        case "symbol":
          return a.inst.symbol.localeCompare(b.inst.symbol) * dir;
        default:
          return (a.changePct - b.changePct) * dir;
      }
    });
    return out;
  }, [rows, kind, quick, query, sort, asc, watch]);

  if (authed === null) {
    return <div className="flex min-h-dvh items-center justify-center text-sm text-muted">Loading…</div>;
  }

  if (authed === false) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <BrandMark size={40} />
        <h1 className="text-xl font-semibold">Sign in to explore markets</h1>
        <p className="max-w-xs text-sm text-muted">
          The market screener is available to signed-in members.
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

  const sortBtn = (key: SortKey, label: string, className = "") => {
    const active = sort === key;
    return (
      <button
        onClick={() => {
          if (active) setAsc((v) => !v);
          else {
            setSort(key);
            setAsc(false);
          }
        }}
        className={`inline-flex items-center gap-1 font-medium transition-colors ${
          active ? "text-foreground" : "text-muted hover:text-foreground"
        } ${className}`}
      >
        {label}
        {active && (asc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    );
  };

  return (
    <AppShell>
      <div className="flex min-h-dvh flex-col">
        <AppHeader
          leading={
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand/30 bg-brand/10">
                <Compass className="h-4.5 w-4.5 text-brand" />
              </span>
              <div className="min-w-0">
                <h1 className="text-sm leading-tight font-semibold tracking-tight">Markets</h1>
                <p className="hidden text-[11px] leading-tight text-muted sm:block">
                  {rows.length} instruments · 5 asset classes · live
                </p>
              </div>
            </div>
          }
        />

        <main className="mx-auto w-full max-w-[1440px] flex-1 space-y-4 px-4 pt-4 pb-28 sm:px-6 lg:pb-10">
          {/* ---------------- market breadth ---------------- */}
          <section className="rounded-2xl border border-border bg-surface/60 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="inline-flex items-center gap-1.5 text-[11px] tracking-wide text-muted uppercase">
                  <Layers className="h-3 w-3" /> Market breadth
                </p>
                <p className="mt-1 text-2xl font-semibold tracking-tight">
                  <span className="text-gain">{breadth.up}</span>
                  <span className="mx-1.5 text-muted">/</span>
                  <span className="text-loss">{breadth.down}</span>
                  <span className="ml-2 text-sm font-normal text-muted">
                    advancing / declining · {breadth.flat} flat
                  </span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-muted">Average move</p>
                <p className={`${MONO} text-xl font-semibold ${breadth.avg >= 0 ? "text-gain" : "text-loss"}`}>
                  {formatPct(breadth.avg)}
                </p>
                <p
                  className={`mt-0.5 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold uppercase ${
                    breadth.tone === "risk-on"
                      ? "border-gain/30 bg-gain/10 text-gain"
                      : breadth.tone === "risk-off"
                        ? "border-loss/30 bg-loss/10 text-loss"
                        : "border-border bg-background/40 text-muted"
                  }`}
                >
                  {breadth.tone}
                </p>
              </div>
            </div>

            {/* advance / decline bar */}
            <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-background/70">
              <div className="bg-gain" style={{ width: `${(breadth.up / rows.length) * 100}%` }} />
              <div className="bg-border" style={{ width: `${(breadth.flat / rows.length) * 100}%` }} />
              <div className="bg-loss" style={{ width: `${(breadth.down / rows.length) * 100}%` }} />
            </div>

            {/* per-class performance */}
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {classPerf.map((g) => {
                const meta = KIND_META[g.kind];
                return (
                  <button
                    key={g.kind}
                    onClick={() => {
                      setKind(kind === g.kind ? "all" : g.kind);
                      setView("table");
                    }}
                    className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                      kind === g.kind ? "border-brand/40 bg-brand/8" : "border-border bg-background/40 hover:border-muted/40"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: meta.color }} />
                      <span className="truncate text-[11px] font-semibold">{meta.label}</span>
                    </span>
                    <span className={`mt-1 block ${MONO} text-[13px] font-semibold ${g.avg >= 0 ? "text-gain" : "text-loss"}`}>
                      {formatPct(g.avg)}
                    </span>
                    <span className="block text-[10px] text-muted">
                      {g.count} · best {g.best?.inst.symbol ?? "—"}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ---------------- controls ---------------- */}
          <section className="rounded-2xl border border-border bg-surface/60 p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search symbol or name…"
                  className="input-dark h-10 pl-9 pr-9"
                  aria-label="Search instruments"
                />
                {query && (
                  <button
                    onClick={() => setQuery("")}
                    className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted hover:text-foreground"
                    aria-label="Clear search"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              <button
                onClick={() => setShowFilters((v) => !v)}
                className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-[13px] font-semibold transition-colors ${
                  showFilters ? "border-brand/40 bg-brand/10 text-foreground" : "border-border text-muted hover:text-foreground"
                }`}
              >
                <SlidersHorizontal className="h-4 w-4" />
                Filters
                {(kind !== "all" || quick !== "all") && (
                  <span className="rounded-full bg-brand px-1.5 text-[10px] font-bold text-[#071018]">
                    {(kind !== "all" ? 1 : 0) + (quick !== "all" ? 1 : 0)}
                  </span>
                )}
              </button>

              <div className="flex h-10 shrink-0 items-center gap-0.5 rounded-xl border border-border p-0.5">
                {(
                  [
                    { id: "table", icon: SlidersHorizontal, label: "Table" },
                    { id: "grid", icon: Grid2x2, label: "Grid" },
                    { id: "heat", icon: Flame, label: "Heatmap" },
                  ] as const
                ).map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setView(v.id)}
                    aria-label={v.label}
                    title={v.label}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                      view === v.id ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"
                    }`}
                  >
                    <v.icon className="h-4 w-4" />
                  </button>
                ))}
              </div>
            </div>

            {showFilters && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-3 space-y-3 overflow-hidden">
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">Asset class</p>
                  <div className="flex flex-wrap gap-1.5">
                    <FilterChip active={kind === "all"} onClick={() => setKind("all")}>
                      All {rows.length}
                    </FilterChip>
                    {KIND_ORDER.map((k) => {
                      const n = rows.filter((r) => r.inst.kind === k).length;
                      if (!n) return null;
                      return (
                        <FilterChip key={k} active={kind === k} onClick={() => setKind(k)} color={KIND_META[k].color}>
                          {KIND_META[k].label} {n}
                        </FilterChip>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">Show</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        { id: "all", label: "Everything" },
                        { id: "gainers", label: `Gainers ${movers.gainers.filter((r) => r.changePct > 0).length}` },
                        { id: "losers", label: "Losers" },
                        { id: "watching", label: `Watching ${watch.symbols.length}` },
                        { id: "held", label: `Held ${heldSymbols.size}` },
                      ] as const
                    ).map((f) => (
                      <FilterChip key={f.id} active={quick === f.id} onClick={() => setQuick(f.id)}>
                        {f.label}
                      </FilterChip>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </section>

          {/* ---------------- list ---------------- */}
          <section className="rounded-2xl border border-border bg-surface/60">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold tracking-tight">
                {filtered.length} instrument{filtered.length === 1 ? "" : "s"}
                {kind !== "all" && <span className="ml-1.5 text-muted">· {KIND_META[kind].label}</span>}
              </h2>
              <div className="flex items-center gap-3 text-[11px]">
                {sortBtn("change", "Change")}
                {sortBtn("price", "Price")}
                {sortBtn("symbol", "Symbol")}
              </div>
            </div>

            {/* ---- table ---- */}
            {view === "table" && (
              <>
                <div className="hidden items-center gap-3 border-b border-border/60 px-4 py-2 text-[10.5px] tracking-wide text-muted uppercase md:flex">
                  <span className="min-w-0 flex-1">Instrument</span>
                  <span className="w-16 text-right">Class</span>
                  <span className="w-28 text-right">Price</span>
                  <span className="w-20 text-right">Change</span>
                  <span className="w-20 text-right">Spread</span>
                  <span className="w-24 text-right">Session</span>
                  <span className="w-16" />
                </div>
                <ul className="divide-y divide-border/50">
                  {filtered.map((r) => (
                    <TableRow key={r.inst.symbol} row={r} watching={watch.has(r.inst.symbol)} onToggleWatch={() => watch.toggle(r.inst.symbol)} onOpen={() => setDetail(r.inst)} />
                  ))}
                </ul>
              </>
            )}

            {/* ---- grid ---- */}
            {view === "grid" && (
              <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filtered.map((r) => (
                  <button
                    key={r.inst.symbol}
                    onClick={() => setDetail(r.inst)}
                    className="group rounded-2xl border border-border bg-background/40 p-3.5 text-left transition-colors hover:border-brand/40"
                  >
                    <div className="flex items-center gap-2.5">
                      <InstrumentLogo symbol={r.inst.symbol} kind={r.inst.kind} size={30} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold leading-tight">{r.inst.symbol}</p>
                        <p className="truncate text-[11px] text-muted">{r.inst.name}</p>
                      </div>
                      {r.held && (
                        <span className="rounded border border-brand/40 px-1 py-px text-[9px] font-bold text-brand">
                          HELD
                        </span>
                      )}
                    </div>
                    <div className="mt-3 flex items-end justify-between gap-2">
                      <div>
                        <LivePrice inst={r.inst} className="text-base font-semibold" />
                        <p className={`${MONO} text-[12px] ${r.changePct >= 0 ? "text-gain" : "text-loss"}`}>
                          {formatPct(r.changePct)}
                        </p>
                      </div>
                      <Sparkline
                        data={r.spark}
                        width={80}
                        height={30}
                        baseline={r.previousClose}
                        stroke={r.changePct >= 0 ? "#00c896" : "#f6465d"}
                      />
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2 text-[10px] text-muted">
                      <span className={r.status.open ? "text-gain" : ""}>{r.status.label}</span>
                      <span className={MONO}>spread {(r.spreadPct * 100).toFixed(3)}%</span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* ---- heatmap ---- */}
            {view === "heat" && (
              <div className="grid grid-cols-3 gap-1.5 p-4 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                {filtered.map((r) => {
                  const mag = Math.min(1, Math.abs(r.changePct) / 4);
                  const bg =
                    r.changePct >= 0
                      ? `rgba(0, 200, 150, ${0.1 + mag * 0.5})`
                      : `rgba(246, 70, 93, ${0.1 + mag * 0.5})`;
                  return (
                    <button
                      key={r.inst.symbol}
                      onClick={() => setDetail(r.inst)}
                      style={{ background: bg }}
                      className="flex flex-col items-start gap-1 rounded-xl border border-border/60 p-2.5 text-left transition-transform hover:scale-[1.03]"
                    >
                      <span className="flex w-full items-center gap-1.5">
                        <InstrumentLogo symbol={r.inst.symbol} kind={r.inst.kind} size={16} />
                        <span className="truncate text-[11px] font-bold">{r.inst.symbol}</span>
                      </span>
                      <span className={`${MONO} text-[13px] font-semibold`}>{formatPct(r.changePct)}</span>
                      <span className={`${MONO} text-[10px] opacity-70`}>{formatPrice(r.price, r.inst.kind)}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {filtered.length === 0 && (
              <div className="px-4 py-12 text-center">
                <p className="text-sm font-medium">No instruments match those filters.</p>
                <button
                  onClick={() => {
                    setQuery("");
                    setKind("all");
                    setQuick("all");
                  }}
                  className="mt-3 rounded-xl border border-border px-4 py-2 text-[13px] font-semibold text-muted transition-colors hover:text-foreground"
                >
                  Reset filters
                </button>
              </div>
            )}
          </section>

          {/* ---------------- movers ---------------- */}
          <div className="grid gap-4 lg:grid-cols-3">
            <MoverPanel
              title="Top gainers"
              icon={<TrendingUp className="h-4 w-4 text-gain" />}
              rows={movers.gainers}
              onOpen={setDetail}
            />
            <MoverPanel
              title="Top losers"
              icon={<TrendingDown className="h-4 w-4 text-loss" />}
              rows={movers.losers}
              onOpen={setDetail}
            />
            <MoverPanel
              title="Most volatile"
              icon={<Zap className="h-4 w-4 text-[#ff9f2e]" />}
              rows={movers.volatile}
              onOpen={setDetail}
            />
          </div>
        </main>

        <MarketDetail inst={detail} onClose={() => setDetail(null)} />
        <BottomNav active="markets" />
      </div>
    </AppShell>
  );
}

/* ------------------------------ sub-views ------------------------------ */

function FilterChip({
  active,
  onClick,
  children,
  color,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
        active ? "border-brand/50 bg-brand/10 text-foreground" : "border-border text-muted hover:text-foreground"
      }`}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
      {children}
    </button>
  );
}

function TableRow({
  row,
  watching,
  onToggleWatch,
  onOpen,
}: {
  row: Row;
  watching: boolean;
  onToggleWatch: () => void;
  onOpen: () => void;
}) {
  const up = row.changePct >= 0;
  return (
    <li className="group flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/50 md:flex-nowrap">
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <InstrumentLogo symbol={row.inst.symbol} kind={row.inst.kind} size={30} />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[13.5px] font-semibold leading-tight">{row.inst.symbol}</span>
            {row.held && (
              <span className="rounded border border-brand/40 px-1 py-px text-[9px] font-bold text-brand">HELD</span>
            )}
            {!row.live && <span className="text-[9px] text-muted">indicative</span>}
          </span>
          <span className="block truncate text-[11.5px] text-muted">{row.inst.name}</span>
        </span>
      </button>

      <span className="hidden w-16 text-right text-[10.5px] font-medium text-muted uppercase md:block">
        {row.inst.kind}
      </span>

      <span className="hidden md:block">
        <Sparkline
          data={row.spark}
          width={72}
          height={26}
          baseline={row.previousClose}
          stroke={up ? "#00c896" : "#f6465d"}
        />
      </span>

      <span className="w-24 text-right">
        <LivePrice inst={row.inst} className="justify-end text-[13.5px] font-semibold" />
      </span>

      <span
        className={`inline-flex w-20 items-center justify-end gap-0.5 ${MONO} text-[13px] font-semibold ${
          up ? "text-gain" : "text-loss"
        }`}
      >
        {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
        {formatPct(row.changePct)}
      </span>

      <span className={`hidden w-20 text-right ${MONO} text-[11.5px] text-muted lg:block`}>
        {(row.spreadPct * 100).toFixed(3)}%
      </span>

      <span className="hidden w-24 text-right text-[11px] lg:block">
        <span className={row.status.open ? "text-gain" : "text-muted"}>{row.status.label}</span>
      </span>

      <span className="flex w-16 items-center justify-end gap-1">
        <button
          onClick={onToggleWatch}
          aria-label={watching ? "Remove from watchlist" : "Add to watchlist"}
          className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
            watching ? "text-gain" : "text-muted hover:text-foreground"
          }`}
        >
          <Star className={`h-3.5 w-3.5 ${watching ? "fill-current" : ""}`} />
        </button>
        <Link
          href={`/trade?symbol=${row.inst.symbol}`}
          aria-label={`Trade ${row.inst.symbol}`}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted transition-colors hover:border-brand/50 hover:text-brand"
        >
          <Zap className="h-3.5 w-3.5" />
        </Link>
      </span>
    </li>
  );
}

function MoverPanel({
  title,
  icon,
  rows,
  onOpen,
}: {
  title: string;
  icon: React.ReactNode;
  rows: Row[];
  onOpen: (inst: Instrument) => void;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface/60">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        {icon}
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      </div>
      <ul className="divide-y divide-border/50">
        {rows.map((r) => (
          <li key={r.inst.symbol}>
            <button
              onClick={() => onOpen(r.inst)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2/50"
            >
              <InstrumentLogo symbol={r.inst.symbol} kind={r.inst.kind} size={24} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold leading-tight">{r.inst.symbol}</span>
                <span className="block truncate text-[11px] text-muted">{r.inst.name}</span>
              </span>
              <span className="text-right">
                <span className={`block ${MONO} text-[13px] font-semibold ${r.changePct >= 0 ? "text-gain" : "text-loss"}`}>
                  {formatPct(r.changePct)}
                </span>
                <span className={`block ${MONO} text-[10.5px] text-muted`}>
                  {formatPrice(r.price, r.inst.kind)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function MarketsPage() {
  return (
    <AppProviders>
      <MarketsInner />
    </AppProviders>
  );
}
