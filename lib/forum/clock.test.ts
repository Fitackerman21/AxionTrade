import assert from "node:assert/strict";
import { test } from "node:test";

import { gapMsFor, meanGapMs, nextTurnAt, turnsOwed } from "./clock";

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
