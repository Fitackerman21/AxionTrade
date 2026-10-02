import assert from "node:assert/strict";
import { test } from "node:test";

import { createFixture, TEST_BASE, TEST_CONFIG } from "./test-utils";
import { runWorker } from "./worker";
import type { WorkerHandle } from "./worker";
import type { ForumConfig } from "./types";

/** A clock that only moves forward, so turns are never rejected as rewinds. */
function steppingClock(start: number): () => number {
  let now = start;
  return () => {
    now += 1000;
    return now;
  };
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for the room to advance");
}

function withGap(gapSec: [number, number]): ForumConfig {
  return { ...TEST_CONFIG, scheduling: { ...TEST_CONFIG.scheduling, gapSec } };
}

test("the worker publishes turns up to its cap and leaves no heartbeat behind", async () => {
  const fixture = await createFixture();
  try {
    let sawHeartbeat = false;
    const worker = runWorker(fixture.store, {
      maxTurns: 3,
      sleep: async () => {
        // Called between turns, after the heartbeat was refreshed.
        if (await fixture.store.readHeartbeat()) sawHeartbeat = true;
      },
      now: steppingClock(TEST_BASE + 60_000),
    });

    const outcome = await worker.finished;
    assert.equal(outcome.turns, 3);
    assert.match(outcome.reason, /3-turn cap/);
    assert.deepEqual((await fixture.store.readTurns(10)).map((t) => t.seq), [1, 2, 3]);
    assert.equal(sawHeartbeat, true, "the worker should advertise itself while running");
    assert.equal(await fixture.store.readHeartbeat(), null);
  } finally {
    await fixture.cleanup();
  }
});

test("stop() interrupts a long rest instead of waiting it out", async () => {
  // A three minute rest: without the interrupt, this test would take minutes.
  const fixture = await createFixture({ config: withGap([180, 180]) });
  try {
    const worker = runWorker(fixture.store, { now: steppingClock(TEST_BASE + 60_000) });

    await waitUntil(async () => (await fixture.store.readTurns(2)).length >= 1);

    const startedAt = Date.now();
    worker.stop();
    const outcome = await worker.finished;

    assert.equal(outcome.turns, 1);
    assert.equal(outcome.reason, "stopped");
    assert.ok(Date.now() - startedAt < 2000, "stop() should not sit out the rest");
    assert.equal(await fixture.store.readHeartbeat(), null);
  } finally {
    await fixture.cleanup();
  }
});

test("a worker yields to another driver holding the turn lease", async () => {
  const fixture = await createFixture();
  try {
    // Dated with the same clock the worker reads, or it would look expired and
    // simply be reclaimed.
    await fixture.store.acquireLease("someone-else", 10 * 60_000, TEST_BASE);

    // A holder, because the sleep hook has to be able to stop its own worker.
    const state: { handle?: WorkerHandle } = {};
    let backoffs = 0;
    state.handle = runWorker(fixture.store, {
      now: steppingClock(TEST_BASE + 60_000),
      sleep: async () => {
        backoffs += 1;
        if (backoffs >= 2) state.handle?.stop();
      },
    });

    const handle = state.handle;
    assert.ok(handle, "the worker should have started");
    const outcome = await handle.finished;
    assert.equal(outcome.turns, 0);
    assert.ok(backoffs >= 2, "it should back off rather than spin");
    assert.deepEqual(await fixture.store.readTurns(10), []);
    assert.equal(await fixture.store.readHeartbeat(), null);
  } finally {
    await fixture.cleanup();
  }
});
