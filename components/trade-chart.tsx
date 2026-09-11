"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  type CandlestickData,
  type IPriceLine,
  type ISeriesApi,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";

import { useLiveQuote } from "@/components/live-prices";
import { formatPrice, type Instrument } from "@/lib/market-data";
import { TF_MAP, TIMEFRAMES, type Candle } from "@/lib/candles";

interface CandleResp {
  symbol: string;
  tf: string;
  source: string;
  live: boolean;
  candles: Candle[];
}

const GAIN = "#00c896";
const LOSS = "#f6465d";

export function TradeChart({ inst }: { inst: Instrument }) {
  const [tfId, setTfId] = useState("5m");
  const [data, setData] = useState<Candle[] | null>(null);
  const [meta, setMeta] = useState<{ live: boolean; source: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const priceLineRef = useRef<IPriceLine | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const candleMapRef = useRef<Map<number, Candle>>(new Map());

  const quote = useLiveQuote(inst.symbol);
  const livePrice = quote?.price;

  /* ---------------- fetch candles (initial + timeframe changes + refresh) ---------------- */
  const load = useCallback(
    async (symbol: string, tf: string) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/candles?symbol=${symbol}&tf=${tf}`, { cache: "no-store" });
        if (res.ok) {
          const json = (await res.json()) as CandleResp;
          if (json.symbol === symbol && json.tf === tf && Array.isArray(json.candles)) {
            candlesRef.current = json.candles;
            candleMapRef.current = new Map(json.candles.map((c) => [c.time, c]));
            setData(json.candles);
            setMeta({ live: json.live, source: json.source });
          }
        }
      } catch {
        /* keep previous data */
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    setData(null);
    load(inst.symbol, tfId);
    const t = setInterval(() => load(inst.symbol, tfId), 30_000);
    return () => clearInterval(t);
  }, [inst.symbol, tfId, load]);

  /* ---------------- chart lifecycle ---------------- */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#868e96",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(134, 142, 150, 0.06)" },
        horzLines: { color: "rgba(134, 142, 150, 0.06)" },
      },
      rightPriceScale: {
        borderColor: "rgba(134, 142, 150, 0.15)",
        scaleMargins: { top: 0.08, bottom: 0.26 },
      },
      timeScale: {
        borderColor: "rgba(134, 142, 150, 0.15)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(134, 142, 150, 0.35)", labelBackgroundColor: "#23272f" },
        horzLine: { color: "rgba(134, 142, 150, 0.35)", labelBackgroundColor: "#23272f" },
      },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: GAIN,
      downColor: LOSS,
      borderVisible: false,
      wickUpColor: GAIN,
      wickDownColor: LOSS,
    });
    candleSeriesRef.current = candleSeries;

    const volSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "vol",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    volSeriesRef.current = volSeries;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volSeriesRef.current = null;
      priceLineRef.current = null;
    };
  }, []);

  /* ---------------- push data into the chart ---------------- */
  useEffect(() => {
    const cs = candleSeriesRef.current;
    const vs = volSeriesRef.current;
    if (!cs || !vs || !data || data.length === 0) return;

    const candleData: CandlestickData<UTCTimestamp>[] = data.map((c) => ({
      time: c.time as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    cs.setData(candleData);
    vs.setData(
      data.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? "rgba(0, 200, 150, 0.4)" : "rgba(246, 70, 93, 0.4)",
      }))
    );

    priceLineRef.current = cs.createPriceLine({
      price: data[data.length - 1].close,
      color: "#868e96",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "",
    });

    chartRef.current?.timeScale().fitContent();
  }, [data]);

  /* ---------------- live last-candle + price line updates ---------------- */
  useEffect(() => {
    const cs = candleSeriesRef.current;
    const arr = candlesRef.current;
    if (!cs || !livePrice || arr.length === 0) return;

    const last = arr[arr.length - 1];
    // Ignore live prices on a different scale than the candle series
    // (e.g. seeded candles vs. real quotes) — that would draw a fake spike.
    if (Math.abs(livePrice - last.close) / last.close > 0.02) return;

    cs.update({
      time: last.time as UTCTimestamp,
      open: last.open,
      high: Math.max(last.high, livePrice),
      low: Math.min(last.low, livePrice),
      close: livePrice,
    });
    arr[arr.length - 1] = { ...last, close: livePrice };
    candleMapRef.current.set(last.time, arr[arr.length - 1]);
    priceLineRef.current?.applyOptions({ price: livePrice });
  }, [livePrice]);

  /* ---------------- crosshair OHLC legend ---------------- */
  const [legend, setLegend] = useState<Candle | null>(null);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const handler = (param: { time?: unknown }) => {
      if (param.time && typeof param.time === "number") {
        setLegend(candleMapRef.current.get(param.time) ?? null);
      } else {
        setLegend(null);
      }
    };
    chart.subscribeCrosshairMove(handler);
    return () => chart.unsubscribeCrosshairMove(handler);
  }, []);

  const shown = legend ?? data?.[data.length - 1] ?? null;
  const shownUp = shown ? shown.close >= shown.open : true;
  const decimals = inst.kind === "forex" ? 4 : 2;
  const fmtNum = useCallback(
    (v: number) => formatPrice(v, inst.kind),
    [inst.kind]
  );

  const liveBadge = useMemo(() => {
    if (!meta) return null;
    if (meta.live) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-gain/25 bg-gain/8 px-2 py-0.5 text-[10px] font-semibold text-gain">
          <span className="relative inline-flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gain opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-gain" />
          </span>
          LIVE
        </span>
      );
    }
    return (
      <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted">
        Demo candles
      </span>
    );
  }, [meta]);

  return (
    <section className="rounded-2xl border border-border bg-surface/60">
      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5 sm:px-4">
        <div className="flex rounded-lg border border-border bg-background/60 p-0.5">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.id}
              onClick={() => setTfId(tf.id)}
              className={`min-w-9 rounded-md px-2 py-1 text-xs font-semibold transition-colors ${
                tfId === tf.id ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {liveBadge}
          {loading && <span className="text-[11px] text-muted">Loading…</span>}
        </div>
      </div>

      {/* degraded-mode guardrail: never present demo OHLC as live */}
      {meta && !meta.live && (
        <p className="border-b border-border/60 bg-background/40 px-4 py-1.5 text-[11px] text-muted">
          Live OHLC is unavailable for this market right now — showing a simulated series until the
          feed recovers.
        </p>
      )}

      {/* OHLC legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 pt-2 font-mono text-[10px] tabular-nums sm:gap-x-4 sm:px-4 sm:text-[11px]">
        {shown ? (
          <>
            <span className="text-muted">O <span className={shownUp ? "text-gain" : "text-loss"}>{fmtNum(shown.open)}</span></span>
            <span className="text-muted">H <span className={shownUp ? "text-gain" : "text-loss"}>{fmtNum(shown.high)}</span></span>
            <span className="text-muted">L <span className={shownUp ? "text-gain" : "text-loss"}>{fmtNum(shown.low)}</span></span>
            <span className="text-muted">C <span className={shownUp ? "text-gain" : "text-loss"}>{fmtNum(shown.close)}</span></span>
            <span className={shownUp ? "text-gain" : "text-loss"}>
              {shownUp ? "+" : ""}
              {(((shown.close - shown.open) / shown.open) * 100).toFixed(2)}%
            </span>
          </>
        ) : (
          <span className="text-muted">—</span>
        )}
      </div>

      {/* chart canvas — explicit height, chart handles resize */}
      <div ref={containerRef} className="h-[380px] w-full sm:h-[460px]" />

      <p className="px-4 pb-2 text-right text-[10px] text-muted">
        {meta?.live ? `Source: ${meta.source}` : "Simulated data"}
      </p>
    </section>
  );
}
