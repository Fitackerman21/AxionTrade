/**
 * Speaker selection (spec §6.2) and the recency it depends on.
 *
 * Deterministic on purpose: the same log must always produce the same next
 * speaker, otherwise replay and the drift harness are meaningless.
 */

import { orderByWeightThenSeed } from "./rng";
import type { ForumConfig, PersonaId, TurnRecord } from "./types";

export interface SpeakerContext {
  candidates: PersonaId[];
  lastSpeaker: PersonaId | null;
  /** turns since each persona last posted; absent means "never posted" */
  turnsSinceLastPost: Record<PersonaId, number>;
  /** how many turns in a row the last speaker has posted */
  consecutivePosts: number;
  config: ForumConfig;
  roomId: string;
  seq: number;
  /**
   * Local hour (0–23) for each candidate, when the room asks for local-hours
   * weighting (`config.scheduling.respectLocalHours`). Absent means the weighting is
   * inert and the choice is exactly what it was before the option existed.
   */
  localHour?: Record<PersonaId, number>;
}

/** The local hour for a time zone at a wall-clock instant, or undefined if unknown. */
export function localHourFor(tz: string | undefined, at: number): number | undefined {
  if (!tz) return undefined;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    }).formatToParts(new Date(at));
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    return Number.isFinite(hour) ? hour % 24 : undefined;
  } catch {
    // An unknown zone is not an error worth failing a turn over — no weighting.
    return undefined;
  }
}

/** How far the small hours push a candidate down the order. */
const ASLEEP_PENALTY = 1_000;

/**
 * The penalty for posting at 3am in the persona's own city.
 *
 * Between 2 and 6 local the persona waits behind anyone who is awake, which is what
 * stops a Los Angeles member and a Dubai member trading the same overnight shift. It
 * is a penalty, not a filter: when everyone is asleep the room still speaks, because
 * silence is worse than an early riser.
 */
function localHourPenalty(id: PersonaId, ctx: SpeakerContext): number {
  if (!ctx.config.scheduling.respectLocalHours || !ctx.localHour) return 0;
  const hour = ctx.localHour[id];
  if (hour === undefined) return 0;
  return hour >= 2 && hour < 6 ? -ASLEEP_PENALTY : 0;
}

export interface SpeakerChoice {
  chosen: PersonaId | null;
  /** full preference order, kept in the log so a choice can be reviewed */
  ordered: PersonaId[];
  reason: string;
  /** true when nobody satisfied the cooldown and it had to be relaxed */
  relaxedCooldown: boolean;
}

/** Turns since each persona last posted, plus the trailing streak. */
export function recencyFromTurns(
  turns: readonly TurnRecord[],
  lastSeq: number,
): {
  turnsSinceLastPost: Record<PersonaId, number>;
  lastSpeaker: PersonaId | null;
  consecutivePosts: number;
} {
  const turnsSinceLastPost: Record<PersonaId, number> = {};
  let lastSpeaker: PersonaId | null = null;
  let consecutivePosts = 0;

  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    // An UNPUBLISHED turn names who failed the Gate, so the room can hand the next
    // turn to someone else (spec §8.4). Other message-less turns — human hand-offs,
    // stage directions — stay neutral: they neither extend nor break a streak.
    const sender =
      turn?.message?.sender ?? (turn?.decision === "UNPUBLISHED" ? turn.chosen : null);
    if (!turn || !sender) continue;

    if (!(sender in turnsSinceLastPost)) {
      turnsSinceLastPost[sender] = lastSeq - turn.seq;
    }

    if (lastSpeaker === null) {
      lastSpeaker = sender;
      consecutivePosts = 1;
      continue;
    }
    if (sender === lastSpeaker) {
      consecutivePosts += 1;
    } else {
      break;
    }
  }

  return { turnsSinceLastPost, lastSpeaker, consecutivePosts };
}

/**
 * Pick the responder.
 *
 * 1. drop the last speaker once they hit `maxConsecutivePosts`
 * 2. drop anyone still inside `minTurnsBetweenPosts`
 * 3. quietest first, ties broken by a seed keyed on (room, turn)
 *
 * `recencyFromTurns` counts an UNPUBLISHED turn as its chosen speaker having just
 * posted, which is how the Director swaps speakers after a Gate rejection (§8.4).
 *
 * The spec's step 2 would dead-end the room whenever every candidate was on
 * cooldown, so the cooldown relaxes to the longest-waiting candidate instead and
 * the turn records that it happened.
 */
export function pickSpeaker(ctx: SpeakerContext): SpeakerChoice {
  const { candidates, config, seq, roomId } = ctx;
  if (candidates.length === 0) {
    return { chosen: null, ordered: [], reason: "no-permitted-responder", relaxedCooldown: false };
  }

  const { maxConsecutivePosts, minTurnsBetweenPosts } = config.scheduling;

  let pool = candidates;
  let reason = "";
  if (
    ctx.lastSpeaker !== null &&
    ctx.consecutivePosts >= maxConsecutivePosts &&
    pool.length > 1
  ) {
    pool = pool.filter((id) => id !== ctx.lastSpeaker);
    reason = `last speaker posted ${ctx.consecutivePosts}x in a row`;
  }

  const since = (id: PersonaId): number =>
    ctx.turnsSinceLastPost[id] ?? Number.POSITIVE_INFINITY;
  // Quietness first, then the local-hours nudge. Kept in one weight function so the
  // tie-break seed is still the only other input, and the choice stays reproducible.
  const weight = (id: PersonaId): number => since(id) + localHourPenalty(id, ctx);

  const offCooldown = pool.filter((id) => since(id) >= minTurnsBetweenPosts);
  let relaxedCooldown = false;
  let considered = offCooldown;
  if (considered.length === 0) {
    // Everyone is on cooldown — take the one who has waited longest rather than
    // producing no turn at all.
    considered = pool;
    relaxedCooldown = true;
    reason = reason ? `${reason}; cooldown relaxed` : "cooldown relaxed";
  }

  const ordered = orderByWeightThenSeed(
    considered,
    weight,
    (id) => id,
    `${roomId}:${seq}`,
  );

  return {
    chosen: ordered[0] ?? null,
    ordered,
    reason: reason || "quietest permitted responder",
    relaxedCooldown,
  };
}
