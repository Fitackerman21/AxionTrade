/**
 * The worn-out-vocabulary rule (spec §8.1, `lexicon.ts`).
 *
 * The subject is a realism failure that was visible from a phone: "coil", "cooked",
 * "2400" carried a whole afternoon of the live room, and the engine's own digest line
 * was the source of half of it. These tests pin both halves — the terms the room has
 * exhausted, and the paraphrases that stop one sentence being injected all day.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { digestFor, overusedTerms, stem } from "./lexicon";
import { makeTurn, TEST_WORLD } from "./test-utils";

const said = (seq: number, text: string) => makeTurn(seq, { sender: "mara", text });

test("a term the room repeats becomes worn out, and the words it is allowed to repeat do not", () => {
  const turns = [
    said(1, "gold is coiling above the level again"),
    said(2, "still coiling, nothing has changed"),
    said(3, "the coil is doing the same thing"),
    said(4, "i keep saying it, coiled and boring"),
    said(5, "coiling again, i am not adding"),
  ];

  const worn = overusedTerms(turns);
  assert.ok(worn.includes("coiling") || worn.includes("coiled") || worn.includes("coil"), `${worn.join(",")}`);
  // The room's working vocabulary is anchored: "gold", "level" and "still" appear in
  // every one of those lines and are not what anybody means by repetition.
  for (const allowed of ["gold", "level", "still", "changed"]) {
    assert.equal(worn.includes(allowed), false, `"${allowed}" must not be flagged`);
  }
});

test("the count needs a handful of uses, so one mention is not a habit", () => {
  const turns = [said(1, "that setup is coiled"), said(2, "gold at the level")];
  assert.deepEqual(overusedTerms(turns), []);
});

test("only the room's own messages count, never the person's", () => {
  // A visitor typing a word four times must not stop the room answering them with it.
  const human = Array.from({ length: 5 }, (_, i) => ({
    ...makeTurn(10 + i, { sender: "mara", text: "filler line that fills the window" }),
    trigger: "HUMAN" as const,
    message: makeTurn(10 + i, { sender: "human", text: "deltas deltas deltas deltas" }).message,
  }));
  assert.equal(overusedTerms(human).includes("deltas"), false);
});

test("a level that keeps coming back is offered to the prompt, stem-guarded for the Gate", () => {
  const turns = [
    said(1, "2400 is the whole story here"),
    said(2, "2400 printed again"),
    said(3, "watching 2400 into the close"),
    said(4, "2400 or nothing"),
  ];
  assert.ok(overusedTerms(turns).includes("2400"), "the level is worth rotating in the prompt");
});

test("the stem groups the forms of one word, so three spellings are one habit", () => {
  assert.equal(stem("coiled"), stem("coiling"));
  assert.equal(stem("fills"), "fill");
  assert.equal(stem("misses"), "miss");
  // Never stemmed below four characters, or short words collide.
  assert.equal(stem("gas"), "gas");
});

test("the world state is said several ways, and falls back to the one digest", () => {
  const withVariants = { ...TEST_WORLD, digests: ["one", "two", "three"] };
  assert.deepEqual(
    [0, 1, 2, 3].map((seq) => digestFor(withVariants, seq)),
    ["one", "two", "three", "one"],
  );
  assert.equal(digestFor(TEST_WORLD, 7), TEST_WORLD.digest);
  // An empty or malformed variant list falls back to the digest rather than to "".
  assert.equal(digestFor({ ...TEST_WORLD, digests: ["  ", ""] }, 3), TEST_WORLD.digest);
});
