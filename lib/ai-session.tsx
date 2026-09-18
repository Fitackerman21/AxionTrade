"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useLivePrices } from "@/components/live-prices";
import { useAccount } from "@/lib/account-store";
import {
  DEFAULT_SPEED,
  advanceSession,
  createSession,
  durationMs,
  haltSession,
  setSessionSpeed,
  sessionStats,
  type AiOutcome,
  type AiSession,
  type DurationId,
  type LiveContext,
  type SpeedId,
  type TradeDirective,
  type TradeEvent,
} from "@/lib/ai-trader";

const KEY = "axion_ai_session_v4";
const LEGACY_KEYS = ["axion_ai_session_v3", "axion_ai_session_v2"];
const NOTIF_KEY = "axion_ai_notifications_v1";
const HISTORY_KEY = "axion_ai_history_v1";

/** Wall ms between engine evaluations. The engine advances on the *session*
 * clock, so this only governs how often we look — not how fast time runs. */
const TICK_MS = 1200;
/** Fills revealed per evaluation. Enough that returning after a long gap
 * catches up in a visible stream rather than dumping the whole book at once. */
const MAX_FILLS_PER_TICK = 8;

/** Milestone notifications raised for the dashboard bell (id -> payload). */
export interface AiNotification {
  id: string;
  /** wall-clock ms, for bell ordering */
  at: number;
  title: string;
  body: string;
  tone: "milestone" | "derisk" | "settle";
}

/** A completed (or halted) engine run, kept for review. */
export interface SessionRecord {
  id: string;
  startAt: number;
  endedAt: number;
  durationId: DurationId;
  principal: number;
  equity: number;
  trades: number;
  winRate: number;
  fees: number;
  outcome: AiOutcome;
}

/** Bring a legacy (wall-clock) session onto the session clock. */
function migrate(raw: unknown): AiSession | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<AiSession> & { endAt?: number };
  if (typeof s.principal !== "number" || !Array.isArray(s.plan)) return null;

  const durationId: DurationId = s.durationId ?? "7d";
  const windowMs = s.windowMs ?? durationMs(durationId);
  const startAt = typeof s.startAt === "number" ? s.startAt : Date.now();
  const planLen = Math.max(1, s.plan.length);

  // derive how far into the window an old session had actually got
  const cursor = typeof s.cursor === "number" ? s.cursor : 0;
  const clockMs =
    typeof s.clockMs === "number" ? s.clockMs : Math.min(windowMs, (cursor / planLen) * windowMs);

  const migrated: AiSession = {
    phase: s.phase ?? "running",
    principal: s.principal,
    equity: s.equity ?? s.principal,
    floorUsd: s.floorUsd ?? s.principal * 0.55,
    peak: s.peak ?? s.principal,
    durationId,
    startAt,
    clockMs,
    lastWallAt: Date.now(),
    speed: s.speed ?? DEFAULT_SPEED,
    windowMs,
    strategy: s.strategy ?? "Momentum Ignition",
    plan: s.plan as AiSession["plan"],
    trades: Array.isArray(s.trades) ? s.trades : [],
    events: Array.isArray(s.events) ? s.events : [],
    cursor,
    outcome: s.outcome ?? null,
    milestonesHit: Array.isArray(s.milestonesHit) ? s.milestonesHit : [],
    feesPaid: typeof s.feesPaid === "number" ? s.feesPaid : 0,
    settled: s.settled,
  };
  return migrated;
}

/**
 * Owns the AI session lifecycle: the session clock (which keeps advancing while
 * the page is closed), persistence, speed control, settlement, and milestone
 * notifications.
 */
export function AiSessionProvider({ children }: { children: React.ReactNode }) {
  const { account, hydrated: accountHydrated, aiSettle } = useAccount();
  const { quotes } = useLivePrices();
  const [session, setSession] = useState<AiSession | null>(null);
  const [fng, setFng] = useState<number | null>(null);
  const [notifications, setNotifications] = useState<AiNotification[]>([]);
  const [history, setHistory] = useState<SessionRecord[]>([]);
  const hydratedRef = useRef(false);

  // hydrate persisted session once (migrating legacy shapes)
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        setSession(migrate(JSON.parse(raw)));
      } else {
        for (const k of LEGACY_KEYS) {
          const legacy = window.localStorage.getItem(k);
          if (!legacy) continue;
          const m = migrate(JSON.parse(legacy));
          if (m) setSession(m);
          window.localStorage.removeItem(k);
          break;
        }
      }
    } catch {
      /* ignore corrupted state */
    }
    try {
      const rawH = window.localStorage.getItem(HISTORY_KEY);
      if (rawH) setHistory(JSON.parse(rawH) as SessionRecord[]);
    } catch {
      /* ignore */
    }
    hydratedRef.current = true;

    try {
      const rawN = window.localStorage.getItem(NOTIF_KEY);
      if (rawN) setNotifications(JSON.parse(rawN) as AiNotification[]);
    } catch {
      /* ignore */
    }

    // Fear & Greed via our proxy (5-min cache)
    fetch("/api/fng", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { value?: number } | null) => setFng(j?.value ?? null))
      .catch(() => setFng(null));
  }, []);

  // persist
  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      if (session) window.localStorage.setItem(KEY, JSON.stringify(session));
      else window.localStorage.removeItem(KEY);
    } catch {
      /* storage unavailable */
    }
  }, [session]);

  useEffect(() => {
    try {
      window.localStorage.setItem(NOTIF_KEY, JSON.stringify(notifications.slice(-20)));
    } catch {
      /* ignore */
    }
  }, [notifications]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 12)));
    } catch {
      /* ignore */
    }
  }, [history]);

  // keep latest live-data context in refs so the engine interval never resets
  const liveRef = useRef<LiveContext>({ quoteFor: () => undefined, fng: null });
  useEffect(() => {
    liveRef.current = {
      quoteFor: (symbol) => {
        const q = quotes.get(symbol);
        return q ? { price: q.price, changePct: q.changePct } : undefined;
      },
      fng,
    };
  }, [quotes, fng]);

  /**
   * Engine evaluation loop. Every pass the session clock is credited with the
   * wall time elapsed (× the current rate) and any fills the clock has reached
   * are revealed. The interval never restarts on state change — `phase` is read
   * from a ref — so the clock can't be reset by a re-render.
   */
  const phaseRef = useRef<"idle" | "running" | "done">("idle");
  phaseRef.current = session?.phase ?? "idle";
  const notifiedRef = useRef<Set<string>>(new Set());
  const directiveRef = useRef<TradeDirective | null>(null);

  useEffect(() => {
    const t = setInterval(() => {
      if (phaseRef.current !== "running") return;
      setSession((s) => {
        if (!s || s.phase !== "running") return s;
        const d = directiveRef.current;
        directiveRef.current = null;
        return advanceSession(s, Date.now(), MAX_FILLS_PER_TICK, liveRef.current, d);
      });
    }, TICK_MS);
    return () => clearInterval(t);
  }, []);

  // Milestone / de-risk notifications (watch session events, not the interval)
  useEffect(() => {
    if (!session) return;
    const fresh: AiNotification[] = [];
    for (const ev of session.events) {
      if (notifiedRef.current.has(ev.id)) continue;
      notifiedRef.current.add(ev.id);
      if (ev.kind === "milestone") {
        fresh.push({
          id: ev.id,
          at: Date.now(),
          title: `AxAI milestone +${ev.text.match(/\+(\d+)%/)?.[1] ?? ""}%`,
          body: ev.text,
          tone: "milestone",
        });
      } else if (ev.kind === "derisk") {
        fresh.push({
          id: ev.id,
          at: Date.now(),
          title: "AxAI is de-risking",
          body: ev.text,
          tone: "derisk",
        });
      }
    }
    if (fresh.length) setNotifications((n) => [...n, ...fresh].slice(-20));
  }, [session?.events]);

  // settle into the account when a session completes (waits for account hydration)
  useEffect(() => {
    if (session?.phase !== "done" || session.settled || !accountHydrated) return;
    const stats = sessionStats(session);
    aiSettle(session.equity - session.principal, session.principal);
    notifiedRef.current.add(`settle-${session.startAt}`);
    setNotifications((n) => [
      ...n,
      {
        id: `settle-${session.startAt}`,
        at: Date.now(),
        title:
          session.equity >= session.principal
            ? `AxAI settled +$${Math.round(session.equity - session.principal).toLocaleString()}`
            : `AxAI settled −$${Math.round(session.principal - session.equity).toLocaleString()}`,
        body: `Window closed at $${session.equity.toLocaleString(undefined, { maximumFractionDigits: 0 })} — funds returned to your balance.`,
        tone: "settle",
      },
    ]);
    setHistory((h) =>
      [
        {
          id: `${session.startAt}`,
          startAt: session.startAt,
          endedAt: session.startAt + session.clockMs,
          durationId: session.durationId,
          principal: session.principal,
          equity: session.equity,
          trades: session.trades.length,
          winRate: stats.winRate,
          fees: session.feesPaid,
          outcome: session.outcome,
        },
        ...h,
      ].slice(0, 12)
    );
    setSession({ ...session, settled: true });
  }, [session, accountHydrated, aiSettle]);

  const start = useCallback(
    (principal: number, durationId: DurationId, lossPct: number, speed?: SpeedId) => {
      const s = createSession(principal, durationId, Date.now() % 100000, { lossPct, speed });
      notifiedRef.current = new Set();
      setSession(s);
    },
    []
  );

  /** Queue a manual signal (from the Buy/Sell buttons) — executed on the next fill. */
  const signal = useCallback((symbol: string, dir: "LONG" | "SHORT") => {
    directiveRef.current = { symbol, dir };
  }, []);

  /** Change the time-lapse rate, crediting elapsed session time at the old rate. */
  const setSpeed = useCallback((speed: SpeedId) => {
    setSession((s) => (s ? setSessionSpeed(s, speed, Date.now()) : s));
  }, []);

  const stop = useCallback(() => {
    setSession((s) => (s ? haltSession(s, Date.now()) : s));
  }, []);

  const reset = useCallback(() => setSession(null), []);

  const clearHistory = useCallback(() => setHistory([]), []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications((n) => n.filter((x) => x.id !== id));
  }, []);

  const lastTrade = session && session.trades.length > 0 ? session.trades[session.trades.length - 1] : null;

  const value = useMemo(
    () => ({
      session,
      start,
      stop,
      reset,
      setSpeed,
      fng,
      notifications,
      dismissNotification,
      lastTrade,
      signal,
      history,
      clearHistory,
    }),
    [
      session,
      start,
      stop,
      reset,
      setSpeed,
      fng,
      notifications,
      dismissNotification,
      lastTrade,
      signal,
      history,
      clearHistory,
    ]
  );

  return <AiSessionCtx.Provider value={value}>{children}</AiSessionCtx.Provider>;
}

export interface AiSessionCtxValue {
  session: AiSession | null;
  start: (principal: number, durationId: DurationId, lossPct: number, speed?: SpeedId) => void;
  stop: () => void;
  reset: () => void;
  /** change the session-clock rate */
  setSpeed: (speed: SpeedId) => void;
  fng: number | null;
  notifications: AiNotification[];
  dismissNotification: (id: string) => void;
  /** latest executed trade — used by the chart to animate fills */
  lastTrade: TradeEvent | null;
  /** queue a manual signal for the engine's next fill */
  signal: (symbol: string, dir: "LONG" | "SHORT") => void;
  /** completed engine runs */
  history: SessionRecord[];
  clearHistory: () => void;
}

const AiSessionCtx = createContext<AiSessionCtxValue | null>(null);

export function useAiSession(): AiSessionCtxValue {
  const v = useContext(AiSessionCtx);
  if (!v) throw new Error("useAiSession must be used inside AiSessionProvider");
  return v;
}
