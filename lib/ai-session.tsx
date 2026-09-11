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
  advanceSession,
  createSession,
  haltSession,
  type AiSession,
  type DurationId,
  type LiveContext,
  type TradeDirective,
  type TradeEvent,
} from "@/lib/ai-trader";

const KEY = "axion_ai_session_v3";
const NOTIF_KEY = "axion_ai_notifications_v1";

/** Milestone notifications raised for the dashboard bell (id -> payload). */
export interface AiNotification {
  id: string;
  at: number;
  title: string;
  body: string;
  tone: "milestone" | "derisk" | "settle";
}

/**
 * Owns the AI session lifecycle: persistence, continuous streaming (the
 * reveal tick NEVER stops on profit — only the loss threshold or the window
 * ends it), real-data context (live quotes + Fear & Greed), settlement, and
 * milestone notifications.
 */
export function AiSessionProvider({ children }: { children: React.ReactNode }) {
  const { account, hydrated: accountHydrated, aiSettle } = useAccount();
  const { quotes } = useLivePrices();
  const [session, setSession] = useState<AiSession | null>(null);
  const [fng, setFng] = useState<number | null>(null);
  const [notifications, setNotifications] = useState<AiNotification[]>([]);
  const hydratedRef = useRef(false);

  // hydrate persisted session once
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw) as AiSession;
        if (s && typeof s.principal === "number" && Array.isArray(s.plan)) setSession(s);
      }
    } catch {
      /* ignore corrupted state */
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

  // keep latest live-data context in refs so the reveal interval never resets
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

  //Continuous streaming tick: advances every 2s while running.
  // Profit never stops the engine — `advanceSession` only ends it on the
  // loss threshold or window expiry. `phase` is read from a ref so the
  // interval never resets, and every state change is persisted.
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
        return advanceSession(s, Date.now(), 1, liveRef.current, d);
      });
    }, 2000);
    return () => clearInterval(t);
  }, []);

  // Milestone / de-risk notifications (watch session events, not interval)
  useEffect(() => {
    if (!session) return;
    const fresh: AiNotification[] = [];
    for (const ev of session.events) {
      if (notifiedRef.current.has(ev.id)) continue;
      notifiedRef.current.add(ev.id);
      if (ev.kind === "milestone") {
        fresh.push({
          id: ev.id,
          at: ev.at,
          title: `AxAI milestone +${ev.text.match(/\+(\d+)%/)?.[1] ?? ""}%`,
          body: ev.text,
          tone: "milestone",
        });
      } else if (ev.kind === "derisk") {
        fresh.push({
          id: ev.id,
          at: ev.at,
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
    if (session?.phase === "done" && !session.settled && accountHydrated) {
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
      setSession({ ...session, settled: true });
    }
  }, [session, accountHydrated, aiSettle]);

  const start = useCallback(
    (principal: number, durationId: DurationId, lossPct: number) => {
      const s = createSession(principal, durationId, Date.now() % 100000, { lossPct });
      notifiedRef.current = new Set();
      setSession(s);
    },
    []
  );

  /** Queue a manual signal (from the Buy/Sell buttons) — executed on the next scan. */
  const signal = useCallback((symbol: string, dir: "LONG" | "SHORT") => {
    directiveRef.current = { symbol, dir };
  }, []);

  const stop = useCallback(() => {
    setSession((s) => (s ? haltSession(s) : s));
  }, []);

  const reset = useCallback(() => setSession(null), []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications((n) => n.filter((x) => x.id !== id));
  }, []);

  const lastTrade = session && session.trades.length > 0 ? session.trades[session.trades.length - 1] : null;

  const value = useMemo(
    () => ({ session, start, stop, reset, fng, notifications, dismissNotification, lastTrade, signal }),
    [session, start, stop, reset, fng, notifications, dismissNotification, lastTrade, signal]
  );

  return <AiSessionCtx.Provider value={value}>{children}</AiSessionCtx.Provider>;
}

export interface AiSessionCtxValue {
  session: AiSession | null;
  start: (principal: number, durationId: DurationId, lossPct: number) => void;
  stop: () => void;
  reset: () => void;
  fng: number | null;
  notifications: AiNotification[];
  dismissNotification: (id: string) => void;
  /** latest executed trade — used by the chart to animate fills */
  lastTrade: TradeEvent | null;
  /** queue a manual signal for the engine's next execution */
  signal: (symbol: string, dir: "LONG" | "SHORT") => void;
}

const AiSessionCtx = createContext<AiSessionCtxValue | null>(null);

export function useAiSession(): AiSessionCtxValue {
  const v = useContext(AiSessionCtx);
  if (!v) throw new Error("useAiSession must be used inside AiSessionProvider");
  return v;
}
