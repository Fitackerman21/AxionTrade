/**
 * jev-loop, ported to TypeScript from the PTQ "jev-hft-system" prompt
 * (Lewis Jackson / Part-Time Quant — the "I Gave JEV Control of a Trading
 * Bot" video). The prompt scaffolds a Python Claude Code skill that runs a
 * 24/7 paper-trading loop; this file is the same loop with the same split,
 * so the /jev page can run it in the browser against AxionTrade's own
 * price feed.
 *
 * The split, unchanged: code computes the state (this file), a decision
 * client answers seven typed judgments about it (mock here, or Jev through
 * /api/jev when a key is set), code composes the action from the
 * thresholds below, code prices it, code can veto it, and a paper ledger
 * records the fills. Nothing here claims an edge: it is the harness the
 * video shipped, with the same numbers.
 *
 * Ported faithfully from the prompt: the nine hard risk caps, the seven
 * strategy thresholds (including the 0.55 directional-leg confidence), the
 * six actions, the five-rung fallback ladder, Avellaneda-Stoikov pricing,
 * the nine-stage loop order, and the mock decision client's own derivation
 * (so a run with no key still looks internally consistent, and is always
 * labelled MOCK).
 */

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

export const KILL = "KILL";
export const PULL_QUOTES = "PULL_QUOTES";
export const WIDEN = "WIDEN";
export const QUOTE_BOTH_SIDES = "QUOTE_BOTH_SIDES";
export const QUOTE_WIDE = "QUOTE_WIDE";
export const STAND_DOWN = "STAND_DOWN";
export const HOLD_LATE = "HOLD_LATE";
export const MANUAL_BUY = "MANUAL_BUY";
export const MANUAL_SELL = "MANUAL_SELL";

export type ActionKind =
  | typeof KILL
  | typeof PULL_QUOTES
  | typeof WIDEN
  | typeof QUOTE_BOTH_SIDES
  | typeof QUOTE_WIDE
  | typeof STAND_DOWN
  | typeof HOLD_LATE
  | typeof MANUAL_BUY
  | typeof MANUAL_SELL;

export type Direction = "up" | "down" | "neutral";

export interface Action {
  kind: ActionKind;
  reason: string;
  /** signed skew in [-1, 1]: negative skews to selling, positive to buying */
  skew: number;
  directionLeg: "up" | "down" | null;
}

/* ------------------------------------------------------------------ */
/* The hard risk caps. Never overridable by the strategy.              */
/* ------------------------------------------------------------------ */

export interface Limits {
  /** max absolute position value, in dollars */
  maxPositionUsd: number;
  /** kill switch on realised + unrealised loss today */
  maxDailyLossUsd: number;
  /** kill switch: this far below the session high-water mark */
  maxDrawdownPct: number;
  /** dollar value of a single order */
  maxOrderNotionalUsd: number;
  /** holding non-flat inventory this long before a veto */
  maxInventoryAgeS: number;
  /** market data older than this is refused */
  maxStaleDataAgeS: number;
  /** consecutive broker/API errors before kill */
  maxApiErrors: number;
  /** a decision slower than this on a tick is late, hold */
  maxDecisionLatencyMs: number;
  /** spot/cash only, no leverage, ever */
  maxLeverage: number;
}

export const LIMITS: Limits = {
  maxPositionUsd: 50.0,
  maxDailyLossUsd: 25.0,
  maxDrawdownPct: 0.05,
  maxOrderNotionalUsd: 25.0,
  maxInventoryAgeS: 900.0,
  maxStaleDataAgeS: 5.0,
  maxApiErrors: 5,
  maxDecisionLatencyMs: 2000.0,
  maxLeverage: 1.0,
};

/** Operational numbers, also from the prompt's limits.py / loop.py. */
export const TICK_SECONDS = 2.0;
export const LATEST_WINDOW = 120;
/** Alpaca paper accounts start funded; the video's run used a small one. */
export const STARTING_CASH_USD = 1000.0;
/** Avellaneda-Stoikov knobs (pricing.py in the prompt). */
export const PRICING = { gamma: 0.1, kappa: 1.5, horizonS: 60.0 };

/* ------------------------------------------------------------------ */
/* The seven tunable thresholds (strategy.py in the prompt)            */
/* ------------------------------------------------------------------ */

export interface StrategyThresholds {
  toxicFlowPullThreshold: number;
  liquidityStressedWidenThreshold: number;
  quoteEnvFullScore: number;
  quoteEnvFullConfidence: number;
  quoteEnvWideScore: number;
  inventoryPressureMaxScore: number;
  directionConfidenceThreshold: number;
}

/** Exactly the numbers the video ran. */
export const THRESHOLDS: StrategyThresholds = {
  toxicFlowPullThreshold: 0.6,
  liquidityStressedWidenThreshold: 0.7,
  quoteEnvFullScore: 2.0,
  quoteEnvFullConfidence: 0.8,
  quoteEnvWideScore: 1.0,
  inventoryPressureMaxScore: 3.0,
  directionConfidenceThreshold: 0.55,
};

/** Ladder thresholds, from ladder.py's call site in the prompt. */
export const LOW_CONFIDENCE_THRESHOLD = 0.5;
export const EXECUTION_HEALTH_FLOOR = 1.0;

/* ------------------------------------------------------------------ */
/* State snapshot — deterministic, and the only thing Jev ever sees    */
/* ------------------------------------------------------------------ */

export interface Snapshot {
  symbol: string;
  mid: number;
  bid: number;
  ask: number;
  spreadBps: number;
  imbalance: number;
  vwap: number;
  inventory: number;
  dailyLossUsd: number;
  drawdownPct: number;
  positionAgeS: number;
  dataAgeS: number;
  leverage: number;
  equityUsd: number;
  /** execution-quality inputs the mock's health judgment reads */
  fillRatio: number | null;
  rejectCount: number;
  last10LatenciesMs: number[];
  last10SlippageBps: number[];
}

/* ------------------------------------------------------------------ */
/* Answers — seven typed judgments, exactly the allow-list in split.py */
/* ------------------------------------------------------------------ */

export interface NoulAnswer {
  type: "noul";
  noul: number;
}
export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}
export interface ScoreAnswer {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface Answers {
  regime: ChoiceAnswer;
  direction: ChoiceAnswer;
  toxic_flow: NoulAnswer;
  liquidity_stressed: NoulAnswer;
  quote_environment: ScoreAnswer;
  inventory_pressure: ScoreAnswer;
  execution_health: ScoreAnswer;
}

export const QUESTION_TYPES: Record<keyof Answers, "choice" | "noul" | "score"> = {
  regime: "choice",
  direction: "choice",
  toxic_flow: "noul",
  liquidity_stressed: "noul",
  quote_environment: "score",
  inventory_pressure: "score",
  execution_health: "score",
};

export const ENV_LEVELS = ["Do not quote", "Marginal", "Standard", "Excellent"];
export const PRESSURE_LEVELS = ["None", "Mild", "Skew hard", "Reduce now"];
export const HEALTH_LEVELS = ["Broken", "Degraded", "Normal", "Optimal"];
export const REGIME_LEVELS = ["trending", "mean_reverting", "high_vol", "crisis"];
export const DIRECTION_LEVELS: Direction[] = ["up", "down", "neutral"];

/** What /api/jev sends on. Jev answers judgments, never arithmetic. */
export interface JevQuestion {
  type: "choice" | "noul" | "score";
  instructions: string;
  criteria?: string[];
}

export function buildQuestions(): Record<keyof Answers, JevQuestion> {
  return {
    regime: {
      type: "choice",
      instructions: "Is the market trending, mean reverting, high vol, or in crisis?",
    },
    direction: {
      type: "choice",
      instructions:
        "Price bias over the next few ticks. A judgment, not a forecast formula.",
    },
    toxic_flow: {
      type: "noul",
      instructions: "Is the aggressive flow informed rather than noise?",
    },
    liquidity_stressed: {
      type: "noul",
      instructions: "Is the book thinner than its recent norm?",
    },
    quote_environment: {
      type: "score",
      instructions: "Given this state, how favourable is it to provide liquidity?",
      criteria: ENV_LEVELS,
    },
    inventory_pressure: {
      type: "score",
      instructions:
        "Given the current inventory, how urgent is it to cut the position?",
      criteria: PRESSURE_LEVELS,
    },
    execution_health: {
      type: "score",
      instructions:
        "Given recent fill ratio, reject count, slippage and latency in this state, is execution quality optimal or degrading?",
      criteria: HEALTH_LEVELS,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Decision clients: real Jev through /api/jev, or a labelled mock      */
/* ------------------------------------------------------------------ */

export interface DecisionMeta {
  route: string;
  model: string;
  /** "MOCK" | "TYPESAFE" | "GATEWAY" — the dashboard shows this verbatim */
  decisionClient: string;
  latencyMs: number;
}

export interface DecisionClient {
  ask(state: Record<string, unknown>): Promise<{ answers: Answers; meta: DecisionMeta }>;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function softmaxFromLatent(latent: number, options: string[]): Record<string, number> {
  const scores: Record<string, number> = {};
  let total = 0;
  options.forEach((opt, i) => {
    const s = Math.exp(4.6 * latent * (i === 0 ? 1 : -0.5));
    scores[opt] = s;
    total += s;
  });
  const out: Record<string, number> = {};
  for (const opt of options) out[opt] = scores[opt] / total;
  return out;
}

function choiceConfidence(probs: Record<string, number>): number {
  const n = Object.keys(probs).length;
  if (n <= 1) return 1;
  const peak = Math.max(...Object.values(probs));
  return Math.max(0, Math.min(1, (n * peak - 1) / (n - 1)));
}

function choiceAnswer(probs: Record<string, number>): ChoiceAnswer {
  const choice = Object.keys(probs).reduce((a, b) => (probs[a] >= probs[b] ? a : b));
  const rounded: Record<string, number> = {};
  for (const [k, v] of Object.entries(probs)) rounded[k] = Number(v.toFixed(4));
  return {
    type: "choice",
    choice,
    probabilities: rounded,
    confidence: Number(choiceConfidence(probs).toFixed(4)),
  };
}

function scoreFromLatent(latent: number, nLevels: number): { score: number; probs: number[] } {
  const centre = Math.max(0, Math.min(nLevels - 1, ((latent + 1) / 2) * (nLevels - 1)));
  const weights: number[] = [];
  let total = 0;
  for (let i = 0; i < nLevels; i++) {
    const w = Math.exp(-((i - centre) ** 2) / 0.42);
    weights.push(w);
    total += w;
  }
  const probs = weights.map((w) => w / total);
  const score = probs.reduce((acc, p, i) => acc + i * p, 0);
  return { score, probs };
}

function scoreAnswer(score: number, probs: number[], levels: string[]): ScoreAnswer {
  const legend: Record<string, string> = {};
  const probMap: Record<string, number> = {};
  probs.forEach((p, i) => {
    legend[String(i)] = levels[i];
    probMap[String(i)] = Number(p.toFixed(4));
  });
  return {
    type: "score",
    score: Number(score.toFixed(4)),
    legend,
    probabilities: probMap,
    confidence: Number(Math.max(...probs).toFixed(4)),
  };
}

interface MockLatents {
  regime: number;
  direction: number;
}

/**
 * The mock decision client from the prompt's client.py: plausible, derived
 * from the real snapshot fields (not pure noise), and kept from flickering
 * every tick by a slow-moving latent factor. It is never presented as real —
 * the model string always starts with "mock-".
 */
export function createMockClient(seed = 1, latents: MockLatents = { regime: 0, direction: 0 }): DecisionClient & {
  latents: MockLatents;
} {
  const rng = mulberry32(seed);
  latents.regime = rng() * 2 - 1;
  latents.direction = rng() * 2 - 1;

  const drift = (latent: number, pull = 0.04) => {
    const next = latent + (rng() * 0.32 - 0.16) - pull * latent;
    return Math.max(-1, Math.min(1, next));
  };

  return {
    latents,
    async ask(state) {
      const t0 = performance.now();
      // a mock still "costs" some latency, so the ladder has something to chew on
      await new Promise((r) => setTimeout(r, 40 + rng() * 110));

      latents.regime = drift(latents.regime);
      latents.direction = drift(latents.direction);

      const imbalance = Number(state.imbalance ?? 0) || 0;
      const toxic = Math.max(0, Math.min(1, 0.5 + imbalance * 0.6 + (rng() * 0.3 - 0.15)));
      const liquidityStressed = Math.max(0, Math.min(1, 0.3 + (rng() * 0.5 - 0.2)));

      const regimeProbs = softmaxFromLatent(latents.regime, REGIME_LEVELS);
      const directionProbs = softmaxFromLatent(latents.direction, DIRECTION_LEVELS);

      const env = scoreFromLatent(0.5 - liquidityStressed + (rng() * 0.6 - 0.3), 4);
      const inventoryPressure = Math.abs(Number(state.inventory ?? 0) || 0);
      const pressure = scoreFromLatent(Math.min(1, inventoryPressure * 400) - 0.5, 4);

      const fillRatio = Number.isFinite(Number(state.fillRatio))
        ? Number(state.fillRatio)
        : 1.0;
      const rejectCount = Number(state.rejectCount ?? 0) || 0;
      const latencies = Array.isArray(state.last10LatenciesMs)
        ? (state.last10LatenciesMs as number[])
        : [];
      const avgLatency = latencies.length
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : 100;
      const slippage = Array.isArray(state.last10SlippageBps)
        ? (state.last10SlippageBps as number[])
        : [];
      const avgSlippage = slippage.length
        ? slippage.reduce((a, b) => a + Math.abs(b), 0) / slippage.length
        : 0;
      const healthLatent =
        (fillRatio - 0.5) * 1.5 -
        rejectCount * 0.3 -
        Math.max(0, (avgLatency - 300) / 500) -
        avgSlippage / 20 +
        (rng() * 0.4 - 0.2);
      const health = scoreFromLatent(Math.max(-1, Math.min(1, healthLatent)), 4);

      const answers: Answers = {
        regime: choiceAnswer(regimeProbs),
        direction: choiceAnswer(directionProbs),
        toxic_flow: { type: "noul", noul: Number(toxic.toFixed(4)) },
        liquidity_stressed: {
          type: "noul",
          noul: Number(liquidityStressed.toFixed(4)),
        },
        quote_environment: scoreAnswer(env.score, env.probs, ENV_LEVELS),
        inventory_pressure: scoreAnswer(pressure.score, pressure.probs, PRESSURE_LEVELS),
        execution_health: scoreAnswer(health.score, health.probs, HEALTH_LEVELS),
      };

      return {
        answers,
        meta: {
          route: "MOCK",
          model: "mock-jev-0.1",
          decisionClient: "MOCK",
          latencyMs: Number((performance.now() - t0).toFixed(1)),
        },
      };
    },
  };
}

/** Real Jev, proxied server-side so the key never reaches the browser. */
export function createHttpClient(endpoint = "/api/jev"): DecisionClient {
  return {
    async ask(state) {
      const t0 = performance.now();
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, questions: buildQuestions() }),
        cache: "no-store",
      });
      const data = (await res.json()) as {
        ok: boolean;
        reason?: string;
        answers?: Answers;
        model?: string;
        route?: string;
        latencyMs?: number;
      };
      if (!data.ok || !data.answers) throw new Error(data.reason ?? "decision client failed");
      return {
        answers: data.answers,
        meta: {
          route: data.route ?? "TypeSafe",
          model: data.model ?? "jev-latest",
          decisionClient: data.route ?? "TYPESAFE",
          latencyMs: Number((data.latencyMs ?? performance.now() - t0).toFixed(1)),
        },
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Policy engine — code, not Jev, and the file you'd edit              */
/* ------------------------------------------------------------------ */

export function inventorySkew(
  pressureScore: number,
  maxScore: number,
  inventory: number,
): number {
  if (inventory === 0) return 0;
  const magnitude = Math.max(0, Math.min(1, pressureScore / maxScore));
  return inventory > 0 ? -magnitude : magnitude;
}

/**
 * The strategy hook. The shipped default returns the action unchanged:
 * that is the whole strategy the video ran. Real edge lives here.
 */
export function applyStrategy(action: Action): Action {
  return action;
}

export function composeAction(
  answers: Answers,
  snapshot: Snapshot,
  limits: Limits,
  thresholds: StrategyThresholds = THRESHOLDS,
): Action {
  if (snapshot.drawdownPct > limits.maxDrawdownPct) {
    return {
      kind: KILL,
      reason: `drawdown ${(snapshot.drawdownPct * 100).toFixed(2)}% over limit`,
      skew: 0,
      directionLeg: null,
    };
  }

  const toxic = answers.toxic_flow.noul;
  if (toxic > thresholds.toxicFlowPullThreshold) {
    return {
      kind: PULL_QUOTES,
      reason: `toxic flow ${toxic.toFixed(2)}`,
      skew: 0,
      directionLeg: null,
    };
  }

  const liquidityStressed = answers.liquidity_stressed.noul;
  if (liquidityStressed > thresholds.liquidityStressedWidenThreshold) {
    return {
      kind: WIDEN,
      reason: `liquidity stressed ${liquidityStressed.toFixed(2)}`,
      skew: 0,
      directionLeg: null,
    };
  }

  const q = answers.quote_environment;
  const invP = answers.inventory_pressure;

  let action: Action;
  if (q.score >= thresholds.quoteEnvFullScore && q.confidence > thresholds.quoteEnvFullConfidence) {
    action = {
      kind: QUOTE_BOTH_SIDES,
      skew: inventorySkew(
        invP.score,
        thresholds.inventoryPressureMaxScore,
        snapshot.inventory,
      ),
      reason: `env ${q.score.toFixed(2)} conf ${q.confidence.toFixed(2)}`,
      directionLeg: null,
    };
  } else if (q.score >= thresholds.quoteEnvWideScore) {
    action = {
      kind: QUOTE_WIDE,
      reason: `env ${q.score.toFixed(2)}`,
      skew: 0,
      directionLeg: null,
    };
  } else {
    action = {
      kind: STAND_DOWN,
      reason: `env ${q.score.toFixed(2)} below quoting floor`,
      skew: 0,
      directionLeg: null,
    };
  }

  // The directional leg is bolted onto a quoting action so the demo shows
  // fills constantly. It never overrides a KILL / PULL / WIDEN.
  if (action.kind === QUOTE_BOTH_SIDES || action.kind === QUOTE_WIDE) {
    const direction = answers.direction;
    if (
      direction.choice !== "neutral" &&
      direction.confidence > thresholds.directionConfidenceThreshold
    ) {
      action.directionLeg = direction.choice as "up" | "down";
    }
  }

  return applyStrategy(action);
}

/**
 * Deterministic, Jev-free policy for the RULES_ONLY rung. Uses only spread
 * and imbalance. This is what keeps the loop honestly 24/7 rather than
 * "24/7 until the model has a bad day".
 */
export function fallbackAction(snapshot: Snapshot, limits: Limits): Action {
  const base = { skew: 0, directionLeg: null } as const;
  if (snapshot.drawdownPct > limits.maxDrawdownPct) {
    return { kind: KILL, reason: "drawdown breach (rules-only)", ...base };
  }
  if (snapshot.spreadBps > 15.0) {
    return { kind: STAND_DOWN, reason: "spread too wide for rules-only quoting", ...base };
  }
  if (Math.abs(snapshot.imbalance) > 0.6) {
    return { kind: WIDEN, reason: "book imbalance too high for rules-only quoting", ...base };
  }
  return { kind: QUOTE_WIDE, reason: "rules-only: spread and imbalance both acceptable", ...base };
}

/* ------------------------------------------------------------------ */
/* The five-rung fallback ladder                                       */
/* ------------------------------------------------------------------ */

export type Rung = "run" | "reduce" | "hold_late" | "rules_only" | "kill";

export function selectRung(input: {
  riskKill: boolean;
  decisionLate: boolean;
  jevDown: boolean;
  decisionConfidence: number | null;
  executionHealthScore: number | null;
  lowConfidenceThreshold?: number;
  executionHealthFloor?: number;
}): Rung {
  const {
    riskKill,
    decisionLate,
    jevDown,
    decisionConfidence,
    executionHealthScore,
    lowConfidenceThreshold = LOW_CONFIDENCE_THRESHOLD,
    executionHealthFloor = EXECUTION_HEALTH_FLOOR,
  } = input;
  if (riskKill) return "kill";
  if (decisionLate) return "hold_late";
  if (jevDown) return "rules_only";
  if (decisionConfidence !== null && decisionConfidence < lowConfidenceThreshold) return "reduce";
  if (executionHealthScore !== null && executionHealthScore < executionHealthFloor) return "reduce";
  return "run";
}

/* ------------------------------------------------------------------ */
/* Risk engine — nine hard limits, checked before every single order   */
/* ------------------------------------------------------------------ */

export interface RiskVerdict {
  ok: boolean;
  veto: string | null;
  kill: boolean;
}

export function checkRisk(
  snapshot: Snapshot,
  orderNotionalUsd: number,
  limits: Limits,
  apiErrorStreak: number,
  decisionLatencyMs: number | null,
): RiskVerdict {
  if (snapshot.drawdownPct > limits.maxDrawdownPct)
    return { ok: false, veto: "max_drawdown breached", kill: true };

  const positionUsd = Math.abs(snapshot.inventory) * snapshot.mid;
  if (positionUsd > limits.maxPositionUsd)
    return { ok: false, veto: "max_position_usd breached", kill: true };

  if (snapshot.dailyLossUsd > limits.maxDailyLossUsd)
    return { ok: false, veto: "max_daily_loss breached", kill: true };

  if (orderNotionalUsd > limits.maxOrderNotionalUsd)
    return { ok: false, veto: "order exceeds max_order_notional_usd", kill: false };

  if (snapshot.inventory !== 0 && snapshot.positionAgeS > limits.maxInventoryAgeS)
    return { ok: false, veto: "inventory held past max_inventory_age_s", kill: false };

  if (snapshot.dataAgeS > limits.maxStaleDataAgeS)
    return { ok: false, veto: "market data stale past max_stale_data_age_s", kill: false };

  if (apiErrorStreak > limits.maxApiErrors)
    return { ok: false, veto: "max_api_errors breached", kill: true };

  if (decisionLatencyMs !== null && decisionLatencyMs > limits.maxDecisionLatencyMs)
    return { ok: false, veto: "decision latency over max_decision_latency_ms", kill: false };

  if (snapshot.leverage > limits.maxLeverage)
    return { ok: false, veto: "max_leverage breached", kill: true };

  return { ok: true, veto: null, kill: false };
}

/* ------------------------------------------------------------------ */
/* Pricing — Avellaneda-Stoikov. Fifty-year-old maths, in code.         */
/* ------------------------------------------------------------------ */

export function reservationPrice(
  mid: number,
  inventory: number,
  gamma: number,
  sigma: number,
  timeLeftS: number,
): number {
  return mid - inventory * gamma * sigma ** 2 * timeLeftS;
}

export function halfSpread(
  gamma: number,
  sigma: number,
  timeLeftS: number,
  kappa: number,
): number {
  const inventoryTerm = gamma * sigma ** 2 * timeLeftS;
  const liquidityTerm = (2 / gamma) * Math.log1p(gamma / kappa);
  return inventoryTerm + liquidityTerm;
}

export function quotePrices(
  mid: number,
  inventory: number,
  sigma: number,
  timeLeftS = PRICING.horizonS,
  gamma = PRICING.gamma,
  kappa = PRICING.kappa,
): [number, number] {
  const r = reservationPrice(mid, inventory, gamma, sigma, timeLeftS);
  const h = halfSpread(gamma, sigma, timeLeftS, kappa);
  return [r - h, r + h];
}

/* ------------------------------------------------------------------ */
/* Paper ledger — the local stand-in for the prompt's Alpaca paper API  */
/* ------------------------------------------------------------------ */

export interface PaperFill {
  ts: number;
  tick: number;
  side: "buy" | "sell";
  qty: number;
  price: number;
  notional: number;
  reason: string;
  action: ActionKind;
}

export interface RestingQuote {
  id: number;
  side: "buy" | "sell";
  qty: number;
  price: number;
  ageTicks: number;
}

export interface PaperAccount {
  cash: number;
  inventory: number;
  avgCost: number;
  realized: number;
  highWaterEquity: number;
  dayStartEquity: number;
  positionOpenedAt: number | null;
  resting: RestingQuote[];
  nextQuoteId: number;
  fills: PaperFill[];
}

export function openPaperAccount(cash = STARTING_CASH_USD): PaperAccount {
  return {
    cash,
    inventory: 0,
    avgCost: 0,
    realized: 0,
    highWaterEquity: cash,
    dayStartEquity: cash,
    positionOpenedAt: null,
    resting: [],
    nextQuoteId: 1,
    fills: [],
  };
}

export function equityOf(account: PaperAccount, mid: number): number {
  return account.cash + account.inventory * mid;
}

export function unrealisedPnlOf(account: PaperAccount, mid: number): number {
  return account.inventory === 0 ? 0 : (mid - account.avgCost) * account.inventory;
}

/** Mutates the ledger. Cash is never allowed to go negative (no leverage). */
export function applyFill(
  account: PaperAccount,
  side: "buy" | "sell",
  qty: number,
  price: number,
  ts: number,
  tick: number,
  reason: string,
  action: ActionKind,
): PaperFill | null {
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) return null;
  const signedQty = side === "buy" ? qty : -qty;
  const notional = qty * price;

  if (side === "buy" && notional > account.cash) return null;

  const prev = account.inventory;
  const next = prev + signedQty;

  // realised P&L only exists on the part of a fill that closes exposure
  if (prev !== 0 && Math.sign(signedQty) !== Math.sign(prev)) {
    const closing = Math.min(Math.abs(signedQty), Math.abs(prev));
    account.realized += (price - account.avgCost) * closing * Math.sign(prev);
  }

  if (next === 0) {
    account.avgCost = 0;
    account.positionOpenedAt = null;
  } else if (prev === 0) {
    // opening from flat
    account.avgCost = price;
    account.positionOpenedAt = ts;
  } else if (Math.sign(next) === Math.sign(prev)) {
    if (Math.abs(next) > Math.abs(prev)) {
      // adding to the position: cost basis is the weighted average
      account.avgCost =
        (account.avgCost * Math.abs(prev) + price * Math.abs(signedQty)) / Math.abs(next);
    }
    // a partial close leaves the basis alone — only a flip re-bases it
  } else {
    // flipped through flat: the remainder is a new position at this fill
    account.avgCost = price;
    account.positionOpenedAt = ts;
  }

  account.inventory = next;
  // cash flows both ways: buying spends, selling returns. Equity is then
  // simply cash + inventory * mark, so the ledger can never leak.
  account.cash += side === "buy" ? -notional : notional;

  const fill: PaperFill = { ts, tick, side, qty, price, notional, reason, action };
  account.fills.push(fill);
  if (account.fills.length > 200) account.fills.shift();
  return fill;
}

/* ------------------------------------------------------------------ */
/* The nine-stage tick                                                 */
/* ------------------------------------------------------------------ */

export interface TickRecord {
  tick: number;
  ts: number;
  mid: number;
  bid: number;
  ask: number;
  spread_bps: number;
  latency_ms: number | null;
  route: string;
  model: string;
  decision_client: string;
  action: string;
  action_reason: string;
  direction_leg: "up" | "down" | null;
  direction: string;
  direction_conf: number;
  regime: string;
  regime_conf: number;
  toxic_flow: number;
  liquidity_stressed: number;
  quote_environment: number;
  quote_environment_conf: number;
  inventory_pressure: number;
  execution_health: number;
  vwap: number;
  rung: Rung;
  inventory: number;
  skew: number;
  unrealised_pnl_usd: number;
  drawdown_pct: number;
  equity_usd: number;
  cash_usd: number;
  realized_usd: number;
  risk_veto: string | null;
  quote_bid: number | null;
  quote_ask: number | null;
  fill_qty: number | null;
  fill_price: number | null;
  fill_side: "buy" | "sell" | null;
  jev_down: boolean;
}

export interface LoopContext {
  symbol: string;
  tick: number;
  account: PaperAccount;
  vwap: number;
  vwapWeight: number;
  prevMid: number | null;
  imbalance: number;
  dataAgeS: number;
  apiErrors: number;
  jevDown: boolean;
  latencies: number[];
  slippagesBps: number[];
  rejectCount: number;
  fillRatio: number | null;
  seed: number;
  rng: () => number;
}

export function openContext(symbol: string, mid: number, seed = Date.now() % 100000): LoopContext {
  return {
    symbol,
    tick: 0,
    account: openPaperAccount(),
    vwap: mid,
    vwapWeight: 1,
    prevMid: null,
    imbalance: 0,
    dataAgeS: 0,
    apiErrors: 0,
    jevDown: false,
    latencies: [],
    slippagesBps: [],
    rejectCount: 0,
    fillRatio: 1,
    seed,
    rng: mulberry32(seed),
  };
}

export interface StepInput {
  ctx: LoopContext;
  mid: number;
  bid: number;
  ask: number;
  ts: number;
  /** null when the decision never arrived in time */
  answers: Answers | null;
  meta: DecisionMeta | null;
  jevDown: boolean;
  dataAgeS: number;
  apiErrors: number;
  /** a user-directed paper order taken through the same risk engine */
  manual?: "buy" | "sell";
}

export interface StepOutput {
  ctx: LoopContext;
  record: TickRecord;
  /** set when the risk engine flattened the book and stopped the loop */
  killed: boolean;
}

/**
 * One pass of the nine-stage loop, in the prompt's order:
 *
 *   1 tick clock -> 2 read the book -> 3 state snapshot -> 4 battery
 *   5 policy engine -> 6 pricing -> 7 risk veto -> 8 execute -> 9 log
 */
export function stepLoop(input: StepInput): StepOutput {
  const { ctx, mid, bid, ask, ts } = input;
  const account = ctx.account;
  const tick = ctx.tick + 1;

  // stage 2/3 — the book, reduced to what the limits can be checked against
  const spreadBps = mid > 0 ? ((ask - bid) / mid) * 10000 : 0;

  // a slow, bounded imbalance walk: this app has best bid/ask only, no L2
  // depth, so microstructure the browser cannot see is modelled, not faked
  // as observed (snapshot fields are labelled as such on the page)
  const imbalance = Math.max(
    -1,
    Math.min(1, ctx.imbalance * 0.86 + (ctx.rng() * 0.5 - 0.25)),
  );

  const equity = equityOf(account, mid);
  const highWater = Math.max(account.highWaterEquity, equity);
  const drawdownPct = highWater > 0 ? Math.max(0, (highWater - equity) / highWater) : 0;
  const dailyLossUsd = Math.max(0, account.dayStartEquity - equity);

  const snapshot: Snapshot = {
    symbol: ctx.symbol,
    mid,
    bid,
    ask,
    spreadBps,
    imbalance,
    vwap: ctx.vwap,
    inventory: account.inventory,
    dailyLossUsd,
    drawdownPct,
    positionAgeS: account.positionOpenedAt === null ? 0 : (ts - account.positionOpenedAt) / 1000,
    dataAgeS: input.dataAgeS,
    leverage: 1,
    equityUsd: equity,
    fillRatio: ctx.fillRatio,
    rejectCount: ctx.rejectCount,
    last10LatenciesMs: ctx.latencies,
    last10SlippageBps: ctx.slippagesBps,
  };

  const late =
    input.meta === null || input.meta.latencyMs > LIMITS.maxDecisionLatencyMs;

  // stage 4/5 — the battery, then code's thresholds on top of it
  const answers = input.answers;
  const policyAction =
    answers && !late
      ? composeAction(answers, snapshot, LIMITS)
      : input.jevDown
        ? fallbackAction(snapshot, LIMITS)
        : { kind: HOLD_LATE, reason: "decision missed the tick budget: holding rather than guessing", skew: 0, directionLeg: null } as Action;

  const decisionConfidence = answers ? answers.quote_environment.confidence : null;
  const executionHealthScore = answers ? answers.execution_health.score : null;

  // stage 6/7 — price it, then let the hard limits have the final word
  let riskVeto: string | null = null;
  const sizeUsd = policyAction.kind === "KILL" ? 0 : LIMITS.maxOrderNotionalUsd;
  const orderNotionalUsd =
    policyAction.kind === QUOTE_BOTH_SIDES || policyAction.kind === QUOTE_WIDE
      ? sizeUsd
      : policyAction.directionLeg
        ? sizeUsd
        : 0;
  const verdict = checkRisk(
    snapshot,
    orderNotionalUsd,
    LIMITS,
    input.apiErrors,
    input.meta ? input.meta.latencyMs : null,
  );
  if (!verdict.ok) riskVeto = verdict.veto;

  let rung = selectRung({
    riskKill: policyAction.kind === KILL || verdict.kill,
    decisionLate: late && !input.jevDown,
    jevDown: input.jevDown && !answers,
    decisionConfidence,
    executionHealthScore,
  });

  // stage 6 — pricing. Avellaneda-Stoikov, both terms read per 10,000 of
  // price. That calibration is the prompt's own stated intent (the same
  // defaults have to make sense on a $30 stock and an $85,000 coin); applied
  // as absolute dollars the liquidity term would quote ~$1 from a $76,000
  // mark, so here it is the relative reading, which lands the quotes inside
  // the real touch instead of miles away from it.
  const sigma = Math.max(0.0004, spreadBps / 10000);
  const inventoryUsd = account.inventory * mid;
  const inventoryFraction =
    Math.max(-1, Math.min(1, inventoryUsd / LIMITS.maxPositionUsd)) || 0;
  const reservationRel = 1 - inventoryFraction * PRICING.gamma * sigma;
  const halfRel =
    halfSpread(PRICING.gamma, sigma, PRICING.horizonS, PRICING.kappa) / 10000;
  let quoteBid: number | null = null;
  let quoteAsk: number | null = null;
  if (policyAction.kind === QUOTE_BOTH_SIDES || policyAction.kind === QUOTE_WIDE) {
    const widen = policyAction.kind === QUOTE_WIDE ? 2.5 : 1;
    // the reservation price already leans against inventory; the skew leans harder
    const lean = policyAction.skew * mid * 0.00005;
    quoteBid = mid * reservationRel * (1 - halfRel * widen) - lean;
    quoteAsk = mid * reservationRel * (1 + halfRel * widen) - lean;
  }

  // stage 8 — execute. One fill at most per tick, so the feed reads honestly.
  let fillQty: number | null = null;
  let fillPrice: number | null = null;
  let fillSide: "buy" | "sell" | null = null;
  let action = policyAction;

  if (input.manual && !verdict.ok) {
    action = { ...policyAction, kind: HOLD_LATE, reason: `risk veto: ${riskVeto}` };
  } else if (input.manual) {
    action = {
      kind: input.manual === "buy" ? MANUAL_BUY : MANUAL_SELL,
      reason: "user-directed paper order, same risk engine",
      skew: 0,
      directionLeg: null,
    };
    const price = input.manual === "buy" ? ask : bid;
    const qty = LIMITS.maxOrderNotionalUsd / price;
    const fill = applyFill(account, input.manual, qty, price, ts, tick, action.reason, action.kind);
    if (fill) {
      fillQty = fill.qty;
      fillPrice = fill.price;
      fillSide = fill.side;
    } else {
      riskVeto = "paper cash cannot cover the order";
    }
  } else if (policyAction.kind === KILL) {
    // flatten, stop. A KILL verdict is not a question.
    if (account.inventory !== 0) {
      const side = account.inventory > 0 ? "sell" : "buy";
      const price = side === "sell" ? bid : ask;
      const fill = applyFill(
        account,
        side,
        Math.abs(account.inventory),
        price,
        ts,
        tick,
        "KILL: flattening",
        KILL,
      );
      if (fill) {
        fillQty = fill.qty;
        fillPrice = fill.price;
        fillSide = fill.side;
      }
    }
    account.resting = [];
  } else if (!verdict.ok) {
    // a veto means nothing goes on the book this tick
    rung = verdict.kill ? "kill" : rung;
  } else if (rung !== "hold_late" && rung !== "rules_only") {
    const reduce = rung === "reduce";
    const sizeMult = reduce ? 0.5 : 1;

    const positionUsd = Math.abs(account.inventory) * mid;
    const roomUsd = Math.max(0, LIMITS.maxPositionUsd - positionUsd);

    // resting quotes first: a quote fills when the mark walks into it, which
    // is the only fill a browser can observe honestly — there are no takers
    // to see from here, so nothing is invented to stand in for them
    const stillResting: RestingQuote[] = [];
    for (const q of account.resting) {
      q.ageTicks += 1;
      const crossed = q.side === "buy" ? mid <= q.price : mid >= q.price;
      // a quote that would push the book past the hard cap is pulled rather
      // than filled: the risk engine gets to refuse a resting order too, not
      // just the order that posted it
      const projected =
        Math.abs(account.inventory + (q.side === "buy" ? q.qty : -q.qty)) * mid;
      if (projected > LIMITS.maxPositionUsd) {
        riskVeto = riskVeto ?? "max_position_usd breached";
        continue;
      }
      if (crossed && fillQty === null) {
        const fill = applyFill(
          account,
          q.side,
          q.qty,
          q.price,
          ts,
          tick,
          "resting quote taken",
          policyAction.kind,
        );
        if (fill) {
          fillQty = fill.qty;
          fillPrice = fill.price;
          fillSide = fill.side;
        }
      } else if (q.ageTicks < 20) {
        stillResting.push(q);
      }
    }
    account.resting =
      Math.abs(account.inventory) * mid >= LIMITS.maxPositionUsd * 0.95
        ? []
        : stillResting.slice(-6);

    // then the directional leg, which is what makes the demo show fills. It
    // is sized to the room left under the position cap, so the strategy stays
    // on the conservative side of the hard limit rather than tripping it.
    if (policyAction.directionLeg && fillQty === null && roomUsd > 1) {
      const side: "buy" | "sell" = policyAction.directionLeg === "up" ? "buy" : "sell";
      const price = side === "buy" ? ask : bid;
      const qty =
        (Math.min(LIMITS.maxOrderNotionalUsd, roomUsd * 0.5) / price) * sizeMult;
      const notional = qty * price;
      const legVerdict = checkRisk(snapshot, notional, LIMITS, input.apiErrors, null);
      if (legVerdict.ok) {
        const fill = applyFill(
          account,
          side,
          qty,
          price,
          ts,
          tick,
          `${policyAction.directionLeg} leg`,
          action.kind,
        );
        if (fill) {
          fillQty = fill.qty;
          fillPrice = fill.price;
          fillSide = fill.side;
        }
      } else {
        riskVeto = legVerdict.veto;
      }
    }

    // the quotes that did not fill rest on the book, capped by what is left
    // of the position limit and by the book depth the ledger keeps
    if (
      quoteBid !== null &&
      quoteAsk !== null &&
      fillQty === null &&
      roomUsd > LIMITS.maxPositionUsd * 0.25
    ) {
      // sized to four fifths of the room, split across the two sides, so a
      // mid that keeps rising cannot walk the position over the hard cap
      const perSideUsd = Math.min(roomUsd, LIMITS.maxPositionUsd * 0.6) / 2;
      const qtyEach = Math.min(perSideUsd, LIMITS.maxOrderNotionalUsd / 2) / mid;
      const repost: RestingQuote[] = [
        { id: account.nextQuoteId++, side: "buy", qty: qtyEach, price: quoteBid, ageTicks: 0 },
        { id: account.nextQuoteId++, side: "sell", qty: qtyEach, price: quoteAsk, ageTicks: 0 },
      ];
      account.resting = [...account.resting, ...repost].slice(-6);
    }
  }

  // stage 9 — log the tick, keep the ledger honest
  const vwapWeight = Math.min(60, ctx.vwapWeight + 1);
  const vwap = ctx.vwap + (mid - ctx.vwap) / vwapWeight;
  account.highWaterEquity = Math.max(highWater, equityOf(account, mid));

  const nextCtx: LoopContext = {
    ...ctx,
    tick,
    account,
    vwap,
    vwapWeight,
    prevMid: mid,
    imbalance,
    dataAgeS: input.dataAgeS,
    apiErrors: input.apiErrors,
    jevDown: input.jevDown,
    latencies: input.meta
      ? [...ctx.latencies, input.meta.latencyMs].slice(-10)
      : ctx.latencies,
    slippagesBps: fillQty !== null && fillPrice !== null
      ? [...ctx.slippagesBps, ((fillPrice - mid) / mid) * 10000].slice(-10)
      : ctx.slippagesBps,
    rejectCount: riskVeto && !fillQty ? ctx.rejectCount + 1 : ctx.rejectCount,
    fillRatio: ctx.fillRatio === null ? null : Math.min(1, Math.max(0, ctx.fillRatio + (fillQty ? 0.02 : -0.01))),
  };

  const record: TickRecord = {
    tick,
    ts,
    mid,
    bid,
    ask,
    spread_bps: spreadBps,
    latency_ms: input.meta ? input.meta.latencyMs : null,
    route: input.meta ? input.meta.route : "—",
    model: input.meta ? input.meta.model : input.jevDown ? "unavailable" : "—",
    decision_client: input.meta ? input.meta.decisionClient : input.jevDown ? "MOCK" : "MOCK",
    action: action.kind + (action.directionLeg ? ` (${action.directionLeg} leg)` : ""),
    action_reason: riskVeto ? `risk veto: ${riskVeto}` : action.reason,
    direction_leg: action.directionLeg,
    direction: answers ? answers.direction.choice : "—",
    direction_conf: answers ? answers.direction.confidence : 0,
    regime: answers ? answers.regime.choice : "—",
    regime_conf: answers ? answers.regime.confidence : 0,
    toxic_flow: answers ? answers.toxic_flow.noul : 0,
    liquidity_stressed: answers ? answers.liquidity_stressed.noul : 0,
    quote_environment: answers ? answers.quote_environment.score : 0,
    quote_environment_conf: answers ? answers.quote_environment.confidence : 0,
    inventory_pressure: answers ? answers.inventory_pressure.score : 0,
    execution_health: answers ? answers.execution_health.score : 0,
    vwap,
    rung,
    inventory: account.inventory,
    skew: action.skew,
    unrealised_pnl_usd: unrealisedPnlOf(account, mid),
    drawdown_pct: drawdownPct,
    equity_usd: equityOf(account, mid),
    cash_usd: account.cash,
    realized_usd: account.realized,
    risk_veto: riskVeto,
    quote_bid: quoteBid,
    quote_ask: quoteAsk,
    fill_qty: fillQty,
    fill_price: fillPrice,
    fill_side: fillSide,
    jev_down: input.jevDown && !answers,
  };

  return { ctx: nextCtx, record, killed: policyAction.kind === KILL };
}

/* ------------------------------------------------------------------ */
/* Dashboard selectors                                                 */
/* ------------------------------------------------------------------ */

export type TickSide = "buy" | "sell" | "late";

/** The same colouring rule the prompt's dashboard.js uses. */
export function sideOf(t: Pick<TickRecord, "rung" | "action" | "direction_leg" | "skew">): TickSide {
  if (t.rung === "hold_late" || t.action.startsWith(HOLD_LATE)) return "late";
  if (t.direction_leg === "up") return "buy";
  if (t.direction_leg === "down") return "sell";
  if (t.action.startsWith(PULL_QUOTES) || t.action.startsWith(STAND_DOWN)) return "late";
  return (t.skew || 0) < 0 ? "sell" : "buy";
}

export interface JevStats {
  model: string;
  decision_client: string;
  calls: number;
  avg_ms: number | null;
  late_count: number;
  uptime_s: number;
  tick_seconds: number;
}

export function statsOf(ticks: TickRecord[], startedAt: number, now: number): JevStats {
  const last = ticks[ticks.length - 1];
  const measured = ticks.filter((t) => t.latency_ms !== null).map((t) => t.latency_ms as number);
  return {
    model: last ? last.model : "—",
    decision_client: last ? last.decision_client : "MOCK",
    calls: ticks.filter((t) => t.route !== "—").length,
    avg_ms: measured.length ? measured.reduce((a, b) => a + b, 0) / measured.length : null,
    late_count: ticks.filter((t) => t.latency_ms === null).length,
    uptime_s: Math.max(0, (now - startedAt) / 1000),
    tick_seconds: TICK_SECONDS,
  };
}
