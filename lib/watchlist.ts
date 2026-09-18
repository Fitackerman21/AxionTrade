"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "axion_watchlist_v1";

/** A sensible starting list so the feature is never empty on first visit. */
export const DEFAULT_WATCHLIST = [
  "NVDA",
  "BTC",
  "ETH",
  "SOL",
  "TSLA",
  "SPY",
  "XAUUSD",
  "EURUSD",
];

/**
 * Persisted watchlist. Kept in localStorage so it survives reloads and is
 * shared by every surface that offers a star.
 */
export function useWatchlist() {
  const [symbols, setSymbols] = useState<string[]>(DEFAULT_WATCHLIST);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          setSymbols(parsed.filter((s): s is string => typeof s === "string"));
        }
      }
    } catch {
      /* keep defaults */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(symbols));
    } catch {
      /* storage unavailable */
    }
  }, [symbols, hydrated]);

  const has = useCallback((symbol: string) => symbols.includes(symbol), [symbols]);

  const toggle = useCallback((symbol: string) => {
    setSymbols((prev) => (prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol]));
  }, []);

  return { symbols, has, toggle, hydrated };
}
