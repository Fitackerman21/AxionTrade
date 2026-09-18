"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search, X } from "lucide-react";

import { InstrumentLogo } from "@/components/instrument-logo";
import { useLivePrices } from "@/components/live-prices";
import { formatPrice, INSTRUMENTS, type Instrument } from "@/lib/market-data";

const GROUP_ORDER: Instrument["kind"][] = ["stock", "etf", "crypto", "forex", "commodity"];

const GROUP_LABEL: Record<Instrument["kind"], string> = {
  stock: "Stocks",
  etf: "ETFs",
  crypto: "Crypto",
  forex: "Forex",
  commodity: "Commodities",
  index: "Indices",
};

/**
 * Market search — a sheet on mobile, a centred palette on desktop. Filters by
 * symbol, name and asset class, and marks prices with live quotes so the list
 * breathes while it is open.
 */
export function InstrumentPicker({
  current,
  onSelect,
  onClose,
}: {
  current?: string;
  onSelect: (inst: Instrument) => void;
  onClose: () => void;
}) {
  const { quotes } = useLivePrices();
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? INSTRUMENTS.filter(
          (i) =>
            i.symbol.toLowerCase().includes(q) ||
            i.name.toLowerCase().includes(q) ||
            GROUP_LABEL[i.kind].toLowerCase().includes(q)
        )
      : INSTRUMENTS;

    return GROUP_ORDER.map((kind) => ({
      kind,
      list: matches.filter((i) => i.kind === kind),
    })).filter((g) => g.list.length > 0);
  }, [query]);

  const total = groups.reduce((n, g) => n + g.list.length, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-start sm:justify-center sm:pt-20"
      role="dialog"
      aria-modal="true"
      aria-label="Search markets"
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex max-h-[80dvh] w-full flex-col overflow-hidden rounded-t-3xl border-t border-border bg-surface shadow-2xl sm:max-w-lg sm:rounded-2xl sm:border"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search symbol, name or asset class…"
            aria-label="Search markets"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/60"
          />
          <button
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {total === 0 && (
            <p className="px-3 py-8 text-center text-[13px] text-muted">
              Nothing matches “{query}”.
            </p>
          )}

          {groups.map(({ kind, list }) => (
            <div key={kind} className="mb-1">
              <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
                {GROUP_LABEL[kind]}
              </p>
              {list.map((inst) => {
                const q = quotes.get(inst.symbol);
                const price = q?.price ?? inst.price;
                const changePct = q?.changePct ?? inst.changePct;
                const up = changePct >= 0;
                const active = inst.symbol === current;
                return (
                  <button
                    key={inst.symbol}
                    onClick={() => {
                      onSelect(inst);
                      onClose();
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                      active ? "bg-brand/10" : "hover:bg-surface-2"
                    }`}
                  >
                    <InstrumentLogo symbol={inst.symbol} kind={inst.kind} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">{inst.symbol}</span>
                      <span className="block truncate text-xs text-muted">{inst.name}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-mono text-[12.5px] tabular-nums">
                        {formatPrice(price, inst.kind)}
                      </span>
                      <span
                        className={`block font-mono text-[11px] tabular-nums ${
                          up ? "text-gain" : "text-loss"
                        }`}
                      >
                        {up ? "+" : ""}
                        {changePct.toFixed(2)}%
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="border-t border-border px-4 py-2 text-[11px] text-muted">
          {total} instrument{total === 1 ? "" : "s"} · prices update live
        </div>
      </motion.div>
    </div>
  );
}
