import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { messagesFromTurns } from "./store";
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

test("the world version is available to every turn", async () => {
  const fixture = await createFixture();
  try {
    assert.equal((await fixture.store.readWorld()).version, TEST_WORLD.version);
  } finally {
    await fixture.cleanup();
  }
});
