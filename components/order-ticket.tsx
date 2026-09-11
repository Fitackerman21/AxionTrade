"use client";

import { useMemo, useState } from "react";
import confetti from "canvas-confetti";
import { ArrowDownRight, ArrowUpRight, Check } from "lucide-react";

import { InstrumentLogo } from "@/components/instrument-logo";
import { GlassButton } from "@/components/glass-button";
import { LivePrice } from "@/components/live-price";
import { useLiveQuote } from "@/components/live-prices";
import { useAccount } from "@/lib/account-store";
import { formatPrice, INSTRUMENTS } from "@/lib/market-data";

const PICKS = ["AAPL", "NVDA", "BTC", "ETH", "SPY", "XAUUSD"];
const PILLS = [25, 50, 75, 100] as const;

export function OrderTicket({
  defaultSymbol = "AAPL",
  onDone,
}: {
  defaultSymbol?: string;
  /** called after a successful fill (e.g. to close the sheet) */
  onDone?: () => void;
}) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [mode, setMode] = useState<"value" | "quantity">("value");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [value, setValue] = useState("");
  const [qty, setQty] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { account, buy, sell } = useAccount();

  const inst = useMemo(() => INSTRUMENTS.find((i) => i.symbol === symbol)!, [symbol]);
  const liveQ = useLiveQuote(symbol);
  const price = liveQ?.price ?? inst.price;
  const changePct = liveQ?.changePct ?? inst.changePct;
  const isBuy = side === "buy";
  const freeFunds = account.cash;
  const owned = account.positions.find((p) => p.symbol === symbol)?.qty ?? 0;

  const inputQty = parseFloat(qty || "0");
  const amount = mode === "value" ? parseFloat(value || "0") : inputQty * price;
  const execQty = mode === "value" ? (price > 0 ? amount / price : 0) : inputQty;
  const fee = amount * 0.0002; // 2 bps demo fee
  const total = isBuy ? amount + fee : amount - fee;

  const setPill = (pct: number) => {
    setMode("value");
    const v = (freeFunds * pct) / 100;
    setValue(v.toFixed(2));
    setQty("");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (amount <= 0 || execQty <= 0) return;
    const r = isBuy ? buy(symbol, execQty, price) : sell(symbol, execQty, price);
    if (!r.ok) {
      setErr(r.msg);
      setTimeout(() => setErr(null), 3200);
      return;
    }
    setErr(null);
    setDone(r.msg);
    confetti({
      particleCount: 90,
      spread: 70,
      origin: { y: 0.75 },
      colors: ["#00c896", "#2e90fa", "#eaecef"],
      disableForReducedMotion: true,
    });
    setTimeout(() => {
      setDone(null);
      onDone?.();
    }, 2600);
  };

  return (
    <section className="rounded-2xl border border-border bg-surface/60 p-5">
      <h2 className="text-sm font-semibold tracking-tight">Order ticket</h2>

      {/* buy/sell tabs */}
      <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl border border-border bg-background/60 p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold capitalize transition-colors ${
              side === s
                ? s === "buy"
                  ? "bg-gain/15 text-gain ring-1 ring-gain/40"
                  : "bg-loss/15 text-loss ring-1 ring-loss/40"
                : "text-muted hover:text-foreground"
            }`}
          >
            {s === "buy" ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
            {s}
          </button>
        ))}
      </div>

      {/* instrument picker */}
      <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1">
        {PICKS.map((s) => {
          const i = INSTRUMENTS.find((x) => x.symbol === s)!;
          return (
            <button
              key={s}
              onClick={() => setSymbol(s)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium transition-colors ${
                symbol === s ? "border-brand/50 bg-brand/10 text-foreground" : "border-border text-muted hover:text-foreground"
              }`}
            >
              <InstrumentLogo symbol={s} kind={i.kind} size={16} />
              {s}
            </button>
          );
        })}
      </div>

      {/* price line (live) */}
      <div className="mt-3 flex items-center justify-between rounded-xl border border-border bg-background/40 px-3 py-2.5">
        <span className="text-xs text-muted">{inst.name}</span>
        <LivePrice inst={inst} showChange className="text-sm" />
      </div>

      <form onSubmit={submit} className="mt-4 space-y-3.5">
        {/* value ⇄ quantity toggle */}
        <div className="flex items-center justify-between">
          <div className="flex rounded-lg border border-border bg-background/60 p-0.5 text-xs font-medium">
            {(["value", "quantity"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-md px-2.5 py-1 capitalize transition-colors ${
                  mode === m ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg border border-border bg-background/60 p-0.5 text-xs font-medium">
            {(["market", "limit"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setOrderType(t)}
                className={`rounded-md px-2.5 py-1 capitalize transition-colors ${
                  orderType === t ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* amount input */}
        {mode === "value" ? (
          <div className="relative">
            <span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="input-dark pl-7 font-mono"
              aria-label="Order value in USD"
            />
          </div>
        ) : (
          <input
            type="number"
            min="0"
            step="any"
            placeholder={`Quantity (${inst.kind === "crypto" ? "units" : "shares"})`}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="input-dark font-mono"
            aria-label="Order quantity"
          />
        )}

        {/* sizing pills */}
        <div className="grid grid-cols-4 gap-1.5">
          {PILLS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPill(p)}
              className="rounded-lg border border-border py-1.5 text-xs font-medium text-muted transition-colors hover:border-brand/50 hover:text-foreground"
            >
              {p}%
            </button>
          ))}
        </div>

        {/* estimates */}
        <div className="space-y-1.5 rounded-xl border border-border bg-background/40 px-3 py-2.5 text-xs">
          <div className="flex justify-between">
            <span className="text-muted">Estimated {isBuy ? "cost" : "proceeds"}</span>
            <span className="font-mono tabular-nums">${(amount || 0).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Fee (2 bps)</span>
            <span className="font-mono tabular-nums">${fee.toFixed(2)}</span>
          </div>
          <div className="flex justify-between border-t border-border/60 pt-1.5 font-medium">
            <span>{isBuy ? "Total" : "You receive"}</span>
            <span className="font-mono tabular-nums">${(total || 0).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-muted">
            <span>{isBuy ? "Free funds after" : "You own"}</span>
            <span className="font-mono tabular-nums">
              {isBuy
                ? `$${Math.max(freeFunds - total, 0).toFixed(2)}`
                : `${owned} ${inst.kind === "crypto" ? "units" : "shares"}`}
            </span>
          </div>
        </div>

        {err && (
          <p className="rounded-lg border border-loss/30 bg-loss/10 px-3 py-2 text-center text-[13px] text-loss">{err}</p>
        )}

        <GlassButton type="submit" disabled={amount <= 0}>
          {done ? (
            <span className="flex items-center gap-1.5">
              <Check className="h-4 w-4" /> {done}
            </span>
          ) : (
            <span className="capitalize">
              {side} {symbol}
            </span>
          )}
        </GlassButton>
      </form>
    </section>
  );
}
