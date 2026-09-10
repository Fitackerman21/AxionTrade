import { NextResponse } from "next/server";

import { INSTRUMENTS } from "@/lib/market-data";

export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

export interface Quote {
  symbol: string;
  price: number;
  previousClose: number;
  changePct: number;
  live: boolean;
  source: string;
  ts: number;
}

/* ---------------- symbol maps ---------------- */

const YAHOO: Record<string, string> = {
  AAPL: "AAPL", NVDA: "NVDA", TSLA: "TSLA", MSFT: "MSFT", AMZN: "AMZN",
  META: "META", GOOGL: "GOOGL", AMD: "AMD", NFLX: "NFLX", JPM: "JPM",
  V: "V", KO: "KO", SPY: "SPY", QQQ: "QQQ", VOO: "VOO",
  BTC: "BTC-USD", ETH: "ETH-USD", SOL: "SOL-USD", XRP: "XRP-USD", DOGE: "DOGE-USD",
  EURUSD: "EURUSD=X", GBPUSD: "GBPUSD=X", USDJPY: "USDJPY=X",
  XAUUSD: "GC=F", WTIUSD: "CL=F",
};

const COINBASE_PRODUCTS = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD"];
const COINBASE_TO_AXION: Record<string, string> = {
  "BTC-USD": "BTC", "ETH-USD": "ETH", "SOL-USD": "SOL", "XRP-USD": "XRP", "DOGE-USD": "DOGE",
};

const FX = ["EURUSD", "GBPUSD", "USDJPY"];

const BASELINE: Record<string, { price: number; changePct: number }> = Object.fromEntries(
  INSTRUMENTS.map((i) => [i.symbol, { price: i.price, changePct: i.changePct }])
);

/* ---------------- fetchers (each returns Map<axionSymbol, Partial<Quote>>) ---------------- */

type PartialQuote = { price: number; previousClose: number; changePct: number; source: string };

async function fetchYahooChart(symbols: string[]): Promise<Map<string, PartialQuote>> {
  const out = new Map<string, PartialQuote>();
  // throttled concurrency: Yahoo 429s on bursts
  const CONCURRENCY = 4;
  const queue = [...symbols.slice(0, 24)];

  const worker = async () => {
    while (queue.length > 0) {
      const axionSym = queue.shift();
      const y = axionSym ? YAHOO[axionSym] : undefined;
      if (!axionSym || !y) continue;
      try {
        const res = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?interval=1d&range=5d`,
          { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(8000) }
        );
        if (!res.ok) continue;
        const j = await res.json();
        const meta = j?.chart?.result?.[0]?.meta;
        const price = meta?.regularMarketPrice;
        if (typeof price !== "number") continue;
        const prev =
          meta?.chartPreviousClose ?? meta?.previousClose ?? price / (1 + (meta?.regularMarketChangePercent ?? 0) / 100);
        out.set(axionSym, {
          price,
          previousClose: prev,
          changePct: typeof meta?.regularMarketChangePercent === "number" ? meta.regularMarketChangePercent : ((price - prev) / prev) * 100,
          source: "yahoo",
        });
      } catch {
        /* per-symbol timeout/error ignored */
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  return out;
}

/** gold-api.com: real-time keyless spot for precious metals */
async function fetchMetals(): Promise<Map<string, PartialQuote>> {
  const out = new Map<string, PartialQuote>();
  const METALS: Record<string, string> = { XAUUSD: "XAU", XAGUSD: "XAG" };
  await Promise.all(
    Object.entries(METALS).map(async ([axionSym, apiSym]) => {
      try {
        const res = await fetch(`https://api.gold-api.com/price/${apiSym}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return;
        const j = await res.json();
        const price = typeof j.price === "number" ? j.price : parseFloat(j.price);
        if (!Number.isFinite(price)) return;
        out.set(axionSym, { price, previousClose: price, changePct: 0, source: "gold-api" });
      } catch {
        /* ignore */
      }
    })
  );
  return out;
}

async function fetchCoinbase(): Promise<Map<string, PartialQuote>> {
  const out = new Map<string, PartialQuote>();
  await Promise.all(
    COINBASE_PRODUCTS.map(async (product) => {
      try {
        const res = await fetch(`https://api.exchange.coinbase.com/products/${product}/ticker`, {
          headers: { "User-Agent": UA, Accept: "application/json" },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return;
        const j = await res.json();
        const price = parseFloat(j.price);
        if (!Number.isFinite(price)) return;
        // 24h stats for previous close reference
        let prev: number | undefined;
        try {
          const statRes = await fetch(`https://api.exchange.coinbase.com/products/${product}/stats`, {
            headers: { "User-Agent": UA, Accept: "application/json" },
            signal: AbortSignal.timeout(8000),
          });
          if (statRes.ok) {
            const st = await statRes.json();
            prev = parseFloat(st.open);
          }
        } catch {
          /* prev optional */
        }
        out.set(COINBASE_TO_AXION[product], {
          price,
          previousClose: prev ?? price,
          changePct: prev ? ((price - prev) / prev) * 100 : 0,
          source: "coinbase",
        });
      } catch {
        /* ignore */
      }
    })
  );
  return out;
}

async function fetchFrankfurter(): Promise<Map<string, PartialQuote>> {
  const out = new Map<string, PartialQuote>();
  try {
    // one call: base EUR gives USD, GBP; JPY needs base USD trick — do 2 calls
    const [eur, usd] = await Promise.all([
      fetch("https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD,GBP", { signal: AbortSignal.timeout(8000) }).then((r) => r.json()),
      fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=JPY", { signal: AbortSignal.timeout(8000) }).then((r) => r.json()),
    ]);

    const eurRates = eur?.rates ?? {};
    const usdRates = usd?.rates ?? {};
    const usdPerEur = eurRates.USD;
    if (typeof usdPerEur === "number") {
      out.set("EURUSD", { price: usdPerEur, previousClose: usdPerEur, changePct: 0, source: "frankfurter" });
      if (typeof eurRates.GBP === "number") {
        // EURGBP rate -> GBPUSD = (USD/EUR) / (GBP/EUR)
        const gbpusd = usdPerEur / eurRates.GBP;
        out.set("GBPUSD", { price: gbpusd, previousClose: gbpusd, changePct: 0, source: "frankfurter" });
      }
    }
    if (typeof usdRates.JPY === "number") {
      out.set("USDJPY", { price: usdRates.JPY, previousClose: usdRates.JPY, changePct: 0, source: "frankfurter" });
    }
  } catch {
    /* FX optional */
  }
  return out;
}

/* ---------------- cache + route ---------------- */

const CACHE_MS = 20_000;
const cache = new Map<string, { data: Quote; expiry: number }>();

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const requested = [...new Set(
    (searchParams.get("symbols") ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
  )];

  const now = Date.now();
  const result: Quote[] = [];
  const missing: string[] = [];

  for (const sym of requested) {
    const hit = cache.get(sym);
    if (hit && hit.expiry > now) result.push(hit.data);
    else missing.push(sym);
  }

  if (missing.length > 0) {
    const collected = new Map<string, PartialQuote>();

    const cryptos = missing.filter((s) => COINBASE_PRODUCTS.some((p) => COINBASE_TO_AXION[p] === s));
    const fx = missing.filter((s) => FX.includes(s));
    const metals: string[] = missing.filter((s) => s === "XAUUSD" || s === "XAGUSD");
    const rest = missing.filter((s) => !cryptos.includes(s) && !fx.includes(s) && !metals.includes(s));

    // 1) Coinbase crypto · 2) Frankfurter FX · 3) gold-api metals · 4) Yahoo the rest
    const [cb, fk, gm, yh] = await Promise.all([
      cryptos.length ? fetchCoinbase() : Promise.resolve(new Map<string, PartialQuote>()),
      fx.length ? fetchFrankfurter() : Promise.resolve(new Map<string, PartialQuote>()),
      metals.length ? fetchMetals() : Promise.resolve(new Map<string, PartialQuote>()),
      rest.length ? fetchYahooChart(rest) : Promise.resolve(new Map<string, PartialQuote>()),
    ]);

    for (const src of [cb, fk, gm, yh]) {
      for (const [sym, q] of src) {
        if (!collected.has(sym)) collected.set(sym, q);
      }
    }

    // Yahoo as fallback for crypto/FX the primary sources missed
    const stillMissing = missing.filter((s) => !collected.has(s));
    if (stillMissing.length > 0) {
      const yh2 = await fetchYahooChart(stillMissing);
      for (const [sym, q] of yh2) {
        if (!collected.has(sym)) collected.set(sym, q);
      }
    }

    for (const sym of missing) {
      const q = collected.get(sym);
      if (q) {
        const full: Quote = { symbol: sym, ...q, live: true, ts: now };
        cache.set(sym, { data: full, expiry: now + CACHE_MS });
        result.push(full);
      }
    }
  }

  // baseline fallback so the UI never shows zeros
  const seen = new Set(result.map((q) => q.symbol));
  for (const sym of requested) {
    if (!seen.has(sym)) {
      const b = BASELINE[sym];
      if (!b) continue;
      const prev = b.price / (1 + b.changePct / 100);
      const fallback: Quote = { symbol: sym, price: b.price, previousClose: prev, changePct: b.changePct, live: false, source: "baseline", ts: now };
      result.push(fallback);
    }
  }

  return NextResponse.json(
    { quotes: result },
    { headers: { "Cache-Control": "no-store" } }
  );
}
