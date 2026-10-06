/**
 * Pacing maths for both drivers (spec §3.2).
 *
 * Jitter is derived from the room id and the turn number rather than
 * Math.random(), so the gap between turns is reproducible too. That matters
 * because catch-up has to reason about how many turns *should* exist by now, and
 * a changing estimate would make "turns owed" jump around between page loads.
 */

import { hashString } from "./rng";
import type { ForumConfig } from "./types";

/** How long a person waits for a reply when the room does not say (§9). */
export const DEFAULT_HUMAN_REPLY_SEC: readonly [number, number] = [30, 60];

/** A person's reply window, falling back to the default when the room omits it. */
export function humanReplyRange(config: ForumConfig): readonly [number, number] {
  const range = config.scheduling.humanReplySec;
  if (
    Array.isArray(range) &&
    range.length === 2 &&
    Number.isFinite(range[0]) &&
    Number.isFinite(range[1])
  ) {
    return [range[0], range[1]];
  }
  return DEFAULT_HUMAN_REPLY_SEC;
}

export function meanGapMs(range: readonly [number, number]): number {
  const [min, max] = range;
  return ((Math.max(0, min) + Math.max(Math.max(0, min), max)) / 2) * 1000;
}

/** A jittered gap inside the configured range, stable for a given turn. */
export function gapMsFor(roomId: string, seq: number, range: readonly [number, number]): number {
  const minMs = Math.max(0, range[0]) * 1000;
  const maxMs = Math.max(minMs, range[1] * 1000);
  const span = maxMs - minMs;
  if (span === 0) return minMs;
  return minMs + (hashString(`${roomId}:gap:${seq}`) % (span + 1));
}

/** How many turns the room is behind by, given a gap and its intended cadence. */
export function turnsOwed(gapMs: number, range: readonly [number, number]): number {
  const gap = meanGapMs(range);
  if (gap <= 0 || gapMs <= 0) return 0;
  return Math.floor(gapMs / gap);
}

/** When the next turn is due, for the UI's "thinking…" indicator. */
export function nextTurnAt(lastTurnAt: number, range: readonly [number, number]): number {
  return lastTurnAt + meanGapMs(range);
}

/**
 * When a person's message is owed its reply (spec §9).
 *
 * Deliberately a shorter, separate clock from the room's 45–180s cadence: a
 * person who just spoke should see the room typing for a few seconds, not wait
 * out an idle-room gap. Jittered on the human turn's seq via `gapMsFor`, so the
 * wait is stable for a given message and varies between messages.
 */
export function humanReplyDueAt(
  roomId: string,
  humanTurnAt: number,
  humanSeq: number,
  range: readonly [number, number],
): number {
  return humanTurnAt + gapMsFor(roomId, humanSeq, range);
}
