"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, Bot } from "lucide-react";

import { useLivePrices } from "@/components/live-prices";
import {
  bookConviction,
  bookSide,
  convictionForMove,
  sessionOpenPositions,
  type LiveContext,
} from "@/lib/ai-trader";
import { useAiSession } from "@/lib/ai-session";
import { formatPrice, type Instrument } from "@/lib/market-data";

/**
 * The engine's standing verdict, in the jev-loop's "Battery this tick" style:
 * one big word — BUY, SELL or LATE — and the confidence behind it, animated
 * when the call flips.
 *
 * The word is the AxAI engine's own bet, read from `useAiSession()`: BUY while
 * its book is net long, SELL while it is net short, LATE when it holds nothing
 * or is hedged to nothing. It has to come from the positions' direction rather
 * than the price they carry — this engine encodes every losing step as a short,
 * so a price-signed reading can only ever say long.
 *
 * The percentage is the engine's *live* conviction (`bookConviction`) — how
 * hard the book is pushing right now, read on the band the engine actually
 * decides in: nothing below the floor is ever traded, so nothing is reported
 * below it either, and nothing reaches certainty. The `fill` meter beneath it
 * carries the last realized fill on the same scale. With no position there is
 * no decision to report, so the card shows a dash rather than a zero.
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

  /** which way the book is committed — null while it holds nothing or is hedged */
  const committed = useMemo(() => bookSide(positions), [positions]);
  const liveConviction = useMemo(() => bookConviction(positions), [positions]);

  const side: Side = committed === "LONG" ? "buy" : committed === "SHORT" ? "sell" : "late";

  const word = side === "buy" ? "BUY" : side === "sell" ? "SELL" : "LATE";
  const tone = TONE[side];
  /** a conviction reading only exists while the engine is actually in a trade */
  const showPct = positions.length > 0;

  /** the conviction behind the engine's latest fill, on the chart's own scale */
  const fillConviction = lastTrade ? convictionForMove(lastTrade.movePct) : 0;
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
            <span className={`font-mono text-3xl leading-none font-semibold tabular-nums ${tone.text}`}>
              {showPct ? `${Math.round(liveConviction * 100)}%` : "—"}
            </span>
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
