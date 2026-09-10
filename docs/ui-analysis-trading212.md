# AxionTrade — UI Analysis: Trading 212 Web App

> Source basis: the live app (app.trading212.com) WAF-blocks this server's IP, so analysis is built
> from **Trading 212's official announcement posts** ("What's New", which contain their own product
> screenshots), press coverage with embedded app screenshots (FinanceMagnates), and community
> threads. All screenshots are saved in `docs/screenshots/` for visual reference.

## 0. Screenshot evidence (real UI, verified)

| File | Shows | Source |
|---|---|---|
| `official-home-hometab-full.jpeg` | Full Home screen: account value + 24h performance, widgets, watchlist | T212 official (Sep 2025) |
| `official-home-widgets.png` | Investments widget (portfolio value + intraday 24h chart), Main pot & Spending pot widgets | T212 official |
| `official-home-allowance-isa.png` | ISA Allowance widget variant | T212 official |
| `official-home-watchlist.png` | Watchlist section: lists + instrument rows with 15-min mini charts | T212 official |
| `user-desktop-homescreen.png` | Real user's desktop home screen (community post) | Community |
| `official-cfd-actionbutton.png` | Order screen: Value/Quantity toggle button | T212 official (Nov 2025) |
| `official-cfd-trailing-sl.png` | Full order screen w/ limit/stop/percent + trailing stop | T212 official |
| `official-cfd-sizing-pills.png` | 25% / 50% / 75% / 100% quick-sizing pills (of free funds) | T212 official |
| `official-cfd-order-details-tab.png` | "Order details" tab: overnight interest, position estimates | T212 official |
| `official-cfd-closing-costs-tab.png` | "Closing costs" tab: closing spread, FX fee, total cost | T212 official |
| `press-portfolio-redesign-1..3.webp` | Dec 2025 portfolio bubble-card redesign (rolled back Jan 2026) | Press (FinanceMagnates) |

**Coverage:** Home ✅ · Watchlist ✅ · Order ticket ✅ (detailed) · Portfolio/redesign ✅ (press)
**Not covered (no screenshot yet):** Pies detail view, Advanced view, instrument detail page.
These are v2+ scope for AxionTrade; refine if/when the owner shares demo-account screenshots.

## 1. App map (what the product consists of)

```
app.trading212.com
├── Home / Dashboard          — account overview, portfolio value chart, quick actions, news
├── Portfolio / Investments   — holdings list, heatmap, pies, orders (pending/history)
├── Pies                      — auto-invest portfolios (pie chart of allocations, drag & drop)
├── CFD section               — separate trading environment: forex, commodities, indices
│   └── Order screen          — redesigned order ticket (buy/sell, SL/TP)
├── Watchlists                — instrument lists with sparklines
├── News                      — in-app feed
└── Settings / Account        — theme (dark/light), personal details, tax wrappers (ISA/SIPP)
```

Desktop also has an **"Advanced view"** — a denser, more traditional trading layout with deeper
charting; community consensus says it's the best part of the web app.

## 2. Layout structure (desktop, current gen)

- **Left sidebar** — primary navigation (Home, Portfolio, Pies, CFDs, Watchlist, News, Settings).
- **Main canvas** — dashboard widgets ("bubble-style cards"): portfolio value chart, cash balance,
  allocation, market movers, news.
- **Pull-up / slide-over panels** — portfolio details, order ticket, instrument detail. (Controversial — see §5.)
- **Bottom bar (mobile-ish) / persistent footer** — account value, cash, quick deposit.

## 3. Visual design language (the part worth emulating)

- **Theme:** dark-first (near-black background, elevated dark cards), with light mode that users can
  actually set (T212 broke this and got flak — we must respect it).
- **Cards:** large border radius (~16-24px), generous padding, subtle borders instead of heavy shadows.
- **Typography:** clean sans-serif (Inter-like); big prominent portfolio value; small muted labels.
- **Color semantics:** green = gain/buy, red = loss/sell; neutral grays for secondary data.
- **Charts:** minimal area/line sparklines per instrument; big portfolio chart; heatmap of holdings;
  Y-axis labels on anything meaningful.
- **Interactions:** smooth transitions, skeleton loaders, tap-friendly order ticket.

## 4. Verified behavior details (from official announcements)

### Home screen (Sep 2025 redesign — current baseline)
- **Account value block**: total value incl. investments + free funds, plus 24h performance (abs + %).
- **Widgets row**: Investments widget (portfolio value + intraday 24h chart) on the left;
  Main pot (free funds) and Spending pot (card cash) on the right; tap to expand.
  In ISA accounts the Allowance widget replaces the Spending pot.
- **Watchlist**: bottom of screen, horizontally scrollable lists; each row has a **15-minute line
  chart for the last 24h** as its mini chart; swipe up to expand full-screen; reorder lists in edit menu.
- **Criticism to avoid**: web width capped (~776px) making watchlists cramped on desktop;
  mixed dark/light halves; no chart timeframe labels visible; no privacy mode for account value.
- Desktop **Advanced view** exists as the denser alternative (watchlists along the top).

### Order ticket (CFD, Nov 2025 redesign — most refined flow in the product)
- **Value ⇄ Quantity** dedicated toggle button (value is default).
- All pending order types visible on one screen (no separate Limit/Stop tab).
- **Change % switch**: enter limit/stop levels as percent instead of price.
- **Trailing stop** attachable when opening a position.
- **Sizing pills**: 25% / 50% / 75% of free funds as margin; 100% uses 98% (2% buffer).
  Pills close % of position when reducing/hedging.
- **"Order details" tab**: upfront estimates incl. **overnight interest** per day.
- **"Closing costs" tab**: closing spread + FX fee + total cost to exit.
- Opposite-side (hedge) orders are auto-funded by offsetting the current position first.

### Portfolio (learn from the failed Dec 2025 redesign — rolled back Jan 2026)
- What failed: bubble cards, holdings behind a pull-up + search bar, no Y-axis on the value chart,
  pending orders stripped of cash amounts and instrument links, mixed themes, wasted space.
- What survived / what users demand: **dense sortable list of holdings** (by value/name/P/L),
  heatmap available as a view, pie overview, chart with labeled axes, one-click access to instruments.

| Component | Description |
|---|---|
| `SidebarNav` | Collapsible left sidebar, icons + labels, active-state highlight |
| `PortfolioValueChart` | Big line/area chart with **visible Y-axis**, timeframe switcher (1D 1W 1M 1Y All) |
| `BalanceCards` | Cash, invested, total value, day change (% and absolute) |
| `HoldingsList` | Dense sortable table: instrument, qty, avg price, current, P/L, sparkline |
| `HoldingsHeatmap` | Treemap of allocation, hover details, click → instrument |
| `InstrumentRow` | Logo, name, ticker, price, day %, sparkline — used everywhere |
| `OrderTicket` | Buy/Sell tabs, market/limit/stop, qty vs value toggle, SL/TP (CFD), estimated cost, confirm step |
| `OrderBook/Depth` (stretch) | For the exchange-style side |
| `Sparkline` | Tiny inline chart component |
| `Watchlist` | Groups of `InstrumentRow`s, add/remove |
| `PieVisualization` | Donut chart of allocations with editable slices |
| `NewsFeed` | Timestamped cards, filterable |
| `Search` | Global instrument search with instant results (T212 does this well) |

## 5. What users HATE about T212 (Dec 2025 redesign backlash) — our rules

The Dec 2025 redesign caused a revolt and was rolled back in January. Take these as hard constraints:

1. **No hiding core info behind extra clicks.** Portfolio holdings must be visible immediately —
   no pull-up-tab-first design. (T212: "portfolio hidden behind search bar / pull-up menu".)
2. **Charts must have Y-axis numbers.** "Who creates charts without a Y-axis?"
3. **Don't waste space on decorative chrome.** Borders/padding/gaps ate more room than content —
   "small islands of information surrounded by empty space". Denser > prettier.
4. **Respect the user's theme choice** everywhere; never mix forced-dark and light sections.
5. **Pending orders must be actionable:** clickable → instrument page, show reserved cash amount.
6. **Keep data-rich list views as the default**, fancy visualizations (heatmap, pies) as views/tabs
   *on the same data*, not replacements.
7. **Don't break deep links** / instrument context from orders, alerts, lists.
8. Ship major redesigns behind an opt-in beta; keep a "classic/compact" density option.

## 6. AxionTrade design tokens (initial proposal)

```
Background:        #0B0E11 (near-black)   Surface: #14171C   Border: #23272F
Text primary:      #EAECEF   Secondary: #868E96
Accent/Buy/Gain:   #00C896 (green)        Sell/Loss: #F6465D (red)
Brand:             AxionTrade blue/teal (TBD)
Radius:            12px cards, 8px controls
Font:              Inter (400/500/600)
Chart palette:     green/red + neutral grays; gridlines barely visible
```

(Tokens chosen to evoke the same modern dark trading aesthetic without copying any proprietary assets.)

## 7. Open questions for the owner

- [x] Real UI evidence gathered — official screenshots in `docs/screenshots/` (see §0)
- [ ] Light mode required at launch, or dark-only v1?
- [x] Markets: multi-asset, market-agnostic design (owner decision)
- [ ] Data feed for live prices (CoinGecko/Polygon/Alpaca…) — decide before wiring the dashboard
- [ ] GitHub repo + Vercel setup (owner was creating these)
