/**
 * Message reactions (spec §13.3) — the emoji a person or a persona leaves on a bubble.
 *
 * A reaction is not a turn. It has no author-turn, no length, no Gate review and no
 * position in the agenda: it is a small piece of state attached to a message that
 * already exists, which is why it is stored beside the log rather than in it and why
 * the whole log is still reconstructible from `seq` alone.
 *
 * The palette is closed on purpose. A free-text emoji is a way to write a message
 * through the reaction path — unmoderated text on a public page — and a picker with
 * six options is also what a real chat does.
 */

import type { MessageReactions, TurnRecord } from "./types";

/** The reactions the room allows. One glyph each, and each is in the chat's own register. */
export const REACTION_EMOJI = ["🔥", "👍", "😂", "🫡", "💀", "😅"] as const;

export type ReactionEmoji = (typeof REACTION_EMOJI)[number];

export function isReactionEmoji(value: unknown): value is ReactionEmoji {
  return typeof value === "string" && (REACTION_EMOJI as readonly string[]).includes(value);
}

/** One person's reaction to one message. `by` is a persona id or an external sender id. */
export interface ReactionRecord {
  /** the `seq` of the message being reacted to */
  seq: number;
  emoji: ReactionEmoji;
  /** who reacted — a persona id, or the external sender id a person carries */
  by: string;
  t: number;
}

/** How many distinct reactions may sit on one bubble, so the row cannot grow without bound. */
export const MAX_REACTIONS_PER_MESSAGE = 12;

/** Group one message's reactions into chips, in palette order so the row is stable. */
export function reactionsFor(seq: number, reactions: readonly ReactionRecord[]): MessageReactions[] {
  const grouped = new Map<ReactionEmoji, string[]>();
  for (const reaction of reactions) {
    if (reaction.seq !== seq) continue;
    const list = grouped.get(reaction.emoji) ?? [];
    list.push(reaction.by);
    grouped.set(reaction.emoji, list);
  }
  return REACTION_EMOJI.filter((emoji) => grouped.has(emoji)).map((emoji) => ({
    emoji,
    by: grouped.get(emoji)!,
  }));
}

/** Only reactions to messages that are actually in the log are worth sending to the UI. */
export function reactionsForTurns(
  turns: readonly TurnRecord[],
  reactions: readonly ReactionRecord[],
): Map<number, MessageReactions[]> {
  const present = new Set<number>();
  for (const turn of turns) if (turn.message) present.add(turn.message.seq);

  const byMessage = new Map<number, MessageReactions[]>();
  for (const seq of present) {
    const chips = reactionsFor(seq, reactions);
    if (chips.length > 0) byMessage.set(seq, chips);
  }
  return byMessage;
}
