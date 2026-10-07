import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { messagesFromTurns, messagesWithReactions } from "./store";
import { createFixture, makeTurn, TEST_TOPICS, TEST_WORLD } from "./test-utils";

test("turns round-trip through the log in order", async () => {
  const fixture = await createFixture();
  try {
    await fixture.store.appendTurn(makeTurn(1, { sender: "mara" }));
    await fixture.store.appendTurn(makeTurn(2, { sender: "sol" }));

    assert.deepEqual((await fixture.store.readTurns(10)).map((t) => t.seq), [1, 2]);
    assert.equal((await fixture.store.readLastTurn())?.seq, 2);
  } finally {
    await fixture.cleanup();
  }
});

test("an empty room has no log and no last turn", async () => {
  const fixture = await createFixture();
  try {
    assert.deepEqual(await fixture.store.readTurns(10), []);
    assert.equal(await fixture.store.readLastTurn(), null);
  } finally {
    await fixture.cleanup();
  }
});

test("readTurns returns the newest N in ascending order", async () => {
  const fixture = await createFixture();
  try {
    for (let seq = 1; seq <= 5; seq += 1) {
      await fixture.store.appendTurn(makeTurn(seq, { sender: "mara" }));
    }
    assert.deepEqual((await fixture.store.readTurns(2)).map((t) => t.seq), [4, 5]);
  } finally {
    await fixture.cleanup();
  }
});

test("a seq range can be pruned out, and the room carries on from what is left", async () => {
  const fixture = await createFixture();
  try {
    for (let seq = 1; seq <= 5; seq += 1) {
      await fixture.store.appendTurn(makeTurn(seq, { sender: "mara" }));
    }

    // The shapes the tool actually asks for: a contiguous block, and the tail.
    assert.equal(await fixture.store.deleteTurns(2, 3), 2);
    assert.deepEqual((await fixture.store.readTurns(10)).map((t) => t.seq), [1, 4, 5]);
    assert.equal(await fixture.store.deleteTurns(4, 9), 2);
    assert.deepEqual((await fixture.store.readTurns(10)).map((t) => t.seq), [1]);

    // A range with nothing in it is not an error, and removes nothing.
    assert.equal(await fixture.store.deleteTurns(40, 50), 0);
    assert.deepEqual((await fixture.store.readTurns(10)).map((t) => t.seq), [1]);

    // The room resumes from the highest seq it can still see, so the gap is harmless.
    const next = await fixture.store.appendHumanMessage({
      text: "still here?",
      sender: "human",
      t: Date.now(),
      topicId: TEST_TOPICS[0]!.id,
    });
    assert.equal(next.seq, 2);
  } finally {
    await fixture.cleanup();
  }
});

test("a truncated final line is dropped, not fatal", async () => {
  const fixture = await createFixture();
  try {
    await fixture.store.appendTurn(makeTurn(1, { sender: "mara" }));
    const log = path.join(fixture.root, "log.jsonl");
    await writeFile(log, `${JSON.stringify(makeTurn(1, { sender: "mara" }))}\n{"seq":2,"mess`, "utf8");

    const warn = console.warn;
    console.warn = () => {};
    try {
      const turns = await fixture.store.readTurns(10);
      assert.deepEqual(turns.map((t) => t.seq), [1]);
    } finally {
      console.warn = warn;
    }
  } finally {
    await fixture.cleanup();
  }
});

test("corruption in the middle of the log is fatal", async () => {
  const fixture = await createFixture();
  try {
    const log = path.join(fixture.root, "log.jsonl");
    await writeFile(
      log,
      `{"seq":1,"broken\n${JSON.stringify(makeTurn(2, { sender: "sol" }))}\n`,
      "utf8",
    );
    await assert.rejects(() => fixture.store.readTurns(10), /line 1 is corrupt/);
  } finally {
    await fixture.cleanup();
  }
});

test("the lease is exclusive, releasable, and reclaimable once expired", async () => {
  const fixture = await createFixture();
  const now = 1_000_000;
  try {
    assert.equal(await fixture.store.acquireLease("worker:1", 30_000, now), true);
    assert.equal(await fixture.store.acquireLease("lazy:2", 30_000, now), false);

    // A different owner must not be able to release it.
    await fixture.store.releaseLease("lazy:2");
    assert.equal((await fixture.store.readLease())?.owner, "worker:1");

    // Past its expiry it can be reclaimed.
    assert.equal(await fixture.store.acquireLease("lazy:2", 30_000, now + 40_000), true);
    assert.equal((await fixture.store.readLease())?.owner, "lazy:2");

    await fixture.store.releaseLease("lazy:2");
    assert.equal(await fixture.store.readLease(), null);
  } finally {
    await fixture.cleanup();
  }
});

test("a human message becomes the next turn", async () => {
  const fixture = await createFixture();
  try {
    await fixture.store.appendTurn(makeTurn(1, { sender: "mara" }));
    const record = await fixture.store.appendHumanMessage({
      text: "what is the read on gold?",
      sender: "human",
      t: 1_000_999,
      topicId: TEST_TOPICS[0].id,
    });

    assert.equal(record.seq, 2);
    assert.equal(record.trigger, "HUMAN");
    assert.equal(record.message?.sender, "human");
    assert.equal(record.message?.text, "what is the read on gold?");
    assert.equal((await fixture.store.readLastTurn())?.seq, 2);
  } finally {
    await fixture.cleanup();
  }
});

test("the public projection only carries published messages", () => {
  const turns = [
    makeTurn(1, { sender: "mara" }),
    makeTurn(2, { sender: "human", withMessage: false }),
    makeTurn(3, { sender: "sol" }),
  ];

  assert.deepEqual(messagesFromTurns(turns).map((m) => m.sender), ["mara", "sol"]);
});

test("a heartbeat is written, read and cleared by its owner", async () => {
  const fixture = await createFixture();
  const now = 1_800_000_000_000;
  try {
    assert.equal(await fixture.store.readHeartbeat(), null);

    await fixture.store.writeHeartbeat({ owner: "worker:1", expiresAt: now + 60_000 });
    assert.equal((await fixture.store.readHeartbeat())?.owner, "worker:1");

    // A different driver must not be able to clear it.
    await fixture.store.clearHeartbeat("worker:2");
    assert.equal((await fixture.store.readHeartbeat())?.owner, "worker:1");

    await fixture.store.clearHeartbeat("worker:1");
    assert.equal(await fixture.store.readHeartbeat(), null);
  } finally {
    await fixture.cleanup();
  }
});

test("the world version is available to every turn", async () => {
  const fixture = await createFixture();
  try {
    assert.equal((await fixture.store.readWorld()).version, TEST_WORLD.version);
  } finally {
    await fixture.cleanup();
  }
});

test("a reaction is toggled on and off beside the log, never inside it", async () => {
  const fixture = await createFixture();
  try {
    await fixture.store.appendTurn(makeTurn(1, { sender: "mara" }));
    const before = await fixture.store.readTurns(10);

    assert.equal(
      await fixture.store.toggleReaction({ seq: 1, emoji: "🔥", by: "human", t: 1000 }),
      true,
    );
    assert.deepEqual(await fixture.store.readReactions(), [
      { seq: 1, emoji: "🔥", by: "human", t: 1000 },
    ]);

    // Tapping the chip you left takes it back.
    assert.equal(
      await fixture.store.toggleReaction({ seq: 1, emoji: "🔥", by: "human", t: 2000 }),
      false,
    );
    assert.deepEqual(await fixture.store.readReactions(), []);

    // And the log itself is untouched: `seq` cannot move because somebody tapped an
    // emoji, which is what keeps the agenda deterministic.
    assert.deepEqual(await fixture.store.readTurns(10), before);
  } finally {
    await fixture.cleanup();
  }
});

test("the projection carries the chips on the message they belong to", async () => {
  const fixture = await createFixture();
  try {
    await fixture.store.appendTurn(makeTurn(1, { sender: "mara" }));
    await fixture.store.appendTurn(makeTurn(2, { sender: "sol" }));
    await fixture.store.toggleReaction({ seq: 2, emoji: "👍", by: "human", t: 1000 });
    await fixture.store.toggleReaction({ seq: 2, emoji: "😂", by: "rafa", t: 1001 });

    const messages = messagesWithReactions(
      await fixture.store.readTurns(10),
      await fixture.store.readReactions(),
    );
    assert.equal(messages[0]?.reactions, undefined);
    assert.deepEqual(messages[1]?.reactions, [
      { emoji: "👍", by: ["human"] },
      { emoji: "😂", by: ["rafa"] },
    ]);
  } finally {
    await fixture.cleanup();
  }
});
