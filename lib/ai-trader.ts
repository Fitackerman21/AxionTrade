/**
 * AxionTrade AI trading simulation engine.
 *
 * Hardcoded-but-dynamic: a deterministic, seeded timeline of ~500 trading
 * outcomes per session, guaranteed to land between the profit band
 * (150%–300%) by the end of the chosen period. Narratives are assembled at
 * execution time from REAL live market data (quotes + Fear & Greed index).
 */

import { INSTRUMENTS } from "@/lib/market-data";

/* ------------------------------ config ------------------------------ */

export const AI_CONFIG = {
  /** seconds a 4h trading cycle lasts in the sim (4h = 14400s → 120s sim) */
  cycleSimSeconds: 120,
  /** market scanner ticks per cycle */
  ticksPerCycle: 10,
  /** sessions end as soon as this multiple of principal is reached */
  goalMultipleMin: 1.5,
  goalMultipleMax: 3.0,
  /** engine never lets equity fall below this fraction of principal */
  hardFloorPct: 0.55,
  /** engine stops early once this drawdown from the running peak is hit */
  maxDrawdownFromPeakPct: 0.3,
} as const;

export const DURATIONS = [
  { id: "24h", label: "24 hours", days: 1 },
  { id: "3d", label: "3 days", days: 3 },
  { id: "7d", label: "1 week", days: 7 },
  { id: "14d", label: "2 weeks", days: 14 },
] as const;
export type DurationId = (typeof DURATIONS)[number]["id"];

/* ----------------------- 500-entry outcome table ---------------------- */

export interface Outcome {
  id: number;
  /** +1 win, -1 loss */
  dir: 1 | -1;
  /** magnitude in percent of equity at risk */
  mag: number;
  /** loss multiplier scale — losses hit harder than the average win, like reality */
  k: number;
  /** base loss magnitude in percent */
  loss: number;
}

const OUTCOME_TABLE: Outcome[] = Array.from({ length: 500 }, (_, i) => {
  // win band: +0.25% … +2.10% (long right tail)
  const win = 0.25 + 1.85 * ((i * 37) % 500) / 500 ** 1.35;
  // loss band: 0.12% … 0.62% of equity
  const loss = 0.12 + 0.5 * (((i * 89) % 500) / 500);
  return { id: i, dir: i % 5 < 3 ? 1 : -1, mag: win, k: 1 + ((i * 13) % 7) / 10, loss } as Outcome;
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

export interface AiTradeRecord {
  id: string;
  cycle: number;
  /** epoch ms the record was revealed */
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
  /** equity after the trade */
  equityAfter: number;
  fng: number | null;
  priceAtEntry: number | null;
  priceAtExit: number | null;
}

export type AiPhase = "idle" | "running" | "done";

export interface AiSession {
  phase: AiPhase;
  principal: number;
  equity: number;
  goalUsd: number;
  floorUsd: number;
  durationId: DurationId;
  startAt: number;
  endAt: number;
  goalMultiple: number;
  strategy: string;
  plan: { dir: 1 | -1; pct: number }[];
  trades: AiTradeRecord[];
  /** index into plan — how many outcomes have been revealed */
  cursor: number;
  outcome: null | "goal" | "floor" | "time" | "halt";
  peak: number;
  /** P&L already settled back into the account (one-shot guard) */
  settled?: boolean;
}

/* --------------------------- plan builder ---------------------------- */

const DAILY_VOL = 0.055;

/**
 * Builds the full outcome timeline for a session. Deterministic per session.
 * Baseline guarantees the end equity lands in [150%, 300%] of principal; the
 * controller (in advanceSession) clamps early at goal/floor and can only
 * improve on the baseline trajectory (wins are capped, losses absorbed).
 */
export function buildPlan(
  principal: number,
  durationId: DurationId,
  salt: number,
  goalMultipleOverride?: number
): { plan: { dir: 1 | -1; pct: number }[]; goalMultiple: number; strategy: string } {
  const days = DURATIONS.find((d) => d.id === durationId)?.days ?? 7;
  const cycles = Math.max(2, Math.round((days * 24) / 4));
  const seed = hashSeed(`${principal}:${durationId}:${salt}`);
  const rand = mulberry(seed);

  const goalMultiple =
    goalMultipleOverride ??
    AI_CONFIG.goalMultipleMin + rand() * (AI_CONFIG.goalMultipleMax - AI_CONFIG.goalMultipleMin);
  const strategy = STRATEGIES[Math.floor(rand() * STRATEGIES.length)];

  const plan: { dir: 1 | -1; pct: number }[] = [];
  let equity = principal;
  const target = principal * goalMultiple;
  const remainingAt = (i: number) => cycles * AI_CONFIG.ticksPerCycle - i;

  for (let i = 0; i < cycles * AI_CONFIG.ticksPerCycle; i++) {
    const o = OUTCOME_TABLE[(seed + i * 7) % OUTCOME_TABLE.length];
    const heat = Math.min(0.14, DAILY_VOL * Math.sqrt(cycles) * 0.24 + 0.02);
    const base = (o.dir === 1 ? 1 : -1) * (o.dir === 1 ? o.mag : o.loss * o.k);
    const stepPct = +(base * (0.75 + rand() * 0.5) * heat * 10).toFixed(4);

    if (o.dir === 1) {
      // cap a win so we never overshoot the goal band prematurely
      const cap = ((target - equity) / equity) * 100 * 0.9;
      plan.push({ dir: 1, pct: Math.max(0.02, Math.min(stepPct, cap)) });
    } else {
      // absorb losses that would pierce the target trajectory
      const projected = (equity * (1 - stepPct / 100) - target) / remainingAt(i) / equity * 100;
      const floorPct = ((equity - principal * AI_CONFIG.hardFloorPct) / equity) * 100;
      const pct = Math.min(stepPct, floorPct * 0.9, -projected);
      plan.push({ dir: -1, pct: -Math.abs(pct) });
    }
    equity *= 1 + plan[i].pct / 100;
  }
  return { plan, goalMultiple, strategy };
}

/* ------------------------- narrative builder ------------------------- */

export interface LiveContext {
  quoteFor: (symbol: string) => { price: number; changePct: number } | undefined;
  fng: number | null;
}

/** Assembles one realistic trade record from live data + seeded plan step. */
export function buildNarrative(
  session: AiSession,
  step: { dir: 1 | -1; pct: number },
  cycle: number,
  live: LiveContext
): AiTradeRecord {
  const rand = mulberry(hashSeed(`${session.startAt}:${cycle}:${session.strategy}`));
  const cryptoBias = rand() < 0.45;
  const pool = INSTRUMENTS.filter((i) => (cryptoBias ? i.kind === "crypto" : i.kind !== "crypto"));
  const inst = pool[Math.floor(rand() * pool.length)];
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
    dir: step.dir === 1 ? "LONG" : "SHORT",
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
  opts?: { goalMultiple?: number; lossPct?: number }
): AiSession {
  const { plan, goalMultiple, strategy } = buildPlan(principal, durationId, salt, opts?.goalMultiple);
  const days = DURATIONS.find((d) => d.id === durationId)?.days ?? 7;
  const startAt = Date.now();
  const floorFrac = Math.max(AI_CONFIG.hardFloorPct, 1 - (opts?.lossPct ?? 45) / 100);
  return {
    phase: "running",
    principal,
    equity: principal,
    goalUsd: +(principal * goalMultiple).toFixed(2),
    floorUsd: +(principal * floorFrac).toFixed(2),
    durationId,
    startAt,
    endAt: startAt + days * 24 * 3600 * 1000,
    goalMultiple,
    strategy,
    plan,
    trades: [],
    cursor: 0,
    outcome: null,
    peak: principal,
  };
}

/** Advance the session to `now`, revealing up to `maxTrades` new records. */
export function haltSession(s: AiSession): AiSession {
  if (s.phase !== "running") return s;
  return { ...s, trades: s.trades.slice(), phase: "done", outcome: "halt" };
}

export function advanceSession(s: AiSession, now: number, maxTrades: number, live: LiveContext): AiSession {
  if (s.phase !== "running") return s;

  const next: AiSession = { ...s, trades: s.trades.slice() };
  const stepMs = (AI_CONFIG.cycleSimSeconds / AI_CONFIG.ticksPerCycle) * 1000;
  const elapsed = now - s.startAt;
  const due = Math.min(Math.floor(elapsed / stepMs), s.plan.length - s.cursor, s.cursor + maxTrades);

  for (let k = 0; k < due; k++) {
    const step = next.plan[next.cursor];
    const cycle = Math.floor(next.cursor / AI_CONFIG.ticksPerCycle) + 1;
    const rec = buildNarrative(next, step, cycle, live);
    next.equity = +(next.equity + rec.pnl).toFixed(2);
    next.peak = Math.max(next.peak, next.equity);
    next.trades.push(rec);
    next.cursor += 1;

    if (next.equity >= next.goalUsd) {
      next.outcome = "goal";
      next.phase = "done";
      return next;
    }
    if (next.equity <= next.floorUsd || (next.peak - next.equity) / next.peak >= AI_CONFIG.maxDrawdownFromPeakPct) {
      next.outcome = "floor";
      next.phase = "done";
      return next;
    }
  }

  if (now >= s.endAt || next.cursor >= next.plan.length) {
    next.outcome = next.equity >= next.principal ? "goal" : "time";
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
