"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bitcoin,
  Check,
  Clock,
  Copy,
  CreditCard,
  Landmark,
  Lock,
  LoaderCircle,
  Receipt,
  ShieldCheck,
  Smartphone,
} from "lucide-react";

import { useAccount, type Transaction, type TxStatus } from "@/lib/account-store";

/* ------------------------------------------------------------------ */
/* rails                                                               */
/* ------------------------------------------------------------------ */

type IconType = React.ComponentType<{ className?: string }>;

interface Rail {
  id: string;
  label: string;
  detail: string;
  icon: IconType;
  /** card rails charge a percentage; crypto charges a flat network fee */
  feePct: number;
  feeFlat: number;
  /** what the money is seen to move through */
  instrument: string;
  eta: string;
  /** asynchronous rails land as `processing` rather than instantly */
  async: boolean;
  min: number;
  max: number;
}

const RAILS: Rail[] = [
  {
    id: "card",
    label: "Debit card",
    detail: "Instant · no card details stored",
    icon: CreditCard,
    feePct: 0.012,
    feeFlat: 0,
    instrument: "Card •••• 4291",
    eta: "Instant",
    async: false,
    min: 10,
    max: 25_000,
  },
  {
    id: "wallet",
    label: "Mobile wallet",
    detail: "One-tap · instant",
    icon: Smartphone,
    feePct: 0.012,
    feeFlat: 0,
    instrument: "Wallet · Fitackerman21",
    eta: "Instant",
    async: false,
    min: 10,
    max: 10_000,
  },
  {
    id: "bank",
    label: "Bank transfer",
    detail: "No fee · your bank may charge",
    icon: Landmark,
    feePct: 0,
    feeFlat: 0,
    instrument: "Bank •••• 8842",
    eta: "1–2 business days",
    async: true,
    min: 50,
    max: 100_000,
  },
  {
    id: "crypto",
    label: "Crypto",
    detail: "USDT (TRC-20) · BTC",
    icon: Bitcoin,
    feePct: 0,
    feeFlat: 0.8,
    instrument: "USDT · TRC-20",
    eta: "~10 min after 3 confirmations",
    async: true,
    min: 20,
    max: 50_000,
  },
];

const railById = (id: string) => RAILS.find((r) => r.id === id) ?? RAILS[0];

/** the paced log a real payment flow walks through before it settles */
const STAGES: Record<string, { deposit: string[]; withdraw: string[] }> = {
  card: {
    deposit: [
      "Opening a secure payment session…",
      "Contacting your issuer…",
      "3-D Secure verification…",
      "Authorising the charge…",
      "Crediting your account…",
    ],
    withdraw: ["Verifying your account status…", "Reserving the funds…", "Submitting to your issuer…"],
  },
  wallet: {
    deposit: [
      "Opening a secure payment session…",
      "Handing off to your wallet…",
      "Authorising the charge…",
      "Crediting your account…",
    ],
    withdraw: ["Verifying your account status…", "Reserving the funds…", "Submitting to your wallet…"],
  },
  bank: {
    deposit: [
      "Opening a payment instruction…",
      "Awaiting your bank's acknowledgement…",
      "Matching the transfer to your account…",
      "Provisionally crediting your account…",
    ],
    withdraw: [
      "Verifying your account status…",
      "Reserving the funds…",
      "Queued with our banking partner…",
    ],
  },
  crypto: {
    deposit: [
      "Deriving your deposit address…",
      "Awaiting network confirmations (1/3)…",
      "Confirmations (2/3)…",
      "Confirmations (3/3)…",
      "Crediting your account…",
    ],
    withdraw: ["Verifying your account status…", "Reserving the funds…", "Broadcasting the transaction…"],
  },
};

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const usd = (v: number, frac = 2) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: frac, maximumFractionDigits: frac })}`;

const feeFor = (rail: Rail, amount: number) => {
  if (!(amount > 0)) return 0;
  const raw = amount * rail.feePct + rail.feeFlat;
  return raw > 0 ? Math.max(0.5, Math.round(raw * 100) / 100) : 0;
};

const stamp = (t: number) =>
  new Date(t).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export const TX_STATUS_META: Record<TxStatus, { label: string; className: string }> = {
  completed: { label: "Completed", className: "border-gain/35 bg-gain/10 text-gain" },
  processing: { label: "Processing", className: "border-[#ffb020]/35 bg-[#ffb020]/10 text-[#ffb020]" },
  declined: { label: "Declined", className: "border-loss/35 bg-loss/10 text-loss" },
};

const TX_KIND_LABEL: Record<Transaction["kind"], string> = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  "ai-fund": "AxAI allocation",
  "ai-settle": "AxAI settlement",
};

/* ------------------------------------------------------------------ */
/* the sheet                                                           */
/* ------------------------------------------------------------------ */

type Phase = "form" | "processing" | "done";

export function CashFlowSheet({
  open,
  mode,
  onModeChange,
  onClose,
}: {
  open: boolean;
  mode: "deposit" | "withdraw";
  onModeChange: (m: "deposit" | "withdraw") => void;
  onClose: () => void;
}) {
  const { account, deposit, withdraw, pending } = useAccount();
  const [railId, setRailId] = useState("card");
  const [amountRaw, setAmountRaw] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{
    reference: string;
    status: TxStatus;
    amount: number;
    fee: number;
    net: number;
    rail: Rail;
    at: number;
  } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const rail = railById(railId);
  const amount = useMemo(() => {
    const n = Number(amountRaw.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }, [amountRaw]);
  const fee = feeFor(rail, amount);
  const stages = STAGES[rail.id][mode];

  const available = Math.max(0, account.cash);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  // reset whenever the sheet is reopened or the direction flips
  useEffect(() => {
    if (!open) {
      clearTimers();
      setPhase("form");
      setStage(0);
      setReceipt(null);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    clearTimers();
    setPhase("form");
    setStage(0);
    setReceipt(null);
    setError(null);
  }, [mode]);

  useEffect(() => () => clearTimers(), []);

  const start = () => {
    setError(null);
    if (!(amount > 0)) return setError("Enter an amount");
    if (amount < rail.min) return setError(`Minimum ${mode} on this rail is ${usd(rail.min, 0)}`);
    if (amount > rail.max) return setError(`Maximum ${mode} on this rail is ${usd(rail.max, 0)}`);
    if (mode === "withdraw" && amount + fee > available)
      return setError(`You can withdraw up to ${usd(Math.max(0, available - fee))} after fees`);

    setPhase("processing");
    setStage(0);

    // walk the stages, then commit the movement to the ledger
    stages.forEach((_, i) => {
      timers.current.push(setTimeout(() => setStage(i), i * 620));
    });
    timers.current.push(
      setTimeout(
        () => {
          const note =
            mode === "withdraw"
              ? rail.async
                ? `Funds reserved — arrives in ${rail.eta.toLowerCase()}`
                : "Settled back to the funding rail"
              : rail.async
                ? `Provisionally credited — clears in ${rail.eta.toLowerCase()}`
                : "Cleared";

          const res =
            mode === "deposit"
              ? deposit(amount, {
                  method: `${rail.label} · ${rail.instrument}`,
                  fee,
                  status: rail.async ? "processing" : "completed",
                  note,
                })
              : withdraw(amount, {
                  method: `${rail.label} · ${rail.instrument}`,
                  fee,
                  status: rail.async ? "processing" : "completed",
                  note,
                });

          if (!res.ok) {
            setError(res.msg);
            setPhase("form");
            return;
          }
          setReceipt({
            reference: res.reference,
            status: res.status,
            amount,
            fee,
            net: amount - fee,
            rail,
            at: Date.now(),
          });
          setPhase("done");
        },
        stages.length * 620 + 420
      )
    );
  };

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center"
          role="dialog"
          aria-modal="true"
          aria-label={mode === "deposit" ? "Deposit funds" : "Withdraw funds"}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.99 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border-t border-border bg-surface shadow-[0_-20px_60px_rgba(0,0,0,0.65)] sm:max-w-md sm:rounded-3xl sm:border"
          >
            {/* grip + header */}
            <div className="flex justify-center pt-2.5 sm:hidden">
              <span className="h-1.5 w-10 rounded-full bg-border" />
            </div>

            <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
              <div>
                <h2 className="text-base font-semibold tracking-tight">
                  {phase === "done" ? "Transfer receipt" : mode === "deposit" ? "Add funds" : "Withdraw funds"}
                </h2>
                <p className="mt-0.5 text-[12px] text-muted">
                  {phase === "done"
                    ? "Keep the reference for your records"
                    : phase === "processing"
                      ? "Don't close this window"
                      : `Free funds ${usd(available)}${pending.outgoing > 0 ? ` · ${usd(pending.outgoing)} pending` : ""}`}
                </p>
              </div>
              {phase === "form" && (
                <button
                  onClick={onClose}
                  className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl border border-border text-muted transition-colors hover:text-foreground"
                  aria-label="Close"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-5">
              {phase === "form" && (
                <>
                  {/* direction toggle */}
                  <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-background/60 p-1">
                    {(["deposit", "withdraw"] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => onModeChange(m)}
                        className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-[13px] font-semibold capitalize transition-colors ${
                          mode === m ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"
                        }`}
                      >
                        {m === "deposit" ? (
                          <ArrowDownLeft className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        )}
                        {m}
                      </button>
                    ))}
                  </div>

                  {/* amount */}
                  <div className="mt-4">
                    <label className="text-[11px] font-semibold tracking-wide text-muted uppercase">
                      Amount
                    </label>
                    <div className="mt-1.5 flex items-center gap-2 rounded-2xl border border-border bg-background/60 px-4 py-3 focus-within:border-brand/50">
                      <span className="font-mono text-lg text-muted">$</span>
                      <input
                        inputMode="decimal"
                        value={amountRaw}
                        onChange={(e) => setAmountRaw(e.target.value)}
                        placeholder="0.00"
                        aria-label="Amount in US dollars"
                        className="min-w-0 flex-1 bg-transparent font-mono text-2xl font-semibold tabular-nums outline-none placeholder:text-muted/40"
                      />
                      <span className="text-[11px] font-semibold text-muted">USD</span>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(mode === "deposit" ? [100, 250, 500, 1000, 5000] : []).map((v) => (
                        <button
                          key={v}
                          onClick={() => setAmountRaw(String(v))}
                          className="rounded-lg border border-border px-2.5 py-1 font-mono text-[11px] tabular-nums text-muted transition-colors hover:border-brand/40 hover:text-foreground"
                        >
                          {usd(v, 0)}
                        </button>
                      ))}
                      {mode === "withdraw" &&
                        ([25, 50, 75, 100] as const).map((pct) => (
                          <button
                            key={pct}
                            onClick={() =>
                              setAmountRaw(
                                (pct === 100 ? Math.max(0, available - fee) : (available * pct) / 100).toFixed(2)
                              )
                            }
                            className="rounded-lg border border-border px-2.5 py-1 font-mono text-[11px] tabular-nums text-muted transition-colors hover:border-brand/40 hover:text-foreground"
                          >
                            {pct === 100 ? "Max" : `${pct}%`}
                          </button>
                        ))}
                    </div>
                  </div>

                  {/* rail picker */}
                  <div className="mt-4">
                    <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">
                      {mode === "deposit" ? "Pay with" : "Withdraw to"}
                    </p>
                    <div className="mt-1.5 space-y-1.5">
                      {RAILS.map((r) => {
                        const active = r.id === railId;
                        const railFee = feeFor(r, amount);
                        return (
                          <button
                            key={r.id}
                            onClick={() => setRailId(r.id)}
                            className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors ${
                              active ? "border-brand/45 bg-brand/8" : "border-border hover:bg-surface-2"
                            }`}
                          >
                            <span
                              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
                                active ? "border-brand/40 bg-brand/12 text-brand" : "border-border text-muted"
                              }`}
                            >
                              <r.icon className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-semibold">
                                {r.label}
                              </span>
                              <span className="block truncate text-[11.5px] text-muted">
                                {r.instrument} · {r.eta}
                              </span>
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="block font-mono text-[11.5px] tabular-nums text-muted">
                                {railFee > 0 ? `fee ${usd(railFee)}` : "no fee"}
                              </span>
                            </span>
                            {active && <Check className="h-4 w-4 shrink-0 text-brand" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* summary */}
                  <dl className="mt-4 space-y-1.5 rounded-2xl border border-border bg-background/40 p-3.5 text-[12.5px]">
                    <div className="flex justify-between">
                      <dt className="text-muted">{mode === "deposit" ? "Deposit amount" : "Withdrawal"}</dt>
                      <dd className="font-mono tabular-nums">{usd(amount)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted">{rail.feePct > 0 ? `${rail.label} fee` : "Fee"}</dt>
                      <dd className="font-mono tabular-nums text-muted">{fee > 0 ? usd(fee) : "Free"}</dd>
                    </div>
                    <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
                      <dt>{mode === "deposit" ? "Credited to your balance" : "Leaves your balance"}</dt>
                      <dd className="font-mono tabular-nums">
                        {usd(mode === "deposit" ? Math.max(0, amount - fee) : amount + fee)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted">Arrives</dt>
                      <dd className="text-muted">{rail.eta}</dd>
                    </div>
                  </dl>

                  {error && (
                    <p className="mt-3 rounded-xl border border-loss/35 bg-loss/10 px-3 py-2 text-[12.5px] text-loss">
                      {error}
                    </p>
                  )}

                  <button
                    onClick={start}
                    className="mt-4 w-full rounded-2xl bg-gradient-to-r from-brand to-gain py-3.5 text-sm font-bold text-[#071018] transition-transform active:scale-[0.99]"
                  >
                    {mode === "deposit" ? `Deposit ${amount > 0 ? usd(amount) : ""}` : `Withdraw ${amount > 0 ? usd(amount) : ""}`}
                  </button>

                  <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-muted">
                    <Lock className="h-3 w-3" />
                    Encrypted end to end · no card details are stored
                  </p>
                </>
              )}

              {phase === "processing" && (
                <div className="py-2">
                  <div className="flex items-center gap-3 rounded-2xl border border-border bg-background/40 p-4">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-brand/40 bg-brand/12">
                      <LoaderCircle className="h-5 w-5 animate-spin text-brand" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {mode === "deposit" ? "Processing deposit" : "Processing withdrawal"}
                      </p>
                      <p className="font-mono text-xs tabular-nums text-muted">
                        {usd(amount)} · {rail.instrument}
                      </p>
                    </div>
                  </div>

                  <ol className="mt-4 space-y-0">
                    {stages.map((s, i) => {
                      const done = i < stage;
                      const active = i === stage;
                      return (
                        <li key={s} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <span
                              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                                done
                                  ? "border-gain/50 bg-gain/15 text-gain"
                                  : active
                                    ? "border-brand/50 bg-brand/15 text-brand"
                                    : "border-border text-muted/50"
                              }`}
                            >
                              {done ? (
                                <Check className="h-3 w-3" />
                              ) : active ? (
                                <LoaderCircle className="h-3 w-3 animate-spin" />
                              ) : (
                                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                              )}
                            </span>
                            {i < stages.length - 1 && (
                              <span
                                className={`my-0.5 w-px flex-1 ${done ? "bg-gain/40" : "bg-border"}`}
                                style={{ minHeight: 14 }}
                              />
                            )}
                          </div>
                          <p
                            className={`pb-3 text-[12.5px] leading-5 ${
                              done ? "text-muted" : active ? "font-medium text-foreground" : "text-muted/60"
                            }`}
                          >
                            {s}
                          </p>
                        </li>
                      );
                    })}
                  </ol>

                  <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
                    <ShieldCheck className="h-3 w-3" />
                    Your funds move through a segregated client money account.
                  </p>
                </div>
              )}

              {phase === "done" && receipt && (
                <div>
                  <div className="flex flex-col items-center rounded-2xl border border-gain/30 bg-gain/8 px-4 py-5 text-center">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full border border-gain/50 bg-gain/15">
                      <Check className="h-6 w-6 text-gain" />
                    </span>
                    <p className="mt-2.5 text-base font-semibold">
                      {receipt.status === "processing" ? "Accepted — pending settlement" : "Money received"}
                    </p>
                    <p className="mt-0.5 font-mono text-xl font-semibold tabular-nums">
                      {receipt.status === "processing" ? usd(receipt.amount) : usd(receipt.net)}
                    </p>
                    <p className="mt-0.5 text-[12px] text-muted">
                      {receipt.rail.label} · {receipt.rail.instrument}
                    </p>
                  </div>

                  <dl className="mt-3 space-y-1.5 rounded-2xl border border-border bg-background/40 p-3.5 text-[12.5px]">
                    <Row label="Reference" value={receipt.reference} mono />
                    <Row label="Requested" value={usd(receipt.amount)} mono />
                    <Row label="Fee" value={receipt.fee > 0 ? usd(receipt.fee) : "Free"} mono />
                    <Row label="Status" value={TX_STATUS_META[receipt.status].label} />
                    <Row label="Submitted" value={stamp(receipt.at)} />
                    <Row label="Arrives" value={receipt.rail.eta} />
                    <div className="flex justify-between border-t border-border pt-1.5">
                      <dt className="text-muted">New free funds</dt>
                      <dd className="font-mono font-semibold tabular-nums">{usd(account.cash)}</dd>
                    </div>
                  </dl>

                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => {
                        navigator.clipboard?.writeText(receipt.reference).catch(() => {});
                      }}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border py-2.5 text-[13px] font-semibold text-muted transition-colors hover:text-foreground"
                    >
                      <Copy className="h-3.5 w-3.5" /> Copy reference
                    </button>
                    <button
                      onClick={onClose}
                      className="flex-1 rounded-xl bg-gradient-to-r from-brand to-gain py-2.5 text-[13px] font-bold text-[#071018]"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className={`truncate ${mono ? "font-mono tabular-nums" : ""}`}>{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* statement                                                           */
/* ------------------------------------------------------------------ */

export function TransactionsLedger({
  limit,
  emptyHint = "No cash movements yet.",
  filter,
}: {
  limit?: number;
  emptyHint?: string;
  /** narrow to one or more kinds, e.g. ["deposit", "withdrawal"] */
  filter?: Transaction["kind"][];
}) {
  const { account } = useAccount();
  const rows = useMemo(() => {
    const list = filter ? account.transactions.filter((t) => filter.includes(t.kind)) : account.transactions;
    return limit ? list.slice(0, limit) : list;
  }, [account.transactions, filter, limit]);

  if (rows.length === 0) {
    return <p className="px-1 py-6 text-center text-[13px] text-muted">{emptyHint}</p>;
  }

  return (
    <ul className="divide-y divide-border/50">
      {rows.map((t) => {
        const meta = TX_STATUS_META[t.status];
        const incoming = t.amount >= 0;
        const Icon = t.kind === "deposit" ? ArrowDownLeft : t.kind === "withdrawal" ? ArrowUpRight : Receipt;
        return (
          <li key={t.id} className="flex items-start gap-3 py-3">
            <span
              className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${
                incoming ? "border-gain/35 bg-gain/10 text-gain" : "border-border bg-background/40 text-muted"
              }`}
            >
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-[13px] font-semibold">{TX_KIND_LABEL[t.kind]}</p>
                <p
                  className={`shrink-0 font-mono text-[13px] font-semibold tabular-nums ${
                    incoming ? "text-gain" : "text-foreground"
                  }`}
                >
                  {incoming ? "+" : "−"}
                  {usd(Math.abs(t.amount))}
                </p>
              </div>
              <p className="truncate text-[11.5px] text-muted">{t.method}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono text-[10.5px] text-muted/70">{t.reference}</span>
                <span className="text-[10.5px] text-muted/70">·</span>
                <span className="text-[10.5px] text-muted/70">{stamp(t.at)}</span>
                <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${meta.className}`}>
                  {t.status === "processing" ? <Clock className="mr-0.5 inline h-2.5 w-2.5" /> : null}
                  {meta.label}
                </span>
                {t.fee > 0 && (
                  <span className="font-mono text-[10.5px] text-muted/70">fee {usd(t.fee)}</span>
                )}
              </div>
              {t.note && <p className="mt-0.5 text-[11.5px] text-muted/80">{t.note}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Compact "money in flight" strip for the account header. */
export function PendingStrip() {
  const { pending } = useAccount();
  if (pending.incoming === 0 && pending.outgoing === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 rounded-xl border border-[#ffb020]/30 bg-[#ffb020]/8 px-3 py-2 text-[12px]">
      <span className="inline-flex items-center gap-1.5 text-[#ffb020]">
        <Clock className="h-3.5 w-3.5" /> In flight
      </span>
      {pending.incoming > 0 && (
        <span className="text-muted">
          Incoming <span className="font-mono tabular-nums text-foreground">{usd(pending.incoming)}</span>
        </span>
      )}
      {pending.outgoing > 0 && (
        <span className="text-muted">
          Outgoing <span className="font-mono tabular-nums text-foreground">{usd(pending.outgoing)}</span>
        </span>
      )}
    </div>
  );
}
