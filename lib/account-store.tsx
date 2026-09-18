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

/* ------------------------------ ledger ------------------------------ */

export type TxKind = "deposit" | "withdrawal" | "ai-fund" | "ai-settle";
export type TxStatus = "completed" | "processing" | "declined";

export interface Transaction {
  id: string;
  kind: TxKind;
  status: TxStatus;
  /** the rail the money moved on, e.g. "Visa •••• 4291" */
  method: string;
  /** signed in account currency: positive = money in */
  amount: number;
  fee: number;
  reference: string;
  at: number;
  /** extra context shown in the ledger, e.g. why a withdrawal is pending */
  note?: string;
}

export interface Account {
  cash: number;
  deposits: number;
  withdrawn: number;
  realizedPl: number;
  /** funds currently entrusted to the AI trading simulation */
  aiPrincipal: number;
  positions: Position[];
  /** every cash movement, newest first — the account statement */
  transactions: Transaction[];
}

const STORAGE_KEY = "axion_account_v3";

const START_CASH = 12840.55;

const DAY = 86_400_000;
/** deterministic reference so hydration matches between server and client */
let refCounter = 0;
function makeRef(prefix = "AXN"): string {
  refCounter += 1;
  const stamp = Date.now().toString(36).toUpperCase().slice(-6);
  const n = String(refCounter).padStart(3, "0");
  return `${prefix}-${stamp}-${n}`;
}

/**
 * A believable opening statement, so the ledger reads like an account that has
 * been funded over time rather than one that sprang into existence.
 */
function seedTransactions(): Transaction[] {
  const now = Date.now();
  return [
    {
      id: "seed-2",
      kind: "withdrawal",
      status: "completed",
      method: "Visa •••• 4291",
      amount: -2000,
      fee: 0,
      reference: "AXN-SEED-002",
      at: now - 4 * DAY,
      note: "Settled back to the funding card",
    },
    {
      id: "seed-1",
      kind: "deposit",
      status: "completed",
      method: "Bank transfer · SEPA",
      amount: 27000,
      fee: 0,
      reference: "AXN-SEED-001",
      at: now - 26 * DAY,
      note: "Cleared",
    },
  ];
}

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
    withdrawn: 2000,
    realizedPl: 0,
    aiPrincipal: 0,
    positions: seedPositions(),
    transactions: seedTransactions(),
  };
}

export type TradeResult = { ok: true; msg: string } | { ok: false; msg: string };
export type CashResult =
  | { ok: true; msg: string; reference: string; status: TxStatus }
  | { ok: false; msg: string };

/** how a cash movement arrived — drives the ledger label and the fee maths */
export interface CashOptions {
  /** display label for the rail, e.g. "Visa •••• 4291" */
  method: string;
  fee?: number;
  status?: TxStatus;
  note?: string;
}

interface AccountCtx {
  account: Account;
  hydrated: boolean;
  deposit: (amount: number, opts: CashOptions) => CashResult;
  withdraw: (amount: number, opts: CashOptions) => CashResult;
  buy: (symbol: string, qty: number, price: number) => TradeResult;
  sell: (symbol: string, qty: number, price: number) => TradeResult;
  entrustToAi: (amount: number) => TradeResult;
  /** settle a finished AI session: returns principal + pnl to cash */
  aiSettle: (pnl: number, principal?: number) => void;
  qtyOwned: (symbol: string) => number;
  /** money already credited but not yet settled, and withdrawals in flight */
  pending: { incoming: number; outgoing: number };
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

  /** credit a deposit, net of fee, and write it to the statement */
  const deposit = useCallback((amount: number, opts: CashOptions): CashResult => {
    if (!(amount > 0)) return { ok: false, msg: "Enter an amount" };
    const fee = opts.fee ?? 0;
    const net = amount - fee;
    if (!(net > 0)) return { ok: false, msg: "Fee exceeds the amount" };
    const reference = makeRef();
    const status: TxStatus = opts.status ?? "completed";
    setAccount((a) => ({
      ...a,
      cash: a.cash + net,
      deposits: a.deposits + amount,
      transactions: [
        {
          id: `${reference}-in`,
          kind: "deposit",
          status,
          method: opts.method,
          amount: net,
          fee,
          reference,
          at: Date.now(),
          note: opts.note,
        },
        ...a.transactions,
      ],
    }));
    return { ok: true, msg: "Deposit credited", reference, status };
  }, []);

  /**
   * Withdrawals reserve funds immediately (they leave free cash the moment the
   * request is accepted, exactly like a real broker) and sit in the ledger as
   * `processing` until the rail settles.
   */
  const withdraw = useCallback(
    (amount: number, opts: CashOptions): CashResult => {
      if (!(amount > 0)) return { ok: false, msg: "Enter an amount" };
      const fee = opts.fee ?? 0;
      if (amount + fee > account.cash) return { ok: false, msg: "Insufficient free funds" };
      const reference = makeRef("AXW");
      const status: TxStatus = opts.status ?? "processing";
      setAccount((a) =>
        amount + fee > a.cash
          ? a
          : {
              ...a,
              cash: a.cash - amount - fee,
              withdrawn: a.withdrawn + amount,
              transactions: [
                {
                  id: `${reference}-out`,
                  kind: "withdrawal",
                  status,
                  method: opts.method,
                  amount: -amount,
                  fee,
                  reference,
                  at: Date.now(),
                  note: opts.note,
                },
                ...a.transactions,
              ],
            }
      );
      return { ok: true, msg: "Withdrawal accepted", reference, status };
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
      const reference = makeRef("AXI");
      setAccount((a) =>
        amount > a.cash
          ? a
          : {
              ...a,
              cash: a.cash - amount,
              aiPrincipal: a.aiPrincipal + amount,
              transactions: [
                {
                  id: `${reference}-alloc`,
                  kind: "ai-fund",
                  status: "completed",
                  method: "AxAI allocation",
                  amount: -amount,
                  fee: 0,
                  reference,
                  at: Date.now(),
                  note: "Reserved for autonomous trading",
                },
                ...a.transactions,
              ],
            }
      );
      return { ok: true, msg: "Funds entrusted to the AI" };
    },
    [account.cash]
  );

  const aiSettle = useCallback((pnl: number, principal?: number) => {
    const reference = makeRef("AXS");
    setAccount((a) => {
      const returned = principal ?? a.aiPrincipal;
      return {
        ...a,
        cash: a.cash + returned + pnl,
        aiPrincipal: 0,
        realizedPl: a.realizedPl + pnl,
        transactions: [
          {
            id: `${reference}-settle`,
            kind: "ai-settle",
            status: "completed",
            method: "AxAI settlement",
            amount: returned + pnl,
            fee: 0,
            reference,
            at: Date.now(),
            note: pnl >= 0 ? "Session closed in profit" : "Session closed at a loss",
          },
          ...a.transactions,
        ],
      };
    });
  }, []);

  const qtyOwned = useCallback(
    (symbol: string) => account.positions.find((p) => p.symbol === symbol)?.qty ?? 0,
    [account.positions]
  );

  const pending = useMemo(() => {
    let incoming = 0;
    let outgoing = 0;
    for (const t of account.transactions) {
      if (t.status !== "processing") continue;
      if (t.amount > 0) incoming += t.amount;
      else outgoing += Math.abs(t.amount);
    }
    return { incoming, outgoing };
  }, [account.transactions]);

  const resetAccount = useCallback(() => {
    setAccount(defaultAccount());
    try {
      window.localStorage.removeItem("axion_ai_session_v3");
      window.localStorage.removeItem("axion_ai_notifications_v1");
    } catch {
      /* noop */
    }
  }, []);

  const value = useMemo(
    () => ({ account, hydrated, deposit, withdraw, buy, sell, entrustToAi, aiSettle, qtyOwned, pending, resetAccount }),
    [account, hydrated, deposit, withdraw, buy, sell, entrustToAi, aiSettle, qtyOwned, pending, resetAccount]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function kindOf(symbol: string): Instrument["kind"] {
  return INSTRUMENTS.find((i) => i.symbol === symbol)?.kind ?? "stock";
}
