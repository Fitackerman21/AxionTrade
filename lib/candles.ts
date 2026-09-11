export interface Candle {
  /** UNIX seconds */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandleSeries {
  candles: Candle[];
  live: boolean;
  source: string;
  prevClose?: number;
  changePct?: number;
}

export interface Timeframe {
  id: string;
  label: string;
  /** seconds per candle */
  sec: number;
  /** how many candles to render */
  count: number;
}

export const TIMEFRAMES: Timeframe[] = [
  { id: "1m", label: "1m", sec: 60, count: 300 },
  { id: "5m", label: "5m", sec: 300, count: 360 },
  { id: "15m", label: "15m", sec: 900, count: 384 },
  { id: "1h", label: "1H", sec: 3600, count: 420 },
  { id: "1d", label: "1D", sec: 86400, count: 365 },
  { id: "1w", label: "1W", sec: 604800, count: 156 },
];

export const TF_MAP: Record<string, Timeframe> = Object.fromEntries(
  TIMEFRAMES.map((t) => [t.id, t])
);

/* ------------------------------------------------------------------ */
/* Deterministic seeded OHLC fallback (SSR-safe, no hydration flicker) */
/* ------------------------------------------------------------------ */

function hashSeed(s: string): number {
  let seed = 0;
  for (let i = 0; i < s.length; i++) seed = (seed * 131 + s.charCodeAt(i)) >>> 0;
  // avoid the all-zero xorshift state
  return seed === 0 ? 0x9e3779b9 : seed;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand: () => number): number {
  return (rand() + rand() + rand() + rand() - 2) * 0.7;
}

/**
 * Realistic-looking OHLC walk that ends exactly at `endPrice`.
 * Deterministic per (symbol, timeframe) — same series on server and client.
 */
export function seededCandles(
  symbol: string,
  tf: Timeframe,
  endPrice: number,
  vol = 0.012
): Candle[] {
  const rand = mulberry(hashSeed(`${symbol}:${tf.id}`));
  const n = tf.count;
  const now = Math.floor(Date.now() / 1000);
  const anchor = Math.floor(now / tf.sec) * tf.sec;

  // walk backwards from 1.0, then scale so the LAST close === endPrice
  const closes: number[] = [];
  let v = 1;
  for (let i = 0; i < n; i++) {
    v *= 1 + gauss(rand) * vol;
    closes.push(v);
  }
  const scale = endPrice / closes[closes.length - 1];

  const candles: Candle[] = [];
  let prevOpen = closes[0] * scale * (1 - gauss(rand) * vol * 0.5);
  for (let i = 0; i < n; i++) {
    const close = closes[i] * scale;
    const open = i === 0 ? prevOpen : candles[i - 1].close;
    const hi = Math.max(open, close) * (1 + Math.abs(gauss(rand)) * vol * 0.55);
    const lo = Math.min(open, close) * (1 - Math.abs(gauss(rand)) * vol * 0.55);
    const spreadPct = Math.abs(close - open) / open;
    candles.push({
      time: anchor - (n - 1 - i) * tf.sec,
      open: +open.toFixed(6),
      high: +hi.toFixed(6),
      low: +lo.toFixed(6),
      close: +close.toFixed(6),
      volume: +(20000 * (0.45 + rand()) * (1 + spreadPct * 90)).toFixed(0),
    });
  }
  return candles;
}

/** Resample lower-timeframe candles up by an integer factor (e.g. 60s -> 300s). */
export function resample(candles: Candle[], factor: number): Candle[] {
  if (factor <= 1) return candles;
  const out: Candle[] = [];
  for (let i = 0; i < candles.length; i += factor) {
    const g = candles.slice(i, i + factor);
    out.push({
      time: g[0].time,
      open: g[0].open,
      high: Math.max(...g.map((c) => c.high)),
      low: Math.min(...g.map((c) => c.low)),
      close: g[g.length - 1].close,
      volume: g.reduce((s, c) => s + c.volume, 0),
    });
  }
  return out;
}
