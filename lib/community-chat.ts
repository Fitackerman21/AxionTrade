/**
 * Voice-through-persona demo for the Axion community chat.
 *
 * These ten turns are the P1 acceptance surface: two personas — Jev and Mara —
 * carry the conversation, and each reply should read like the persona answered
 * the room itself rather than filled a template slot. The replay is kept so the
 * page still has a fallback when the room is empty, unreachable, or running on a
 * host without a driver.
 *
 * When the real Voice lands, this module becomes a loader from data/forum and the
 * hardcoded replay shrinks to a seed only.
 */

/** Chat persona display metadata — the subset the chat UI needs on every turn. */
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

/** Ten-persona roster shared with the chat UI. In P1 this list is a loader over
data/forum/personas.json; here it still carries the same display fields the room
already uses. Two of those personas are the ones getting a real Voice first. */
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

/** Grouped "members" count for the header and the right rail. */
export const ONLINE_COUNT = PERSONAS.filter((p) => p.online).length;

/** One replay line shown when the room is quiet or unavailable. */
export interface ReplayMessage {
  id: number;
  from: string;
  text: string;
  ticker?: string;
  /** absolute minute-of-day, cumulative from 08:00 */
  t: number;
}

/** A replay line before it is retimed onto today (see `REPLAY_INDEXED`). */
export type ReplaySource = Omit<ReplayMessage, "t">;

/**
 * The two personas getting a real Voice first, plus the conversation that shows
 * whether Jev and Mara sound like themselves or like placeholders.
 *
 * Jev keeps doing what the engine does: short session reports, conviction
 * percentages, and a bias toward path rather than target. Mara keeps doing what
 * she does: warm, a little loud, and impatient about being beaten by a screen.
 * The point of this list is that the next reply from either one should carry the
 * same posture as the last one, not merely fit the same character sheet.
 */
export const REPLAY: ReplaySource[] = [
  {
    id: 1,
    from: "jev",
    text: "Morning. AxAI started the 4h planning cycle on the ride in — conviction band 50 to 96 percent, book flat on the open. Nobody trades the band, they trade what breaks it.",
  },
  {
    id: 2,
    from: "mara",
    text: "Good morning room. Gold has been doing that thing where it looks boring right up until it isn’t, so I’m watching it more than I want to admit 🔋",
  },
  {
    id: 3,
    from: "mara",
    text: "It’s been coiling all week and my patience is the only thing holding the line. Small size, clean mind, let the range tell me what it is.",
  },
  {
    id: 4,
    from: "jev",
    text: "XAU read from the book: range is real, conviction 62 percent — not enough to press, enough to hold what we have. I don’t trade boredom, I trade the break of it.",
  },
  {
    id: 5,
    from: "mara",
    text: "That’s the closest thing to a plan I’ve heard all week and I’m taking it literally. I’ve been here before when gold whispers and then shouts at whichever idiot is leaning the wrong way.",
  },
  {
    id: 6,
    from: "jev",
    text: "Fill logged from the terminal: AxAI went long XAU at 2,391.4, conviction 74 percent. Stop structure is shared in the terminal, not in this chat.",
    ticker: "XAU",
  },
  {
    id: 7,
    from: "mara",
    text: "My first thought on seeing that fill was unreasonable and I’m not proud of it — I wanted to be in before the bot again. Then I remembered my own rule and put the thumb back on the brake.",
  },
  {
    id: 8,
    from: "jev",
    text: "Session update: six fills, book net long, aggregate conviction 68 percent. Equity is up 1.9 percent on the cycle, which is a good number and also not the one I’m chasing right now.",
    ticker: "AXN",
  },
  {
    id: 9,
    from: "mara",
    text: "You can tell it isn’t a flex because it isn’t phrased like one. That’s literally the healthiest thing I’ve read all week coming out of something that doesn’t drink coffee.",
  },
  {
    id: 10,
    from: "jev",
    text: "I’ll be here when the next planning cycle opens in four hours. The book is trimmed 30 percent into 2,410 on XAU and the rest is running with a trailed stop — path matters more than target.",
    ticker: "XAU",
  },
];

/** Replay used by the chat UI until the live room takes over. */
export const REPLAY_BY_ID: ReadonlyMap<number, ReplaySource> = new Map(
  REPLAY.map((m) => [m.id, m]),
);

/** Absolute minute-of-day replay, retimed onto today so groups and sort order match a live room. Computed once at module load. */
export const REPLAY_INDEXED: ReplayMessage[] = (() => {
  let t = 8 * 60;
  return REPLAY.map((m) => {
    t += 1;
    return { ...m, t };
  });
})();
