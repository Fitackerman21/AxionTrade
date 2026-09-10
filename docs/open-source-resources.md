# AxionTrade — Open-Source Resources & Reference Projects

> All repos verified on GitHub API (stars, activity, license) as of Sep 2026.
> Goal: gather proven UI patterns, components, and data strategies to build AxionTrade
> (Next.js + TypeScript, multi-asset, live market dashboard, T212-inspired UX).

## 1. ⭐ Headline reference: OpenTerminal

**github.com/ErTasselli/OpenTerminal** — 540⭐ · TypeScript · MIT · active

A **Bloomberg Terminal-style workspace built entirely on free public market data** — no API keys,
no subscriptions, fallback chains per data endpoint. This is the closest match to AxionTrade's needs.

Stack & features worth adopting:
- **Next.js + Express + TypeScript**, `react-grid-layout` widget workspace (drag/resize/persist)
- **⌘K command palette** — global instrument search
- **lightweight-charts** — candles/bars/line/area, 8 timeframes, SMA/EMA/VWAP/BB/RSI/MACD + hover legend
- **Quote panel** (bid/ask/OHLC/mcap/PE/52w range), **news feed** (multi-RSS, deduped)
- **Full-market screener** (sortable every column), **live sector heatmap** (treemap, % change colors)
- **Options chain**, **crypto board** w/ 7d sparklines + dominance, **macro dashboard** (yield curve, VIX)
- **Portfolio tracker** — transactions, avg cost, realized/unrealized P&L (SQLite)
- **Earnings/econ calendar**, near-real-time quotes (1s refresh + flash-on-change), keyboard-first UX

👉 Recommended move: **clone it and run it** as a living UI reference while building AxionTrade.

## 2. Charting libraries (verified)

| Library | Stars | Notes |
|---|---|---|
| **tradingview/lightweight-charts** | 17,226⭐ | The standard. 45KB, canvas, TS, free OSS. Same lib T212-grade UIs use. v5 + 70+ community indicators |
| **klinecharts/KLineChart** | 4,131⭐ | Zero-dep k-line chart, highly customizable, mobile support |

**Pick: lightweight-charts** — matches the T212 aesthetic (clean line/area + candles), perf, and license.

## 3. Component & UI systems

| Repo | Stars | Use for |
|---|---|---|
| **shadcn-ui/ui** | 123,493⭐ | Base component system (Tailwind) — buttons, dialogs, tables, command palette |
| **tremorlabs/tremor** | 3,607⭐ | Ready-made dashboard components (cards, KPIs, charts, sparklines) |

## 4. Full platforms to mine for patterns

| Repo | Stars | Stack | What to steal |
|---|---|---|---|
| **OpenBB-finance/OpenBB** | 72,858⭐ | Python | Data coverage model, widget philosophy (Workspace UX) |
| **maybe-finance/maybe** | 54,282⭐ (archived) | Ruby | *Beautiful* personal-finance UI patterns; still the design benchmark |
| **ccxt/ccxt** | 43,945⭐ | TS/JS | Unified multi-exchange market data (100+ exchanges) — feed layer for crypto side |
| **ghostfolio/ghostfolio** | 9,271⭐ | Angular+NestJS | Portfolio analytics UI, allocation donuts, fire calculator, multi-asset |
| **Superalgos/Superalgos** | 5,648⭐ | JS | Visual charting + paper trading integration patterns |
| **Drakkar-Software/OctoBot** | 6,551⭐ | Python | Clean trading-ops dashboard for exchanges |
| **chrisleekr/binance-trading-bot** | 5,557⭐ | TS | Live dashboard w/ websocket data, dense table layouts |
| **klinecharts** (above) | 4,131⭐ | TS | Alternative chart engine |
| **freqtrade/frequi** | 1,072⭐ | Vue 3 + TS | Trade tables, P&L cards, candle chart integration (Bollinger) |
| **austin-starks/NextTrade** | 1,777⭐ | TS | No-code strategy builder UI; "most advanced OSS trading UI" claim |
| **jkbrzt/cointrol** | 1,457⭐ | Python/DJ | Real-time dashboard, simple clean patterns |
| **Open-Papertrade/Open-Papertrade** | 20⭐ | TS | Fresh paper-trading sim; small but on-topic |

## 5. Data feed strategy for AxionTrade (free → paid ladder)

1. **Crypto:** Binance public websocket (klines/depth, no key) or **ccxt** for uniformity → covers live dashboard
2. **Stocks/ETFs:** OpenTerminal's free endpoint approach (public quote endpoints w/ fallback chains) → zero cost MVP
3. **Forex/commodities/indices:** free proxy tickers (same fallback pattern) initially
4. **Upgrade path:** Polygon.io / Alpaca / TwelveData when we need official licensing + reliability

## 6. Recommended AxionTrade foundation

- **Framework:** Next.js 15 + TypeScript + Tailwind + shadcn/ui
- **Charts:** lightweight-charts v5 (line/area/candle + custom Y-axis labels — per T212 lesson)
- **Layout:** react-grid-layout widget workspace OR fixed T212-style sidebar layout (decide at scaffold)
- **State:** zustand (light) or react-query (server state)
- **Data:** ccxt (crypto) + OpenTerminal-style free endpoints (equities) with fallback chains
- **Simulated paper-trading layer:** in-memory/pg orders + positions (Open-Papertrade/FreqUI as patterns)
- **Design tokens:** from `ui-analysis-trading212.md` §6 (dark-first, #00C896/#F6465D semantics)

## 7. Suggested build order

1. Clone OpenTerminal → run → screenshot/steal layout + data-endpoint fallback patterns
2. Scaffold AxionTrade (Next.js + Tailwind + shadcn + lightweight-charts)
3. Build dashboard shell (sidebar, account value block, watchlist) — T212 spec
4. Wire crypto feed (Binance ws) → live prices + one instrument detail page w/ chart
5. Add equities via free endpoints + screener + heatmap
6. Paper-trading order ticket (Value⇄Qty, sizing pills, cost estimate tabs — T212 CFD flow)
