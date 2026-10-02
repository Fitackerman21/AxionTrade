import assert from "node:assert/strict";
import { test } from "node:test";

import { catchUp, roomMode } from "./catchup";
import { createFixture, makeTurn, TEST_BASE, TEST_CONFIG, TEST_TOPICS } from "./test-utils";
import type { ForumConfig } from "./types";

/** gapSec [45,180] means a mean gap of 112.5s. */
const MINUTE = 60_000;

function withRuntime(runtime: Partial<ForumConfig["runtime"]>): ForumConfig {
  return { ...TEST_CONFIG, runtime: { ...TEST_CONFIG.runtime, ...runtime } };
}

test("a live worker means nothing to catch up", async () => {
  const fixture = await createFixture();
  const now = TEST_BASE + 1_000_000;
  try {
    await fixture.store.writeHeartbeat({ owner: "worker:1", expiresAt: now + 60_000 });
    assert.equal(await roomMode(fixture.store, now), "live");

    const report = await catchUp(fixture.store, { now });
    assert.equal(report.mode, "live");
    assert.equal(report.ran, 0);
    assert.deepEqual(await fixture.store.readTurns(10), []);
  } finally {
    await fixture.cleanup();
  }
});

test("an expired heartbeat reads as lazy", async () => {
  const fixture = await createFixture();
  const now = TEST_BASE + 1_000_000;
  try {
    await fixture.store.writeHeartbeat({ owner: "worker:1", expiresAt: now - 1 });
    assert.equal(await roomMode(fixture.store, now), "lazy");
  } finally {
    await fixture.cleanup();
  }
});

test("an empty log is opened with a single turn", async () => {
  const fixture = await createFixture();
  try {
    const report = await catchUp(fixture.store, { now: TEST_BASE });

    assert.equal(report.mode, "lazy");
    assert.equal(report.ran, 1);
    assert.equal(report.owed, 0);
    assert.equal(report.reason, "opened the room");
    assert.deepEqual((await fixture.store.readTurns(10)).map((t) => t.seq), [1]);
  } finally {
    await fixture.cleanup();
  }
});

test("a short gap generates the turns that were owed", async () => {
  const fixture = await createFixture();
  try {
    // Four minutes behind at a 112.5s cadence is two turns.
    await fixture.store.appendTurn(makeTurn(1, { sender: "mara", topicId: TEST_TOPICS[0].id }));
    const now = TEST_BASE + 1000 + 4 * MINUTE;

    const report = await catchUp(fixture.store, { now });
    assert.equal(report.owed, 2);
    assert.equal(report.ran, 2);
    assert.equal(report.skipped, 0);
    assert.equal(report.recapped, false);
    assert.deepEqual((await fixture.store.readTurns(10)).map((t) => t.seq), [1, 2, 3]);
  } finally {
    await fixture.cleanup();
  }
});

test("a burst is capped and reports what it did not generate", async () => {
  const fixture = await createFixture({ config: withRuntime({ catchUpMaxTurns: 3 }) });
  try {
    await fixture.store.appendTurn(makeTurn(1, { sender: "mara", topicId: TEST_TOPICS[0].id }));
    // An hour behind at this cadence is ~32 turns, well past the cap.
    const now = TEST_BASE + 1000 + 60 * MINUTE;

    const report = await catchUp(fixture.store, { now });
    assert.equal(report.ran, 3);
    assert.equal(report.owed, 32);
    assert.equal(report.skipped, 29);
    assert.equal(report.recapped, false);
    assert.equal((await fixture.store.readTurns(Number.POSITIVE_INFINITY)).length, 4);
  } finally {
    await fixture.cleanup();
  }
});

test("a stale gap produces one recap instead of a replay", async () => {
  const fixture = await createFixture();
  try {
    await fixture.store.appendTurn(makeTurn(1, { sender: "mara", topicId: TEST_TOPICS[0].id }));
    // Six hours down with a 90-minute staleness threshold.
    const now = TEST_BASE + 1000 + 6 * 60 * MINUTE;

    const report = await catchUp(fixture.store, { now });
    assert.equal(report.recapped, true);
    assert.equal(report.ran, 1);
    assert.equal(report.skipped, report.owed - 1);
    assert.ok(report.skipped > 100, `expected a large skip, got ${report.skipped}`);
    assert.match(report.reason, /stale gap/);

    // The one turn it did generate is the recap, timestamped at the real now so
    // the room is no longer behind.
    const turns = await fixture.store.readTurns(10);
    assert.equal(turns.length, 2);
    assert.equal(turns[1]?.trigger, "RECAP");
    assert.equal(turns[1]?.t, now);
  } finally {
    await fixture.cleanup();
  }
});

test("a dry run reports the backlog without writing", async () => {
  const fixture = await createFixture();
  try {
    await fixture.store.appendTurn(makeTurn(1, { sender: "mara", topicId: TEST_TOPICS[0].id }));
    const now = TEST_BASE + 1000 + 30 * MINUTE;

    const report = await catchUp(fixture.store, { now, dryRun: true });
    assert.equal(report.ran, 0);
    assert.equal(report.owed, 16);
    assert.equal((await fixture.store.readTurns(10)).length, 1);
  } finally {
    await fixture.cleanup();
  }
});

test("a room that is up to date is left alone", async () => {
  const fixture = await createFixture();
  try {
    await fixture.store.appendTurn(makeTurn(1, { sender: "mara", topicId: TEST_TOPICS[0].id }));
    const report = await catchUp(fixture.store, { now: TEST_BASE + 1000 + 10_000 });

    assert.equal(report.owed, 0);
    assert.equal(report.ran, 0);
    assert.equal(report.reason, "the room is up to date");
  } finally {
    await fixture.cleanup();
  }
});

test("a clock that has gone backwards does not generate a turn", async () => {
  const fixture = await createFixture();
  try {
    await fixture.store.appendTurn(makeTurn(1, { sender: "mara", topicId: TEST_TOPICS[0].id }));
    const report = await catchUp(fixture.store, { now: TEST_BASE });

    assert.equal(report.ran, 0);
    assert.equal((await fixture.store.readTurns(10)).length, 1);
  } finally {
    await fixture.cleanup();
  }
});
