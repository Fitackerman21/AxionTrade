"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bot,
  ChevronDown,
  ExternalLink,
  Sparkles,
} from "lucide-react";

import { InstrumentLogo } from "@/components/instrument-logo";
import { Sparkline } from "@/components/sparkline";
import { formatPrice, seededSeries } from "@/lib/market-data";
import {
  formatSignedUsd,
  formatUsd,
  KIND_META,
  KIND_ORDER,
  type AssetKind,
  type MarkedPosition,
  type PortfolioView,
} from "@/lib/portfolio";
import { useAccount } from "@/lib/account-store";

type SortKey = "value" | "dayPl" | "pl" | "symbol" | "price";
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey | null; label: string; className: string }[] = [
  { key: "symbol", label: "Instrument", className: "" },
  { key: "price", label: "Price", className: "" },
  { key: "dayPl", label: "Today P/L", className: "" },
  { key: null, label: "Units · Avg cost", className: "" },
  { key: "pl", label: "Total P/L", className: "" },
  { key: "value", label: "Market value", className: "" },
];

/**
 * Desktop grid template — header and every row share these exact tracks
 * (8 of them: instrument, four figures, market value, trend, chevron). The
 * numeric tracks are `auto` rather than fractional: a price like "76,512.73"
 * then always gets its full width and the instrument column absorbs any
 * squeeze instead of the figures being clipped.
 */
const GRID =
  "xl:grid xl:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto_auto_88px_24px] xl:items-center xl:gap-x-3";

export function PositionsTable({ view }: { view: PortfolioView }) {
  const { positions, allocation } = view;
  const { sell } = useAccount();

  const [filter, setFilter] = useState<AssetKind | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [open, setOpen] = useState<string | null>(null);

  const counts = useMemo(
    () => new Map(allocation.map((a) => [a.kind, a.count])),
    [allocation]
  );

  /** stable per-symbol trend series, drawn at the position's live mark */
  const trends = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const p of positions) {
      map.set(p.symbol, seededSeries(`trend-${p.symbol}`, 36, 0.02));
    }
    return map;
  }, [positions]);

  const rows = useMemo(() => {
    const filtered = filter === "all" ? positions : positions.filter((p) => p.kind === filter);
    const out = [...filtered];
    out.sort((a, b) => {
      const va = sortKey === "pl" ? a.unrealizedPl : (a[sortKey] as number | string);
      const vb = sortKey === "pl" ? b.unrealizedPl : (b[sortKey] as number | string);
      const cmp =
        typeof va === "string" ? va.localeCompare(String(vb)) : (va as number) - (vb as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [positions, filter, sortKey, sortDir]);

  const toggleSort = (key: SortKey | null) => {
    if (!key) return;
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "symbol" ? "asc" : "desc");
    }
  };

  const kinds = KIND_ORDER.filter((k) => (counts.get(k) ?? 0) > 0);

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface/60">
      <div className="flex flex-wrap items-center gap-2 px-5 pt-4 pb-3">
        <h2 className="text-sm font-semibold tracking-tight">Positions</h2>
        <span className="text-[11.5px] text-muted">marked live</span>

        <div className="ml-auto flex items-center gap-1.5">
          <ArrowUpDown className="h-3.5 w-3.5 text-muted" />
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            aria-label="Sort positions"
            className="rounded-lg border border-border bg-background/60 px-2 py-1 text-[11.5px] text-foreground outline-none focus:border-brand xl:hidden"
          >
            <option value="value">Market value</option>
            <option value="dayPl">Today P/L</option>
            <option value="pl">Total P/L</option>
            <option value="symbol">Name</option>
          </select>
          <button
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            className="rounded-lg border border-border px-2 py-1 text-[11.5px] text-muted transition-colors hover:text-foreground xl:hidden"
            aria-label="Toggle sort direction"
          >
            {sortDir === "asc" ? "A→Z" : "Z→A"}
          </button>
        </div>
      </div>

      {/* asset-class filters */}
      {kinds.length > 0 && (
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-5 pb-3">
          <FilterChip
            active={filter === "all"}
            onClick={() => setFilter("all")}
            label="All"
            count={positions.length}
          />
          {kinds.map((k) => (
            <FilterChip
              key={k}
              active={filter === k}
              onClick={() => setFilter(k)}
              label={KIND_META[k].label}
              count={counts.get(k) ?? 0}
              color={KIND_META[k].color}
            />
          ))}
        </div>
      )}

      {positions.length === 0 ? (
        <EmptyBook />
      ) : (
        <>
          {/* desktop header */}
          <div className={`hidden border-y border-border bg-background/40 ${GRID} px-5 py-2 text-[11px] text-muted`}>
            {COLUMNS.map((c, i) => (
              <button
                key={i}
                onClick={() => toggleSort(c.key)}
                disabled={!c.key}
                className={`flex items-center gap-1 ${i > 0 ? "justify-end" : "text-left"} ${
                  c.key ? "transition-colors hover:text-foreground" : "cursor-default"
                } ${c.className}`}
              >
                {c.label}
                {c.key && sortKey === c.key && (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
              </button>
            ))}
            <span className="text-right">30d</span>
            <span />
          </div>

          <ul aria-label="Open positions" className="divide-y divide-border/50">
            {rows.map((p) => (
              <PositionRow
                key={p.symbol}
                p={p}
                trend={trends.get(p.symbol) ?? []}
                open={open === p.symbol}
                onToggle={() => setOpen((s) => (s === p.symbol ? null : p.symbol))}
                onClose={() => {
                  sell(p.symbol, p.qty, p.price);
                  setOpen(null);
                }}
              />
            ))}
          </ul>

          {rows.length === 0 && (
            <p className="border-t border-border/50 px-5 py-8 text-center text-[13px] text-muted">
              No {filter === "all" ? "" : `${KIND_META[filter as AssetKind].label.toLowerCase()} `}
              positions in the book.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------- one row ------------------------------- */

function PositionRow({
  p,
  trend,
  open,
  onToggle,
  onClose,
}: {
  p: MarkedPosition;
  trend: number[];
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const [confirmClose, setConfirmClose] = useState(false);
  const meta = KIND_META[p.kind];
  const dayUp = p.dayPl >= 0;
  const totalUp = p.unrealizedPl >= 0;
  const series = trend.length ? trend.map((v) => v * p.price) : [];

  return (
    <li className={open ? "bg-surface-2/40" : ""}>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        aria-expanded={open}
        className={`cursor-pointer px-5 py-3.5 transition-colors hover:bg-surface-2/50 ${GRID} outline-none focus-visible:bg-surface-2/60`}
      >
        {/* instrument */}
        <div className="flex min-w-0 items-center gap-3">
          <InstrumentLogo symbol={p.symbol} kind={p.kind} size={36} />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[13.5px] leading-tight font-semibold">
              <span className="truncate">{p.symbol}</span>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: meta.color }} />
              {p.source === "ai" && <Bot className="h-3 w-3 shrink-0 text-gain" />}
            </p>
            <p className="mt-0.5 max-w-[190px] truncate text-[11.5px] leading-tight text-muted">{p.name}</p>
          </div>

          {/* mobile value, aligned right inside the instrument block */}
          <div className="ml-auto text-right xl:hidden">
            <p className="font-mono text-[13.5px] font-semibold tabular-nums">{formatUsd(p.value, 0)}</p>
            <p className={`font-mono text-[11.5px] font-medium tabular-nums ${totalUp ? "text-gain" : "text-loss"}`}>
              {formatSignedUsd(p.unrealizedPl, 0)}
              <span className="ml-1 opacity-80">
                {p.unrealizedPct >= 0 ? "+" : "−"}
                {Math.abs(p.unrealizedPct).toFixed(2)}%
              </span>
            </p>
          </div>
        </div>

        {/* mobile second line: qty, avg cost, today */}
        <p className="mt-1 text-[11.5px] text-muted xl:hidden">
          {fmtUnits(p.qty)} units @ {formatPrice(p.avgCost, p.kind)} ·{" "}
          <span className={dayUp ? "text-gain" : "text-loss"}>
            today {formatSignedUsd(p.dayPl)}
          </span>
        </p>

        {/* desktop cells */}
        <div className="hidden text-right xl:block">
          <p className="font-mono text-[13px] tabular-nums">{formatPrice(p.price, p.kind)}</p>
          <p className={`font-mono text-[11.5px] tabular-nums ${dayUp ? "text-gain" : "text-loss"}`}>
            {p.changePct >= 0 ? "+" : "−"}
            {Math.abs(p.changePct).toFixed(2)}%
          </p>
        </div>

        <div className={`hidden text-right font-mono text-[13px] tabular-nums xl:block ${dayUp ? "text-gain" : "text-loss"}`}>
          {formatSignedUsd(p.dayPl, 0)}
        </div>

        <div className="hidden text-right xl:block">
          <p className="font-mono text-[13px] tabular-nums">{fmtUnits(p.qty)}</p>
          <p className="font-mono text-[11.5px] tabular-nums text-muted">
            @ {formatPrice(p.avgCost, p.kind)}
          </p>
        </div>

        <div className="hidden text-right xl:block">
          <p className={`font-mono text-[13px] font-medium tabular-nums ${totalUp ? "text-gain" : "text-loss"}`}>
            {formatSignedUsd(p.unrealizedPl, 0)}
          </p>
          <p className={`font-mono text-[11.5px] tabular-nums ${totalUp ? "text-gain" : "text-loss"} opacity-80`}>
            {p.unrealizedPct >= 0 ? "+" : "−"}
            {Math.abs(p.unrealizedPct).toFixed(2)}%
          </p>
        </div>

        <div className="hidden text-right xl:block">
          <p className="font-mono text-[13px] tabular-nums">{formatUsd(p.value, 0)}</p>
          <p className="mt-1 flex items-center justify-end gap-1.5">
            <span className="h-1 w-14 overflow-hidden rounded-full bg-border">
              <span className="block h-full rounded-full bg-brand/70" style={{ width: `${Math.max(3, p.weight * 100)}%` }} />
            </span>
            <span className="font-mono text-[11px] tabular-nums text-muted">
              {(p.weight * 100).toFixed(1)}%
            </span>
          </p>
        </div>

        <div className="hidden justify-end xl:flex">
          {series.length > 0 && <Sparkline data={series} width={84} height={28} />}
        </div>

        <ChevronDown
          className={`ml-auto h-4 w-4 shrink-0 text-muted transition-transform xl:ml-0 xl:justify-self-end ${
            open ? "rotate-180" : ""
          }`}
        />
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border bg-background/40 p-3.5 sm:grid-cols-4">
                <Fact label="Cost basis" value={formatUsd(p.costBasis)} />
                <Fact label="Market value" value={formatUsd(p.value)} />
                <Fact label="Average cost" value={formatPrice(p.avgCost, p.kind)} mono />
                <Fact label="Weight of book" value={`${(p.weight * 100).toFixed(2)}%`} mono />
                <Fact
                  label="Opened"
                  value={
                    p.openedAt > 0
                      ? new Date(p.openedAt).toLocaleDateString("en-US", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : "Long-held"
                  }
                />
                <Fact label="Asset class" value={meta.label} />
                <Fact
                  label="Acquired via"
                  value={p.source === "ai" ? "AxAI engine" : "Manual order"}
                  icon={p.source === "ai" ? <Sparkles className="h-3 w-3 text-gain" /> : undefined}
                />
                <Fact label="Prev. close" value={formatPrice(p.previousClose, p.kind)} mono />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Link
                  href={`/trade?symbol=${p.symbol}`}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-brand to-gain px-3.5 py-2 text-[12.5px] font-bold text-[#071018] transition-transform active:scale-[0.98]"
                >
                  Trade {p.symbol}
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>

                {confirmClose ? (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onClose();
                        setConfirmClose(false);
                      }}
                      className="rounded-xl border border-loss/50 bg-loss/12 px-3.5 py-2 text-[12.5px] font-semibold text-loss"
                    >
                      Confirm — sell {fmtUnits(p.qty)} units
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmClose(false);
                      }}
                      className="rounded-xl border border-border px-3.5 py-2 text-[12.5px] font-semibold text-muted"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmClose(true);
                    }}
                    className="rounded-xl border border-border px-3.5 py-2 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-surface-2"
                  >
                    Close position
                  </button>
                )}

                <span className="ml-auto hidden text-[11.5px] text-muted sm:block">
                  Closing sells the full position at the live mark.
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

/* ------------------------------ small parts ------------------------------ */

function FilterChip({
  active,
  onClick,
  label,
  count,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
        active
          ? "border-brand/50 bg-brand/12 text-foreground"
          : "border-border text-muted hover:text-foreground"
      }`}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
      {label}
      <span className="font-mono tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function Fact({
  label,
  value,
  mono,
  icon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <p className="inline-flex items-center gap-1 text-[11px] text-muted">
        {icon}
        {label}
      </p>
      <p className={`mt-0.5 text-[13px] font-medium ${mono ? "font-mono tabular-nums" : ""}`}>{value}</p>
    </div>
  );
}

function EmptyBook() {
  return (
    <div className="border-t border-border/50 px-5 py-10 text-center">
      <p className="text-[13.5px] font-medium">No open positions</p>
      <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-muted">
        Buy an instrument on the trade screen, or hand funds to the AxAI engine and let it build the
        book for you.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link
          href="/trade"
          className="rounded-xl bg-gradient-to-r from-brand to-gain px-4 py-2 text-[12.5px] font-bold text-[#071018]"
        >
          Open the trade screen
        </Link>
        <Link
          href="/account"
          className="rounded-xl border border-border px-4 py-2 text-[12.5px] font-semibold text-foreground"
        >
          Add funds
        </Link>
      </div>
    </div>
  );
}

/** Units read cleanly at a glance: never more than 4dp, never trailing zeros. */
function fmtUnits(qty: number) {
  return qty.toLocaleString("en-US", { maximumFractionDigits: 4 });
}
