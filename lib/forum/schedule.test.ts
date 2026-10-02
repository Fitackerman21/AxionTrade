import assert from "node:assert/strict";
import { test } from "node:test";

import { pickSpeaker, recencyFromTurns } from "./schedule";
import { makeTurn, TEST_CONFIG } from "./test-utils";
import type { SpeakerContext } from "./schedule";
import type { ForumConfig, PersonaId } from "./types";

function context(overrides: Partial<SpeakerContext> = {}): SpeakerContext {
  return {
    candidates: ["mara", "dmitri"],
    lastSpeaker: null,
    turnsSinceLastPost: {},
    consecutivePosts: 0,
    config: TEST_CONFIG,
    roomId: "test-room",
    seq: 7,
    ...overrides,
  };
}

function withSchedule(scheduling: Partial<ForumConfig["scheduling"]>): ForumConfig {
  return { ...TEST_CONFIG, scheduling: { ...TEST_CONFIG.scheduling, ...scheduling } };
}

test("the quietest permitted responder speaks", () => {
  const choice = pickSpeaker(context({ turnsSinceLastPost: { mara: 9, dmitri: 2 } }));
  assert.equal(choice.chosen, "mara");
  assert.deepEqual(choice.ordered, ["mara", "dmitri"]);
});

test("a persona who has never posted counts as maximally quiet", () => {
  const choice = pickSpeaker(context({ turnsSinceLastPost: { mara: 3 } }));
  assert.equal(choice.chosen, "dmitri");
});

test("anyone still inside the cooldown is skipped", () => {
  const choice = pickSpeaker(
    context({
      turnsSinceLastPost: { mara: 5, dmitri: 0 },
      config: withSchedule({ minTurnsBetweenPosts: 2 }),
    }),
  );
  assert.equal(choice.chosen, "mara");
  assert.equal(choice.relaxedCooldown, false);
});

test("the cooldown relaxes rather than producing no turn at all", () => {
  const choice = pickSpeaker(
    context({
      turnsSinceLastPost: { mara: 1, dmitri: 0 },
      config: withSchedule({ minTurnsBetweenPosts: 2 }),
    }),
  );
  assert.equal(choice.relaxedCooldown, true);
  assert.equal(choice.chosen, "mara");
});

test("the last speaker is skipped once they hit maxConsecutivePosts", () => {
  const choice = pickSpeaker(
    context({
      lastSpeaker: "mara",
      consecutivePosts: 1,
      turnsSinceLastPost: { mara: 20, dmitri: 1 },
      config: withSchedule({ maxConsecutivePosts: 1, minTurnsBetweenPosts: 0 }),
    }),
  );
  assert.equal(choice.chosen, "dmitri");
});

test("a lone candidate is not left with nobody to speak", () => {
  const choice = pickSpeaker(
    context({
      candidates: ["mara"],
      lastSpeaker: "mara",
      consecutivePosts: 3,
      turnsSinceLastPost: { mara: 0 },
      config: withSchedule({ maxConsecutivePosts: 1, minTurnsBetweenPosts: 5 }),
    }),
  );
  assert.equal(choice.chosen, "mara");
});

test("no permitted responder yields no speaker", () => {
  const choice = pickSpeaker(context({ candidates: [] }));
  assert.equal(choice.chosen, null);
  assert.equal(choice.reason, "no-permitted-responder");
  assert.deepEqual(choice.ordered, []);
});

test("tie-breaks are reproducible and independent of input order", () => {
  const tied = {
    candidates: ["mara", "dmitri"] as PersonaId[],
    turnsSinceLastPost: { mara: 5, dmitri: 5 },
  };

  const first = pickSpeaker(context(tied));
  const second = pickSpeaker(context(tied));
  const reversed = pickSpeaker(context({ ...tied, candidates: ["dmitri", "mara"] }));

  assert.deepEqual(first.ordered, second.ordered);
  assert.deepEqual(first.ordered, reversed.ordered);
});

test("recencyFromTurns measures distance and the trailing streak", () => {
  const turns = [makeTurn(1, { sender: "mara" }), makeTurn(2, { sender: "sol" }), makeTurn(3, { sender: "sol" })];
  const recency = recencyFromTurns(turns, 3);

  assert.equal(recency.lastSpeaker, "sol");
  assert.equal(recency.consecutivePosts, 2);
  assert.equal(recency.turnsSinceLastPost.sol, 0);
  assert.equal(recency.turnsSinceLastPost.mara, 2);
});

test("recencyFromTurns ignores hand-off turns with no message", () => {
  const turns = [makeTurn(1, { sender: "mara" }), makeTurn(2, { sender: "human", withMessage: false })];
  const recency = recencyFromTurns(turns, 2);

  assert.equal(recency.lastSpeaker, "mara");
  assert.equal(recency.consecutivePosts, 1);
  assert.equal(recency.turnsSinceLastPost.mara, 1);
});
