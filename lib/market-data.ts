export interface Instrument {
  symbol: string;
  name: string;
  kind: "stock" | "etf" | "index" | "crypto" | "forex" | "commodity";
  price: number;
  changePct: number;
  /** Rough 24h volatility to shape the seeded series */
  vol?: number;
}

export const INSTRUMENTS: Instrument[] = [
  { symbol: "AAPL", name: "Apple Inc.", kind: "stock", price: 227.52, changePct: 0.84 },
  { symbol: "NVDA", name: "NVIDIA Corporation", kind: "stock", price: 131.26, changePct: 2.64 },
  { symbol: "TSLA", name: "Tesla, Inc.", kind: "stock", price: 248.5, changePct: -1.32 },
  { symbol: "MSFT", name: "Microsoft Corporation", kind: "stock", price: 416.72, changePct: 0.42 },
  { symbol: "AMZN", name: "Amazon.com, Inc.", kind: "stock", price: 186.33, changePct: 1.18 },
  { symbol: "META", name: "Meta Platforms, Inc.", kind: "stock", price: 528.19, changePct: 1.76 },
  { symbol: "GOOGL", name: "Alphabet Inc.", kind: "stock", price: 166.4, changePct: -0.36 },
  { symbol: "AMD", name: "Advanced Micro Devices", kind: "stock", price: 158.77, changePct: 2.11 },
  { symbol: "NFLX", name: "Netflix, Inc.", kind: "stock", price: 692.38, changePct: 0.68 },
  { symbol: "JPM", name: "JPMorgan Chase & Co.", kind: "stock", price: 212.44, changePct: -0.52 },
  { symbol: "V", name: "Visa Inc.", kind: "stock", price: 275.3, changePct: 0.29 },
  { symbol: "KO", name: "The Coca-Cola Company", kind: "stock", price: 63.14, changePct: 0.12 },
  { symbol: "SPY", name: "SPDR S&P 500 ETF Trust", kind: "etf", price: 561.96, changePct: 0.38 },
  { symbol: "QQQ", name: "Invesco QQQ Trust", kind: "etf", price: 474.9, changePct: 0.56 },
  { symbol: "VOO", name: "Vanguard S&P 500 ETF", kind: "etf", price: 519.8, changePct: 0.36 },
  { symbol: "BTC", name: "Bitcoin", kind: "crypto", price: 81240, changePct: 1.92, vol: 0.028 },
  { symbol: "ETH", name: "Ethereum", kind: "crypto", price: 3142.5, changePct: 2.45, vol: 0.034 },
  { symbol: "SOL", name: "Solana", kind: "crypto", price: 168.32, changePct: 4.18, vol: 0.05 },
  { symbol: "XRP", name: "XRP", kind: "crypto", price: 0.6234, changePct: -1.86, vol: 0.042 },
  { symbol: "DOGE", name: "Dogecoin", kind: "crypto", price: 0.1582, changePct: 3.42, vol: 0.055 },
  { symbol: "EURUSD", name: "Euro / US Dollar", kind: "forex", price: 1.1026, changePct: 0.11 },
  { symbol: "GBPUSD", name: "British Pound / US Dollar", kind: "forex", price: 1.3128, changePct: -0.08 },
  { symbol: "USDJPY", name: "US Dollar / Japanese Yen", kind: "forex", price: 142.31, changePct: 0.22 },
  { symbol: "XAUUSD", name: "Gold Spot / US Dollar", kind: "commodity", price: 2528.4, changePct: 0.64 },
  { symbol: "WTIUSD", name: "Crude Oil WTI", kind: "commodity", price: 71.63, changePct: -1.24 },
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
