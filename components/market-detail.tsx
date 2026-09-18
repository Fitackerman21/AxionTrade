"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Star, X } from "lucide-react";

import { InstrumentLogo } from "@/components/instrument-logo";
import { LivePrice } from "@/components/live-price";
import { useLiveQuote } from "@/components/live-prices";
import { TIMEFRAMES, type Candle } from "@/lib/candles";
import { useWatchlist } from "@/lib/watchlist";
import { formatPct, formatPrice, type Instrument } from "@/lib/market-data";

interface CandlePayload {
  symbol: string;
  tf: string;
  source: string;
  live: boolean;
  prevClose?: number;
  candles: Candle[];
}

const MONO = "font-mono tabular-nums";

function Stat({ label, value, tone }: { label: string; value: string; tone?: "gain" | "loss" }) {
  return (
    <div className="rounded-xl border border-border bg-background/40 px-3 py-2">
      <p className="text-[10.5px] tracking-wide text-muted uppercase">{label}</p>
      <p
        className={`mt-0.5 ${MONO} text-[13px] font-medium ${
          tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * Instrument detail sheet. Loads real candle history from `/api/candles` for
 * the chosen timeframe, so this is the one place on the page showing genuine
 * OHLC rather than the interpolated tape.
 */
export function MarketDetail({
  inst,
  onClose,
}: {
  inst: Instrument | null;
  onClose: () => void;
}) {
  const [tf, setTf] = useState("1d");
  const [payload, setPayload] = useState<CandlePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const quote = useLiveQuote(inst?.symbol ?? "");
  const { has, toggle } = useWatchlist();

  const symbol = inst?.symbol ?? "";

  useEffect(() => {
    if (!inst) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad response"))))
      .then((j: CandlePayload) => {
        if (!cancelled) setPayload(j);
      })
      .catch(() => {
        if (!cancelled) {
          setPayload(null);
          setFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [inst, symbol, tf]);

  // escape closes the sheet
  useEffect(() => {
    if (!inst) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inst, onClose]);

  const stats = useMemo(() => {
    const candles = payload?.candles ?? [];
    if (candles.length === 0) return null;
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const last = candles[candles.length - 1];
    const first = candles[0];
    const high = Math.max(...highs);
    const low = Math.min(...lows);
    const volume = candles.reduce((a, c) => a + (c.volume || 0), 0);
    return {
      high,
      low,
      last,
      open: first.open,
      periodPct: first.open ? ((last.close - first.open) / first.open) * 100 : 0,
      volume,
      rangePct: low > 0 ? ((high - low) / low) * 100 : 0,
    };
  }, [payload]);

  const path = useMemo(() => {
    const candles = payload?.candles ?? [];
    if (candles.length < 2) return null;
    const closes = candles.map((c) => c.close);
    const min = Math.min(...candles.map((c) => c.low));
    const max = Math.max(...candles.map((c) => c.high));
    const range = max - min || 1;
    const pts = closes.map((v, i) => {
      const x = (i / (closes.length - 1)) * 100;
      const y = 100 - ((v - min) / range) * 96 - 2;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    return { line: `M${pts.join(" L")}`, up: closes[closes.length - 1] >= closes[0] };
  }, [payload]);

  const price = quote?.price ?? inst?.price ?? 0;
  const changePct = quote?.changePct ?? inst?.changePct ?? 0;
  const up = changePct >= 0;

  return (
    <AnimatePresence>
      {inst && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-black/65 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: 40, opacity: 0, scale: 0.99 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border-t border-border bg-surface shadow-[0_-16px_48px_rgba(0,0,0,0.6)] sm:max-w-2xl sm:rounded-2xl sm:border"
          >
            {/* header */}
            <div className="sticky top-0 z-10 border-b border-border bg-surface/95 px-5 py-4 backdrop-blur">
              <div className="flex items-start gap-3">
                <InstrumentLogo symbol={inst.symbol} kind={inst.kind} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-base font-semibold tracking-tight">{inst.symbol}</h2>
                    <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted uppercase">
                      {inst.kind}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted">{inst.name}</p>
                </div>
                <div className="text-right">
                  <LivePrice inst={inst} className="justify-end text-lg font-semibold" />
                  <p className={`${MONO} text-xs font-medium ${up ? "text-gain" : "text-loss"}`}>
                    {formatPct(changePct)} today
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:text-foreground"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-3 flex items-center gap-1">
                {TIMEFRAMES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTf(t.id)}
                    className={`rounded-lg px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors ${
                      tf === t.id ? "bg-brand/12 text-foreground" : "text-muted hover:text-foreground"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
                <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[10px] text-muted">
                  {loading ? (
                    "loading…"
                  ) : failed ? (
                    "unavailable"
                  ) : payload ? (
                    <>
                      <span className={`h-1.5 w-1.5 rounded-full ${payload.live ? "bg-gain" : "bg-muted"}`} />
                      {payload.source} · {payload.candles.length} bars
                    </>
                  ) : null}
                </span>
              </div>
            </div>

            {/* chart */}
            <div className="px-5 pt-4">
              <div className="rounded-2xl border border-border bg-background/40 p-3">
                {path ? (
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-44 w-full" aria-hidden>
                    <defs>
                      <linearGradient id="detailFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={path.up ? "#00c896" : "#f6465d"} stopOpacity="0.28" />
                        <stop offset="100%" stopColor={path.up ? "#00c896" : "#f6465d"} stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path d={`${path.line} L100,100 L0,100 Z`} fill="url(#detailFill)" />
                    <path
                      d={path.line}
                      fill="none"
                      stroke={path.up ? "#00c896" : "#f6465d"}
                      strokeWidth="1.4"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                ) : (
                  <div className="flex h-44 items-center justify-center text-[13px] text-muted">
                    {loading ? "Loading price history…" : failed ? "Price history unavailable." : "No bars returned."}
                  </div>
                )}
              </div>
            </div>

            {/* stats */}
            <div className="grid grid-cols-2 gap-2 px-5 pt-4 sm:grid-cols-4">
              <Stat label="Last" value={formatPrice(price, inst.kind)} />
              <Stat
                label={`${tf} period`}
                value={stats ? `${stats.periodPct >= 0 ? "+" : ""}${stats.periodPct.toFixed(2)}%` : "—"}
                tone={stats ? (stats.periodPct >= 0 ? "gain" : "loss") : undefined}
              />
              <Stat label={`${tf} high`} value={stats ? formatPrice(stats.high, inst.kind) : "—"} />
              <Stat label={`${tf} low`} value={stats ? formatPrice(stats.low, inst.kind) : "—"} />
              <Stat label="Previous close" value={formatPrice(quote?.previousClose ?? 0, inst.kind)} />
              <Stat
                label="Day range"
                value={stats ? `${stats.rangePct.toFixed(2)}%` : "—"}
              />
              <Stat
                label="Volume"
                value={stats && stats.volume > 0 ? stats.volume.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 }) : "—"}
              />
              <Stat label="Feed" value={quote?.live ? "live" : "indicative"} tone={quote?.live ? "gain" : undefined} />
            </div>

            {/* actions */}
            <div className="sticky bottom-0 mt-5 flex items-center gap-2 border-t border-border bg-surface/95 px-5 py-4 backdrop-blur">
              <button
                onClick={() => toggle(inst.symbol)}
                className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[13px] font-semibold transition-colors ${
                  has(inst.symbol)
                    ? "border-gain/40 bg-gain/10 text-gain"
                    : "border-border text-muted hover:text-foreground"
                }`}
              >
                <Star className={`h-4 w-4 ${has(inst.symbol) ? "fill-current" : ""}`} />
                {has(inst.symbol) ? "Watching" : "Watch"}
              </button>
              <Link
                href={`/trade?symbol=${inst.symbol}`}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand to-gain py-2.5 text-sm font-bold text-[#071018]"
              >
                Open in terminal <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
