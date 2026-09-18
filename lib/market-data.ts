export interface Instrument {
  symbol: string;
  name: string;
  kind: "stock" | "etf" | "index" | "crypto" | "forex" | "commodity";
  price: number;
  changePct: number;
  /** Rough 24h volatility to shape the seeded series */
  vol?: number;
}

/**
 * Baseline marks. These are the first-paint values before /api/quotes lands,
 * and the last-resort fallback when every live source is down — so they are
 * refreshed periodically against the same providers the API uses.
 * Last sync: 2026-09-17 (CNBC close + Coinbase spot).
 */
export const INSTRUMENTS: Instrument[] = [
  { symbol: "AAPL", name: "Apple Inc.", kind: "stock", price: 337.0, changePct: 1.38 },
  { symbol: "NVDA", name: "NVIDIA Corporation", kind: "stock", price: 219.34, changePct: 2.54 },
  { symbol: "TSLA", name: "Tesla, Inc.", kind: "stock", price: 366.2, changePct: 2.27 },
  { symbol: "MSFT", name: "Microsoft Corporation", kind: "stock", price: 497.75, changePct: 1.52 },
  { symbol: "AMZN", name: "Amazon.com, Inc.", kind: "stock", price: 251.19, changePct: 2.13 },
  { symbol: "META", name: "Meta Platforms, Inc.", kind: "stock", price: 682.31, changePct: 1.34 },
  { symbol: "GOOGL", name: "Alphabet Inc.", kind: "stock", price: 347.33, changePct: 1.3 },
  { symbol: "AMD", name: "Advanced Micro Devices", kind: "stock", price: 545.09, changePct: 6.36 },
  { symbol: "NFLX", name: "Netflix, Inc.", kind: "stock", price: 75.31, changePct: -1.44 },
  { symbol: "JPM", name: "JPMorgan Chase & Co.", kind: "stock", price: 349.31, changePct: 0.11 },
  { symbol: "V", name: "Visa Inc.", kind: "stock", price: 369.93, changePct: -0.27 },
  { symbol: "KO", name: "The Coca-Cola Company", kind: "stock", price: 88.06, changePct: 0.22 },
  { symbol: "SPY", name: "SPDR S&P 500 ETF Trust", kind: "etf", price: 762.6, changePct: 1.13 },
  { symbol: "QQQ", name: "Invesco QQQ Trust", kind: "etf", price: 716.92, changePct: 1.73 },
  { symbol: "VOO", name: "Vanguard S&P 500 ETF", kind: "etf", price: 701.03, changePct: 1.12 },
  { symbol: "BTC", name: "Bitcoin", kind: "crypto", price: 76512.73, changePct: 0.28, vol: 0.028 },
  { symbol: "ETH", name: "Ethereum", kind: "crypto", price: 2448.57, changePct: 0.95, vol: 0.034 },
  { symbol: "SOL", name: "Solana", kind: "crypto", price: 101.7, changePct: 2.55, vol: 0.05 },
  { symbol: "XRP", name: "XRP", kind: "crypto", price: 1.3001, changePct: 0.05, vol: 0.042 },
  { symbol: "DOGE", name: "Dogecoin", kind: "crypto", price: 0.08198, changePct: 1.23, vol: 0.055 },
  { symbol: "EURUSD", name: "Euro / US Dollar", kind: "forex", price: 1.148, changePct: 0.05 },
  { symbol: "GBPUSD", name: "British Pound / US Dollar", kind: "forex", price: 1.336, changePct: 0.04 },
  { symbol: "USDJPY", name: "US Dollar / Japanese Yen", kind: "forex", price: 156.19, changePct: 0.15 },
  { symbol: "XAUUSD", name: "Gold Spot / US Dollar", kind: "commodity", price: 4396.7, changePct: -0.07 },
  { symbol: "WTIUSD", name: "Crude Oil WTI", kind: "commodity", price: 101.24, changePct: -0.66 },
];

export const byKind = (kind: Instrument["kind"]) =>
  INSTRUMENTS.filter((i) => i.kind === kind);

export function formatPrice(v: number, kind: Instrument["kind"]) {
  if (kind === "forex") return v.toFixed(4);
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return v.toPrecision(6).replace(/\.?0+$/, "");
}

export function formatPct(v: number) {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

/**
 * Deterministic pseudo-random walk seeded by symbol so SSR and client
 * render identical series (no hydration mismatch, no random flicker).
 */
export function seededSeries(symbol: string, len: number, vol = 0.012): number[] {
  let seed = 0;
  for (let i = 0; i < symbol.length; i++) seed = (seed * 131 + symbol.charCodeAt(i)) >>> 0;

  const rand = () => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed / 4294967296;
  };

  const out: number[] = [];
  let v = 1;
  // 3/4 of the walk drifts "backwards" from current price so the series ends at ~1.0
  for (let i = 0; i < len; i++) {
    v *= 1 + (rand() - 0.5) * 2 * vol;
    out.push(v);
  }
  const scale = 1 / out[out.length - 1];
  return out.map((x) => x * scale);
}
