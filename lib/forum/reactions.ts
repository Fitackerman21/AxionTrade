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

import { hashPick, hashString } from "./rng";
import type { MessageReactions, PersonaId, TurnRecord } from "./types";

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

/**
 * The glyph a line invites, by its shape rather than by chance.
 *
 * The room reacted to nothing before this: measured over the live log, personas left
 * zero reactions while a person's tap was the only way a chip ever appeared. A
 * reaction is part of how a group chat feels, so the room now leaves them — but the
 * shape of the line is what decides which one, so a joke gets a laugh and a call gets
 * fire, rather than every message getting the same thumb.
 */
const REACTION_SHAPES: ReadonlyArray<{ match: RegExp; emoji: readonly ReactionEmoji[] }> = [
  // Somebody is joking, or the room is laughing at something.
  { match: /\b(?:lol|lmao|haha|heh|joking|kidding|jokes|💀|😂|🤣|dead|dying|comedy)\b/i, emoji: ["😂", "💀"] },
  // A call, a conviction, a clean trade, a good number.
  { match: /\b(?:long|short|bought|buying|added|adding|loaded|filled|conviction|clean|good|nice|love|yep|lets go|let'?s go|finally|🔥|🚀)\b/i, emoji: ["🔥", "👍"] },
  // A shrug, a dismissal, or a wry read of something ugly.
  { match: /\b(?:mid|cooked|nah|meh|whatever|chop|boring|stuck|range|unclear|wrong|ouch|pain)\b/i, emoji: ["😅", "🫡"] },
  // A plain agreement or an ordinary answer.
  { match: /\b(?:yeah|yep|agreed|fair|true|right|exactly|same|this|correct)\b/i, emoji: ["👍", "🫡"] },
];

/** The glyph for a line, seeded so a replay leaves the same one. */
export function reactionFor(text: string, seed: string): ReactionEmoji {
  for (const shape of REACTION_SHAPES) {
    if (shape.match.test(text)) return hashPick(shape.emoji, seed) ?? shape.emoji[0]!;
  }
  return hashPick(["👍", "🔥", "😅"] as const, seed) ?? "👍";
}

/** One persona's reaction to a line. */
export interface RoomReaction {
  by: PersonaId;
  emoji: ReactionEmoji;
}

/**
 * The reactions the room leaves on a line, if any — occasional, not constant.
 *
 * Measured dead at 0% before this. The cadence is deliberately steady rather than
 * frequent: roughly one line in five gets a single reaction and one in sixteen gets a
 * second, so a reader sees the room react to what it likes without every bubble
 * collecting a row of chips. It is seeded on the turn's `seq`, so a replay is the same
 * room, and a persona never reacts to its own line.
 */
export function roomReactionsFor(args: {
  text: string;
  seq: number;
  author: PersonaId;
  candidates: readonly PersonaId[];
}): RoomReaction[] {
  const { text, seq, author, candidates } = args;
  // Too short to have a shape (a bare "ok" or a stage direction) is not worth a chip.
  if (text.trim().length < 3) return [];
  const pool = candidates.filter((id) => id !== author);
  if (pool.length === 0) return [];

  const roll = hashString(`room-react:${seq}`) % 100;
  const count = roll < 6 ? 2 : roll < 20 ? 1 : 0;
  if (count === 0) return [];

  const out: RoomReaction[] = [];
  const usedBy = new Set<PersonaId>();
  const usedEmoji = new Set<ReactionEmoji>();
  for (let i = 0; i < count; i += 1) {
    const remaining = pool.filter((id) => !usedBy.has(id));
    if (remaining.length === 0) break;
    const by = hashPick(remaining, `room-react-by:${seq}:${i}`) ?? remaining[0]!;
    const emoji = reactionFor(text, `room-react-emoji:${seq}:${by}`);
    // One chip per glyph: two people piling the same emoji onto one line is not how a
    // small room reacts, and the palette row is what the count is for.
    if (usedEmoji.has(emoji)) continue;
    usedBy.add(by);
    usedEmoji.add(emoji);
    out.push({ by, emoji });
  }
  return out;
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
