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

/*
 * The reading half of a reply (spec §9's realism rule).
 *
 * A person does not start typing the instant a message lands. They read it, and the
 * longer it is the longer that takes. The live page showed the failure plainly: a
 * visitor pressed send and the "… is typing" bubble was already there in the same
 * frame, which is the one thing no human thumb can do. The indicator now starts after
 * a read of a length proportional to what was sent — about 1.5s for a one-word
 * question, up to a ceiling for a paragraph — and the reply itself is still paced out
 * on the 30–60s window, so the typing bubble covers the composing, not the whole wait.
 */

/** How long a persona spends reading a message before their typing bubble appears. */
export function readDelayMs(text: string | undefined): number {
  const chars = (text ?? "").trim().length;
  // 1.2s to notice plus ~45ms a character, bounded so a wall of text is not "read"
  // for a minute and a one-liner is never instant.
  return Math.min(12_000, Math.max(1_800, 1_200 + chars * 45));
}

/**
 * When the typing indicator may appear for a person's message.
 *
 * Never after the reply is due, and never before the read is over, so the room cannot
 * be seen typing before it has "read" the question — and cannot still be typing at the
 * moment the answer lands.
 */
export function typingAt(
  humanTurnAt: number,
  text: string | undefined,
  dueAt: number,
): number {
  const read = humanTurnAt + readDelayMs(text);
  const latest = dueAt - 1_000;
  if (latest <= humanTurnAt) return humanTurnAt;
  return Math.max(humanTurnAt, Math.min(read, latest));
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
