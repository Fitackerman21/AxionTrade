"use client";

import { useState } from "react";
import { PieChart } from "lucide-react";

import { formatUsd, type AllocationSlice, type PortfolioView } from "@/lib/portfolio";

const SIZE = 152;
const R = 60;
const STROKE = 16;
const C = 2 * Math.PI * R;
const CENTER = SIZE / 2;

/**
 * Asset-class allocation. The arc geometry is plain stroke-dasharray rather
 * than a path per slice, so a slice's size animates on its own when its value
 * changes — which matters here, because every slice is marked live.
 */
export function AllocationDonut({ view }: { view: PortfolioView }) {
  const { allocation, invested, count } = view;
  const [active, setActive] = useState<number | null>(null);

  const shown: AllocationSlice | null = active != null ? (allocation[active] ?? null) : null;

  return (
    <section className="rounded-2xl border border-border bg-surface/60 p-5">
      <div className="flex items-center gap-2">
        <PieChart className="h-4 w-4 text-muted" />
        <h2 className="text-sm font-semibold tracking-tight">Allocation</h2>
        <span className="ml-auto text-[11.5px] text-muted">
          {count} {count === 1 ? "instrument" : "instruments"}
        </span>
      </div>

      {allocation.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-muted">
          Nothing allocated yet — your holdings breakdown appears here once you own something.
        </p>
      ) : (
        <div className="mt-4 flex flex-col items-center gap-5 sm:flex-row sm:items-center lg:flex-col">
          <div className="relative shrink-0">
            <svg
              width={SIZE}
              height={SIZE}
              viewBox={`0 0 ${SIZE} ${SIZE}`}
              role="img"
              aria-label="Allocation by asset class"
            >
              <circle cx={CENTER} cy={CENTER} r={R} fill="none" stroke="var(--border)" strokeWidth={STROKE} />
              {(() => {
                let offset = 0;
                return allocation.map((s, i) => {
                  const len = Math.max(0, s.weight * C);
                  const el = (
                    <circle
                      key={s.kind}
                      cx={CENTER}
                      cy={CENTER}
                      r={R}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={active === i ? STROKE + 4 : STROKE}
                      strokeDasharray={`${len} ${Math.max(0, C - len)}`}
                      strokeDashoffset={-offset}
                      strokeLinecap="butt"
                      transform={`rotate(-90 ${CENTER} ${CENTER})`}
                      opacity={active == null || active === i ? 1 : 0.32}
                      className="cursor-pointer transition-[stroke-dasharray,stroke-dashoffset,opacity,stroke-width] duration-500"
                      onMouseEnter={() => setActive(i)}
                      onMouseLeave={() => setActive(null)}
                    />
                  );
                  offset += len;
                  return el;
                });
              })()}
            </svg>

            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <p className="text-[10.5px] tracking-wide text-muted uppercase">
                {shown ? shown.label : "Invested"}
              </p>
              <p className="mt-0.5 font-mono text-[15px] font-semibold tabular-nums">
                {formatUsd(shown ? shown.value : invested, 0)}
              </p>
              <p className="mt-0.5 text-[11px] text-muted">
                {shown ? `${(shown.weight * 100).toFixed(1)}% · ${shown.count}` : "market value"}
              </p>
            </div>
          </div>

          <ul className="w-full space-y-2">
            {allocation.map((s, i) => (
              <li
                key={s.kind}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                className={`rounded-xl px-2 py-1.5 transition-colors ${
                  active === i ? "bg-surface-2" : ""
                }`}
              >
                <div className="flex items-center gap-2 text-[12.5px]">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="font-medium">{s.label}</span>
                  <span className="ml-auto font-mono tabular-nums text-muted">
                    {(s.weight * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-border">
                    <span
                      className="block h-full rounded-full transition-[width] duration-500"
                      style={{ width: `${Math.max(2, s.weight * 100)}%`, background: s.color }}
                    />
                  </span>
                  <span className="w-[74px] shrink-0 text-right font-mono text-[11.5px] tabular-nums text-muted">
                    {formatUsd(s.value, 0)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
