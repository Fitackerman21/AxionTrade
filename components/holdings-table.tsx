"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

import { InstrumentLogo } from "@/components/instrument-logo";
import { Sparkline } from "@/components/sparkline";
import {
  formatPct,
  formatPrice,
  INSTRUMENTS,
  seededSeries,
  type Instrument,
} from "@/lib/market-data";

type SortKey = "value" | "changePct" | "symbol" | "price";
type SortDir = "asc" | "desc";

interface HoldingRow {
  inst: Instrument;
  qty: number;
  avgCost: number;
  value: number;
  pl: number;
  plPct: number;
}

/** Demo portfolio: deterministic per-symbol position sizes */
function buildHoldings(): HoldingRow[] {
  return INSTRUMENTS.filter((i) => i.kind !== "forex").map((inst, idx) => {
    const qty = Number(((((idx * 37) % 19) + 3) * (inst.price > 500 ? 0.6 : 4)).toFixed(2));
    const drift = 1 + (((idx * 53) % 21) - 10) / 100;
    const avgCost = inst.price / drift;
    const value = qty * inst.price;
    const pl = value - qty * avgCost;
    return { inst, qty, avgCost, value, pl, plPct: (pl / (qty * avgCost)) * 100 };
  });
}

const COLS: { key: SortKey | null; label: string; right?: boolean }[] = [
  { key: "symbol", label: "Instrument" },
  { key: "price", label: "Price", right: true },
  { key: "changePct", label: "24h", right: true },
  { key: "value", label: "Holdings", right: true },
  { key: null, label: "P/L", right: true },
  { key: null, label: "" }, // sparkline
];

export function HoldingsTable() {
  const rows = useMemo(buildHoldings, []);
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => {
      const va = a[sortKey as keyof HoldingRow] as number | string;
      const vb = b[sortKey as keyof HoldingRow] as number | string;
      const cmp =
        typeof va === "string" ? String(va).localeCompare(String(vb)) : (va as number) - (vb as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [rows, sortKey, sortDir]);

  const toggle = (key: SortKey | null) => {
    if (!key) return;
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "symbol" ? "asc" : "desc");
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface/60">
      <div className="flex items-center justify-between px-5 py-4">
        <h2 className="text-sm font-semibold tracking-tight">Holdings</h2>
        <span className="text-xs text-muted">{rows.length} instruments</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-y border-border bg-background/40 text-xs text-muted">
              {COLS.map((c, i) => (
                <th
                  key={i}
                  onClick={() => toggle(c.key)}
                  className={`px-4 py-2.5 font-medium ${c.right ? "text-right" : "text-left"} ${
                    c.key ? "cursor-pointer select-none hover:text-foreground" : ""
                  }`}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {sortKey === c.key &&
                      (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const up = r.inst.changePct >= 0;
              const plUp = r.pl >= 0;
              return (
                <tr key={r.inst.symbol} className="group border-b border-border/50 transition-colors last:border-0 hover:bg-surface-2/60">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <InstrumentLogo symbol={r.inst.symbol} kind={r.inst.kind} size={30} />
                      <div>
                        <p className="font-semibold leading-tight">{r.inst.symbol}</p>
                        <p className="max-w-[180px] truncate text-xs text-muted">{r.inst.name}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {formatPrice(r.inst.price, r.inst.kind)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`rounded-md px-1.5 py-0.5 font-mono text-xs tabular-nums ${
                        up ? "bg-gain/10 text-gain" : "bg-loss/10 text-loss"
                      }`}
                    >
                      {formatPct(r.inst.changePct)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    ${r.value.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                    <span className="block text-xs text-muted">{r.qty} units</span>
                  </td>
                  <td className={`px-4 py-3 text-right font-mono text-[13px] tabular-nums ${plUp ? "text-gain" : "text-loss"}`}>
                    {plUp ? "+" : "−"}${Math.abs(r.pl).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                    <span className="block text-xs opacity-75">
                      {plUp ? "+" : "−"}
                      {Math.abs(r.plPct).toFixed(2)}%
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Sparkline
                      data={seededSeries(r.inst.symbol, 40, r.inst.vol ?? 0.012).map((v) => v * r.inst.price)}
                      width={88}
                      height={30}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
