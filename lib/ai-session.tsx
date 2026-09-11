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
} from "@/lib/ai-trader";

const KEY = "axion_ai_session_v1";

interface SessionStatus {
  value: number | null;
}

/**
 * Owns the AI session lifecycle: persistence, the 2-second reveal tick,
 * the real-data context (live quotes + Fear & Greed), and settlement.
 */
export function AiSessionProvider({ children }: { children: React.ReactNode }) {
  const { account, hydrated: accountHydrated, aiSettle } = useAccount();
  const { quotes } = useLivePrices();
  const [session, setSession] = useState<AiSession | null>(null);
  const [fng, setFng] = useState<number | null>(null);
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

    // Fear & Greed via our proxy (5-min cache)
    fetch("/api/fng", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: SessionStatus | null) => setFng(j?.value ?? null))
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

  // reveal tick: advance the session every 2s while running
  useEffect(() => {
    if (!session || session.phase !== "running") return;
    const t = setInterval(() => {
      setSession((s) => (s ? advanceSession(s, Date.now(), 1, liveRef.current) : s));
    }, 2000);
    return () => clearInterval(t);
  }, [session?.phase]);

  // settle into the account when a session completes (waits for account hydration)
  useEffect(() => {
    if (session?.phase === "done" && !session.settled && accountHydrated) {
      aiSettle(session.equity - session.principal);
      setSession({ ...session, settled: true });
    }
  }, [session, accountHydrated, aiSettle]);

  const start = useCallback(
    (principal: number, durationId: DurationId, goalMultiple: number, lossPct: number) => {
      const s = createSession(principal, durationId, Date.now() % 100000, { goalMultiple, lossPct });
      setSession(s);
    },
    []
  );

  const stop = useCallback(() => {
    setSession((s) => (s ? haltSession(s) : s));
  }, []);

  const reset = useCallback(() => setSession(null), []);

  const value = useMemo(
    () => ({ session, start, stop, reset, fng }),
    [session, start, stop, reset, fng]
  );

  return <AiSessionCtx.Provider value={value}>{children}</AiSessionCtx.Provider>;
}

export interface AiSessionCtxValue {
  session: AiSession | null;
  start: (principal: number, durationId: DurationId, goalMultiple: number, lossPct: number) => void;
  stop: () => void;
  reset: () => void;
  fng: number | null;
}

const AiSessionCtx = createContext<AiSessionCtxValue | null>(null);

export function useAiSession(): AiSessionCtxValue {
  const v = useContext(AiSessionCtx);
  if (!v) throw new Error("useAiSession must be used inside AiSessionProvider");
  return v;
}
