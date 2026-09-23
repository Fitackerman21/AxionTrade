"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { useLivePrices, useLiveQuote } from "@/components/live-prices";
import { formatPrice, type Instrument } from "@/lib/market-data";
import { sessionOpenPositions, type LiveContext, type OpenPosition } from "@/lib/ai-trader";
import { useAiSession } from "@/lib/ai-session";

/**
 * The trade pane.
 *
 * This used to be a candlestick chart, and it was the wrong instrument for what
 * this product is: the candles twitched on the quote feed, the engine's effect
 * on them was a sub-pixel spike, and the operator could not see the AI trading
 * at all. So the pane is now a single question answered in one glance — *which
 * way is the book pushing?* — drawn as a trail whose tip is a big arrowhead
 * that leans, steepening as the engine's conviction grows.
 *
 * Nothing about it is derived from candles: the line is the engine's live book
 * (its open positions, signed and amplified) laid over the live quote, with a
 * fast jitter so it never sits still, and it auto-scales to its own trail so
 * every move uses the whole pane. It is an oscillator for the autonomous book,
 * not a price history.
 *
 * A fill lands roughly every 5 seconds at the default rate, and the direction
 * flips with the book, so the arrow genuinely races up and down.
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

/* ----------------------------- the trail ----------------------------- */

/** 25 fps — fast enough that the head turns and the line races smoothly. */
const TICK_MS = 40;
/** Samples kept on screen (≈ 6.5 s of tape). */
const TRAIL = 160;
/** Samples used for the direction the head leans and the line is coloured by. */
const TREND_LOOKBACK = 8;
/**
 * Floor on the auto-scaled price range, as a fraction. Without it a dead-quiet
 * instrument would be scaled from noise alone and the line would thrash; with
 * it, the jitter reads as life and the engine's move dwarfs it.
 */
const RANGE_FLOOR = 0.003;
const HEAD_ANGLE_MIN = 18;
const HEAD_ANGLE_MAX = 74;
/** Ease per tick applied to the head's rotation. */
const HEAD_TURN = 0.22;
/** The arrowhead, drawn with its tip on the origin and its body trailing behind. */
const HEAD_POINTS = "-52,-20 2,0 -52,20";
/** Room kept to the right of the tip so a leaning head is never clipped. */
const EDGE_INSET = 6;

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
  };
}

/** One painted frame of the trail, in the pane's own pixel space. */
interface Frame {
  w: number;
  h: number;
  /** the trail */
  line: string;
  /** the same trail closed to the baseline, for the soft wash under it */
  area: string;
  headX: number;
  headY: number;
  /** degrees — 0 points right, negative leans the head up */
  angle: number;
  up: boolean;
  /** the engine's dictated move, in percent (0 when nothing is open) */
  movePct: number;
}

export function TradeChart({
  inst,
  aiTrade,
}: {
  inst: Instrument;
  /** the latest AI fill — drives the badge and the flash on the pane */
  aiTrade?: AiTradeAnnotation | null;
}) {
  const quote = useLiveQuote(inst.symbol);
  const { session, fng } = useAiSession();
  const { quotes } = useLivePrices();

  /* ---------------- what the engine is dictating ---------------- */

  /**
   * The engine's live book, reduced to one signed pressure. Every fill moves the
   * pane — that is the point of the terminal: you watch the book work.
   */
  const drive = useMemo(() => {
    if (!session || session.phase === "idle") return null;
    const live: LiveContext = {
      quoteFor: (symbol) => {
        const q = quotes.get(symbol);
        return q ? { price: q.price, changePct: q.changePct } : undefined;
      },
      fng,
    };
    return engineDrive(sessionOpenPositions(session, live, 6));
  }, [session, quotes, fng]);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  /**
   * Mirrored into refs because the trail loop runs on its own interval: it must
   * read the freshest engine state without ever being torn down and restarted
   * by a re-render (which would stutter the animation).
   */
  const driveRef = useRef<EngineDrive | null>(null);
  const markRef = useRef<{ price: number; changePct: number } | null>(null);
  useEffect(() => {
    driveRef.current = drive;
    markRef.current = {
      price: quote?.price ?? inst.price,
      changePct: quote?.changePct ?? inst.changePct,
    };
  }, [drive, quote?.price, quote?.changePct, inst.price, inst.changePct]);

  /** panned samples, oldest first */
  const levelsRef = useRef<number[]>([]);
  /** engine offset currently applied on top of the live quote, as a fraction */
  const offsetRef = useRef(0);
  /** the jitter's current value, in percent of price */
  const noiseRef = useRef(0);
  /** the head's current rotation, eased so it leans rather than strobes */
  const angleRef = useRef(0);

  const [frame, setFrame] = useState<Frame | null>(null);
  const [flash, setFlash] = useState<{ id: string; movePct: number } | null>(null);
  const [spike, setSpike] = useState<{ id: string; dir: 1 | -1 } | null>(null);

  // A new instrument is a new trail — the samples are in the old one's price
  // scale, so they are dropped rather than rescaled. The painted frame is left
  // in place for the single tick it takes to refill, so the pane never blinks
  // back to its placeholder between instruments.
  useEffect(() => {
    levelsRef.current = [];
    offsetRef.current = 0;
    noiseRef.current = 0;
    angleRef.current = 0;
  }, [inst.symbol]);

  /* ---------------- the trail loop ---------------- */
  useEffect(() => {
    const id = setInterval(() => {
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

      const noise = noiseRef.current * (1 - JITTER_PULL) + (Math.random() - 0.5) * JITTER_PCT;
      noiseRef.current = noise;

      const levels = levelsRef.current;
      levels.push(price * (1 + offset + noise / 100));
      if (levels.length > TRAIL) levels.splice(0, levels.length - TRAIL);
      if (levels.length < 2) return;

      // auto-scale to the trail itself: this is what makes every move use the
      // whole pane instead of hiding inside a long price axis
      let min = levels[0];
      let max = levels[0];
      for (const v of levels) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const span = Math.max(max - min, price * RANGE_FLOOR);
      const pad = h * 0.14;
      const mid = (min + max) / 2;
      // Centred on the range rather than pinned to its low edge, so a quiet
      // stretch sits in the middle of the pane instead of along the bottom.
      const yOf = (v: number) => h / 2 - ((v - mid) / span) * (h / 2 - pad);
      const step = w / (TRAIL - 1);
      const xOf = (i: number) => w - EDGE_INSET - (levels.length - 1 - i) * step;

      let line = "";
      for (let i = 0; i < levels.length; i++) {
        line += `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)} ${yOf(levels[i]).toFixed(1)} `;
      }

      const head = levels.length - 1;
      const headX = xOf(head);
      const headY = yOf(levels[head]);
      const behind = yOf(levels[Math.max(0, head - TREND_LOOKBACK)]);
      const dy = headY - behind;

      // Which way the pane leans. The engine's stance when it has one — stable
      // for seconds, so the line reads as a trend rather than strobing with the
      // jitter — otherwise the instrument's own move on the day.
      const bias = fuel ? fuel.movePct : mark.changePct;
      const up = bias >= 0;

      // ...but how *hard* it leans follows the immediate move, so a run
      // straightens the arrow and a turn softens it.
      const strength = Math.min(1, Math.abs(dy) / (h * 0.09));
      const want =
        (up ? -1 : 1) * (HEAD_ANGLE_MIN + strength * (HEAD_ANGLE_MAX - HEAD_ANGLE_MIN));
      angleRef.current += (want - angleRef.current) * HEAD_TURN;

      setFrame({
        w,
        h,
        line,
        area: `${line}L${headX.toFixed(1)} ${h} L${xOf(0).toFixed(1)} ${h} Z`,
        headX,
        headY,
        angle: angleRef.current,
        up,
        movePct: bias,
      });
    }, TICK_MS);

    return () => clearInterval(id);
  }, []);

  /* ---------------- AI fill annotation: flash + badge ---------------- */
  const lastAnnotatedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!aiTrade || aiTrade.id === lastAnnotatedRef.current) return;
    lastAnnotatedRef.current = aiTrade.id;

    // the way the tape travelled: a long books a win on a rise and a short on a
    // fall, so a losing long is what pulls the pane down
    const win = aiTrade.pnl >= 0;
    const up = (aiTrade.dir === "LONG" ? 1 : -1) * (win ? 1 : -1) > 0;

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

  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-surface/60">
      {/* header — what this pane is, and the price the arrow is tracking */}
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
                ? "no open AxAI position"
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
      <div ref={wrapRef} className="relative h-[380px] w-full overflow-hidden sm:h-[460px]">
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
              <filter id="axai-glow" x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="6" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <path d={frame.area} fill={`url(#${frame.up ? "axai-wash-up" : "axai-wash-down"})`} />
            <path
              d={frame.line}
              fill="none"
              stroke={frame.up ? GAIN : LOSS}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              filter="url(#axai-glow)"
            />
            <g transform={`translate(${frame.headX} ${frame.headY}) rotate(${frame.angle})`}>
              <polygon points={HEAD_POINTS} fill={frame.up ? GAIN : LOSS} filter="url(#axai-glow)" />
            </g>
          </svg>
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-[11px] text-muted">
            Opening the tape…
          </span>
        )}

        {/* the engine's stance, and the move it is dictating */}
        <AnimatePresence>
          {drive && (
            <motion.div
              key="engine-drive"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.25 }}
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
              transition={{ type: "spring", stiffness: 260, damping: 20 }}
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
          {spike && (
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
      </div>
    </section>
  );
}
