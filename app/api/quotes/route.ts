import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

export interface Quote {
  symbol: string; // AxionTrade symbol
  price: number;
  previousClose: number;
  changePct: number;
  live: boolean;
  ts: number;
}

const CACHE_MS = 12_000; // server-side cache to respect Yahoo rate limits
const cache = new Map<string, { data: Quote; expiry: number }>();

/** AxionTrade symbol -> Yahoo symbol */
export const YAHOO_MAP: Record<string, string> = {
  AAPL: "AAPL", NVDA: "NVDA", TSLA: "TSLA", MSFT: "MSFT", AMZN: "AMZN",
  META: "META", GOOGL: "GOOGL", AMD: "AMD", NFLX: "NFLX", JPM: "JPM",
  V: "V", KO: "KO", SPY: "SPY", QQQ: "QQQ", VOO: "VOO",
  BTC: "BTC-USD", ETH: "ETH-USD", SOL: "SOL-USD", XRP: "XRP-USD", DOGE: "DOGE-USD",
  EURUSD: "EURUSD=X", GBPUSD: "GBPUSD=X", USDJPY: "USDJPY=X",
  XAUUSD: "GC=F", WTIUSD: "CL=F",
};

const BASELINE: Record<string, { price: number; changePct: number }> = {
  AAPL: { price: 227.52, changePct: 0.84 }, NVDA: { price: 131.26, changePct: 2.64 },
  TSLA: { price: 248.5, changePct: -1.32 }, MSFT: { price: 416.72, changePct: 0.42 },
  AMZN: { price: 186.33, changePct: 1.18 }, META: { price: 528.19, changePct: 1.76 },
  GOOGL: { price: 166.4, changePct: -0.36 }, AMD: { price: 158.77, changePct: 2.11 },
  NFLX: { price: 692.38, changePct: 0.68 }, JPM: { price: 212.44, changePct: -0.52 },
  V: { price: 275.3, changePct: 0.29 }, KO: { price: 63.14, changePct: 0.12 },
  SPY: { price: 561.96, changePct: 0.38 }, QQQ: { price: 474.9, changePct: 0.56 },
  VOO: { price: 519.8, changePct: 0.36 },
  BTC: { price: 81240, changePct: 1.92 }, ETH: { price: 3142.5, changePct: 2.45 },
  SOL: { price: 168.32, changePct: 4.18 }, XRP: { price: 0.6234, changePct: -1.86 },
  DOGE: { price: 0.1582, changePct: 3.42 },
  EURUSD: { price: 1.1026, changePct: 0.11 }, GBPUSD: { price: 1.3128, changePct: -0.08 },
  USDJPY: { price: 142.31, changePct: 0.22 },
  XAUUSD: { price: 2528.4, changePct: 0.64 }, WTIUSD: { price: 71.63, changePct: -1.24 },
};

async function fetchYahoo(symbols: string[]): Promise<Map<string, Quote>> {
  const out = new Map<string, Quote>();
  if (symbols.length === 0) return out;

  const url =
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols.join(",")}` +
    `&fields=regularMarketPrice,regularMarketChangePercent,regularMarketDayHigh,regularMarketDayLow`;

  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`yahoo ${res.status}`);

  const json = await res.json();
  const rows = json?.quoteResponse?.result ?? [];
  for (const r of rows) {
    const price = r.regularMarketPrice;
    if (typeof price !== "number") continue;
    const prev = r.previousClose ?? r.chartPreviousClose ?? price;
    out.set(r.symbol, {
      symbol: r.symbol,
      price,
      previousClose: prev,
      changePct: typeof r.regularMarketChangePercent === "number" ? r.regularMarketChangePercent : ((price - prev) / prev) * 100,
      live: true,
      ts: Date.now(),
    });
  }
  return out;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const requested = (searchParams.get("symbols") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const now = Date.now();
  const result: Quote[] = [];
  const needFetch: string[] = [];

  for (const sym of requested) {
    const hit = cache.get(sym);
    if (hit && hit.expiry > now) {
      result.push(hit.data);
    } else {
      needFetch.push(sym);
    }
  }

  if (needFetch.length > 0) {
    const yahooSymbols = needFetch.map((s) => YAHOO_MAP[s]).filter(Boolean);
    const yahooToAxion = new Map(needFetch.filter((s) => YAHOO_MAP[s]).map((s) => [YAHOO_MAP[s], s]));

    try {
      const quotes = await fetchYahoo(yahooSymbols);
      for (const [ysym, q] of quotes) {
        const axion = yahooToAxion.get(ysym);
        if (!axion) continue;
        const mapped: Quote = { ...q, symbol: axion };
        cache.set(axion, { data: mapped, expiry: Date.now() + CACHE_MS });
        result.push(mapped);
      }
    } catch {
      // fall through to baseline below
    }
  }

  // baseline fallback for anything still missing
  const seen = new Set(result.map((q) => q.symbol));
  for (const sym of requested) {
    if (!seen.has(sym) && BASELINE[sym]) {
      const b = BASELINE[sym];
      const prev = b.price / (1 + b.changePct / 100);
      result.push({
        symbol: sym,
        price: b.price,
        previousClose: prev,
        changePct: b.changePct,
        live: false,
        ts: now,
      });
    }
  }

  return NextResponse.json({ quotes: result });
}
