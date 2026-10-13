/**
 * Reactions (spec §13.3, `reactions.ts`).
 *
 * A reaction is state about a message, not a turn: it is grouped into one chip per
 * emoji in a fixed palette order, it never touches `seq`, and the store's toggle is the
 * write. These tests hold the grouping and the whitelist, which is what keeps an
 * arbitrary string (i.e. text) from reaching a bubble through the reaction path.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isReactionEmoji,
  reactionFor,
  reactionsFor,
  reactionsForTurns,
  roomReactionsFor,
  REACTION_EMOJI,
} from "./reactions";
import { makeTurn } from "./test-utils";

test("only the room's palette is accepted", () => {
  assert.equal(isReactionEmoji("🔥"), true);
  assert.equal(isReactionEmoji("🫡"), true);
  // The point of the whitelist: a reaction is a closed set of glyphs, not a channel for
  // writing a message nobody reviews.
  assert.equal(isReactionEmoji("scam"), false);
  assert.equal(isReactionEmoji("🔥🔥🔥 buy now"), false);
  assert.equal(isReactionEmoji(7), false);
  assert.equal(isReactionEmoji(undefined), false);
});

test("one chip per emoji, in palette order, whoever left it", () => {
  const chips = reactionsFor(5, [
    { seq: 5, emoji: "💀", by: "sol", t: 1 },
    { seq: 5, emoji: "🔥", by: "mara", t: 2 },
    { seq: 5, emoji: "🔥", by: "human", t: 3 },
    { seq: 6, emoji: "😂", by: "kofi", t: 4 },
  ]);

  assert.deepEqual(chips, [
    { emoji: "🔥", by: ["mara", "human"] },
    { emoji: "💀", by: ["sol"] },
  ]);
});

test("a reaction to a message that is not in the log is dropped, not rendered", () => {
  const turns = [makeTurn(1, { sender: "mara" }), makeTurn(2, { sender: "sol" })];
  const grouped = reactionsForTurns(turns, [
    { seq: 1, emoji: "👍", by: "human", t: 1 },
    { seq: 99, emoji: "👍", by: "human", t: 2 },
  ]);

  assert.deepEqual([...grouped.keys()], [1]);
  assert.deepEqual(grouped.get(1), [{ emoji: "👍", by: ["human"] }]);
});

const CANDIDATES = ["mara", "sol", "rafa", "kofi", "jess"] as const;

test("the glyph follows the shape of the line", () => {
  // A joke gets a laugh, a call gets fire, a shrug gets a wry face. The glyphs may vary
  // between the two candidates, but never across the families.
  assert.ok(["😂", "💀"].includes(reactionFor("lol it's been coiled for six days", "s")));
  assert.ok(["🔥", "👍"].includes(reactionFor("i'm long gold here", "s")));
  assert.ok(["😅", "🫡"].includes(reactionFor("that's just mid honestly", "s")));
  // Seeded: the same line and seed leave the same glyph every time.
  assert.equal(reactionFor("lol", "seed-1"), reactionFor("lol", "seed-1"));
  // And it is always in the palette.
  for (let seq = 1; seq <= 200; seq += 1) {
    assert.ok((REACTION_EMOJI as readonly string[]).includes(reactionFor("anything at all", `s${seq}`)));
  }
});

test("the room reacts to a minority of lines, never to itself", () => {
  let reacted = 0;
  let two = 0;
  for (let seq = 1; seq <= 1_000; seq += 1) {
    const reactions = roomReactionsFor({
      text: "i'm long gold into the print",
      seq,
      author: "mara",
      candidates: CANDIDATES,
    });
    for (const reaction of reactions) {
      assert.notEqual(reaction.by, "mara", "a persona reacted to its own line");
      assert.ok((CANDIDATES as readonly string[]).includes(reaction.by));
      assert.ok((REACTION_EMOJI as readonly string[]).includes(reaction.emoji));
    }
    // One chip per glyph, one reaction per person.
    assert.equal(new Set(reactions.map((r) => r.emoji)).size, reactions.length);
    assert.equal(new Set(reactions.map((r) => r.by)).size, reactions.length);
    reactions.forEach(() => (reacted += 1));
    if (reactions.length === 2) two += 1;
  }
  // Steady, not constant: roughly one line in five, and rare enough that two reactions
  // is the exception. A room that reacts to everything is as synthetic as one that never does.
  assert.ok(reacted / 1_000 > 0.15 && reacted / 1_000 < 0.3, `reaction rate was ${reacted / 1_000}`);
  assert.ok(two > 20 && two < 120, `two-reaction lines: ${two}`);
});

test("a line too short to have a shape gets no chip, and a lone candidate has no one to react", () => {
  let reacted = 0;
  for (let seq = 1; seq <= 200; seq += 1) {
    if (roomReactionsFor({ text: "ok", seq, author: "mara", candidates: CANDIDATES }).length > 0) {
      reacted += 1;
    }
    assert.deepEqual(
      roomReactionsFor({ text: "i'm long gold", seq, author: "mara", candidates: ["mara"] }),
      [],
    );
  }
  assert.equal(reacted, 0);
});
