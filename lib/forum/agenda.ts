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

import { contentTokens } from "./gate";
import { isGreeting, looksLikeQuestion, MARKET_WORDS, PLATFORM_INTENTS, productIntentOf } from "./knowledge";
import { digestFor } from "./lexicon";
import { hashString } from "./rng";
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

/**
 * Is the person's message about what the room is on?
 *
 * The room used to assume every human message was about the open thread, because a
 * person's message is appended under the current topic id. That held until a live
 * visitor asked how withdrawals work and got "the withdrawal thing is dead, gold's
 * still coiling above 2400" back twice, then said the room sounded like AI. The
 * signal here is lexical, which is enough: a market question shares a word with the
 * topic's own vocabulary ("what's the read on gold"), and a product question shares
 * none of it.
 *
 * Deliberately generous in the other direction — a message with no content words at
 * all is treated as on-topic, because "oi" is not a question the room should answer
 * differently. `contentTokens` is the same definition of "a shared word" the Gate's
 * ADDRESSEE check uses, so the two cannot disagree about what a message is about.
 */
function asksAboutTopic(text: string, topic: Topic): boolean {
  const theirs = contentTokens(text);
  if (theirs.size === 0) return true;
  const vocabulary = contentTokens(
    [topic.title, topic.sides.a, topic.sides.b, topic.friction.a, topic.friction.b].join(" "),
  );
  for (const token of theirs) if (vocabulary.has(token)) return true;
  return false;
}

/**
 * The words that name the platform itself.
 *
 * Any one of these makes a message a question about the product on its own — a fee,
 * a refund, a withdrawal, an account can only be about the thing the person is
 * looking at. `axion` is here because the room is on Axion's own site: a visitor
 * who types the product's name is asking about it, not about gold.
 */
const PRODUCT_NAMES = new Set([
  "axion",
  "axiontrade",
  "platform",
  "app",
  "website",
  "subscription",
  "withdraw",
  "withdrawal",
  "withdrawals",
  "deposit",
  "deposits",
  "refund",
  "refunds",
  "fee",
  "fees",
  "broker",
  "brokerage",
  "custody",
]);

/**
 * The words a trust-or-safety question is asked with.
 *
 * These only count when the message is *also* off the thread, which is what keeps
 * them off market talk: "is gold for real here" shares its vocabulary with the
 * topic and stays a market question, while "is this real" shares nothing and can
 * only be about the thing the person is looking at. Words that are ordinary market
 * vocabulary — risk, level, price, loss — are deliberately absent.
 */
const TRUST_WORDS = new Set([
  "real",
  "really",
  "legit",
  "legitimate",
  "scam",
  "safe",
  "trust",
  "trustworthy",
  "fake",
  "genuine",
  "honest",
  "guarantee",
  "guaranteed",
  "money",
  "lose",
  "losing",
  "broke",
  "refund",
]);

/**
 * Is the person asking about the platform rather than the market? (spec §9.2)
 *
 * Narrow on purpose, because the answer changes the whole turn: a product question is
 * the one shape that gets a **testimonial** (praise, bounded — see `voice.ts` and
 * `drafts.ts`) and the one shape where an invented claim, an over-claim or a refusal is a
 * failure rather than a judgement call. A check wide enough to catch every message
 * containing the word "real" would take the room's voice away from market talk: naming
 * the product is unambiguous, and a trust word only counts when the message is also
 * nothing to do with the open thread.
 *
 * The third way in is the question shape itself, with none of that vocabulary in it.
 * `productIntentOf` already knew "where do i set a loss limit" was a `limits` question and
 * "does it trade for me or do i place them myself" an `autonomy` one, and the live room
 * answered the first with a tape verdict ("are you in it or watching?") and never answered
 * the second — because the intent was computed and then never consulted, so the turn fell
 * through to the market and social banks and the routing guarantee in `humanReplyMode` (a
 * platform question is always answered exactly as asked) never applied. The guard against
 * market talk is the trust branch's own: off the thread, naming no market. `looksLikeQuestion`
 * is what keeps a social aside that tripped the fuzzy `bot` shape ("everyone here types like
 * a bot sometimes") out of the fact base — the shape alone is not enough, it has to be asked.
 */
export function asksAboutProduct(text: string, onTopic: boolean): boolean {
  const tokens = contentTokens(text);
  if (tokens.size === 0) return false;
  for (const token of tokens) if (PRODUCT_NAMES.has(token)) return true;
  if (onTopic) return false;
  for (const token of tokens) if (TRUST_WORDS.has(token)) return true;
  if (MARKET_WORDS.test(text)) return false;
  return looksLikeQuestion(text) && PLATFORM_INTENTS.has(productIntentOf(text));
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

/**
 * The post a thread reply is pinned to, and who wrote it.
 *
 * A quote is the message the responder is answering, and a reply pinned to a bare
 * "yeah" or an emoji answers nothing — the strip under the bubble shows a word with no
 * subject in it, which is one of the ways the live room read as noise answering noise.
 * When the newest post carries no content words, the reply attaches instead to the most
 * recent post on the same topic that does, so the quote points at something answerable.
 * Otherwise it is the newest post, which is what a chat reply normally answers.
 */
function replyTarget(posts: readonly PostedTurn[]): { seq: number; sender: string; text: string } {
  const newest = posts[posts.length - 1]!;
  const fallback = {
    seq: newest.message.seq,
    sender: newest.message.sender,
    text: newest.message.text,
  };
  if (contentTokens(newest.message.text).size > 0) return fallback;

  for (let i = posts.length - 2; i >= 0 && i >= posts.length - 6; i -= 1) {
    const post = posts[i]!;
    if (post.message.topicId !== newest.message.topicId) break;
    if (contentTokens(post.message.text).size > 0) {
      return { seq: post.message.seq, sender: post.message.sender, text: post.message.text };
    }
  }
  return fallback;
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

/**
 * Has this sender never spoken before, inside the window the agenda can see?
 *
 * A person's first message is the one where a greeting is owed and where a clock is
 * running: a newcomer who gets silence on their opening line does not send a second, so
 * the shapes that risk reading as an empty room are disabled for it.
 */
function isFirstFromSender(
  turns: readonly TurnRecord[],
  sender: string,
  personas: readonly Persona[],
): boolean {
  if (!isExternal(sender, personas)) return false;
  let seen = 0;
  for (const turn of turns) {
    const message = turn.message;
    if (!message || message.sender !== sender) continue;
    seen += 1;
    if (seen > 1) return false;
  }
  return seen === 1;
}

/**
 * How the room handles one person's message.
 *
 * A live room answers everything, always, once, and never asks anything back: over the
 * measured afternoon it produced **0.0%** questions from the canned bank and only 5.4%
 * from the model, greeted nobody (0 of 6 replies to a visitor), and answered all six of a
 * newcomer's messages within 40-70 seconds. That regularity is a tell on its own, however
 * good the individual lines are, so a minority of turns is delivered differently:
 *
 *  - `react` — a verdict, no information. The commonest way a group chat "does not
 *    answer": somebody says nah, or fair, or an emoji, and the conversation moves on.
 *  - `askBack` — an answer that ends in a question of the responder's own.
 *  - `quiet` — the room read it and had nothing to add. Rarest of all, and never on a
 *    question, never on the first message a person has ever sent, and never on anything
 *    about the platform: silence is the one reply a worried visitor must not get.
 *
 * The roll is on the human message's own seq, so a replay delivers the same turn the same
 * way, and the mode is not a property of the speaker — it belongs to the message.
 */
export function humanReplyMode(args: {
  roomId: string;
  seq: number;
  text: string;
  product: boolean;
  greeting: boolean;
  first: boolean;
}): NonNullable<AgendaEvent["replyMode"]> {
  const { roomId, seq, text, product, greeting, first } = args;
  // The two shapes that are always answered exactly as asked: a question about the
  // platform (spec §9.2) and somebody walking in the door.
  if (product || greeting) return "answer";

  const roll = hashString(`${roomId}:reply:${seq}`) % 100;
  if (roll < 12) return "askBack";
  if (roll < 24) return "react";
  if (roll < 32) {
    // Silence is only ever allowed where it would be read as a busy room rather than a
    // dead one: a short social line, from somebody who has spoken before, with no
    // question mark in it. Anything else is downgraded to a reaction, which is the same
    // human move with a heartbeat behind it.
    const asks = text.includes("?");
    if (!asks && !first && text.trim().length <= 70) return "quiet";
    return "react";
  }
  return "answer";
}

/**
 * How a turn between two members is delivered.
 *
 * The fallback room asserted everything: measured over its canned lines, **0.0%** asked a
 * question, against 5.4% of the lines a model wrote. A room where nobody ever asks anything
 * is a row of broadcasts, and that is a tell about the *shape* of every turn rather than
 * about any one line — the reader notices the sameness before they notice a bad sentence.
 *
 * So a minority of thread turns is delivered as a question instead of a statement, and a
 * smaller share as a bare reaction (the same move as `react` on a person's message: a
 * verdict carrying no information). Seeded on the room and the turn, like `humanReplyMode`,
 * and rolled per turn rather than per speaker — no member may become "the one who asks".
 *
 * FRICTION is left alone: that turn is the room's counter-position to a topic it has been
 * agreeing on, and a counter-position has to be a statement.
 */
export function threadReplyMode(args: {
  roomId: string;
  seq: number;
}): NonNullable<AgendaEvent["replyMode"]> {
  const roll = hashString(`${args.roomId}:thread:${args.seq}`) % 100;
  if (roll < 14) return "askBack";
  if (roll < 25) return "react";
  return "answer";
}

/**
 * A second member piling on.
 *
 * A real room does not ration itself to one reply per visitor: somebody answers and
 * somebody else adds a line, or reacts to the answer. The live room never did, so every
 * visitor got exactly one opinion from exactly one person. This fires at most once per
 * person's message — it needs the newest post to be a reply to that message and the post
 * before it to be the message itself — and never on a question about the platform, where a
 * single clear answer is worth more than a pile-on.
 */
function pileOn(posts: readonly PostedTurn[], ctx: AgendaContext): AgendaEvent | null {
  const reply = posts[posts.length - 1];
  const original = posts[posts.length - 2];
  if (!reply || !original) return null;
  if (reply.message.system) return null;
  if (!isExternal(original.message.sender, ctx.personas)) return null;
  if (original.turn.trigger !== "HUMAN") return null;
  if (reply.message.replyToSeq !== original.message.seq) return null;
  if (reply.message.primaryRecipient !== original.message.sender) return null;

  const text = original.message.text;
  const topic = topicFor(original.message.topicId, ctx.topics);
  const onTopic = asksAboutTopic(text, topic);
  if (asksAboutProduct(text, onTopic)) return null;
  if (isGreeting(text)) return null;
  if (text.includes("?") && contentTokens(text).size === 0) return null;
  // One in five of the messages the room has already answered, so the pile-on is a
  // texture rather than the new rhythm.
  if (hashString(`${ctx.config.roomId}:pile:${original.message.seq}`) % 100 >= 22) return null;

  return {
    kind: "HUMAN",
    reason: `${original.message.sender} is still here and somebody else is answering too`,
    sender: original.message.sender,
    topic,
    side: original.message.side,
    quoted: text,
    authoredBy: "responder",
    replyTo: original.message.seq,
    ...(onTopic ? {} : { offTopic: true }),
  };
}

export function nextEvent(ctx: AgendaContext): AgendaEvent {
  const { seq, now, config, topics, world, personas, turns } = ctx;
  const posts = postedTurns(turns);
  const newest = posts[posts.length - 1];
  const engine = config.agenda.enginePersona;

  // The room deliberately passed on the newest message. A `quiet` reply mode writes a
  // record with no message, so the human message stays at the head of the *message* log —
  // and the agenda would recognise it as unanswered forever, and answer it a second time,
  // without this. The marker is the room's own record of reading it.
  const lastRecord = turns[turns.length - 1];
  const humanPassedOn = Boolean(
    lastRecord &&
      lastRecord.message === null &&
      lastRecord.chosen !== null &&
      lastRecord.trigger === "HUMAN",
  );

  // 1. HUMAN — a person spoke and is owed a reply.
  if (newest && isExternal(newest.message.sender, personas) && !humanPassedOn) {
    const text = newest.message.text;
    const topic = topicFor(newest.message.topicId, topics);
    const onTopic = asksAboutTopic(text, topic);
    const product = asksAboutProduct(text, onTopic);
    const greeting = isGreeting(text);
    return {
      kind: "HUMAN",
      reason: onTopic
        ? "a person spoke and is owed a reply"
        : "a person asked something that is not about the open thread",
      sender: newest.message.sender,
      topic,
      side: newest.message.side,
      quoted: text,
      authoredBy: "responder",
      // The reply is visibly attached to the message it answers, the way a quoted
      // reply works in a chat app.
      replyTo: newest.message.seq,
      // Off the thread: the answer is to the person, not to the market.
      ...(onTopic ? {} : { offTopic: true }),
      // About the platform: a question the room answers without a claim (§9.2), and
      // `productIntent` is the shape of it — the difference between a testimonial and an
      // answer is whether the room knows which question it was asked.
      ...(product ? { productQuestion: true, productIntent: productIntentOf(text) } : {}),
      // Somebody walked in rather than asked: the reply owes them a welcome first.
      ...(greeting ? { greeting: true } : {}),
      replyMode: humanReplyMode({
        roomId: config.roomId,
        seq,
        text,
        product,
        greeting,
        first: isFirstFromSender(turns, newest.message.sender, personas),
      }),
    };
  }

  // 1b. PILE-ON — the person has had their answer, and a second member adds a line.
  if (!humanPassedOn) {
    const piling = pileOn(posts, ctx);
    if (piling) return piling;
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
      // The engine reports the world state, and it is the biggest single source of
      // repeated phrasing in the room: one digest sentence, said every recap and every
      // time the topic rotates. Rotating the paraphrase keeps the facts fixed and the
      // wording moving (`lexicon.ts`).
      quoted: digestFor(world, seq),
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
      // A THREAD turn answers a real message, so it quotes one with a subject in it.
      const target = flipping ? null : replyTarget(posts);

      if (flipping) {
        return {
          kind: "FRICTION",
          reason: `${streak.count} posts in a row on side ${streak.side}; forcing the counter-position`,
          sender: target ? target.sender : newest.message.sender,
          topic,
          side,
          quoted: topic.friction[side],
          // A FRICTION turn is handed the topic's canonical counter-line, which is a
          // prompt rather than a message, so it is not attached to the previous post.
          authoredBy: "responder",
        };
      }

      return {
        kind: "THREAD",
        reason: "continuing the open thread",
        sender: target ? target.sender : newest.message.sender,
        topic,
        side,
        quoted: target!.text,
        authoredBy: "responder",
        ...(target ? { replyTo: target.seq } : {}),
        // A statement, a question, or a verdict — the room's turns between its own
        // members are not all the same speech act (`threadReplyMode`).
        replyMode: threadReplyMode({ roomId: config.roomId, seq }),
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
    quoted: digestFor(world, seq),
    authoredBy: "engine",
  };
}
