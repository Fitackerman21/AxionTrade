/**
 * The agenda: what the room does next (spec §4, §6.4).
 *
 * Precedence is HUMAN > WORLD > (FRICTION | THREAD) > IDLE. Note one deliberate
 * refinement of the spec's literal ordering: the spec lists THREAD above
 * FRICTION, which makes FRICTION unreachable, because a plain thread
 * continuation is always available once a message exists. Here FRICTION means
 * "this thread continues, but the side must flip", which is what §6.4 wants —
 * the room cannot settle into agreement.
 */

import type {
  AgendaEvent,
  ForumConfig,
  ForumMessage,
  Persona,
  Side,
  Topic,
  TurnRecord,
  WorldState,
} from "./types";

export interface AgendaContext {
  seq: number;
  /** wall clock for this turn — the agenda uses it to notice a stale gap */
  now: number;
  turns: readonly TurnRecord[];
  config: ForumConfig;
  topics: readonly Topic[];
  world: WorldState;
  personas: readonly Persona[];
}

interface PostedTurn {
  turn: TurnRecord;
  message: ForumMessage;
}

function postedTurns(turns: readonly TurnRecord[]): PostedTurn[] {
  const posts: PostedTurn[] = [];
  for (const turn of turns) {
    if (turn.message) posts.push({ turn, message: turn.message });
  }
  return posts;
}

/** Anything not on the roster is an external sender — a person, in practice. */
function isExternal(sender: string, personas: readonly Persona[]): boolean {
  return !personas.some((p) => p.id === sender);
}

function flip(side: Side): Side {
  return side === "a" ? "b" : "a";
}

function topicFor(id: string, topics: readonly Topic[]): Topic {
  const topic = topics.find((t) => t.id === id) ?? topics[0];
  if (!topic) throw new Error("forum: the topic deck is empty");
  return topic;
}

/** Trailing run of posts that share the newest post's topic *and* side. */
function trailingStreak(posts: readonly PostedTurn[]): { side: Side | null; count: number } {
  const newest = posts[posts.length - 1];
  if (!newest) return { side: null, count: 0 };

  const { topicId, side } = newest.message;
  let count = 0;
  for (let i = posts.length - 1; i >= 0; i -= 1) {
    const post = posts[i];
    if (!post || post.message.topicId !== topicId || post.message.side !== side) break;
    count += 1;
  }
  return { side, count };
}

/** How long the room has been on the newest post's topic. */
function turnsOnTopic(posts: readonly PostedTurn[]): number {
  const newest = posts[posts.length - 1];
  if (!newest) return 0;

  let count = 0;
  for (let i = posts.length - 1; i >= 0; i -= 1) {
    const post = posts[i];
    if (!post || post.message.topicId !== newest.message.topicId) break;
    count += 1;
  }
  return count;
}

function nextTopic(posts: readonly PostedTurn[], topics: readonly Topic[]): Topic {
  if (topics.length === 0) throw new Error("forum: the topic deck is empty");
  const currentId = posts[posts.length - 1]?.message.topicId;
  const index = topics.findIndex((t) => t.id === currentId);
  if (index === -1) return topics[0] as Topic;
  return topics[(index + 1) % topics.length] as Topic;
}

export function nextEvent(ctx: AgendaContext): AgendaEvent {
  const { seq, now, config, topics, world, personas, turns } = ctx;
  const posts = postedTurns(turns);
  const newest = posts[posts.length - 1];
  const engine = config.agenda.enginePersona;

  // 1. HUMAN — a person spoke and is owed a reply.
  if (newest && isExternal(newest.message.sender, personas)) {
    return {
      kind: "HUMAN",
      reason: "a person spoke and is owed a reply",
      sender: newest.message.sender,
      topic: topicFor(newest.message.topicId, topics),
      side: newest.message.side,
      quoted: newest.message.text,
      authoredBy: "responder",
      // The reply is visibly attached to the message it answers, the way a quoted
      // reply works in a chat app.
      replyTo: newest.message.seq,
    };
  }

  // 2. RECAP — the room was away long enough that replaying the gap would be a
  // burst of nonsense, so it acknowledges the gap in a single turn (spec §3.2).
  const staleAfterMs = Math.max(0, config.runtime.staleAfterMin) * 60_000;
  if (newest && staleAfterMs > 0 && now - newest.message.t >= staleAfterMs) {
    return {
      kind: "RECAP",
      reason: `the room was ${Math.round((now - newest.message.t) / 60_000)} minutes behind`,
      sender: engine,
      topic: topicFor(newest.message.topicId, topics),
      side: newest.message.side,
      quoted: world.digest,
      authoredBy: "engine",
    };
  }

  // 3. WORLD — something happened; the engine reports it and the room reacts.
  const every = Math.max(1, config.scheduling.worldEventEveryTurns);
  if (world.highlights.length > 0 && seq % every === 0) {
    const index = (Math.floor(seq / every) - 1) % world.highlights.length;
    const highlight = world.highlights[index];
    if (!highlight) throw new Error("forum: world highlights are empty");
    return {
      kind: "WORLD",
      reason: `world tick due (every ${every} turns)`,
      sender: engine,
      topic: topicFor(highlight.topicId, topics),
      side: highlight.side ?? "a",
      quoted: highlight.text,
      authoredBy: "engine",
    };
  }

  // 3/4. FRICTION or THREAD — continue the open topic, flipping sides if the
  // room has been agreeing with itself for too long.
  if (newest) {
    const topic = topicFor(newest.message.topicId, topics);
    const rotationLimit = Math.max(1, config.scheduling.topicRotationTurns);

    if (turnsOnTopic(posts) < rotationLimit) {
      const streak = trailingStreak(posts);
      const limit = Math.max(1, config.scheduling.frictionStreakTurns);
      const flipping = streak.side !== null && streak.count >= limit;
      const side: Side = flipping && streak.side ? flip(streak.side) : newest.message.side;

      return {
        kind: flipping ? "FRICTION" : "THREAD",
        reason: flipping
          ? `${streak.count} posts in a row on side ${streak.side}; forcing the counter-position`
          : "continuing the open thread",
        sender: newest.message.sender,
        topic,
        side,
        quoted: flipping ? topic.friction[side] : newest.message.text,
        // A FRICTION turn is handed the topic's canonical counter-line, which is a
        // prompt rather than a message, so it is not attached to the previous post.
        authoredBy: "responder",
        ...(flipping ? {} : { replyTo: newest.message.seq }),
      };
    }
  }

  // 5. IDLE — nothing to continue, or the topic has run its course. The engine
  // leads the room, so it opens and changes the subject itself.
  const opening = posts.length === 0;
  return {
    kind: "IDLE",
    reason: opening
      ? "the room is opening"
      : `topic ran ${config.scheduling.topicRotationTurns} turns; rotating`,
    sender: engine,
    topic: nextTopic(posts, topics),
    side: "a",
    quoted: world.digest,
    authoredBy: "engine",
  };
}
