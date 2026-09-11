"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Bot,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleDollarSign,
  CircleX,
  Cpu,
  Gauge,
  OctagonX,
  Radio,
  ScanLine,
  ShieldAlert,
  Sparkles,
  Target,
  Timer,
  TrendingDown,
  TrendingUp,
  Trophy,
} from "lucide-react";

import { InstrumentLogo } from "@/components/instrument-logo";
import { useAccount } from "@/lib/account-store";
import { useAiSession } from "@/lib/ai-session";
import {
  AI_CONFIG,
  DURATIONS,
  MILESTONE_PCTS,
  NEUTRAL_THOUGHTS,
  STRATEGIES,
  sessionStats,
  type AiSession,
} from "@/lib/ai-trader";

const fmtUsd = (v: number, frac = 2) =>
  `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: frac, maximumFractionDigits: frac })}`;

const fmtPct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`;

function fmtRemaining(endAt: number, startAt: number, now: number) {
  const left = Math.max(endAt - now, 0);
  const d = Math.floor(left / 86400000);
  const h = Math.floor((left % 86400000) / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  const s = Math.floor((left % 60000) / 1000);
  const parts = d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
  const total = endAt - startAt;
  const pct = Math.min(100, Math.max(0, ((now - startAt) / total) * 100));
  return { pct, parts };
}

/* ------------------------------ header ------------------------------- */

function StatusHeader({ session, now }: { session: AiSession; now: number }) {
  const { pct, parts } = fmtRemaining(session.endAt, session.startAt, now);
  const pnl = session.equity - session.principal;
  const pnlPct = (pnl / session.principal) * 100;
  const stats = sessionStats(session);
  const floorPct = ((session.floorUsd - session.principal) / session.principal) * 100;

  // drawdown rail: floor .. current .. next milestone
  const nextMilestone = MILESTONE_PCTS.find((m) => !session.milestonesHit.includes(m)) ?? 300;
  const floorLevel = 100 + floorPct; // e.g. 55 when floor is −45%
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
            <h1 className="text-base font-semibold tracking-tight">AxAI · Autonomous engine</h1>
            <p className="text-xs text-muted">
              {session.strategy} · runs until the window closes · loss threshold {fmtPct(floorPct)}
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

      {/* floor → next-milestone progress rail */}
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted">
          <span className="inline-flex items-center gap-1">
            <ShieldAlert className="h-3 w-3 text-loss" /> threshold {fmtUsd(session.floorUsd, 0)}
          </span>
          <span className="inline-flex items-center gap-1">
            next <Target className="h-3 w-3 text-gain" /> +{nextMilestone}% ({fmtUsd(session.principal * (1 + nextMilestone / 100), 0)})
          </span>
        </div>
        <div className="relative h-2 overflow-hidden rounded-full bg-background/70">
          <motion.div
            className={`absolute inset-y-0 left-0 rounded-full ${pnl >= 0 ? "bg-gradient-to-r from-brand to-gain" : "bg-gradient-to-r from-loss to-[#ff8a5c]"}`}
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
                hit
                  ? "border-gain/40 bg-gain/12 text-gain"
                  : "border-border bg-background/40 text-muted"
              }`}
            >
              {hit ? <Check className="h-2.5 w-2.5" /> : null}+{m}%
            </span>
          );
        })}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-3.5 text-[13px] sm:grid-cols-4">
        <div>
          <p className="text-[11px] text-muted">Entrusted</p>
          <p className="mt-0.5 font-mono font-medium tabular-nums">{fmtUsd(session.principal)}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted">Window left</p>
          <p className="mt-0.5 font-mono font-medium tabular-nums">{parts}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted">Win rate</p>
          <p className="mt-0.5 font-mono font-medium tabular-nums">
            {stats.winRate.toFixed(0)}% <span className="text-xs font-normal text-muted">({stats.wins}W/{stats.losses}L)</span>
          </p>
        </div>
        <div>
          <p className="text-[11px] text-muted">Profit factor</p>
          <p className="mt-0.5 font-mono font-medium tabular-nums">
            {stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2)}
          </p>
        </div>
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
                <b>Window complete.</b> Final equity {fmtUsd(session.equity)} — {fmtPct(pnlPct)} over{" "}
                {DURATIONS.find((d) => d.id === session.durationId)?.label.toLowerCase()}. Settled to your fund.
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* ---------------------------- setup form ----------------------------- */

function SetupForm() {
  const { account, entrustToAi } = useAccount();
  const { start } = useAiSession();
  const [amount, setAmount] = useState("2000");
  const [durationId, setDurationId] = useState<(typeof DURATIONS)[number]["id"]>("7d");
  const [lossPct, setLossPct] = useState(45);
  const [err, setErr] = useState<string | null>(null);

  const cash = account.cash;
  const amt = parseFloat(amount || "0");

  const begin = () => {
    setErr(null);
    if (!(amt > 0)) return setErr("Enter an amount to entrust.");
    if (amt > cash) return setErr("Amount exceeds free funds.");
    const r = entrustToAi(amt);
    if (!r.ok) return setErr(r.msg);
    start(amt, durationId, lossPct);
  };

  return (
    <section className="rounded-2xl border border-border bg-surface/60 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-brand/30 bg-brand/10">
          <BrainCircuit className="h-5.5 w-5.5 text-brand" />
        </span>
        <div>
          <h1 className="text-base font-semibold tracking-tight">AxAI · Autonomous trading engine</h1>
          <p className="text-xs text-muted">
            Hands off trading — the engine runs the whole window, rain or shine.
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="ai-amount" className="text-[13px] font-medium">Amount to entrust</label>
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
                  durationId === d.id ? "border-brand/50 bg-brand/10 text-foreground" : "border-border text-muted hover:text-foreground"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="ai-loss" className="text-[13px] font-medium">Loss threshold</label>
            <span className="font-mono text-[13px] font-semibold text-loss tabular-nums">−{lossPct}%</span>
          </div>
          <input id="ai-loss" type="range" min={10} max={55} step={5} value={lossPct} onChange={(e) => setLossPct(Number(e.target.value))} className="w-full accent-[#f6465d]" />
          <p className="mt-1 text-[11px] text-muted">
            The only automatic stop: if equity pierces this level the engine flattens everything and settles.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-background/40 p-3">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">
            <Trophy className="h-3 w-3 text-gain" /> Profit milestones it will chase
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {MILESTONE_PCTS.map((m) => (
              <span key={m} className="rounded-full border border-gain/25 bg-gain/8 px-2 py-0.5 font-mono text-[10px] font-semibold text-gain tabular-nums">
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
          Demo simulation · 4h cycles · profits settle when the window ends · Not financial advice
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
 * Bullet-timeline thought process. Every resolved trade is a bullet whose
 * status icon checks green (profit) or cancels red (loss); entries, scans,
 * milestones and de-risk events render as neutral bullets on the same rail.
 */
function ThoughtLog({ session }: { session: AiSession }) {
  const [scanLines, setScanLines] = useState<LogLine[]>([]);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // periodic scan chatter while the engine runs
  useEffect(() => {
    if (session.phase !== "running") return;
    const push = () =>
      setScanLines((prev) =>
        [...prev, { kind: "scan" as const, text: NEUTRAL_THOUGHTS[Math.floor(Math.random() * NEUTRAL_THOUGHTS.length)], at: Date.now() }].slice(-40)
      );
    const t = setInterval(push, 6500);
    return () => clearInterval(t);
  }, [session.phase]);

  // derived: trades + engine events, ordered by time
  const tradeLines = useMemo<LogLine[]>(() => {
    const out: LogLine[] = [];
    for (const t of session.trades) {
      out.push({
        kind: "entry",
        text: `${t.dir} ${t.symbol} · ${t.strategy} — ${t.signal}`,
        at: t.at - 1500,
      });
      out.push({
        kind: t.pnl >= 0 ? "win" : "loss",
        text: `Closed ${t.symbol} ${fmtPct(t.pnlPct)} on ${fmtUsd(t.sizeUsd, 0)} → ${t.pnl >= 0 ? "+" : "−"}${fmtUsd(Math.abs(t.pnl))} · ${t.exit}`,
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
    return out.sort((a, b) => a.at - b.at);
  }, [session.trades, session.events]);

  const lines = useMemo(
    () => [...tradeLines, ...scanLines].sort((a, b) => a.at - b.at).slice(-60),
    [tradeLines, scanLines]
  );

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const icon = (k: LogKind) => {
    switch (k) {
      case "win":
        return <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border border-gain/50 bg-gain/15"><Check className="h-3 w-3 text-gain" /></span>;
      case "loss":
        return <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border border-loss/50 bg-loss/15"><CircleX className="h-3 w-3 text-loss" /></span>;
      case "entry":
        return <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border border-brand/50 bg-brand/15"><ChevronRight className="h-3 w-3 text-brand" /></span>;
      case "milestone":
        return <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border border-gain/50 bg-gain/15"><Trophy className="h-3 w-3 text-gain" /></span>;
      case "derisk":
        return <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border border-[#ff8a5c]/50 bg-[#ff8a5c]/15"><ShieldAlert className="h-3 w-3 text-[#ff8a5c]" /></span>;
      default:
        return <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border border-border bg-background/60"><ScanLine className="h-2.5 w-2.5 text-muted" /></span>;
    }
  };

  const textColor = (k: LogKind) =>
    k === "win" ? "text-gain" : k === "loss" ? "text-loss" : k === "entry" ? "text-foreground" : k === "milestone" ? "text-gain" : k === "derisk" ? "text-[#ff8a5c]" : "text-muted";

  return (
    <section className="rounded-2xl border border-border bg-surface/60">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Cpu className="h-4 w-4 text-brand" /> Thought process
        </h2>
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted">
          <Radio className={`h-3 w-3 ${session.phase === "running" ? "animate-pulse text-gain" : "text-muted"}`} />
          {session.phase === "running" ? "streaming" : "idle"}
        </span>
      </div>
      <div ref={scrollerRef} className="no-scrollbar h-72 overflow-y-auto px-4 py-3 sm:h-80">
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
                  {new Date(l.at).toLocaleTimeString("en-US", { hour12: false })}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------- trade blotters -------------------------- */

function PnlHistory({ session }: { session: AiSession }) {
  const stats = sessionStats(session);
  const reversed = [...session.trades].reverse();
  return (
    <section className="rounded-2xl border border-border bg-surface/60">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Gauge className="h-4 w-4 text-brand" /> Session P&amp;L
        </h2>
        <span className="text-xs text-muted">
          gross <span className="font-mono text-gain">+{fmtUsd(stats.grossProfit, 0)}</span> / <span className="font-mono text-loss">−{fmtUsd(stats.grossLoss, 0)}</span>
        </span>
      </div>
      <div className="no-scrollbar max-h-96 overflow-y-auto">
        {reversed.length === 0 && <p className="px-4 py-6 text-center text-[13px] text-muted">No trades executed yet.</p>}
        <ul className="divide-y divide-border/50">
          {reversed.map((t) => {
            const win = t.pnl >= 0;
            return (
              <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                <InstrumentLogo symbol={t.symbol} kind={t.symbol.length > 4 ? "forex" : "stock"} size={26} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold leading-tight">
                    {t.symbol} <span className={`font-mono text-[10px] font-bold ${t.dir === "LONG" ? "text-gain" : "text-loss"}`}>{t.dir}</span>
                  </p>
                  <p className="truncate text-[11px] text-muted">{t.strategy}</p>
                </div>
                <div className="hidden min-w-0 flex-1 sm:block">
                  <p className="truncate text-[11px] text-muted">{t.signal}</p>
                </div>
                <div className="text-right">
                  <p className={`font-mono text-[13px] font-semibold tabular-nums ${win ? "text-gain" : "text-loss"}`}>
                    {win ? "+" : "−"}{fmtUsd(Math.abs(t.pnl))}
                  </p>
                  <p className={`font-mono text-[11px] tabular-nums ${win ? "text-gain" : "text-loss"}`}>
                    {win ? "+" : "−"}{Math.abs(t.pnlPct).toFixed(2)}% · eq {fmtUsd(t.equityAfter, 0)}
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

function PositionsWatch({ session }: { session: AiSession }) {
  const recent = session.trades.slice(-4).reverse();
  const stats = sessionStats(session);
  return (
    <section className="rounded-2xl border border-border bg-surface/60 p-4">
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
        <TrendingUp className="h-4 w-4 text-brand" /> Current book
      </h2>
      <p className="mt-1 text-[11px] text-muted">Engine rotates its book every 4h cycle — last positions:</p>
      <div className="mt-3 space-y-2">
        {recent.length === 0 && <p className="text-[13px] text-muted">Flat — scanning for setups.</p>}
        {recent.map((t) => (
          <div key={t.id} className="flex items-center gap-3 rounded-xl border border-border bg-background/40 px-3 py-2">
            <InstrumentLogo symbol={t.symbol} kind={t.symbol.length > 4 ? "forex" : "stock"} size={24} />
            <span className="text-[13px] font-semibold">{t.symbol}</span>
            <span className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold ${t.dir === "LONG" ? "bg-gain/10 text-gain" : "bg-loss/10 text-loss"}`}>{t.dir}</span>
            <span className="ml-auto font-mono text-xs tabular-nums text-muted">{fmtUsd(t.sizeUsd, 0)}</span>
            <span className={`font-mono text-xs font-semibold tabular-nums ${t.pnl >= 0 ? "text-gain" : "text-loss"}`}>{t.pnl >= 0 ? "+" : "−"}{Math.abs(t.pnlPct).toFixed(2)}%</span>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
        <div className="rounded-xl border border-border bg-background/40 px-3 py-2">
          <p className="text-[11px] text-muted">Best trade</p>
          <p className="font-mono font-semibold text-gain tabular-nums">{stats.wins ? fmtUsd(stats.bestTrade) : "—"}</p>
        </div>
        <div className="rounded-xl border border-border bg-background/40 px-3 py-2">
          <p className="text-[11px] text-muted">Worst trade</p>
          <p className="font-mono font-semibold text-loss tabular-nums">{stats.losses ? fmtUsd(stats.worstTrade) : "—"}</p>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------- panel -------------------------------- */

export function AiPanel() {
  const { session, stop, reset } = useAiSession();
  const { account } = useAccount();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!session) {
    return (
      <div className="space-y-4">
        <SetupForm />
        {account.aiPrincipal > 0 && (
          <p className="text-center text-[13px] text-muted">
            {fmtUsd(account.aiPrincipal)} is still earmarked for the engine — launching a new session re-allocates it.
          </p>
        )}
      </div>
    );
  }

  const running = session.phase === "running";

  return (
    <div className="space-y-4">
      <StatusHeader session={session} now={now} />

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="min-w-0 space-y-4">
          <ThoughtLog session={session} />
          <PnlHistory session={session} />
        </div>
        <div className="min-w-0 space-y-4">
          <PositionsWatch session={session} />
          <section className="rounded-2xl border border-border bg-surface/60 p-4">
            <h2 className="text-sm font-semibold tracking-tight">Engine controls</h2>
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
                  <ChevronRight className="h-4 w-4" /> New mission
                </button>
              )}
              <p className="text-[11px] leading-relaxed text-muted">
                The engine trades every 4h cycle and never stops on profit — it runs until{" "}
                {DURATIONS.find((d) => d.id === session.durationId)?.label.toLowerCase()} elapses. Hard floor{" "}
                {fmtUsd(session.floorUsd, 0)} · de-risk at {(AI_CONFIG.maxDrawdownFromPeakPct * 100).toFixed(0)}% drawdown.
              </p>
            </div>
          </section>
          <section className="rounded-2xl border border-border bg-surface/60 p-4 text-[13px]">
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
              <TrendingDown className="h-4 w-4 text-muted" /> Session memo
            </h2>
            <ul className="mt-2.5 space-y-1.5 text-muted">
              <li className="flex justify-between"><span>Started</span><span className="font-mono">{new Date(session.startAt).toLocaleString()}</span></li>
              <li className="flex justify-between"><span>Window</span><span className="font-mono">{DURATIONS.find((d) => d.id === session.durationId)?.label}</span></li>
              <li className="flex justify-between"><span>Trades</span><span className="font-mono">{session.trades.length}</span></li>
              <li className="flex justify-between"><span>Peak equity</span><span className="font-mono">{fmtUsd(session.peak)}</span></li>
              <li className="flex justify-between"><span>Milestones hit</span><span className="font-mono">{session.milestonesHit.length}/{MILESTONE_PCTS.length}</span></li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
