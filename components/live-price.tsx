"use client";

import { useEffect, useRef, useState } from "react";

import { useLiveQuote } from "@/components/live-prices";
import { formatPrice, type Instrument } from "@/lib/market-data";

export function LivePrice({
  inst,
  showChange = false,
  className = "",
  flashMs = 700,
}: {
  inst: Instrument;
  showChange?: boolean;
  className?: string;
  flashMs?: number;
}) {
  const q = useLiveQuote(inst.symbol);
  const price = q?.price ?? inst.price;
  const changePct = q?.changePct ?? inst.changePct;
  const live = q?.live ?? false;

  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const lastRef = useRef(price);

  useEffect(() => {
    if (price !== lastRef.current) {
      setFlash(price > lastRef.current ? "up" : "down");
      lastRef.current = price;
      const t = setTimeout(() => setFlash(null), flashMs);
      return () => clearTimeout(t);
    }
  }, [price, flashMs]);

  const up = changePct >= 0;

  return (
    <span className={`inline-flex items-baseline gap-2 ${className}`}>
      <span
        className={`font-mono tabular-nums transition-colors duration-500 ${
          flash === "up" ? "text-gain" : flash === "down" ? "text-loss" : ""
        }`}
      >
        {formatPrice(price, inst.kind)}
      </span>
      {showChange && (
        <span
          className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums ${
            up ? "bg-gain/10 text-gain" : "bg-loss/10 text-loss"
          }`}
        >
          {up ? "+" : ""}
          {changePct.toFixed(2)}%
        </span>
      )}
    </span>
  );
}

/** Small pulsing dot indicating a live websocket/REST feed */
export function LiveDot({ connected }: { connected: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2" aria-hidden>
      {connected && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gain opacity-60" />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${connected ? "bg-gain" : "bg-muted"}`} />
    </span>
  );
}
