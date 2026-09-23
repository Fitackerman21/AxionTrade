"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, Crosshair } from "lucide-react";

import { useLivePrices, useLiveQuote } from "@/components/live-prices";
import { formatPct, formatPrice, type Instrument } from "@/lib/market-data";
import {
  durationDays,
  sessionEquityCurve,
  sessionOpenPositions,
  sessionProgress,
  type AiSession,
  type LiveContext,
  type OpenPosition,
} from "@/lib/ai-trader";
import { useAiSession } from "@/lib/ai-session";

/**
 * The trade pane.
 *
 * This used to be a candlestick chart, and it was the wrong instrument for what
 * this product is: the candles twitched on the quote feed, the engine's effect
 * on them was a sub-pixel spike, and the operator could not see the AI trading
 * at all. The pane is now a single question answered in one glance — *which way
 * is the book pushing, and how hard?* — drawn as a trail whose tip is an
 * arrowhead that leans, thickening as the engine's conviction grows.
 *
 * Four layers, each with its own scale, so nothing lies about anything else:
 *
 *   1. the racing trail — the engine's live book over the live quote, with a
 *      fast jitter so it never sits still, scaled to its own window;
 *   2. % gridlines — so a 6% move looks like a 6% move instead of filling the
 *      pane exactly as a 0.2% wiggle does;
 *   3. fill pins — where the engine traded, coloured by result, with a hover
 *      crosshair that surfaces the signal and rationale behind each one;
 *   4. the session track and book strip below — the realized climb the flick is
 *      happening inside, and every position driving it.
 */

/** An AI trade resolved while this pane was watching. */
export interface AiTradeAnnotation {
  id: string;
  symbol: string;
  dir: "LONG" | "SHORT";
  pnl: number;
  /** instrument move the fill booked, in percent */
  movePct: number;
  outcome: "WIN" | "LOSS";
  at: number;
}

const GAIN = "#00c896";
const LOSS = "#f6465d";
const MUTED = "#868e96";

/* ----------------------------- the trail ----------------------------- */

/** 25 fps — fast enough that the head turns and the line races smoothly. */
const TICK_MS = 40;
/** Cadence when the visitor has asked their system for less motion. */
const REDUCED_TICK_MS = 220;
/** Samples the trail can cover, by window length. */
const WINDOWS = [
  { id: "6s", label: "6s", sec: 6 },
  { id: "30s", label: "30s", sec: 30 },
  { id: "2m", label: "2m", sec: 120 },
] as const;
type WindowId = (typeof WINDOWS)[number]["id"];
/** Points in a rendered path. Longer windows are sampled down to this. */
const MAX_PATH_POINTS = 180;
/** Samples used for the direction the head leans. */
const TREND_LOOKBACK = 8;
/** Gridlines aimed for across the pane height. */
const GRID_TARGET = 4;
/**
 * Floor on the auto-scaled price range, as a fraction. Without it a dead-quiet
 * instrument would be scaled from noise alone and the line would thrash.
 */
const RANGE_FLOOR = 0.003;
const HEAD_ANGLE_MIN = 18;
const HEAD_ANGLE_MAX = 74;
/** Ease per tick applied to the head's rotation. */
const HEAD_TURN = 0.22;
/** The arrowhead, drawn with its tip on the origin and its body trailing behind. */
const HEAD_POINTS = "-30,-11 2,0 -30,11";
/** Room kept to the right of the tip so a leaning head is never clipped. */
const EDGE_INSET = 8;
/** How far from a pin the cursor can be and still catch it, in px. */
const PIN_HIT = 8;

/* ------------------------- engine drive ------------------------- */

/**
 * Presentation gain on the engine's move. The engine back-solves its instrument
 * moves from its own P&L (P&L ÷ notional), which lands between roughly 0.2% and
 * 3% — real, but far too small to read on a directional tape. The pane
 * multiplies it so the operator can see what the book is doing: this is a
 * simulator, and here the engine *is* the market.
 */
const ENGINE_GAIN = 2.6;
/** Floor on an open position's move, so even a small fill visibly moves the arrow. */
const ENGINE_MOVE_FLOOR_PCT = 1.2;
/** Ceiling on one engine-driven move, so a single fill can't dominate forever. */
const ENGINE_MAX_MOVE_PCT = 9;
/**
 * A hedged book nets to nothing, which would leave the arrow dead centre. Under
 * this pressure the freshest position drives instead, so the pane always shows
 * a real bet rather than a cancelled-out average.
 */
const ENGINE_NEUTRAL_PCT = 0.35;
/** Ease per tick applied to the engine's offset while its book is open. */
const ENGINE_EASE = 0.16;
/**
 * Give-back once the book is flat: slower, so a move the engine just harvested
 * stays on the pane for a few seconds before the market settles back onto the
 * live quote that every other panel in the app quotes.
 */
const ENGINE_RETRACE_EASE = 0.05;

/** Fast jitter, in percent of price per tick — the arrow never stops moving. */
const JITTER_PCT = 0.03;
/** Pull of that jitter back toward the engine's level (an AR(1) process). */
const JITTER_PULL = 0.09;

/** What the engine is dictating on this pane right now. */
interface EngineDrive {
  /** signed, amplified and clamped price move, in percent */
  movePct: number;
  /** net direction of the book's price pressure */
  dir: "LONG" | "SHORT";
  /** how far through its hold the leading position is (0 → 1) */
  progress: number;
  /** the instruments that pressure is coming from */
  symbols: string[];
  /** how many positions are open on it */
  count: number;
  /** notional at risk across them, in USD */
  notionalUsd: number;
}

/**
 * Signed price move a position is carrying: a long rises with `movePct`, a short
 * falls with it (`movePct` is signed as *P&L*, so a profitable short carries a
 * positive value while the tape goes down).
 */
function positionPriceMove(p: OpenPosition): number {
  return (p.dir === "LONG" ? 1 : -1) * p.movePct;
}

/**
 * Reduce the engine's open book to a single signed pressure.
 *
 * Positions already running the engine's way push hard; ones going against it
 * push the other way — a losing long drags the arrow down, exactly as it
 * should, and a trade that reverses mid-hold visibly reverses the pane. Each
 * position is weighted by its share of the book's notional so a diversified
 * book doesn't jerk the arrow around like one oversized bet, and the net is
 * amplified and clamped so what the engine dictates is always plainly visible.
 */
function engineDrive(positions: OpenPosition[]): EngineDrive | null {
  if (positions.length === 0) return null;
  const total = positions.reduce((a, p) => a + p.notionalUsd, 0) || 1;

  let net = 0;
  for (const p of positions) {
    const move = positionPriceMove(p);
    // at progress 0 the move is still zero, so fall back to the bet itself —
    // the arrow starts leaning the engine's way the moment it commits
    const sign = Math.sign(move) || (p.dir === "LONG" ? 1 : -1);
    net += sign * Math.max(Math.abs(move), ENGINE_MOVE_FLOOR_PCT) * (p.notionalUsd / total);
  }

  if (Math.abs(net) < ENGINE_NEUTRAL_PCT) {
    const fresh = positions[positions.length - 1];
    const move = positionPriceMove(fresh);
    const sign = Math.sign(move) || (fresh.dir === "LONG" ? 1 : -1);
    net = sign * Math.max(Math.abs(move), ENGINE_MOVE_FLOOR_PCT);
  }

  const movePct = Math.max(-ENGINE_MAX_MOVE_PCT, Math.min(ENGINE_MAX_MOVE_PCT, net * ENGINE_GAIN));
  return {
    movePct,
    dir: movePct >= 0 ? "LONG" : "SHORT",
    progress: Math.max(...positions.map((p) => p.progress)),
    symbols: positions.map((p) => p.symbol).slice(0, 3),
    count: positions.length,
    notionalUsd: total,
  };
}

/** A fill the engine booked, pinned to the sample it landed on. */
interface FillPin {
  id: string;
  /** absolute sample number, so the pin can ride the scrolling window */
  seq: number;
  win: boolean;
  up: boolean;
  symbol: string;
  dir: "LONG" | "SHORT";
  pnl: number;
  movePct: number;
  strategy: string;
  signal: string;
  rationale: string;
  exit: string;
}

/** One sample of the trail. */
interface Sample {
  v: number;
  at: number;
  /** the engine's dictated move when the sample was taken, in percent */
  move: number;
}

/** One painted frame of the pane. */
interface Frame {
  w: number;
  h: number;
  /** the trail */
  line: string;
  /** the same trail closed to the baseline, for the soft wash under it */
  area: string;
  /** stroke width, widening with the engine's conviction */
  stroke: number;
  headX: number;
  headY: number;
  /** degrees — 0 points right, negative leans the head up */
  angle: number;
  up: boolean;
  /** the engine's dictated move, in percent (0 when nothing is open) */
  movePct: number;
  grid: { y: number; label: string }[];
  spanPct: number;
  pins: (FillPin & { x: number; y: number })[];
  hover: {
    x: number;
    y: number;
    price: number;
    movePct: number;
    agoSec: number;
    pin: (FillPin & { x: number; y: number }) | null;
  } | null;
}

/** The next round percentage step up from a given span. */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * mag >= raw) return m * mag;
  }
  return 10 * mag;
}

function fmtUsd(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "+";
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

/** The same money without a sign, for figures that are only ever positive. */
function fmtUsdAbs(v: number): string {
  const abs = Math.abs(v);
  return abs >= 1000 ? `$${(abs / 1000).toFixed(1)}k` : `$${abs.toFixed(0)}`;
}

export function TradeChart({
  inst,
  aiTrade,
  onSelect,
}: {
  inst: Instrument;
  /** the latest AI fill — drives the pin, the badge and the flash */
  aiTrade?: AiTradeAnnotation | null;
  /** hand over a symbol from the book strip, so the pane doubles as a scanner */
  onSelect?: (symbol: string) => void;
}) {
  const quote = useLiveQuote(inst.symbol);
  const { session, fng } = useAiSession();
  const { quotes } = useLivePrices();
  const reduce = !!useReducedMotion();

  /* ---------------- the engine's book ---------------- */

  const positions = useMemo(() => {
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

  /** The book, reduced to one signed pressure. Every fill moves the pane. */
  const drive = useMemo(() => engineDrive(positions), [positions]);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  /**
   * Mirrored into refs because the trail loop runs on its own interval: it must
   * read the freshest engine state without ever being torn down and restarted
   * by a re-render (which would stutter the animation).
   */
  const driveRef = useRef<EngineDrive | null>(null);
  const markRef = useRef<{ price: number; changePct: number } | null>(null);
  /**
   * The session is read through a ref by the fill effect, which must depend on
   * `aiTrade` alone: were the session (which changes on every engine tick) among
   * its dependencies, each re-run would cancel the previous run's cleanup and
   * the fill badge would never be taken down.
   */
  const sessionRef = useRef<AiSession | null>(null);
  useEffect(() => {
    driveRef.current = drive;
    markRef.current = {
      price: quote?.price ?? inst.price,
      changePct: quote?.changePct ?? inst.changePct,
    };
    sessionRef.current = session;
  }, [drive, quote?.price, quote?.changePct, inst.price, inst.changePct, session]);

  const bufRef = useRef<Sample[]>([]);
  const pinsRef = useRef<FillPin[]>([]);
  const seqRef = useRef(0);
  /** engine offset currently applied on top of the live quote, as a fraction */
  const offsetRef = useRef(0);
  /** the jitter's current value, in percent of price */
  const noiseRef = useRef(0);
  /** the head's current rotation, eased so it leans rather than strobes */
  const angleRef = useRef(0);
  /**
   * Where the cursor is over the pane, or null. Deliberately a ref: the loop
   * picks it up on its next pass and folds the crosshair into the frame, so
   * hovering costs no React state and no extra render.
   */
  const hoverXRef = useRef<number | null>(null);

  const [windowId, setWindowId] = useState<WindowId>("6s");
  const windowSecRef = useRef(6);
  useEffect(() => {
    windowSecRef.current = WINDOWS.find((w) => w.id === windowId)?.sec ?? 6;
  }, [windowId]);

  const [frame, setFrame] = useState<Frame | null>(null);
  const [flash, setFlash] = useState<{ id: string; movePct: number } | null>(null);
  const [spike, setSpike] = useState<{ id: string; dir: 1 | -1 } | null>(null);

  // A new instrument is a new trail — the samples are in the old one's price
  // scale, so they are dropped rather than rescaled. The painted frame is left
  // in place for the single tick it takes to refill, so the pane never blinks
  // back to its placeholder between instruments.
  useEffect(() => {
    bufRef.current = [];
    pinsRef.current = [];
    offsetRef.current = 0;
    noiseRef.current = 0;
    angleRef.current = 0;
  }, [inst.symbol]);

  /* ---------------- the trail loop ---------------- */
  useEffect(() => {
    const id = setInterval(
      () => {
        // nothing to draw for a tab nobody is looking at
        if (document.hidden) return;

        const el = wrapRef.current;
        const w = el?.clientWidth ?? 0;
        const h = el?.clientHeight ?? 0;
        const mark = markRef.current;
        if (w <= 0 || h <= 0 || !mark) return;
        const price = mark.price;
        if (!(price > 0)) return;

        const fuel = driveRef.current;

        // the engine's offset: the trend the book is dictating. Flat book, flat
        // arrow — the jitter below is what keeps it alive in between.
        const target = fuel ? fuel.movePct / 100 : 0;
        const offset =
          offsetRef.current + (target - offsetRef.current) * (fuel ? ENGINE_EASE : ENGINE_RETRACE_EASE);
        offsetRef.current = offset;

        const noise = reduce
          ? 0
          : noiseRef.current * (1 - JITTER_PULL) + (Math.random() - 0.5) * JITTER_PCT;
        noiseRef.current = noise;

        const seq = ++seqRef.current;
        const buf = bufRef.current;
        buf.push({ v: price * (1 + offset + noise / 100), at: Date.now(), move: fuel ? fuel.movePct : 0 });

        const cap = Math.max(2, Math.round((windowSecRef.current * 1000) / TICK_MS));
        if (buf.length > cap) buf.splice(0, buf.length - cap);
        const n = buf.length;
        if (n < 2) return;

        // auto-scale to the window's own range; the % gridlines below are what
        // keep that honest, because they re-label themselves as the range moves
        let min = buf[0].v;
        let max = buf[0].v;
        for (const s of buf) {
          if (s.v < min) min = s.v;
          if (s.v > max) max = s.v;
        }
        const span = Math.max(max - min, price * RANGE_FLOOR);
        const pad = h * 0.12;
        const mid = (min + max) / 2;
        const yOf = (v: number) => h / 2 - ((v - mid) / span) * (h / 2 - pad);
        const step = w / Math.max(2, cap - 1);
        const xOf = (i: number) => w - EDGE_INSET - (n - 1 - i) * step;

        // the polyline, sampled down for long windows so the path stays cheap
        const stride = Math.max(1, Math.ceil(n / MAX_PATH_POINTS));
        let line = "";
        let used = -1;
        for (let i = 0; i < n; i += stride) {
          line += `${line ? "L" : "M"}${xOf(i) | 0} ${yOf(buf[i].v) | 0}`;
          used = i;
        }
        if (used !== n - 1) line += `L${xOf(n - 1) | 0} ${yOf(buf[n - 1].v) | 0}`;

        const headX = xOf(n - 1);
        const headY = yOf(buf[n - 1].v);
        const behind = yOf(buf[Math.max(0, n - 1 - TREND_LOOKBACK)].v);
        const dy = headY - behind;

        // Which way the pane leans. The engine's stance when it has one — stable
        // for seconds, so the line reads as a trend rather than strobing with the
        // jitter — otherwise the instrument's own move on the day.
        const bias = fuel ? fuel.movePct : mark.changePct;
        const up = bias >= 0;

        // ...but how *hard* it leans follows the immediate move, so a run
        // straightens the arrow and a turn softens it.
        const strength = reduce ? 0.4 : Math.min(1, Math.abs(dy) / (h * 0.09));
        const want = (up ? -1 : 1) * (HEAD_ANGLE_MIN + strength * (HEAD_ANGLE_MAX - HEAD_ANGLE_MIN));
        angleRef.current += (want - angleRef.current) * HEAD_TURN;

        // conviction, not just a sign: a 6% call draws a heavy line
        const conviction = fuel ? Math.min(1, Math.abs(fuel.movePct) / ENGINE_MAX_MOVE_PCT) : 0;
        const stroke = 2.1 + conviction * 2.6;

        // % gridlines on round steps, labelled against the live price — so the
        // pane's own scale is always readable rather than implied
        const grid: Frame["grid"] = [];
        const spanPct = (span / price) * 100;
        const gstep = niceStep(spanPct / GRID_TARGET);
        const stepPrice = (price * gstep) / 100;
        const decimals = gstep >= 1 ? 0 : gstep >= 0.1 ? 1 : 2;
        for (let k = Math.ceil(min / stepPrice); k <= Math.floor(max / stepPrice); k += 1) {
          const v = k * stepPrice;
          const pct = (v / price - 1) * 100;
          grid.push({ y: yOf(v), label: `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(decimals)}%` });
          if (grid.length >= 9) break;
        }

        // fills pinned where they landed, dropped once they scroll out
        const oldest = seq - (n - 1);
        const pins = pinsRef.current
          .filter((p) => p.seq >= oldest)
          .map((p) => {
            const i = n - 1 - (seq - p.seq);
            return { ...p, x: xOf(i), y: yOf(buf[i].v) };
          });
        pinsRef.current = pins;

        // the crosshair, resolved here so hovering needs no React state
        let hover: Frame["hover"] = null;
        const hx = hoverXRef.current;
        if (hx != null) {
          const i = Math.min(n - 1, Math.max(0, Math.round(n - 1 - (w - EDGE_INSET - hx) / step)));
          const s = buf[i];
          hover = {
            x: xOf(i),
            y: yOf(s.v),
            price: s.v,
            movePct: s.move,
            agoSec: Math.max(0, (Date.now() - s.at) / 1000),
            pin: pins.find((p) => Math.abs(p.x - hx) <= PIN_HIT) ?? null,
          };
        }

        setFrame({
          w,
          h,
          line,
          area: `${line}L${headX | 0} ${h | 0}L${xOf(0) | 0} ${h | 0}Z`,
          stroke,
          headX,
          headY,
          angle: angleRef.current,
          up,
          movePct: bias,
          grid,
          spanPct,
          pins,
          hover,
        });
      },
      reduce ? REDUCED_TICK_MS : TICK_MS
    );

    return () => clearInterval(id);
  }, [reduce]);

  /* ---------------- AI fill: pin, badge, flash ---------------- */
  const lastAnnotatedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!aiTrade || aiTrade.id === lastAnnotatedRef.current) return;
    lastAnnotatedRef.current = aiTrade.id;

    const win = aiTrade.pnl >= 0;
    // the way the tape travelled: a long books a win on a rise and a short on a
    // fall, so a losing long is what pulls the pane down
    const up = (aiTrade.dir === "LONG" ? 1 : -1) * (win ? 1 : -1) > 0;

    // the engine's own account of the fill, so hovering the pin shows *why*
    const rec = sessionRef.current?.trades.find((t) => t.id === aiTrade.id);
    pinsRef.current = [
      ...pinsRef.current.slice(-24),
      {
        id: aiTrade.id,
        seq: seqRef.current,
        win,
        up,
        symbol: aiTrade.symbol,
        dir: aiTrade.dir,
        pnl: aiTrade.pnl,
        movePct: aiTrade.movePct,
        strategy: rec?.strategy ?? "",
        signal: rec?.signal ?? "",
        rationale: rec?.rationale ?? "",
        exit: rec?.exit ?? "",
      },
    ];

    setFlash({ id: aiTrade.id, movePct: aiTrade.movePct });
    const badgeT = setTimeout(() => setFlash(null), 3600);

    setSpike({ id: aiTrade.id, dir: up ? 1 : -1 });
    const spikeT = setTimeout(() => setSpike(null), 1600);

    return () => {
      clearTimeout(badgeT);
      clearTimeout(spikeT);
    };
  }, [aiTrade]);

  const engineLive = session?.phase === "running";
  const price = quote?.price ?? inst.price;
  const priceUp = quote?.dir === "up" || (quote?.dir == null && (drive?.movePct ?? 0) >= 0);
  const color = frame?.up ? GAIN : LOSS;
  const windowLabel = WINDOWS.find((w) => w.id === windowId)?.label ?? "6s";

  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-surface/60">
      {/* header — what this pane is, what is driving it, and the price behind it */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="relative flex h-2 w-2 shrink-0">
            {engineLive && (
              <span className="absolute h-full w-full animate-ping rounded-full bg-gain opacity-70" />
            )}
            <span className={`relative h-2 w-2 rounded-full ${engineLive ? "bg-gain" : "bg-muted"}`} />
          </span>
          <span className="shrink-0 text-[11px] font-semibold tracking-wide">
            {engineLive ? "ENGINE DRIVING" : "MARKET TAPE"}
          </span>
          <span className="min-w-0 truncate text-[11px] text-muted">
            {drive
              ? `AxAI ${drive.dir} · ${drive.symbols.join(" · ")}`
              : engineLive
                ? (session?.strategy ?? "no open position")
                : "start the engine to hand the tape to AxAI"}
          </span>
        </div>
        <span
          className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${priceUp ? "text-gain" : "text-loss"}`}
        >
          {formatPrice(price, inst.kind)}
        </span>
      </div>

      {/* the arrow */}
      <div
        ref={wrapRef}
        className="relative h-[320px] w-full cursor-crosshair overflow-hidden sm:h-[400px]"
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          hoverXRef.current = e.clientX - rect.left;
        }}
        onPointerLeave={() => {
          hoverXRef.current = null;
        }}
      >
        {frame ? (
          <svg
            className="absolute inset-0"
            width={frame.w}
            height={frame.h}
            viewBox={`0 0 ${frame.w} ${frame.h}`}
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="axai-wash-up" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={GAIN} stopOpacity="0.3" />
                <stop offset="100%" stopColor={GAIN} stopOpacity="0" />
              </linearGradient>
              <linearGradient id="axai-wash-down" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={LOSS} stopOpacity="0.3" />
                <stop offset="100%" stopColor={LOSS} stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* the pane's own scale, so a move's size means something */}
            {frame.grid.map((g) => (
              <g key={`${g.label}-${g.y.toFixed(0)}`}>
                <line
                  x1={0}
                  x2={frame.w}
                  y1={g.y}
                  y2={g.y}
                  stroke="rgba(134, 142, 150, 0.13)"
                  strokeDasharray="2 6"
                />
                <text x={6} y={g.y - 4} fontSize={9} fill={MUTED} fontFamily="ui-monospace, monospace">
                  {g.label}
                </text>
              </g>
            ))}

            <path d={frame.area} fill={`url(#axai-wash-${frame.up ? "up" : "down"})`} />
            {/* the glow is a wide translucent stroke rather than an SVG blur: a
                real filter over a 200-point path re-rasterises every frame */}
            <path
              d={frame.line}
              fill="none"
              stroke={color}
              strokeOpacity={0.16}
              strokeWidth={frame.stroke * 3.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={frame.line}
              fill="none"
              stroke={color}
              strokeWidth={frame.stroke}
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* where the engine traded */}
            {frame.pins.map((p) => (
              <circle
                key={p.id}
                cx={p.x}
                cy={p.y}
                r={4}
                fill={p.win ? GAIN : LOSS}
                stroke="#0d1117"
                strokeWidth={1.5}
              />
            ))}

            {frame.hover && (
              <g>
                <line
                  x1={frame.hover.x}
                  x2={frame.hover.x}
                  y1={0}
                  y2={frame.h}
                  stroke="rgba(134, 142, 150, 0.45)"
                  strokeDasharray="3 4"
                />
                <circle cx={frame.hover.x} cy={frame.hover.y} r={3} fill="#e9ecef" />
              </g>
            )}

            <g transform={`translate(${frame.headX} ${frame.headY}) rotate(${frame.angle})`}>
              <polygon points={HEAD_POINTS} fill={color} fillOpacity={0.18} transform="scale(1.7)" />
              <polygon points={HEAD_POINTS} fill={color} />
            </g>
          </svg>
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-[11px] text-muted">
            Opening the tape…
          </span>
        )}

        {/* the engine's stance, its conviction, and what is at risk */}
        <AnimatePresence>
          {drive && (
            <motion.div
              key="engine-drive"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: reduce ? 0 : 0.25 }}
              className={`pointer-events-none absolute top-2 left-3 z-10 flex items-center gap-2 rounded-xl border px-2.5 py-1 backdrop-blur-md ${
                drive.dir === "LONG" ? "border-gain/40 bg-gain/10" : "border-loss/40 bg-loss/10"
              }`}
            >
              {drive.dir === "LONG" ? (
                <ArrowUpRight className="h-3.5 w-3.5 text-gain" />
              ) : (
                <ArrowDownRight className="h-3.5 w-3.5 text-loss" />
              )}
              <span
                className={`text-[10px] font-bold tracking-wider ${drive.dir === "LONG" ? "text-gain" : "text-loss"}`}
              >
                AXAI {drive.dir}
              </span>
              <span
                className={`font-mono text-[11px] font-semibold tabular-nums ${drive.dir === "LONG" ? "text-gain" : "text-loss"}`}
              >
                {drive.movePct >= 0 ? "+" : "−"}
                {Math.abs(drive.movePct).toFixed(1)}%
              </span>
              <span className="font-mono text-[10px] text-muted tabular-nums">
                {drive.count} pos · {fmtUsdAbs(drive.notionalUsd)} at risk
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* fill badge — what the engine just booked, and the move that paid for it */}
        <AnimatePresence>
          {flash && aiTrade && (
            <motion.div
              key={flash.id}
              initial={{ opacity: 0, y: 12, scale: 0.85 }}
              animate={{ opacity: 1, y: -6, scale: 1 }}
              exit={{ opacity: 0, y: -26, scale: 0.9 }}
              transition={reduce ? { duration: 0.15 } : { type: "spring", stiffness: 260, damping: 20 }}
              className={`pointer-events-none absolute top-10 right-4 z-10 rounded-xl border px-3 py-1.5 font-mono text-sm font-bold shadow-lg backdrop-blur-md tabular-nums ${
                aiTrade.pnl >= 0
                  ? "border-gain/40 bg-gain/15 text-gain shadow-[0_0_24px_rgba(0,200,150,0.35)]"
                  : "border-loss/40 bg-loss/15 text-loss shadow-[0_0_24px_rgba(246,70,93,0.3)]"
              }`}
            >
              {aiTrade.pnl >= 0 ? "+" : "−"}$
              {Math.abs(aiTrade.pnl).toLocaleString("en-US", { maximumFractionDigits: 0 })}
              <span className="ml-2 text-[10px] font-semibold tracking-wide opacity-80">
                {aiTrade.symbol} {flash.movePct >= 0 ? "+" : "−"}
                {Math.abs(flash.movePct).toFixed(1)}%
              </span>
              <span className="ml-1.5 text-[10px] font-semibold tracking-wide opacity-60">AXAI FILL</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* the pane breathes with the direction the fill pushed it */}
        <AnimatePresence>
          {spike && !reduce && (
            <motion.div
              key={spike.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 0] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.5, times: [0, 0.25, 1] }}
              className={`pointer-events-none absolute inset-0 z-0 ${
                spike.dir === 1
                  ? "bg-[radial-gradient(ellipse_at_70%_45%,rgba(0,200,150,0.16),transparent_65%)]"
                  : "bg-[radial-gradient(ellipse_at_70%_55%,rgba(246,70,93,0.14),transparent_65%)]"
              }`}
            />
          )}
        </AnimatePresence>

        {/* the crosshair readout — and the engine's reasoning for the fill under it */}
        {frame?.hover && (
          <div
            className="pointer-events-none absolute top-2 z-20 w-[13.5rem] rounded-xl border border-border bg-background/95 p-2.5 shadow-2xl backdrop-blur-md"
            style={{ left: Math.max(8, Math.min(frame.hover.x + 14, frame.w - 228)) }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold tracking-wide text-muted uppercase">
                <Crosshair className="h-3 w-3" />
                {frame.hover.agoSec < 1 ? "now" : `${frame.hover.agoSec.toFixed(0)}s ago`}
              </span>
              <span className="font-mono text-[12px] font-semibold tabular-nums">
                {formatPrice(frame.hover.price, inst.kind)}
              </span>
            </div>

            {frame.hover.pin ? (
              <div className="mt-2 border-t border-border/60 pt-2">
                <div
                  className={`flex items-center gap-1.5 font-mono text-[11px] font-bold tabular-nums ${frame.hover.pin.win ? "text-gain" : "text-loss"}`}
                >
                  {frame.hover.pin.up ? (
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  ) : (
                    <ArrowDownRight className="h-3.5 w-3.5" />
                  )}
                  {frame.hover.pin.dir} {frame.hover.pin.symbol} {fmtUsd(frame.hover.pin.pnl)} ·{" "}
                  {formatPct(frame.hover.pin.movePct)}
                </div>
                <dl className="mt-1.5 space-y-1 text-[10.5px] leading-snug">
                  {frame.hover.pin.strategy && (
                    <div className="flex gap-1.5">
                      <dt className="shrink-0 text-muted">Setup</dt>
                      <dd className="text-foreground/90">{frame.hover.pin.strategy}</dd>
                    </div>
                  )}
                  {frame.hover.pin.signal && (
                    <div className="flex gap-1.5">
                      <dt className="shrink-0 text-muted">Signal</dt>
                      <dd className="text-foreground/90">{frame.hover.pin.signal}</dd>
                    </div>
                  )}
                  {frame.hover.pin.exit && (
                    <div className="flex gap-1.5">
                      <dt className="shrink-0 text-muted">Exit</dt>
                      <dd className="text-foreground/90">{frame.hover.pin.exit}</dd>
                    </div>
                  )}
                  {frame.hover.pin.rationale && (
                    <div className="flex gap-1.5">
                      <dt className="shrink-0 text-muted">Risk</dt>
                      <dd className="text-foreground/90">{frame.hover.pin.rationale}</dd>
                    </div>
                  )}
                </dl>
              </div>
            ) : (
              <p className="mt-2 border-t border-border/60 pt-2 text-[10.5px] leading-snug text-muted">
                {frame.hover.movePct !== 0
                  ? `AxAI was dictating ${formatPct(frame.hover.movePct)} here.`
                  : "No engine pressure here — the tape was on the live quote."}
              </p>
            )}
          </div>
        )}

        {/* the pane's own scale, stated rather than implied */}
        {frame && (
          <span className="pointer-events-none absolute bottom-2 left-3 z-10 font-mono text-[10px] text-muted tabular-nums">
            span {frame.spanPct.toFixed(2)}% · {windowLabel} · {frame.pins.length} fill
            {frame.pins.length === 1 ? "" : "s"}
          </span>
        )}

        {/* how much of the tape the pane is showing */}
        {/* the controls opt out of the crosshair, which is for reading the tape */}
        <div
          onPointerMove={(e) => {
            e.stopPropagation();
            hoverXRef.current = null;
          }}
          className="absolute right-3 bottom-2 z-10 flex items-center gap-1 rounded-lg border border-border bg-background/80 p-0.5 backdrop-blur-md"
        >
          {WINDOWS.map((w) => (
            <button
              key={w.id}
              onClick={() => setWindowId(w.id)}
              className={`min-w-8 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold transition-colors ${
                windowId === w.id ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <SessionTrack session={session} />
      <BookStrip positions={positions} onSelect={onSelect} current={inst.symbol} />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Session track — the climb the flick is happening inside             */
/* ------------------------------------------------------------------ */

/**
 * Memoised because the pane above re-renders 25 times a second and this band
 * only moves when the engine actually books a fill.
 */
const SessionTrack = memo(function SessionTrack({ session }: { session: AiSession | null }) {
  if (!session || session.phase === "idle") return null;
  const curve = sessionEquityCurve(session, 72);

  const days = durationDays(session.durationId);
  const progress = sessionProgress(session);
  const multiple = session.equity / session.principal;
  const lo = Math.min(session.principal, ...curve);
  const hi = Math.max(session.principal, ...curve);
  const range = Math.max(hi - lo, session.principal * 0.01);

  // normalised to a 100 × 30 viewBox; the stroke is non-scaling so the band can
  // stretch to any width without the line fattening
  const points = curve
    .map((v, i) => {
      const x = curve.length > 1 ? (i / (curve.length - 1)) * 100 : 0;
      const y = 29 - ((v - lo) / range) * 28;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <div className="border-t border-border px-3 py-2 sm:px-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-semibold tracking-wide text-muted uppercase">Session track</span>
        <span className="font-mono text-[10.5px] text-muted tabular-nums">
          <span className={multiple >= 1 ? "text-gain" : "text-loss"}>{multiple.toFixed(2)}×</span> · day{" "}
          {(progress * days).toFixed(1)}/{days}
        </span>
      </div>

      <svg
        className="mt-1 h-8 w-full"
        viewBox="0 0 100 30"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <line
          x1={0}
          x2={100}
          y1={29 - ((session.principal - lo) / range) * 28}
          y2={29 - ((session.principal - lo) / range) * 28}
          stroke="rgba(134, 142, 150, 0.25)"
          strokeDasharray="2 3"
          vectorEffect="non-scaling-stroke"
        />
        {curve.length > 1 && (
          <polyline
            points={points}
            fill="none"
            stroke={GAIN}
            strokeOpacity={0.5}
            strokeWidth={1.5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      <div className="mt-1 flex items-center gap-2">
        <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-border/70">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-brand to-gain"
            style={{ width: `${Math.max(1, progress * 100)}%` }}
          />
        </div>
        <span className="font-mono text-[10px] text-muted tabular-nums">
          ${session.principal.toLocaleString("en-US", { maximumFractionDigits: 0 })} → $
          {session.equity.toLocaleString("en-US", { maximumFractionDigits: 0 })}
        </span>
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/* Book strip — every position driving the arrow                       */
/* ------------------------------------------------------------------ */

const BookStrip = memo(function BookStrip({
  positions,
  onSelect,
  current,
}: {
  positions: OpenPosition[];
  onSelect?: (symbol: string) => void;
  current: string;
}) {
  return (
    <div className="no-scrollbar flex items-center gap-2 overflow-x-auto border-t border-border px-3 py-2 sm:px-4">
      <span className="shrink-0 text-[10px] font-semibold tracking-wide text-muted uppercase">Book</span>
      {positions.length === 0 ? (
        <span className="text-[11px] text-muted">No open AxAI positions.</span>
      ) : (
        positions.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelect?.(p.symbol)}
            disabled={!onSelect}
            title={`${p.strategy} — ${p.signal}`}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 font-mono text-[10.5px] tabular-nums transition-colors ${
              p.symbol === current
                ? "border-brand/50 bg-brand/10"
                : "border-border hover:border-muted/40"
            } ${onSelect ? "" : "cursor-default"}`}
          >
            {p.dir === "LONG" ? (
              <ArrowUpRight className="h-3 w-3 text-gain" />
            ) : (
              <ArrowDownRight className="h-3 w-3 text-loss" />
            )}
            <span className="font-semibold">{p.symbol}</span>
            <span className={p.unrealized >= 0 ? "text-gain" : "text-loss"}>
              {formatPct(p.movePct)}
            </span>
            <span className={p.unrealized >= 0 ? "text-gain/80" : "text-loss/80"}>
              {fmtUsd(p.unrealized)}
            </span>
          </button>
        ))
      )}
    </div>
  );
});
