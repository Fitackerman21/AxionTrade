"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { useLiveQuote } from "@/components/live-prices";
import { INSTRUMENTS, type Instrument } from "@/lib/market-data";
import { AppProviders } from "@/lib/providers";
import {
  createHttpClient,
  createMockClient,
  equityOf,
  HOLD_LATE,
  LATEST_WINDOW,
  LIMITS,
  openContext,
  sideOf,
  STARTING_CASH_USD,
  statsOf,
  stepLoop,
  THRESHOLDS,
  TICK_SECONDS,
  type DecisionClient,
  type JevStats,
  type LoopContext,
  type TickRecord,
  type TickSide,
} from "@/lib/jev-loop";

import styles from "./jev.module.css";

/* ------------------------------------------------------------------ */
/* A recreation, on purpose: same layout, same palette, same            */
/* information as the jev-loop dashboard the PTQ prompt writes to       */
/* ~/.claude/skills/jev-loop/dashboard/index.html.                      */
/* ------------------------------------------------------------------ */

const WINDOW_POINTS = 90; // the prompt's N: how many ticks the chart shows
const FEED_ROWS = 16;
const PAD_RIGHT = 96;
const PAD_BOTTOM = 18;
const SIDE_COLOUR: Record<TickSide, string> = {
  buy: "#1f7a4d",
  sell: "#b91c1c",
  late: "#b7791f",
};

const PICKABLE = ["BTC", "ETH", "SOL", "XRP", "DOGE", "AAPL", "NVDA", "TSLA", "EURUSD", "XAUUSD"];

interface Mode {
  available: boolean;
  route: string;
  model: string;
}

/** Everything the render reads. Refs are never touched during render. */
interface Frame {
  symbol: string;
  ticks: TickRecord[];
  stats: JevStats;
  mode: Mode;
  halted: boolean;
  note: string | null;
  equityUsd: number;
  realizedUsd: number;
  cashUsd: number;
  inventory: number;
  fills: number;
  ready: boolean;
}

/** The spreads the prompt's assets.py sets per asset class. */
function spreadPctFor(kind: Instrument["kind"]): number {
  switch (kind) {
    case "forex":
      return 0.00012;
    case "crypto":
      return 0.00035;
    case "commodity":
      return 0.0004;
    default:
      return 0.0006;
  }
}

function fmtPrice(v: number): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: v >= 1000 ? 1 : 4 });
}

function fmtUsd(v: number): string {
  return `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(3)}`;
}

/** Element size, so the SVG uses real pixels instead of a stretched viewBox. */
function useBoxSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ w: rect.width, h: rect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/* ------------------------------------------------------------------ */
/* The chart — the same step line, grid, per-tick dots and price tag    */
/* the prompt's drawChart() renders                                    */
/* ------------------------------------------------------------------ */

function JevChart({ ticks }: { ticks: TickRecord[] }) {
  const [boxRef, box] = useBoxSize<HTMLDivElement>();
  const W = Math.max(300, box.w || 640);
  const H = Math.max(200, box.h || 260);

  const chart = useMemo(() => {
    const pts = ticks.slice(-WINDOW_POINTS);
    const mids = pts.map((p) => p.mid);
    const lo = mids.length ? Math.min(...mids) : 0;
    const hi = mids.length ? Math.max(...mids) : 0;
    const span = Math.max(hi - lo, lo * 0.0001) || 1;
    const X = (i: number) => (i * (W - PAD_RIGHT)) / (WINDOW_POINTS - 1);
    const Y = (v: number) => 12 + (H - PAD_BOTTOM - 24) * (1 - (v - lo) / span);
    const off = WINDOW_POINTS - pts.length;

    let d = "";
    pts.forEach((p, i) => {
      const x = X(i + off).toFixed(1);
      const y = Y(p.mid).toFixed(1);
      d += d ? ` H${x} V${y}` : `M${x} ${y}`;
    });

    const grid = [0, 1, 2, 3].map((k) => {
      const v = lo + (span * k) / 3;
      return { v, y: Y(v) };
    });

    const dots = pts.map((p, i) => ({
      key: `${p.tick}-${i}`,
      cx: X(i + off),
      cy: Y(p.mid),
      fill: SIDE_COLOUR[sideOf(p)],
    }));

    const last = pts[pts.length - 1];
    return {
      points: pts.length,
      d,
      grid,
      dots,
      area: pts.length ? `${d} V${H - PAD_BOTTOM} H${X(off)} Z` : "",
      lastX: X(WINDOW_POINTS - 1),
      lastY: last ? Y(last.mid) : 0,
      lastMid: last ? last.mid : 0,
      lastFill: last ? SIDE_COLOUR[sideOf(last)] : "#999",
    };
  }, [ticks, W, H]);

  return (
    <div className={styles.chart} ref={boxRef}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label="Mid price, one point per tick"
      >
        <defs>
          <linearGradient id="jevArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="rgba(10,140,255,.16)" />
            <stop offset="1" stopColor="rgba(10,140,255,0)" />
          </linearGradient>
        </defs>

        {chart.grid.map((g) => (
          <g key={g.y}>
            <line
              x1={0}
              x2={W - PAD_RIGHT}
              y1={g.y}
              y2={g.y}
              stroke="rgba(11,11,16,.08)"
              strokeDasharray="3 4"
            />
            <text className={styles.axis} x={W - PAD_RIGHT + 8} y={g.y + 4}>
              {g.v.toFixed(1)}
            </text>
          </g>
        ))}

        {chart.points > 1 && (
          <>
            <path d={chart.area} fill="url(#jevArea)" />
            <path d={chart.d} fill="none" stroke="#0b0b10" strokeWidth={1.6} />
          </>
        )}

        {chart.dots.map((dot) => (
          <circle key={dot.key} cx={dot.cx} cy={dot.cy} r={3.4} fill={dot.fill} opacity={0.9} />
        ))}

        {chart.points > 0 && (
          <>
            <line
              x1={chart.lastX}
              x2={chart.lastX}
              y1={chart.lastY}
              y2={H - PAD_BOTTOM}
              stroke="rgba(11,11,16,.25)"
              strokeDasharray="2 3"
            />
            <circle
              cx={chart.lastX}
              cy={chart.lastY}
              r={6}
              fill={chart.lastFill}
              stroke="#fff"
              strokeWidth={2}
            />
            <rect
              x={chart.lastX + 10}
              y={chart.lastY - 12}
              rx={11}
              width={78}
              height={24}
              fill="#0b0b10"
            />
            <text className={styles.tag} x={chart.lastX + 16} y={chart.lastY + 4} fill="#fff">
              {fmtPrice(chart.lastMid)}
            </text>
          </>
        )}
      </svg>

      {chart.points === 0 && (
        <p className={styles.note}>
          No ticks yet. The dashboard reads the loop&apos;s real output and stays honestly empty
          until the first one lands — nothing here is pre-filled.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The loop, running in the tab                                        */
/* ------------------------------------------------------------------ */

function JevLoop({ symbol, onSymbol }: { symbol: string; onSymbol: (s: string) => void }) {
  const inst = INSTRUMENTS.find((i) => i.symbol === symbol) ?? INSTRUMENTS[0];
  const quote = useLiveQuote(symbol);

  const [frame, setFrame] = useState<Frame | null>(null);
  const [halted, setHalted] = useState(false);

  const priceRef = useRef<number>(inst.price);
  const ctxRef = useRef<LoopContext | null>(null);
  const ticksRef = useRef<TickRecord[]>([]);
  const startedAtRef = useRef<number>(0);
  const modeRef = useRef<Mode>({ available: false, route: "MOCK", model: "mock-jev-0.1" });
  const noteRef = useRef<string | null>(null);
  const haltedRef = useRef(false);
  const apiErrorsRef = useRef(0);
  const inFlightRef = useRef(false);
  const mockRef = useRef<DecisionClient | null>(null);
  const clientRef = useRef<DecisionClient | null>(null);

  /* refs are only ever written inside effects and callbacks, never in render */
  useEffect(() => {
    if (!mockRef.current) mockRef.current = createMockClient(1 + symbol.length);
    if (!clientRef.current) clientRef.current = mockRef.current;
    if (!ctxRef.current) ctxRef.current = openContext(symbol, priceRef.current);
    if (!startedAtRef.current) startedAtRef.current = Date.now();
  }, [symbol]);

  /* the live price is read at tick time, never during render */
  useEffect(() => {
    if (quote) priceRef.current = quote.price;
  }, [quote]);

  /* one probe for a decision key; without one the labelled mock runs the
     battery, and the page says MOCK rather than pretending otherwise */
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/jev", { cache: "no-store" });
        const data = (await res.json()) as { available?: boolean; route?: string; model?: string };
        if (!alive) return;
        if (data.available) {
          clientRef.current = createHttpClient();
          modeRef.current = {
            available: true,
            route: data.route ?? "TYPESAFE",
            model: data.model ?? "jev-latest",
          };
        } else {
          modeRef.current = { available: false, route: "MOCK", model: "mock-jev-0.1" };
        }
      } catch {
        if (alive) modeRef.current = { available: false, route: "MOCK", model: "mock-jev-0.1" };
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const buildFrame = useCallback((): Frame => {
    const ticks = ticksRef.current;
    const ctx = ctxRef.current;
    const mid = priceRef.current;
    return {
      symbol,
      ticks,
      stats: statsOf(ticks, startedAtRef.current || Date.now(), Date.now()),
      mode: modeRef.current,
      halted: haltedRef.current,
      note: noteRef.current,
      equityUsd: ctx ? equityOf(ctx.account, mid) : STARTING_CASH_USD,
      realizedUsd: ctx ? ctx.account.realized : 0,
      cashUsd: ctx ? ctx.account.cash : STARTING_CASH_USD,
      inventory: ctx ? ctx.account.inventory : 0,
      fills: ctx ? ctx.account.fills.length : 0,
      ready: ctx !== null && ticksRef.current !== null,
    };
  }, [symbol]);

  const doTick = useCallback(
    async (manual?: "buy" | "sell") => {
      const ctx = ctxRef.current;
      const mid = priceRef.current;
      const client = clientRef.current;
      if (!ctx || !client || !Number.isFinite(mid) || mid <= 0) {
        // say why rather than sitting silent
        noteRef.current = `cannot tick yet — ${!ctx ? "state engine not ready" : ""}${
          !client ? " no decision client" : ""
        }${!(Number.isFinite(mid) && mid > 0) ? ` bad price (${mid})` : ""}`.trim();
        setFrame(buildFrame());
        return;
      }
      if (inFlightRef.current) return;
      if (haltedRef.current && !manual) return;
      inFlightRef.current = true;
      try {
        const spreadPct = spreadPctFor(inst.kind);
        const half = (mid * spreadPct) / 2;
        const bid = mid - half;
        const ask = mid + half;

        // the state Jev sees: computed here, in code, never asked of a model
        const state = {
          symbol,
          mid,
          bid,
          ask,
          spreadBps: ((ask - bid) / mid) * 10000,
          imbalance: ctx.imbalance,
          vwap: ctx.vwap,
          inventory: ctx.account.inventory,
          equityUsd: equityOf(ctx.account, mid),
          fillRatio: ctx.fillRatio,
          rejectCount: ctx.rejectCount,
          last10LatenciesMs: ctx.latencies,
          last10SlippageBps: ctx.slippagesBps,
          ticksCompleted: ctx.tick,
        };

        let answers = null;
        let meta = null;
        let jevDown = false;

        if (modeRef.current.available) {
          try {
            const res = await client.ask(state);
            answers = res.answers;
            meta = res.meta;
            apiErrorsRef.current = 0;
          } catch {
            // the ladder's RULES_ONLY rung: no model, no guessing
            jevDown = true;
            apiErrorsRef.current += 1;
          }
        } else {
          const res = await client.ask(state);
          answers = res.answers;
          meta = res.meta;
        }

        const out = stepLoop({
          ctx,
          mid,
          bid,
          ask,
          ts: Date.now(),
          answers,
          meta,
          jevDown,
          dataAgeS: 0,
          apiErrors: apiErrorsRef.current,
          manual,
        });

        ctxRef.current = out.ctx;
        ticksRef.current = [...ticksRef.current, out.record].slice(-LATEST_WINDOW);

        if (out.killed) {
          haltedRef.current = true;
          noteRef.current =
            "KILL rung: a hard limit was breached, so the loop flattened the book and stopped.";
          setHalted(true);
        } else if (manual && out.record.risk_veto) {
          noteRef.current = `vetoed by the risk engine: ${out.record.risk_veto}`;
        } else if (manual) {
          noteRef.current = null;
        }

        setFrame(buildFrame());
      } catch (error) {
        // never fail silently: whatever went wrong goes on the page
        noteRef.current = `loop error: ${
          error instanceof Error ? error.message : String(error)
        }`;
        setFrame(buildFrame());
      } finally {
        inFlightRef.current = false;
      }
    },
    [buildFrame, inst.kind, symbol],
  );

  /* one tick every tick_seconds, plus a 1s read of the log — the same shape as
     the prompt's dashboard polling latest.json */
  useEffect(() => {
    const firstTick = setTimeout(() => void doTick(), 400);
    const tickTimer = setInterval(() => void doTick(), TICK_SECONDS * 1000);
    const readTimer = setInterval(() => setFrame(buildFrame()), 1000);
    return () => {
      clearTimeout(firstTick);
      clearInterval(tickTimer);
      clearInterval(readTimer);
    };
  }, [buildFrame, doTick]);

  const reset = useCallback(() => {
    ctxRef.current = openContext(symbol, priceRef.current);
    ticksRef.current = [];
    startedAtRef.current = Date.now();
    haltedRef.current = false;
    apiErrorsRef.current = 0;
    noteRef.current = null;
    setHalted(false);
    setFrame(buildFrame());
  }, [buildFrame, symbol]);

  const ticks = useMemo(() => frame?.ticks ?? [], [frame]);
  const last = ticks[ticks.length - 1];
  const stats = frame?.stats;
  const side: TickSide = last ? sideOf(last) : "late";
  const label = !last
    ? "—"
    : side === "late"
      ? last.action.startsWith(HOLD_LATE)
        ? "LATE"
        : last.action.split(" ")[0]
      : side.toUpperCase();
  const decisionClient = stats?.decision_client ?? frame?.mode.route ?? "MOCK";
  const isMock = decisionClient.toUpperCase() === "MOCK";
  const displayPrice = last ? last.mid : (quote?.price ?? inst.price);

  const bars = useMemo(() => {
    const out: Array<TickSide | null> = [];
    for (let i = 0; i < WINDOW_POINTS; i++) {
      const t = ticks[ticks.length - WINDOW_POINTS + i];
      out.push(t ? sideOf(t) : null);
    }
    return out;
  }, [ticks]);

  const envPct = last ? Math.min(100, (last.quote_environment / 3) * 100) : 0;
  const toxPct = last ? last.toxic_flow * 100 : 0;

  return (
    <div className={styles.page}>
      <div className={styles.frame}>
        <header className={styles.header}>
          <div className={styles.brand}>
            <b>Axion</b>
            <i>Jev loop</i>
          </div>
          <span className={styles.block}>
            tick <span>{last ? last.tick.toLocaleString() : "—"}</span>
          </span>
          <div className={styles.pills}>
            <span className={`${styles.pill} ${isMock ? styles.mock : styles.live}`}>
              <span className={styles.dot} />
              {isMock ? "MOCK battery · paper only" : `paper · ${decisionClient.toLowerCase()}`}
            </span>
            <select
              className={styles.symbol}
              value={symbol}
              onChange={(e) => onSymbol(e.target.value)}
              aria-label="Instrument"
            >
              {PICKABLE.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <span className={`${styles.pill} ${styles.blue}`}>
              {stats?.model && stats.model !== "—" ? stats.model : frame?.mode.model ?? "mock-jev-0.1"}
            </span>
            {halted && (
              <button className={`${styles.pill} ${styles.off}`} onClick={reset}>
                halted · reset
              </button>
            )}
            <Link className={styles.hostlink} href="/trade">
              ← terminal
            </Link>
          </div>
        </header>

        <div className={styles.stats}>
          <span>
            last <b>{last?.latency_ms ? `${Math.round(last.latency_ms)} ms` : "—"}</b>
          </span>
          <span>
            avg <b>{stats?.avg_ms ? `${Math.round(stats.avg_ms)} ms` : "—"}</b>
          </span>
          <span>
            <b>{stats?.calls.toLocaleString() ?? 0}</b> decisions
          </span>
          <span>
            late <b>{stats?.late_count ?? 0}</b>
          </span>
          <span>
            fills <b>{frame?.fills ?? 0}</b>
          </span>
          <span>
            equity <b>${(frame?.equityUsd ?? STARTING_CASH_USD).toFixed(2)}</b>
          </span>
          <span>
            realized <b>{fmtUsd(frame?.realizedUsd ?? 0)}</b>
          </span>
          <span className={styles.right}>
            uptime{" "}
            <b>
              {[3600, 60, 1]
                .map((unit) =>
                  String(Math.floor((stats?.uptime_s ?? 0) / unit) % 60).padStart(2, "0"),
                )
                .join(":")}
            </b>
          </span>
        </div>

        <div className={styles.grid}>
          {/* left — price, the battery's verdict, the chart, the strip */}
          <section className={`${styles.card} ${styles.left}`}>
            <div className={styles.pricebar}>
              <div>
                <div className={styles.price}>{fmtPrice(displayPrice)}</div>
                <div className={styles.sub}>
                  <span>
                    {!last || last.inventory === 0
                      ? "flat"
                      : `${last.inventory > 0 ? "long" : "short"} ${Math.abs(last.inventory).toFixed(6)}`}
                  </span>
                  <span
                    className={`${styles.pnl} ${
                      (last?.unrealised_pnl_usd ?? 0) >= 0 ? styles.pos : styles.neg
                    }`}
                  >
                    p&amp;l {fmtUsd(last?.unrealised_pnl_usd ?? 0)} (
                    {((last?.drawdown_pct ?? 0) * 100).toFixed(2)}% dd)
                  </span>
                  <span>spread {last ? last.spread_bps.toFixed(1) : "—"} bps</span>
                  <span>
                    quotes{" "}
                    {last?.quote_bid !== null && last?.quote_bid !== undefined
                      ? `${fmtPrice(last.quote_bid)} / ${fmtPrice(last.quote_ask ?? 0)}`
                      : "—"}
                  </span>
                </div>
              </div>
              <div className={styles.verdict}>
                <div
                  className={`${styles.act} ${
                    side === "buy" ? styles.buy : side === "sell" ? styles.sell : styles.late
                  }`}
                >
                  {last ? last.action : "—"}
                </div>
                <div className={styles.meta}>
                  <span>{last?.latency_ms ? `${Math.round(last.latency_ms)} ms` : "late"}</span> ·{" "}
                  <span>{last?.action_reason ?? "—"}</span>
                </div>
              </div>
            </div>

            <div className={styles.snap}>
              <span className={styles.k}>route</span>
              <span>
                <b>{last?.route ?? "—"}</b>
              </span>
              <span className={styles.k}>regime</span>
              <span>
                <b>
                  {last?.regime ?? "—"} {last ? `${Math.round(last.regime_conf * 100)}%` : ""}
                </b>
              </span>
              <span className={styles.k}>direction</span>
              <span>
                <b>
                  {last?.direction ?? "—"} {last ? `${Math.round(last.direction_conf * 100)}%` : ""}
                </b>
              </span>
              <span className={styles.k}>toxic</span>
              <span>
                <b>{last ? last.toxic_flow.toFixed(2) : "—"}</b>
              </span>
              <span className={styles.k}>liquidity stress</span>
              <span>
                <b>{last ? last.liquidity_stressed.toFixed(2) : "—"}</b>
              </span>
              <span className={styles.k}>env</span>
              <span>
                <b>{last ? last.quote_environment.toFixed(2) : "—"}</b>
              </span>
              <span className={styles.k}>inv pressure</span>
              <span>
                <b>{last ? last.inventory_pressure.toFixed(2) : "—"}</b>
              </span>
              <span className={styles.k}>execution health</span>
              <span>
                <b>{last ? last.execution_health.toFixed(2) : "—"}</b>
              </span>
              <span className={styles.k}>vwap</span>
              <span>
                <b>{last ? fmtPrice(last.vwap) : "—"}</b>
              </span>
              <span className={styles.k}>rung</span>
              <span>
                <b>{last?.rung ?? "—"}</b>
              </span>
              <span className={styles.k}>skew</span>
              <span>
                <b>{last ? last.skew.toFixed(2) : "—"}</b>
              </span>
            </div>

            <JevChart ticks={ticks} />

            {/* the heartbeat — if this reads zero, the loop is not ticking */}
            <div className={styles.status}>
              <span>
                loop <b>{halted ? "halted" : "running"}</b>
              </span>
              <span>
                state <b>{frame?.ready ? "ready" : "starting"}</b>
              </span>
              <span>
                ticks <b>{ticks.length}</b>
              </span>
              <span>
                client <b>{isMock ? "mock" : decisionClient.toLowerCase()}</b>
              </span>
              <span>
                fills <b>{frame?.fills ?? 0}</b>
              </span>
              <span>
                cadence <b>{TICK_SECONDS}s</b>
              </span>
              <span>
                price feed <b>{quote ? "live" : "baseline"}</b>
              </span>
            </div>

            <div className={styles.strip}>
              {bars.map((s, i) => (
                <i key={i} className={s ? styles[s] : undefined} />
              ))}
            </div>

            <div className={styles.foot}>
              <span>one dot per tick · green buy · red sell · amber late/hold</span>
              <span>
                {TICK_SECONDS}s ticks · one decision per tick · {ticks.length} in the window
              </span>
            </div>
          </section>

          {/* right — the standing order, the battery, the hand on the wheel, the feed */}
          <div className={styles.rcol}>
            <section className={styles.card}>
              <div className={styles.eyebrow}>Standing order</div>
              <div className={styles.order}>
                &gt; quote both sides around Avellaneda-Stoikov pricing every tick. take a small
                directional leg when Jev&apos;s direction judgment clears conf{" "}
                {THRESHOLDS.directionConfidenceThreshold.toFixed(2)}. pull quotes over toxic{" "}
                {THRESHOLDS.toxicFlowPullThreshold.toFixed(2)}, widen over stress{" "}
                {THRESHOLDS.liquidityStressedWidenThreshold.toFixed(2)}, quote both sides only at
                env ≥ {THRESHOLDS.quoteEnvFullScore.toFixed(1)} and conf &gt;{" "}
                {THRESHOLDS.quoteEnvFullConfidence.toFixed(2)}. hold when late. paper only, and the
                nine hard limits always get the last word.
              </div>
            </section>

            <section
              className={`${styles.card} ${styles.battery} ${
                side === "buy" ? styles.buy : side === "sell" ? styles.sell : styles.late
              }`}
            >
              <span key={last?.tick ?? "seed"} className={`${styles.flash} ${styles.go}`} />
              <div className={styles.eyebrow}>Battery this tick</div>
              <div className={styles.big}>
                <span key={label} className={`${styles.word} ${styles.flip}`}>
                  {label}
                </span>
                <span className={styles.pct}>
                  {last ? `${Math.round(last.quote_environment_conf * 100)}%` : ""}
                </span>
              </div>
              <div className={styles.bars}>
                <div className={`${styles.brow} ${styles.buy}`}>
                  <span className={styles.lbl}>env</span>
                  <div className={styles.bar}>
                    <span style={{ width: `${envPct}%` }} />
                  </div>
                  <span className={styles.v}>
                    {last ? `${last.quote_environment.toFixed(1)}/3` : "—"}
                  </span>
                </div>
                <div className={`${styles.brow} ${styles.sell}`}>
                  <span className={styles.lbl}>tox</span>
                  <div className={styles.bar}>
                    <span style={{ width: `${toxPct}%` }} />
                  </div>
                  <span className={styles.v}>{last ? last.toxic_flow.toFixed(2) : "—"}</span>
                </div>
              </div>
            </section>

            <section className={styles.card}>
              <div className={styles.eyebrow}>Paper order</div>
              <div className={styles.trade}>
                <button className={styles.buyBtn} onClick={() => void doTick("buy")} disabled={halted}>
                  Buy
                </button>
                <button className={styles.sellBtn} onClick={() => void doTick("sell")} disabled={halted}>
                  Sell
                </button>
              </div>
              <button className={styles.flatten} onClick={reset}>
                Reset paper account
              </button>
              <p className={styles.note}>
                ${LIMITS.maxOrderNotionalUsd.toFixed(0)} per order, max position $
                {LIMITS.maxPositionUsd.toFixed(0)}, max daily loss ${LIMITS.maxDailyLossUsd.toFixed(0)},{" "}
                {LIMITS.maxLeverage.toFixed(0)}× leverage — the prompt&apos;s hard caps, wired in
                here as they are in risk.py, so a hand-placed order is refused exactly the way an
                automated one is.
              </p>
              {frame?.note && <p className={styles.veto}>{frame.note}</p>}
            </section>

            <section className={`${styles.card} ${styles.feed}`}>
              <div className={styles.eyebrow}>Feed</div>
              <table>
                <tbody>
                  {[...ticks]
                    .reverse()
                    .slice(0, FEED_ROWS)
                    .map((t, i) => {
                      const s = sideOf(t);
                      const fill = t.fill_qty
                        ? `${t.fill_qty.toFixed(6)} @ ${fmtPrice(t.fill_price ?? 0)}`
                        : "—";
                      return (
                        <tr
                          key={t.tick}
                          className={
                            s === "buy" ? styles.buy : s === "sell" ? styles.sell : styles.late
                          }
                          style={{ opacity: 1 - i * 0.03 }}
                        >
                          <td>{t.tick}</td>
                          <td className={styles.a}>
                            {s === "late"
                              ? t.action.startsWith(HOLD_LATE)
                                ? "LATE"
                                : t.action
                              : s.toUpperCase()}
                          </td>
                          <td>conf {t.quote_environment_conf.toFixed(2)}</td>
                          <td>{t.latency_ms ? `${Math.round(t.latency_ms)}ms` : "late"}</td>
                          <td>{fill}</td>
                          <td>paper</td>
                        </tr>
                      );
                    })}
                  {ticks.length === 0 && (
                    <tr>
                      <td colSpan={6}>waiting for the first tick…</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function JevPage() {
  const [symbol, setSymbol] = useState("BTC");
  return (
    <AppProviders>
      {/* keyed by symbol, so switching instruments resets the paper book */}
      <JevLoop key={symbol} symbol={symbol} onSymbol={setSymbol} />
    </AppProviders>
  );
}
