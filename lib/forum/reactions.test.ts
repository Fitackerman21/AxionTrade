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

import { isReactionEmoji, reactionsFor, reactionsForTurns } from "./reactions";
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
