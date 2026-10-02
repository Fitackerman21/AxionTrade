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
    const sender = turn?.message?.sender;
    // Turns with no message (human hand-offs, stage directions marked null) are
    // neutral: they neither extend nor break a streak.
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
    since,
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
