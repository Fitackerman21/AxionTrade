"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleDollarSign,
  CircleX,
  Clock,
  Cpu,
  FastForward,
  Gauge,
  History,
  Layers,
  OctagonX,
  Percent,
  Radio,
  RotateCcw,
  Scale,
  ScanLine,
  ShieldAlert,
  Sparkles,
  Target,
  Timer,
  TrendingDown,
  TrendingUp,
  Trophy,
  Zap,
} from "lucide-react";

import { InstrumentLogo } from "@/components/instrument-logo";
import { useLivePrices } from "@/components/live-prices";
import { useAccount } from "@/lib/account-store";
import { useAiSession } from "@/lib/ai-session";
import { INSTRUMENTS } from "@/lib/market-data";
import {
  AI_CONFIG,
  DEFAULT_SPEED,
  DURATIONS,
  MILESTONE_PCTS,
  SPEEDS,
  durationDays,
  sessionClockRate,
  sessionEquityCurve,
  sessionOpenPositions,
  sessionProgress,
  sessionRemainingMs,
  sessionScanLines,
  sessionStats,
  speedMult,
  type AiSession,
  type LiveContext,
  type SpeedId,
} from "@/lib/ai-trader";

const DAY = 86400000;

/** Real asset class for a symbol, so every blotter row shows its true logo. */
const kindOf = (symbol: string) =>
  INSTRUMENTS.find((i) => i.symbol === symbol)?.kind ?? ("stock" as const);

const fmtUsd = (v: number, frac = 2) =>
  `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: frac, maximumFractionDigits: frac })}`;

const fmtPct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`;

/** "3d 4h 12m" / "4h 12m 30s" / "12m 30s" — a duration, not a date. */
function fmtSpan(ms: number) {
  const left = Math.max(0, ms);
  const d = Math.floor(left / DAY);
  const h = Math.floor((left % DAY) / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  const s = Math.floor((left % 60000) / 1000);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

/** Session-clock stamp, e.g. "Day 3 · 14:22". */
function fmtStamp(at: number, startAt: number) {
  const day = Math.floor((at - startAt) / DAY) + 1;
  const clock = new Date(at).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  return `Day ${day} · ${clock}`;
}

/* ---------------------------- session clock --------------------------- */

/** Live session clock: the single source of truth for the whole panel. */
function SessionClock({ session }: { session: AiSession }) {
  const dayNo = Math.floor(session.clockMs / DAY) + 1;
  const totalDays = durationDays(session.durationId);
  const progress = sessionProgress(session);

  return (
    <div className="mt-4 rounded-xl border border-border bg-background/40 px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-brand/30 bg-brand/10">
            <Clock className="h-4 w-4 text-brand" />
          </span>
          <div>
            <p className="text-[10.5px] tracking-wide text-muted uppercase">Session clock</p>
            <p className="font-mono text-[13px] font-semibold tabular-nums">
              Day {dayNo} of {totalDays}
              <span className="ml-2 font-normal text-muted">
                {new Date(session.startAt + session.clockMs).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}{" "}
                ·{" "}
                {new Date(session.startAt + session.clockMs).toLocaleTimeString("en-US", {
                  hour12: false,
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10.5px] tracking-wide text-muted uppercase">Window remaining</p>
          <p className="font-mono text-[13px] font-semibold tabular-nums">
            {session.phase === "running" ? fmtSpan(sessionRemainingMs(session)) : "closed"}
          </p>
        </div>
      </div>

      {/* day-segmented window track — the visual answer to "how far in are we?" */}
      <div className="mt-3 flex gap-[3px]" aria-hidden>
        {Array.from({ length: totalDays }, (_, i) => {
          const segStart = i / totalDays;
          const segFill = Math.max(0, Math.min(1, (progress - segStart) * totalDays));
          return (
            <div key={i} className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-background/70">
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-brand to-gain"
                animate={{ width: `${segFill * 100}%` }}
                transition={{ duration: 0.4 }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10px] text-muted tabular-nums">
        <span>{(progress * 100).toFixed(1)}% of window</span>
        <span>
          {session.cursor}/{session.plan.length} fills
        </span>
      </div>
    </div>
  );
}

/** Time-lapse control. Changing rate credits elapsed time at the old rate. */
function SpeedControl({ session }: { session: AiSession }) {
  const { setSpeed } = useAiSession();
  return (
    <div className="rounded-xl border border-border bg-background/40 px-3.5 py-3">
      <div className="flex items-center gap-2">
        <FastForward className="h-3.5 w-3.5 text-muted" />
        <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">Time-lapse</p>
        <span className="ml-auto font-mono text-[11px] text-muted tabular-nums">{sessionClockRate(session)}</span>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {SPEEDS.map((s) => {
          const active = session.speed === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setSpeed(s.id)}
              title={s.hint}
              className={`rounded-lg border py-1.5 font-mono text-[11px] font-semibold transition-colors ${
                active
                  ? "border-brand/50 bg-brand/12 text-foreground"
                  : "border-border text-muted hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[10.5px] leading-snug text-muted">
        {session.speed === "1x"
          ? "Running in real time — one session day per real day."
          : `Time-lapse: ${SPEEDS.find((s) => s.id === session.speed)?.hint}. The window still closes only when the session clock reaches the end.`}
      </p>
    </div>
  );
}

/* ------------------------------ equity curve -------------------------- */

function EquityCurve({ session }: { session: AiSession }) {
  const curve = useMemo(() => sessionEquityCurve(session), [session.cursor, session.equity]);
  if (curve.length < 2) return null;

  const min = Math.min(...curve, session.principal);
  const max = Math.max(...curve, session.principal);
  const range = max - min || 1;
  const x = (i: number) => (i / (curve.length - 1)) * 100;
  const y = (v: number) => 30 - ((v - min) / range) * 28 - 1;
  const line = curve.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" L");
  const up = curve[curve.length - 1] >= session.principal;
  const color = up ? "#00c896" : "#f6465d";

  return (
    <div className="rounded-xl border border-border bg-background/40 px-3.5 py-3">
      <div className="flex items-center justify-between">
        <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">
          <Activity className="h-3 w-3" /> Equity curve
        </p>
        <span className="font-mono text-[11px] text-muted tabular-nums">
          start {fmtUsd(session.principal, 0)} → now {fmtUsd(session.equity, 0)}
        </span>
      </div>
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="mt-2 h-20 w-full" aria-hidden>
        <line
          x1="0"
          x2="100"
          y1={y(session.principal)}
          y2={y(session.principal)}
          stroke="#868e96"
          strokeDasharray="2 2"
          strokeWidth="0.4"
          opacity="0.5"
        />
        <path d={`M${line} L100,30 L0,30 Z`} fill={color} opacity="0.1" />
        <path d={`M${line}`} fill="none" stroke={color} strokeWidth="0.7" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

/* ------------------------------ header ------------------------------- */

function StatusHeader({ session }: { session: AiSession }) {
  const stats = sessionStats(session);
  const pnl = session.equity - session.principal;
  const pnlPct = (pnl / session.principal) * 100;
  const floorPct = ((session.floorUsd - session.principal) / session.principal) * 100;
  const nextMilestone = MILESTONE_PCTS.find((m) => !session.milestonesHit.includes(m)) ?? 300;
  const floorLevel = 100 + floorPct;
  const currentLevel = 100 + pnlPct;
  const nextLevel = 100 + nextMilestone;
  const railPct = Math.max(0, Math.min(100, ((currentLevel - floorLevel) / (nextLevel - floorLevel)) * 100));

  return (
    <section className="rounded-2xl border border-border bg-surface/60 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-brand/30 bg-brand/10">
            <Bot className="h-5.5 w-5.5 text-brand" />
            {session.phase === "running" && (
              <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                <span className="absolute h-full w-full animate-ping rounded-full bg-gain opacity-70" />
                <span className="relative h-2.5 w-2.5 rounded-full bg-gain" />
              </span>
            )}
          </span>
          <div>
            <h2 className="text-base font-semibold tracking-tight">AxAI · Autonomous engine</h2>
            <p className="text-xs text-muted">
              {session.strategy} · loss threshold {fmtPct(floorPct)} · {durationDays(session.durationId)}-day window
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-muted">Engine equity</p>
          <p className="font-mono text-2xl font-semibold tabular-nums tracking-tight">{fmtUsd(session.equity)}</p>
          <p className={`font-mono text-[13px] font-medium tabular-nums ${pnl >= 0 ? "text-gain" : "text-loss"}`}>
            {fmtPct(pnlPct)} ({fmtUsd(pnl)})
          </p>
        </div>
      </div>

      <SessionClock session={session} />

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <SpeedControl session={session} />
        <EquityCurve session={session} />
      </div>

      {/* floor → next-milestone rail */}
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted">
          <span className="inline-flex items-center gap-1">
            <ShieldAlert className="h-3 w-3 text-loss" /> floor {fmtUsd(session.floorUsd, 0)}
          </span>
          <span className="inline-flex items-center gap-1">
            next <Target className="h-3 w-3 text-gain" /> +{nextMilestone}% (
            {fmtUsd(session.principal * (1 + nextMilestone / 100), 0)})
          </span>
        </div>
        <div className="relative h-2 overflow-hidden rounded-full bg-background/70">
          <motion.div
            className={`absolute inset-y-0 left-0 rounded-full ${
              pnl >= 0 ? "bg-gradient-to-r from-brand to-gain" : "bg-gradient-to-r from-loss to-[#ff8a5c]"
            }`}
            animate={{ width: `${railPct}%` }}
            transition={{ type: "spring", stiffness: 80, damping: 20 }}
          />
        </div>
      </div>

      {/* milestone chips */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {MILESTONE_PCTS.map((m) => {
          const hit = session.milestonesHit.includes(m);
          return (
            <span
              key={m}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums transition-colors ${
                hit ? "border-gain/40 bg-gain/12 text-gain" : "border-border bg-background/40 text-muted"
              }`}
            >
              {hit ? <Check className="h-2.5 w-2.5" /> : null}+{m}%
            </span>
          );
        })}
      </div>

      {/* performance grid */}
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-3.5 text-[13px] sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Entrusted" value={fmtUsd(session.principal, 0)} />
        <Stat
          label="Win rate"
          value={`${stats.winRate.toFixed(0)}%`}
          sub={`${stats.wins}W / ${stats.losses}L`}
        />
        <Stat
          label="Profit factor"
          value={stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2)}
        />
        <Stat label="Payoff ratio" value={stats.payoff === Infinity ? "∞" : stats.payoff.toFixed(2)} />
        <Stat
          label="Max drawdown"
          value={`${(stats.maxDrawdown * 100).toFixed(1)}%`}
          tone={stats.maxDrawdown > AI_CONFIG.maxDrawdownFromPeakPct ? "loss" : undefined}
        />
        <Stat label="Costs paid" value={fmtUsd(session.feesPaid, 0)} sub={`${AI_CONFIG.feeBps} bps / fill`} />
      </div>

      {session.phase !== "running" && (
        <div className="mt-4">
          {session.outcome === "floor" ? (
            <div className="flex items-center gap-2 rounded-xl border border-loss/30 bg-loss/10 px-3.5 py-2.5 text-[13px] text-loss">
              <ShieldAlert className="h-4 w-4" />
              <span>
                <b>Loss threshold hit.</b> Engine flattened the book at {fmtUsd(session.equity)} and settled.
              </span>
            </div>
          ) : session.outcome === "halt" ? (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 text-[13px] text-muted">
              <OctagonX className="h-4 w-4" />
              <span>Halted by operator at {fmtUsd(session.equity)}. Funds returned to free cash.</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-gain/30 bg-gain/10 px-3.5 py-2.5 text-[13px] text-gain">
              <Timer className="h-4 w-4" />
              <span>
                <b>Window complete</b> — the session clock reached the end of the{" "}
                {durationDays(session.durationId)}-day window. Final equity {fmtUsd(session.equity)} ({fmtPct(pnlPct)}),
                settled to your fund.
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "loss" | "gain";
}) {
  return (
    <div>
      <p className="text-[11px] text-muted">{label}</p>
      <p
        className={`mt-0.5 font-mono font-medium tabular-nums ${
          tone === "loss" ? "text-loss" : tone === "gain" ? "text-gain" : ""
        }`}
      >
        {value}
        {sub && <span className="ml-1.5 text-xs font-normal text-muted">{sub}</span>}
      </p>
    </div>
  );
}

/* ---------------------------- setup form ----------------------------- */

function SetupForm() {
  const { account, entrustToAi } = useAccount();
  const { start } = useAiSession();
  const [amount, setAmount] = useState("2000");
  const [durationId, setDurationId] = useState<(typeof DURATIONS)[number]["id"]>("7d");
  const [lossPct, setLossPct] = useState(45);
  const [speed, setSpeed] = useState<SpeedId>(DEFAULT_SPEED);
  const [err, setErr] = useState<string | null>(null);

  const cash = account.cash;
  const amt = parseFloat(amount || "0");
  const days = durationDays(durationId);
  const wallMs = (days * DAY) / speedMult(speed);

  const begin = () => {
    setErr(null);
    if (!(amt > 0)) return setErr("Enter an amount to entrust.");
    if (amt > cash) return setErr("Amount exceeds free funds.");
    const r = entrustToAi(amt);
    if (!r.ok) return setErr(r.msg);
    start(amt, durationId, lossPct, speed);
  };

  return (
    <section className="rounded-2xl border border-border bg-surface/60 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-brand/30 bg-brand/10">
          <BrainCircuit className="h-5.5 w-5.5 text-brand" />
        </span>
        <div>
          <h2 className="text-base font-semibold tracking-tight">AxAI · Autonomous trading engine</h2>
          <p className="text-xs text-muted">
            Hand over funds, set the window, and the engine trades it to the end.
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="ai-amount" className="text-[13px] font-medium">
              Amount to entrust
            </label>
            <span className="text-xs text-muted">Free funds: {fmtUsd(cash)}</span>
          </div>
          <div className="relative">
            <CircleDollarSign className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              id="ai-amount"
              type="number"
              min="0"
              step="10"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="input-dark pl-9 font-mono"
            />
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {[25, 50, 75, 100].map((p) => (
              <button
                key={p}
                onClick={() => setAmount(((cash * p) / 100).toFixed(2))}
                className="rounded-lg border border-border py-1.5 text-xs font-medium text-muted transition-colors hover:border-brand/50 hover:text-foreground"
              >
                {p}%
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[13px] font-medium">Trading window (runs to the end, regardless of profit)</p>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
            {DURATIONS.map((d) => (
              <button
                key={d.id}
                onClick={() => setDurationId(d.id)}
                className={`rounded-lg border py-2 text-xs font-semibold transition-colors ${
                  durationId === d.id
                    ? "border-brand/50 bg-brand/10 text-foreground"
                    : "border-border text-muted hover:text-foreground"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="ai-loss" className="text-[13px] font-medium">
              Loss threshold
            </label>
            <span className="font-mono text-[13px] font-semibold text-loss tabular-nums">−{lossPct}%</span>
          </div>
          <input
            id="ai-loss"
            type="range"
            min={10}
            max={55}
            step={5}
            value={lossPct}
            onChange={(e) => setLossPct(Number(e.target.value))}
            className="w-full accent-[#f6465d]"
          />
          <p className="mt-1 text-[11px] text-muted">
            The only automatic stop: if equity pierces this level the engine flattens everything and settles.
          </p>
        </div>

        <div>
          <p className="mb-1.5 text-[13px] font-medium">Time-lapse</p>
          <div className="grid grid-cols-4 gap-1.5">
            {SPEEDS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSpeed(s.id)}
                title={s.hint}
                className={`rounded-lg border py-2 font-mono text-[11px] font-semibold transition-colors ${
                  speed === s.id
                    ? "border-brand/50 bg-brand/10 text-foreground"
                    : "border-border text-muted hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-muted">
            {days} session days at {SPEEDS.find((s) => s.id === speed)?.label} ≈{" "}
            <span className="font-mono text-foreground">{fmtSpan(wallMs)}</span> to watch. The engine keeps running
            while you&apos;re away.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-background/40 p-3">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">
            <Trophy className="h-3 w-3 text-gain" /> Profit milestones it will chase
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {MILESTONE_PCTS.map((m) => (
              <span
                key={m}
                className="rounded-full border border-gain/25 bg-gain/8 px-2 py-0.5 font-mono text-[10px] font-semibold text-gain tabular-nums"
              >
                +{m}%
              </span>
            ))}
          </div>
        </div>

        {err && <p className="rounded-lg border border-loss/30 bg-loss/10 px-3 py-2 text-[13px] text-loss">{err}</p>}

        <button
          onClick={begin}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand to-gain py-3.5 text-sm font-bold text-[#071018] shadow-[0_12px_32px_-10px_rgba(46,144,250,0.6)] transition-transform active:scale-[0.99]"
        >
          <Sparkles className="h-4.5 w-4.5" />
          Launch AxAI
        </button>
        <p className="text-center text-[11px] text-muted">
          {AI_CONFIG.cycleHours}h cycles · {AI_CONFIG.ticksPerCycle} scans each · profits settle when the window ends
        </p>
      </div>
    </section>
  );
}

/* --------------------------- thought log ----------------------------- */

type LogKind = "scan" | "entry" | "win" | "loss" | "milestone" | "derisk";
interface LogLine {
  kind: LogKind;
  text: string;
  at: number;
}

/**
 * Bullet-timeline thought process. Every resolved fill is a bullet whose status
 * icon checks green (profit) or cancels red (loss); scans, milestones and
 * de-risk events render as neutral bullets on the same rail. Everything is
 * stamped in session time, and scanner chatter is derived from the session
 * clock rather than a wall timer, so the log is stable across reloads and paces
 * itself to the window.
 */
function ThoughtLog({ session }: { session: AiSession }) {
  const lines = useMemo<LogLine[]>(() => {
    const out: LogLine[] = [];
    for (const t of session.trades) {
      out.push({
        kind: "entry",
        text: `${t.dir} ${t.symbol} · ${t.strategy} — ${t.signal}`,
        at: t.entryAt,
      });
      out.push({
        kind: t.pnl >= 0 ? "win" : "loss",
        text: `Closed ${t.symbol} ${t.dir === "LONG" ? "long" : "short"} at ${t.movePct >= 0 ? "+" : ""}${t.movePct.toFixed(2)}% on ${fmtUsd(t.sizeUsd, 0)} notional → ${
          t.pnl >= 0 ? "+" : "−"
        }${fmtUsd(Math.abs(t.pnl))} · ${t.exit}`,
        at: t.at,
      });
    }
    for (const ev of session.events) {
      out.push({
        kind: ev.kind === "milestone" ? "milestone" : ev.kind === "derisk" ? "derisk" : "scan",
        text: ev.text,
        at: ev.at,
      });
    }
    for (const s of sessionScanLines(session, 16)) {
      out.push({ kind: "scan", text: s.text, at: s.at });
    }
    return out.sort((a, b) => a.at - b.at).slice(-80);
  }, [session.trades, session.events, session.clockMs, session.startAt]);

  const icon = (k: LogKind) => {
    switch (k) {
      case "win":
        return (
          <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border border-gain/50 bg-gain/15">
            <Check className="h-3 w-3 text-gain" />
          </span>
        );
      case "loss":
        return (
          <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border border-loss/50 bg-loss/15">
            <CircleX className="h-3 w-3 text-loss" />
          </span>
        );
      case "entry":
        return (
          <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border border-brand/50 bg-brand/15">
            <ChevronRight className="h-3 w-3 text-brand" />
          </span>
        );
      case "milestone":
        return (
          <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border border-gain/50 bg-gain/15">
            <Trophy className="h-3 w-3 text-gain" />
          </span>
        );
      case "derisk":
        return (
          <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border border-[#ff8a5c]/50 bg-[#ff8a5c]/15">
            <ShieldAlert className="h-3 w-3 text-[#ff8a5c]" />
          </span>
        );
      default:
        return (
          <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border border-border bg-background/60">
            <ScanLine className="h-2.5 w-2.5 text-muted" />
          </span>
        );
    }
  };

  const textColor = (k: LogKind) =>
    k === "win"
      ? "text-gain"
      : k === "loss"
        ? "text-loss"
        : k === "entry"
          ? "text-foreground"
          : k === "milestone"
            ? "text-gain"
            : k === "derisk"
              ? "text-[#ff8a5c]"
              : "text-muted";

  const nextScanIn = useMemo(() => {
    const next = (Math.floor(session.clockMs / AI_CONFIG.scanMs) + 1) * AI_CONFIG.scanMs;
    return (next - session.clockMs) / speedMult(session.speed);
  }, [session.clockMs, session.speed]);

  return (
    <section className="rounded-2xl border border-border bg-surface/60">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Cpu className="h-4 w-4 text-brand" /> Thought process
        </h2>
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted">
          <Radio className={`h-3 w-3 ${session.phase === "running" ? "animate-pulse text-gain" : "text-muted"}`} />
          {session.phase === "running" ? `next scan ${fmtSpan(nextScanIn)}` : "idle"}
        </span>
      </div>
      <div className="no-scrollbar h-80 overflow-y-auto px-4 py-3 sm:h-[22rem]">
        {lines.length === 0 && <p className="text-[13px] text-muted">Engine booting…</p>}
        <div className="relative space-y-2.5 before:absolute before:inset-y-1 before:left-[9px] before:w-px before:bg-border/60">
          {lines.map((l, i) => (
            <motion.div
              key={`${l.at}-${i}`}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25 }}
              className="relative flex items-start gap-2.5"
            >
              {icon(l.kind)}
              <div className="min-w-0 flex-1 pt-0.5">
                <p className={`text-[12.5px] leading-snug ${textColor(l.kind)}`}>{l.text}</p>
                <p className="mt-0.5 font-mono text-[10px] text-muted/60 tabular-nums">
                  {fmtStamp(l.at, session.startAt)}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------- live book ------------------------------ */

/**
 * Positions the engine is holding right now, marked against live prices. This
 * is what makes the book breathe between fills instead of only showing settled
 * trades.
 */
function LiveBook({ session }: { session: AiSession }) {
  const { quotes } = useLivePrices();
  const { fng } = useAiSession();

  const live: LiveContext = useMemo(
    () => ({
      quoteFor: (symbol) => {
        const q = quotes.get(symbol);
        return q ? { price: q.price, changePct: q.changePct } : undefined;
      },
      fng,
    }),
    [quotes, fng]
  );

  const open = sessionOpenPositions(session, live);
  const openPnl = open.reduce((a, p) => a + p.unrealized, 0);

  return (
    <section className="rounded-2xl border border-border bg-surface/60">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Layers className="h-4 w-4 text-brand" /> Live book
        </h2>
        <span className="font-mono text-[11px] tabular-nums text-muted">
          {open.length} open ·{" "}
          <span className={openPnl >= 0 ? "text-gain" : "text-loss"}>
            {openPnl >= 0 ? "+" : "−"}
            {fmtUsd(Math.abs(openPnl))}
          </span>{" "}
          unrealized
        </span>
      </div>
      <div className="divide-y divide-border/50">
        {open.length === 0 && (
          <p className="px-4 py-5 text-center text-[13px] text-muted">
            {session.phase === "running" ? "Flat — scanning for the next setup." : "Book flat — session closed."}
          </p>
        )}
        {open.map((p) => (
          <div key={p.id} className="px-4 py-3">
            <div className="flex items-center gap-3">
              <InstrumentLogo symbol={p.symbol} kind={p.kind} size={28} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-[13px] font-semibold leading-tight">
                  {p.symbol}
                  <span
                    className={`inline-flex items-center gap-0.5 rounded px-1 py-px font-mono text-[9.5px] font-bold ${
                      p.dir === "LONG" ? "bg-gain/12 text-gain" : "bg-loss/12 text-loss"
                    }`}
                  >
                    {p.dir === "LONG" ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
                    {p.dir}
                  </span>
                  <span className="rounded border border-border px-1 py-px font-mono text-[9.5px] text-muted">
                    {p.leverage}×
                  </span>
                </p>
                <p className="mt-0.5 truncate text-[11px] text-muted">
                  {fmtUsd(p.marginUsd, 0)} margin · {fmtUsd(p.notionalUsd, 0)} notional
                </p>
              </div>
              <div className="text-right">
                <p className={`font-mono text-[13px] font-semibold tabular-nums ${p.unrealized >= 0 ? "text-gain" : "text-loss"}`}>
                  {p.unrealized >= 0 ? "+" : "−"}
                  {fmtUsd(Math.abs(p.unrealized))}
                </p>
                <p className={`font-mono text-[11px] tabular-nums ${p.unrealized >= 0 ? "text-gain" : "text-loss"}`}>
                  {p.unrealizedPct >= 0 ? "+" : "−"}
                  {Math.abs(p.unrealizedPct).toFixed(2)}%
                </p>
              </div>
            </div>

            <div className="mt-2 flex items-center gap-3 font-mono text-[10.5px] tabular-nums text-muted">
              <span>entry {p.entryPrice.toLocaleString("en-US", { maximumFractionDigits: p.entryPrice < 5 ? 4 : 2 })}</span>
              <span>mark {p.markPrice.toLocaleString("en-US", { maximumFractionDigits: p.markPrice < 5 ? 4 : 2 })}</span>
              <span className={(p.movePct >= 0) === (p.dir === "LONG") ? "text-gain" : "text-loss"}>
                {p.movePct >= 0 ? "+" : ""}
                {p.movePct.toFixed(2)}%
              </span>
              <span className="ml-auto">hold {(p.progress * 100).toFixed(0)}%</span>
            </div>

            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-background/70">
              <div
                className={`h-full rounded-full ${p.unrealized >= 0 ? "bg-gain" : "bg-loss"}`}
                style={{ width: `${Math.max(2, p.progress * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------- trade blotter --------------------------- */

function PnlHistory({ session }: { session: AiSession }) {
  const stats = sessionStats(session);
  const [filter, setFilter] = useState<"all" | "win" | "loss">("all");
  const rows = useMemo(() => {
    const reversed = [...session.trades].reverse();
    if (filter === "all") return reversed;
    return reversed.filter((t) => (filter === "win" ? t.pnl >= 0 : t.pnl < 0));
  }, [session.trades, filter]);

  return (
    <section className="rounded-2xl border border-border bg-surface/60">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Gauge className="h-4 w-4 text-brand" /> Session P&amp;L
        </h2>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border p-0.5">
            {(["all", "win", "loss"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md px-2 py-1 text-[10.5px] font-semibold capitalize transition-colors ${
                  filter === f ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <span className="hidden text-xs text-muted sm:inline">
            gross <span className="font-mono text-gain">+{fmtUsd(stats.grossProfit, 0)}</span> /{" "}
            <span className="font-mono text-loss">−{fmtUsd(stats.grossLoss, 0)}</span>
          </span>
        </div>
      </div>
      <div className="no-scrollbar max-h-96 overflow-y-auto">
        {rows.length === 0 && (
          <p className="px-4 py-6 text-center text-[13px] text-muted">No fills in this view yet.</p>
        )}
        <ul className="divide-y divide-border/50">
          {rows.map((t) => {
            const win = t.pnl >= 0;
            return (
              <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                <InstrumentLogo symbol={t.symbol} kind={kindOf(t.symbol)} size={26} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-[13px] font-semibold leading-tight">
                    {t.symbol}
                    <span
                      className={`font-mono text-[10px] font-bold ${t.dir === "LONG" ? "text-gain" : "text-loss"}`}
                    >
                      {t.dir}
                    </span>
                    <span className="rounded border border-border px-1 font-mono text-[9.5px] font-normal text-muted">
                      {t.leverage}×
                    </span>
                  </p>
                  <p className="truncate text-[11px] text-muted">
                    {t.strategy} · {fmtUsd(t.sizeUsd, 0)} notional · fees {fmtUsd(t.fees)}
                  </p>
                </div>
                <div className="hidden text-right sm:block">
                  <p className="font-mono text-[11px] tabular-nums text-muted">
                    {t.movePct >= 0 ? "+" : ""}
                    {t.movePct.toFixed(2)}%
                  </p>
                  <p className="font-mono text-[10px] tabular-nums text-muted/70">
                    {fmtStamp(t.at, session.startAt)}
                  </p>
                </div>
                <div className="w-[6.5rem] text-right">
                  <p className={`font-mono text-[13px] font-semibold tabular-nums ${win ? "text-gain" : "text-loss"}`}>
                    {win ? "+" : "−"}
                    {fmtUsd(Math.abs(t.pnl))}
                  </p>
                  <p className={`font-mono text-[11px] tabular-nums ${win ? "text-gain" : "text-loss"}`}>
                    {win ? "+" : "−"}
                    {Math.abs(t.pnlPct).toFixed(2)}% · eq {fmtUsd(t.equityAfter, 0)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/* ---------------------------- run history ----------------------------- */

function RunHistory() {
  const { history, clearHistory } = useAiSession();
  if (history.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border bg-surface/60">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
          <History className="h-4 w-4 text-brand" /> Past runs
        </h2>
        <button
          onClick={clearHistory}
          className="text-[11px] font-medium text-muted transition-colors hover:text-foreground"
        >
          Clear
        </button>
      </div>
      <ul className="divide-y divide-border/50">
        {history.map((h) => {
          const pnl = h.equity - h.principal;
          const pnlPct = (pnl / h.principal) * 100;
          const days = Math.round((h.endedAt - h.startAt) / DAY);
          return (
            <li key={h.id} className="flex items-center gap-3 px-4 py-2.5">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
                  pnl >= 0 ? "border-gain/30 bg-gain/10 text-gain" : "border-loss/30 bg-loss/10 text-loss"
                }`}
              >
                {pnl >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold leading-tight">
                  {DURATIONS.find((d) => d.id === h.durationId)?.label} · {h.trades} fills
                </p>
                <p className="text-[11px] text-muted">
                  {days}d run · {h.winRate.toFixed(0)}% win · fees {fmtUsd(h.fees, 0)}
                  {h.outcome === "halt" ? " · halted" : h.outcome === "floor" ? " · stopped out" : ""}
                </p>
              </div>
              <div className="text-right">
                <p className={`font-mono text-[13px] font-semibold tabular-nums ${pnl >= 0 ? "text-gain" : "text-loss"}`}>
                  {fmtPct(pnlPct)}
                </p>
                <p className="font-mono text-[11px] tabular-nums text-muted">{fmtUsd(h.equity, 0)}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------- panel -------------------------------- */

function SessionMemo({ session }: { session: AiSession }) {
  const { stop, reset } = useAiSession();
  const running = session.phase === "running";
  const stats = sessionStats(session);

  return (
    <>
      <section className="rounded-2xl border border-border bg-surface/60 p-4">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Zap className="h-4 w-4 text-brand" /> Engine controls
        </h2>
        <div className="mt-3 flex flex-col gap-2">
          {running ? (
            <button
              onClick={stop}
              className="flex items-center justify-center gap-2 rounded-xl border border-loss/40 bg-loss/10 py-2.5 text-sm font-semibold text-loss transition-colors hover:bg-loss/20"
            >
              <OctagonX className="h-4 w-4" /> Halt &amp; settle now
            </button>
          ) : (
            <button
              onClick={reset}
              className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand to-gain py-2.5 text-sm font-semibold text-[#071018]"
            >
              <RotateCcw className="h-4 w-4" /> New mission
            </button>
          )}
          <p className="text-[11px] leading-relaxed text-muted">
            {AI_CONFIG.cycleHours}h cycles, {AI_CONFIG.ticksPerCycle} scans each. The engine never stops on profit — it
            runs until the {durationDays(session.durationId)}-day window closes. Hard floor {fmtUsd(session.floorUsd, 0)}{" "}
            · de-risk at {(AI_CONFIG.maxDrawdownFromPeakPct * 100).toFixed(0)}% drawdown.
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface/60 p-4 text-[13px]">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Scale className="h-4 w-4 text-muted" /> Session memo
        </h2>
        <ul className="mt-2.5 space-y-1.5 text-muted">
          <li className="flex justify-between">
            <span>Opened</span>
            <span className="font-mono">
              {new Date(session.startAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} ·{" "}
              {new Date(session.startAt).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" })}
            </span>
          </li>
          <li className="flex justify-between">
            <span>Window</span>
            <span className="font-mono">{DURATIONS.find((d) => d.id === session.durationId)?.label}</span>
          </li>
          <li className="flex justify-between">
            <span>Trades executed</span>
            <span className="font-mono">{session.trades.length}</span>
          </li>
          <li className="flex justify-between">
            <span>Current streak</span>
            <span className={`font-mono ${stats.streak >= 0 ? "text-gain" : "text-loss"}`}>
              {stats.streak > 0 ? `${stats.streak} wins` : stats.streak < 0 ? `${-stats.streak} losses` : "—"}
            </span>
          </li>
          <li className="flex justify-between">
            <span>Peak equity</span>
            <span className="font-mono">{fmtUsd(session.peak)}</span>
          </li>
          <li className="flex justify-between">
            <span>Milestones hit</span>
            <span className="font-mono">
              {session.milestonesHit.length}/{MILESTONE_PCTS.length}
            </span>
          </li>
          <li className="flex justify-between">
            <span>Fees &amp; slippage</span>
            <span className="font-mono">{fmtUsd(session.feesPaid)}</span>
          </li>
          <li className="flex justify-between">
            <span>Mode</span>
            <span className="font-mono">
              {session.speed === "1x" ? "Real time" : SPEEDS.find((s) => s.id === session.speed)?.label + " lapse"}
            </span>
          </li>
        </ul>
      </section>
    </>
  );
}

export function AiPanel() {
  const { session } = useAiSession();
  const { account } = useAccount();

  if (!session) {
    return (
      <div className="space-y-4">
        <SetupForm />
        {account.aiPrincipal > 0 && (
          <p className="text-center text-[13px] text-muted">
            {fmtUsd(account.aiPrincipal)} is still earmarked for the engine — launching a new session re-allocates it.
          </p>
        )}
        <RunHistory />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <StatusHeader session={session} />

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="min-w-0 space-y-4">
          <ThoughtLog session={session} />
          <PnlHistory session={session} />
        </div>
        <div className="min-w-0 space-y-4">
          <LiveBook session={session} />
          <SessionMemo session={session} />
        </div>
      </div>

      <RunHistory />
    </div>
  );
}
