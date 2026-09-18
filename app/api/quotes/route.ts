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

/**
 * CNBC's public quote service is keyless and returns a real intraday change,
 * a previous close and the trading session — one request covers every symbol.
 * It is the primary source for everything except crypto (Coinbase's book is
 * tighter for spot crypto).
 */
const CNBC_SYMBOL: Record<string, string> = {
  AAPL: "AAPL", NVDA: "NVDA", TSLA: "TSLA", MSFT: "MSFT", AMZN: "AMZN",
  META: "META", GOOGL: "GOOGL", AMD: "AMD", NFLX: "NFLX", JPM: "JPM",
  V: "V", KO: "KO", SPY: "SPY", QQQ: "QQQ", VOO: "VOO",
  BTC: "BTC=", ETH: "ETH=", SOL: "SOL=", XRP: "XRP=", DOGE: "DOGE=",
  EURUSD: "EUR=", GBPUSD: "GBP=", USDJPY: "JPY=",
  XAUUSD: "@GC.1", WTIUSD: "@CL.1",
};

const COINBASE_PRODUCTS = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD"];
const COINBASE_TO_AXION: Record<string, string> = {
  "BTC-USD": "BTC", "ETH-USD": "ETH", "SOL-USD": "SOL", "XRP-USD": "XRP", "DOGE-USD": "DOGE",
};
const CRYPTO_SYMS = Object.values(COINBASE_TO_AXION);

const FX = ["EURUSD", "GBPUSD", "USDJPY"];

const BASELINE: Record<string, { price: number; changePct: number }> = Object.fromEntries(
  INSTRUMENTS.map((i) => [i.symbol, { price: i.price, changePct: i.changePct }])
);

/* ---------------- fetchers (each returns Map<axionSymbol, PartialQuote>) ---------------- */

type PartialQuote = { price: number; previousClose: number; changePct: number; source: string };

/** CNBC hands back numbers as display strings ("+4.59", "4,396.70", "+1.38%"). */
function toNum(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  const cleaned = v.replace(/[^0-9.+-]/g, "");
  if (!cleaned || cleaned === "+" || cleaned === "-") return undefined;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

interface CnbcQuote {
  symbol?: string;
  code?: number;
  last?: string;
  change?: string;
  change_pct?: string;
  previous_day_closing?: string;
  open?: string;
  last_time?: string;
  curmktstatus?: string;
}

async function fetchCNBC(axionSymbols: string[]): Promise<Map<string, PartialQuote>> {
  const out = new Map<string, PartialQuote>();
  const pairs = axionSymbols
    .map((s) => [s, CNBC_SYMBOL[s]] as const)
    .filter((p): p is readonly [string, string] => Boolean(p[1]));
  if (pairs.length === 0) return out;

  const rev = new Map(pairs.map(([a, c]) => [c, a]));
  const symbols = pairs.map(([, c]) => c).join("|");

  try {
    const res = await fetch(
      `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(
        symbols
      )}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json`,
      { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(9000) }
    );
    if (!res.ok) return out;
    const j = await res.json();
    const raw = j?.FormattedQuoteResult?.FormattedQuote;
    // single-symbol requests come back as an object, not an array
    const list: CnbcQuote[] = Array.isArray(raw) ? raw : raw ? [raw] : [];

    for (const q of list) {
      if (q?.code !== 0) continue; // code 1 = unknown symbol / no data
      const axion = q.symbol ? rev.get(q.symbol) : undefined;
      if (!axion) continue;
      const price = toNum(q.last);
      if (price === undefined) continue;
      const prev = toNum(q.previous_day_closing) ?? price;
      const pct = toNum(q.change_pct) ?? (prev ? ((price - prev) / prev) * 100 : 0);
      out.set(axion, { price, previousClose: prev, changePct: pct, source: "cnbc" });
    }
  } catch {
    /* provider unreachable — chain moves on */
  }
  return out;
}

async function fetchYahooChart(symbols: string[]): Promise<Map<string, PartialQuote>> {
  const out = new Map<string, PartialQuote>();
  // throttled concurrency: Yahoo 429s on bursts (and now often outright)
  const CONCURRENCY = 3;
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

/** Short TTL so the client can poll briskly without hammering the provider. */
const CACHE_MS = 6_000;
const cache = new Map<string, { data: Quote; expiry: number }>();

const EMPTY = () => new Map<string, PartialQuote>();

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

    const cryptos = missing.filter((s) => CRYPTO_SYMS.includes(s));
    const fx = missing.filter((s) => FX.includes(s));
    const metals: string[] = missing.filter((s) => s === "XAUUSD" || s === "XAGUSD");
    const rest = missing.filter((s) => !cryptos.includes(s) && !fx.includes(s) && !metals.includes(s));

    // one CNBC call covers every symbol that has a mapping
    const [cb, cn, fk, gm, yh] = await Promise.all([
      cryptos.length ? fetchCoinbase() : Promise.resolve(EMPTY()),
      fetchCNBC(missing),
      fx.length ? fetchFrankfurter() : Promise.resolve(EMPTY()),
      metals.length ? fetchMetals() : Promise.resolve(EMPTY()),
      rest.length ? fetchYahooChart(rest) : Promise.resolve(EMPTY()),
    ]);

    // per-asset-class priority: spot crypto from Coinbase, everything else CNBC
    const apply = (sym: string, sources: Map<string, PartialQuote>[]) => {
      for (const src of sources) {
        const q = src.get(sym);
        if (q) {
          collected.set(sym, q);
          return;
        }
      }
    };

    for (const sym of cryptos) apply(sym, [cb, cn, yh]);
    for (const sym of fx) apply(sym, [cn, fk, yh]);
    for (const sym of metals) apply(sym, [cn, gm, yh]);
    for (const sym of rest) apply(sym, [cn, yh]);

    // last-ditch sweep for anything the class chain missed
    const stillMissing = missing.filter((s) => !collected.has(s));
    if (stillMissing.length > 0) {
      const yh2 = await fetchYahooChart(stillMissing);
      for (const sym of stillMissing) {
        const q = yh2.get(sym);
        if (q && !collected.has(sym)) collected.set(sym, q);
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
