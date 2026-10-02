import assert from "node:assert/strict";
import { test } from "node:test";

import { advance } from "./advance";
import { publish } from "./publisher";
import { createFixture, makeTurn, TEST_CONFIG, TEST_PERSONAS, TEST_TOPICS, TEST_WORLD } from "./test-utils";
import type { ForumConfig } from "./types";

const BASE = 1_800_000_000_000;

function withPermissions(permissions: Partial<ForumConfig["permissions"]>): ForumConfig {
  return { ...TEST_CONFIG, permissions: { ...TEST_CONFIG.permissions, ...permissions } };
}

test("each call publishes exactly one turn, numbered in sequence", async () => {
  const fixture = await createFixture();
  try {
    const statuses: string[] = [];
    for (let n = 1; n <= 3; n += 1) {
      statuses.push((await advance(fixture.store, { now: BASE + n * 1000, driver: "test" })).status);
    }
    assert.deepEqual(statuses, ["published", "published", "published"]);

    const turns = await fixture.store.readTurns(10);
    assert.deepEqual(turns.map((t) => t.seq), [1, 2, 3]);

    for (const turn of turns) {
      assert.ok(turn.message, `turn ${turn.seq} published with no message`);
      assert.equal(turn.worldVersion, TEST_WORLD.version);
      assert.equal(turn.driver, "test");
      assert.equal(turn.decision, "APPROVE");
      assert.ok(
        TEST_PERSONAS.some((p) => p.id === turn.message?.sender),
        `${turn.message?.sender} is not on the roster`,
      );
    }
  } finally {
    await fixture.cleanup();
  }
});

test("the room opens on the engine persona and then rotates speakers", async () => {
  const fixture = await createFixture();
  try {
    const first = await advance(fixture.store, { now: BASE });
    assert.equal(first.record?.chosen, TEST_CONFIG.agenda.enginePersona);
    assert.equal(first.record?.trigger, "IDLE");
    // The opening is authored by the engine, not scheduled among candidates, and
    // it is not an escalation.
    assert.deepEqual(first.record?.candidates, []);
    assert.equal(first.record?.escalated, null);
    assert.equal(first.record?.message?.primaryRecipient, "room");
    assert.equal(first.record?.message?.system, false);

    const second = await advance(fixture.store, { now: BASE + 1000 });
    assert.equal(second.record?.trigger, "THREAD");
    assert.equal(second.record?.event.sender, TEST_CONFIG.agenda.enginePersona);
    // Nobody may reply to themselves, so the second voice is a different one.
    assert.notEqual(second.record?.chosen, TEST_CONFIG.agenda.enginePersona);
  } finally {
    await fixture.cleanup();
  }
});

test("a turn never goes backwards in time", async () => {
  const fixture = await createFixture();
  try {
    await advance(fixture.store, { now: BASE + 5000 });
    const rewound = await advance(fixture.store, { now: BASE });

    assert.equal(rewound.status, "clock-rewind");
    assert.equal(rewound.record, null);
    assert.deepEqual((await fixture.store.readTurns(10)).map((t) => t.seq), [1]);
  } finally {
    await fixture.cleanup();
  }
});

test("an identical timestamp is still allowed to advance", async () => {
  const fixture = await createFixture();
  try {
    await advance(fixture.store, { now: BASE });
    const second = await advance(fixture.store, { now: BASE });
    assert.equal(second.status, "published");
    assert.deepEqual((await fixture.store.readTurns(10)).map((t) => t.seq), [1, 2]);
  } finally {
    await fixture.cleanup();
  }
});

test("a turn is skipped while another driver holds the lease", async () => {
  const fixture = await createFixture();
  try {
    await fixture.store.acquireLease("worker:999", 60_000, BASE);
    const blocked = await advance(fixture.store, { now: BASE });

    assert.equal(blocked.status, "lease-held");
    assert.deepEqual(await fixture.store.readTurns(10), []);
  } finally {
    await fixture.cleanup();
  }
});

test("the lease is released even when a turn completes", async () => {
  const fixture = await createFixture();
  try {
    await advance(fixture.store, { now: BASE });
    assert.equal(await fixture.store.readLease(), null);
  } finally {
    await fixture.cleanup();
  }
});

test("a person's message is answered by someone the matrix permits", async () => {
  const fixture = await createFixture();
  try {
    await fixture.store.appendHumanMessage({
      text: "what is the room's read on gold?",
      sender: "human",
      t: BASE,
      topicId: TEST_TOPICS[0].id,
    });

    const result = await advance(fixture.store, { now: BASE + 1000 });
    assert.equal(result.record?.trigger, "HUMAN");
    assert.deepEqual(result.record?.candidates, ["jev", "mara"]);
    assert.equal(result.record?.message?.primaryRecipient, "human");
    assert.ok(["jev", "mara"].includes(result.record?.chosen ?? ""));
  } finally {
    await fixture.cleanup();
  }
});

test("a sender with no permitted responder falls back to the reciprocal pool", async () => {
  const fixture = await createFixture({ config: withPermissions({ allow: { dmitri: ["jev"] } }) });
  try {
    // Seed a turn so the room is already open and the escalation path runs.
    await fixture.store.appendTurn(makeTurn(1, { sender: "jev", topicId: TEST_TOPICS[0].id }));
    const result = await advance(fixture.store, { now: BASE });

    assert.equal(result.record?.seq, 2);
    assert.equal(result.record?.escalated, "pool-widened");
    assert.equal(result.record?.chosen, "dmitri");
    assert.deepEqual(result.record?.candidates, ["dmitri"]);
    assert.equal(result.record?.message?.system, false);
  } finally {
    await fixture.cleanup();
  }
});

test("a sender nobody covers gets an engine stage direction instead of silence", async () => {
  const fixture = await createFixture({ config: withPermissions({ allow: {} }) });
  try {
    await fixture.store.appendTurn(makeTurn(1, { sender: "jev", topicId: TEST_TOPICS[0].id }));
    const result = await advance(fixture.store, { now: BASE });

    assert.equal(result.record?.escalated, "stage-direction");
    assert.equal(result.record?.chosen, TEST_CONFIG.agenda.enginePersona);
    assert.equal(result.record?.message?.system, true);
    assert.deepEqual(result.record?.candidates, []);
    assert.match(result.record?.note ?? "", /stage direction/);
  } finally {
    await fixture.cleanup();
  }
});

test("everything published stays inside the persona's register", async () => {
  const fixture = await createFixture();
  try {
    for (let n = 0; n < 8; n += 1) {
      await advance(fixture.store, { now: BASE + n * 1000 });
    }

    const turns = await fixture.store.readTurns(20);
    assert.equal(turns.length, 8);

    for (const turn of turns) {
      const message = turn.message;
      assert.ok(message);
      if (message.system) continue;
      const persona = TEST_PERSONAS.find((p) => p.id === message.sender);
      assert.ok(persona);
      assert.ok(
        message.text.length >= persona.sheet.register.minChars,
        `${persona.id} posted below its register: "${message.text}"`,
      );
      assert.ok(
        message.text.length <= persona.sheet.register.maxChars,
        `${persona.id} posted above its register: "${message.text}"`,
      );
    }
  } finally {
    await fixture.cleanup();
  }
});

test("the publisher refuses anything that is not approved", async () => {
  const fixture = await createFixture();
  try {
    await assert.rejects(
      () => publish(fixture.store, { ...makeTurn(1, { sender: "mara" }), decision: "SKIP" }),
      /refusing to publish/,
    );
    await assert.rejects(
      () => publish(fixture.store, { ...makeTurn(1, { sender: "mara" }), message: null }),
      /no message/,
    );
    assert.deepEqual(await fixture.store.readTurns(10), []);
  } finally {
    await fixture.cleanup();
  }
});
