"use client";

import { ArrowDownRight, ArrowUpRight, CircleDollarSign, Lock, Wallet } from "lucide-react";

import { useAiSession } from "@/lib/ai-session";
import { formatSignedUsd, formatUsd, type PortfolioView } from "@/lib/portfolio";

export function PortfolioSummary({ view }: { view: PortfolioView }) {
  const { session } = useAiSession();
  const {
    equity,
    dayPl,
    dayPct,
    invested,
    cash,
    aiEquity,
    unrealizedPl,
    unrealizedPct,
    totalPl,
    totalPlPct,
    investedWeight,
    cashWeight,
    aiWeight,
  } = view;

  const dayUp = dayPl >= 0;
  const totalUp = unrealizedPl >= 0;

  const composition = [
    { key: "invested", label: "Instruments", value: invested, weight: investedWeight, color: "#2e90fa" },
    { key: "cash", label: "Free funds", value: cash, weight: cashWeight, color: "#868e96" },
    { key: "ai", label: "With AxAI", value: aiEquity, weight: aiWeight, color: "#00c896" },
  ].filter((c) => c.weight > 0.0005);

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface/60">
      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[12.5px] text-muted">Total equity</p>
            <p className="mt-0.5 font-mono text-[30px] leading-none font-semibold tracking-tight tabular-nums sm:text-[34px]">
              {formatUsd(equity)}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 font-mono text-[12.5px] font-semibold tabular-nums ${
                  dayUp ? "bg-gain/12 text-gain" : "bg-loss/12 text-loss"
                }`}
              >
                {dayUp ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                {formatSignedUsd(dayPl)} ({dayUp ? "+" : "−"}
                {Math.abs(dayPct).toFixed(2)}%)
              </span>
              <span className="text-[12.5px] text-muted">today</span>
              <span className="hidden h-3 w-px bg-border sm:block" />
              <span className="text-[12.5px] text-muted">
                Total P/L{" "}
                <span className={`font-mono font-semibold tabular-nums ${totalPl >= 0 ? "text-gain" : "text-loss"}`}>
                  {formatSignedUsd(totalPl)}
                  {totalPlPct !== 0 && (
                    <span className="ml-1 opacity-80">
                      ({totalPlPct >= 0 ? "+" : "−"}
                      {Math.abs(totalPlPct).toFixed(2)}%)
                    </span>
                  )}
                </span>
              </span>
            </div>
          </div>

          <div className="hidden shrink-0 text-right sm:block">
            <p className="text-[12.5px] text-muted">Unrealized P/L</p>
            <p
              className={`mt-1 font-mono text-lg font-semibold tabular-nums ${
                totalUp ? "text-gain" : "text-loss"
              }`}
            >
              {formatSignedUsd(unrealizedPl)}
            </p>
            <p className="mt-0.5 font-mono text-[12px] tabular-nums text-muted">
              {unrealizedPct >= 0 ? "+" : "−"}
              {Math.abs(unrealizedPct).toFixed(2)}% on cost
            </p>
          </div>
        </div>

        {/* key figures */}
        <div className="mt-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Stat
            icon={<Wallet className="h-3.5 w-3.5" />}
            label="Invested"
            value={formatUsd(invested)}
            hint={`${(investedWeight * 100).toFixed(1)}% of equity`}
          />
          <Stat
            icon={<CircleDollarSign className="h-3.5 w-3.5" />}
            label="Free funds"
            value={formatUsd(cash)}
            hint="available to trade"
          />
          <Stat
            icon={<Lock className="h-3.5 w-3.5" />}
            label="With AxAI"
            value={formatUsd(aiEquity)}
            hint={session?.phase === "running" ? "engine running" : "idle"}
            live={session?.phase === "running"}
          />
          <Stat
            label="Unrealized P/L"
            value={formatSignedUsd(unrealizedPl)}
            hint={`${unrealizedPct >= 0 ? "+" : "−"}${Math.abs(unrealizedPct).toFixed(2)}%`}
            tone={unrealizedPl >= 0 ? "gain" : "loss"}
          />
        </div>
      </div>

      {/* composition of total equity */}
      {composition.length > 0 && (
        <div className="border-t border-border bg-background/35 px-5 py-3.5">
          <div className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full">
            {composition.map((c) => (
              <span
                key={c.key}
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${c.weight * 100}%`, background: c.color }}
              />
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {composition.map((c) => (
              <span key={c.key} className="inline-flex items-center gap-1.5 text-[11.5px]">
                <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                <span className="text-muted">{c.label}</span>
                <span className="font-mono tabular-nums">{(c.weight * 100).toFixed(1)}%</span>
              </span>
            ))}
            <span className="ml-auto text-[11.5px] text-muted">
              Liabilities <span className="font-mono tabular-nums">$0.00</span>
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
  tone,
  live,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  tone?: "gain" | "loss";
  live?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-background/40 px-3 py-2.5">
      <p className="inline-flex items-center gap-1.5 text-[11px] text-muted">
        {icon}
        {label}
        {live && (
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute h-1.5 w-1.5 animate-ping rounded-full bg-gain opacity-70" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-gain" />
          </span>
        )}
      </p>
      <p
        className={`mt-1 font-mono text-[15px] font-semibold tabular-nums ${
          tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : ""
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 truncate text-[11px] text-muted">{hint}</p>
    </div>
  );
}
