/**
 * The room's worn-out vocabulary (spec §8.1's realism half).
 *
 * Read the live transcript and the failure is impossible to miss: the same four or
 * five words carry every message for hours. "coil", "cooked", "mid", "2400", "fold",
 * "size" — because the world digest is re-injected verbatim on every turn and the
 * topic deck names the same two or three things all day, the prompt keeps handing the
 * model the same nouns, so it keeps handing them back. Real rooms drift: the level is
 * "the round number" for a while, then "2,400", then "the handle"; the setup is
 * "coiled", then "stuck", then "going nowhere".
 *
 * Two things live here:
 *
 *  - `digestFor` rotates the *wording* of the world state across several paraphrases
 *    of the same facts, so the substrate stops injecting one sentence all day.
 *  - `overusedTerms` reads the recent log and reports the terms the room has hammered,
 *    which the Voice is told to avoid and the Gate refuses to publish again.
 */

import type { TurnRecord, WorldState } from "./types";

/**
 * The words that are allowed to repeat.
 *
 * Anchored deliberately wide, because a check that flags "gold" or "flows" would
 * reject most correct market talk and the retries would cost more than the realism
 * is worth. What is left out is the vocabulary of *phrasing* — coil, fold, chop,
 * cooked, delulu, mid — which is exactly what the room wears out.
 */
const ANCHORED = new Set([
  // ordinary English
  "about", "after", "again", "already", "also", "always", "another", "anything", "around",
  "back", "because", "been", "before", "being", "better", "between", "both", "cannot",
  "could", "does", "doing", "done", "down", "during", "each", "else", "even", "ever",
  "every", "everything", "first", "from", "getting", "going", "gone", "good", "half",
  "have", "having", "here", "hold", "holding", "into", "just", "keep", "keeping", "kind",
  "know", "last", "later", "least", "less", "like", "little", "long", "made", "make",
  "many", "maybe", "more", "most", "much", "must", "need", "never", "next", "nothing",
  "only", "other", "over", "people", "probably", "really", "right", "room", "same",
  "says", "should", "since", "some", "someone", "something", "still", "such", "sure",
  "take", "than", "that", "their", "them", "then", "there", "these", "they", "thing",
  "things", "think", "this", "those", "though", "three", "through", "time", "today",
  "told", "took", "under", "until", "very", "wait", "waiting", "want", "week", "well",
  "went", "were", "what", "when", "where", "which", "while", "will", "with", "without",
  "would", "yeah", "your", "yours",
  // the short, ordinary words that would otherwise be flagged once the floor is four
  // letters: "nice", "fine", "fair" and "sure" are the room's connective tissue.
  "nice", "fine", "fair", "sure", "okay", "good", "real", "call", "side", "look", "looks",
  "feel", "feels", "goes", "days", "month", "year", "years", "hour", "each", "else",
  // the room's own working vocabulary
  "alert", "alerts", "book", "break", "breakout", "broke", "cable", "chart", "charts",
  "close", "conviction", "copper", "crypto", "currency", "desk", "dollar", "drawdown",
  "earnings", "engine", "euro", "eurusd", "fill", "fills", "flow", "flows", "friday",
  "gold", "guardrail", "index", "indices", "level", "levels", "limit", "london", "macro",
  "market", "markets", "metals", "morning", "move", "moves", "nfp", "open", "paper",
  "plan", "position", "press", "price", "print", "range", "rates", "reload", "risk",
  "screen", "screens", "semis", "session", "setup", "short", "size", "sizing", "stop",
  "stops", "story", "tape", "trade", "traded", "trader", "traders", "trades", "trading",
  "watchlist", "week", "wick", "yield",
]);

/** A crude stem, so "coil", "coiled" and "coiling" are one term rather than three. */
export function stem(word: string): string {
  let out = word;
  for (const suffix of ["ing", "ies", "ers", "ed", "es", "s"]) {
    if (out.length - suffix.length >= 4 && out.endsWith(suffix)) {
      out = out.slice(0, -suffix.length);
      break;
    }
  }
  return out;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export interface OverusedOptions {
  /** how many recent persona messages count as "lately" */
  window?: number;
  /** how many uses inside that window make a term worn out */
  minCount?: number;
  /** cap on the returned list, so the prompt block stays short */
  limit?: number;
}

/**
 * The terms the room has worn out lately, worst first.
 *
 * Only the room's own messages are read: a visitor's words are not the room's habit,
 * and counting them would have the persona banned from answering the question that was
 * just asked. Numeric levels are included here because the *prompt* should avoid
 * repeating them — the Gate leaves numbers alone, since a price is a fact.
 */
export function overusedTerms(
  turns: readonly TurnRecord[] | undefined,
  options: OverusedOptions = {},
): string[] {
  if (!turns || turns.length === 0) return [];
  const window = options.window ?? 14;
  const minCount = options.minCount ?? 4;
  const limit = options.limit ?? 6;

  const counts = new Map<string, { count: number; examples: Map<string, number> }>();
  for (const turn of turns.slice(-window)) {
    const text = turn.message?.text;
    if (!text) continue;
    if (turn.trigger === "HUMAN") continue;
    for (const raw of words(text)) {
      if (/^\d/.test(raw)) {
        if (raw.length < 3) continue;
        const entry = counts.get(raw) ?? { count: 0, examples: new Map() };
        entry.count += 1;
        entry.examples.set(raw, (entry.examples.get(raw) ?? 0) + 1);
        counts.set(raw, entry);
        continue;
      }
      // Four letters, not five: "coil" is one of the words the live room actually wore
      // out, and a floor of five silently exempted the noun while flagging the verb.
      if (raw.length < 4 || ANCHORED.has(raw)) continue;
      const key = stem(raw);
      if (ANCHORED.has(key)) continue;
      const entry = counts.get(key) ?? { count: 0, examples: new Map() };
      entry.count += 1;
      entry.examples.set(raw, (entry.examples.get(raw) ?? 0) + 1);
      counts.set(key, entry);
    }
  }

  return [...counts.entries()]
    .filter(([, entry]) => entry.count >= minCount)
    .sort((a, b) => b[1].count - a[1].count)
    // The form the model actually used most, so the avoid-list reads like the room's
    // own words rather than a dictionary stem.
    .map(([key, entry]) => {
      if (/^\d/.test(key)) return key;
      const top = [...entry.examples.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      return top ?? key;
    })
    .slice(0, limit);
}

/**
 * The world state, said a different way.
 *
 * Every turn's prompt carries the same digest, and the digest is also the engine's own
 * line on RECAP and IDLE turns — so one sentence produced "coiling above 2,400" in
 * dozens of bubbles. `digests` are paraphrases of the identical facts; the room picks
 * one per turn by seq, which keeps the substrate honest and the wording moving.
 */
export function digestFor(world: WorldState, seq: number): string {
  const variants = world.digests?.filter((line) => typeof line === "string" && line.trim() !== "");
  if (!variants || variants.length === 0) return world.digest;
  return variants[Math.abs(seq) % variants.length]!;
}
