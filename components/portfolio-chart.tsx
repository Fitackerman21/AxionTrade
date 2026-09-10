"use client";

import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { seededSeries } from "@/lib/market-data";

const TIMEFRAMES = ["1D", "1W", "1M", "1Y", "All"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

const TF_CONFIG: Record<Timeframe, { points: number; vol: number; label: string }> = {
  "1D": { points: 96, vol: 0.0035, label: "Today" },
  "1W": { points: 112, vol: 0.008, label: "Past week" },
  "1M": { points: 90, vol: 0.014, label: "Past month" },
  "1Y": { points: 120, vol: 0.03, label: "Past year" },
  All: { points: 140, vol: 0.05, label: "All time" },
};

const W = 820;
const H = 260;
const PAD = { l: 10, r: 64, t: 14, b: 8 };

export function PortfolioChart({ totalValue }: { totalValue: number }) {
  const [tf, setTf] = useState<Timeframe>("1M");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const { points, vol } = TF_CONFIG[tf];

  const series = useMemo(
    () => seededSeries(`portfolio-${tf}`, points, vol).map((v) => v * totalValue),
    [tf, points, vol, totalValue]
  );

  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;

  const x = (i: number) => PAD.l + (i / (points - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - min) / range) * (H - PAD.t - PAD.b);

  const ticks = 5;
  const tickVals = Array.from({ length: ticks }, (_, i) => min + (range * i) / (ticks - 1));

  const line = series.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" L");
  const area = `M${line} L${x(points - 1).toFixed(2)},${H - PAD.b} L${x(0).toFixed(2)},${H - PAD.b} Z`;

  const change = series[points - 1] - series[0];
  const changePct = (change / series[0]) * 100;
  const up = change >= 0;
  const color = up ? "#00c896" : "#f6465d";

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(rel * (points - 1));
    setHoverIdx(Math.max(0, Math.min(points - 1, idx)));
  };

  const fmt = (v: number) =>
    `$${v.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

  return (
    <section className="rounded-2xl border border-border bg-surface/60 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[13px] text-muted">Portfolio value · {TF_CONFIG[tf].label}</p>
          <div className="mt-1 flex items-baseline gap-2.5">
            <span className="text-2xl font-semibold tracking-tight">
              {fmt(hoverIdx != null ? series[hoverIdx] : series[points - 1])}
            </span>
            <span
              className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-mono text-xs font-medium ${
                up ? "bg-gain/10 text-gain" : "bg-loss/10 text-loss"
              }`}
            >
              {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {up ? "+" : ""}
              {changePct.toFixed(2)}%
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {up ? "+" : ""}
            {fmt(change)} all-time
          </p>
        </div>

        <div className="flex rounded-lg border border-border bg-background/60 p-0.5">
          {TIMEFRAMES.map((t) => (
            <button
              key={t}
              onClick={() => {
                setTf(t);
                setHoverIdx(null);
              }}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                tf === t ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="relative mt-4">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Portfolio value chart">
          <defs>
            <linearGradient id="pv-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* gridlines + Y-axis labels (right) */}
          {tickVals.map((tv, i) => (
            <g key={i}>
              <line
                x1={PAD.l}
                x2={W - PAD.r}
                y1={y(tv)}
                y2={y(tv)}
                stroke="#868e96"
                strokeOpacity="0.14"
                strokeDasharray="4 5"
              />
              <text
                x={W - PAD.r + 10}
                y={y(tv) + 4}
                fill="#868e96"
                fontSize="11"
                fontFamily="var(--font-geist-mono), monospace"
              >
                {fmt(tv)}
              </text>
            </g>
          ))}

          <path d={area} fill="url(#pv-fill)" />
          <path d={`M${line}`} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />

          {/* hover crosshair */}
          {hoverIdx != null && (
            <g>
              <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={PAD.t} y2={H - PAD.b} stroke="#868e96" strokeOpacity="0.45" strokeDasharray="3 3" />
              <circle cx={x(hoverIdx)} cy={y(series[hoverIdx])} r="4.5" fill={color} stroke="#0b0e11" strokeWidth="2" />
            </g>
          )}

          <rect
            x={PAD.l}
            y={PAD.t}
            width={W - PAD.l - PAD.r}
            height={H - PAD.t - PAD.b}
            fill="transparent"
            onMouseMove={onMove}
            onMouseLeave={() => setHoverIdx(null)}
          />
        </svg>
      </div>
    </section>
  );
}
