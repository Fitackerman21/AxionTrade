import assert from "node:assert/strict";
import { test } from "node:test";

import {
  gapMsFor,
  humanReplyDueAt,
  meanGapMs,
  nextTurnAt,
  readDelayMs,
  turnsOwed,
  typingAt,
} from "./clock";

const RANGE: [number, number] = [45, 180];

test("the mean gap is the midpoint of the range", () => {
  assert.equal(meanGapMs(RANGE), 112_500);
  assert.equal(meanGapMs([60, 60]), 60_000);
});

test("jitter stays inside the configured range", () => {
  for (let seq = 1; seq <= 200; seq += 1) {
    const gap = gapMsFor("test-room", seq, RANGE);
    assert.ok(gap >= 45_000, `seq ${seq} produced ${gap}ms`);
    assert.ok(gap <= 180_000, `seq ${seq} produced ${gap}ms`);
  }
});

test("jitter is reproducible for a given turn and varies between turns", () => {
  const first = gapMsFor("test-room", 7, RANGE);
  assert.equal(gapMsFor("test-room", 7, RANGE), first);
  assert.equal(gapMsFor("test-room", 8, RANGE) === first, false);
  assert.equal(gapMsFor("other-room", 7, RANGE) === first, false);
});

test("a zero-width range has no jitter", () => {
  assert.equal(gapMsFor("test-room", 3, [30, 30]), 30_000);
});

test("turns owed is the gap divided by the intended cadence", () => {
  assert.equal(turnsOwed(0, RANGE), 0);
  assert.equal(turnsOwed(-5000, RANGE), 0);
  assert.equal(turnsOwed(112_500, RANGE), 1);
  // Two minutes is one turn at this cadence, not two.
  assert.equal(turnsOwed(120_000, RANGE), 1);
  assert.equal(turnsOwed(60 * 60 * 1000, RANGE), Math.floor(3_600_000 / 112_500));
});

test("the next turn is due one mean gap after the last", () => {
  assert.equal(nextTurnAt(1_000_000, RANGE), 1_112_500);
});

test("a longer message takes longer to read, inside sane bounds", () => {
  const oneWord = readDelayMs("Is this real?");
  const paragraph = readDelayMs("i have been looking at this platform for a while now and i wanted to ask what you all actually use it for, because i am not sure i am getting the most out of it yet".repeat(2));

  assert.ok(oneWord >= 1_800, `a one-liner must not be instant, got ${oneWord}ms`);
  assert.ok(paragraph > oneWord, "a paragraph takes longer to read than a one-liner");
  assert.ok(paragraph <= 12_000, `the read is bounded, got ${paragraph}ms`);
  // An empty or missing message is never instant either — the bubble is what signals a
  // reply is coming, and a zero delay puts it on screen in the same frame as the send.
  assert.equal(readDelayMs(undefined), 1_800);
  assert.equal(readDelayMs("   "), 1_800);
});

test("the typing bubble starts after the read and never outlives the reply", () => {
  const at = 1_800_000_000_000;
  const due = humanReplyDueAt("test-room", at, 7, [30, 60]);

  const start = typingAt(at, "Is this real?", due);
  assert.ok(start >= at + 1_800, "the room reads before it types");
  assert.ok(start < due, "the bubble cannot appear after the answer has landed");
  assert.equal(typingAt(at, "Is this real?", at + 500), at, "a due time inside the read wins");
});
