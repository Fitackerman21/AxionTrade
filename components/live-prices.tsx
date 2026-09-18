"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { INSTRUMENTS } from "@/lib/market-data";

export type TickDir = "up" | "down" | null;

export interface LiveQuote {
  symbol: string;
  price: number;
  previousClose: number;
  changePct: number;
  live: boolean;
  dir: TickDir;
  ts: number;
}

const CRYPTO_PRODUCTS = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD"];
const CRYPTO_TO_AXION: Record<string, string> = {
  "BTC-USD": "BTC", "ETH-USD": "ETH", "SOL-USD": "SOL", "XRP-USD": "XRP", "DOGE-USD": "DOGE",
};
/** non-crypto symbols polled through our Yahoo proxy */
const REST_SYMBOLS = INSTRUMENTS.filter((i) => i.kind !== "crypto").map((i) => i.symbol);
const REST_INTERVAL_MS = 7_000;

/**
 * Per-asset-class micro volatility, as a fraction of price per tick. Used only
 * to interpolate BETWEEN real quotes — see the micro-tick engine below.
 */
const KIND_TICK_VOL: Record<string, number> = {
  crypto: 0.00042,
  commodity: 0.00017,
  stock: 0.00014,
  etf: 0.00009,
  index: 0.00008,
  forex: 0.00005,
};
const KIND_BY_SYMBOL = new Map(INSTRUMENTS.map((i) => [i.symbol, i.kind]));
const tickVol = (sym: string) => KIND_TICK_VOL[KIND_BY_SYMBOL.get(sym) ?? "stock"] ?? 0.00014;

interface LivePricesCtx {
  quotes: Map<string, LiveQuote>;
  connected: boolean;
}

const Ctx = createContext<LivePricesCtx>({ quotes: new Map(), connected: false });

export function useLiveQuote(symbol: string): LiveQuote | undefined {
  const { quotes } = useContext(Ctx);
  return quotes.get(symbol.toUpperCase());
}

export function useLivePrices(): LivePricesCtx {
  return useContext(Ctx);
}

export function LivePricesProvider({ children }: { children: React.ReactNode }) {
  const [quotes, setQuotes] = useState<Map<string, LiveQuote>>(new Map());
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  /** refs so WS handlers read the freshest prices without re-subscribing */
  const priceRef = useRef<Map<string, LiveQuote>>(new Map());
  /** last values that actually came from a provider — the anchor for interpolation */
  const anchorRef = useRef<Map<string, number>>(new Map());

  const upsert = useCallback((sym: string, price: number, prevClose: number | undefined, live: boolean) => {
    anchorRef.current.set(sym, price);
    setQuotes((prev) => {
      const old = prev.get(sym) ?? priceRef.current.get(sym);
      const previousClose = prevClose ?? old?.previousClose ?? price;
      const last = old?.price ?? price;
      const dir: TickDir = price > last ? "up" : price < last ? "down" : (old?.dir ?? null);
      const q: LiveQuote = {
        symbol: sym,
        price,
        previousClose,
        changePct: previousClose ? ((price - previousClose) / previousClose) * 100 : (old?.changePct ?? 0),
        live,
        dir,
        ts: Date.now(),
      };
      const next = new Map(prev);
      next.set(sym, q);
      priceRef.current = next;
      return next;
    });
  }, []);

  // ---- Coinbase WS: instant crypto ticks ----
  useEffect(() => {
    let closed = false;
    let retry = 0;
    let ws: WebSocket | null = null;

    const connect = () => {
      if (closed) return;
      try {
        ws = new WebSocket("wss://ws-feed.exchange.coinbase.com");
        wsRef.current = ws;

        ws.onopen = () => {
          setConnected(true);
          ws?.send(
            JSON.stringify({
              type: "subscribe",
              product_ids: CRYPTO_PRODUCTS,
              channels: ["ticker"],
            })
          );
        };

        ws.onmessage = (ev) => {
          try {
            const m = JSON.parse(ev.data as string);
            if (m.type === "ticker" && m.price != null) {
              const sym = CRYPTO_TO_AXION[m.product_id as string];
              if (sym) upsert(sym, parseFloat(m.price), m.open_24h != null ? parseFloat(m.open_24h) : undefined, true);
            }
          } catch {
            /* ignore malformed frames */
          }
        };

        ws.onclose = () => {
          setConnected(false);
          if (!closed && retry < 5) {
            retry += 1;
            setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry));
          }
        };

        ws.onerror = () => ws?.close();
      } catch {
        /* WS unavailable — REST polling still covers crypto */
      }
    };

    connect();
    return () => {
      closed = true;
      try {
        wsRef.current?.close();
      } catch {
        /* noop */
      }
    };
  }, [upsert]);

  // ---- REST polling for stocks/ETF/FX/commodities (via our cached proxy) ----
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const res = await fetch(`/api/quotes?symbols=${REST_SYMBOLS.join(",")}`, { cache: "no-store" });
        if (res.ok) {
          const json = await res.json();
          for (const q of json.quotes ?? []) {
            upsert(q.symbol, q.price, q.previousClose, q.live);
          }
        }
      } catch {
        /* keep old prices on failure */
      } finally {
        if (!stopped) timer = setTimeout(poll, REST_INTERVAL_MS);
      }
    };

    poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [upsert]);

  /* ---- micro-tick engine -------------------------------------------------
   * Providers rate-limit, so genuine quotes land every few seconds at best and
   * the tape looks frozen in between. This interpolates: each tick nudges the
   * displayed price by a volatility-scaled step AND mean-reverts it toward the
   * last real value, so the book moves continuously while staying anchored to
   * live data rather than drifting off into fiction.
   */
  useEffect(() => {
    const id = setInterval(() => {
      if (anchorRef.current.size === 0) return;
      setQuotes((prev) => {
        if (prev.size === 0) return prev;
        const next = new Map(prev);
        for (const [sym, q] of prev) {
          const anchor = anchorRef.current.get(sym);
          if (anchor === undefined || !Number.isFinite(anchor)) continue;

          const vol = tickVol(sym);
          // sum of three uniforms ~ triangular, cheap approximation of noise
          const noise = (Math.random() + Math.random() + Math.random() - 1.5) * vol * anchor;
          const pull = (anchor - q.price) * 0.22; // stay glued to the real value
          const price = Math.max(anchor * 0.85, q.price + pull + noise);

          // only flip direction on a meaningful move, otherwise the colour strobes
          const moved = Math.abs(price - q.price) > vol * anchor * 0.35;
          const dir: TickDir = moved ? (price > q.price ? "up" : "down") : q.dir;

          next.set(sym, {
            ...q,
            price,
            dir,
            changePct: q.previousClose ? ((price - q.previousClose) / q.previousClose) * 100 : q.changePct,
            ts: Date.now(),
          });
        }
        priceRef.current = next;
        return next;
      });
    }, 850);

    return () => clearInterval(id);
  }, []);

  // ---- seed baseline prices instantly on first mount (no flash of zeros) ----
  useEffect(() => {
    setQuotes((prev) => {
      if (prev.size > 0) return prev;
      const seed = new Map<string, LiveQuote>();
      for (const i of INSTRUMENTS) {
        seed.set(i.symbol, {
          symbol: i.symbol,
          price: i.price,
          previousClose: i.price / (1 + i.changePct / 100),
          changePct: i.changePct,
          live: false,
          dir: null,
          ts: 0,
        });
      }
      return seed;
    });
  }, []);

  const value = useMemo(() => ({ quotes, connected }), [quotes, connected]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
