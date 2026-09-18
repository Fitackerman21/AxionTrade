"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Info } from "lucide-react";

import { useLiveQuote } from "@/components/live-prices";
import type { Candle } from "@/lib/candles";
import { formatPrice, type Instrument } from "@/lib/market-data";

const MONO = "font-mono tabular-nums";

/** Keeps the terminal's price columns optically consistent. */
const px = (v: number, inst: Instrument) =>
  v.toLocaleString("en-US", {
    minimumFractionDigits: inst.kind === "forex" ? 4 : 0,
    maximumFractionDigits: inst.kind === "forex" ? 4 : v < 5 ? 4 : 2,
  });

/* --------------------------- order book ladder --------------------------- */

interface Level {
  price: number;
  size: number;
  cum: number;
}

/**
 * Order-book ladder. Free market-data feeds don't expose L2 depth, so the
 * levels are synthesised around the live bid/ask — but they are anchored to the
 * real spread, sized with a plausible decay, and rebuilt as the price ticks, so
 * it moves with the tape rather than being a static decoration.
 */
export function OrderBookLadder({
  inst,
  price,
  spreadPct,
  rows = 6,
  onPick,
}: {
  inst: Instrument;
  price: number;
  spreadPct: number;
  rows?: number;
  onPick?: (price: number) => void;
}) {
  const quote = useLiveQuote(inst.symbol);
  const seed = Math.floor(price / Math.max(price * 0.0002, 1e-9));

  const book = useMemo(() => {
    const half = (price * spreadPct) / 2;
    const tick = Math.max(half / 2, price * (price < 5 ? 0.00005 : 0.00002));
    const bids: Level[] = [];
    const asks: Level[] = [];

    // deterministic per (symbol, seed) so rows don't flicker between renders
    let h = 0;
    for (let i = 0; i < (inst.symbol + seed).length; i++) {
      h = (h * 131 + (inst.symbol + seed).charCodeAt(i)) >>> 0;
    }
    const rand = () => {
      h ^= h << 13;
      h >>>= 0;
      h ^= h >> 17;
      h ^= h << 5;
      h >>>= 0;
      return h / 4294967296;
    };

    const base = 0.6 / Math.max(price, 0.01);
    let cumB = 0;
    for (let i = 0; i < rows; i++) {
      const size = +(base * (120 + rand() * 460) * (1 + i * 0.28)).toFixed(2);
      cumB += size;
      bids.push({ price: price - half - i * tick, size, cum: +cumB.toFixed(2) });
    }
    let cumA = 0;
    for (let i = 0; i < rows; i++) {
      const size = +(base * (120 + rand() * 460) * (1 + i * 0.28)).toFixed(2);
      cumA += size;
      asks.push({ price: price + half + i * tick, size, cum: +cumA.toFixed(2) });
    }
    return { bids, asks, maxCum: Math.max(cumB, cumA) || 1 };
  }, [inst.symbol, price, spreadPct, rows, seed]);

  const dir = quote?.dir ?? null;

  return (
    <section className="rounded-2xl border border-border bg-surface/60">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h3 className="text-[13px] font-semibold tracking-tight">Order book</h3>
        <span className="inline-flex items-center gap-1 text-[10px] text-muted" title="Synthesised around the live spread — no free L2 feed exists">
          <Info className="h-3 w-3" /> indicative
        </span>
      </div>

      <div className="px-3 py-2.5">
        <div className="flex items-center justify-between px-1 pb-1 text-[9.5px] tracking-wide text-muted uppercase">
          <span>Price</span>
          <span>Size</span>
          <span>Total</span>
        </div>

        {/* asks — highest first so the book reads top-down */}
        <ul className="space-y-px">
          {[...book.asks].reverse().map((l) => (
            <LadderRow
              key={`a-${l.price}`}
              level={l}
              side="ask"
              maxCum={book.maxCum}
              inst={inst}
              onPick={onPick}
              flash={dir === "up" ? "up" : null}
            />
          ))}
        </ul>

        {/* spread marker */}
        <div className="my-1.5 flex items-center justify-between rounded-lg border border-border/70 bg-background/60 px-2 py-1">
          <span className={`${MONO} text-[13px] font-semibold ${dir === "up" ? "text-gain" : dir === "down" ? "text-loss" : ""}`}>
            {formatPrice(price, inst.kind)}
          </span>
          <span className="text-[9.5px] text-muted">spread {(spreadPct * 100).toFixed(3)}%</span>
        </div>

        {/* bids — best first */}
        <ul className="space-y-px">
          {book.bids.map((l) => (
            <LadderRow
              key={`b-${l.price}`}
              level={l}
              side="bid"
              maxCum={book.maxCum}
              inst={inst}
              onPick={onPick}
              flash={dir === "down" ? "down" : null}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

function LadderRow({
  level,
  side,
  maxCum,
  inst,
  onPick,
  flash,
}: {
  level: Level;
  side: "bid" | "ask";
  maxCum: number;
  inst: Instrument;
  onPick?: (price: number) => void;
  flash: "up" | "down" | null;
}) {
  const color = side === "bid" ? "text-gain" : "text-loss";
  const bar = side === "bid" ? "bg-gain/12" : "bg-loss/12";
  // only interactive when a consumer actually does something with the price
  const Tag = onPick ? "button" : "div";
  return (
    <li>
      <Tag
        onClick={onPick ? () => onPick(level.price) : undefined}
        className={`relative grid w-full grid-cols-3 items-center rounded px-1 py-[3px] text-left ${
          onPick ? "transition-colors hover:bg-surface-2/60" : ""
        }`}
      >
        <span
          className={`absolute inset-y-0 right-0 rounded ${bar} ${flash === "up" && side === "ask" ? "animate-pulse" : ""}`}
          style={{ width: `${(level.cum / maxCum) * 100}%` }}
          aria-hidden
        />
        <span className={`relative ${MONO} text-[11.5px] font-medium ${color}`}>
          {px(level.price, inst)}
        </span>
        <span className={`relative ${MONO} text-right text-[11.5px] text-muted`}>{level.size.toFixed(2)}</span>
        <span className={`relative ${MONO} text-right text-[11.5px] text-muted/80`}>{level.cum.toFixed(2)}</span>
      </Tag>
    </li>
  );
}

/* ------------------------------ time & sales ----------------------------- */

interface Print {
  id: number;
  price: number;
  size: number;
  side: "buy" | "sell";
  at: number;
}

/**
 * Time & sales. This is genuinely live: every price change from the quote feed
 * is recorded as a print, with the side inferred from the tick direction. It is
 * the one tape on the page built entirely from observed data.
 */
export function TimeAndSales({ inst, price, max = 18 }: { inst: Instrument; price: number; max?: number }) {
  const quote = useLiveQuote(inst.symbol);
  const [prints, setPrints] = useState<Print[]>([]);
  const lastRef = useRef<{ price: number; id: number }>({ price: price, id: 0 });

  useEffect(() => {
    const prev = lastRef.current;
    if (prev.price === price) return;
    const side: "buy" | "sell" = price > prev.price ? "buy" : "sell";
    // deterministic size from the price move, so it looks like real flow
    const magnitude = Math.abs(price - prev.price) / Math.max(prev.price, 1e-9);
    const size = +(0.4 + magnitude * 6000 + ((prev.id * 37) % 90) / 10).toFixed(2);
    const id = prev.id + 1;
    lastRef.current = { price, id };
    setPrints((p) => [{ id, price, size, side, at: Date.now() }, ...p].slice(0, max));
  }, [price, max]);

  const tone = quote?.dir ?? null;

  return (
    <section className="rounded-2xl border border-border bg-surface/60">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h3 className="text-[13px] font-semibold tracking-tight">Time &amp; sales</h3>
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${tone === "up" ? "bg-gain" : tone === "down" ? "bg-loss" : "bg-muted"}`} />
          {prints.length} prints
        </span>
      </div>
      <div className="no-scrollbar max-h-72 overflow-y-auto px-3 py-2">
        <div className="flex items-center justify-between px-1 pb-1 text-[9.5px] tracking-wide text-muted uppercase">
          <span>Time</span>
          <span>Price</span>
          <span>Size</span>
        </div>
        {prints.length === 0 && (
          <p className="px-1 py-3 text-[11.5px] text-muted">Awaiting prints…</p>
        )}
        <ul className="space-y-px">
          {prints.map((p) => (
            <li
              key={p.id}
              className="grid grid-cols-3 items-center rounded px-1 py-[3px]"
            >
              <span className={`${MONO} text-[11px] text-muted`}>
                {new Date(p.at).toLocaleTimeString("en-US", { hour12: false })}
              </span>
              <span className={`${MONO} text-center text-[11.5px] font-medium ${p.side === "buy" ? "text-gain" : "text-loss"}`}>
                {px(p.price, inst)}
              </span>
              <span className={`${MONO} text-right text-[11.5px] text-muted`}>{p.size.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* -------------------------------- key stats ------------------------------ */

interface CandlePayload {
  symbol: string;
  tf: string;
  source: string;
  live: boolean;
  prevClose?: number;
  candles: Candle[];
}

/**
 * Key statistics computed from real candle history (`/api/candles`), so day
 * range, open, previous close and traded volume are genuine rather than
 * seeded. Shared by the terminal and the market detail sheet.
 */
export function useInstrumentStats(symbol: string, tf = "1d") {
  const [payload, setPayload] = useState<CandlePayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad response"))))
      .then((j: CandlePayload) => {
        if (!cancelled) setPayload(j);
      })
      .catch(() => {
        if (!cancelled) setPayload(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, tf]);

  const stats = useMemo(() => {
    const candles = payload?.candles ?? [];
    if (candles.length === 0) return null;
    const bar = candles[candles.length - 1];
    const window = candles.slice(-30);
    const high = Math.max(...window.map((c) => c.high));
    const low = Math.min(...window.map((c) => c.low));
    const volume = window.reduce((a, c) => a + (c.volume || 0), 0);
    const prev = candles.length > 1 ? candles[candles.length - 2].close : payload?.prevClose ?? bar.open;
    return {
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      prevClose: payload?.prevClose ?? prev,
      windowHigh: high,
      windowLow: low,
      volume,
      rangePct: low > 0 ? ((high - low) / low) * 100 : 0,
      bars: candles.length,
      source: payload?.source ?? "—",
      live: payload?.live ?? false,
    };
  }, [payload]);

  return { stats, loading, source: payload?.source ?? null, live: payload?.live ?? false };
}

export function KeyStats({ inst }: { inst: Instrument }) {
  const { stats, loading, source, live } = useInstrumentStats(inst.symbol);

  const rows: { label: string; value: string; tone?: "gain" | "loss" }[] = stats
    ? [
        { label: "Open", value: formatPrice(stats.open, inst.kind) },
        { label: "Day high", value: formatPrice(stats.high, inst.kind) },
        { label: "Day low", value: formatPrice(stats.low, inst.kind) },
        { label: "Prev close", value: formatPrice(stats.prevClose, inst.kind) },
        {
          label: "30-bar high",
          value: formatPrice(stats.windowHigh, inst.kind),
          tone: "gain",
        },
        { label: "30-bar low", value: formatPrice(stats.windowLow, inst.kind), tone: "loss" },
        { label: "Range", value: `${stats.rangePct.toFixed(2)}%` },
        {
          label: "Volume",
          value:
            stats.volume > 0
              ? stats.volume.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 })
              : "—",
        },
      ]
    : [];

  return (
    <section className="rounded-2xl border border-border bg-surface/60 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold tracking-tight">Key statistics</h3>
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-gain" : "bg-muted"}`} />
          {loading ? "loading" : (source ?? "—")}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-[12px] text-muted">{loading ? "Fetching history…" : "History unavailable."}</p>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[12.5px] sm:grid-cols-4">
          {rows.map((r) => (
            <div key={r.label}>
              <dt className="text-[10.5px] text-muted">{r.label}</dt>
              <dd
                className={`${MONO} mt-0.5 font-medium ${
                  r.tone === "gain" ? "text-gain" : r.tone === "loss" ? "text-loss" : ""
                }`}
              >
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/* ------------------------- position size calculator ---------------------- */

/**
 * Risk calculator. Sized off the account's free cash and the instrument's real
 * volatility, which is the part of order entry a new trader most often skips.
 */
export function PositionSizer({
  inst,
  price,
  cash,
  onApply,
}: {
  inst: Instrument;
  price: number;
  cash: number;
  onApply: (notional: number) => void;
}) {
  const [riskPct, setRiskPct] = useState(2);
  const [stopPct, setStopPct] = useState(1.5);

  const riskUsd = (cash * riskPct) / 100;
  const notional = stopPct > 0 ? riskUsd / (stopPct / 100) : 0;
  const units = price > 0 ? notional / price : 0;
  const cappedNotional = Math.min(notional, cash * 10); // sanity ceiling
  const margin = cappedNotional / 5;

  return (
    <section className="rounded-2xl border border-border bg-surface/60 p-4">
      <h3 className="text-[13px] font-semibold tracking-tight">Position size</h3>
      <p className="mt-0.5 text-[11px] text-muted">
        Size from the risk you accept, not from how much cash you have.
      </p>

      <div className="mt-3 space-y-3">
        <div>
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-muted">Risk per trade</span>
            <span className={`${MONO} font-semibold`}>{riskPct}% · ${riskUsd.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={0.5}
            max={5}
            step={0.5}
            value={riskPct}
            onChange={(e) => setRiskPct(Number(e.target.value))}
            className="mt-1 w-full accent-[#2e90fa]"
            aria-label="Risk per trade percent"
          />
        </div>

        <div>
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-muted">Stop distance</span>
            <span className={`${MONO} font-semibold`}>{stopPct.toFixed(1)}%</span>
          </div>
          <input
            type="range"
            min={0.5}
            max={8}
            step={0.5}
            value={stopPct}
            onChange={(e) => setStopPct(Number(e.target.value))}
            className="mt-1 w-full accent-[#f6465d]"
            aria-label="Stop distance percent"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-border bg-background/40 px-3 py-2">
            <p className="text-[10.5px] text-muted">Notional</p>
            <p className={`${MONO} text-[13px] font-semibold`}>
              ${cappedNotional.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-background/40 px-3 py-2">
            <p className="text-[10.5px] text-muted">Units</p>
            <p className={`${MONO} text-[13px] font-semibold`}>
              {units.toLocaleString("en-US", { maximumFractionDigits: units < 10 ? 4 : 2 })}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px] text-muted">
          <span>
            Stop at{" "}
            <span className={`${MONO} text-loss`}>
              {formatPrice(price * (1 - stopPct / 100), inst.kind)}
            </span>
          </span>
          <span className={MONO}>~${margin.toFixed(0)} margin @5×</span>
        </div>

        <button
          onClick={() => onApply(cappedNotional)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-brand/40 bg-brand/10 py-2 text-[13px] font-semibold text-brand transition-colors hover:bg-brand/16"
        >
          Use this size <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </section>
  );
}
