"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { INSTRUMENTS, type Instrument } from "@/lib/market-data";

export interface Position {
  symbol: string;
  qty: number;
  avgCost: number;
  openedAt: number;
  source: "manual" | "ai";
}

export interface Account {
  cash: number;
  deposits: number;
  withdrawn: number;
  realizedPl: number;
  /** funds currently entrusted to the AI trading simulation */
  aiPrincipal: number;
  positions: Position[];
}

const STORAGE_KEY = "axion_account_v2";

const START_CASH = 12840.55;

/** Deterministic seed portfolio so the dashboard looks alive on first run */
export function seedPositions(): Position[] {
  const list = INSTRUMENTS.filter((i) => i.kind !== "forex");
  return list.map((inst, idx) => {
    const qty = Number(((((idx * 37) % 19) + 3) * (inst.price > 500 ? 0.6 : 4)).toFixed(2));
    const drift = 1 + (((idx * 53) % 21) - 10) / 100;
    return { symbol: inst.symbol, qty, avgCost: inst.price / drift, openedAt: 0, source: "manual" as const };
  });
}

function defaultAccount(): Account {
  return {
    cash: START_CASH,
    deposits: 25000,
    withdrawn: 0,
    realizedPl: 0,
    aiPrincipal: 0,
    positions: seedPositions(),
  };
}

export type TradeResult = { ok: true; msg: string } | { ok: false; msg: string };

interface AccountCtx {
  account: Account;
  hydrated: boolean;
  deposit: (amount: number) => void;
  withdraw: (amount: number) => TradeResult;
  buy: (symbol: string, qty: number, price: number) => TradeResult;
  sell: (symbol: string, qty: number, price: number) => TradeResult;
  entrustToAi: (amount: number) => TradeResult;
  /** settle a finished AI session: returns principal + pnl to cash */
  aiSettle: (pnl: number) => void;
  qtyOwned: (symbol: string) => number;
  /** demo helper: restore the starting cash and portfolio */
  resetAccount: () => void;
}

const Ctx = createContext<AccountCtx | null>(null);

export function useAccount(): AccountCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAccount must be used inside AccountProvider");
  return v;
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<Account>(defaultAccount);
  const [hydrated, setHydrated] = useState(false);

  // hydrate from localStorage after first client render (SSR-safe)
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Account;
        if (typeof parsed.cash === "number" && Array.isArray(parsed.positions)) {
          setAccount({ ...defaultAccount(), ...parsed });
        }
      }
    } catch {
      /* corrupted storage — keep defaults */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
    } catch {
      /* storage full/unavailable */
    }
  }, [account, hydrated]);

  const deposit = useCallback((amount: number) => {
    if (!(amount > 0)) return;
    setAccount((a) => ({ ...a, cash: a.cash + amount, deposits: a.deposits + amount }));
  }, []);

  const withdraw = useCallback(
    (amount: number): TradeResult => {
      if (!(amount > 0)) return { ok: false, msg: "Enter an amount" };
      if (amount > account.cash) return { ok: false, msg: "Insufficient free funds" };
      setAccount((a) =>
        amount > a.cash
          ? a
          : { ...a, cash: a.cash - amount, withdrawn: a.withdrawn + amount }
      );
      return { ok: true, msg: "Withdrawal complete" };
    },
    [account.cash]
  );

  const buy = useCallback(
    (symbol: string, qty: number, price: number): TradeResult => {
      if (!(qty > 0) || !(price > 0)) return { ok: false, msg: "Invalid order" };
      const notional = qty * price;
      if (notional > account.cash) return { ok: false, msg: "Insufficient free funds" };
      setAccount((a) => {
        if (notional > a.cash) return a;
        const existing = a.positions.find((p) => p.symbol === symbol);
        const positions = existing
          ? a.positions.map((p) =>
              p.symbol === symbol
                ? { ...p, qty: p.qty + qty, avgCost: (p.avgCost * p.qty + price * qty) / (p.qty + qty) }
                : p
            )
          : [
              ...a.positions,
              { symbol, qty, avgCost: price, openedAt: Date.now(), source: "manual" as const },
            ];
        return { ...a, cash: a.cash - notional, positions };
      });
      return { ok: true, msg: `Bought ${qty.toFixed(4).replace(/\.?0+$/, "")} ${symbol}` };
    },
    [account.cash]
  );

  const sell = useCallback(
    (symbol: string, qty: number, price: number): TradeResult => {
      if (!(qty > 0) || !(price > 0)) return { ok: false, msg: "Invalid order" };
      const ownedNow = account.positions.find((p) => p.symbol === symbol)?.qty ?? 0;
      if (ownedNow < qty) return { ok: false, msg: "You don't own enough of this instrument" };
      setAccount((a) => {
        const pos = a.positions.find((p) => p.symbol === symbol);
        if (!pos || pos.qty < qty) return a;
        const realized = (price - pos.avgCost) * qty;
        const positions =
          Math.abs(pos.qty - qty) < 1e-9
            ? a.positions.filter((p) => p.symbol !== symbol)
            : a.positions.map((p) => (p.symbol === symbol ? { ...p, qty: p.qty - qty } : p));
        return { ...a, cash: a.cash + qty * price, realizedPl: a.realizedPl + realized, positions };
      });
      return { ok: true, msg: `Sold ${qty.toFixed(4).replace(/\.?0+$/, "")} ${symbol}` };
    },
    [account.positions]
  );

  const entrustToAi = useCallback(
    (amount: number): TradeResult => {
      if (!(amount > 0)) return { ok: false, msg: "Enter an amount" };
      if (amount > account.cash) return { ok: false, msg: "Insufficient free funds" };
      setAccount((a) =>
        amount > a.cash
          ? a
          : { ...a, cash: a.cash - amount, aiPrincipal: a.aiPrincipal + amount }
      );
      return { ok: true, msg: "Funds entrusted to the AI" };
    },
    [account.cash]
  );

  const aiSettle = useCallback((pnl: number) => {
    setAccount((a) => ({
      ...a,
      cash: a.cash + a.aiPrincipal + pnl,
      aiPrincipal: 0,
      realizedPl: a.realizedPl + pnl,
    }));
  }, []);

  const qtyOwned = useCallback(
    (symbol: string) => account.positions.find((p) => p.symbol === symbol)?.qty ?? 0,
    [account.positions]
  );

  const resetAccount = useCallback(() => {
    setAccount(defaultAccount());
    try {
      window.localStorage.removeItem("axion_ai_session_v1");
    } catch {
      /* noop */
    }
  }, []);

  const value = useMemo(
    () => ({ account, hydrated, deposit, withdraw, buy, sell, entrustToAi, aiSettle, qtyOwned, resetAccount }),
    [account, hydrated, deposit, withdraw, buy, sell, entrustToAi, aiSettle, qtyOwned, resetAccount]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function kindOf(symbol: string): Instrument["kind"] {
  return INSTRUMENTS.find((i) => i.symbol === symbol)?.kind ?? "stock";
}
