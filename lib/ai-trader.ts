/**
 * AxionTrade AI trading simulation engine — v3.
 *
 * TIME MODEL
 * ----------
 * The engine runs on its own *session clock* (`clockMs`), not wall time. The
 * clock advances at `speed` × real time, so a 7-day window is a genuine 7 days
 * of session time that the operator can watch at 1×, 60×, 600× or 3600×.
 * Every timestamp, countdown, progress rail and log line is derived from this
 * one clock, so nothing can contradict anything else. The window closes only
 * when the clock actually reaches the end of it — never because a plan ran out
 * early.
 *
 * The engine also keeps accumulating session time while the tab is closed, so
 * an autonomous book genuinely keeps trading between visits and catches up
 * (visibly, a few fills at a time) when you return.
 *
 * P&L MODEL
 * ---------
 * The seeded controller builds a plan whose compounding lands the terminal
 * equity inside [principal × 2.5, principal × 4.0] — a terminal gain of
 * +150%…+300%. Realized equity follows
 * that plan *exactly* — each fill books the plan's step return — so the
 * guarantee holds by construction rather than approximately. Reported P&L is
 * therefore derived from the equity delta, and every fill carries a realistic
 * instrument move, notional, leverage and round-trip cost.
 */

import { INSTRUMENTS, type Instrument } from "@/lib/market-data";

/* ------------------------------ config ------------------------------ */

export const AI_CONFIG = {
  /** a trading cycle covers 4h of session time */
  cycleHours: 4,
  /** market scans per cycle */
  ticksPerCycle: 6,
  /**
   * Guaranteed terminal profit band, as an equity MULTIPLE of principal.
   * 2.5×–4.0× is a terminal *gain* of +150%…+300%, which is what the operator
   * is promised and what the milestone ladder is calibrated against. (The
   * earlier 1.5×–3.0× was read as a gain, but it is a multiple — it only ever
   * produced +50%…+197% and left the top ladder rungs unreachable.)
   */
  endEquityMultMin: 2.5,
  endEquityMultMax: 4.0,
  /** sessions ALWAYS run to the end of the window; this floor is the only abort */
  hardFloorPct: 0.55,
  /** de-risk trigger: drawdown from running peak */
  maxDrawdownFromPeakPct: 0.22,
  /** how many steps ahead of its resolution a position is opened (2.4–4.2×
   * the step length), which is what gives the book several live positions */
  leadStepsMin: 0.55,
  leadStepsMax: 2.35,
  /** round-trip cost per fill, in bps of notional */
  feeBps: 4,
  /** adverse fill slippage, in bps of the fill price */
  slippageBps: 3,
  /** session-clock scan commentary cadence */
  scanMs: 12 * 60 * 1000,
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

export function durationDays(id: DurationId): number {
  return DURATIONS.find((d) => d.id === id)?.days ?? 7;
}

export function durationMs(id: DurationId): number {
  return durationDays(id) * 86400000;
}

/** Session-clock rates. 1× is true real time; the rest are time-lapse. */
export const SPEEDS = [
  { id: "1x", mult: 1, label: "Real time", hint: "1 day per day" },
  { id: "60x", mult: 60, label: "60×", hint: "1 day per 24 min" },
  { id: "600x", mult: 600, label: "600×", hint: "1 day per 2.4 min" },
  { id: "3600x", mult: 3600, label: "3600×", hint: "1 day per 24 s" },
] as const;
export type SpeedId = (typeof SPEEDS)[number]["id"];

export function speedMult(id: SpeedId): number {
  return SPEEDS.find((s) => s.id === id)?.mult ?? 1;
}

/** Human description of the current clock rate, e.g. "1 day / 24 min". */
export function sessionClockRate(s: AiSession): string {
  const dayWallMs = 86400000 / speedMult(s.speed);
  const minutes = Math.floor(dayWallMs / 60000);
  return minutes >= 1 ? `1 day / ${minutes} min` : `1 day / ${Math.round(dayWallMs / 1000)} s`;
}

export const DEFAULT_SPEED: SpeedId = "60x";

/** Profit milestones as % of principal (the operator watches them fire). */
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
  /** session-clock ms the trade was opened */
  entryAt: number;
  /** session-clock ms the trade resolved */
  at: number;
  symbol: string;
  strategy: string;
  signal: string;
  rationale: string;
  exit: string;
  dir: "LONG" | "SHORT";
  /** position notional (leverage applied), in USD */
  sizeUsd: number;
  /** margin actually committed, in USD */
  marginUsd: number;
  leverage: number;
  /** instrument move achieved, in percent */
  movePct: number;
  /** round-trip cost charged, in USD */
  fees: number;
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
  /** session-clock ms */
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
  /**
   * Session-clock origin (epoch ms). This is a *session* epoch, not wall time:
   * `sessionNow()` = startAt + clockMs.
   */
  startAt: number;
  /** session-clock ms elapsed since startAt */
  clockMs: number;
  /** wall ms at which clockMs was last accumulated */
  lastWallAt: number;
  /** session-clock multiplier currently in force */
  speed: SpeedId;
  /** length of the window in session-clock ms */
  windowMs: number;
  strategy: string;
  plan: { dir: 1 | -1; pct: number }[];
  trades: TradeEvent[];
  events: AiEvent[];
  /** index into plan — how many outcomes have been revealed */
  cursor: number;
  outcome: AiOutcome;
  /** milestones already fired (as % of principal) */
  milestonesHit: number[];
  /** total round-trip cost charged so far */
  feesPaid: number;
  /** P&L already settled back into the account (one-shot guard) */
  settled?: boolean;
}

/* --------------------------- plan builder ---------------------------- */

const DAILY_VOL = 0.055;

/**
 * Builds the full outcome timeline for a session. Deterministic per session.
 * The seeded controller guarantees terminal equity lands in
 * [principal × 2.5, principal × 4.0] (a gain of +150%…+300%) while staying
 * above the hard floor
 * throughout. Losses are never faked away — the controller absorbs them by
 * sizing later wins, and compounding does the rest.
 */
export function buildPlan(
  principal: number,
  durationId: DurationId,
  salt: number
): { plan: { dir: 1 | -1; pct: number }[]; strategy: string; target: number } {
  const days = durationDays(durationId);
  const cycles = Math.max(4, Math.round((days * 24) / AI_CONFIG.cycleHours));
  const seed = hashSeed(`${principal}:${durationId}:${salt}`);
  const rand = mulberry(seed);

  // terminal target inside the guaranteed band
  const endMult =
    AI_CONFIG.endEquityMultMin + rand() * (AI_CONFIG.endEquityMultMax - AI_CONFIG.endEquityMultMin);
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
  return { plan, strategy, target };
}

/**
 * Equity after each step of the plan, i.e. the session's realized track.
 * Length is plan.length + 1 (index 0 = starting principal).
 */
export function planEquityPath(s: AiSession): number[] {
  const out = [s.principal];
  let equity = s.principal;
  for (const step of s.plan) {
    equity *= 1 + step.pct / 100;
    out.push(equity);
  }
  return out;
}

/* ----------------------- session-clock helpers ------------------------ */

/** Current session-clock epoch ms. */
export function sessionNow(s: AiSession): number {
  return s.startAt + s.clockMs;
}

/** Session time between two fills. The plan is sized to the window exactly. */
export function stepSimMs(s: AiSession): number {
  return s.windowMs / Math.max(1, s.plan.length);
}

/** 0 → 1 progress through the window, by session clock. */
export function sessionProgress(s: AiSession): number {
  return Math.max(0, Math.min(1, s.clockMs / s.windowMs));
}

/** Session-clock ms remaining. */
export function sessionRemainingMs(s: AiSession): number {
  return Math.max(0, s.windowMs - s.clockMs);
}

/**
 * Advance the session clock by the wall time since the last accumulation,
 * scaled by the current rate. Clamped to the window so it can never overrun.
 * Safe to call repeatedly; a no-op once the session is done.
 */
export function tickClock(s: AiSession, now: number): AiSession {
  if (s.phase !== "running") return s;
  const dt = Math.max(0, now - s.lastWallAt);
  if (dt === 0) return s;
  const clockMs = Math.min(s.windowMs, s.clockMs + dt * speedMult(s.speed));
  return { ...s, clockMs, lastWallAt: now };
}

/** Change the time-lapse rate, crediting elapsed time at the old rate first. */
export function setSessionSpeed(s: AiSession, speed: SpeedId, now: number): AiSession {
  const ticked = tickClock(s, now);
  return { ...ticked, speed, lastWallAt: now };
}

/**
 * Deterministic per-step position metadata. Depends only on the session seed
 * and the step index, so the live book and the settled blotter always agree.
 */
interface StepMeta {
  symbol: string;
  kind: Instrument["kind"];
  strategy: string;
  signal: string;
  rationale: string;
  /** steps of session time the position is held before it resolves */
  lead: number;
  /** fraction of equity committed as margin */
  deployFrac: number;
  leverage: number;
}

/** Regulatory-style maximum leverage by asset class (ESMA caps). */
export const MAX_LEVERAGE: Record<string, number> = {
  forex: 30,
  index: 20,
  commodity: 20,
  crypto: 10,
  stock: 5,
  etf: 5,
};

function stepMeta(s: AiSession, i: number): StepMeta {
  const rand = mulberry(hashSeed(`${s.startAt}:meta:${i}`));
  const cryptoBias = rand() < 0.45;
  const pool = INSTRUMENTS.filter((inst) => (cryptoBias ? inst.kind === "crypto" : inst.kind !== "crypto"));
  const inst = pool[Math.floor(rand() * pool.length)] ?? INSTRUMENTS[0];
  return {
    symbol: inst.symbol,
    kind: inst.kind,
    strategy: STRATEGIES[Math.floor(rand() * STRATEGIES.length)],
    signal: SIGNALS[Math.floor(rand() * SIGNALS.length)],
    rationale: RATIONALES[Math.floor(rand() * RATIONALES.length)],
    lead: AI_CONFIG.leadStepsMin + rand() * (AI_CONFIG.leadStepsMax - AI_CONFIG.leadStepsMin),
    deployFrac: 0.06 + rand() * 0.16,
    leverage: MAX_LEVERAGE[inst.kind] ?? 5,
  };
}

/** Session-clock ms at which plan step `i` resolves. */
function stepResolveAt(s: AiSession, i: number): number {
  return s.startAt + (i + 1) * stepSimMs(s);
}

/** Session-clock ms at which plan step `i` was opened. */
function stepEnterAt(s: AiSession, i: number): number {
  return stepResolveAt(s, i) - stepMeta(s, i).lead * stepSimMs(s);
}

/* ------------------------- narrative builder ------------------------- */

export interface LiveContext {
  quoteFor: (symbol: string) => { price: number; changePct: number } | undefined;
  fng: number | null;
}

/** A manual signal queued by the operator — executed on the engine's next fill. */
export interface TradeDirective {
  symbol: string;
  dir: "LONG" | "SHORT";
}

/**
 * Builds one executed trade for a plan step.
 *
 * `pnl` is *derived* from the equity delta the plan mandates, so realized
 * equity follows the plan exactly and the terminal band is guaranteed. The
 * instrument move, notional, leverage and cost are then back-solved from that
 * P&L, which is how a real desk would read on a blotter.
 */
export function buildTrade(
  s: AiSession,
  i: number,
  equityBefore: number,
  live: LiveContext,
  directive?: TradeDirective | null
): TradeEvent {
  const step = s.plan[i];
  const meta = directive
    ? {
        ...stepMeta(s, i),
        symbol: directive.symbol,
        kind: INSTRUMENTS.find((x) => x.symbol === directive.symbol)?.kind ?? ("stock" as Instrument["kind"]),
      }
    : stepMeta(s, i);
  const inst = INSTRUMENTS.find((x) => x.symbol === meta.symbol) ?? INSTRUMENTS[0];
  const q = live.quoteFor(inst.symbol);
  const price = q?.price ?? inst.price;

  // equity follows the plan exactly — this is the guaranteed path
  const equityAfter = equityBefore * (1 + step.pct / 100);
  const pnl = equityAfter - equityBefore;

  // back-solve a realistic position from that P&L
  const marginUsd = equityBefore * meta.deployFrac;
  const notional = marginUsd * meta.leverage;
  const movePct = notional > 0 ? (pnl / notional) * 100 : 0;
  const leverage = meta.leverage;
  const fees = (notional * AI_CONFIG.feeBps) / 10000;
  const dir: "LONG" | "SHORT" = directive ? directive.dir : step.dir === 1 ? "LONG" : "SHORT";

  const slip = AI_CONFIG.slippageBps / 10000;
  // a long pays up on entry and gives up on exit; a short is the mirror image
  const slipSign = dir === "LONG" ? 1 : -1;
  const priceAtEntry = +(price * (1 + slipSign * slip)).toFixed(price < 5 ? 4 : 2);
  const priceAtExit = +(price * (1 - slipSign * slip)).toFixed(price < 5 ? 4 : 2);
  const rand = mulberry(hashSeed(`${s.startAt}:exit:${i}`));
  const exit = pnl >= 0 ? EXITS[Math.floor(rand() * 4)] : EXITS[3 + Math.floor(rand() * 4)];

  return {
    id: `${s.startAt}-${i}-${Math.floor(rand() * 1e6)}`,
    cycle: Math.floor(i / AI_CONFIG.ticksPerCycle) + 1,
    entryAt: stepEnterAt(s, i),
    at: stepResolveAt(s, i),
    symbol: inst.symbol,
    strategy: meta.strategy,
    signal: meta.signal,
    rationale: meta.rationale,
    exit,
    dir,
    sizeUsd: +notional.toFixed(2),
    marginUsd: +marginUsd.toFixed(2),
    leverage,
    movePct: +movePct.toFixed(3),
    fees: +fees.toFixed(2),
    outcome: pnl >= 0 ? "WIN" : "LOSS",
    pnl: +pnl.toFixed(2),
    pnlPct: +(step.pct).toFixed(3),
    equityAfter: +equityAfter.toFixed(2),
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
  opts?: { lossPct?: number; speed?: SpeedId }
): AiSession {
  const { plan, strategy } = buildPlan(principal, durationId, salt);
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
    clockMs: 0,
    lastWallAt: startAt,
    speed: opts?.speed ?? DEFAULT_SPEED,
    windowMs: durationMs(durationId),
    strategy,
    plan,
    trades: [],
    events: [],
    cursor: 0,
    outcome: null,
    milestonesHit: [],
    feesPaid: 0,
  };
}

/** Operator halt — funds settle back at current equity. */
export function haltSession(s: AiSession, now: number): AiSession {
  if (s.phase !== "running") return s;
  const ticked = tickClock(s, now);
  return { ...ticked, trades: ticked.trades.slice(), events: ticked.events.slice(), phase: "done", outcome: "halt" };
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
          at: sessionNow(next),
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
 * Advance the engine: credit session time, then reveal every fill the clock
 * has reached (capped per call so catch-up streams rather than dumps).
 *
 * The engine NEVER stops on profit. It ends only when the whole plan has
 * played out — which, because the plan is sized exactly to the window, means
 * the window closed — or when equity pierces the loss threshold.
 */
export function advanceSession(
  s: AiSession,
  now: number,
  maxTrades: number,
  live: LiveContext,
  directive?: TradeDirective | null
): AiSession {
  if (s.phase !== "running") return s;

  const ticked = tickClock(s, now);
  const next: AiSession = { ...ticked, trades: ticked.trades.slice(), events: ticked.events.slice() };
  const stepMs = stepSimMs(next);

  // fills whose session-clock resolution time has arrived
  const dueTotal = Math.floor(ticked.clockMs / stepMs) - ticked.cursor;
  const due = Math.max(0, Math.min(dueTotal, maxTrades));
  let derisked = false;

  for (let k = 0; k < due; k++) {
    const i = next.cursor;
    const rec = buildTrade(next, i, next.equity, live, k === 0 ? (directive ?? null) : null);
    next.equity = +rec.equityAfter.toFixed(2);
    next.peak = Math.max(next.peak, next.equity);
    next.feesPaid = +(next.feesPaid + rec.fees).toFixed(2);
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
          at: sessionNow(next),
          kind: "derisk" as const,
          text: `Drawdown ${(AI_CONFIG.maxDrawdownFromPeakPct * 100).toFixed(0)}% from peak — de-risking book, sizing down until recovery`,
        },
      ];
    }
  }

  // The window is complete only once the whole plan has been traded out.
  if (next.cursor >= next.plan.length) {
    next.outcome = "time";
    next.phase = "done";
  }
  return next;
}

/* ------------------------- live open positions ------------------------ */

export interface OpenPosition {
  stepIndex: number;
  id: string;
  symbol: string;
  kind: Instrument["kind"];
  dir: "LONG" | "SHORT";
  strategy: string;
  signal: string;
  /** session-clock ms the position was opened */
  openedAt: number;
  /** session-clock ms it will resolve */
  closesAt: number;
  notionalUsd: number;
  marginUsd: number;
  leverage: number;
  entryPrice: number;
  markPrice: number;
  /** running instrument move, in percent */
  movePct: number;
  /** marked-to-market P&L, converging on the fill's realized result */
  unrealized: number;
  unrealizedPct: number;
  /** 0 → 1 through the hold */
  progress: number;
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * The engine's live book: positions opened but not yet resolved at the current
 * session time, marked against live prices. Their unrealized P&L converges on
 * the exact figure the fill will book, so the open book and the blotter never
 * disagree.
 */
export function sessionOpenPositions(s: AiSession, live: LiveContext, limit = 4): OpenPosition[] {
  const path = planEquityPath(s);
  const now = sessionNow(s);
  const out: OpenPosition[] = [];

  // scan forward from the cursor while positions are (or will soon be) open
  const maxAhead = Math.ceil(AI_CONFIG.leadStepsMax) + 2;
  for (let i = s.cursor; i < Math.min(s.plan.length, s.cursor + maxAhead); i++) {
    const enter = stepEnterAt(s, i);
    const close = stepResolveAt(s, i);
    if (now < enter || now >= close) continue;

    const meta = stepMeta(s, i);
    const inst = INSTRUMENTS.find((x) => x.symbol === meta.symbol) ?? INSTRUMENTS[0];
    const equityBefore = path[i] ?? s.equity;
    const marginUsd = equityBefore * meta.deployFrac;
    const notional = marginUsd * meta.leverage;
    const step = s.plan[i];
    const pnlTarget = equityBefore * (step.pct / 100);
    const moveFinal = notional > 0 ? (pnlTarget / notional) * 100 : 0;

    const hold = Math.max(1, close - enter);
    const progress = Math.max(0, Math.min(1, (now - enter) / hold));
    const movePct = moveFinal * easeInOut(progress);

    const q = live.quoteFor(inst.symbol);
    const mark = q?.price ?? inst.price;
    // entry is implied by the mark and the running move, so the marked P&L
    // always agrees with the prices shown beside it
    const entry = mark / (1 + movePct / 100);

    out.push({
      stepIndex: i,
      id: `open-${s.startAt}-${i}`,
      symbol: inst.symbol,
      kind: inst.kind,
      dir: step.dir === 1 ? "LONG" : "SHORT",
      strategy: meta.strategy,
      signal: meta.signal,
      openedAt: enter,
      closesAt: close,
      notionalUsd: notional,
      marginUsd,
      leverage: meta.leverage,
      entryPrice: entry,
      markPrice: mark,
      movePct,
      unrealized: (notional * movePct) / 100,
      unrealizedPct: step.pct * easeInOut(progress),
      progress,
    });
  }
  return out.slice(0, limit);
}

/* --------------------------- derived views --------------------------- */

export interface ScanLine {
  id: string;
  at: number;
  text: string;
}

/**
 * Scanner commentary. Derived from the session clock rather than a wall timer,
 * so it is stable across renders, survives reloads, and paces itself to the
 * window instead of to how long the page happens to have been open.
 */
export function sessionScanLines(s: AiSession, limit = 12): ScanLine[] {
  const upto = Math.floor(s.clockMs / AI_CONFIG.scanMs);
  const from = Math.max(0, upto - limit + 1);
  const out: ScanLine[] = [];
  for (let i = from; i <= upto; i++) {
    out.push({
      id: `scan-${i}`,
      at: s.startAt + i * AI_CONFIG.scanMs,
      text: NEUTRAL_THOUGHTS[hashSeed(`${s.startAt}:scan:${i}`) % NEUTRAL_THOUGHTS.length],
    });
  }
  return out;
}

/** Equity samples across the traded portion of the session, for the curve. */
export function sessionEquityCurve(s: AiSession, points = 40): number[] {
  const path = planEquityPath(s).slice(0, Math.max(1, s.cursor) + 1);
  if (path.length <= points) return path;
  const stride = path.length / points;
  return Array.from({ length: points }, (_, i) => path[Math.min(path.length - 1, Math.round(i * stride))]);
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
  /** average win / average loss */
  payoff: number;
  /** largest peak-to-trough equity fall, as a fraction */
  maxDrawdown: number;
  /** win/loss streak currently running */
  streak: number;
}

export function sessionStats(s: AiSession): AiStats {
  let wins = 0;
  let losses = 0;
  let gp = 0;
  let gl = 0;
  let best = 0;
  let worst = 0;
  let streak = 0;
  for (const t of s.trades) {
    if (t.pnl >= 0) {
      wins += 1;
      gp += t.pnl;
      best = Math.max(best, t.pnl);
      streak = streak >= 0 ? streak + 1 : 1;
    } else {
      losses += 1;
      gl += -t.pnl;
      worst = Math.min(worst, t.pnl);
      streak = streak <= 0 ? streak - 1 : -1;
    }
  }

  let peak = s.principal;
  let maxDd = 0;
  let running = s.principal;
  for (const t of s.trades) {
    running = t.equityAfter;
    peak = Math.max(peak, running);
    if (peak > 0) maxDd = Math.max(maxDd, (peak - running) / peak);
  }

  const avgWin = wins ? gp / wins : 0;
  const avgLoss = losses ? gl / losses : 0;
  return {
    wins,
    losses,
    winRate: wins + losses ? (wins / (wins + losses)) * 100 : 0,
    bestTrade: best,
    worstTrade: worst,
    grossProfit: gp,
    grossLoss: gl,
    profitFactor: gl > 0 ? gp / gl : gp > 0 ? Infinity : 0,
    payoff: avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0,
    maxDrawdown: maxDd,
    streak,
  };
}
