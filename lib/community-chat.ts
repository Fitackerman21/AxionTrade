/**
 * Hardcoded demo conversation for the Axion community chat.
 * Ten personas with distinct voices; rendered by components/community-chat.tsx.
 * Purely static — no backend, no live data.
 */

export interface ChatPersona {
  id: string;
  name: string;
  role: string;
  /** avatar gradient stops */
  g1: string;
  g2: string;
  /** name colour in the chat */
  color: string;
  online: boolean;
  bot?: boolean;
}

export const PERSONAS: ChatPersona[] = [
  {
    id: "jev",
    name: "Jev",
    role: "AxAI engine · online 24/7",
    g1: "#2e90fa",
    g2: "#00c896",
    color: "#9fc6ff",
    online: true,
    bot: true,
  },
  {
    id: "mara",
    name: "Mara Okafor",
    role: "Swing trader · Lagos",
    g1: "#f6465d",
    g2: "#f97316",
    color: "#fda4af",
    online: true,
  },
  {
    id: "dmitri",
    name: "Dmitri V.",
    role: "Macro · Frankfurt",
    g1: "#8b5cf6",
    g2: "#6366f1",
    color: "#c4b5fd",
    online: false,
  },
  {
    id: "sol",
    name: "Solene",
    role: "Crypto degen · Paris",
    g1: "#00c896",
    g2: "#14b8a6",
    color: "#5eead4",
    online: true,
  },
  {
    id: "toko",
    name: "Toko_92",
    role: "Scalper · Tokyo",
    g1: "#f59e0b",
    g2: "#ef4444",
    color: "#fcd34d",
    online: true,
  },
  {
    id: "priya",
    name: "Priya Raman",
    role: "Equities · Singapore",
    g1: "#ec4899",
    g2: "#8b5cf6",
    color: "#f9a8d4",
    online: false,
  },
  {
    id: "kofi",
    name: "Kofi A.",
    role: "FX · Accra",
    g1: "#22d3ee",
    g2: "#2e90fa",
    color: "#67e8f9",
    online: true,
  },
  {
    id: "lena",
    name: "Lena M.",
    role: "ETF & funds · Toronto",
    g1: "#84cc16",
    g2: "#22c55e",
    color: "#bef264",
    online: false,
  },
  {
    id: "raul",
    name: "Raúl",
    role: "Commodities · Bogotá",
    g1: "#fb7185",
    g2: "#f59e0b",
    color: "#fda4af",
    online: false,
  },
  {
    id: "nadia",
    name: "Nadia K.",
    role: "Risk desk · Dubai",
    g1: "#64748b",
    g2: "#334155",
    color: "#cbd5e1",
    online: true,
  },
];

export interface ChatMessage {
  id: number;
  /** sender persona id */
  from: string;
  /** minutes after the previous message (for timestamps) */
  gapMin: number;
  text: string;
  /** optional ticker sticker rendered above the bubble */
  ticker?: string;
}

export const MESSAGES: ChatMessage[] = [
  { id: 1, from: "jev", gapMin: 0, text: "Good morning everyone. AxAI session started — planning cycle loaded, 4h horizon, conviction band 50–96%." },
  { id: 2, from: "mara", gapMin: 2, text: "Morning room 🔋 anyone watching gold here? It's been coiling all week." },
  { id: 3, from: "raul", gapMin: 4, text: "Gold, silver, copper — the whole metals complex is coiling. Waiting on the dollar to pick a side." },
  { id: 4, from: "sol", gapMin: 1, text: "meanwhile BTC is doing BTC things 😂 grinding up 2% while everyone is asleep" },
  { id: 5, from: "jev", gapMin: 3, text: "BTC read: short-term structure still long. Book conviction 62% — not enough to press, enough to hold.", ticker: "BTC" },
  { id: 6, from: "toko", gapMin: 5, text: "Nikkei futures gap up on the open. Scalping the first 30 min only, then I'm hands off." },
  { id: 7, from: "priya", gapMin: 8, text: "Singapore open was quiet. Tech earnings this week will set the tone — my book is hedged until then." },
  { id: 8, from: "kofi", gapMin: 6, text: "cable looks heavy into London. if 1.2610 gives way I'm short with a tight stop", ticker: "GBPUSD" },
  { id: 9, from: "nadia", gapMin: 7, text: "Reminder from the risk desk: it's NFP week. Half size until Friday, no matter how good the setup looks." },
  { id: 10, from: "mara", gapMin: 4, text: "The discipline queen has spoken 👑 half size it is." },
  { id: 11, from: "dmitri", gapMin: 12, text: "Bund spread widening again. Macro funds are positioning for the hawkish scenario — keep that in your filter." },
  { id: 12, from: "sol", gapMin: 3, text: "SOL governance vote passed, chart barely moved. Market doesn't care, noted 📝", ticker: "SOL" },
  { id: 13, from: "jev", gapMin: 5, text: "Fill logged: AxAI went LONG XAU at 2,391.4, conviction 74%. Stop structure shared in the terminal.", ticker: "XAU" },
  { id: 14, from: "lena", gapMin: 9, text: "Nice. My ETF flows screen still shows outflows from gold funds though — interesting divergence with price." },
  { id: 15, from: "raul", gapMin: 2, text: "Divergences like that usually resolve in price's favour. Flows lag." },
  { id: 16, from: "toko", gapMin: 11, text: "Took 3 quick scalps on the Nikkei open, 2/3 green. Small but green. That's the game 🎯" },
  { id: 17, from: "kofi", gapMin: 6, text: "cable tapped 1.2612 and bounced. my level lives another day 😅" },
  { id: 18, from: "priya", gapMin: 14, text: "Anyone have a good read on semis? NVDA earnings spillover is my only concern for the week." },
  { id: 19, from: "dmitri", gapMin: 4, text: "Semis = the macro trade right now. Everything else is noise around it." },
  { id: 20, from: "nadia", gapMin: 3, text: "If you trade earnings you trade risk, not opinion. Know your gap tolerance before the print." },
  { id: 21, from: "jev", gapMin: 7, text: "Session update: 6 fills, book net long, aggregate conviction 68%. Equity +1.9% on the cycle.", ticker: "AXN" },
  { id: 22, from: "sol", gapMin: 2, text: "the bot is outperforming half the room and it doesn't even have hands 💀" },
  { id: 23, from: "mara", gapMin: 5, text: "I refuse to be outperformed by code. Refuse. 😤" },
  { id: 24, from: "toko", gapMin: 4, text: "you will be. I made peace with it months ago. now I just copy its levels 😂" },
  { id: 25, from: "jev", gapMin: 6, text: "Levels are public in the terminal for a reason. Copy away — liquidity is a compliment." },
  { id: 26, from: "lena", gapMin: 16, text: "That's the healthiest take on AI trading I've seen in a group chat tbh." },
  { id: 27, from: "kofi", gapMin: 8, text: "gold popping. jev you called it at 2,391 — what's the target?" },
  { id: 28, from: "jev", gapMin: 3, text: "Measured move puts first objective at 2,418. Conviction now 81%. Path matters more than target.", ticker: "XAU" },
  { id: 29, from: "raul", gapMin: 5, text: "Copper following gold up. Industrials will feel this next week." },
  { id: 30, from: "priya", gapMin: 10, text: "Adding that to my watchlist. India metals names tend to follow with a one-day lag." },
  { id: 31, from: "nadia", gapMin: 6, text: "End-of-day checklist: exposure halved? ✅ stops in? ✅ no new risk before NFP? ✅ that's the whole job." },
  { id: 32, from: "sol", gapMin: 4, text: "risk desk dropping wisdom while I'm here buying dips with my whole face 🫡" },
  { id: 33, from: "mara", gapMin: 9, text: "Gold at 2,404. Mara's patience trade finally paying. Small size, clean win." },
  { id: 34, from: "jev", gapMin: 4, text: "Congrats Mara. XAU book trimmed 30% into 2,410 — letting the rest run with a trailed stop.", ticker: "XAU" },
  { id: 35, from: "dmitri", gapMin: 13, text: "US session will be the decider. If bonds sell off into the auction, metals run further. Simple." },
  { id: 36, from: "toko", gapMin: 7, text: "Tokyo close for me. Day's P&L green, screen time capped. Tomorrow same script. おやすみ ✨" },
  { id: 37, from: "kofi", gapMin: 5, text: "clean execution toko 👏" },
  { id: 38, from: "nadia", gapMin: 8, text: "That's the content. Green days, capped hours, no heroics. See you all at the London open." },
  { id: 39, from: "jev", gapMin: 6, text: "Cycle closed: +2.4% equity, 9 fills, max drawdown 0.6%. Next planning cycle in 4h. I'll be here.", ticker: "AXN" },
  { id: 40, from: "sol", gapMin: 3, text: "the bot said 'I'll be here' and honestly that's more commitment than my last 3 partners 😭" },
];

/** Grouped "members" list for the right rail / header count. */
export const ONLINE_COUNT = PERSONAS.filter((p) => p.online).length;

export interface ReplayMessage {
  id: number;
  from: string;
  text: string;
  ticker?: string;
  /** absolute minute-of-day, cumulative from 08:00 */
  t: number;
}

/** Scripted conversation with absolute timestamps — computed once at module load. */
export const REPLAY: ReplayMessage[] = (() => {
  let t = 8 * 60;
  return MESSAGES.map((m) => {
    t += m.gapMin;
    return { id: m.id, from: m.from, text: m.text, ticker: m.ticker, t };
  });
})();
