"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

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

/**
 * What the pane is currently drawn against, which trails what the data says.
 * Both the price range and the width the samples are spread over are eased, so
 * a new sample grows the last step into its level and widens the path instead
 * of snapping everything to a new scale in one frame.
 */
interface View {
  lo: number;
  hi: number;
  /** the newest price, easing toward the sample that just landed */
  head: number;
  /** how many steps the pane's width is divided between */
  spread: number;
}

/** Fraction of the remaining distance covered per drawn frame. */
const EASE = 0.22;
/** Ceiling on redraws: 40 fps is smooth for a step line and leaves headroom. */
const FRAME_MS = 25;

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
  const reduce = !!useReducedMotion();
  const W = Math.max(240, box.w || 640);
  const H = Math.max(160, box.h || 320);

  /** where the data says the pane should be drawn */
  const target = useMemo<View | null>(() => {
    const pts = series.slice(-WINDOW_POINTS);
    if (pts.length === 0) return null;
    const mids = pts.map((p) => p.mid);
    const lowest = Math.min(...mids);
    const highest = Math.max(...mids);
    // a little air above and below, so the line never rides the frame
    const pad = Math.max(highest - lowest, lowest * 0.0001) * 0.08;
    return {
      lo: lowest - pad,
      hi: highest + pad,
      head: pts[pts.length - 1].mid,
      // spread over the samples actually held, not the 90 slots the window
      // could hold: a fresh pane would otherwise cram its first minutes into a
      // stub against the price axis
      spread: Math.max(1, pts.length - 1),
    };
  }, [series]);

  const [view, setView] = useState<View | null>(null);
  /** what the last drawn frame used, and what the next one is easing toward */
  const viewRef = useRef<View | null>(null);
  const targetRef = useRef<View | null>(null);
  const drawnRef = useRef<View | null>(null);

  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  /**
   * The easing loop. A ref rather than a state read on every frame, and it
   * stops touching React the moment it has settled, so an idle pane costs a
   * handful of subtractions per frame and no renders at all.
   */
  useEffect(() => {
    let alive = true;
    let raf = 0;
    let last = 0;

    const loop = (now: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      if (now - last < FRAME_MS) return;
      last = now;

      const t = targetRef.current;
      if (!t) return;
      const cur = viewRef.current;
      const k = reduce ? 1 : EASE;
      const next: View = cur
        ? {
            lo: cur.lo + (t.lo - cur.lo) * k,
            hi: cur.hi + (t.hi - cur.hi) * k,
            head: cur.head + (t.head - cur.head) * k,
            spread: cur.spread + (t.spread - cur.spread) * k,
          }
        : { ...t };

      const span = Math.abs(t.hi - t.lo) || 1;
      const settled =
        Math.abs(next.lo - t.lo) < span * 0.0004 &&
        Math.abs(next.hi - t.hi) < span * 0.0004 &&
        Math.abs(next.head - t.head) < span * 0.0004 &&
        Math.abs(next.spread - t.spread) < 0.01;

      const goal = settled ? t : next;
      viewRef.current = goal;

      const drawn = drawnRef.current;
      if (!drawn || drawn.lo !== goal.lo || drawn.hi !== goal.hi || drawn.head !== goal.head || drawn.spread !== goal.spread) {
        drawnRef.current = goal;
        setView(goal);
      }
    };

    raf = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [reduce]);

  const chart = useMemo(() => {
    const empty = {
      points: 0,
      d: "",
      grid: [] as Array<{ i: number; v: number; y: number }>,
      dots: [] as Array<{ key: string; cx: number; cy: number; fill: string }>,
      area: "",
      lastX: 0,
      lastY: 0,
      lastMid: 0,
      lastHasSide: false,
      lastFill: "#2b3440",
    };
    const pts = series.slice(-WINDOW_POINTS);
    const v = view ?? target;
    if (!v || pts.length === 0) return empty;

    const span = Math.max(v.hi - v.lo, v.lo * 0.0001) || 1;
    const X = (i: number) => (i * (W - PAD_RIGHT)) / v.spread;
    const Y = (val: number) => PAD_TOP + (H - PAD_BOTTOM - PAD_TOP) * (1 - (val - v.lo) / span);

    // the head carries the eased price, so the last vertical step grows into
    // its level rather than snapping to it
    const mids = pts.map((p) => p.mid);
    mids[mids.length - 1] = v.head;

    let d = "";
    mids.forEach((mid, i) => {
      const x = X(i).toFixed(1);
      const y = Y(mid).toFixed(1);
      d += d ? ` H${x} V${y}` : `M${x} ${y}`;
    });

    const grid = [0, 1, 2, 3].map((i) => {
      const val = v.lo + (span * i) / 3;
      return { i, v: val, y: Y(val) };
    });

    const dots: Array<{ key: string; cx: number; cy: number; fill: string }> = [];
    pts.forEach((p, i) => {
      if (p.side) dots.push({ key: `${i}`, cx: X(i), cy: Y(mids[i]), fill: SIDE_COLOUR[p.side] });
    });

    const last = pts[pts.length - 1];
    return {
      points: pts.length,
      d,
      grid,
      dots,
      area: pts.length > 1 ? `${d} V${H - PAD_BOTTOM} H0 Z` : "",
      lastX: X(pts.length - 1),
      lastY: Y(v.head),
      lastMid: last.mid,
      lastHasSide: !!last.side,
      lastFill: last.side ? SIDE_COLOUR[last.side] : "#2b3440",
    };
  }, [series, view, target, W, H]);

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
          <g key={g.i}>
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
