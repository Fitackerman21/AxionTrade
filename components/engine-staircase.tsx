"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useLivePrices, useLiveQuote } from "@/components/live-prices";
import { BookStrip, SessionTrack } from "@/components/trade-chart";
import { sessionOpenPositions, type LiveContext, type OpenPosition } from "@/lib/ai-trader";
import { useAiSession } from "@/lib/ai-session";
import { formatPrice, type Instrument } from "@/lib/market-data";

/**
 * The trade pane's chart, in the jev-loop style.
 *
 * Where the pane used to draw a racing arrow, this draws the instrument's
 * price as a **staircase** — one sample per cadence, each sample stepping to
 * its own level (`H… V…`, the same path the jev-loop dashboard renders). Every
 * fill the AxAI engine books is pinned on the trail: green for a long, red for
 * a short, amber for a tick that carried no decision.
 *
 * Nothing here decides anything. The engine stays in charge — this pane only
 * reads `useAiSession()` and the instrument's live quote, and it is sized from
 * its own measured box so it fills whatever space the chart slot gives it
 * instead of stretching a viewBox and going out of shape.
 */

/** One sample per cadence, the way the jev dashboard ticks every tick_seconds. */
const STEP_MS = 2000;
/** Samples the window holds — the dashboard's N. */
const WINDOW_POINTS = 90;
/** Real recorded closes pre-rolled so the pane has a price path at once. */
const CONTEXT_POINTS = 12;
/** Room for the price axis on the right. */
const PAD_RIGHT = 88;
const PAD_TOP = 12;
const PAD_BOTTOM = 16;

const GAIN = "#00c896";
const LOSS = "#f6465d";
const AMBER = "#e0a94a";
const MUTED = "#868e96";
const LINE = "#2e90fa";

export type StairSide = "buy" | "sell" | "late";

const SIDE_COLOUR: Record<StairSide, string> = {
  buy: GAIN,
  sell: LOSS,
  late: AMBER,
};

interface Step {
  mid: number;
  /** the decision this sample carried, or null for a plain market sample */
  side: StairSide | null;
}

/** Axis labels have to stay short enough to sit beside the tag at any scale. */
function axisLabel(v: number, kind: Instrument["kind"]): string {
  if (kind === "forex") return v.toFixed(4);
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (v >= 1) return v.toFixed(2);
  return v.toPrecision(4);
}

/**
 * A one-symbol quote from our own proxy. The shared quote context carries
 * crypto over a websocket only, so quoting ourselves over REST is what keeps
 * the staircase stepping when that socket is unavailable.
 */
async function fetchMid(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(symbol)}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { quotes?: Array<{ symbol?: string; price?: number }> };
    const hit = (data.quotes ?? []).find((q) => q.symbol?.toUpperCase() === symbol.toUpperCase());
    const price = hit?.price;
    return typeof price === "number" && Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

/** Element size, so the SVG draws in real pixels instead of a stretched viewBox. */
function useBoxSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ w: rect.width, h: rect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/* ----------------------------- the chart ------------------------------ */

function Staircase({ series, inst }: { series: Step[]; inst: Instrument }) {
  const [boxRef, box] = useBoxSize<HTMLDivElement>();
  const W = Math.max(240, box.w || 640);
  const H = Math.max(160, box.h || 320);

  const chart = useMemo(() => {
    const pts = series.slice(-WINDOW_POINTS);
    const mids = pts.map((p) => p.mid);
    const lo = mids.length ? Math.min(...mids) : 0;
    const hi = mids.length ? Math.max(...mids) : 0;
    const span = Math.max(hi - lo, lo * 0.0001) || 1;
    // X spans the samples actually held, not the 90 slots the window could
    // hold: a fresh pane has a handful of points, and cramming them into the
    // last few pixels against the axis is what made the old pane unreadable.
    const visible = Math.max(1, pts.length - 1);
    const X = (i: number) => (i * (W - PAD_RIGHT)) / visible;
    const Y = (v: number) => PAD_TOP + (H - PAD_BOTTOM - PAD_TOP) * (1 - (v - lo) / span);

    let d = "";
    pts.forEach((p, i) => {
      const x = X(i).toFixed(1);
      const y = Y(p.mid).toFixed(1);
      d += d ? ` H${x} V${y}` : `M${x} ${y}`;
    });

    const grid = [0, 1, 2, 3].map((k) => {
      const v = lo + (span * k) / 3;
      return { v, y: Y(v) };
    });

    const dots: Array<{ key: string; cx: number; cy: number; fill: string }> = [];
    pts.forEach((p, i) => {
      if (p.side) dots.push({ key: `${i}`, cx: X(i), cy: Y(p.mid), fill: SIDE_COLOUR[p.side] });
    });

    const last = pts[pts.length - 1];
    return {
      points: pts.length,
      d,
      grid,
      dots,
      area: pts.length > 1 ? `${d} V${H - PAD_BOTTOM} H0 Z` : "",
      lastX: pts.length ? X(pts.length - 1) : 0,
      lastY: last ? Y(last.mid) : 0,
      lastMid: last ? last.mid : 0,
      lastHasSide: !!(last && last.side),
      lastFill: last && last.side ? SIDE_COLOUR[last.side] : "#2b3440",
    };
  }, [series, W, H]);

  const tag = axisLabel(chart.lastMid, inst.kind);
  const tagW = Math.max(70, tag.length * 7.2 + 18);

  return (
    <div ref={boxRef} className="relative h-[320px] w-full overflow-hidden sm:h-[400px]">
      <svg
        className="absolute inset-0"
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${inst.symbol} price staircase, one point every two seconds`}
      >
        <defs>
          <linearGradient id="stairArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="rgba(46,144,250,.16)" />
            <stop offset="1" stopColor="rgba(46,144,250,0)" />
          </linearGradient>
        </defs>

        {chart.grid.map((g) => (
          <g key={g.y}>
            <line
              x1={0}
              x2={W - PAD_RIGHT}
              y1={g.y}
              y2={g.y}
              stroke="rgba(134,142,150,.16)"
              strokeDasharray="3 4"
            />
            <text
              x={W - PAD_RIGHT + 8}
              y={g.y + 3.5}
              fontSize={9.5}
              fill={MUTED}
              fontFamily="ui-monospace, monospace"
            >
              {axisLabel(g.v, inst.kind)}
            </text>
          </g>
        ))}

        {chart.points > 1 && (
          <>
            <path d={chart.area} fill="url(#stairArea)" />
            <path d={chart.d} fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" />
          </>
        )}

        {chart.dots.map((dot) => (
          <circle key={dot.key} cx={dot.cx} cy={dot.cy} r={3.6} fill={dot.fill} stroke="#0d1117" strokeWidth={1.2} />
        ))}

        {chart.points > 0 && (
          <>
            <line
              x1={chart.lastX}
              x2={chart.lastX}
              y1={chart.lastY}
              y2={H - PAD_BOTTOM}
              stroke="rgba(134,142,150,.3)"
              strokeDasharray="2 3"
            />
            <circle cx={chart.lastX} cy={chart.lastY} r={5.5} fill={chart.lastFill} stroke="#0d1117" strokeWidth={1.5} />
            <rect x={chart.lastX + 10} y={chart.lastY - 11} rx={10} width={tagW} height={22} fill={chart.lastFill} />
            <text
              x={chart.lastX + 19}
              y={chart.lastY + 4}
              fontSize={11}
              fill={chart.lastHasSide ? "#0d1117" : "#eaecef"}
              fontFamily="ui-monospace, monospace"
              fontWeight={700}
            >
              {tag}
            </text>
          </>
        )}
      </svg>

      {chart.points < 2 && (
        <span className="absolute inset-0 flex items-center justify-center text-[11px] text-muted">
          Building the staircase…
        </span>
      )}
    </div>
  );
}

/* ------------------------------ the pane ------------------------------ */

export function EngineStaircase({
  inst,
  onSelect,
}: {
  inst: Instrument;
  /** hand over a symbol from the book strip, so the pane doubles as a scanner */
  onSelect?: (symbol: string) => void;
}) {
  const { session, fng, lastTrade } = useAiSession();
  const quote = useLiveQuote(inst.symbol);
  const { quotes } = useLivePrices();

  const [series, setSeries] = useState<Step[]>([]);

  const seriesRef = useRef<Step[]>([]);
  /** the decision the next sample carries, set when a fill lands */
  const markRef = useRef<StairSide | null>(null);
  const markIdRef = useRef<string | null>(null);
  const quoteRef = useRef<number | null>(null);

  const positions = useMemo<OpenPosition[]>(() => {
    if (!session || session.phase === "idle") return [];
    const live: LiveContext = {
      quoteFor: (symbol) => {
        const q = quotes.get(symbol);
        return q ? { price: q.price, changePct: q.changePct } : undefined;
      },
      fng,
    };
    return sessionOpenPositions(session, live, 6);
  }, [session, quotes, fng]);

  /* the live quote is read at sample time, never during render */
  useEffect(() => {
    if (quote) quoteRef.current = quote.price;
  }, [quote]);

  /* a fresh fill marks the next sample: green for a long, red for a short */
  useEffect(() => {
    const id = lastTrade?.id ?? null;
    if (!id || id === markIdRef.current) return;
    markIdRef.current = id;
    markRef.current = lastTrade && lastTrade.dir === "SHORT" ? "sell" : "buy";
  }, [lastTrade]);

  /* Pre-roll: real recorded closes from our own candle proxy, so the pane has
     a price path on it before the loop has a history of its own. Context, not
     a decision — the points carry no fill dot. */
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/candles?symbol=${encodeURIComponent(inst.symbol)}&tf=1m`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { candles?: Array<{ close: number }> };
        const closes = (data.candles ?? [])
          .map((c) => c.close)
          .filter((c) => Number.isFinite(c) && c > 0)
          .slice(-CONTEXT_POINTS);
        if (!alive || closes.length < 2) return;
        seriesRef.current = closes.map((mid) => ({ mid, side: null }));
      } catch {
        /* no context is survivable: the pane's own samples still draw the line */
      }
    })();
    return () => {
      alive = false;
    };
  }, [inst.symbol]);

  useEffect(() => {
    const sample = async () => {
      const fresh = await fetchMid(inst.symbol);
      const mid = fresh ?? quoteRef.current ?? inst.price;
      if (!(mid > 0)) return;
      const side = markRef.current;
      markRef.current = null;
      const next = [...seriesRef.current, { mid, side }].slice(-WINDOW_POINTS);
      seriesRef.current = next;
      setSeries(next);
    };
    const first = setTimeout(() => void sample(), 300);
    const timer = setInterval(() => void sample(), STEP_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [inst.symbol, inst.price]);

  const engineLive = session?.phase === "running";
  const price = quote?.price ?? inst.price;
  const up = quote?.dir === "up" || (quote?.dir == null && inst.changePct >= 0);
  const fills = useMemo(
    () => (session ? session.trades.filter((t) => t.at <= session.clockMs).length : 0),
    [session],
  );

  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-surface/60">
      {/* header — what this pane is, what is driving it, and the price behind it */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="relative flex h-2 w-2 shrink-0">
            {engineLive && <span className="absolute h-full w-full animate-ping rounded-full bg-gain opacity-70" />}
            <span className={`relative h-2 w-2 rounded-full ${engineLive ? "bg-gain" : "bg-muted"}`} />
          </span>
          <span className="shrink-0 text-[11px] font-semibold tracking-wide">
            {engineLive ? "ENGINE STEPPING" : "MARKET TAPE"}
          </span>
          <span className="min-w-0 truncate text-[11px] text-muted">
            {engineLive
              ? `${inst.symbol} · ${fills} fill${fills === 1 ? "" : "s"} pinned`
              : "start the engine to pin its fills on the staircase"}
          </span>
        </div>
        <span className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${up ? "text-gain" : "text-loss"}`}>
          {formatPrice(price, inst.kind)}
        </span>
      </div>

      <Staircase series={series} inst={inst} />

      {/* what the trail is and what its dots mean, stated rather than implied */}
      <div className="pointer-events-none absolute bottom-2 left-3 z-10 flex items-center gap-2 font-mono text-[10px] text-muted tabular-nums">
        <span>staircase · 1 point / {(STEP_MS / 1000).toFixed(0)}s</span>
        <span className="text-gain">● long</span>
        <span className="text-loss">● short</span>
        <span className="text-[#e0a94a]">● no decision</span>
      </div>

      <SessionTrack session={session} />
      <BookStrip positions={positions} onSelect={onSelect} current={inst.symbol} />
    </section>
  );
}
