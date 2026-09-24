"use client";

import { useEffect, useMemo } from "react";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, Bot } from "lucide-react";

import { useLivePrices } from "@/components/live-prices";
import { ENGINE_MAX_MOVE_PCT, engineConviction, engineDrive } from "@/components/trade-chart";
import { sessionOpenPositions, type LiveContext } from "@/lib/ai-trader";
import { useAiSession } from "@/lib/ai-session";
import { formatPrice, type Instrument } from "@/lib/market-data";

/**
 * The engine's standing verdict, in the jev-loop's "Battery this tick" style:
 * one big word — BUY, SELL or LATE — and the confidence behind it, animated
 * when the call flips.
 *
 * The word is the AxAI engine's own stance, read from `useAiSession()`: BUY
 * while its book is pushing up, SELL while it is pushing down, LATE when it is
 * flat or not running. The percentage is the engine's *live* conviction — how
 * hard the book is pushing right now, on the same reading the chart pane
 * thickens its stroke with, so the number means one thing everywhere in the
 * terminal. It moves with every engine tick rather than freezing on the last
 * fill; the fill's own conviction is the `fill` meter beneath it.
 *
 * The manual Buy/Sell triggers stay: while the engine runs they queue a signal
 * for its next fill, exactly as they did before this card took the block.
 */

type Side = "buy" | "sell" | "late";

const TONE: Record<Side, { border: string; tint: string; text: string; bar: string }> = {
  buy: { border: "border-gain/40", tint: "bg-gain/8", text: "text-gain", bar: "bg-gain" },
  sell: { border: "border-loss/40", tint: "bg-loss/8", text: "text-loss", bar: "bg-loss" },
  late: { border: "border-border", tint: "bg-surface-2/40", text: "text-[#e0a94a]", bar: "bg-[#e0a94a]" },
};

function Meter({
  label,
  value,
  tone,
  caption,
}: {
  label: string;
  /** 0–1 */
  value: number;
  tone: string;
  caption: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 shrink-0 text-[10px] font-semibold tracking-wide text-muted uppercase">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border/70">
        <div
          className={`h-full rounded-full ${tone} transition-[width] duration-500`}
          style={{ width: `${Math.max(1, Math.min(100, value * 100))}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right font-mono text-[10.5px] text-muted tabular-nums">{caption}</span>
    </div>
  );
}

export function EngineVerdict({
  inst,
  price,
  engineRunning,
  onManual,
}: {
  inst: Instrument;
  price: number;
  engineRunning: boolean;
  onManual: (dir: "LONG" | "SHORT") => void;
}) {
  const { session, lastTrade, fng } = useAiSession();
  const { quotes } = useLivePrices();

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

  /** what the book is dictating right now — null while the engine holds nothing */
  const drive = useMemo(() => engineDrive(positions), [positions]);
  const liveConviction = useMemo(() => engineConviction(positions), [positions]);

  const side: Side = !drive ? "late" : drive.dir === "LONG" ? "buy" : "sell";

  const word = side === "buy" ? "BUY" : side === "sell" ? "SELL" : "LATE";
  const tone = TONE[side];
  const showPct = session !== null && session.phase !== "idle";

  /** the conviction behind the engine's latest fill, on the chart's own scale */
  const fillConviction = lastTrade
    ? Math.min(1, Math.abs(lastTrade.movePct) / ENGINE_MAX_MOVE_PCT)
    : 0;
  /**
   * The headline number counts toward its new reading rather than snapping to
   * it: a conviction that creeps up over a hold is the engine's story, and a
   * number that jumps cut that story short. The motion value keeps the tween
   * out of React, so the count costs no re-renders.
   */
  const convictionMv = useMotionValue(0);
  const convictionText = useTransform(convictionMv, (v) => `${Math.round(v * 100)}%`);
  useEffect(() => {
    const controls = animate(convictionMv, liveConviction, { duration: 0.6, ease: "easeOut" });
    return () => controls.stop();
  }, [convictionMv, liveConviction]);

  /** how far equity has walked toward the session's hard floor */
  const risk =
    session && session.principal > session.floorUsd
      ? Math.max(0, Math.min(1, (session.principal - session.equity) / (session.principal - session.floorUsd)))
      : 0;

  return (
    <section className={`relative overflow-hidden rounded-2xl border p-4 ${tone.border} ${tone.tint}`}>
      {/* the flash — one pulse per fill, so the card acknowledges the engine */}
      <motion.span
        key={lastTrade?.id ?? "seed"}
        initial={{ opacity: 0.5 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.9 }}
        className="pointer-events-none absolute inset-0 bg-foreground/10"
      />

      <div className="relative">
        <p className="text-[10px] font-semibold tracking-wide text-muted uppercase">Engine verdict</p>

        <div className="mt-1 flex items-end justify-between gap-3">
          <motion.span
            key={word}
            initial={{ rotateX: -90, opacity: 0 }}
            animate={{ rotateX: 0, opacity: 1 }}
            transition={{ duration: 0.32, ease: "easeOut" }}
            className={`text-4xl leading-none font-black tracking-tight ${tone.text}`}
            style={{ transformPerspective: 600 }}
          >
            {word}
          </motion.span>
          <span className="block text-right">
            <motion.span className={`font-mono text-3xl leading-none font-semibold tabular-nums ${tone.text}`}>
              {showPct ? convictionText : "—"}
            </motion.span>
            <span className="mt-0.5 block text-[10px] text-muted">live conviction</span>
          </span>
        </div>

        <div className="mt-3 space-y-1.5 border-t border-border/60 pt-3">
          <Meter
            label="fill"
            value={fillConviction}
            tone={tone.bar}
            caption={lastTrade ? `${(fillConviction * 100).toFixed(0)}%` : "—"}
          />
          <Meter label="risk" value={risk} tone="bg-loss" caption={session ? `${(risk * 100).toFixed(0)}%` : "—"} />
        </div>

        {/* the manual triggers — unchanged in what they do, now part of the card */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={() => onManual("LONG")}
            className="group flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#00e0aa] to-[#00a87a] py-3 text-sm font-bold text-[#04120d] shadow-[0_10px_28px_-12px_rgba(0,200,150,0.65)] transition-transform active:scale-[0.98]"
          >
            {engineRunning ? <Bot className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />}
            Buy
            <span className="font-mono text-xs font-semibold opacity-75">{formatPrice(price, inst.kind)}</span>
          </button>
          <button
            onClick={() => onManual("SHORT")}
            className="group flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#ff5b73] to-[#d32f4b] py-3 text-sm font-bold text-[#1a0509] shadow-[0_10px_28px_-12px_rgba(246,70,93,0.6)] transition-transform active:scale-[0.98]"
          >
            {engineRunning ? <Bot className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:translate-y-0.5" />}
            Sell
            <span className="font-mono text-xs font-semibold opacity-75">{formatPrice(price, inst.kind)}</span>
          </button>
        </div>

        <p className="mt-2 text-[11px] text-muted">
          {engineRunning
            ? "Buy/Sell queue a signal for AxAI's next fill."
            : "Start the engine to hand it your signals, or trade directly."}
        </p>
      </div>
    </section>
  );
}
