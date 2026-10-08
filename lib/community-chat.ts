/**
 * Display metadata and the fallback transcript for the Axion community chat.
 *
 * Every member of this room is a person. The roster used to carry the engine as a
 * member — an "AxAI" badge on its avatar and an `engine` chip on its messages — and
 * that was the loudest thing in the room: one participant visibly not human, in a
 * room whose entire job is to read as human. The engine still *authors* turns (it
 * opens the session, reads the tape, recaps a stale gap), but it does so through a
 * person on the roster, so there is nothing in the transcript to label.
 *
 * The replay is the fallback when the room is empty, unreachable, or running on a
 * host without a driver. It is written under the same rule as the live room: short,
 * uneven, dash-free, and nobody explains themselves politely.
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
  /** profile picture URL; set from the dashboard, falls back to the gradient */
  picture?: string;
  /** what the members drawer shows under the role */
  bio?: string;
  age?: number;
}

/** Ten-persona roster shared with the chat UI. In P1 this list is a loader over
data/forum/personas.json; here it still carries the same display fields the room
already uses. Two of those personas are the ones getting a real Voice first. */
export const PERSONAS: ChatPersona[] = [
  {
    id: "rafa",
    name: "Rafa Duarte",
    role: "Index futures · Chicago",
    g1: "#2e90fa",
    g2: "#00c896",
    color: "#9fc6ff",
    online: true,
  },
  {
    id: "jess",
    name: "Jess T.",
    role: "Options flow · Austin",
    g1: "#f59e0b",
    g2: "#ef4444",
    color: "#fdba74",
    online: true,
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
    online: false,
  },
  {
    id: "priya",
    name: "Priya Raman",
    role: "Equities · Singapore",
    g1: "#ec4899",
    g2: "#8b5cf6",
    color: "#f9a8d4",
    online: true,
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
    online: true,
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
 * The fallback transcript, in the same voice as the live room.
 *
 * Read it as a spec for the tone: uneven lengths, one-word beats next to full
 * sentences, lowercase where the persona is lowercase, no em dashes and no tidy
 * wrap-ups. If a line here sounds like it was written for a brochure, the room will
 * sound like it too, because the prompt hands these out as the model's own history.
 */
export const REPLAY: ReplaySource[] = [
  {
    id: 1,
    from: "rafa",
    text: "tape's thin before the open. flat until 10",
  },
  {
    id: 2,
    from: "mara",
    text: "morning room 🔋 gold's been doing that thing where it looks boring right up until it isn't",
  },
  {
    id: 3,
    from: "rafa",
    text: "coiled all week and it still means nothing until it breaks. I'd rather be bored than early",
  },
  {
    id: 4,
    from: "sol",
    text: "lol it's been coiled for six days and everyone in here is still writing essays about it",
  },
  {
    id: 5,
    from: "mara",
    text: "keeping it small. let the range tell me what it is",
  },
  {
    id: 6,
    from: "kofi",
    text: "cable first, gold second. that's just how it is",
  },
  {
    id: 7,
    from: "jess",
    text: "what was the flow though",
  },
  {
    id: 8,
    from: "rafa",
    text: "thin. that's the flow. two prints in the last hour and both were hedges",
    ticker: "XAU",
  },
  {
    id: 9,
    from: "nadia",
    text: "half size into the number. that's the whole job",
  },
  {
    id: 10,
    from: "dmitri",
    text: "that's not the driver. rates are",
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
