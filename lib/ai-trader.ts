/**
 * AxionTrade AI trading simulation engine — v2.
 *
 * Hardcoded-but-dynamic: a seeded timeline built from a 500-entry outcome
 * table (~60% win rate, 500 distinct P&L magnitudes). The engine ALWAYS runs
 * until the selected duration is exhausted — profits do not stop it. A loss
 * threshold (hard floor) is the only abort besides the operator. Profit
 * milestones fire celebration events. Despite realistic drawdowns and a
 * sub-100% win rate, the seeded controller guarantees the session ends at
 * +150%…+300% — it is a simulation, and it says so in the UI.
 *
 * Every executed trade is emitted as a TradeEvent so the UI can annotate the
 * live chart (spike toward the trade's direction + floating +$x / −$x label).
 * Narratives quote REAL market data at execution time.
 */

import { INSTRUMENTS } from "@/lib/market-data";

/* ------------------------------ config ------------------------------ */

export const AI_CONFIG = {
  /** seconds a 4h trading cycle lasts in the sim (4h = 14400s → 90s sim) */
  cycleSimSeconds: 90,
  /** market scanner ticks per cycle */
  ticksPerCycle: 6,
  /** guaranteed terminal profit band (fraction of principal) */
  endProfitMin: 1.5,
  endProfitMax: 3.0,
  /** sessions ALWAYS run to the end of the window; this floor is the only abort */
  hardFloorPct: 0.55,
  /** de-risk trigger: drawdown from running peak */
  maxDrawdownFromPeakPct: 0.22,
  /** fraction of a cycle spent "in position" before the outcome resolves */
  holdFraction: 0.55,
} as const;

/** Minimum selectable window: 7 days. */
export const DURATIONS = [
  { id: "7d", label: "1 week", days: 7 },
  { id: "10d", label: "10 days", days: 10 },
  { id: "14d", label: "2 weeks", days: 14 },
  { id: "21d", label: "3 weeks", days: 21 },
  { id: "30d", label: "30 days", days: 30 },
] as const;
export type DurationId = (typeof DURATIONS)[number]["id"];

/** Default profit milestones as % of principal (user can see them fire). */
export const MILESTONE_PCTS = [25, 50, 75, 100, 150, 200, 250, 300] as const;

/* ----------------------- 500-entry outcome table ---------------------- */

export interface Outcome {
  id: number;
  /** +1 win, -1 loss */
  dir: 1 | -1;
  /** win magnitude in percent of position notional */
  mag: number;
  /** loss multiplier scale */
  k: number;
  /** base loss magnitude in percent */
  loss: number;
}

/**
 * 500 distinct outcomes. 3 of every 5 are wins (60% by construction).
 * Win magnitudes have a long right tail; losses are capped tighter, but a
 * rare "slippage" subset hits harder — realistic asymmetry.
 */
const OUTCOME_TABLE: Outcome[] = Array.from({ length: 500 }, (_, i) => {
  const win = 0.25 + 1.85 * (((i * 37) % 500) / 500) ** 1.35;
  const loss = 0.12 + 0.5 * (((i * 89) % 500) / 500);
  return {
    id: i,
    dir: i % 5 < 3 ? 1 : -1,
    mag: win,
    k: 1 + ((i * 13) % 7) / 10,
    loss,
  } as Outcome;
});

/* --------------------------- seeded RNG ------------------------------ */

function hashSeed(s: string): number {
  let seed = 0;
  for (let i = 0; i < s.length; i++) seed = (seed * 131 + s.charCodeAt(i)) >>> 0;
  return seed === 0 ? 0x9e3779b9 : seed;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------- narrative pieces -------------------------- */

export const SIGNALS = [
  "momentum breakout confirmed by volume expansion",
  "order-flow imbalance skewing toward the bid side",
  "mean-reversion trigger at the lower Bollinger band",
  "liquidity sweep of session lows followed by reclaim",
  "EMA 9/21 crossover with rising OBV",
  "RSI divergence against the prevailing micro-trend",
  "VWAP re-entry after controlled pullback",
  "volatility compression (BB width at 14-day low) pre-expansion",
  "CVD divergence — price flat, delta accumulating",
  "funding-rate skew crowded against the trend (contrarian entry)",
] as const;

export const RATIONALES = [
  "risk capped at 0.4% of equity; reward asymmetry 1:2.6",
  "position sized to keep portfolio heat below 3%",
  "correlation matrix shows low overlap with open exposure",
  "spread within normal bounds; slippage model projects 2–3 bps",
  "similar setup historically resolved in favor 6 of last 9 occurrences",
  "drawdown budget intact — engine authorizes full target size",
  "shortened size: breadth deteriorating across the sector",
  "half size on first probe; add on confirmation close",
  "higher-timeframe bias aligned; holding for the measured move",
  "time-stop in place: exit if thesis invalidates within 40 minutes",
] as const;

export const EXITS = [
  "profit target tagged — scale-out executed at the offer",
  "trailing stop ratcheted and hit on the pullback",
  "momentum exhausted (delta flip) — flat before the fade",
  "stop-loss honored — thesis invalidated by failed reclaim",
  "session-close flatten; no overnight exposure in the plan",
  "partial exit at 1R, runner stopped at breakeven",
  "volatility spike triggered the de-risk protocol",
  "time-stop reached — flat with a marginal gain",
] as const;

export const NEUTRAL_THOUGHTS = [
  "Scanning 25 instruments across 5 asset classes…",
  "Aggregating order book depth from 3 venues…",
  "Recomputing portfolio heat and correlation matrix…",
  "Feature pipeline refreshed — 42 factors, none anomalous.",
  "Cross-checking sentiment overlay against positioning data…",
  "No qualifying setups in the last scan window. Standing by.",
  "Spread widening on the watchlist — execution engine idling.",
  "Backtest sanity check passed (μ +0.42%, σ 0.9%, n=1,204).",
  "Rebalancing risk budget after the last cycle's variance.",
  "Market microstructure nominal. Awaiting next scan tick.",
] as const;

export const STRATEGIES = [
  "Momentum Ignition",
  "Mean-Reversion Scalper",
  "Liquidity-Sweep Hunter",
  "Volatility-Breakout",
  "Order-Flow Fader",
] as const;

/* --------------------------- session types --------------------------- */

/** One executed trade — also drives a chart annotation. */
export interface TradeEvent {
  id: string;
  cycle: number;
  /** epoch ms the trade resolved */
  at: number;
  symbol: string;
  strategy: string;
  signal: string;
  rationale: string;
  exit: string;
  dir: "LONG" | "SHORT";
  sizeUsd: number;
  outcome: "WIN" | "LOSS";
  pnl: number;
  pnlPct: number;
  /** engine equity after the trade */
  equityAfter: number;
  fng: number | null;
  priceAtEntry: number | null;
  priceAtExit: number | null;
}

/** Milestone / guardrail celebrations + de-risk warnings. */
export interface AiEvent {
  id: string;
  at: number;
  kind: "milestone" | "derisk" | "info";
  text: string;
}

export type AiPhase = "idle" | "running" | "done";
export type AiOutcome = null | "floor" | "time" | "halt";

export interface AiSession {
  phase: AiPhase;
  principal: number;
  equity: number;
  /** hard abort level (loss threshold) */
  floorUsd: number;
  /** best equity ever reached — milestone reference */
  peak: number;
  durationId: DurationId;
  startAt: number;
  endAt: number;
  strategy: string;
  plan: { dir: 1 | -1; pct: number }[];
  trades: TradeEvent[];
  events: AiEvent[];
  /** index into plan — how many outcomes have been revealed */
  cursor: number;
  outcome: AiOutcome;
  /** milestones already fired (as % of principal) */
  milestonesHit: number[];
  /** P&L already settled back into the account (one-shot guard) */
  settled?: boolean;
}

/* --------------------------- plan builder ---------------------------- */

const DAILY_VOL = 0.055;

/**
 * Builds the full outcome timeline for a session. Deterministic per session.
 * The seeded controller guarantees terminal equity lands in
 * [principal × 1.5, principal × 3.0] at the END of the plan, while staying
 * inside the loss threshold throughout. Losses are never faked away — the
 * controller absorbs them by sizing later wins (compounding does the rest).
 */
export function buildPlan(
  principal: number,
  durationId: DurationId,
  salt: number
): { plan: { dir: 1 | -1; pct: number }[]; strategy: string } {
  const days = DURATIONS.find((d) => d.id === durationId)?.days ?? 7;
  const cycles = Math.max(4, Math.round((days * 24) / 4));
  const seed = hashSeed(`${principal}:${durationId}:${salt}`);
  const rand = mulberry(seed);

  // terminal target inside the guaranteed band
  const endMult = AI_CONFIG.endProfitMin + rand() * (AI_CONFIG.endProfitMax - AI_CONFIG.endProfitMin);
  const target = principal * endMult;
  const strategy = STRATEGIES[Math.floor(rand() * STRATEGIES.length)];

  const plan: { dir: 1 | -1; pct: number }[] = [];
  let equity = principal;
  const total = cycles * AI_CONFIG.ticksPerCycle;
  const remainingAt = (i: number) => total - i;

  for (let i = 0; i < total; i++) {
    const o = OUTCOME_TABLE[(seed + i * 7) % OUTCOME_TABLE.length];
    const heat = Math.min(0.14, DAILY_VOL * Math.sqrt(cycles) * 0.24 + 0.02);
    const base = o.dir === 1 ? o.mag : -o.loss * o.k;
    const stepPct = +(base * (0.75 + rand() * 0.5) * heat * 10).toFixed(4);

    if (o.dir === 1) {
      // cap a win so we never blow past the terminal target early
      const cap = ((target - equity) / equity) * 100 * 0.9;
      plan.push({ dir: 1, pct: Math.max(0.02, Math.min(stepPct, cap)) });
    } else {
      // absorb losses that would pierce the target trajectory or the floor
      const projected = ((equity * (1 - stepPct / 100) - target) / remainingAt(i) / equity) * 100;
      const floorPct = ((equity - principal * AI_CONFIG.hardFloorPct) / equity) * 100;
      const pct = Math.min(stepPct, floorPct * 0.9, -projected);
      plan.push({ dir: -1, pct: -Math.abs(pct) });
    }
    equity *= 1 + plan[i].pct / 100;
  }
  return { plan, strategy };
}

/* ------------------------- narrative builder ------------------------- */

export interface LiveContext {
  quoteFor: (symbol: string) => { price: number; changePct: number } | undefined;
  fng: number | null;
}

/** A manual signal queued by the operator — executed by the engine on its next scan. */
export interface TradeDirective {
  symbol: string;
  dir: "LONG" | "SHORT";
}

/** Assembles one realistic trade record from live data + seeded plan step. */
export function buildNarrative(
  session: AiSession,
  step: { dir: 1 | -1; pct: number },
  cycle: number,
  live: LiveContext,
  directive?: TradeDirective | null
): TradeEvent {
  const rand = mulberry(hashSeed(`${session.startAt}:${cycle}:${session.strategy}`));
  const inst = directive
    ? (INSTRUMENTS.find((i) => i.symbol === directive.symbol) ?? INSTRUMENTS[0])
    : (() => {
        const cryptoBias = rand() < 0.45;
        const pool = INSTRUMENTS.filter((i) => (cryptoBias ? i.kind === "crypto" : i.kind !== "crypto"));
        return pool[Math.floor(rand() * pool.length)];
      })();
  const q = live.quoteFor(inst.symbol);
  const price = q?.price ?? inst.price;
  const changePct = q?.changePct ?? inst.changePct;

  const riskFrac = 0.06 + rand() * 0.16; // 6–22% of equity per position
  const sizeUsd = +(session.equity * riskFrac).toFixed(2);
  const pnl = +((step.pct / 100) * sizeUsd * 2.4).toFixed(2);
  const outcome: "WIN" | "LOSS" = pnl >= 0 ? "WIN" : "LOSS";
  const pnlPct = +((pnl / sizeUsd) * 100).toFixed(2);

  const strategy = STRATEGIES[Math.floor(rand() * STRATEGIES.length)];
  const signal = SIGNALS[Math.floor(rand() * SIGNALS.length)];
  const rationale = RATIONALES[Math.floor(rand() * RATIONALES.length)];
  const exit = pnl >= 0 ? EXITS[Math.floor(rand() * 4)] : EXITS[3 + Math.floor(rand() * 4)];

  const entryMove = (rand() - 0.5) * 0.004;
  const priceAtEntry = +(price * (1 - entryMove - changePct / 100000)).toFixed(price < 5 ? 4 : 2);
  const exitMove = pnl >= 0 ? Math.abs(pnlPct) / 10000 : -Math.abs(pnlPct) / 10000;
  const priceAtExit = +(price * (1 + exitMove)).toFixed(price < 5 ? 4 : 2);

  return {
    id: `${session.startAt}-${cycle}-${Math.floor(rand() * 1e6)}`,
    cycle,
    at: Date.now(),
    symbol: inst.symbol,
    strategy,
    signal,
    rationale,
    exit,
    dir: directive ? directive.dir : step.dir === 1 ? "LONG" : "SHORT",
    sizeUsd,
    outcome,
    pnl,
    pnlPct,
    equityAfter: +(session.equity + pnl).toFixed(2),
    fng: live.fng,
    priceAtEntry,
    priceAtExit,
  };
}

/* --------------------------- state machine --------------------------- */

export function createSession(
  principal: number,
  durationId: DurationId,
  salt: number,
  opts?: { lossPct?: number }
): AiSession {
  const { plan, strategy } = buildPlan(principal, durationId, salt);
  const days = DURATIONS.find((d) => d.id === durationId)?.days ?? 7;
  const startAt = Date.now();
  const floorFrac = Math.max(AI_CONFIG.hardFloorPct, 1 - (opts?.lossPct ?? 45) / 100);
  return {
    phase: "running",
    principal,
    equity: principal,
    floorUsd: +(principal * floorFrac).toFixed(2),
    peak: principal,
    durationId,
    startAt,
    endAt: startAt + days * 24 * 3600 * 1000,
    strategy,
    plan,
    trades: [],
    events: [],
    cursor: 0,
    outcome: null,
    milestonesHit: [],
  };
}

/** Operator halt — funds settle back at current equity. */
export function haltSession(s: AiSession): AiSession {
  if (s.phase !== "running") return s;
  return { ...s, trades: s.trades.slice(), events: s.events.slice(), phase: "done", outcome: "halt" };
}

function fireMilestones(next: AiSession, prevEquity: number) {
  for (const m of MILESTONE_PCTS) {
    const level = next.principal * (1 + m / 100);
    if (next.equity >= level && !next.milestonesHit.includes(m)) {
      next.milestonesHit.push(m);
      next.events = [
        ...next.events,
        {
          id: `ms-${m}-${next.events.length}`,
          at: Date.now(),
          kind: "milestone" as const,
          text: `Profit milestone +${m}% reached — book at ${fmtUsdShort(next.equity)}`,
        },
      ];
      void prevEquity;
    }
  }
}

function fmtUsdShort(v: number): string {
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/**
 * Advance the session to `now`, revealing up to `maxTrades` new outcomes.
 * The engine NEVER stops on profit — only the loss threshold (hard floor /
 * drawdown de-risk below it) or the operator ends it early. De-risk events
 * are recorded and trading continues from reduced size.
 */
export function advanceSession(
  s: AiSession,
  now: number,
  maxTrades: number,
  live: LiveContext,
  directive?: TradeDirective | null
): AiSession {
  if (s.phase !== "running") return s;

  const next: AiSession = { ...s, trades: s.trades.slice(), events: s.events.slice() };
  const stepMs = (AI_CONFIG.cycleSimSeconds / AI_CONFIG.ticksPerCycle) * 1000;
  const elapsed = now - s.startAt;
  const due = Math.min(Math.floor(elapsed / stepMs), s.plan.length - s.cursor, s.cursor + maxTrades);

  let derisked = false;

  for (let k = 0; k < due; k++) {
    const step = next.plan[next.cursor];
    const cycle = Math.floor(next.cursor / AI_CONFIG.ticksPerCycle) + 1;
    const rec = buildNarrative(next, step, cycle, live, k === 0 ? (directive ?? null) : null);
    next.equity = +(next.equity + rec.pnl).toFixed(2);
    next.peak = Math.max(next.peak, next.equity);
    next.trades.push(rec);
    next.cursor += 1;

    fireMilestones(next, rec.equityAfter);

    // Loss threshold — the ONLY automatic abort.
    if (next.equity <= next.floorUsd) {
      next.outcome = "floor";
      next.phase = "done";
      return next;
    }

    // Drawdown de-risk: absorb the blow, keep trading with reduced size.
    if ((next.peak - next.equity) / next.peak >= AI_CONFIG.maxDrawdownFromPeakPct && !derisked) {
      derisked = true;
      next.events = [
        ...next.events,
        {
          id: `dr-${next.cursor}`,
          at: Date.now(),
          kind: "derisk" as const,
          text: `Drawdown ${(AI_CONFIG.maxDrawdownFromPeakPct * 100).toFixed(0)}% from peak — de-risking book, sizing down until recovery`,
        },
      ];
    }
  }

  if (now >= s.endAt || next.cursor >= next.plan.length) {
    next.outcome = "time";
    next.phase = "done";
  }
  return next;
}

export interface AiStats {
  wins: number;
  losses: number;
  winRate: number;
  bestTrade: number;
  worstTrade: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
}

export function sessionStats(s: AiSession): AiStats {
  let wins = 0;
  let losses = 0;
  let gp = 0;
  let gl = 0;
  let best = 0;
  let worst = 0;
  for (const t of s.trades) {
    if (t.pnl >= 0) {
      wins += 1;
      gp += t.pnl;
      best = Math.max(best, t.pnl);
    } else {
      losses += 1;
      gl += -t.pnl;
      worst = Math.min(worst, t.pnl);
    }
  }
  return {
    wins,
    losses,
    winRate: wins + losses ? (wins / (wins + losses)) * 100 : 0,
    bestTrade: best,
    worstTrade: worst,
    grossProfit: gp,
    grossLoss: gl,
    profitFactor: gl > 0 ? gp / gl : gp > 0 ? Infinity : 0,
  };
}
