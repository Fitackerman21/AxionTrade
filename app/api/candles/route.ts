import { NextRequest, NextResponse } from "next/server";

import { seededCandles, TF_MAP, type Candle } from "@/lib/candles";
import { INSTRUMENTS } from "@/lib/market-data";

export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

const jsonHeaders = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const ok = (body: unknown) => new NextResponse(JSON.stringify(body), { headers: jsonHeaders });
const bad = (status: number, msg: string) => ok({ error: msg, status });

async function getJson(url: string, timeoutMs = 8000): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/* -------------------- Coinbase (crypto, real candles) -------------------- */

const CB_IDS: Record<string, string> = {
  BTC: "BTC-USD",
  ETH: "ETH-USD",
  SOL: "SOL-USD",
  XRP: "XRP-USD",
  DOGE: "DOGE-USD",
};
const CB_GRAN: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1d": 86400 };

async function fromCoinbase(symbol: string, tf: string): Promise<Candle[] | null> {
  const id = CB_IDS[symbol];
  const gran = CB_GRAN[tf];
  if (!id || !gran) return null;
  const data = (await getJson(
    `https://api.exchange.coinbase.com/products/${id}/candles?granularity=${gran}`
  )) as number[][] | null;
  if (!Array.isArray(data) || data.length < 30) return null;
  let out: Candle[] = data
    .map((r) => ({ time: r[0], low: r[1], high: r[2], open: r[3], close: r[4], volume: r[5] }))
    .sort((a, b) => a.time - b.time);
  if (out.length > 400) out = out.slice(out.length - 400);
  return out;
}

/* -------------------- Yahoo (stocks/ETF/FX/commodities) -------------------- */

const Y_INTERVAL: Record<string, { interval: string; range: string }> = {
  "1m": { interval: "1m", range: "1d" },
  "5m": { interval: "5m", range: "5d" },
  "15m": { interval: "15m", range: "5d" },
  "1h": { interval: "60m", range: "1mo" },
  "1d": { interval: "1d", range: "2y" },
  "1w": { interval: "1wk", range: "5y" },
};
const Y_SYMBOL: Record<string, string> = {
  "commodity:XAUUSD": "GC=F",
  "commodity:WTIUSD": "CL=F",
};

function yahooSymbol(symbol: string, kind: string): string {
  return Y_SYMBOL[`${kind}:${symbol}`] ?? encodeURIComponent(symbol);
}

async function fromYahoo(
  symbol: string,
  kind: string,
  tf: string
): Promise<{ candles: Candle[]; prevClose?: number } | null> {
  const cfg = Y_INTERVAL[tf];
  if (!cfg) return null;
  const data = (await getJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol(symbol, kind)}?interval=${cfg.interval}&range=${cfg.range}`
  )) as {
    chart?: {
      result?: Array<{
        meta?: { chartPreviousClose?: number; previousClose?: number };
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            open?: (number | null)[];
            high?: (number | null)[];
            low?: (number | null)[];
            close?: (number | null)[];
            volume?: (number | null)[];
          }>;
        };
      }>;
    };
  } | null;
  const r = data?.chart?.result?.[0];
  const q = r?.indicators?.quote?.[0];
  const ts = r?.timestamp;
  if (!r || !q || !ts || ts.length < 30) return null;

  const candles: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    candles.push({
      time: ts[i],
      open: o,
      high: h,
      low: l,
      close: c,
      volume: q.volume?.[i] ?? 0,
    });
  }
  if (candles.length < 30) return null;
  return { candles, prevClose: r.meta?.chartPreviousClose ?? r.meta?.previousClose };
}

/* --------------------------------- route --------------------------------- */

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase();
  const tfId = req.nextUrl.searchParams.get("tf") ?? "5m";
  const tf = TF_MAP[tfId];
  const inst = INSTRUMENTS.find((i) => i.symbol === symbol);

  if (!tf || !inst) return bad(400, "Unknown symbol or timeframe");

  // source chain per asset class
  let candles: Candle[] | null = null;
  let source = "seeded";
  let prevClose: number | undefined;

  if (inst.kind === "crypto") {
    candles = await fromCoinbase(symbol, tf.id);
    if (candles) source = "coinbase";
  }
  if (!candles && inst.kind !== "crypto") {
    const y = await fromYahoo(symbol, inst.kind, tf.id);
    if (y) {
      candles = y.candles;
      prevClose = y.prevClose;
      source = "yahoo";
    }
  }
  if (!candles) {
    candles = seededCandles(symbol, tf, inst.price, inst.vol ?? 0.01);
    prevClose = inst.price / (1 + inst.changePct / 100);
  }

  return ok({
    symbol,
    tf: tf.id,
    source,
    live: source !== "seeded",
    prevClose,
    candles,
  });
}
